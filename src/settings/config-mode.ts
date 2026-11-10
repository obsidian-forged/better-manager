/** 同步保护是每台设备自己的选择，不能随 data.json 同步到其他机器。 */
export const CONFIG_MODE_STORAGE_KEY = 'bpm-config-sync-protection';
export const CONFIG_CLEANUP_STORAGE_KEY = 'bpm-config-cleanup-pending';

/**
 * 解析本机的同步保护开关：
 * 1. 本机已保存的设置优先；The device-local choice wins.
 * 2. 旧版本把开关写在 data.json 里，读取一次并迁移到本机存储；
 *    Legacy files store it in data.json; read it once for migration.
 * 3. 新版 data.json 不再写开关字段，用“修订标记或本机 .bpm”判断是否为旧保护库；
 *    New files carry no switch; a revision marker or an existing .bpm indicates a protected install.
 * 4. 全新安装/普通单机库默认关闭；Fresh installs and ordinary local vaults stay simple.
 */
export function resolveConfigSyncProtection(raw: unknown, local: unknown = undefined, hasCache = false): boolean {
    if (typeof local === 'boolean') return local;
    if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) return hasCache;
    const record = raw as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, 'CONFIG_SYNC_PROTECTION')) {
        return record.CONFIG_SYNC_PROTECTION === true;
    }
    return hasCache || Object.prototype.hasOwnProperty.call(record, '_bpmRevision');
}
