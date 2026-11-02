import type { ManagerSettings } from '../settings/data';
import type { FilterOperator } from '../settings/data';
import type { RibbonGroup, RibbonItem } from '../data/types';

export const DEVICE_TYPES = ['computer', 'tablet', 'phone'] as const;
export type DeviceType = typeof DEVICE_TYPES[number];
export interface DevicePluginState { enabled: boolean; delay: string; }
/** Plugin-list filters are part of a device preset so desktop choices can be reused on mobile. */
export interface DevicePluginFilters {
    search: string;
    status: string[];
    statusOperator: FilterOperator;
    group: string[];
    groupOperator: FilterOperator;
    tag: string[];
    tagOperator: FilterOperator;
    delay: string[];
    delayOperator: FilterOperator;
}

/** 外观运行状态：主题名与各 CSS 片段的显式开关 / Runtime appearance applied per scope. */
export interface ScopedAppearance {
    theme: string;
    snippets: Record<string, boolean>;
}

/** 命名预设：同一设备类型可以有多个，本机手动绑定其中一个 / Named presets per device type. */
export interface DevicePreset {
    id: string;
    name: string;
    /** 是否已经配置过（决定新类型能否自动复用）；Set once the user edits its settings. */
    configured: boolean;
    plugins: Record<string, DevicePluginState>;
    filters: DevicePluginFilters;
    ribbon: RibbonItem[];
    ribbonGroups: RibbonGroup[];
    ribbonEnabled: boolean;
    appearance: ScopedAppearance;
    /** 预设内容最后修改时间；同步合并时保护较新的本机配置 / Last local content revision. */
    updatedAt?: number;
}

/** 设备记录只用于展示与手动纠正类型，不再承载单设备配置。 */
export interface ManagedDevice {
    id: string;
    name: string;
    type: DeviceType;
    platform?: string;
    lastSeen: number;
    /** 名称/类型/平台本地修改的版本；用于跨设备合并时保护较新的本地改动。 */
    updatedAt?: number;
}

/** 快速应用时可选择覆盖哪些配置部分 / Select which preset sections quick apply replaces. */
export interface PresetConfigParts {
    plugins: boolean;
    filters: boolean;
    ribbon: boolean;
    appearance: boolean;
}

export const ALL_PRESET_CONFIG_PARTS: PresetConfigParts = {
    plugins: true, filters: true, ribbon: true, appearance: true,
};

export interface DeviceManagement {
    enabled: boolean;
    defaultPresets: Record<DeviceType, string>;
    presets: Record<DeviceType, DevicePreset[]>;
    devices: ManagedDevice[];
}

export type ScopePage = 'plugins' | 'themes' | 'ribbon';
export interface DeviceScope {
    key: string;
    type: DeviceType;
    presetId: string;
}

export const DEFAULT_PRESET_NAMES: Record<DeviceType, string> = {
    computer: 'Computer',
    tablet: 'Tablet',
    phone: 'Phone',
};

export function isDeviceType(value: unknown): value is DeviceType {
    return value === 'computer' || value === 'tablet' || value === 'phone';
}
export function detectDeviceType(platform: { isMobileApp: boolean; isTablet: boolean }): DeviceType {
    return platform.isMobileApp ? (platform.isTablet ? 'tablet' : 'phone') : 'computer';
}
export function detectSystemPlatform(platform: { isMacOS?: boolean; isWin?: boolean; isLinux?: boolean; isIosApp?: boolean; isAndroidApp?: boolean }): string {
    if (platform.isIosApp) return 'ios';
    if (platform.isAndroidApp) return 'android';
    if (platform.isMacOS) return 'macos';
    if (platform.isWin) return 'windows';
    if (platform.isLinux) return 'linux';
    return 'unknown';
}

export function scopeKey(presetId: string): string {
    return `preset:${presetId}`;
}
export function parseScopeKey(key: string): { key: string; presetId: string } | null {
    if (!key.startsWith('preset:')) return null;
    const presetId = key.slice(7);
    return presetId ? { key, presetId } : null;
}

