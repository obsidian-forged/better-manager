/** 旧版本没有这个键：已有配置文件沿用同步保护，全新安装默认走单文件模式。
 * Legacy files keep configuration sync protection; fresh installs default to the simple path. */
export function resolveConfigSyncProtection(raw: unknown): boolean {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const record = raw as Record<string, unknown>;
    return Object.prototype.hasOwnProperty.call(record, 'CONFIG_SYNC_PROTECTION')
        ? record.CONFIG_SYNC_PROTECTION === true
        : true;
}
