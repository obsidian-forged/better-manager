import { settingsFingerprint } from './session-store';

export interface ConfigEditTime { editedAt?: number; }
const MAX_TIME = 4_102_444_800_000; // 2100-01-01 UTC; stable across clock rollback.
/** 仅接受合理的毫秒时间；Reject malformed and excessively future-dated input. */
export function validEditTime(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
        && value <= MAX_TIME;
}
/** 时钟仅跟随本机编辑；Remote clocks never advance this device's clock. */
export class ConfigEditClock {
    private last = 0;
    next(previous?: number, capturedAt = Date.now()): number {
        if (validEditTime(previous)) this.last = Math.max(this.last, previous);
        const now = capturedAt;
        if (!validEditTime(now) || this.last >= MAX_TIME) throw new Error('BPM edit clock is outside the supported timestamp range');
        this.last = Math.max(now, this.last + 1);
        return this.last;
    }
}
export function editTime(value: Record<string, unknown>): number | undefined {
    return validEditTime(value._bpmEditedAt) ? value._bpmEditedAt : undefined;
}
export function configContent(value: Record<string, unknown>): Record<string, unknown> {
    const copy = { ...value }; delete copy._bpmEditedAt; delete copy._bpmRevision; return copy;
}
export function sameEditedContent(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    return settingsFingerprint(configContent(a)) === settingsFingerprint(configContent(b));
}
/** 同时有效才自动比较；Equal times defer to the currently shared disk. */
export function timestampOrder(local: unknown, remote: unknown): number | undefined {
    return validEditTime(local) && validEditTime(remote) ? Math.sign(local - remote) : undefined;
}