/** 在全部类型中查找预设；Find a preset across all types. */
export function findPreset(presets: Record<DeviceType, DevicePreset[]>, id: string): { type: DeviceType; preset: DevicePreset } | null {
    for (const type of DEVICE_TYPES) {
        const preset = presets[type]?.find(item => item.id === id);
        if (preset) return { type, preset };
    }
    return null;
}
export function allPresets(presets: Record<DeviceType, DevicePreset[]>): Array<{ type: DeviceType; preset: DevicePreset }> {
    const result: Array<{ type: DeviceType; preset: DevicePreset }> = [];
    for (const type of DEVICE_TYPES) {
        for (const preset of presets[type] ?? []) result.push({ type, preset });
    }
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
function recordOfBooleans(value: unknown): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    if (!isRecord(value)) return result;
    for (const [key, flag] of Object.entries(value)) if (typeof flag === 'boolean' && key) result[key] = flag;
    return result;
}
function normalizeAppearance(value: unknown, baseline: ScopedAppearance): ScopedAppearance {
    if (!isRecord(value)) return cloneJson(baseline);
    return {
        theme: typeof value.theme === 'string' ? value.theme : baseline.theme,
        snippets: isRecord(value.snippets) ? recordOfBooleans(value.snippets) : cloneJson(baseline.snippets),
    };
}
function normalizeRibbon(value: unknown, fallback: RibbonItem[]): RibbonItem[] {
    if (!Array.isArray(value)) return cloneJson(fallback);
    const seen = new Set<string>();
    return value.flatMap((item: unknown) => {
        if (!isRecord(item) || typeof item.bpmUniqueId !== 'string' || seen.has(item.bpmUniqueId)
            || typeof item.name !== 'string' || typeof item.icon !== 'string'
            || typeof item.visible !== 'boolean' || typeof item.order !== 'number' || !Number.isFinite(item.order)) return [];
        seen.add(item.bpmUniqueId);
        const ribbonIdMap = isRecord(item.ribbonIdMap) ? item.ribbonIdMap : {};
        return [{ bpmUniqueId: item.bpmUniqueId, name: item.name, icon: item.icon,
            visible: item.visible, order: item.order, ribbonIdMap: {
                en: typeof ribbonIdMap.en === 'string' ? ribbonIdMap.en : undefined,
                zh: typeof ribbonIdMap.zh === 'string' ? ribbonIdMap.zh : undefined,
            } }];
    });
}
export function normalizeRibbonGroups(value: unknown): RibbonGroup[] {
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    const members = new Set<string>();
    return value.flatMap((raw: unknown) => {
        if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || ids.has(raw.id)
            || typeof raw.name !== 'string' || !raw.name.trim() || typeof raw.icon !== 'string') return [];
        ids.add(raw.id);
        const accepted = Array.isArray(raw.members) ? raw.members.filter((member: unknown): member is string => {
            if (typeof member !== 'string' || !member || members.has(member)) return false;
            members.add(member);
            return true;
        }) : [];
        const rawOrders = isRecord(raw.memberOrders) ? raw.memberOrders : {};
        const memberOrders: Record<string, number> = {};
        let maxOrder = -1;
        for (const member of accepted) {
            const value = rawOrders[member];
            if (typeof value === 'number' && Number.isFinite(value)) {
                memberOrders[member] = value;
                maxOrder = Math.max(maxOrder, value);
            }
        }
        for (const member of accepted) {
            if (memberOrders[member] === undefined) memberOrders[member] = ++maxOrder;
        }
        return [{ id: raw.id, name: raw.name.trim(), icon: raw.icon, members: accepted, memberOrders }];
    });
}
export function cloneAppearance(appearance: ScopedAppearance): ScopedAppearance {
    return { theme: appearance.theme, snippets: { ...appearance.snippets } };
}
export function clonePreset(preset: DevicePreset): DevicePreset {
    return {
        id: preset.id,
        name: preset.name,
        configured: preset.configured === true,
        plugins: Object.fromEntries(Object.entries(preset.plugins).map(([id, state]) => [id, { ...state }])),
        filters: cloneFilters(preset.filters),
        ribbon: normalizeRibbon(preset.ribbon, []),
        ribbonGroups: normalizeRibbonGroups(preset.ribbonGroups),
        ribbonEnabled: preset.ribbonEnabled,
        appearance: cloneAppearance(preset.appearance),
        updatedAt: typeof preset.updatedAt === 'number' && Number.isFinite(preset.updatedAt) ? preset.updatedAt : undefined,
    };
}

