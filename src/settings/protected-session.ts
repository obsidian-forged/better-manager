import type Manager from '../main';
import { ConfigFiles, IncompleteConfigBundle, isManagedConfigFile } from './config-files';
import { ConfigConflictPaused, ConfigEditorReopened, ConfigProtection } from './config-protection';
import { ConfigRecord } from './config-revision';
import { settingsFingerprint } from './session-store';
import { ConfigConflictChoices, ConflictItem } from './conflict-choices';
import { ConflictSide } from './conflict-model';

const record = (value: unknown): value is ConfigRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
export function configRecord(value: object): ConfigRecord {
    const copy: unknown = JSON.parse(JSON.stringify(value));
    if (!record(copy)) throw new Error('Invalid configuration object');
    return copy;
}
type LocalStorageApp = { loadLocalStorage(key: string): unknown; saveLocalStorage(key: string, value: unknown): void; };

/** Adapts the revision protocol to existing Manager saves and plugin-local file storage. */
export class ProtectedConfigSession {
    readonly files: ConfigFiles;
    readonly protection: ConfigProtection;
    private serial: Promise<void> = Promise.resolve();
    private observed = '';
    private loaded = false;
    private closed = false;
    private retry?: number;
    private pendingBundle = false;
    private initializing = true;
    private userOperations = 0;
    private resolvedBaseline?: string;
    private selections?: ConfigConflictChoices;
    get usingCache(): boolean { return true; }
    get conflictChoices(): ConfigConflictChoices | undefined {
        const conflict = this.protection.conflict;
        if (!conflict) { this.selections = undefined; return; }
        if (this.selections?.id !== conflict.id) this.selections = new ConfigConflictChoices(conflict.id,
            this.normalized(conflict.local), this.normalized(conflict.incoming.value));
        return this.selections;
    }

    constructor(private readonly manager: Manager, owner: string,
        private readonly normalize: (value: unknown) => ConfigRecord, private readonly changed: () => void) {
        const hash = async (text: string): Promise<string> => {
            const bytes = new TextEncoder().encode(text);
            const digest = await window.crypto.subtle.digest('SHA-256', bytes);
            return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        };
        const storage = manager.app as unknown as LocalStorageApp;
        const key = `bpm-config-anchor-${owner}`;
        this.files = new ConfigFiles(manager.app.vault.adapter, manager.app.vault.configDir, manager.manifest.id, owner, hash,
            { read: () => storage.loadLocalStorage(key), write: value => storage.saveLocalStorage(key, value) });
        this.protection = new ConfigProtection({
            readShared: () => this.files.readShared(this.initializing), readHead: () => this.files.readHead(),
            writeHead: value => this.files.writeHead(value), readDraft: () => this.files.readDraft(),
            writeDraft: value => this.files.writeDraft(value), removeDraft: () => this.files.removeDraft(),
            preserveConflict: value => this.files.preserveConflict(value), readConflict: () => this.files.readConflict(),
            clearConflict: () => this.files.clearConflict(), claimRepair: key => this.files.claimRepair(key),
            writeShared: (value, files, closed) => this.files.writeShared(value, files, closed),
        }, owner, hash, changed);
    }

