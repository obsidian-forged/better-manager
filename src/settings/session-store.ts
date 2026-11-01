type SettingsRecord = Record<string, unknown>;
export interface SettingsSessionIO {
    readShared(): Promise<unknown>;
    writeShared(value: SettingsRecord): Promise<void>;
    readCache(): Promise<unknown>;
    writeCache(value: object): Promise<void>;
    removeCache(): Promise<void>;
}
const blockedKeys = new Set(['__proto__', 'prototype', 'constructor']);
const isRecord = (value: unknown): value is SettingsRecord => value !== null && typeof value === 'object' && !Array.isArray(value);

/** 忽略对象键顺序，保留数组顺序；Object key order is not a settings change. */
export function settingsFingerprint(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(settingsFingerprint).join(',')}]`;
    if (isRecord(value)) return `{${Object.keys(value).filter(key => !blockedKeys.has(key)).sort()
        .map(key => `${JSON.stringify(key)}:${settingsFingerprint(value[key])}`).join(',')}}`;
    return JSON.stringify(value) ?? 'undefined';
}
const equal = (left: unknown, right: unknown): boolean => settingsFingerprint(left) === settingsFingerprint(right);
const clone = (value: unknown): unknown => value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown;
function record(value: unknown): SettingsRecord {
    if (!isRecord(value)) throw new Error('Invalid BPM settings object');
    return value;
}
function itemKey(value: unknown): string | undefined {
    if (!isRecord(value)) return undefined;
    if (typeof value.id === 'string' && value.id) return value.id;
    if (typeof value.bpmUniqueId === 'string' && value.bpmUniqueId) return value.bpmUniqueId;
    return undefined;
}
function keyed(items: unknown[]): Map<string, unknown> | undefined {
    const result = new Map<string, unknown>();
    for (const item of items) {
        const key = itemKey(item);
        if (!key || result.has(key)) return undefined;
        result.set(key, item);
    }
    return result;
}

/** 仅本机改过的字段优先；按 ID 合并预设/插件，保留远端独立新增项；Three-way merge local edits. */
function mergeValue(base: unknown, local: unknown, remote: unknown): unknown {
    if (equal(local, base)) return clone(remote);
    if (equal(remote, base) || equal(local, remote)) return clone(local);
    if (isRecord(base) && isRecord(local) && isRecord(remote)) {
        const merged: SettingsRecord = {};
        for (const key of new Set([...Object.keys(base), ...Object.keys(remote), ...Object.keys(local)])) {
            if (blockedKeys.has(key)) continue;
            const value = mergeValue(base[key], local[key], remote[key]);
            if (value !== undefined) merged[key] = value;
        }
        return merged;
    }
    if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
        const b = keyed(base), l = keyed(local), r = keyed(remote);
        if (b && l && r) {
            const localOrder = Array.from(l.keys());
            const remoteOrder = Array.from(r.keys());
            const order = equal(localOrder, Array.from(b.keys())) ? remoteOrder : localOrder;
            const result: unknown[] = [];
            for (const key of new Set([...order, ...remoteOrder, ...localOrder])) {
                const value = mergeValue(b.get(key), l.get(key), r.get(key));
                if (value !== undefined) result.push(value);
            }
            return result;
        }
    }
    return clone(local);
}
export function mergeSettings(base: object, local: object, remote: object): SettingsRecord {
    return record(mergeValue(base, local, remote));
}

/** 当前编辑快照、共享配置和同目录恢复缓存分离；Keep editing sessions stable across external file changes. */
export class SettingsSessionStore {
    private base: SettingsRecord = {};
    private observed = '';
    private editing = false;
    private cached = false;
    private pending = false;
    private cacheUsable = true;
    get usingCache(): boolean { return this.cached; }

    constructor(private readonly io: SettingsSessionIO, private readonly owner: string) {}

    async load(): Promise<SettingsRecord> {
        const shared = record(await this.io.readShared());
        const cache = await this.io.readCache();
        let result = shared;
        if (cache !== null && cache !== undefined) {
            this.cacheUsable = isRecord(cache) && cache.version === 1 && cache.owner === this.owner
                && isRecord(cache.base) && isRecord(cache.value);
            if (this.cacheUsable && isRecord(cache) && isRecord(cache.base) && isRecord(cache.value)) {
                result = mergeSettings(cache.base, cache.value, shared);
                if (!equal(result, shared)) await this.io.writeShared(result);
                await this.io.removeCache();
            }
        }
        this.base = record(clone(result));
        this.observed = settingsFingerprint(result);
        return result;
    }

    begin(): void {
        if (this.editing) return;
        this.editing = true;
    }

    /** 外部快照是否变化；投影期间只探测，不推进 base/observed。 */
    public hasExternalChange(value: object): boolean {
        return settingsFingerprint(value) !== this.observed;
    }

    /**
     * 外部修改与当前本地配置做三方合并后立即返回：
     * 本机未保存字段优先，其他设备修改的独立字段直接落地。
     * base 更新为远端快照，后续同步仍能区分本地编辑。
     */
    external(value: object, local: object): { changed: boolean; apply?: SettingsRecord } {
        const incoming = record(clone(value));
        const fingerprint = settingsFingerprint(incoming);
        if (fingerprint === this.observed) return { changed: false };
        const merged = mergeSettings(this.base, record(clone(local)), incoming);
        this.observed = fingerprint;
        this.base = incoming;
        this.pending = this.editing || this.cached;
        return { changed: true, apply: merged };
    }

    async activateCache(value: object): Promise<void> {
        if (this.cached || !this.editing) return;
        if (!this.cacheUsable) throw new Error('The BPM recovery cache is invalid or belongs to another device');
        // 写入成功才切换保存目的地；Never claim protection before the recovery file exists.
        await this.writeCache(value);
        this.cached = true;
    }

    private writeCache(value: object): Promise<void> {
        return this.io.writeCache({ version: 1, owner: this.owner, base: this.base, value: clone(value) });
    }

    async save(value: object): Promise<void> {
        if (this.cached) { await this.writeCache(value); return; }
        const remote = record(await this.io.readShared());
        const merged = mergeSettings(this.base, value, remote);
        if (!equal(merged, remote)) await this.io.writeShared(merged);
        this.observed = settingsFingerprint(merged);
        if (!this.editing) this.base = record(clone(value));
    }

    /** 合并成功后才删除缓存；重开窗口或写盘失败时继续保留缓存。 */
    async finish(value: object, stillClosed: () => boolean = () => true): Promise<SettingsRecord | undefined> {
        if (!this.editing && !this.cached && !this.pending) return undefined;
        const remote = record(await this.io.readShared());
        const merged = mergeSettings(this.base, value, remote);
        if (!equal(merged, remote)) await this.io.writeShared(merged);
        this.observed = settingsFingerprint(merged);
        if (!stillClosed()) return undefined;
        if (this.cached) await this.io.removeCache();
        this.cached = false;
        this.editing = false;
        this.pending = false;
        this.base = record(clone(merged));
        return merged;
    }
}
