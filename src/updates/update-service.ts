import type Manager from '../main';
import type { BetaSource } from '../data/types';
import { fetchReleaseVersions, installPluginFromGithub, ReleaseVersion, sanitizeRepo } from '../github-install';
import { getCatalogService } from '../catalog/obsidian-io';
import { catalogVersions, installCatalogRelease } from '../catalog/catalog-installer';
import { compareCatalogVersions } from '../catalog/catalog';
import { findReleaseByTag, releaseIsCompatible, releaseTagsMatch, sourceHasUpdate, syncSourceReleaseCheck } from '../source-release';
import { notificationsMuted, readInstalledRelease, readUpdateRule, sourceIdentity, updateBlockReason, UpdateGuardError, writeUpdateRule } from './update-policy';
import type { BatchUpdatePlan, BatchUpdateReport, BatchUpdateResult, InstallationSource, UpdateCheckOptions, UpdateReason, UpdateRule, UpdateStatus } from './types';

interface CheckContext { official?: Promise<Record<string, string>>; refreshes: Map<string, Promise<void>> }

/** 单一更新决策入口，界面、命令、启动任务与批量执行共用 / Shared decisions for UI, commands, startup and batch jobs. */
export class UpdateService {
    private batchRunning = false;
    private cancelRequested = false;
    private disposed = false;
    constructor(private readonly manager: Manager) {}

    reasonText(reason?: UpdateReason): string { return reason ? this.manager.translator.t(`更新规则_原因_${reason}`) : ''; }
    muted(id: string): boolean { return notificationsMuted(this.manager.settings.PLUGIN_UPDATE_RULES, id); }
    rule(id: string): UpdateRule { return readUpdateRule(this.manager.settings.PLUGIN_UPDATE_RULES, id); }
    blockReason(id: string, identity?: string, tag?: string): 'excluded' | 'skipped-version' | undefined { return updateBlockReason(this.manager.settings.PLUGIN_UPDATE_RULES, id, identity, tag); }

    async setRule(id: string, rule: UpdateRule): Promise<void> {
        const previous = this.manager.updateStatus[id];
        this.manager.settings.PLUGIN_UPDATE_RULES = writeUpdateRule(this.manager.settings.PLUGIN_UPDATE_RULES, id, rule);
        const blocked = this.blockReason(id, previous?.sourceIdentity, previous?.remoteVersion || undefined);
        if (previous && blocked) this.manager.updateStatus[id] = { ...previous, hasUpdate: false, reason: blocked, message: this.reasonText(blocked) };
        for (const source of this.manager.settings.BETA_SOURCES || []) if (source.type === 'plugin' && source.id === id) {
            source.updatePolicyReason = updateBlockReason(this.manager.settings.PLUGIN_UPDATE_RULES, id, sourceIdentity({ kind: 'github', repo: sanitizeRepo(source.repo) }), source.latestReleaseTag);
        }
        await this.manager.saveSettings();
        if (previous && !blocked && (previous.reason === 'excluded' || previous.reason === 'skipped-version')) await this.check(id);
        this.manager.managerModal?.refreshPluginCard(id, { allowReload: false });
    }

    async skip(id: string, identity: string, release: ReleaseVersion): Promise<void> {
        const rule = this.rule(id);
        const skipped = (rule.skipped || []).filter(item => !(item.source === identity && releaseTagsMatch(item.tag, release.version)));
        skipped.push({ source: identity, tag: release.version, manifestVersion: release.manifestVersion });
        await this.setRule(id, { ...rule, skipped });
    }

    assertAllowed(id: string, identity: string, tag: string): void {
        if (this.disposed) throw new UpdateGuardError('cancelled', this.reasonText('cancelled'));
        const reason = updateBlockReason(this.manager.settings.PLUGIN_UPDATE_RULES, id, identity, tag);
        if (reason) throw new UpdateGuardError(reason, this.reasonText(reason));
    }

    private tracked(id: string): BetaSource | undefined {
        const receipt = readInstalledRelease(this.manager.settings.PLUGIN_INSTALLATIONS?.[id]);
        if (receipt?.source.kind === 'catalog' || this.manager.settings.PLUGIN_SOURCE_UNBOUND?.includes(id)) return undefined;
        const repo = receipt?.source.kind === 'github' ? receipt.source.repo : this.manager.settings.REPO_MAP[id];
        return (this.manager.settings.BETA_SOURCES || []).find(source => source.type === 'plugin'
            && (repo ? sanitizeRepo(source.repo).toLowerCase() === sanitizeRepo(repo).toLowerCase() : source.id === id));
    }

