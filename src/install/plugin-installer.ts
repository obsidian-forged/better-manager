import { Notice, Platform, normalizePath, requireApiVersion } from 'obsidian';
import type Manager from '../main';
import type { BackgroundTaskHandle } from '../tasks/task-center';
import { parseInstallManifest } from '../catalog/install-manifest';
import { replacePluginBuild } from '../storage/plugin-build';
import { BPM_TAG_ID, ManagerPlugin } from '../data/types';
import type { InstallationSource } from '../updates/types';
import { sourceIdentity, UpdateGuardError } from '../updates/update-policy';
import { applySourceBinding, captureSourceBinding } from '../updates/source-binding';

export interface PluginBuildFiles { manifestText: string | null; mainJs: string | null; styles: string | null }
export interface PluginInstallOptions {
    source: InstallationSource;
    tag: string;
    label: string;
    publishedAt?: string;
    isGithubLatest?: boolean;
    expectedId?: string;
    expectedManifestVersion?: string;
    markAsBpm?: boolean;
    quiet?: boolean;
    guard?: () => Promise<void> | void;
    onError?: (error: unknown) => void;
}

/** GitHub 与独立源共用写盘、恢复、启停状态和来源登记 / One installation boundary for all sources. */
export async function installPluginFiles(manager: Manager, files: PluginBuildFiles, options: PluginInstallOptions, task: BackgroundTaskHandle): Promise<void> {
    if (!files.manifestText || !files.mainJs) throw new Error(manager.translator.t('安装_错误_缺少插件资源'));
    const payload: unknown = JSON.parse(files.manifestText);
    const manifest = parseInstallManifest(payload, options.expectedId);
    if (options.expectedManifestVersion && manifest.version !== options.expectedManifestVersion) throw new UpdateGuardError('changed', manager.translator.t('批量更新_清单变化'));
    if (!requireApiVersion(manifest.minAppVersion)) throw new Error(manager.translator.t('兼容性_需要版本', { version: manifest.minAppVersion }));
    if (Platform.isMobile && manifest.isDesktopOnly) throw new Error(manager.translator.t('目录_仅桌面'));
    const checkRules = () => manager.updates?.assertAllowed(manifest.id, sourceIdentity(options.source), options.tag);
    checkRules();
    await options.guard?.();
    const adapter = manager.app.vault.adapter;
    const installed = Boolean(manager.appPlugins.manifests[manifest.id]);
    const runningBeforeInstall = Boolean(manager.appPlugins.plugins?.[manifest.id]);
    const pluginDir = normalizePath(`${manager.app.vault.configDir}/plugins/${manifest.id}`);
    const originalBinding = captureSourceBinding(manager, manifest.id);
    let lifecycleStarted = false, bindingChanged = false;
    let registration: { record?: ManagerPlugin; bpmInstalled: boolean } | undefined;
    if (!(await adapter.exists(pluginDir))) await adapter.mkdir(pluginDir);
    task.update({ title: manager.translator.t('任务_写入插件文件', { name: options.label }), progress: 0.84 });
    await replacePluginBuild(adapter, pluginDir, { 'manifest.json': files.manifestText, 'main.js': files.mainJs, 'styles.css': files.styles },
        async () => {
            checkRules();
            await options.guard?.();
            lifecycleStarted = true;
            if (manager.appPlugins.plugins?.[manifest.id]) await manager.appPlugins.disablePlugin(manifest.id);
            await manager.history?.captureBeforeInstall(manifest.id);
        }, async () => {
            if (!lifecycleStarted) return;
            checkRules();
            await options.guard?.();
            await manager.appPlugins.loadManifests();
            if (!installed || runningBeforeInstall) {
                if (installed) await manager.appPlugins.enablePlugin(manifest.id);
                else await manager.appPlugins.enablePluginAndSave(manifest.id);
                if (!manager.appPlugins.plugins?.[manifest.id]) throw new Error('The installed plugin could not be loaded');
            }
            checkRules();
            if (JSON.stringify(captureSourceBinding(manager, manifest.id)) !== JSON.stringify(originalBinding)) throw new UpdateGuardError('changed', manager.translator.t('批量更新_清单变化'));
            bindingChanged = true;
            await applySourceBinding(manager, manifest.id, { unresolved: false, repo: options.source.kind === 'github' ? options.source.repo : undefined, receipt: {
                source: { ...options.source }, tag: options.tag, manifestVersion: manifest.version, publishedAt: options.publishedAt, isGithubLatest: options.isGithubLatest,
            } });
            const originalRecord = manager.settings.Plugins.find(item => item.id === manifest.id);
            registration = { record: originalRecord ? { ...originalRecord, tags: [...originalRecord.tags] } : undefined, bpmInstalled: manager.settings.BPM_INSTALLED.includes(manifest.id) };
            if (options.markAsBpm !== false && !manager.settings.BPM_INSTALLED.includes(manifest.id)) manager.settings.BPM_INSTALLED.push(manifest.id);
            const loaded = manager.appPlugins.manifests[manifest.id];
            const record = manager.settings.Plugins.find(item => item.id === manifest.id);
            const tags = manager.settings.BPM_INSTALLED.includes(manifest.id) ? [BPM_TAG_ID] : [];
            if (record) {
                record.name = loaded?.name || manifest.name || manifest.id;
                record.desc = loaded?.description || manifest.description || record.desc;
                if (!installed) record.enabled = manager.appPlugins.enabledPlugins.has(manifest.id);
                for (const tag of tags) if (!record.tags.includes(tag)) record.tags.push(tag);
                manager.applySpecialPluginTags(record);
            } else {
                const next = { id: manifest.id, name: loaded?.name || manifest.name || manifest.id, desc: loaded?.description || manifest.description || '', group: '', tags, enabled: manager.appPlugins.enabledPlugins.has(manifest.id), delay: '', note: '' };
                manager.applySpecialPluginTags(next);
                manager.settings.Plugins.push(next);
            }
            await manager.saveSettings();
        }, async () => {
            if (!lifecycleStarted) return;
            if (manager.appPlugins.plugins?.[manifest.id]) await manager.appPlugins.disablePlugin(manifest.id);
            await manager.appPlugins.loadManifests();
            if (registration) {
                const index = manager.settings.Plugins.findIndex(item => item.id === manifest.id);
                if (registration.record) {
                    if (index >= 0) Object.assign(manager.settings.Plugins[index], registration.record);
                    else manager.settings.Plugins.push(registration.record);
                } else if (index >= 0) manager.settings.Plugins.splice(index, 1);
                if (!registration.bpmInstalled) manager.settings.BPM_INSTALLED = manager.settings.BPM_INSTALLED.filter(id => id !== manifest.id);
            }
            if (bindingChanged) { await applySourceBinding(manager, manifest.id, originalBinding); await manager.saveSettings(); }
            if (installed && runningBeforeInstall) await manager.appPlugins.enablePlugin(manifest.id);
            else if (!installed && manager.appPlugins.enabledPlugins.has(manifest.id)) await manager.appPlugins.disablePluginAndSave(manifest.id);
        }, async () => {
            if (manager.appPlugins.plugins?.[manifest.id]) await manager.appPlugins.disablePlugin(manifest.id);
        }, ['data.json']);
    manager.applyRibbonSettings();
    if (!options.quiet) new Notice(manager.translator.t('安装_成功_提示', { name: manifest.name || manifest.id }));
}