/** 预设内容签名：时间戳和名称不参与，避免空保存刷新 revision。 */
export function presetContentFingerprint(preset: DevicePreset): string {
    return JSON.stringify([
        Object.keys(preset.plugins).sort().map(id => [id, preset.plugins[id].enabled, preset.plugins[id].delay]),
        preset.filters,
        preset.ribbon,
        preset.ribbonGroups,
        preset.ribbonEnabled,
        preset.appearance.theme,
        Object.keys(preset.appearance.snippets).sort().map(id => [id, preset.appearance.snippets[id]]),
    ]);
}

function normalizeFilterValues(value: unknown): string[] {
    return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))] : [];
}
function normalizeOperator(value: unknown): FilterOperator { return value === 'not-contains' ? 'not-contains' : 'contains'; }
function cloneFilters(filters: DevicePluginFilters): DevicePluginFilters {
    return { ...filters, status: [...filters.status], group: [...filters.group], tag: [...filters.tag], delay: [...filters.delay] };
}
function normalizeFilters(value: unknown, baseline: DevicePluginFilters): DevicePluginFilters {
    if (!isRecord(value)) return cloneFilters(baseline);
    return {
        search: typeof value.search === 'string' ? value.search : baseline.search,
        status: normalizeFilterValues(value.status), statusOperator: normalizeOperator(value.statusOperator),
        group: normalizeFilterValues(value.group), groupOperator: normalizeOperator(value.groupOperator),
        tag: normalizeFilterValues(value.tag), tagOperator: normalizeOperator(value.tagOperator),
        delay: normalizeFilterValues(value.delay), delayOperator: normalizeOperator(value.delayOperator),
    };
}
function filtersFromSettings(settings: ManagerSettings): DevicePluginFilters {
    return {
        search: settings.FILTER_SEARCH || '',
        status: normalizeFilterValues(settings.FILTER_STATUS_VALUES?.length ? settings.FILTER_STATUS_VALUES : [settings.FILTER_STATUS]),
        statusOperator: normalizeOperator(settings.FILTER_STATUS_OPERATOR),
        group: normalizeFilterValues(settings.FILTER_GROUP_VALUES?.length ? settings.FILTER_GROUP_VALUES : [settings.FILTER_GROUP]),
        groupOperator: normalizeOperator(settings.FILTER_GROUP_OPERATOR),
        tag: normalizeFilterValues(settings.FILTER_TAG_VALUES?.length ? settings.FILTER_TAG_VALUES : [settings.FILTER_TAG]),
        tagOperator: normalizeOperator(settings.FILTER_TAG_OPERATOR),
        delay: normalizeFilterValues(settings.FILTER_DELAY_VALUES?.length ? settings.FILTER_DELAY_VALUES : [settings.FILTER_DELAY]),
        delayOperator: normalizeOperator(settings.FILTER_DELAY_OPERATOR),
    };
}
function applyFiltersToSettings(filters: DevicePluginFilters, settings: ManagerSettings): void {
    settings.FILTER_SEARCH = filters.search;
    settings.FILTER_STATUS_VALUES = [...filters.status]; settings.FILTER_STATUS = filters.status[0] || 'all';
    settings.FILTER_STATUS_OPERATOR = filters.statusOperator;
    settings.FILTER_GROUP_VALUES = [...filters.group]; settings.FILTER_GROUP = filters.group[0] || '';
    settings.FILTER_GROUP_OPERATOR = filters.groupOperator;
    settings.FILTER_TAG_VALUES = [...filters.tag]; settings.FILTER_TAG = filters.tag[0] || '';
    settings.FILTER_TAG_OPERATOR = filters.tagOperator;
    settings.FILTER_DELAY_VALUES = [...filters.delay]; settings.FILTER_DELAY = filters.delay[0] || '';
    settings.FILTER_DELAY_OPERATOR = filters.delayOperator;
}

