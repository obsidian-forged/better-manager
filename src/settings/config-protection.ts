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
    /** 是否有需要保护的本机用户编辑；Whether this device holds user edits worth protecting. */
    private get hasLocalEdits(): boolean {
        return Boolean(this.resolution || this.conflictValue || this.draft?.userEdited || this.fileEdits || this.recoveredEdits);
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
        // 旧版本可能在“本机只是基线、没有用户编辑”时也留下冲突；这种冲突在启动时直接跟随最新远端。
        // Older builds could pause even when the local side was merely the base; follow the newest remote.
        if (this.conflictValue && disk.revision && disk.id !== this.head.id) {
            const conflict = this.conflictValue;
            if (await this.sameContent(conflict.local, conflict.localFiles, conflict.base, conflict.base)
                && ['descendant', 'conflict'].includes(compareConfig(this.head, disk))) {
                await this.adoptShared(disk);
                return clone(this.head.value);
            }
        }
        // 同步系统带来更新版本时，本机若没有需要保护的编辑就直接采用；普通用户期望最新配置生效。
        // When a sync service delivered a newer revision and this device has no user edits, follow it.
        // A legacy (unverifiable) incoming file keeps the explicit conflict path.
        if (!this.conflictValue && !this.draft?.userEdited && disk.revision && disk.id !== this.head.id) {
            const relation = compareConfig(this.head, disk);
            if (relation === 'descendant' || relation === 'conflict') {
                await this.adoptShared(disk);
                return clone(this.head.value);
            }
        }
        // 本机已有用户草稿而共享文件更新时，启动即进入可解决的冲突，而不是只在点击保存后才出现。
        // A user draft plus a newer shared revision becomes a visible conflict at startup, not only on Save.
        // 基于已消失 head 的草稿仍走下方的 stale-replayed 分支，保留其专门提示与清理。
        const draftBase = this.draft?.base;
        const draftBaseAccepted = Boolean(draftBase && (draftBase === this.head.id
            || this.head.revision?.ancestors.includes(draftBase)));
        if (this.draft?.userEdited && draftBaseAccepted && disk.revision && disk.id !== this.head.id
            && ['descendant', 'conflict'].includes(compareConfig(this.head, disk))) {
            const local = clone(this.draft.value);
            await this.pause(disk, local, 'concurrent', this.draft.files);
            return local;
        }
        if (this.draft && !this.draft.userEdited && this.draft.base !== this.head.id) {
            await this.io.removeDraft(); this.draft = undefined;
        }
        // 单机模式期间留下的旧草稿可能基于已不存在的 head；直接发布会覆盖当前配置，
        // 因此转成冲突等待用户选择，而不是静默采用。
        // A draft from a previous mode may be based on a head that no longer exists; pause instead of
        // publishing stale values over the current configuration.
        if (this.draft?.userEdited && this.draft.base !== this.head.id
            && !this.head.revision?.ancestors.includes(this.draft.base)) {
            const stale = clone(this.draft.value);
            // 若共享文件本身也有更新版本，冲突应以最新远端为对照，而不是旧的本机 head。
            // Compare the stale draft with the newest shared revision when the file also moved on.
            const incoming = disk.revision && ['descendant', 'conflict'].includes(compareConfig(this.head, disk))
                ? disk : this.head;
            await this.pause(incoming, stale, 'stale-replayed', this.draft.files);
            await this.io.removeDraft();
            this.draft = undefined;
            this.lastDraft = '';
            this.recoveredEdits = false;
            this.changed();
            return stale;
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
        // 自动保存（视图状态、启动迁移、心跳）不能自行把本机变成“有用户编辑”，否则保存键会无端闪烁，
        // 同步来的新版本也会被误判为冲突。显式保存若只是重申同一份草稿，也沿用原标记，避免把自动草稿升级成用户编辑。
        // Automatic saves (view state, startup migrations, heartbeats) must not manufacture a user edit;
        // that is what made the Save control flash and a synced revision look like a conflict. Re-staging
        // the same draft keeps its existing flag for the same reason.
        const sameDraft = Boolean(this.draft && !this.resolution && equal(value, this.draft.value)
            && equal(this.stagedFiles, this.draft.files));
        const userEdited = Boolean(this.recoveredEdits || fileEdits
            || (automatic || sameDraft ? this.draft?.userEdited : !equal(value, baseline)));
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

    /** 采用共享文件中的最新版本，并清掉基于旧版本的自动草稿。
     * Adopt a newer shared snapshot and drop automatic state derived from the old head. */
    private async adoptShared(disk: ConfigSnapshot): Promise<void> {
        this.head = disk;
        this.openingHead = disk;
        this.baseline = clone(disk.value);
        await this.io.writeHead(disk);
        if (this.conflictValue) await this.io.clearConflict?.();
        if (this.draft && !this.draft.userEdited) await this.io.removeDraft();
        this.draft = undefined;
        this.lastDraft = '';
        this.fileEdits = false;
        this.editedFiles.clear();
        this.recoveredEdits = false;
        this.conflictValue = undefined;
        this.resolution = undefined;
        this.incoming = undefined;
        for (const key of Object.keys(this.stagedFiles)) delete this.stagedFiles[key];
        this.changed();
    }

    /**
     * 后台读到共享文件变化后的统一决策：本机没有用户编辑就跟随最新版本（与同步系统一致），
     * 有编辑时才暂停并等待用户选择，而不是把任何外部修改都当成冲突。
     * One decision for a shared change: follow the newest shared revision when this device has no
     * user edits, and pause for an explicit choice only when it does.
     */
    async observeShared(disk: ConfigSnapshot, local: ConfigRecord): Promise<'same' | 'adopted' | 'conflict'> {
        if (disk.id === this.head.id) return 'same';
        const relation = compareConfig(this.head, disk);
        // 旧版本回放不追回；下一次显式保存会修复。A stale replay never rolls the head back.
        if (relation === 'same' || relation === 'ancestor') return 'same';
        if (this.conflictValue) {
            // 冲突已展示且内容未变时不重复弹窗；用户关闭后仍可从提示条重新打开。
            // Do not reopen an unchanged conflict the user already dismissed.
            if (compareConfig(this.conflictValue.incoming, disk) === 'same') return 'same';
            await this.pause(disk, this.conflictValue.local, this.conflictValue.reason, this.conflictValue.localFiles);
            return 'conflict';
        }
        // 无法验证的旧格式共享内容（丢失版本标记）仍交给冲突界面，而不是静默覆盖本机。
        // Unverifiable legacy content keeps the explicit conflict path instead of silently replacing local settings.
        if (!disk.revision) {
            await this.pause(disk, local, 'concurrent');
            return 'conflict';
        }
        if (this.editing && this.baseline && !equal(local, this.baseline)) {
            await this.pause(disk, local, 'concurrent');
            return 'conflict';
        }
        if (this.draft?.userEdited || this.fileEdits || this.recoveredEdits) {
            await this.pause(disk, local, 'concurrent');
            return 'conflict';
        }
        await this.adoptShared(disk);
        return 'adopted';
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
        // 本机没有用户编辑时，让共享文件的最新版本直接生效；保存不应把纯粹的同步变化变成冲突。
        // With nothing local to protect, the synced revision takes effect instead of asking the user
        // to resolve a conflict that only the sync service created.
        if (!sameEffective && relation !== 'ancestor' && disk.id !== this.head.id && disk.revision && !this.hasLocalEdits) {
            await this.adoptShared(disk);
            return { status: 'noop', value: clone(disk.value) };
        }
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
    async discardDraft(retainFiles: Record<string, string | null> = {}, userEditedFiles?: readonly string[]): Promise<void> {
        const changed = new Set<string>();
        for (const [path, text] of Object.entries(retainFiles)) {
            if ((text === null ? null : await this.hash(text)) !== (this.head.files[path] ?? null)) changed.add(path);
        }
        const hasFileEdits = changed.size > 0;
        // 未提供编辑列表时（旧调用方），保留下来的文件按用户编辑处理；显式列表只标记真正的用户编辑。
        // Legacy callers treat retained files as user edits; an explicit list marks only real user edits.
        const userEdited = userEditedFiles === undefined ? hasFileEdits : userEditedFiles.some(path => changed.has(path));
        const retained = hasFileEdits
            ? { base: this.head.id, value: clone(this.head.value), files: clone(retainFiles), userEdited } : undefined;
        // Replace an existing draft in one write when a later action must survive. Deleting
        // it first would lose the new action if storage ran out during the following write.
        if (retained) await this.io.writeDraft(retained); else await this.io.removeDraft();
        await this.io.clearConflict?.();
        this.draft = retained;
        this.lastDraft = retained ? settingsFingerprint(retained) : '';
        this.fileEdits = userEdited;
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
            if (retained.userEdited) for (const path of changed) {
                if (userEditedFiles === undefined || userEditedFiles.includes(path)) this.editedFiles.add(path);
            }
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
