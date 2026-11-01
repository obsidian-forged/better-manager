import type { ManagerSettings } from './settings/data';

export const FEATURE_IDS = ['plugins', 'themes', 'devices', 'ribbon', 'install', 'transfer', 'troubleshoot'] as const;
export type FeatureId = typeof FEATURE_IDS[number];
export type FeatureSettings = Partial<Record<FeatureId, boolean>>;
export const TOOL_IDS = ['updates', 'bulkEdit', 'layoutEditor', 'reload', 'catalog', 'pluginMarket', 'appearanceMarket', 'appearanceProfiles'] as const;
export type ToolId = typeof TOOL_IDS[number];
export type ToolSettings = Partial<Record<ToolId, boolean>>;
const UNAVAILABLE_TOOLS = new Set<ToolId>(['catalog']);

/** 未完成的工具不开放入口，保留已有配置；Keep unfinished tools unavailable without deleting saved settings. */
export function toolAvailable(id: ToolId): boolean {
    return !UNAVAILABLE_TOOLS.has(id);
}

export function toolEnabled(settings: ManagerSettings, id: ToolId): boolean {
    return toolAvailable(id) && settings.TOOLS?.[id] !== false;
}

/** 老配置默认保留所有入口；Existing installations retain all modules. */
export function featureEnabled(settings: ManagerSettings, id: FeatureId): boolean {
    return settings.FEATURES?.[id] !== false;
}