    tracksInstallation(source: BetaSource): boolean {
        if (source.type !== 'plugin') return true;
        const receipt = readInstalledRelease(this.manager.settings.PLUGIN_INSTALLATIONS?.[source.id]);
        if (this.manager.settings.PLUGIN_SOURCE_UNBOUND?.includes(source.id) || receipt?.source.kind === 'catalog') return false;
        const repo = receipt?.source.kind === 'github' ? receipt.source.repo : this.manager.settings.REPO_MAP[source.id];
        return !repo || sanitizeRepo(repo).toLowerCase() === sanitizeRepo(source.repo).toLowerCase();
    }

    private stopped(status: UpdateStatus, reason: UpdateReason, error?: unknown): UpdateStatus {
        status.hasUpdate = false;
        status.reason = reason;
        status.message = reason === 'up-to-date' || reason === 'self' ? undefined : this.reasonText(reason);
        if (error !== undefined) status.error = error instanceof Error ? error.message : 'Unknown error';
        return status;
    }

    async checkAll(options: UpdateCheckOptions & { onProgress?: (id: string) => void; isCancelled?: () => boolean } = {}): Promise<Record<string, UpdateStatus>> {
        const context: CheckContext = { refreshes: new Map() };
        const result: Record<string, UpdateStatus> = {};
        this.manager.updateStatus = result;
        for (const manifest of Object.values(this.manager.appPlugins.manifests)) {
            if (manifest.id === this.manager.manifest.id) continue;
            if (this.disposed || options.isCancelled?.()) break;
            result[manifest.id] = await this.check(manifest.id, options, context);
            options.onProgress?.(manifest.id);
        }
        this.manager.updateStatus = result;
        return result;
    }

