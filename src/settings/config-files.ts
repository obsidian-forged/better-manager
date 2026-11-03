import { ConfigDraft, ConfigProtectionIO, ConfigConflict, ConfigEditorReopened } from './config-protection';
import { ConfigRecord, ConfigSnapshot, decodeConfig, DigestText, encodeConfig } from './config-revision';
import { settingsFingerprint } from './session-store';

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

export class IncompleteConfigBundle extends Error {
    constructor(readonly snapshot: ConfigSnapshot) { super('Synced BPM configuration files have not all arrived'); }
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
    get hasPendingBundle(): boolean { return this.incomplete; }

    constructor(private readonly adapter: ConfigFileAdapter, readonly configDir: string, readonly pluginId: string,
        private readonly owner: string, private readonly hash: DigestText, private readonly local: ConfigLocalAnchor) {
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
    private async writeChanged(path: string, text: string, immutable = false): Promise<void> {
        const previous = await this.read(path);
        if (previous === text) return;
        if (immutable && previous !== undefined) throw new Error('BPM recovery snapshot was modified externally');
        await this.ensureParent(path);
        await this.adapter.write(path, text);
        if (await this.adapter.read(path) !== text) throw new Error('BPM configuration write verification failed');
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
            if (settingsFingerprint(snapshot.files) !== settingsFingerprint(digests)) throw new IncompleteConfigBundle(snapshot);
        } else {
            snapshot.files = digests;
            snapshot.id = `legacy-${await this.hash(settingsFingerprint({ digest: snapshot.digest, files: digests }))}`;
        }
        return snapshot;
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
            const before = await this.readState(this.anchor.transactionBase), after = await this.readState(this.anchor.transactionTarget);
            const originalMarker = snapshot.revision ? snapshot.id === before.snapshot.id : snapshot.digest === before.snapshot.digest;
            if (originalMarker) {
                let covered = true;
                for (const path of new Set([...Object.keys(before.state.files), ...Object.keys(after.state.files)])) {
                    const actual = await this.readManaged(path) ?? null;
                    if (actual !== (before.state.files[path] ?? null) && actual !== (after.state.files[path] ?? null)) { covered = false; break; }
                }
                if (covered) {
                    // An interrupted local transaction is a private draft, including legacy commit markers.
                    this.observed = before.snapshot;
                    return before.snapshot;
                }
            }
        }
        let complete: ConfigSnapshot;
        try { complete = await this.snapshotFrom(raw, files); }
        catch (error) {
            if (!(error instanceof IncompleteConfigBundle)) throw error;
            this.incomplete = true;
            if (!allowTrustedFallback || !this.anchor.head) throw error;
            const trusted = (await this.readState(this.anchor.head)).snapshot;
            this.observed = trusted;
            return trusted;
        }
        this.incomplete = false;
        this.observed = complete;
        this.states.set(complete.id, { owner: this.owner, config: encodeConfig(complete), files });
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

    private async readState(id: string): Promise<{ snapshot: ConfigSnapshot; state: StoredState }> {
        const text = await this.read(`${this.privateRoot}/states/${id}.json`);
        if (text === undefined) throw new Error('The trusted BPM configuration backup is missing');
        const raw: unknown = JSON.parse(text);
        if (!record(raw) || raw.owner !== this.owner || !record(raw.config) || !record(raw.files)) throw new Error('Invalid BPM recovery snapshot');
        const files: Record<string, string | null> = {};
        for (const [path, value] of Object.entries(raw.files)) {
            if (!isManagedConfigFile(path) || value !== null && typeof value !== 'string') throw new Error('Invalid BPM recovery file');
            files[path] = value;
        }
        const snapshot = await this.snapshotFrom(raw.config, files);
        if (snapshot.id !== id) throw new Error('BPM recovery snapshot identity does not match the trusted anchor');
        const state = { owner: this.owner, config: encodeConfig(snapshot), files };
        this.states.set(id, state);
        return { snapshot, state };
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
        if (await this.adapter.exists(path)) await this.adapter.remove(path);
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

    async writeShared(snapshot: ConfigSnapshot, changes: Record<string, string | null>, stillClosed: () => boolean): Promise<void> {
        const expected = this.observed;
        if (!expected) throw new ConfigDiskChanged();
        const current = await this.readShared();
        if (current.id !== expected.id) throw new ConfigDiskChanged();
        if (!stillClosed()) throw new ConfigEditorReopened();
        let previous = this.states.get(snapshot.id);
        if (!previous && this.anchor.head === snapshot.id) previous = (await this.readState(snapshot.id)).state;
        const files = { ...(this.states.get(this.anchor.head ?? '')?.files ?? this.states.get(current.id)?.files ?? {}), ...changes };
        if (previous) Object.assign(files, previous.files);
        for (const path of Object.keys(files)) if (!(path in snapshot.files)) delete files[path];
        const verified = await this.snapshotFrom(encodeConfig(snapshot), files);
        if (verified.id !== snapshot.id) throw new Error('Configuration files do not match the prepared revision');
        const state = { owner: this.owner, config: encodeConfig(snapshot), files };
        await this.privateJson(`states/${snapshot.id}.json`, state, true);
        this.states.set(snapshot.id, state);
        if (!stillClosed()) throw new ConfigEditorReopened();
        // Keep a prepared copy before touching any public file. The primary marker is written last.
        const transaction = await this.hash(settingsFingerprint({ before: current.id, after: snapshot.id }));
        await this.privateJson(`transactions/${transaction}.json`, { owner: this.owner, before: current.id, after: snapshot.id }, true);
        this.saveAnchor({ ...this.anchor, transaction, transactionTarget: snapshot.id, transactionBase: current.id });
        for (const [path, text] of Object.entries(files)) {
            if (!stillClosed()) throw new ConfigEditorReopened();
            const target = `${this.root}/${path}`;
            if (text === null) { if (await this.adapter.exists(target)) await this.adapter.remove(target); }
            else await this.writeChanged(target, text);
        }
        if (!stillClosed()) throw new ConfigEditorReopened();
        // Recheck the commit marker after auxiliary writes; foreign writers do not participate in this queue.
        const actual = await this.read(`${this.root}/data.json`);
        const raw: unknown = actual === undefined ? this.initialShared ?? {} : JSON.parse(actual);
        const marker = await this.sharedMarker(raw);
        if (marker.revision ? marker.id !== current.id : settingsFingerprint(marker.value) !== settingsFingerprint(current.value)) throw new ConfigDiskChanged();
        await this.writeChanged(`${this.root}/data.json`, JSON.stringify(encodeConfig(snapshot), null, 2));
        const saved = await this.readShared();
        if (saved.id !== snapshot.id) throw new Error('BPM configuration publication verification failed');
    }
}
