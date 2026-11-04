import type { ConfigRecord } from './config-revision';
import { settingsFingerprint } from './session-store';

export interface SettingsSaveRequest { value: ConfigRecord; serialized: string; automatic: boolean; }
export function copySettingsRecord(value: object): ConfigRecord {
    const snapshot: unknown = JSON.parse(JSON.stringify(value));
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Invalid configuration object');
    return snapshot as ConfigRecord;
}
/** Freeze the request before another queued task can observe later UI edits. */
export function queueSettingsSave(value: object, automatic: boolean,
    enqueue: (task: () => Promise<void>) => Promise<void>, persist: (request: SettingsSaveRequest) => Promise<void>): Promise<void> {
    const snapshot = copySettingsRecord(value);
    const request = { value: snapshot, serialized: JSON.stringify(snapshot), automatic };
    return enqueue(() => persist(request));
}

const record = (value: unknown): value is ConfigRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown): string | undefined => record(value) && typeof value.id === 'string' ? value.id : undefined;
function reconcile(current: unknown, incoming: unknown): unknown {
    if (Array.isArray(current) && Array.isArray(incoming)) {
        const byId = new Map(current.flatMap((value: unknown) => { const id = identity(value); return id ? [[id, value] as const] : []; }));
        const values = incoming.map((value: unknown, index: number) => {
            const id = identity(value);
            return reconcile(id ? byId.get(id) : current[index], value);
        });
        current.splice(0, current.length, ...values);
        return current;
    }
    if (record(current) && record(incoming)) {
        for (const key of Object.keys(current)) if (!Object.prototype.hasOwnProperty.call(incoming, key)) delete current[key];
        for (const [key, value] of Object.entries(incoming)) Object.defineProperty(current, key,
            { value: reconcile(Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined, value),
                enumerable: true, configurable: true, writable: true });
        return current;
    }
    return incoming === undefined ? undefined : JSON.parse(JSON.stringify(incoming)) as unknown;
}

/** Keep setting callbacks bound to the same group/plugin/preset objects after an explicit Save. */
export function reconcileSettingsRecord(current: ConfigRecord, incoming: ConfigRecord): void { reconcile(current, incoming); }

const cloneValue = (value: unknown): unknown => value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown;
function keyed(values: unknown[]): Map<string, unknown> | undefined {
    const result = new Map<string, unknown>();
    for (const value of values) {
        const id = identity(value) ?? (record(value) && typeof value.bpmUniqueId === 'string' ? value.bpmUniqueId : undefined);
        if (!id || result.has(id)) return undefined;
        result.set(id, value);
    }
    return result;
}
function applyDelta(base: unknown, edited: unknown, selected: unknown): unknown {
    if (settingsFingerprint(base) === settingsFingerprint(edited)) return cloneValue(selected);
    if (record(base) && record(edited) && record(selected)) {
        const result: ConfigRecord = {};
        for (const key of new Set([...Object.keys(base), ...Object.keys(edited), ...Object.keys(selected)])) {
            if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
            const value = applyDelta(base[key], edited[key], selected[key]);
            if (value !== undefined) result[key] = value;
        }
        return result;
    }
    if (Array.isArray(base) && Array.isArray(edited) && Array.isArray(selected)) {
        const a = keyed(base), b = keyed(edited), c = keyed(selected);
        if (a && b && c) {
            const order = settingsFingerprint([...a.keys()]) === settingsFingerprint([...b.keys()]) ? [...c.keys()] : [...b.keys()];
            const result: unknown[] = [];
            for (const id of new Set([...order, ...b.keys(), ...c.keys()])) {
                const value = applyDelta(a.get(id), b.get(id), c.get(id));
                if (value !== undefined) result.push(value);
            }
            return result;
        }
    }
    return cloneValue(edited);
}
/** Apply only new UI edits to confirmed choices; timestamps never select an entire preset. */
export function applySettingsEdit(base: ConfigRecord, edited: ConfigRecord, selected: ConfigRecord): ConfigRecord {
    const value = applyDelta(base, edited, selected);
    if (!record(value)) throw new Error('Invalid edited settings');
    return value;
}

const saveMessages = {
    saved: ['配置已保存到本地文件。', 'Settings were saved to the local files.'],
    unchanged: ['配置已检查，无需重复写入。', 'Settings were checked. No file changes were needed.'],
    pending: ['仍有未保存的更改，请点击保存配置。', 'There are unsaved changes. Save the settings to keep them.'],
    savedPending: ['本次配置已保存，仍有新的更改尚未保存。', 'Settings were saved. Newer changes still need to be saved.'],
    conflict: ['发现配置差异，已保留两份。请查看标记、确认选择，再点击保存配置。', 'Different settings were found and both copies were preserved. Review the marked features, confirm your choices, then save again.'],
    incomplete: ['同步配置的相关文件尚未完整到达。未写入配置，请稍后再次保存。', 'Some synced configuration files have not arrived. No settings were published. Save again when the files are available.'],
    cancelled: ['保存期间配置有了新更改，已保留草稿。请再次保存。', 'Settings changed during saving. The draft was kept. Save again.'],
    failed: ['配置保存失败，草稿已保留。', 'Settings could not be saved. The draft was kept.'],
} as const;
export function settingsSaveMessage(language: string, key: keyof typeof saveMessages): string {
    return saveMessages[key][/^zh/i.test(language) ? 0 : 1];
}