    async check(id: string, options: UpdateCheckOptions = {}, context: CheckContext = { refreshes: new Map() }): Promise<UpdateStatus> {
        const manifest = this.manager.appPlugins.manifests[id];
        const defaults = this.manager.getPluginUpdateCheckOptions();
        const globals = { updateCheckMode: options.updateCheckMode ?? defaults.updateCheckMode,
            compatibilityMode: options.compatibilityMode ?? defaults.compatibilityMode, updateDelayDays: options.updateDelayDays ?? defaults.updateDelayDays };
        const status: UpdateStatus = { source: 'unknown', localVersion: manifest?.version, checkedAt: Date.now(), checkMode: globals.updateCheckMode, updateDelayDays: globals.updateDelayDays };
        const finish = (value: UpdateStatus) => { this.manager.updateStatus[id] = value; return value; };
        if (!manifest) return finish(this.stopped(status, 'changed'));
        if (id === this.manager.manifest.id) return finish(this.stopped(status, 'self'));
        if (this.disposed) return finish(this.stopped(status, 'cancelled'));
        if (this.rule(id).excluded) {
            const receipt = readInstalledRelease(this.manager.settings.PLUGIN_INSTALLATIONS?.[id]);
            const repo = this.tracked(id)?.repo || this.manager.settings.REPO_MAP[id];
            status.sourceLabel = receipt?.source.kind === 'catalog' ? receipt.source.key : repo;
            return finish(this.stopped(status, 'excluded'));
        }
        try {
            if (this.manager.settings.PLUGIN_SOURCE_UNBOUND?.includes(id)) return finish(this.stopped(status, 'source-unavailable'));
            const stored = this.manager.settings.PLUGIN_INSTALLATIONS?.[id];
            const receipt = readInstalledRelease(stored);
            if (stored && !receipt) return finish(this.stopped(status, 'source-unavailable'));
            const tracked = receipt?.source.kind === 'catalog' ? undefined : this.tracked(id);
            let installationSource: InstallationSource;
            let versions: ReleaseVersion[];
            let label: string;
            if (receipt?.source.kind === 'catalog') {
                const binding = receipt.source;
                const service = getCatalogService(this.manager);
                await service.load();
                const source = service.getSources().find(source => source.id === binding.sourceId);
                if (!source || source.url !== binding.url) return finish(this.stopped(status, 'source-unavailable'));
                if (source.url && (options.force || Date.now() - source.fetchedAt > 300000)) {
                    let work = context.refreshes.get(source.id);
                    if (!work) { work = service.refresh(source.id); context.refreshes.set(source.id, work); }
                    await work;
                }
                const entry = service.entries().find(entry => entry.key === binding.key && entry.id === id);
                if (!entry) return finish(this.stopped(status, 'source-unavailable'));
                versions = await catalogVersions(this.manager, entry, options.force);
                installationSource = receipt.source;
                label = entry.source.name;
                status.source = 'catalog';
            } else {
                if (tracked && !tracked.enabled) { status.sourceLabel = tracked.repo; return finish(this.stopped(status, 'source-disabled')); }
                const repo = sanitizeRepo((receipt?.source.kind === 'github' ? receipt.source.repo : '') || tracked?.repo
                    || this.manager.settings.REPO_MAP[id] || await this.manager.repoResolver.resolveRepo(id) || '');
                if (!repo) return finish(this.stopped(status, 'unknown-source'));
                installationSource = { kind: 'github', repo };
                label = repo;
                status.repo = repo;
                if (!context.official) context.official = this.manager.fetchOfficialStats();
                const official = await context.official;
                status.source = official[id] && !tracked && !receipt ? 'official' : 'github';
                const statistics = status.source === 'official' && globals.updateDelayDays <= 0
                    && this.manager.settings.PLUGIN_UPDATE_OFFICIAL_SOURCE !== 'github';
                versions = statistics && typeof this.manager.fetchOfficialReleaseVersions === 'function'
                    ? await this.manager.fetchOfficialReleaseVersions(id, repo) : [];
                if (!versions.length) versions = await fetchReleaseVersions(this.manager, repo, { includeManifest: true, force: options.force,
                    preferFallback: status.source !== 'official' && this.manager.settings.PLUGIN_UPDATE_UNOFFICIAL_SOURCE === 'atom' });
            }
            status.installationSource = installationSource;
            status.sourceIdentity = sourceIdentity(installationSource);
            status.sourceLabel = label;
            status.versions = versions;
            const source: BetaSource = {
                id, type: 'plugin', repo: status.repo || status.sourceIdentity, enabled: true, autoUpdate: false,
                mode: tracked?.mode || 'latest', frozenVersion: tracked?.frozenVersion || (tracked?.mode === 'frozen' ? tracked.latestReleaseTag || tracked.latestVersion : undefined),
                includePrerelease: tracked?.includePrerelease || false,
                updateCheckMode: tracked?.updateCheckMode || globals.updateCheckMode,
                compatibilityMode: tracked?.compatibilityMode || globals.compatibilityMode,
                updateDelayDays: tracked?.updateDelayDays ?? globals.updateDelayDays,
                localVersion: manifest.version,
            };
            if (receipt && sourceIdentity(receipt.source) === status.sourceIdentity && receipt.manifestVersion === manifest.version) {
                Object.assign(source, { installedReleaseTag: receipt.tag, installedReleasePublishedAt: receipt.publishedAt, installedReleaseIsGithubLatest: receipt.isGithubLatest });
            } else if (tracked?.installedReleaseTag && tracked.localVersion === manifest.version) {
                Object.assign(source, { installedReleaseTag: tracked.installedReleaseTag, installedReleasePublishedAt: tracked.installedReleasePublishedAt, installedReleaseIsGithubLatest: tracked.installedReleaseIsGithubLatest });
            }
            const { target, installed: installedRelease } = syncSourceReleaseCheck(source, versions, manifest.version);
            if (tracked) Object.assign(tracked, source, { repo: tracked.repo, autoUpdate: tracked.autoUpdate, lastChecked: Date.now(), error: '' });
            if (!target) {
                const pinned = source.mode === 'frozen' ? versions.find(item => releaseTagsMatch(item.version, source.frozenVersion)) : undefined;
                const reason: UpdateReason = !versions.length || versions.every(item => item.compatibilityChecked === false) ? 'metadata-unavailable'
                    : source.mode === 'frozen' && !findReleaseByTag(versions, source.frozenVersion) ? 'metadata-unavailable'
                    : pinned && !releaseIsCompatible(pinned) ? 'incompatible'
                    : pinned?.prerelease && !source.includePrerelease ? 'prerelease'
                    : !source.includePrerelease && versions.every(item => item.prerelease) ? 'prerelease'
                    : versions.every(item => !releaseIsCompatible(item)) ? 'incompatible' : 'too-new';
                return finish(this.stopped(status, reason));
            }
            const release = versions.find(item => item.version === target.tag);
            if (!release) return finish(this.stopped(status, 'metadata-unavailable'));
            status.target = { ...release };
            status.remoteVersion = release.version;
            status.remotePublishedAt = release.publishedAt;
            if (!releaseIsCompatible(release)) return finish(this.stopped(status, release.compatibilityChecked === false ? 'metadata-unavailable' : 'incompatible'));
            if (release.compatibilityChecked !== true || !release.manifestVersion) return finish(this.stopped(status, 'metadata-unavailable'));
            const blocked = updateBlockReason(this.manager.settings.PLUGIN_UPDATE_RULES, id, status.sourceIdentity, release.version);
            if (tracked) tracked.updatePolicyReason = blocked;
            if (blocked) return finish(this.stopped(status, blocked));
            let needsUpdate = source.updateCheckMode === 'version'
                ? source.mode === 'frozen' ? release.manifestVersion !== manifest.version : compareCatalogVersions(release.manifestVersion, manifest.version) > 0
                : sourceHasUpdate(source);
            // 独立源可批量发布同一时间戳的版本，此时沿用源内发布顺序；Use catalog order to resolve equal publication times.
            if (!needsUpdate && installationSource.kind === 'catalog' && source.updateCheckMode !== 'version' && source.mode !== 'frozen'
                && target.publishedAt && installedRelease?.publishedAt && Date.parse(target.publishedAt) === Date.parse(installedRelease.publishedAt)
                && target.index !== undefined && installedRelease.index !== undefined && target.index < installedRelease.index) needsUpdate = true;
            if (!needsUpdate) return finish(this.stopped(status, 'up-to-date'));
            status.hasUpdate = true;
            status.fingerprint = JSON.stringify({ source: installationSource, version: manifest.version, release: { tag: release.version, version: release.manifestVersion,
                date: release.publishedAt, manifest: release.manifestUrl, main: release.mainUrl, styles: release.stylesUrl },
                policy: { mode: source.mode, frozen: source.frozenVersion, check: source.updateCheckMode, compatibility: source.compatibilityMode, age: source.updateDelayDays, prerelease: source.includePrerelease } });
            return finish(status);
        } catch (error) {
            if (this.manager.settings.DEBUG) console.error('[BPM] Update check failed', id, error);
            return finish(this.stopped(status, 'check-failed', error));
        }
    }

