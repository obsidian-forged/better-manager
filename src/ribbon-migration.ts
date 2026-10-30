import { RibbonItem } from './data/types';

/**
 * 旧版 Ribbon 结构只有 `id`（形如 `plugin-id:标题`），没有 bpmUniqueId / ribbonIdMap。
 * 这里一次性全部转换成新结构：保留用户设置的显隐与顺序，任何无法识别字段的条目原样保留。
 * Legacy ribbon entries only had `id`; convert them once while keeping visibility and order.
 */
type LegacyEntry = Record<string, unknown>;

const isRecord = (value: unknown): value is LegacyEntry =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const pluginPrefixOf = (legacyId: string): string => {
    const index = legacyId.indexOf(':');
    return index === -1 ? legacyId : legacyId.slice(0, index);
};

const isLegacyEntry = (entry: LegacyEntry): boolean =>
    typeof entry.bpmUniqueId !== 'string' && typeof entry.id === 'string';

/** 返回是否发生迁移；调用方负责持久化。 */
export const migrateLegacyRibbonSettings = (settings: { RIBBON_SETTINGS?: unknown }): boolean => {
    const list = settings?.RIBBON_SETTINGS;
    if (!Array.isArray(list)) return false;

    const entries = list.filter(isRecord);
    const legacy = entries.filter(isLegacyEntry);
    if (legacy.length === 0) return false;

    const modern = entries.filter(entry => typeof entry.bpmUniqueId === 'string');
    const taken = new Set<string>();
    const idOwners = new Map<string, RibbonItem>();
    modern.forEach(entry => {
        const item = entry as unknown as RibbonItem;
        taken.add(item.bpmUniqueId);
        Object.values(item.ribbonIdMap || {}).forEach(id => {
            if (id) idOwners.set(id, item);
        });
    });

    const converted: RibbonItem[] = [];
    for (const entry of legacy) {
        const legacyId = String(entry.id);
        const pluginId = pluginPrefixOf(legacyId) || legacyId;

        // 已经有新结构条目覆盖了这个内存项 id，说明迁移过；不再复制，避免覆盖用户后续改动。
        if (idOwners.has(legacyId)) continue;

        let bpmUniqueId = pluginId;
        let sequence = 1;
        while (taken.has(bpmUniqueId)) {
            sequence += 1;
            bpmUniqueId = `${pluginId}#${sequence}`;
        }
        taken.add(bpmUniqueId);
        const item: RibbonItem = {
            bpmUniqueId,
            name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : pluginId,
            icon: typeof entry.icon === 'string' && entry.icon ? entry.icon : 'help-circle',
            visible: entry.visible !== false,
            order: typeof entry.order === 'number' && Number.isFinite(entry.order)
                ? entry.order
                : Number.MAX_SAFE_INTEGER,
            ribbonIdMap: { en: legacyId, zh: legacyId },
        };
        converted.push(item);
        idOwners.set(legacyId, item);
    }

    // 保留未知条目（既没有 id 也没有 bpmUniqueId）原样不动，避免静默丢数据。
    const untouched = entries.filter(entry => !isLegacyEntry(entry));
    if (converted.length === 0) {
        // 只剩被新结构覆盖的重复旧条目：清掉它们，不动现有条目的顺序值。
        settings.RIBBON_SETTINGS = untouched;
        return true;
    }
    const merged = [...untouched, ...converted].sort((a, b) => {
        const orderA = typeof (a as RibbonItem).order === 'number' ? (a as RibbonItem).order : Number.MAX_SAFE_INTEGER;
        const orderB = typeof (b as RibbonItem).order === 'number' ? (b as RibbonItem).order : Number.MAX_SAFE_INTEGER;
        return orderA - orderB;
    });
    // 重新编号为连续 0..n-1，保持相对顺序不变。
    merged.forEach((entry, index) => {
        if (isRecord(entry)) entry.order = index;
    });
    settings.RIBBON_SETTINGS = merged;
    return true;
};
