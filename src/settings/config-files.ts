import { ConfigDraft, ConfigProtectionIO, ConfigConflict, ConfigEditorReopened, ConfigPublicationFiles } from './config-protection';
import { ConfigRecord, ConfigSnapshot, decodeConfig, DigestText, encodeConfig } from './config-revision';
import { settingsFingerprint } from './session-store';
import type { PrivateCacheWrites } from './private-cache-watch';
import { mergeDeviceHeartbeat, preserveDeviceHeartbeat } from './device-file-content';

export interface ConfigFileAdapter {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    write(path: string, text: string): Promise<void>;
    mkdir(path: string): Promise<void>;
    remove(path: string): Promise<void>;
    list(path: string): Promise<{ files: string[]; folders: string[] }>;
}
export interface ConfigAnchor { head?: string; conflict?: string; transaction?: string; transactionTarget?: string; transactionBase?: string; }
export interface ConfigLocalAnchor { read(): unknown; write(value: ConfigAnchor): void; }
interface StoredState { owner: string; config: ConfigRecord; files: Record<string, string | null>; }
const record = (value: unknown): value is ConfigRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = (value: unknown): value is string => typeof value === 'string' && /^(?:legacy-)?[a-f0-9]{64}$/.test(value);
export const isManagedConfigFile = (path: string): boolean => /^(?:data\/icons\.css|data\/devices\/[^/]+\.json)$/.test(path)
    && !path.includes('..') && !path.includes('\\');

export interface ConfigBundleIssue { path: string; kind: 'missing' | 'different' | 'unexpected'; }
export class IncompleteConfigBundle extends Error {
    constructor(readonly snapshot: ConfigSnapshot, readonly issues: ConfigBundleIssue[] = []) {
        super('BPM configuration files are missing or do not match the recorded revision');
    }
}
export class ConfigDiskChanged extends Error {
    constructor() { super('BPM configuration changed on disk before publication'); }
}

/** Private, content-addressed recovery files; public configuration paths retain their existing names. */
export class ConfigFiles implements ConfigProtectionIO {
    readonly root: string;
    readonly privateRoot: string;
    private anchor: ConfigAnchor = {};
    private observed?: ConfigSnapshot;
    private readonly states = new Map<string, StoredState>();
    private initialShared?: unknown;
    private incomplete = false;
    private cacheRecovered = false;
    get hasPendingBundle(): boolean { return this.incomplete; }
    get hasPendingTransaction(): boolean { return Boolean(this.anchor.transactionTarget && this.anchor.transactionBase); }
    get localCacheRebuilt(): boolean { return this.cacheRecovered; }
    needsPublication(): boolean { return this.hasPendingTransaction; }

    constructor(private readonly adapter: ConfigFileAdapter, readonly configDir: string, readonly pluginId: string,
        private readonly owner: string, private readonly hash: DigestText, private readonly local: ConfigLocalAnchor,
        private readonly privateWrites?: PrivateCacheWrites,
        private readonly sharedWrites?: Pick<PrivateCacheWrites, 'write' | 'remove'>) {
        if (!/^[a-z0-9-]{8,80}$/.test(owner)) throw new Error('Invalid configuration cache owner');
        if (!/^[a-zA-Z0-9_-]+$/.test(pluginId) || configDir.includes('..') || configDir.includes('\\') || configDir.startsWith('/')) throw new Error('Invalid plugin configuration directory');
        this.root = `${configDir}/plugins/${pluginId}`;
        this.privateRoot = `${this.root}/.bpm/${owner}`;
        const anchor = local.read();
        if (record(anchor)) this.anchor = { head: safeId(anchor.head) ? anchor.head : undefined,
            conflict: safeId(anchor.conflict) ? anchor.conflict : undefined,
            transaction: safeId(anchor.transaction) ? anchor.transaction : undefined,
            transactionTarget: safeId(anchor.transactionTarget) ? anchor.transactionTarget : undefined,
            transactionBase: safeId(anchor.transactionBase) ? anchor.transactionBase : undefined };
    }

