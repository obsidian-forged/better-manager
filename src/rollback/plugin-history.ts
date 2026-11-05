import { normalizePath, Platform, requireApiVersion } from 'obsidian';
import type Manager from '../main';
import { pluginStorage } from '../storage/plugin-storage';
import { replacePluginBuild, withPluginBuildLock, StoredBuildFiles } from '../storage/plugin-build';
import { parseInstallManifest } from '../catalog/install-manifest';
import { readInstalledRelease } from '../updates/update-policy';
import { record } from '../catalog/catalog';
import type { InstalledRelease } from '../updates/types';
import { mergeConfigStructure } from './config-merge';
import { applySourceBinding, captureSourceBinding, readSourceBinding, SourceBinding } from '../updates/source-binding';
import { releaseCapabilityAvailable } from '../features';

export interface BuildSnapshot {
    schema: 1; id: string; pluginId: string; version: string; label: string; createdAt: number; automatic: boolean;
    files: StoredBuildFiles; receipt?: InstalledRelease; binding: SourceBinding;
}
export interface RestorePlan {
    snapshot: BuildSnapshot; fingerprint: string; snapshotFingerprint: string; config?: string;
    removed: string[]; restored: string[]; bindingFingerprint: string; preservePaths: string[]; preservableObjects: string[];
}
const buildNames = ['manifest.json', 'main.js', 'styles.css', 'data.json'] as const;