export interface PresetExtras {
    appearance?: ScopedAppearance;
}
export interface PresetMeta {
    id?: string;
    name?: string;
    configured?: boolean;
    updatedAt?: number;
}
/** 快照当前运行设置；外观由调用方补充 / Snapshot runtime settings. */
export function snapshotPreset(settings: ManagerSettings, extras: PresetExtras = {}, meta: PresetMeta = {}): DevicePreset {
    return clonePreset({
        id: meta.id ?? '',
        name: meta.name ?? '',
        configured: meta.configured === true,
        plugins: Object.fromEntries(settings.Plugins.map(plugin => [plugin.id, { enabled: plugin.enabled, delay: plugin.delay }])),
        filters: filtersFromSettings(settings),
        ribbon: settings.RIBBON_SETTINGS,
        ribbonGroups: settings.RIBBON_GROUPS,
        ribbonEnabled: settings.RIBBON_MANAGER_ENABLED,
        appearance: extras.appearance ?? { theme: '', snippets: {} },
        updatedAt: meta.updatedAt,
    });
}

function normalizePreset(raw: unknown, baseline: DevicePreset, type: DeviceType, index: number, usedIds: Set<string>, existed: boolean): DevicePreset {
    const preset = clonePreset(baseline);
    preset.id = '';
    preset.name = '';
    if (isRecord(raw)) {
        if (isRecord(raw.plugins)) {
            for (const [id, state] of Object.entries(raw.plugins)) {
                if (isRecord(state) && typeof state.enabled === 'boolean') {
                    Object.defineProperty(preset.plugins, id, { value: {
                        enabled: state.enabled, delay: typeof state.delay === 'string' ? state.delay : '',
                    }, enumerable: true, writable: true, configurable: true });
                }
            }
        }
        if (typeof raw.ribbonEnabled === 'boolean') preset.ribbonEnabled = raw.ribbonEnabled;
        if (Array.isArray(raw.ribbon)) preset.ribbon = normalizeRibbon(raw.ribbon, preset.ribbon);
        if (Array.isArray(raw.ribbonGroups)) preset.ribbonGroups = normalizeRibbonGroups(raw.ribbonGroups);
        preset.filters = normalizeFilters(raw.filters, preset.filters);
        preset.appearance = normalizeAppearance(raw.appearance, preset.appearance);
        if (typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)) preset.updatedAt = raw.updatedAt;
        if (typeof raw.name === 'string' && raw.name.trim()) preset.name = raw.name.trim();
        if (typeof raw.id === 'string' && raw.id.trim()) preset.id = raw.id.trim();
    }
    // 显式标记优先；旧数据用与当前运行配置的差异推断。
    preset.configured = isRecord(raw) && typeof raw.configured === 'boolean'
        ? raw.configured
        : existed ? !settingsEqual(preset, baseline) : false;
    if (!preset.name) preset.name = index === 0 ? DEFAULT_PRESET_NAMES[type] : `${DEFAULT_PRESET_NAMES[type]} ${index + 1}`;
    if (!preset.id || usedIds.has(preset.id)) {
        const base = `preset-${type}${index ? `-${index}` : ''}`;
        let candidate = base;
        let suffix = 2;
        while (usedIds.has(candidate)) candidate = `${base}-${suffix++}`;
        preset.id = candidate;
    }
    usedIds.add(preset.id);
    return preset;
}

/** 旧数据没有 configured 标记时，用「是否偏离当前运行配置」推断。 */
function settingsEqual(a: DevicePreset, b: DevicePreset): boolean {
    const canonical = (preset: DevicePreset) => JSON.stringify({
        plugins: Object.keys(preset.plugins).sort().map(id => [id, preset.plugins[id].enabled, preset.plugins[id].delay]),
        filters: preset.filters,
        ribbon: preset.ribbon,
        ribbonGroups: preset.ribbonGroups,
        ribbonEnabled: preset.ribbonEnabled,
        theme: preset.appearance.theme,
        snippets: Object.keys(preset.appearance.snippets).sort().map(id => [id, preset.appearance.snippets[id]]),
    });
    return canonical(a) === canonical(b);
}

/**
 * 外部同步合并后，保护本机内容更新时间更晚的预设。
 * A stale or default snapshot must not replace a preset that was just configured.
 */
