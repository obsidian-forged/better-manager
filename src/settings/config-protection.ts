import { compareConfig, ConfigRecord, ConfigSnapshot, createConfigRevision, DigestText, sameConfigContent } from './config-revision';
import { settingsFingerprint } from './session-store';

export interface ConfigDraft {
    base: string;
    value: ConfigRecord;
    files: Record<string, string | null>;
    userEdited: boolean;
}
export interface ConfigConflict {
    id: string;
    reason: 'concurrent' | 'stale-replayed';
    base: ConfigSnapshot;
    local: ConfigRecord;
    incoming: ConfigSnapshot;
    localFiles: Record<string, string | null>;
}
export interface ConfigPublication {
    status: 'saved' | 'noop' | 'conflict' | 'cancelled' | 'saved-pending';
    value?: ConfigRecord;
}
type ConfigComparisonPurpose = 'conflict' | 'publication';
export interface ConfigPublicationFiles {
    files: Record<string, string | null>;
    digests: Record<string, string | null>;
}
export interface ConfigProtectionIO {
    readShared(): Promise<ConfigSnapshot>;
    readHead(): Promise<ConfigSnapshot | undefined>;
    writeHead(value: ConfigSnapshot): Promise<void>;
    readDraft(): Promise<ConfigDraft | undefined>;
    writeDraft(value: ConfigDraft): Promise<void>;
    removeDraft(): Promise<void>;
    preserveConflict(value: ConfigConflict): Promise<void>;
    readConflict?(): Promise<ConfigConflict | undefined>;
    clearConflict?(): Promise<void>;
    claimRepair?(key: string): Promise<boolean>;
    sameContent?(value: ConfigRecord, files: Record<string, string | null>, base: ConfigSnapshot, incoming: ConfigSnapshot,
        purpose: ConfigComparisonPurpose): Promise<boolean>;
    preparePublication?(base: ConfigSnapshot, files: Record<string, string | null>): Promise<ConfigPublicationFiles>;
    needsPublication?(): boolean;
    writeShared(value: ConfigSnapshot, files: Record<string, string | null>, stillClosed: () => boolean): Promise<void>;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const equal = (left: unknown, right: unknown): boolean => settingsFingerprint(left) === settingsFingerprint(right);
const record = (value: unknown): value is ConfigRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
function rebaseBackground(baseline: unknown, previous: unknown, next: unknown): unknown {
    if (equal(previous, next)) return baseline;
    if (equal(baseline, previous)) return next === undefined ? undefined : clone(next);
    if (!record(baseline) || !record(previous) || !record(next)) return baseline;
    const result = { ...baseline };
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
        const value = rebaseBackground(baseline[key], previous[key], next[key]);
        if (value === undefined) delete result[key];
        else Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
    }
    return result;
}

export class ConfigConflictPaused extends Error {
    constructor() { super('BPM configuration writes are paused until the conflict is resolved'); }
}
export class ConfigEditorReopened extends Error {
    constructor() { super('BPM editor reopened before the configuration commit'); }
}

/** Shared files change only through a save action, never directly from a file event. */
export class ConfigProtection {
    private head!: ConfigSnapshot;
    private draft?: ConfigDraft;
    private baseline?: ConfigRecord;
    private openingHead?: ConfigSnapshot;
    private incoming?: ConfigSnapshot;
    private conflictValue?: ConfigConflict;
    private resolution?: { value: ConfigRecord; files: Record<string, string | null> };
    private readonly stagedFiles: Record<string, string | null> = {};
    private lastDraft = '';
    private fileEdits = false;
    private readonly editedFiles = new Set<string>();
    private editing = false;
    private recoveredEdits = false;
    get conflict(): ConfigConflict | undefined { return this.conflictValue; }
    get paused(): boolean { return Boolean(this.conflictValue && !this.resolution); }
    get current(): ConfigSnapshot { return this.head; }
    get hasOpenEditor(): boolean { return this.editing; }
    get pendingFiles(): Record<string, string | null> { return clone(this.resolution?.files ?? this.stagedFiles); }
    get confirmedSelection(): { value: ConfigRecord; files: Record<string, string | null> } | undefined {
        return this.resolution ? clone(this.resolution) : undefined;
    }
    get hasPendingChanges(): boolean {
        return Boolean(this.resolution || this.conflictValue || this.draft?.userEdited || this.fileEdits);
    }