/** Backups stay under BPM data/, never inside the target plugin's build directory. */
export class PluginHistory {
    private lastCreatedAt = 0;
    constructor(private readonly manager: Manager, readonly available = releaseCapabilityAvailable('rollback')) {}
    enabled(): boolean { return this.available && this.manager.settings.PLUGIN_ROLLBACK_ENABLED === true; }
    private assertId(id: string): void {
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id) || ['constructor', 'prototype', '__proto__', this.manager.manifest.id].includes(id)) throw new Error(this.manager.translator.t('回退_无效插件'));
    }
    private directory(id: string): string { this.assertId(id); return normalizePath(`${this.manager.app.vault.configDir}/plugins/${id}`); }
    private name(id: string, snapshotId: string): string {
        this.assertId(id);
        if (!/^[a-z0-9]+-[a-z0-9]+$/.test(snapshotId)) throw new Error('Invalid restore point ID');
        return `history/${id}/${snapshotId}.json`;
    }
    private assertEnabled(): void { if (!this.enabled()) throw new Error(this.manager.translator.t('回退_未开启')); }
    private async readBuild(id: string): Promise<StoredBuildFiles> {
        const directory = this.directory(id), adapter = this.manager.app.vault.adapter;
        const values = await Promise.all(buildNames.map(async name => await adapter.exists(`${directory}/${name}`) ? adapter.read(`${directory}/${name}`) : null));
        return { 'manifest.json': values[0], 'main.js': values[1], 'styles.css': values[2], 'data.json': values[3] };
    }
    private validate(value: unknown, id: string, snapshotId: string): BuildSnapshot {
        if (!record(value) || value.schema !== 1 || value.id !== snapshotId || value.pluginId !== id || typeof value.version !== 'string'
            || typeof value.label !== 'string' || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) || typeof value.automatic !== 'boolean' || !record(value.files)) throw new Error('Invalid restore point');
        const files = value.files;
        for (const name of buildNames) if (files[name] !== null && files[name] !== undefined && typeof files[name] !== 'string') throw new Error('Invalid restore point files');
        if (typeof files['manifest.json'] !== 'string' || typeof files['main.js'] !== 'string' || !files['main.js']) throw new Error('Restore point build is incomplete');
        const manifest = parseInstallManifest(JSON.parse(files['manifest.json']) as unknown, id);
        if (manifest.version !== value.version) throw new Error('Restore point version mismatch');
        const binding = readSourceBinding(value.binding, value.receipt);
        if (binding.receipt && (binding.receipt.manifestVersion !== value.version || binding.receipt.source.kind === 'catalog' && binding.receipt.source.pluginId !== id)) throw new Error('Restore point source does not match its build');
        return { schema: 1, id: snapshotId, pluginId: id, version: value.version, label: value.label, createdAt: value.createdAt, automatic: value.automatic,
            files: { 'manifest.json': files['manifest.json'], 'main.js': files['main.js'], 'styles.css': typeof files['styles.css'] === 'string' ? files['styles.css'] : null,
                'data.json': typeof files['data.json'] === 'string' ? files['data.json'] : null }, receipt: readInstalledRelease(value.receipt), binding };
    }
    async read(id: string, snapshotId: string): Promise<BuildSnapshot> {
        const text = await pluginStorage(this.manager).read('data', this.name(id, snapshotId));
        if (text === undefined) throw new Error(this.manager.translator.t('回退_不存在'));
        return this.validate(JSON.parse(text) as unknown, id, snapshotId);
    }
    async list(id: string): Promise<BuildSnapshot[]> {
        this.assertId(id);
        const store = pluginStorage(this.manager), directory = store.path('data', `history/${id}`), adapter = this.manager.app.vault.adapter;
        if (!(await adapter.exists(directory))) return [];
        const paths = await adapter.list(directory), snapshots: BuildSnapshot[] = [];
        for (const path of paths.files) {
            const name = path.slice(directory.length + 1);
            if (!/^[a-z0-9]+-[a-z0-9]+\.json$/.test(name)) continue;
            snapshots.push(await this.read(id, name.slice(0, -5)));
        }
        return snapshots.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    }
    /** Caller holds the build lock and has flushed the plugin's runtime configuration. */
    async captureBeforeInstall(id: string): Promise<void> {
        if (!this.enabled() || id === this.manager.manifest.id) return;
        if (!this.manager.appPlugins.manifests[id]) return;
        await this.capture(id, '', true);
    }
    private async capture(id: string, label: string, automatic: boolean, protectedSnapshot?: string): Promise<BuildSnapshot> {
        this.assertEnabled();
        const binding = captureSourceBinding(this.manager, id), bindingFingerprint = JSON.stringify(binding);
        const files = await this.readBuild(id);
        if (!files['manifest.json'] || !files['main.js']) throw new Error(this.manager.translator.t('回退_构建不完整'));
        const manifest = parseInstallManifest(JSON.parse(files['manifest.json']) as unknown, id);
        const createdAt = Math.max(Date.now(), this.lastCreatedAt + 1);
        this.lastCreatedAt = createdAt;
        const snapshotId = `${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
        const snapshot: BuildSnapshot = { schema: 1, id: snapshotId, pluginId: id, version: manifest.version, label: label.trim().slice(0, 100), createdAt, automatic, files,
            receipt: binding.receipt, binding: readSourceBinding(binding) };
        this.validate(snapshot, id, snapshotId);
        this.assertEnabled();
        if (JSON.stringify(await this.readBuild(id)) !== JSON.stringify(files)
            || JSON.stringify(captureSourceBinding(this.manager, id)) !== bindingFingerprint) throw new Error(this.manager.translator.t('回退_预览变化'));
        this.assertEnabled();
        const store = pluginStorage(this.manager), text = JSON.stringify(snapshot), name = this.name(id, snapshotId);
        await store.write('data', name, text);
        if (await store.read('data', name) !== text) throw new Error('Restore point write verification failed');
        const automaticPoints = (await this.list(id)).filter(point => point.automatic);
        const limit = this.manager.settings.PLUGIN_ROLLBACK_LIMIT;
        const retention = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 10;
        for (const point of automaticPoints.slice(retention)) if (point.id !== protectedSnapshot) await this.remove(id, point.id);
        return snapshot;
    }
    async create(id: string, label: string): Promise<BuildSnapshot> {
        this.assertEnabled();
        const directory = this.directory(id), registry = this.manager.appPlugins;
        return withPluginBuildLock(this.manager.app.vault.adapter, directory, async () => {
            const running = Boolean(registry.plugins?.[id]);
            const reload = async () => {
                if (running) {
                    await registry.enablePlugin(id);
                    if (!registry.plugins?.[id]) throw new Error('The plugin could not be reloaded after creating its restore point');
                }
            };
            let snapshot: BuildSnapshot;
            try { if (running) await registry.disablePlugin(id); snapshot = await this.capture(id, label, false); }
            catch (error) {
                const failure = error instanceof Error ? error : new Error('Restore point creation failed');
                try { await reload(); }
                catch (reloadError) { throw new Error(`${failure.message}; runtime restore failed: ${reloadError instanceof Error ? reloadError.message : 'unknown error'}`); }
                throw failure;
            }
            await reload();
            return snapshot;
        });
    }
    async rename(id: string, snapshotId: string, label: string): Promise<void> {
        if (!this.available) throw new Error(this.manager.translator.t('回退_未开启'));
        const snapshot = await this.read(id, snapshotId);
        snapshot.label = label.trim().slice(0, 100); snapshot.automatic = false;
        await pluginStorage(this.manager).write('data', this.name(id, snapshotId), JSON.stringify(snapshot));
    }
    async remove(id: string, snapshotId: string): Promise<void> {
        if (!this.available) throw new Error(this.manager.translator.t('回退_未开启'));
        await pluginStorage(this.manager).remove('data', this.name(id, snapshotId));
    }
    async prepare(id: string, snapshotId: string, mergeConfig = false, preservePaths: readonly string[] = []): Promise<RestorePlan> {
        this.assertEnabled();
        const snapshot = await this.read(id, snapshotId), current = await this.readBuild(id);
        const manifestText = snapshot.files['manifest.json'];
        if (!manifestText) throw new Error('Restore point manifest missing');
        const manifest = parseInstallManifest(JSON.parse(manifestText) as unknown, id);
        if (!requireApiVersion(manifest.minAppVersion) || Platform.isMobile && manifest.isDesktopOnly) throw new Error(this.manager.translator.t('回退_不兼容'));
        const plan: RestorePlan = { snapshot, fingerprint: JSON.stringify(current), snapshotFingerprint: JSON.stringify(snapshot), bindingFingerprint: JSON.stringify(captureSourceBinding(this.manager, id)), preservePaths: [...new Set(preservePaths)], preservableObjects: [], removed: [], restored: [] };
        if (mergeConfig) {
            if (!snapshot.files['data.json'] || !current['data.json']) throw new Error(this.manager.translator.t('回退_配置不可合并'));
            const result = mergeConfigStructure(JSON.parse(snapshot.files['data.json']) as unknown, JSON.parse(current['data.json']) as unknown, plan.preservePaths);
            plan.config = JSON.stringify(result.value, null, 2); plan.removed = result.removed; plan.restored = result.restored; plan.preservableObjects = result.preservableObjects;
        }
        return plan;
    }
    async restore(plan: RestorePlan, current: () => boolean = () => true): Promise<void> {
        const assertCurrent = () => {
            this.assertEnabled();
            if (!current()) throw new Error(this.manager.translator.t('通用_取消_文本'));
        };
        assertCurrent();
        const { pluginId: id, id: snapshotId } = plan.snapshot, directory = this.directory(id), registry = this.manager.appPlugins;
        const snapshot = await this.read(id, snapshotId);
        if (JSON.stringify(snapshot) !== plan.snapshotFingerprint) throw new Error(this.manager.translator.t('回退_预览变化'));
        const fresh = await this.prepare(id, snapshotId, plan.config !== undefined, plan.preservePaths);
        if (fresh.fingerprint !== plan.fingerprint || fresh.config !== plan.config || fresh.bindingFingerprint !== plan.bindingFingerprint) throw new Error(this.manager.translator.t('回退_预览变化'));
        const running = Boolean(registry.plugins?.[id]), binding = captureSourceBinding(this.manager, id);
        const files: StoredBuildFiles = { 'manifest.json': snapshot.files['manifest.json'], 'main.js': snapshot.files['main.js'], 'styles.css': snapshot.files['styles.css'] };
        if (plan.config !== undefined) files['data.json'] = plan.config;
        let stopped = false, lifecycleStarted = false, bindingChanged = false;
        await replacePluginBuild(this.manager.app.vault.adapter, directory, files, async () => {
            assertCurrent();
            if (JSON.stringify(captureSourceBinding(this.manager, id)) !== plan.bindingFingerprint || JSON.stringify(await this.readBuild(id)) !== plan.fingerprint) throw new Error(this.manager.translator.t('回退_预览变化'));
            if (Boolean(registry.plugins?.[id]) !== running) throw new Error(this.manager.translator.t('回退_预览变化'));
            lifecycleStarted = true;
            if (running) { await registry.disablePlugin(id); stopped = true; }
            if (JSON.stringify(await this.readBuild(id)) !== plan.fingerprint) throw new Error(this.manager.translator.t('回退_预览变化'));
            await this.capture(id, '', true, snapshotId);
            // Recovery-point storage is asynchronous too. Recheck the reviewed inputs
            // after it finishes, immediately before the transaction may replace files.
            if (JSON.stringify(await this.read(id, snapshotId)) !== plan.snapshotFingerprint
                || JSON.stringify(await this.readBuild(id)) !== plan.fingerprint
                || JSON.stringify(captureSourceBinding(this.manager, id)) !== plan.bindingFingerprint) throw new Error(this.manager.translator.t('回退_预览变化'));
            assertCurrent();
        }, async () => {
            assertCurrent();
            await registry.loadManifests();
            assertCurrent();
            if (running) { await registry.enablePlugin(id); if (!registry.plugins?.[id]) throw new Error('Restored plugin could not be loaded'); }
            assertCurrent();
            if (JSON.stringify(captureSourceBinding(this.manager, id)) !== plan.bindingFingerprint) throw new Error(this.manager.translator.t('回退_预览变化'));
            bindingChanged = true;
            await applySourceBinding(this.manager, id, snapshot.binding);
            await this.manager.saveSettings();
            assertCurrent();
        }, async () => {
            if (!lifecycleStarted || !stopped && running) return;
            if (registry.plugins?.[id]) await registry.disablePlugin(id);
            await registry.loadManifests();
            if (running) {
                await registry.enablePlugin(id);
                if (!registry.plugins?.[id]) throw new Error('The previous plugin could not be reloaded');
            }
            if (bindingChanged) { await applySourceBinding(this.manager, id, binding); await this.manager.saveSettings(); }
        }, async () => {
            if (registry.plugins?.[id]) await registry.disablePlugin(id);
        }, ['data.json']);
        delete this.manager.updateStatus[id];
        this.manager.applyRibbonSettings();
    }
}