    private queue<T>(task: () => Promise<T>): Promise<T> {
        const result = this.serial.then(task);
        this.serial = result.then(() => undefined, () => undefined);
        return result;
    }
    private current(): ConfigRecord { return configRecord(this.manager.devices?.persistedSettings() ?? this.manager.settings); }
    normalized(value: ConfigRecord): ConfigRecord { return configRecord(this.normalize(value)); }
    private fingerprint(value: unknown): string {
        const payload = record(value) ? { ...value } : value;
        if (record(payload)) delete payload._bpmRevision;
        return settingsFingerprint(this.normalize(payload));
    }
    async load(): Promise<ConfigRecord> {
        await this.files.backupStartup();
        this.files.setInitialShared(await this.manager.loadData());
        await this.files.recoverPreparedCommit();
        let value: ConfigRecord | undefined;
        for (let attempt = 0; attempt < 5; attempt++) {
            try { value = await this.protection.load(); break; }
            catch (error) {
                if (!(error instanceof IncompleteConfigBundle) || attempt === 4) throw error;
                await new Promise<void>(resolve => window.setTimeout(resolve, 300));
            }
        }
        if (!value) throw new Error('The synced BPM configuration is incomplete');
        this.initializing = false;
        this.observed = this.fingerprint(this.protection.current.value);
        this.loaded = true;
        this.pendingBundle = this.files.hasPendingBundle;
        if (this.pendingBundle) this.scheduleBundleRetry();
        return value;
    }
    begin(): void { this.protection.begin(this.current()); }
    beginUserAction(): () => void {
        this.userOperations++;
        let ended = false;
        return () => { if (!ended) { ended = true; this.userOperations--; } };
    }
    hasExternalChange(value: object): boolean { return this.fingerprint(value) !== this.observed; }
    async activateCache(value: object): Promise<void> { await this.save(value); }
    async save(value: object, automatic = false): Promise<void> {
        const copy = configRecord(value);
        await this.queue(async () => {
            if (!automatic && this.resolvedBaseline && settingsFingerprint(copy) !== this.resolvedBaseline) {
                this.resolvedBaseline = undefined;
                await this.protection.cancelChoice(copy);
            }
            await this.protection.stage(copy, automatic);
        });
    }
    async external(_value: object, local: object): Promise<{ changed: boolean; apply?: ConfigRecord }> {
        return this.queue(async () => {
            try {
                const disk = await this.files.readShared();
                this.pendingBundle = false;
                const changed = this.fingerprint(disk.value) !== this.observed;
                this.observed = this.fingerprint(disk.value);
                const value = await this.protection.observe(disk, configRecord(local));
                return { changed, apply: !this.protection.hasOpenEditor && !this.protection.paused
                    && this.fingerprint(value) !== this.fingerprint(local) ? value : undefined };
            } catch (error) {
                if (!(error instanceof IncompleteConfigBundle)) throw error;
                this.pendingBundle = true;
                this.scheduleBundleRetry();
                return { changed: true };
            }
        });
    }
    private scheduleBundleRetry(): void {
        if (this.closed || this.retry !== undefined) return;
        this.retry = window.setTimeout(() => {
            this.retry = undefined;
            if (!this.closed && this.pendingBundle) this.manager.onExternalSettingsChange();
        }, 1500);
    }
    async finish(value: object, stillClosed: () => boolean): Promise<ConfigRecord | undefined> {
        return this.queue(async () => {
            if (this.pendingBundle) { this.scheduleBundleRetry(); return undefined; }
            const fileDigests = { ...this.protection.current.files,
                ...await this.files.fileDigests(this.protection.pendingFiles) };
            try {
                const merged = await this.protection.finish(configRecord(value), fileDigests, stillClosed);
                this.observed = this.fingerprint(this.protection.current.value);
                return merged;
            } catch (error) {
                if (error instanceof ConfigConflictPaused) { this.changed(); return undefined; }
                if (error instanceof ConfigEditorReopened) return undefined;
                if (error instanceof IncompleteConfigBundle) { this.pendingBundle = true; this.scheduleBundleRetry(); return undefined; }
                throw error;
            }
        });
    }
    async stageFile(path: string, text: string | null): Promise<boolean> {
        if (!this.loaded || !isManagedConfigFile(path)) return false;
        const userEdited = this.userOperations > 0;
        await this.queue(async () => {
            const existing = this.protection.stagedFile(path);
            const baseline = existing ? existing.value : (await this.files.filesFor(this.protection.current))[path] ?? null;
            if (baseline === text) return;
            this.protection.stageFile(path, text, userEdited);
            await this.protection.persistFileDraft();
        });
        return true;
    }
    async readFile(path: string): Promise<{ value: string | undefined } | undefined> {
        if (!this.loaded || !isManagedConfigFile(path)) return undefined;
        const staged = this.protection.stagedFile(path);
        if (staged) return { value: staged.value ?? undefined };
        const files = await this.files.filesFor(this.protection.current);
        return Object.prototype.hasOwnProperty.call(files, path) ? { value: files[path] ?? undefined } : undefined;
    }
    async choose(value: ConfigRecord, files: Record<string, string | null>): Promise<void> {
        await this.queue(async () => {
            this.resolvedBaseline = settingsFingerprint(this.current());
            this.protection.choose(value, files);
            await this.protection.stage(value);
        });
    }
    async prepareConflictChoices(): Promise<ConfigConflictChoices | undefined> {
        const conflict = this.protection.conflict, selections = this.conflictChoices;
        if (!conflict || !selections || selections.ready) return selections;
        const [baseFiles, incomingFiles] = await Promise.all([this.files.filesFor(conflict.base), this.files.filesFor(conflict.incoming)]);
        if (this.protection.conflict?.id !== selections.id) return this.prepareConflictChoices();
        selections.setFiles({ ...baseFiles, ...conflict.localFiles }, incomingFiles);
        return selections;
    }
    private async editConflictSelection(edit: (selections: ConfigConflictChoices) => void): Promise<void> {
        await this.queue(async () => {
            if (!this.protection.paused && this.protection.conflict) {
                this.resolvedBaseline = undefined;
                await this.protection.cancelChoice(this.current());
            }
            const selections = this.conflictChoices;
            if (!selections) throw new Error('The configuration conflict is no longer available');
            edit(selections);
            this.changed();
        });
    }
    async toggleConflictItem(item: ConflictItem): Promise<void> { await this.editConflictSelection(selections => selections.toggleItem(item)); }
    async toggleConflictList(ids: readonly string[], presetId?: string): Promise<void> {
        await this.editConflictSelection(selections => selections.toggleList(ids, presetId));
    }
    async selectConflictSection(id: string, side: ConflictSide): Promise<void> { await this.editConflictSelection(selections => selections.selectSection(id, side)); }
    async confirmConflictChoices(): Promise<void> {
        const selections = await this.prepareConflictChoices();
        if (!selections) throw new Error('The configuration conflict is no longer available');
        await this.queue(async () => {
            if (this.protection.conflict?.id !== selections.id) throw new Error('The incoming configuration changed; review the new version');
            const result = selections.result();
            this.resolvedBaseline = settingsFingerprint(this.current());
            this.protection.choose(result.value, result.files);
            await this.protection.stage(result.value);
        });
    }
    destroy(): void { this.closed = true; if (this.retry !== undefined) window.clearTimeout(this.retry); }
}
