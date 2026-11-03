import type { ManagerSettings } from './settings/data';

export const FEATURE_IDS = ['plugins', 'themes', 'devices', 'ribbon', 'install', 'transfer', 'troubleshoot'] as const;
export type FeatureId = typeof FEATURE_IDS[number];
export type FeatureSettings = Partial<Record<FeatureId, boolean>>;
export const TOOL_IDS = ['updates', 'bulkEdit', 'layoutEditor', 'reload', 'catalog', 'pluginMarket', 'appearanceMarket', 'appearanceProfiles'] as const;
export type ToolId = typeof TOOL_IDS[number];
export type ToolSettings = Partial<Record<ToolId, boolean>>;
const RELEASE_CAPABILITIES: Record<'catalog' | 'rollback', boolean> = { catalog: false, rollback: false };
/** 发布可用性不可由旧配置开启；Saved preferences cannot expose unreleased capabilities. */
export function releaseCapabilityAvailable(id: keyof typeof RELEASE_CAPABILITIES): boolean {
    return RELEASE_CAPABILITIES[id];
}
/** 工具可用性与个人开关分开；Keep capability availability separate from user preferences. */
export function toolAvailable(id: ToolId): boolean {
    return TOOL_IDS.includes(id) && (id !== 'catalog' || releaseCapabilityAvailable('catalog'));
}

export function toolEnabled(settings: ManagerSettings, id: ToolId): boolean {
    return toolAvailable(id) && (id === 'catalog' ? settings.TOOLS?.[id] === true : settings.TOOLS?.[id] !== false);
}

/** 老配置默认保留所有入口；Existing installations retain all modules. */
export function featureEnabled(settings: ManagerSettings, id: FeatureId): boolean {
    return settings.FEATURES?.[id] !== false;
}