export function preserveNewerPresets(merged: DeviceManagement | undefined, local: DeviceManagement | undefined): boolean {
    if (!merged || !local) return false;
    let changed = false;
    for (const type of DEVICE_TYPES) {
        const localById = new Map(local.presets[type].map(preset => [preset.id, preset]));
        for (const target of merged.presets[type]) {
            const source = localById.get(target.id);
            if (!source) continue;
            const localStamp = typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt) ? source.updatedAt : 0;
            const mergedStamp = typeof target.updatedAt === 'number' && Number.isFinite(target.updatedAt) ? target.updatedAt : 0;
            const localConfigured = source.configured === true;
            const mergedConfigured = target.configured === true;
            const mergedEmpty = Object.keys(target.plugins).length === 0 && target.ribbon.length === 0;
            const localHasContent = Object.keys(source.plugins).length > 0 || source.ribbon.length > 0;
            if (localStamp > mergedStamp
                || (localStamp === mergedStamp && localConfigured && !mergedConfigured)
                || (localStamp === mergedStamp && localConfigured && mergedConfigured && mergedEmpty && localHasContent)) {
                if (presetContentFingerprint(target) !== presetContentFingerprint(source)
                    || target.configured !== source.configured
                    || target.updatedAt !== source.updatedAt) {
                    Object.assign(target, clonePreset(source));
                    changed = true;
                }
            }
        }
    }
    return changed;
}

/** 只接纳固定类型及合法字段；兼容旧版「每类一份预设」的数据。 */
export function normalizeDeviceManagement(value: unknown, baseline: DevicePreset): DeviceManagement {
    const source = isRecord(value) ? value : {};
    const rawPresets = isRecord(source.presets) ? source.presets : {};
    const usedIds = new Set<string>();
    const presets = {} as Record<DeviceType, DevicePreset[]>;
    for (const type of DEVICE_TYPES) {
        const raw = rawPresets[type];
        const list = Array.isArray(raw) ? raw : isRecord(raw) ? [raw] : [];
        const existed = list.length > 0;
        presets[type] = list.length
            ? list.map((item, index) => normalizePreset(item, baseline, type, index, usedIds, existed))
            : [normalizePreset({}, baseline, type, 0, usedIds, false)];
    }
    const devices: ManagedDevice[] = [];
    if (Array.isArray(source.devices)) {
        for (const raw of source.devices) {
            if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string'
                || !isDeviceType(raw.type) || devices.some(device => device.id === raw.id)) continue;
            devices.push({ id: raw.id, name: raw.name, type: raw.type,
                platform: typeof raw.platform === 'string' ? raw.platform : 'unknown',
                lastSeen: typeof raw.lastSeen === 'number' && Number.isFinite(raw.lastSeen) ? raw.lastSeen : 0,
                updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : undefined });
        }
    }
    const rawDefaults = isRecord(source.defaultPresets) ? source.defaultPresets : {};
    const defaultPresets = {} as Record<DeviceType, string>;
    for (const type of DEVICE_TYPES) {
        defaultPresets[type] = presets[type].find(preset => preset.id === rawDefaults[type])?.id ?? presets[type][0].id;
    }
    return { enabled: source.enabled === true, defaultPresets, presets, devices };
}

/** 保留未安装插件，避免另一设备的配置被裁剪；Keep remote-only plugin choices. */
export function capturePreset(preset: DevicePreset, settings: ManagerSettings, extras: PresetExtras = {}): void {
    const snapshot = snapshotPreset(settings, extras ?? {});
    preset.plugins = { ...preset.plugins, ...snapshot.plugins };
    preset.filters = cloneFilters(snapshot.filters);
    preset.ribbon = snapshot.ribbon;
    preset.ribbonGroups = snapshot.ribbonGroups;
    preset.ribbonEnabled = snapshot.ribbonEnabled;
    if (extras.appearance) preset.appearance = cloneAppearance(extras.appearance);
}

/** 共享元数据不分叉，仅投影运行设置；Project runtime settings without splitting shared metadata. */
export function applyPresetToSettings(preset: DevicePreset, settings: ManagerSettings, selfId: string): void {
    for (const plugin of settings.Plugins) {
        if (plugin.id === selfId || plugin.tags.includes('bpm-ignore')) continue;
        const state = Object.prototype.hasOwnProperty.call(preset.plugins, plugin.id) ? preset.plugins[plugin.id] : undefined;
        if (state) { plugin.enabled = state.enabled; plugin.delay = state.delay; }
    }
    settings.RIBBON_SETTINGS = clonePreset(preset).ribbon;
    settings.RIBBON_GROUPS = clonePreset(preset).ribbonGroups;
    settings.RIBBON_MANAGER_ENABLED = preset.ribbonEnabled;
    applyFiltersToSettings(preset.filters, settings);
}