    constructor(private readonly io: ConfigProtectionIO, private readonly device: string, private readonly hash: DigestText,
        private readonly changed: () => void = () => {}) {}

    private async sameContent(value: ConfigRecord, files: Record<string, string | null>, base: ConfigSnapshot,
        incoming: ConfigSnapshot, purpose: ConfigComparisonPurpose = 'conflict'): Promise<boolean> {
        if (this.io.sameContent) return this.io.sameContent(value, files, base, incoming, purpose);
        const digests = { ...base.files };
        for (const [path, text] of Object.entries(files)) digests[path] = text === null ? null : await this.hash(text);
        const snapshot = await createConfigRevision(value, this.device, [base], digests, this.hash);
        return sameConfigContent(snapshot, incoming);
    }

    async load(): Promise<ConfigRecord> {
        const disk = await this.io.readShared();
        this.head = await this.io.readHead() ?? disk;
        this.baseline = clone(this.head.value);
        this.draft = await this.io.readDraft();
        this.conflictValue = await this.io.readConflict?.();
        // Old builds could preserve a raw-only conflict which the normalized editor cannot show.
        // Clear only its private marker; receiving a synced file never authorizes a shared write.
        if (this.conflictValue && await this.sameContent(this.conflictValue.local, this.conflictValue.localFiles,
            this.conflictValue.base, this.conflictValue.incoming)) {
            await this.io.clearConflict?.();
            this.conflictValue = undefined;
        }
        if (this.draft && !this.draft.userEdited && this.draft.base !== this.head.id) {
            await this.io.removeDraft(); this.draft = undefined;
        }
        if (this.draft && equal(this.draft.value, this.head.value)) {
            let committed = true;
            for (const [path, text] of Object.entries(this.draft.files)) {
                const digest = text === null ? null : await this.hash(text);
                if (digest !== this.head.files[path]) { committed = false; break; }
            }
            if (committed) { await this.io.removeDraft(); this.draft = undefined; }
        }
        if (this.draft) {
            Object.assign(this.stagedFiles, this.draft.files);
            if (this.draft.userEdited) for (const path of Object.keys(this.draft.files)) this.editedFiles.add(path);
            this.lastDraft = settingsFingerprint(this.draft);
            this.recoveredEdits = this.draft.userEdited;
        }
        const local = this.draft?.value ?? this.head.value;
        if (this.conflictValue) {
            if (this.draft?.userEdited && (!equal(local, this.conflictValue.local)
                || !equal(this.stagedFiles, this.conflictValue.localFiles))) {
                await this.pause(this.conflictValue.incoming, local, this.conflictValue.reason);
            } else this.changed();
            return clone(local);
        }
        // A shared file received while BPM was closed is checked at the next explicit Save.
        // Startup must not replace a local draft or manufacture a new conflict from that event.
        await this.io.writeHead(this.head);
        return clone(local);
    }

    begin(value: ConfigRecord): void {
        this.editing = true;
        if (!this.draft?.userEdited && !this.recoveredEdits) this.baseline = clone(value);
        this.openingHead = this.head;
    }
    end(): void {
        this.editing = false;
    }