    private async read(path: string): Promise<string | undefined> { return await this.adapter.exists(path) ? this.adapter.read(path) : undefined; }
    private async ensureParent(path: string): Promise<void> {
        const parts = path.split('/'); parts.pop(); let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (await this.adapter.exists(current)) continue;
            try { await this.adapter.mkdir(current); }
            catch (error) { if (!await this.adapter.exists(current)) throw error; }
        }
    }
    private async writeChanged(path: string, text: string, immutable = false, current?: () => boolean,
        guard?: () => Promise<void>): Promise<void> {
        const previous = await this.read(path);
        if (previous === text) return;
        if (immutable && previous !== undefined) {
            this.privateWrites?.altered(path);
            throw new Error('BPM recovery snapshot was modified externally');
        }
        await this.ensureParent(path);
        const write = async () => {
            if (current && !current()) throw new ConfigEditorReopened();
            await guard?.();
            if (current && !current()) throw new ConfigEditorReopened();
            await this.adapter.write(path, text);
        };
        const retainedWrite = () => this.privateWrites ? this.privateWrites.write(path, text, write) : write();
        if (this.sharedWrites) await this.sharedWrites.write(path, text, retainedWrite); else await retainedWrite();
        if (await this.adapter.read(path) !== text) {
            if (guard) throw new ConfigDiskChanged();
            this.privateWrites?.altered(path);
            throw new Error('BPM configuration write verification failed');
        }
    }
    private async privateJson(name: string, value: object, immutable = false): Promise<void> {
        const serializable: unknown = JSON.parse(JSON.stringify(value));
        await this.writeChanged(`${this.privateRoot}/${name}`, settingsFingerprint(serializable), immutable);
    }
    private saveAnchor(next: ConfigAnchor): void {
        if (settingsFingerprint(next) === settingsFingerprint(this.anchor)) return;
        this.local.write(next); this.anchor = next;
    }

    /** Run before migrations. Each distinct file is copied once; unchanged launches reuse identical blobs. */
    async backupStartup(): Promise<void> {
        const paths = new Set<string>([`${this.root}/data.json`]);
        for (const name of ['app.json', 'appearance.json', 'hotkeys.json', 'community-plugins.json', 'core-plugins.json', 'workspace.json', 'workspace-mobile.json']) paths.add(`${this.configDir}/${name}`);
        const walk = async (directory: string): Promise<void> => {
            if (!await this.adapter.exists(directory)) return;
            const entries = await this.adapter.list(directory);
            for (const path of entries.files) if (path.startsWith(`${directory}/`) && /\.(?:json|css|cache)$/.test(path)) paths.add(path);
            for (const path of entries.folders) if (path.startsWith(`${directory}/`) && path !== `${this.root}/data/history`) await walk(path);
        };
        await walk(`${this.root}/data`);
        if (await this.adapter.exists(this.root)) {
            for (const path of (await this.adapter.list(this.root)).files) if (path.startsWith(`${this.root}/`)
                && /(?:\/icons\.css|\/data-[^/]+\.cache)$/.test(path)) paths.add(path);
        }
        if (await this.adapter.exists(this.configDir)) for (const path of (await this.adapter.list(this.configDir)).files) {
            if (path.startsWith(`${this.configDir}/better-plugins-manager-device-`) && path.endsWith('.json')) paths.add(path);
        }
        const manifest: Record<string, string | null> = {};
        for (const path of [...paths].sort()) {
            const text = await this.read(path);
            const relative = path.slice(this.configDir.length + 1);
            if (text === undefined) { manifest[relative] = null; continue; }
            const digest = await this.hash(text);
            await this.writeChanged(`${this.privateRoot}/blobs/${digest}`, text, true);
            manifest[relative] = digest;
        }
        const id = await this.hash(settingsFingerprint(manifest));
        await this.privateJson(`startup/${id}.json`, { owner: this.owner, files: manifest }, true);
    }

    async readManaged(path: string): Promise<string | undefined> {
        if (!isManagedConfigFile(path)) throw new Error('Invalid managed BPM configuration path');
        return this.read(`${this.root}/${path}`);
    }
    private async managedPaths(): Promise<string[]> {
        const paths: string[] = [];
        if (await this.adapter.exists(`${this.root}/data/icons.css`)) paths.push('data/icons.css');
        const directory = `${this.root}/data/devices`;
        if (await this.adapter.exists(directory)) for (const path of (await this.adapter.list(directory)).files) {
            const relative = path.slice(this.root.length + 1);
            if (path.startsWith(`${directory}/`) && isManagedConfigFile(relative)) paths.push(relative);
        }
        return paths.sort();
    }
    async sharedPaths(): Promise<string[]> {
        return [`${this.root}/data.json`, `${this.root}/data/icons.css`,
            ...(await this.managedPaths()).map(path => `${this.root}/${path}`)];
    }
    async fileDigests(files: Record<string, string | null>): Promise<Record<string, string | null>> {
        const digests: Record<string, string | null> = {};
        for (const [path, text] of Object.entries(files)) {
            if (!isManagedConfigFile(path)) throw new Error('Invalid managed BPM configuration path');
            digests[path] = text === null ? null : await this.hash(text);
        }
        return digests;
    }
    private async snapshotFrom(raw: unknown, files: Record<string, string | null>): Promise<ConfigSnapshot> {
        const snapshot = await decodeConfig(raw, this.hash), digests = await this.fileDigests(files);
        if (snapshot.revision) {
            if (settingsFingerprint(snapshot.files) !== settingsFingerprint(digests)) {
                const issues: ConfigBundleIssue[] = [...new Set([...Object.keys(snapshot.files), ...Object.keys(digests)])]
                    .filter(path => snapshot.files[path] !== digests[path]).map(path => ({ path,
                        kind: digests[path] === null ? 'missing' : snapshot.files[path] === null ? 'unexpected' : 'different' }));
                throw new IncompleteConfigBundle(snapshot, issues);
            }
        } else {
            snapshot.files = digests;
            snapshot.id = `legacy-${await this.hash(settingsFingerprint({ digest: snapshot.digest, files: digests }))}`;
        }
        return snapshot;
    }
    private async heartbeatCompatibleState(snapshot: ConfigSnapshot, files: Record<string, string | null>): Promise<StoredState | undefined> {
        let state = this.states.get(snapshot.id);
        if (!state && await this.adapter.exists(`${this.privateRoot}/states/${snapshot.id}.json`)) state = (await this.readState(snapshot.id)).state;
        if (!state) return;
        for (const path of Object.keys(snapshot.files)) {
            const expected = state.files[path] ?? null, actual = files[path] ?? null;
            if (expected !== actual && preserveDeviceHeartbeat(path, expected, actual) === undefined) return;
        }
        // Never replace the immutable snapshot with drifted bytes under its original id.
        return state;
    }
    private async sharedMarker(raw: unknown): Promise<ConfigSnapshot> {
        try { return await decodeConfig(raw, this.hash); }
        catch (error) {
            if (!record(raw) || !Object.prototype.hasOwnProperty.call(raw, '_bpmRevision')) throw error;
            // Some sync tools merge JSON keys but leave the old marker. Preserve the exact input;
            // its ancestry is untrusted and may never be used to pick a winning version.
            const id = await this.hash(settingsFingerprint(raw));
            await this.privateJson(`unverified/${id}.json`, { owner: this.owner, config: raw }, true);
            const payload = { ...raw };
            delete payload._bpmRevision;
            return decodeConfig(payload, this.hash);
        }
    }
    async readShared(allowTrustedFallback = false): Promise<ConfigSnapshot> {
        const text = await this.read(`${this.root}/data.json`);
        let raw: unknown = text === undefined ? this.initialShared ?? {} : JSON.parse(text);
        const snapshot = await this.sharedMarker(raw);
        if (!snapshot.revision) raw = snapshot.value;
        const paths = snapshot.revision ? Object.keys(snapshot.files) : await this.managedPaths();
        const files: Record<string, string | null> = {};
        for (const path of paths) files[path] = await this.readManaged(path) ?? null;
        if (this.anchor.transactionTarget && this.anchor.transactionBase) {
            const { before, after, untracked } = await this.readPreparedTransaction();
            const originalMarker = snapshot.revision ? snapshot.id === before.snapshot.id : snapshot.digest === before.snapshot.digest;
            if (originalMarker) {
                let covered = true;
                for (const path of new Set([...Object.keys(before.state.files), ...Object.keys(after.state.files)])) {
                    const actual = await this.readManaged(path) ?? null;
                    const matches = (expected: string | null) => actual === expected || preserveDeviceHeartbeat(path, expected, actual) !== undefined;
                    if (!matches(before.state.files[path] ?? untracked[path] ?? null) && !matches(after.state.files[path] ?? null)) { covered = false; break; }
                }
                if (covered) {
                    // An interrupted local transaction is a private draft, including legacy commit markers.
                    this.observed = before.snapshot;
                    this.incomplete = false;
                    return before.snapshot;
                }
            }
        }
        let complete: ConfigSnapshot;
        let state: StoredState | undefined;
        try { complete = await this.snapshotFrom(raw, files); }
        catch (error) {
            if (!(error instanceof IncompleteConfigBundle)) throw error;
            state = await this.heartbeatCompatibleState(snapshot, files);
            if (state) complete = snapshot;
            else {
                this.incomplete = true;
                // 本机恢复缓存被删除后，缺失的关联文件无法再核对；按当前共享值重建，避免永远无法启动。
                // After the local cache is gone, missing auxiliary files cannot be verified; rebuild from the
                // shared values instead of refusing to start forever. Waiting files are still reported on Save.
                if (allowTrustedFallback && this.cacheRecovered && !this.anchor.head) {
                    complete = await this.snapshotFrom(snapshot.value, files);
                    // 修订标记引用的文件已无法核对；立即改写为可用的普通配置，否则之后每次保存都会因缺失文件失败。
                    // Rewrite the unusable revision immediately; otherwise every later Save would fail on the
                    // missing files. The value itself is preserved unchanged.
                    await this.writeChanged(`${this.root}/data.json`, JSON.stringify(encodeConfig(complete), null, 2), false);
                } else {
                    if (!allowTrustedFallback || !this.anchor.head) throw error;
                    const trusted = (await this.readState(this.anchor.head)).snapshot;
                    this.observed = trusted;
                    return trusted;
                }
            }
        }
        this.incomplete = false;
        this.observed = complete;
        this.states.set(complete.id, state ?? { owner: this.owner, config: encodeConfig(complete), files });
        return complete;
    }
    setInitialShared(value: unknown): void { this.initialShared = value; }
    async recoverPreparedCommit(): Promise<void> {
        if (!this.anchor.transactionTarget) return;
        const snapshot = await this.readShared(true);
        if (snapshot.id !== this.anchor.transactionTarget) return;
        await this.writeHead(snapshot);
        const conflict = await this.readConflict();
        if (conflict && snapshot.revision?.parents.includes(conflict.incoming.id)) await this.clearConflict();
    }

    /** 本机锚点可能比 .bpm 目录活得更久（用户删除或同步排除），指向不存在的文件会让插件无法启动。
     * Forget private references whose files are gone so a deleted recovery cache cannot block startup. */
    async repairMissingAnchor(): Promise<boolean> {
        const missing = async (path: string): Promise<boolean> => !(await this.adapter.exists(path));
        const anchor = { ...this.anchor };
        let repaired = false;
        if (anchor.head && await missing(`${this.privateRoot}/states/${anchor.head}.json`)) {
            anchor.head = undefined; repaired = true;
        }
        if (anchor.conflict && await missing(`${this.privateRoot}/conflicts/${anchor.conflict}.json`)) {
            anchor.conflict = undefined; repaired = true;
        }
        if (anchor.transaction && (await missing(`${this.privateRoot}/transactions/${anchor.transaction}.json`)
            || anchor.transactionBase !== undefined && await missing(`${this.privateRoot}/states/${anchor.transactionBase}.json`)
            || anchor.transactionTarget !== undefined && await missing(`${this.privateRoot}/states/${anchor.transactionTarget}.json`))) {
            anchor.transaction = undefined; anchor.transactionBase = undefined; anchor.transactionTarget = undefined; repaired = true;
        }
        if (repaired) { this.saveAnchor(anchor); this.cacheRecovered = true; }
        return repaired;
    }

    private async readState(id: string): Promise<{ snapshot: ConfigSnapshot; state: StoredState }> {
        const path = `${this.privateRoot}/states/${id}.json`, text = await this.read(path);
        if (text === undefined) {
            this.privateWrites?.altered(path);
            throw new Error('The trusted BPM configuration backup is missing');
        }
        let raw: unknown;
        try { raw = JSON.parse(text); }
        catch (error) { this.privateWrites?.altered(path); throw error; }
        if (!record(raw) || raw.owner !== this.owner || !record(raw.config) || !record(raw.files)) {
            this.privateWrites?.altered(path);
            throw new Error('Invalid BPM recovery snapshot');
        }
        const files: Record<string, string | null> = {};
        for (const [relative, value] of Object.entries(raw.files)) {
            if (!isManagedConfigFile(relative) || value !== null && typeof value !== 'string') {
                this.privateWrites?.altered(path);
                throw new Error('Invalid BPM recovery file');
            }
            files[relative] = value;
        }
        let snapshot: ConfigSnapshot;
        try { snapshot = await this.snapshotFrom(raw.config, files); }
        catch (error) { this.privateWrites?.altered(path); throw error; }
        if (snapshot.id !== id) {
            this.privateWrites?.altered(path);
            throw new Error('BPM recovery snapshot identity does not match the trusted anchor');
        }
        const state = { owner: this.owner, config: encodeConfig(snapshot), files };
        this.states.set(id, state);
        return { snapshot, state };
    }
    private async readPreparedTransaction(): Promise<{
        before: { snapshot: ConfigSnapshot; state: StoredState };
        after: { snapshot: ConfigSnapshot; state: StoredState };
        untracked: Record<string, string>;
    }> {
        const id = this.anchor.transaction, base = this.anchor.transactionBase, target = this.anchor.transactionTarget;
        if (!id || !base || !target) throw new Error('Invalid trusted BPM transaction anchor');
        const path = `${this.privateRoot}/transactions/${id}.json`;
        try {
            const text = await this.read(path);
            if (text === undefined) throw new Error('The trusted BPM transaction backup is missing');
            const raw: unknown = JSON.parse(text);
            if (!record(raw) || raw.owner !== this.owner || raw.before !== base || raw.after !== target
                || raw.untracked !== undefined && !record(raw.untracked)) throw new Error('Invalid BPM transaction backup');
            const untracked: Record<string, string> = {};
            if (record(raw.untracked)) for (const [relative, value] of Object.entries(raw.untracked)) {
                if (!isManagedConfigFile(relative) || typeof value !== 'string') throw new Error('Invalid BPM transaction before-image');
                untracked[relative] = value;
            }
            const body = { before: base, after: target, ...(raw.untracked !== undefined ? { untracked } : {}) };
            if (await this.hash(settingsFingerprint(body)) !== id) throw new Error('BPM transaction identity does not match the trusted anchor');
            const before = await this.readState(base), after = await this.readState(target);
            for (const relative of Object.keys(untracked)) {
                if (Object.prototype.hasOwnProperty.call(before.state.files, relative)
                    || !Object.prototype.hasOwnProperty.call(after.state.files, relative)) throw new Error('Invalid BPM transaction before-image membership');
            }
            return { before, after, untracked };
        } catch (error) { this.privateWrites?.altered(path); throw error; }
    }
    async readHead(): Promise<ConfigSnapshot | undefined> {
        return this.anchor.head ? (await this.readState(this.anchor.head)).snapshot : undefined;
    }
    async writeHead(snapshot: ConfigSnapshot): Promise<void> {
        const state = this.states.get(snapshot.id);
        if (!state) throw new Error('Configuration snapshot files are unavailable');
        await this.privateJson(`states/${snapshot.id}.json`, state, true);
        this.saveAnchor({ ...this.anchor, head: snapshot.id,
            ...(this.anchor.transactionTarget === snapshot.id ? { transaction: undefined, transactionTarget: undefined, transactionBase: undefined } : {}) });
    }
    async readDraft(): Promise<ConfigDraft | undefined> {
        const text = await this.read(`${this.privateRoot}/draft.json`);
        if (text === undefined) {
            for (const path of [`${this.root}/data/recovery/${this.owner}.cache`, `${this.root}/data-${this.owner}.cache`]) {
                const legacy = await this.read(path);
                if (legacy === undefined) continue;
                const cache: unknown = JSON.parse(legacy);
                if (!record(cache) || cache.version !== 1 || cache.owner !== this.owner || !record(cache.base) || !record(cache.value)) throw new Error('Invalid legacy BPM recovery cache');
                const shared = this.observed ?? await this.readShared();
                const base = await decodeConfig(cache.base, this.hash);
                const value = await decodeConfig(cache.value, this.hash);
                const sameBase = base.digest === shared.digest;
                const draft = { base: sameBase ? shared.id : base.id, value: value.value, files: {}, userEdited: value.digest !== base.digest };
                await this.writeDraft(draft);
                return draft;
            }
            return undefined;
        }
        const raw: unknown = JSON.parse(text);
        if (!record(raw) || raw.owner !== this.owner || !record(raw.value) || !record(raw.files)
            || !safeId(raw.base) || typeof raw.userEdited !== 'boolean') throw new Error('Invalid BPM recovery draft');
        const files: Record<string, string | null> = {};
        for (const [path, value] of Object.entries(raw.files)) {
            if (!isManagedConfigFile(path) || value !== null && typeof value !== 'string') throw new Error('Invalid BPM recovery draft file');
            files[path] = value;
        }
        return { base: raw.base, value: raw.value, userEdited: raw.userEdited, files };
    }
    async writeDraft(value: ConfigDraft): Promise<void> { await this.privateJson('draft.json', { owner: this.owner, ...value }); }
    async removeDraft(): Promise<void> {
        const path = `${this.privateRoot}/draft.json`;
        if (await this.adapter.exists(path)) {
            const remove = () => this.adapter.remove(path);
            if (this.privateWrites) await this.privateWrites.remove(path, remove); else await remove();
        }
        // The immutable startup copy already preserves these owned caches. Do not resurrect a consumed draft.
        for (const legacy of [`${this.root}/data/recovery/${this.owner}.cache`, `${this.root}/data-${this.owner}.cache`]) {
            if (await this.adapter.exists(legacy)) await this.adapter.remove(legacy);
        }
    }
    async preserveConflict(value: ConfigConflict): Promise<void> {
        const incoming = this.states.get(value.incoming.id);
        if (!incoming) throw new Error('Incoming conflict files are unavailable');
        await this.privateJson(`states/${value.incoming.id}.json`, incoming, true);
        await this.privateJson(`conflicts/${value.id}.json`, { owner: this.owner, ...value }, true);
        this.saveAnchor({ ...this.anchor, conflict: value.id });
    }

    async readConflict(): Promise<ConfigConflict | undefined> {
        if (!this.anchor.conflict) return undefined;
        const text = await this.read(`${this.privateRoot}/conflicts/${this.anchor.conflict}.json`);
        if (text === undefined) throw new Error('The preserved BPM conflict is missing');
        const raw: unknown = JSON.parse(text);
        if (!record(raw) || raw.owner !== this.owner || !safeId(raw.id) || !record(raw.local) || !record(raw.localFiles)
            || !record(raw.base) || !safeId(raw.base.id) || !record(raw.incoming) || !safeId(raw.incoming.id)
            || !['concurrent', 'stale-replayed'].includes(typeof raw.reason === 'string' ? raw.reason : '')) throw new Error('Invalid preserved BPM conflict');
        const base = (await this.readState(raw.base.id)).snapshot;
        const incoming = (await this.readState(raw.incoming.id)).snapshot;
        const localFiles: Record<string, string | null> = {};
        for (const [path, value] of Object.entries(raw.localFiles)) {
            if (!isManagedConfigFile(path) || value !== null && typeof value !== 'string') throw new Error('Invalid conflict configuration file');
            localFiles[path] = value;
        }
        const local = (await decodeConfig(raw.local, this.hash)).value;
        const expected = await this.hash(settingsFingerprint({ base: base.id, local, incoming: incoming.id, files: localFiles }));
        if (raw.id !== expected || raw.id !== this.anchor.conflict) throw new Error('BPM conflict identity mismatch');
        return { id: raw.id, reason: raw.reason === 'stale-replayed' ? 'stale-replayed' : 'concurrent', base, incoming, local, localFiles };
    }
    async clearConflict(): Promise<void> {
        if (!this.anchor.conflict) return;
        await this.privateJson(`resolved/${this.anchor.conflict}.json`, { owner: this.owner, head: this.anchor.head }, true);
        this.saveAnchor({ ...this.anchor, conflict: undefined });
    }
    async claimRepair(key: string): Promise<boolean> {
        const id = await this.hash(key), path = `${this.privateRoot}/repairs/${id}.json`;
        if (await this.adapter.exists(path)) return false;
        await this.privateJson(`repairs/${id}.json`, { owner: this.owner, key }, true);
        return true;
    }
    async filesFor(snapshot: ConfigSnapshot): Promise<Record<string, string | null>> {
        const state = this.states.get(snapshot.id) ?? (await this.readState(snapshot.id)).state;
        return { ...state.files };
    }
    async preparePublication(base: ConfigSnapshot, changes: Record<string, string | null>): Promise<ConfigPublicationFiles> {
        const files = { ...await this.filesFor(base), ...changes };
        for (const [path, text] of Object.entries(files)) {
            if (!path.startsWith('data/devices/')) continue;
            const actual = await this.readManaged(path) ?? null;
            const retained = mergeDeviceHeartbeat(path, text, actual);
            if (retained !== undefined) files[path] = retained;
        }
        return { files, digests: await this.fileDigests(files) };
    }

    private async assertMarker(expected: ConfigSnapshot): Promise<void> {
        const actual = await this.read(`${this.root}/data.json`);
        const raw: unknown = actual === undefined ? this.initialShared ?? {} : JSON.parse(actual);
        const marker = await this.sharedMarker(raw);
        if (marker.revision ? marker.id !== expected.id
            : expected.revision || settingsFingerprint(marker.value) !== settingsFingerprint(expected.value)) throw new ConfigDiskChanged();
    }
    private async assertFiles(files: Record<string, string | null>): Promise<void> {
        for (const [path, text] of Object.entries(files)) {
            if ((await this.readManaged(path) ?? null) !== text) throw new ConfigDiskChanged();
        }
    }
    private async writePublicFile(path: string, text: string | null, expected: string | null,
        marker: ConfigSnapshot, current: () => boolean): Promise<void> {
        const guard = async () => {
            await this.assertMarker(marker);
            if ((await this.readManaged(path) ?? null) !== expected) throw new ConfigDiskChanged();
        };
        if (!current()) throw new ConfigEditorReopened();
        await guard();
        if (expected === text) return;
        const target = `${this.root}/${path}`;
        if (text !== null) { await this.writeChanged(target, text, false, current, guard); return; }
        const remove = async () => {
            if (!current()) throw new ConfigEditorReopened();
            await guard();
            if (!current()) throw new ConfigEditorReopened();
            await this.adapter.remove(target);
        };
        if (this.sharedWrites) await this.sharedWrites.remove(target, remove); else await remove();
        if (await this.adapter.exists(target)) throw new ConfigDiskChanged();
    }

    /** Only an explicit Save may undo an interrupted local transaction. Retain the old anchor
     * until all before-images are restored, so another cancellation remains recoverable. */
    private async restorePreparedFiles(marker: ConfigSnapshot, current: () => boolean): Promise<void> {
        if (!this.anchor.transactionTarget || this.anchor.transactionBase !== marker.id) return;
        const { before, after, untracked } = await this.readPreparedTransaction();
        const restored: Record<string, string | null> = {};
        for (const path of new Set([...Object.keys(before.state.files), ...Object.keys(after.state.files)])) {
            const actual = await this.readManaged(path) ?? null;
            const original = before.state.files[path] ?? untracked[path] ?? null, prepared = after.state.files[path] ?? null;
            const matches = (expected: string | null) => actual === expected || preserveDeviceHeartbeat(path, expected, actual) !== undefined;
            if (!matches(original) && !matches(prepared)) throw new ConfigDiskChanged();
            const retained = mergeDeviceHeartbeat(path, original, actual) ?? original;
            await this.writePublicFile(path, retained, actual, marker, current);
            restored[path] = retained;
        }
        await this.assertMarker(marker);
        await this.assertFiles(restored);
        if (!current()) throw new ConfigEditorReopened();
        this.saveAnchor({ ...this.anchor, transaction: undefined, transactionTarget: undefined, transactionBase: undefined });
    }

    async writeShared(snapshot: ConfigSnapshot, changes: Record<string, string | null>, stillClosed: () => boolean): Promise<void> {
        const expected = this.observed;
        if (!expected) throw new ConfigDiskChanged();
        const current = await this.readShared();
        if (current.id !== expected.id) throw new ConfigDiskChanged();
        if (!stillClosed()) throw new ConfigEditorReopened();
        await this.restorePreparedFiles(current, stillClosed);
        let previous = this.states.get(snapshot.id);
        if (!previous && this.anchor.head === snapshot.id) previous = (await this.readState(snapshot.id)).state;
        const files = { ...(this.states.get(this.anchor.head ?? '')?.files ?? this.states.get(current.id)?.files ?? {}), ...changes };
        if (previous) Object.assign(files, previous.files);
        for (const path of Object.keys(files)) if (!(path in snapshot.files)) delete files[path];
        const verified = await this.snapshotFrom(encodeConfig(snapshot), files);
        if (verified.id !== snapshot.id) throw new Error('Configuration files do not match the prepared revision');
        const before = this.states.get(current.id);
        if (!before) throw new Error('The BPM transaction baseline is unavailable');
        const initialFiles: Record<string, string | null> = {};
        const untracked: Record<string, string> = {};
        for (const [path, text] of Object.entries(files)) {
            const actual = await this.readManaged(path) ?? null, original = before.files[path] ?? null;
            if (actual !== original && actual !== text && preserveDeviceHeartbeat(path, original, actual) === undefined) throw new ConfigDiskChanged();
            // Re-prepare a revision if a heartbeat advanced after its digests were calculated.
            // Publishing the old digest would strand devices without this private before-image.
            const retained = mergeDeviceHeartbeat(path, text, actual);
            if (retained !== undefined && retained !== text) throw new ConfigDiskChanged();
            initialFiles[path] = actual;
            // A file outside the old revision can predate this transaction. Its physical
            // before-image must not be confused with a file created by this Save.
            if (!Object.prototype.hasOwnProperty.call(before.files, path) && actual !== null) untracked[path] = actual;
        }
        await this.assertMarker(current);
        const state = { owner: this.owner, config: encodeConfig(snapshot), files };
        await this.privateJson(`states/${snapshot.id}.json`, state, true);
        this.states.set(snapshot.id, state);
        if (!stillClosed()) throw new ConfigEditorReopened();
        // An equivalent remote revision may be accepted without presenting a conflict. Its
        // exact bytes still form the transaction's before-image and must survive interruption.
        await this.privateJson(`states/${current.id}.json`, before, true);
        if (!stillClosed()) throw new ConfigEditorReopened();
        // Keep a prepared copy before touching any public file. The primary marker is written last.
        const prepared = { before: current.id, after: snapshot.id, ...(Object.keys(untracked).length ? { untracked } : {}) };
        const transaction = await this.hash(settingsFingerprint(prepared));
        await this.privateJson(`transactions/${transaction}.json`, { owner: this.owner, ...prepared }, true);
        this.saveAnchor({ ...this.anchor, transaction, transactionTarget: snapshot.id, transactionBase: current.id });
        for (const [path, text] of Object.entries(files)) {
            await this.writePublicFile(path, text, initialFiles[path] ?? null, current, stillClosed);
        }
        if (!stillClosed()) throw new ConfigEditorReopened();
        const guard = async () => { await this.assertMarker(current); await this.assertFiles(files); };
        // Both the marker and exact auxiliary bytes must still match at publication time.
        await guard();
        if (!stillClosed()) throw new ConfigEditorReopened();
        await this.writeChanged(`${this.root}/data.json`, JSON.stringify(encodeConfig(snapshot), null, 2), false, stillClosed, guard);
        const saved = await this.readShared();
        if (saved.id !== snapshot.id) throw new Error('BPM configuration publication verification failed');
    }
}