    async checkTracked(source: BetaSource): Promise<void> {
        if (source.type !== 'plugin') return;
        if (!this.tracksInstallation(source)) {
            source.updatePolicyReason = 'source-unavailable'; source.lastChecked = Date.now(); return;
        }
        const status = await this.check(source.id);
        source.updatePolicyReason = status.reason && status.reason !== 'up-to-date' ? status.reason : undefined;
        source.error = status.error || '';
        source.lastChecked = Date.now();
    }

    async install(id: string, status: UpdateStatus, quiet = false, expectedLocalVersion?: string): Promise<boolean> {
        if (!status.target || !status.installationSource || !status.sourceIdentity) throw new Error(this.reasonText(status.reason || 'metadata-unavailable'));
        const target = status.target, identity = status.sourceIdentity;
        const policy = () => {
            const source = this.tracked(id);
            return JSON.stringify({ globals: this.manager.getPluginUpdateCheckOptions(), binding: readInstalledRelease(this.manager.settings.PLUGIN_INSTALLATIONS?.[id])?.source,
                repo: this.manager.settings.REPO_MAP[id], unbound: this.manager.settings.PLUGIN_SOURCE_UNBOUND?.includes(id) === true,
                tracked: source ? { repo: source.repo, enabled: source.enabled, mode: source.mode, frozen: source.frozenVersion, prerelease: source.includePrerelease,
                    check: source.updateCheckMode, compatibility: source.compatibilityMode, age: source.updateDelayDays } : undefined });
        };
        const originalPolicy = policy();
        const guard = () => {
            this.assertAllowed(id, identity, target.version);
            if (policy() !== originalPolicy) throw new UpdateGuardError('changed', this.reasonText('changed'));
            if (expectedLocalVersion !== undefined && this.manager.appPlugins.manifests[id]?.version !== expectedLocalVersion) throw new UpdateGuardError('changed', this.reasonText('changed'));
        };
        guard();
        let error: unknown;
        const onError = (failure: unknown) => { error = failure; };
        if (status.installationSource.kind === 'github') {
            const ok = await installPluginFromGithub(this.manager, status.installationSource.repo, target.version, false, id,
                { quiet, guard, onError, expectedManifestVersion: target.manifestVersion, publishedAt: target.publishedAt, isGithubLatest: target.isGithubLatest });
            if (!ok && error && quiet) throw error;
            return ok;
        }
        const service = getCatalogService(this.manager);
        await service.load();
        const key = status.installationSource.key;
        const entry = service.entries().find(entry => entry.key === key && entry.id === id);
        const release = entry?.releases.find(release => release.version === target.version);
        if (!entry || !release || release.manifest !== target.manifestUrl || release.main !== target.mainUrl || release.styles !== target.stylesUrl) throw new Error(this.reasonText('changed'));
        const ok = await installCatalogRelease(this.manager, entry, release, { quiet, guard, onError, expectedManifestVersion: target.manifestVersion });
        if (!ok && error && quiet) throw error;
        return ok;
    }