    async stage(value: ConfigRecord, automatic = false): Promise<void> {
        if (this.resolution) value = this.resolution.value;
        if (automatic && !this.resolution && this.baseline) {
            const rebased = rebaseBackground(this.baseline, this.draft?.value ?? this.baseline, value);
            if (record(rebased)) this.baseline = rebased;
        }
        const baseline = this.baseline ?? this.head.value;
        let fileEdits = false;
        for (const path of this.editedFiles) {
            const text = this.stagedFile(path)?.value ?? null;
            if ((text === null ? null : await this.hash(text)) !== (this.head.files[path] ?? null)) { fileEdits = true; break; }
        }
        this.fileEdits = fileEdits;
        if (this.recoveredEdits && equal(value, this.head.value) && !fileEdits && !this.resolution) this.recoveredEdits = false;
        const userEdited = Boolean(this.recoveredEdits || !equal(value, baseline) || fileEdits);
        const draft = { base: this.openingHead?.id ?? this.head.id, value: clone(value), files: clone(this.resolution?.files ?? this.stagedFiles), userEdited };
        if (equal(value, this.head.value) && !Object.keys(this.stagedFiles).length && !this.draft) return;
        const fingerprint = settingsFingerprint(draft);
        if (fingerprint !== this.lastDraft) { await this.io.writeDraft(draft); this.lastDraft = fingerprint; this.changed(); }
        this.draft = draft;
        if (this.conflictValue && !this.resolution && (!equal(value, this.conflictValue.local)
            || !equal(this.stagedFiles, this.conflictValue.localFiles))) {
            await this.pause(this.conflictValue.incoming, value, this.conflictValue.reason);
        }
        if (userEdited && this.incoming && compareConfig(this.head, this.incoming) === 'descendant' && !this.conflictValue) {
            await this.pause(this.incoming, value, 'concurrent');
        }
    }

    stageFile(path: string, text: string | null, userEdited = false): void {
        if (this.stagedFile(path)?.value === text) return;
        this.stagedFiles[path] = text;
        if (this.resolution) this.resolution.files[path] = text;
        if (userEdited) { this.editedFiles.add(path); this.fileEdits = true; }
    }
    async persistFileDraft(): Promise<void> { await this.stage(this.draft?.value ?? this.baseline ?? this.head.value); }
    /** A failed private write must not leave a file edit available to a later Save. */
    async stageFileDraft(path: string, text: string | null, userEdited: boolean): Promise<void> {
        const previous = { files: clone(this.stagedFiles), edited: [...this.editedFiles], fileEdits: this.fileEdits,
            draft: this.draft && clone(this.draft), lastDraft: this.lastDraft, resolution: this.resolution && clone(this.resolution),
            conflict: this.conflictValue && clone(this.conflictValue), incoming: this.incoming, recovered: this.recoveredEdits };
        this.stageFile(path, text, userEdited);
        try { await this.persistFileDraft(); }
        catch (error) {
            for (const key of Object.keys(this.stagedFiles)) delete this.stagedFiles[key];
            Object.assign(this.stagedFiles, previous.files);
            this.editedFiles.clear(); for (const key of previous.edited) this.editedFiles.add(key);
            this.fileEdits = previous.fileEdits; this.draft = previous.draft; this.lastDraft = previous.lastDraft;
            this.resolution = previous.resolution; this.conflictValue = previous.conflict;
            this.incoming = previous.incoming; this.recoveredEdits = previous.recovered;
            try {
                if (previous.draft) await this.io.writeDraft(previous.draft); else await this.io.removeDraft();
                if (previous.conflict) await this.io.preserveConflict(previous.conflict); else await this.io.clearConflict?.();
            } catch (restoreError) {
                throw new AggregateError([error, restoreError], 'The configuration draft could not be saved or restored. Check available storage before saving again.');
            } finally { this.changed(); }
            throw error;
        }
    }
    stagedFile(path: string): { value: string | null } | undefined {
        if (this.resolution && Object.prototype.hasOwnProperty.call(this.resolution.files, path)) return { value: this.resolution.files[path] };
        return Object.prototype.hasOwnProperty.call(this.stagedFiles, path) ? { value: this.stagedFiles[path] } : undefined;
    }

