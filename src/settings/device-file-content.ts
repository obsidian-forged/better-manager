import { settingsFingerprint } from './session-store';
import type { ConfigRecord } from './config-revision';

function deviceRecord(path: string, text: string | null): { content: ConfigRecord; lastSeen: number } | undefined {
    if (text === null || !/^data\/devices\/[^/]+\.json$/.test(path)) return;
    let raw: unknown;
    try { raw = JSON.parse(text); }
    catch { return; } // Invalid input must retain the normal strict integrity check.
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return;
    const value: ConfigRecord = { ...raw };
    if (typeof value.id !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(value.id)
        || path !== `data/devices/${encodeURIComponent(value.id)}.json` || typeof value.name !== 'string'
        || !['computer', 'tablet', 'phone'].includes(typeof value.type === 'string' ? value.type : '')
        || typeof value.lastSeen !== 'number' || !Number.isFinite(value.lastSeen)
        || value.platform !== undefined && typeof value.platform !== 'string'
        || value.updatedAt !== undefined && (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt))) return;
    const lastSeen = value.lastSeen;
    delete value.lastSeen;
    return { content: value, lastSeen };
}

/** Only a validated device heartbeat may drift outside a revision; all other fields stay significant. */
export function preserveDeviceHeartbeat(path: string, selected: string | null, current: string | null): string | undefined {
    const left = deviceRecord(path, selected), right = deviceRecord(path, current);
    if (!left || !right || settingsFingerprint(left.content) !== settingsFingerprint(right.content)) return;
    return right.lastSeen >= left.lastSeen ? current ?? undefined : selected ?? undefined;
}

/** A user may rename/retype a device while its heartbeat advances. Keep only that newer
 * timestamp from disk; the selected name, type and every other setting remain authoritative. */
export function mergeDeviceHeartbeat(path: string, selected: string | null, current: string | null): string | undefined {
    const left = deviceRecord(path, selected), right = deviceRecord(path, current);
    if (!left || !right) return;
    if (left.lastSeen >= right.lastSeen) return selected ?? undefined;
    if (settingsFingerprint(left.content) === settingsFingerprint(right.content)) return current ?? undefined;
    return JSON.stringify({ ...left.content, lastSeen: right.lastSeen }, null, 2);
}
