import { applySettingsEdit } from './save-request';

const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * 单机模式保存前把本机改动合并到最新的外部配置上。
 * Merge this session's local edits onto the newest external configuration before writing.
 *
 * - 本机没有改动的字段采用外部值（包括外部删除）；Only fields edited locally win.
 * - 设备记录按 id 合并；外部列表为空（保护模式对端会清空）时保留本机列表。
 *   Device records merge by id; an empty external list keeps the local records.
 * - 两侧都修改同一字段时本机优先，单机模式没有更细的冲突界面；Local wins on the same field.
 */
export function mergeLocalSettings(base: Record<string, unknown>, edited: Record<string, unknown>,
    remote: Record<string, unknown>): Record<string, unknown> {
    const merged = applySettingsEdit(base, edited, remote);
    const management = merged.DEVICE_MANAGEMENT;
    const localDevices = (edited.DEVICE_MANAGEMENT as Record<string, unknown> | undefined)?.devices;
    const remoteDevices = (remote.DEVICE_MANAGEMENT as Record<string, unknown> | undefined)?.devices;
    const mergedDevices = (management as Record<string, unknown> | undefined)?.devices;
    if (record(management)) {
        const devices = Array.isArray(remoteDevices) && remoteDevices.length > 0 && Array.isArray(mergedDevices)
            ? mergedDevices : localDevices;
        if (Array.isArray(devices)) {
            const copies: unknown[] = (devices as unknown[]).map(device => record(device) ? { ...device } : device);
            merged.DEVICE_MANAGEMENT = { ...management, devices: copies };
        }
    }
    return merged;
}
