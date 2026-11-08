import type Manager from '../main';
import { Notice } from 'obsidian';
import { ConfigBundleIssue, ConfigDiskChanged, ConfigFiles, IncompleteConfigBundle, isManagedConfigFile } from './config-files';
import { ConfigEditorReopened, ConfigProtection, ConfigPublication } from './config-protection';
import { ConfigRecord } from './config-revision';
import { settingsFingerprint } from './session-store';
import { ConfigConflictChoices, ConflictItem } from './conflict-choices';
import { CONFIG_STATE_KEYS, configurationContent, configurationFileDifferences, ConflictSide } from './conflict-model';
import { PrivateCacheWatch } from './private-cache-watch';
import { SharedConfigWatch } from './shared-config-watch';
import { FileChangeAdapter, subscribeFileChanges } from '../storage/file-change-listener';
import { protectionText } from './protection-text';
import { LocalStateStore } from '../storage/local-state';
import { applySettingsEdit, copySettingsRecord as configRecord } from './save-request';
export { copySettingsRecord as configRecord } from './save-request';

const record = (value: unknown): value is ConfigRecord => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Adapts the revision protocol to existing Manager saves and plugin-local file storage. */
export class ProtectedConfigSession {
    readonly files: ConfigFiles;
    readonly protection: ConfigProtection;
    private serial: Promise<void> = Promise.resolve();
    private observed = '';
    private loaded = false;
    private closed = false;
    private pendingBundle = false;
    private initializing = true;
    private userOperations = 0;
    private editEpoch = 0;
    private readonly fileEditEpochs = new Map<string, number>();
    private resolvedBaseline?: ConfigRecord;
    private selections?: ConfigConflictChoices;
    private readonly privateCache: PrivateCacheWatch;
    private readonly sharedChanges: SharedConfigWatch;
    private stopPrivateWatch?: () => void;
    private privateWarningShown = false;
    private privateErrorShown = false;
    private sharedErrorShown = false;
    get privateCacheModified(): boolean { return this.privateCache.modified; }
    get usingCache(): boolean { return true; }
    get mutationEpoch(): number { return this.editEpoch; }
    get hasPendingUserAction(): boolean { return this.userOperations > 0; }
    get hasPendingChanges(): boolean { return this.protection.hasPendingChanges; }
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
        const storage = new LocalStateStore(manager);
        const key = `bpm-config-anchor-${owner}`;
        const adapter = manager.app.vault.adapter;
        this.privateCache = new PrivateCacheWatch(`${manager.app.vault.configDir}/plugins/${manager.manifest.id}/.bpm`, adapter, hash,
            () => this.privateCacheChanged(), error => this.privateCacheFailed(error));
        this.sharedChanges = new SharedConfigWatch(`${manager.app.vault.configDir}/plugins/${manager.manifest.id}`, adapter,
            () => manager.settings?.SYNC_CHANGE_WARNINGS !== false,
            path => new Notice(`${protectionText(manager, 'frequentExternalChanges')}\n${path.slice(this.files.root.length + 1)}`, 10_000),
            error => this.sharedChangesFailed(error));
        this.files = new ConfigFiles(manager.app.vault.adapter, manager.app.vault.configDir, manager.manifest.id, owner, hash,
            { read: () => storage.loadLocalStorage(key), write: value => storage.saveLocalStorage(key, value) }, this.privateCache, this.sharedChanges);
        this.protection = new ConfigProtection({
            readShared: () => this.files.readShared(this.initializing), readHead: () => this.files.readHead(),
            writeHead: value => this.files.writeHead(value), readDraft: () => this.files.readDraft(),
            writeDraft: value => this.files.writeDraft(value), removeDraft: () => this.files.removeDraft(),
            preserveConflict: value => this.files.preserveConflict(value), readConflict: () => this.files.readConflict(),
            clearConflict: () => this.files.clearConflict(), claimRepair: key => this.files.claimRepair(key),
            sameContent: async (value, files, base, incoming, purpose) => {
                const local = this.normalized(value), remote = this.normalized(incoming.value);
                if (purpose === 'publication') {
                    const original = this.normalized(base.value);
                    // Lifecycle acknowledgements are not user conflicts, but a local migration,
                    // language initialization or dismissed tour must still reach shared storage.
                    if (CONFIG_STATE_KEYS.some(key => settingsFingerprint(local[key]) !== settingsFingerprint(original[key])
                        && settingsFingerprint(local[key]) !== settingsFingerprint(remote[key]))) return false;
                }
                if (settingsFingerprint(configurationContent(local)) !== settingsFingerprint(configurationContent(remote))) return false;
                const [baseFiles, incomingFiles] = await Promise.all([this.files.filesFor(base), this.files.filesFor(incoming)]);
                const localFiles = { ...baseFiles, ...files };
                return [...new Set([...Object.keys(localFiles), ...Object.keys(incomingFiles)])]
                    .every(path => configurationFileDifferences(path, localFiles[path] ?? null, incomingFiles[path] ?? null).length === 0);
            },
            writeShared: (value, files, closed) => this.files.writeShared(value, files, closed),
            preparePublication: (base, files) => this.files.preparePublication(base, files),
            needsPublication: () => this.files.hasPendingTransaction,
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
        // Warning diagnostics add no new initialization requirement. Protection already has
        // its trusted snapshot; a transient re-read failure only disables this initial baseline.
        try { await this.sharedChanges.prime(await this.files.sharedPaths()); }
        catch (error) { this.sharedChangesFailed(error); }
        this.loaded = true;
        this.stopPrivateWatch = subscribeFileChanges(this.manager.app.vault.adapter as FileChangeAdapter,
            path => { this.privateCache.observe(path); this.sharedChanges.observe(path); }, error => this.privateCacheFailed(error));
        if (this.privateCacheModified) this.privateCacheChanged();
        this.pendingBundle = this.files.hasPendingBundle;
        return value;
    }
    private privateCacheChanged(): void {
        if (this.closed) return;
        this.changed();
        if (this.privateWarningShown) return;
        this.privateWarningShown = true;
        const path = `${this.files.root}/.bpm/`;
        new Notice(`${protectionText(this.manager, 'privateCacheChanged')}\n${path}`, 12_000);
    }
    private privateCacheFailed(error: unknown): void {
        if (this.manager.settings?.DEBUG) console.error('[BPM] Recovery folder observation failed', error);
        if (this.closed || this.privateErrorShown) return;
        this.privateErrorShown = true;
        new Notice(protectionText(this.manager, 'privateCacheError'), 10_000);
    }
    private sharedChangesFailed(error: unknown): void {
        if (this.manager.settings?.DEBUG) console.error('[BPM] Shared configuration observation failed', error);
        if (this.closed || this.sharedErrorShown) return;
        this.sharedErrorShown = true;
        new Notice(protectionText(this.manager, 'sharedChangesError'), 10_000);
    }
    observeSharedChange(): void { if (this.loaded && !this.closed) this.sharedChanges.observe(`${this.files.root}/data.json`); }
    begin(): void { this.protection.begin(this.current()); }
    end(): void { this.protection.end(); }
    noteUserMutation(): void { this.editEpoch++; }
    beginUserAction(): () => void {
        this.noteUserMutation();
        this.userOperations++;
        let ended = false;
        return () => { if (!ended) { ended = true; this.userOperations--; } };
    }
    hasExternalChange(value: object): boolean { return this.fingerprint(value) !== this.observed; }
    async activateCache(value: object): Promise<void> { await this.save(value); }
    async save(value: object, automatic = false): Promise<void> {
        const copy = configRecord(value);
        await this.queue(async () => {
            const selected = this.protection.confirmedSelection;
            if (!automatic && this.resolvedBaseline && selected
                && settingsFingerprint(copy) !== settingsFingerprint(this.resolvedBaseline)) {
                this.protection.choose(applySettingsEdit(this.resolvedBaseline, copy, selected.value), selected.files);
                this.resolvedBaseline = configRecord(copy);
            }
            await this.protection.stage(copy, automatic);
            this.changed();
        });
    }
    async publish(value: object, current: () => boolean): Promise<ConfigPublication | { status: 'incomplete'; issues: ConfigBundleIssue[] }> {
        const copy = configRecord(value);
        return this.queue(async () => {
            const fileDigests = { ...this.protection.current.files,
                ...await this.files.fileDigests(this.protection.pendingFiles) };
            try {
                let result: ConfigPublication;
                try { result = await this.protection.publish(copy, fileDigests, current); }
                catch (error) {
                    // A foreign writer may win the final marker comparison. Refresh that exact
                    // state once within this explicit action so the user can review the conflict.
                    if (!(error instanceof ConfigDiskChanged)) throw error;
                    result = await this.protection.publish(copy, fileDigests, current);
                }
                this.pendingBundle = false;
                if (result.status === 'saved' || result.status === 'noop' || result.status === 'saved-pending') this.resolvedBaseline = undefined;
                this.observed = this.fingerprint(this.protection.current.value);
                this.changed();
                return result;
            } catch (error) {
                if (error instanceof ConfigEditorReopened) return { status: 'cancelled' };
                if (error instanceof IncompleteConfigBundle) { this.pendingBundle = true; this.changed(); return { status: 'incomplete', issues: error.issues }; }
                throw error;
            }
        });
    }
    async stageFile(path: string, text: string | null): Promise<boolean> {
        if (!this.loaded || !isManagedConfigFile(path)) return false;
        const userEdited = this.userOperations > 0;
        if (userEdited) this.noteUserMutation();
        const epoch = this.editEpoch;
        await this.queue(async () => {
            const existing = this.protection.stagedFile(path);
            const baseline = existing ? existing.value : (await this.files.filesFor(this.protection.current))[path] ?? null;
            if (baseline === text) return;
            await this.protection.stageFileDraft(path, text, userEdited);
            if (userEdited) this.fileEditEpochs.set(path, epoch);
            this.changed();
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
        this.noteUserMutation();
        await this.queue(async () => {
            this.resolvedBaseline = this.current();
            this.protection.choose(value, files);
            await this.protection.stage(value);
        });
    }
    /** 放弃本机草稿；Discard the local draft without publishing. */
    async discardDraft(cutoff = this.editEpoch): Promise<ConfigRecord> {
        this.noteUserMutation();
        return this.queue(async () => {
            // Main settings and auxiliary files have separate queues. A later successful
            // file edit belongs to a new action, even if this discard waited in the main queue.
            const retained = Object.entries(this.protection.pendingFiles)
                .filter(([path]) => (this.fileEditEpochs.get(path) ?? -1) > cutoff);
            await this.protection.discardDraft(Object.fromEntries(retained));
            for (const [path, epoch] of this.fileEditEpochs) if (epoch <= cutoff) this.fileEditEpochs.delete(path);
            this.resolvedBaseline = undefined;
            this.selections = undefined;
            this.changed();
            return this.normalized(this.protection.current.value);
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
        this.noteUserMutation();
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
    async confirmConflictChoices(expectedId?: string): Promise<void> {
        this.noteUserMutation();
        const selections = await this.prepareConflictChoices();
        if (!selections) throw new Error('The configuration conflict is no longer available');
        await this.confirmPreparedConflictChoices(selections, expectedId ?? selections.id);
    }
    async confirmAllConflictChoices(side: ConflictSide, expectedId: string): Promise<void> {
        this.noteUserMutation();
        const selections = await this.prepareConflictChoices();
        if (!selections) throw new Error('The configuration conflict is no longer available');
        await this.confirmPreparedConflictChoices(selections, expectedId, side);
    }
    private async confirmPreparedConflictChoices(selections: ConfigConflictChoices, expectedId: string, allSide?: ConflictSide): Promise<void> {
        await this.queue(async () => {
            if (this.protection.conflict?.id !== expectedId || selections.id !== expectedId) throw new Error('The incoming configuration changed; review the new version');
            if (allSide) selections.selectAll(allSide);
            const result = selections.result();
            this.resolvedBaseline = this.current();
            this.protection.choose(result.value, result.files);
            await this.protection.stage(result.value);
        });
    }
    destroy(): void {
        this.closed = true;
        this.stopPrivateWatch?.(); this.stopPrivateWatch = undefined;
        this.privateCache.destroy();
        this.sharedChanges.destroy();
        this.fileEditEpochs.clear();
    }
}