    async observe(disk: ConfigSnapshot, local: ConfigRecord): Promise<ConfigRecord> {
        if (this.conflictValue) {
            if (compareConfig(this.conflictValue.incoming, disk) !== 'same' && compareConfig(this.head, disk) !== 'same') {
                await this.pause(disk, local, 'concurrent');
            }
            return clone(local);
        }
        const relation = compareConfig(this.head, disk);
        if (relation === 'same' || await this.sameContent(this.head.value, {}, this.head, disk)) return clone(local);
        if (relation === 'ancestor') { this.incoming = disk; return clone(local); }
        if (relation === 'descendant') {
            if (this.editing && this.baseline && !equal(local, this.baseline) || this.draft?.userEdited) {
                await this.pause(disk, local, 'concurrent');
                return clone(local);
            }
            if (this.editing || this.draft?.userEdited) { this.incoming = disk; return clone(local); }
            if (this.draft && !this.draft.userEdited) {
                await this.io.removeDraft(); this.draft = undefined; this.lastDraft = '';
                for (const key of Object.keys(this.stagedFiles)) delete this.stagedFiles[key];
            }
            this.head = disk;
            await this.io.writeHead(disk);
            return clone(disk.value);
        }
        await this.pause(disk, local, 'concurrent');
        return clone(local);
    }

    private async pause(incoming: ConfigSnapshot, local: ConfigRecord, reason: ConfigConflict['reason'],
        localFiles: Record<string, string | null> = this.stagedFiles): Promise<void> {
        if (await this.sameContent(local, localFiles, this.head, incoming)) {
            if (this.conflictValue) {
                await this.io.clearConflict?.();
                this.conflictValue = undefined;
                this.resolution = undefined;
                this.changed();
            }
            this.incoming = incoming;
            return;
        }
        const files = clone(localFiles);
        const id = await this.hash(settingsFingerprint({ base: this.head.id, local, incoming: incoming.id, files }));
        const conflict: ConfigConflict = { id, reason, base: clone(this.head), local: clone(local), incoming: clone(incoming), localFiles: files };
        await this.io.preserveConflict(conflict);
        for (const key of Object.keys(this.stagedFiles)) delete this.stagedFiles[key];
        Object.assign(this.stagedFiles, files);
        this.conflictValue = conflict;
        this.resolution = undefined;
        this.incoming = incoming;
        this.changed();
    }

    /** Choosing changes the private draft. Only the separate Save action publishes it. */
    choose(value: ConfigRecord, files: Record<string, string | null>): void {
        if (!this.conflictValue) throw new Error('No BPM configuration conflict to resolve');
        this.resolution = { value: clone(value), files: clone(files) };
        this.recoveredEdits = true;
        this.changed();
    }
    async cancelChoice(value: ConfigRecord): Promise<void> {
        if (this.conflictValue) await this.pause(this.conflictValue.incoming, value, this.conflictValue.reason);
    }

