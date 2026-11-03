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

/** One commit boundary for the final closed editor, with immutable parents and bounded repairs. */
export class ConfigProtection {
    private head!: ConfigSnapshot;
    private draft?: ConfigDraft;
    private baseline?: ConfigRecord;
    private openingHead?: ConfigSnapshot;
    private incoming?: ConfigSnapshot;
    private conflictValue?: ConfigConflict;
    private resolution?: { value: ConfigRecord; files: Record<string, string | null> };
    private readonly repaired = new Set<string>();
    private readonly stagedFiles: Record<string, string | null> = {};
    private lastDraft = '';
    private fileEdits = false;
    private editing = false;
    private recoveredEdits = false;
    private session = 0;
    get conflict(): ConfigConflict | undefined { return this.conflictValue; }
    get paused(): boolean { return Boolean(this.conflictValue && !this.resolution); }
    get current(): ConfigSnapshot { return this.head; }
    get hasOpenEditor(): boolean { return this.editing; }
    get pendingFiles(): Record<string, string | null> { return clone(this.resolution?.files ?? this.stagedFiles); }

    constructor(private readonly io: ConfigProtectionIO, private readonly device: string, private readonly hash: DigestText,
        private readonly changed: () => void = () => {}) {}

    async load(): Promise<ConfigRecord> {
        const disk = await this.io.readShared();
        this.head = await this.io.readHead() ?? disk;
        this.draft = await this.io.readDraft();
        this.conflictValue = await this.io.readConflict?.();
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
            this.lastDraft = settingsFingerprint(this.draft);
            this.recoveredEdits = this.draft.userEdited;
        }
        const local = this.draft?.value ?? this.head.value;
        if (this.conflictValue) { this.changed(); return clone(local); }
        if (this.draft?.userEdited && this.draft.base !== this.head.id) {
            await this.pause(disk, local, 'concurrent');
            return clone(local);
        }
        const result = await this.observe(disk, local);
        if (!this.conflictValue && !this.incoming) await this.io.writeHead(this.head);
        return clone(this.draft?.value ?? result);
    }

    begin(value: ConfigRecord): void {
        this.session++;
        if (this.editing) this.recoveredEdits ||= Boolean(this.draft?.userEdited);
        this.editing = true;
        this.baseline = clone(value);
        this.openingHead = this.head;
        this.fileEdits = false;
    }

    async stage(value: ConfigRecord, automatic = false): Promise<void> {
        if (automatic && this.editing && this.baseline) {
            const rebased = rebaseBackground(this.baseline, this.draft?.value ?? this.baseline, value);
            if (record(rebased)) this.baseline = rebased;
        }
        const userEdited = Boolean(this.recoveredEdits || this.editing && this.baseline && !equal(value, this.baseline) || this.fileEdits);
        const draft = { base: this.openingHead?.id ?? this.head.id, value: clone(value), files: clone(this.stagedFiles), userEdited };
        if (equal(value, this.head.value) && !Object.keys(this.stagedFiles).length && !this.draft) return;
        const fingerprint = settingsFingerprint(draft);
        if (fingerprint !== this.lastDraft) { await this.io.writeDraft(draft); this.lastDraft = fingerprint; }
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
        if (this.stagedFiles[path] === text) return;
        this.stagedFiles[path] = text;
        if (userEdited) this.fileEdits = true;
    }
    async persistFileDraft(): Promise<void> { await this.stage(this.draft?.value ?? this.baseline ?? this.head.value); }
    stagedFile(path: string): { value: string | null } | undefined {
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
        if (relation === 'same') return clone(this.head.value);
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

    private async pause(incoming: ConfigSnapshot, local: ConfigRecord, reason: ConfigConflict['reason']): Promise<void> {
        const id = await this.hash(settingsFingerprint({ base: this.head.id, local, incoming: incoming.id, files: this.stagedFiles }));
        const conflict: ConfigConflict = { id, reason, base: clone(this.head), local: clone(local), incoming: clone(incoming), localFiles: clone(this.stagedFiles) };
        await this.io.preserveConflict(conflict);
        this.conflictValue = conflict;
        this.resolution = undefined;
        this.incoming = incoming;
        this.changed();
    }

    /** Choosing is an explicit draft edit; publication still waits for all editor windows to close. */
    choose(value: ConfigRecord, files: Record<string, string | null>): void {
        if (!this.conflictValue) throw new Error('No BPM configuration conflict to resolve');
        this.resolution = { value: clone(value), files: clone(files) };
        this.recoveredEdits = true;
        this.changed();
    }
    async cancelChoice(value: ConfigRecord): Promise<void> {
        if (this.conflictValue) await this.pause(this.conflictValue.incoming, value, this.conflictValue.reason);
    }

    async finish(value: ConfigRecord, fileDigests: Record<string, string | null>, stillClosed: () => boolean): Promise<ConfigRecord | undefined> {
        const closed = stillClosed, session = this.session;
        stillClosed = () => closed() && session === this.session;
        if (!stillClosed()) return undefined;
        await this.stage(value);
        if (!stillClosed()) return undefined;
        if (this.paused) throw new ConfigConflictPaused();
        const edited = Boolean(this.resolution || this.draft?.userEdited);
        const disk = await this.io.readShared();
        if (!stillClosed()) return undefined;
        if (this.resolution && this.conflictValue && compareConfig(this.conflictValue.incoming, disk) !== 'same'
            && compareConfig(this.head, disk) !== 'same') {
            await this.pause(disk, value, 'concurrent');
            throw new ConfigConflictPaused();
        }
        if (!edited) {
            this.editing = false;
            this.baseline = undefined;
            const relation = compareConfig(this.head, disk);
            const result = relation === 'same' ? clone(value) : await this.observe(disk, value);
            if (compareConfig(this.head, disk) === 'ancestor' && !this.paused) await this.restoreAncestor(disk, value, stillClosed);
            return this.paused ? undefined : result;
        }
        const parent = this.openingHead ?? this.head;
        const relation = compareConfig(parent, disk);
        if (!this.resolution && relation !== 'same' && relation !== 'ancestor' && !sameConfigContent(parent, disk)) {
            await this.pause(disk, value, 'concurrent');
            throw new ConfigConflictPaused();
        }
        const selected = this.resolution?.value ?? value;
        const files = this.resolution?.files ?? this.stagedFiles;
        const parents = this.resolution && this.conflictValue ? [this.head, this.conflictValue.incoming] : [this.head];
        const next = await createConfigRevision(selected, this.device, parents, fileDigests, this.hash);
        if (!this.resolution && sameConfigContent(next, this.head)) return this.complete(this.head, stillClosed);
        if (!stillClosed()) return undefined;
        await this.io.writeShared(next, files, stillClosed);
        await this.io.writeHead(next);
        return this.complete(next, stillClosed);
    }

    private async restoreAncestor(disk: ConfigSnapshot, local: ConfigRecord, stillClosed: () => boolean): Promise<void> {
        if (!stillClosed()) return;
        const key = `${this.head.id}:${disk.id}`;
        if (this.repaired.has(key) || this.io.claimRepair && !await this.io.claimRepair(key)) { await this.pause(disk, local, 'stale-replayed'); return; }
        this.repaired.add(key);
        await this.io.writeShared(this.head, {}, stillClosed);
        this.incoming = undefined;
    }

    private async complete(snapshot: ConfigSnapshot, stillClosed: () => boolean): Promise<ConfigRecord | undefined> {
        const previous = this.head;
        this.head = snapshot;
        if (!stillClosed()) {
            if (this.openingHead?.id === previous.id) this.openingHead = snapshot;
            return undefined;
        }
        await this.io.clearConflict?.();
        await this.io.removeDraft();
        this.draft = undefined;
        this.lastDraft = '';
        this.baseline = undefined;
        this.openingHead = undefined;
        this.editing = false;
        this.fileEdits = false;
        this.recoveredEdits = false;
        this.conflictValue = undefined;
        this.resolution = undefined;
        this.incoming = undefined;
        for (const key of Object.keys(this.stagedFiles)) delete this.stagedFiles[key];
        this.changed();
        return clone(snapshot.value);
    }
}