    async prepare(): Promise<BatchUpdatePlan> {
        const statuses = await this.checkAll({ force: true });
        return { createdAt: Date.now(), rows: Object.values(this.manager.appPlugins.manifests).map(manifest => ({ pluginId: manifest.id, name: manifest.name,
            status: manifest.id === this.manager.manifest.id ? { source: 'unknown', localVersion: manifest.version, reason: 'self', hasUpdate: false }
                : statuses[manifest.id] || { source: 'unknown', localVersion: manifest.version, reason: 'changed', hasUpdate: false } })) };
    }

    cancel(): void { this.cancelRequested = true; }
    dispose(): void { this.disposed = true; this.cancelRequested = true; }

    async run(plan: BatchUpdatePlan, onResult?: (result: BatchUpdateResult, completed: number, total: number) => void): Promise<BatchUpdateReport> {
        if (this.batchRunning) throw new Error(this.manager.translator.t('批量更新_正在执行'));
        if (this.disposed) throw new UpdateGuardError('cancelled', this.reasonText('cancelled'));
        this.batchRunning = true;
        this.cancelRequested = false;
        const task = this.manager.tasks.start({ title: this.manager.translator.t('批量更新_标题'), progress: 0 });
        const results: BatchUpdateResult[] = [];
        let refreshError: string | undefined;
        try {
            const context: CheckContext = { refreshes: new Map() };
            for (const row of plan.rows) {
                let result: BatchUpdateResult;
                if (!row.status.hasUpdate) result = { row, outcome: 'skipped', reason: row.status.reason };
                else if (this.cancelRequested) result = { row, outcome: 'skipped', reason: 'cancelled' };
                else {
                    try {
                        const current = await this.check(row.pluginId, { force: true }, context);
                        if (!current.hasUpdate || current.fingerprint !== row.status.fingerprint) result = { row, outcome: 'skipped', reason: current.reason || 'changed', error: current.error };
                        else result = { row, outcome: await this.install(row.pluginId, current, true, row.status.localVersion) ? 'updated' : 'failed' };
                    } catch (error) { result = { row, outcome: error instanceof UpdateGuardError ? 'skipped' : 'failed', reason: error instanceof UpdateGuardError ? error.reason : undefined, error: error instanceof Error ? error.message : 'Unknown error' }; }
                }
                results.push(result);
                task.update({ progress: results.length / Math.max(1, plan.rows.length) * 0.9 });
                try { onResult?.(result, results.length, plan.rows.length); } catch (error) { if (this.manager.settings.DEBUG) console.error('[BPM] Batch progress view failed', error); }
            }
            // 整批结束只扫描一次；Never rescan all plugins after each installation.
            task.update({ title: this.manager.translator.t('批量更新_刷新结果'), progress: 0.95 });
            try { if (!this.disposed) await this.checkAll(); } catch (error) { refreshError = error instanceof Error ? error.message : 'Unknown error'; }
            if (results.some(result => result.outcome === 'failed')) task.fail(); else task.done();
            return { results, refreshError };
        } catch (error) { task.fail(); throw error; }
        finally { this.batchRunning = false; }
    }
}