    async publish(value: ConfigRecord, fileDigests: Record<string, string | null>, current: () => boolean): Promise<ConfigPublication> {
        if (!current()) return { status: 'cancelled' };
        await this.stage(this.resolution?.value ?? value);
        if (!current()) return { status: 'cancelled' };
        // Always re-read before consulting an old pause/incomplete state: Save also retries a
        // previously incomplete sync and recognizes a result already published by another device.
        const disk = await this.io.readShared();
        if (!current()) return { status: 'cancelled' };
        const selected = clone(this.resolution?.value ?? value), files = this.pendingFiles;
        const sameEffective = await this.sameContent(selected, files, this.head, disk);
        if (sameEffective && !this.io.needsPublication?.() && await this.sameContent(selected, files, this.head, disk, 'publication')) {
            if (!current()) return { status: 'cancelled' };
            await this.io.writeHead(disk);
            return this.complete(disk, current, 'noop');
        }
        const relation = compareConfig(this.head, disk);
        const sameBase = relation === 'same' || await this.sameContent(this.head.value, {}, this.head, disk);
        if (!current()) return { status: 'cancelled' };
        if (this.conflictValue && !sameEffective) {
            const reviewed = compareConfig(this.conflictValue.incoming, disk) === 'same' || relation === 'same'
                || await this.sameContent(this.conflictValue.incoming.value, {}, this.conflictValue.incoming, disk);
            if (!current()) return { status: 'cancelled' };
            if (!reviewed) {
                await this.pause(disk, selected, 'concurrent', files);
                await this.stage(selected);
                return { status: 'conflict' };
            }
            if (!this.resolution) return { status: 'conflict' };
        } else if (!sameEffective && !sameBase && relation !== 'ancestor') {
            await this.pause(disk, selected, 'concurrent', files);
            return { status: 'conflict' };
        }
        const parents = this.conflictValue && (this.resolution || sameEffective) ? [this.head, this.conflictValue.incoming,
            ...(disk.id !== this.head.id && disk.id !== this.conflictValue.incoming.id ? [disk] : [])]
            : (sameBase || sameEffective) && disk.id !== this.head.id ? [this.head, disk] : [this.head];
        // Preserve newer heartbeat bytes only when a real Save is needed. A metadata-only
        // no-op above must not create a revision or touch any shared file.
        const prepared = await this.io.preparePublication?.(this.head, files);
        const next = await createConfigRevision(selected, this.device, parents, prepared?.digests ?? fileDigests, this.hash);
        // Re-saving an unchanged local version after an old sync replay restores its existing
        // revision. Repeated explicit clicks are authorized; there is no automatic repair loop.
        const target = !this.resolution && sameConfigContent(next, this.head) ? this.head : next;
        if (!current()) return { status: 'cancelled' };
        await this.io.writeShared(target, prepared?.files ?? files, current);
        await this.io.writeHead(target);
        return this.complete(target, current, 'saved');
    }

    /** 用户明确选择“不保存”时丢弃本机草稿，避免下次打开继续提示；Discard an explicit unsaved draft. */
    async discardDraft(retainFiles: Record<string, string | null> = {}): Promise<void> {
        let hasFileEdits = false;
        for (const [path, text] of Object.entries(retainFiles)) {
            if ((text === null ? null : await this.hash(text)) !== (this.head.files[path] ?? null)) { hasFileEdits = true; break; }
        }
        const retained = hasFileEdits ? { base: this.head.id, value: clone(this.head.value), files: clone(retainFiles), userEdited: true } : undefined;
        // Replace an existing draft in one write when a later action must survive. Deleting
        // it first would lose the new action if storage ran out during the following write.
        if (retained) await this.io.writeDraft(retained); else await this.io.removeDraft();
        await this.io.clearConflict?.();
        this.draft = retained;
        this.lastDraft = retained ? settingsFingerprint(retained) : '';
        this.fileEdits = hasFileEdits;
        this.recoveredEdits = false;
        this.editedFiles.clear();
        this.resolution = undefined;
        this.conflictValue = undefined;
        this.incoming = undefined;
        this.baseline = clone(this.head.value);
        this.openingHead = this.head;
        for (const key of Object.keys(this.stagedFiles)) delete this.stagedFiles[key];
        if (retained) {
            Object.assign(this.stagedFiles, retained.files);
            for (const path of Object.keys(retained.files)) this.editedFiles.add(path);
        }
        this.changed();
    }

    private async complete(snapshot: ConfigSnapshot, current: () => boolean, status: 'saved' | 'noop'): Promise<ConfigPublication> {
        this.head = snapshot;
        this.openingHead = snapshot;
        this.baseline = clone(snapshot.value);
        await this.io.clearConflict?.();
        // New UI edits can arrive while the marker is being written. The commit is real, but
        // its old payload must not replace that newer view or clear a subsequently queued draft.
        if (current()) {
            await this.io.removeDraft();
            this.draft = undefined;
            this.lastDraft = '';
        }
        this.fileEdits = false;
        this.editedFiles.clear();
        this.recoveredEdits = false;
        this.conflictValue = undefined;
        this.resolution = undefined;
        this.incoming = undefined;
        for (const key of Object.keys(this.stagedFiles)) delete this.stagedFiles[key];
        this.changed();
        return { status: current() ? status : 'saved-pending', value: clone(snapshot.value) };
    }
}
