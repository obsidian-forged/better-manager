import { Notice, Platform } from 'obsidian';
import type Manager from '../main';
import { featureEnabled } from '../features';
import { pluginStorage } from '../storage/plugin-storage';
import { mergeSettings, settingsFingerprint } from '../settings/session-store';
import type { RibbonGroup, RibbonItem } from '../data/types';
import { applyPresetToSettings, capturePreset, cloneAppearance, clonePreset,
    allPresets, detectDeviceType, detectSystemPlatform, DEVICE_TYPES, DeviceManagement, DevicePluginFilters, DevicePluginState, DevicePreset, DeviceScope, DeviceType,
    findPreset, isDeviceType, normalizeDeviceManagement, parseScopeKey, scopeKey, ScopedAppearance,
    ScopePage, snapshotPreset, normalizeRibbonGroups, ManagedDevice, PresetConfigParts, ALL_PRESET_CONFIG_PARTS } from './device-presets';

/** 磁盘上的设备记录在写回前要校验，避免坏数据进入设置 / Validate records read back from disk. */
const isManagedDevice = (value: unknown): value is ManagedDevice => {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return typeof record.id === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(record.id)
        && typeof record.name === 'string'
        && typeof record.lastSeen === 'number' && Number.isFinite(record.lastSeen)
        && typeof record.type === 'string' && isDeviceType(record.type)
        && (record.platform === undefined || typeof record.platform === 'string')
        && (record.updatedAt === undefined || (typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)));
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
type LocalStorageApp = { loadLocalStorage(key: string): unknown; saveLocalStorage(key: string, value: unknown): void; };
type CustomCssLike = {
    theme?: string;
    enabledSnippets?: Set<string> | string[];
    setTheme?(theme: string): void;
    setCssEnabledStatus?(id: string, enabled: boolean): void;
    loadSnippets?(): Promise<void>;
    loadTheme?(): Promise<void>;
};
type CapacitorDevice = { getId?(): Promise<{ identifier?: string }> };
interface StoredIdentity { id?: unknown; type?: unknown; platformId?: unknown; presetId?: unknown; }
interface LiveSnapshot {
    ribbon: RibbonItem[];
    ribbonGroups: RibbonGroup[];
    ribbonEnabled: boolean;
    plugins: Record<string, DevicePluginState>;
    filters: DevicePluginFilters;
}
interface Projection {
    page: ScopePage;
    scope: DeviceScope;
    live: LiveSnapshot;
}

/** 设备身份留在本机；三类型下可有多份命名预设，本机手动绑定其中一份。 */
export class DeviceManager {
    public id = '';
    public type: DeviceType = detectDeviceType(Platform);
    public busy = false;
    public boundPresetId = '';
    private ready = false;
    private readonly storageKey = 'better-plugins-manager-device';
    private readonly disabledBindingKey = 'better-plugins-manager-disabled-binding';
    /** 本次会话里手动删除的设备，合并磁盘记录时不得复活 / IDs removed in this session. */
    private readonly removedDeviceIds = new Set<string>();
    /** 每个栏目独立记住作用域，切页不会串用其他页的选择。 */
    private selections: Partial<Record<ScopePage, string>> = {};
    private projection?: Projection;
    private syncTimer?: number;

    constructor(private readonly manager: Manager) {}
    get data(): DeviceManagement {
        const data = this.manager.settings.DEVICE_MANAGEMENT;
        if (!data) throw new Error('Device management has not been initialized');
        return data;
    }

    async initialize(): Promise<void> {
        const settings = this.manager.settings;
        const legacy = settings.DEVICE_MANAGEMENT;
        // 旧版非延迟模式以原生启用表为准；Migrate the actual non-delayed enabled state.
        if (!legacy && !settings.DELAY) {
            settings.Plugins.forEach(plugin => { plugin.enabled = this.manager.appPlugins.enabledPlugins.has(plugin.id); });
        }
        settings.DEVICE_MANAGEMENT = normalizeDeviceManagement(legacy,
            snapshotPreset(settings, { appearance: this.readLiveAppearance() }));
        if (!featureEnabled(settings, 'devices')) settings.DEVICE_MANAGEMENT.enabled = false;
        const stored = await this.loadIdentity();
        this.migrateDeviceRecord(typeof stored?.id === 'string' ? stored.id : '');
        const known = this.data.devices.find(device => device.id === this.id);
        const now = Date.now();
        if (known) {
            this.type = known.type;
            known.platform = detectSystemPlatform(Platform);
            // 每 30 分钟才刷新一次上线时间，避免三端频繁写记录文件引发同步抖动。
            if (now - known.lastSeen > 30 * 60 * 1000) known.lastSeen = now;
            if (this.isGeneratedName(known.name)) { known.name = this.detectDeviceName(); known.updatedAt = now; }
        } else {
            this.data.devices.push({ id: this.id, type: this.type, platform: detectSystemPlatform(Platform), name: this.detectDeviceName(), lastSeen: now, updatedAt: now });
        }
        this.migrateLegacyOverrides(legacy);
        this.ensureBinding(typeof stored?.presetId === 'string' ? stored.presetId : '', true);
        this.persistIdentity();
        if (this.data.enabled) {
            this.adoptIfNeeded(this.type, this.boundPresetId);
            await this.applyEffective();
        }
        this.ready = true;
        // 记录文件是跨设备的唯一通道：启动时先收别人的，再补写缺失的（含旧版 data.json 里的记录），最后写自己。
        await this.mergeDeviceRecords();
        await this.bootstrapDeviceFiles();
        await this.persistOwnDevice();
        this.startSyncTimer();
    }

    /** 设备记录不走 data.json，开启设备管理时定时轻量合并，实现双向近实时同步。 */
    private startSyncTimer(): void {
        if (this.syncTimer !== undefined) return;
        const timer = globalThis.setInterval(() => {
            if (!this.ready || this.busy || !this.data.enabled) return;
            void this.mergeDeviceRecords()
                .then(changed => { if (changed) this.manager.managerModal?.refreshDevicePanelIfOpen(); })
                .catch(error => this.report(error));
        }, 10_000);
        // Node 测试里不阻塞进程；浏览器没有 unref，保持原样。
        (timer as unknown as { unref?: () => void }).unref?.();
        this.syncTimer = timer as unknown as number;
    }

    public dispose(): void {
        if (this.syncTimer !== undefined) globalThis.clearInterval(this.syncTimer);
        this.syncTimer = undefined;
    }

    /* ---------- 预设复用 / Reuse ---------- */

    /**
     * 未配置的类型在只有一份已配置预设时自动复用；多份时留给设备页手动选择。
     * Never touches a type that already has a configured preset.
     */
    private adoptIfNeeded(type: DeviceType, preferredPresetId = ''): void {
        const own = this.presetsFor(type);
        if (own.some(preset => preset.configured)) return;
        const candidates = allPresets(this.data.presets)
            .filter(entry => entry.type !== type && entry.preset.configured)
            .map(entry => entry.preset);
        if (!candidates.length) return;
        // 优先填充本机已绑定/该类型默认预设，避免继承落到别的未配置预设。
        const target = own.find(preset => preset.id === preferredPresetId)
            ?? own.find(preset => preset.id === this.data.defaultPresets[type])
            ?? own[0];
        // 优先沿用本机当前绑定预设，否则按固定类型顺序取第一份已配置预设。
        const bound = this.boundPreset();
        const source = bound && bound.configured ? bound : candidates[0];
        if (!target || !source) return;
        const copy = clonePreset(source);
        target.plugins = copy.plugins;
        target.filters = copy.filters;
        target.ribbon = copy.ribbon;
        target.ribbonGroups = copy.ribbonGroups;
        target.ribbonEnabled = copy.ribbonEnabled;
        target.appearance = copy.appearance;
        target.configured = true;
        new Notice(this.manager.translator.t('设备_自动复用', { type: this.label(type), source: source.name }));
    }

    /** 手动复用某个预设的配置（保留目标预设的 id 与名称）。 */
    async copyConfig(targetId: string, sourceId: string): Promise<void> {
        await this.run(async () => {
            if (this.projection) await this.closeProjection();
            const target = this.presetById(targetId);
            const source = this.presetById(sourceId);
            if (!target || !source || targetId === sourceId) return;
            this.replacePresetConfig(target.preset, source.preset);
            if (this.data.enabled && targetId === this.boundPresetId) await this.applyCurrent();
            await this.manager.saveSettings({ captureDevice: false });
        });
    }

    /** Apply the current editor or its selected preset to a target preset. */
    async quickApply(targetId: string, page: ScopePage, source: 'window' | 'scope',
        parts: PresetConfigParts = ALL_PRESET_CONFIG_PARTS): Promise<void> {
        if (!parts.plugins && !parts.filters && !parts.ribbon && !parts.appearance) return;
        const scope = this.selectedScope(page);
        await this.run(async () => {
            const target = this.presetById(targetId);
            if (!target) throw new Error(this.manager.translator.t('设备_未找到'));
            let sourcePreset: DevicePreset | undefined;
            if (source === 'scope') {
                if (this.projection) await this.closeProjection();
                sourcePreset = this.presetById(scope.presetId)?.preset;
            } else {
                const current = snapshotPreset(this.manager.settings, { appearance: this.isLiveScope(scope)
                    ? this.readLiveAppearance() : this.scopeAppearance(page) }, { configured: true });
                current.filters = this.pluginFilters();
                sourcePreset = current;
                if (this.projection) await this.closeProjection();
            }
            if (!sourcePreset) throw new Error(this.manager.translator.t('设备_未找到'));
            this.applyPresetConfigParts(target.preset, sourcePreset, parts);
            if (this.data.enabled && targetId === this.boundPresetId) await this.applyCurrent();
            await this.manager.saveSettings({ captureDevice: false });
        });
    }

    /** 只覆盖用户勾选的部分，其余配置保持目标预设原样。 */
    private applyPresetConfigParts(target: DevicePreset, source: DevicePreset, parts: PresetConfigParts): void {
        const copy = clonePreset(source);
        if (parts.plugins) target.plugins = copy.plugins;
        if (parts.filters) target.filters = copy.filters;
        if (parts.ribbon) {
            target.ribbon = copy.ribbon;
            target.ribbonGroups = copy.ribbonGroups;
            target.ribbonEnabled = copy.ribbonEnabled;
        }
        if (parts.appearance) target.appearance = copy.appearance;
        target.configured = true;
    }

    private replacePresetConfig(target: DevicePreset, source: DevicePreset): void {
        const copy = clonePreset(source);
        target.plugins = copy.plugins;
        target.filters = copy.filters;
        target.ribbon = copy.ribbon;
        target.ribbonGroups = copy.ribbonGroups;
        target.ribbonEnabled = copy.ribbonEnabled;
        target.appearance = copy.appearance;
        target.configured = true;
    }

    label(type: DeviceType): string { return this.manager.translator.t(`设备_${type}`); }

    /** 设备默认名：桌面取主机名，移动端取型号；都取不到才回落类型名。 */
    private detectDeviceName(): string {
        return this.readHostname() || this.readMobileModel() || this.label(this.type);
    }
    private readHostname(): string {
        if (!Platform.isDesktopApp) return '';
        try {
            const nodeRequire = (globalThis as { require?: (id: string) => unknown }).require;
            const os = nodeRequire?.('os') as { hostname?: () => string } | undefined;
            return String(os?.hostname?.() || '').trim();
        } catch (error) {
            if (this.manager.settings.DEBUG) console.error('[BPM] Hostname unavailable', error);
            return '';
        }
    }
    /** 仅用于没有原生 API 的硬件型号；OS 判定仍以 Platform 为准。 */
    private readMobileModel(): string {
        if (!Platform.isMobileApp) return '';
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        if (Platform.isIosApp || /iPhone|iPad|iPod/.test(ua)) {
            if (Platform.isTablet || /iPad/.test(ua)) return 'iPad';
            return /iPod/.test(ua) ? 'iPod' : 'iPhone';
        }
        if (/Android/i.test(ua)) {
            const block = (ua.match(/\(([^)]*)\)/) || [])[1] || '';
            const segments = block.split(';').map(segment => segment.trim());
            const androidIndex = segments.findIndex(segment => /^Android\s/i.test(segment));
            for (let index = androidIndex >= 0 ? androidIndex + 1 : 0; index < segments.length; index += 1) {
                const segment = segments[index];
                if (!segment || /^wv$/i.test(segment) || /^[a-z]{2}(-[A-Za-z]{2})?$/.test(segment)) continue;
                return segment.replace(/\s*Build\/.*$/i, '').trim();
            }
        }
        return '';
    }
    /** 空名或三种语言的类型名都视为自动生成，允许升级；用户命名保持不动。 */
    private isGeneratedName(name: string): boolean {
        const trimmed = (name || '').trim();
        if (!trimmed) return true;
        const generated = new Set(['Computer', 'Tablet', 'Phone', '电脑', '平板', '手机']);
        for (const type of DEVICE_TYPES) generated.add(this.label(type));
        return generated.has(trimmed);
    }

    /* ---------- 预设与绑定 / Presets and binding ---------- */

    presetsFor(type: DeviceType): DevicePreset[] { return this.data.presets[type]; }
    presetById(id: string): { type: DeviceType; preset: DevicePreset } | null { return findPreset(this.data.presets, id); }
    boundPreset(): DevicePreset | null {
        return this.presetById(this.boundPresetId)?.preset ?? null;
    }
    /** 平台标识刷新时把旧记录迁到新 id，避免设备列表累积幽灵条目。 */
    private migrateDeviceRecord(previousId: string): void {
        if (!previousId || previousId === this.id) return;
        const devices = this.data.devices;
        const previous = devices.find(device => device.id === previousId);
        if (!previous) return;
        const current = devices.find(device => device.id === this.id);
        if (current) {
            // 新 id 已有记录：旧记录是同一安装的上一身份，直接移除。
            this.data.devices = devices.filter(device => device !== previous);
            return;
        }
        previous.id = this.id;
    }

    /** 本机没有可绑定的预设时，回落到该类型的第一份。 */
    private ensureBinding(storedPresetId: string, notifyFallback = false): void {
        const found = storedPresetId ? this.presetById(storedPresetId) : null;
        if (found && found.type === this.type) { this.boundPresetId = found.preset.id; return; }
        const fallback = this.defaultPreset(this.type);
        this.boundPresetId = fallback?.id ?? '';
        if (notifyFallback && storedPresetId && fallback) {
            new Notice(this.manager.translator.t('设备_预设回退', { name: fallback.name }));
        }
    }
    async bindPreset(id: string): Promise<void> {
        await this.run(async () => {
            const found = this.presetById(id);
            if (!found) throw new Error(this.manager.translator.t('设备_未找到'));
            await this.closeProjection();
            if (found.type !== this.type) {
                this.type = found.type;
                const device = this.data.devices.find(item => item.id === this.id);
                if (device) device.type = found.type;
            }
            this.boundPresetId = found.preset.id;
            this.selections = {};
            this.adoptIfNeeded(found.type, this.boundPresetId);
            this.persistIdentity();
            if (this.data.enabled) await this.applyCurrent();
            await this.manager.saveSettings({ captureDevice: false });
        });
    }

    /** 默认预设仅控制新绑定与回退，不覆盖已有绑定；Defaults preserve explicit bindings. */
    defaultPreset(type: DeviceType): DevicePreset {
        return this.presetsFor(type).find(preset => preset.id === this.data.defaultPresets[type]) ?? this.presetsFor(type)[0];
    }
    async setDefaultPreset(id: string): Promise<void> {
        await this.run(async () => {
            const found = this.presetById(id);
            if (!found) throw new Error(this.manager.translator.t('设备_未找到'));
            const previous = this.data.defaultPresets[found.type];
            this.data.defaultPresets[found.type] = id;
            try { await this.manager.saveSettings(); }
            catch (error) { this.data.defaultPresets[found.type] = previous; throw error; }
        });
    }
    async createPreset(type: DeviceType, sourceId?: string): Promise<string | null> {
        return this.run(async () => {
            const list = this.presetsFor(type);
            const bound = list.find(item => item.id === this.boundPresetId);
            const source = (sourceId ? list.find(item => item.id === sourceId) : undefined) ?? bound ?? list[0];
            const base = source ? clonePreset(source) : snapshotPreset(this.manager.settings, { appearance: this.readLiveAppearance() });
            const id = `preset-${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            list.push({ ...base, id, name: this.uniquePresetName(type, `${this.label(type)} ${list.length + 1}`), configured: true });
            this.data.presets[type] = list;
            await this.manager.saveSettings({ captureDevice: false });
            return id;
        });
    }
    async duplicatePreset(id: string): Promise<string | null> {
        return this.run(async () => {
            const found = this.presetById(id);
            if (!found) return null;
            const list = this.presetsFor(found.type);
            const copyId = `preset-${found.type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            const name = this.uniquePresetName(found.type, `${found.preset.name} ${this.manager.translator.t('设备_副本后缀')}`);
            list.push({ ...clonePreset(found.preset), id: copyId, name, configured: true });
            this.data.presets[found.type] = list;
            await this.manager.saveSettings({ captureDevice: false });
            return copyId;
        });
    }
    private uniquePresetName(type: DeviceType, base: string): string {
        const names = new Set(this.presetsFor(type).map(preset => preset.name));
        if (!names.has(base)) return base;
        let index = 2;
        while (names.has(`${base} ${index}`)) index += 1;
        return `${base} ${index}`;
    }
    async renamePreset(id: string, name: string): Promise<void> {
        const found = this.presetById(id);
        if (!found || !name.trim()) throw new Error(this.manager.translator.t('设备_名称为空'));
        found.preset.name = name.trim();
        await this.manager.saveSettings();
    }
    async deletePreset(id: string): Promise<void> {
        await this.run(async () => {
            const found = this.presetById(id);
            if (!found) return;
            const list = this.presetsFor(found.type);
            if (list.length <= 1) throw new Error(this.manager.translator.t('设备_至少保留预设'));
            this.data.presets[found.type] = list.filter(item => item.id !== id);
            if (this.data.defaultPresets[found.type] === id) this.data.defaultPresets[found.type] = this.presetsFor(found.type)[0].id;
            if (this.boundPresetId === id) {
                this.boundPresetId = this.defaultPreset(found.type).id;
                this.persistIdentity();
                if (this.data.enabled) await this.applyCurrent();
            }
            for (const page of Object.keys(this.selections) as ScopePage[]) {
                if (this.selections[page] === scopeKey(id)) delete this.selections[page];
            }
            await this.manager.saveSettings({ captureDevice: false });
        });
    }

    /** 外部 data.json 合并后校验绑定；预设可能在另一台设备被删除。 */
    public reconcileAfterExternal(): void {
        if (!this.ready) return;
        const bound = this.boundPresetId ? this.presetById(this.boundPresetId) : null;
        if (bound && bound.type === this.type) return;
        this.ensureBinding(this.boundPresetId, true);
        this.selections = {};
        this.persistIdentity();
    }

    /** 筛选只影响视图，不能触发运行态重载；View filters must not reapply plugin/theme/Ribbon state. */
    public boundRuntimeFingerprint(): string {
        const bound = this.boundPreset();
        if (!bound) return '';
        return settingsFingerprint([bound.plugins, bound.ribbon, bound.ribbonGroups, bound.ribbonEnabled, bound.appearance]);
    }

    effectiveForScope(scope: DeviceScope): DevicePreset {
        const preset = clonePreset(this.presetById(scope.presetId)?.preset ?? this.defaultPreset(scope.type));
        preset.plugins = this.manager.overview.effectivePlugins(preset.plugins, scope.presetId);
        preset.appearance = this.manager.overview.effectiveAppearance(preset.appearance, scope.presetId);
        return preset;
    }
    isLiveScope(scope: DeviceScope): boolean { return scope.presetId === this.boundPresetId; }
    isProjectingForeign(page?: ScopePage): boolean {
        if (!this.projection) return false;
        return page ? this.projection.page === page : true;
    }

    /* ---------- 作用域选择 / Scope selection ---------- */

    scopeOptions(): DeviceScope[] {
        const options: DeviceScope[] = [];
        for (const type of DEVICE_TYPES) {
            for (const preset of this.presetsFor(type)) {
                options.push({ key: scopeKey(preset.id), type, presetId: preset.id });
            }
        }
        return options;
    }
    scopeLabel(scope: DeviceScope): string {
        const preset = this.presetById(scope.presetId)?.preset;
        const name = preset?.name || scope.presetId;
        return `${name} · ${this.label(scope.type)}`;
    }
    selectedScopeKey(page: ScopePage): string {
        const selected = this.selections[page];
        const parsed = selected ? parseScopeKey(selected) : null;
        if (parsed && selected && this.presetById(parsed.presetId)) return selected;
        return scopeKey(this.boundPresetId);
    }
    selectedScope(page: ScopePage): DeviceScope {
        const parsed = parseScopeKey(this.selectedScopeKey(page));
        const found = parsed ? this.presetById(parsed.presetId) : null;
        if (found) return { key: scopeKey(found.preset.id), type: found.type, presetId: found.preset.id };
        const fallback = this.presetsFor(this.type)[0];
        return { key: scopeKey(fallback.id), type: this.type, presetId: fallback.id };
    }

    /** 切换一栏的编辑作用域：先落盘旧作用域，再投影新作用域。 */
    async selectScope(page: ScopePage, key: string): Promise<void> {
        const parsed = parseScopeKey(key);
        const found = parsed ? this.presetById(parsed.presetId) : null;
        if (!found) return;
        const scope: DeviceScope = { key: scopeKey(found.preset.id), type: found.type, presetId: found.preset.id };
        await this.run(async () => {
            await this.closeProjection();
            this.selections[page] = scope.key;
            if (this.data.enabled && !this.isLiveScope(scope)) this.project(scope, page);
            await this.manager.saveSettings({ captureDevice: false });
        });
    }

    private project(scope: DeviceScope, page: ScopePage): void {
        const settings = this.manager.settings;
        this.projection = {
            page,
            scope,
            live: {
                ribbon: settings.RIBBON_SETTINGS.map(item => ({ ...item, ribbonIdMap: item.ribbonIdMap ? { ...item.ribbonIdMap } : undefined })),
                ribbonGroups: normalizeRibbonGroups(settings.RIBBON_GROUPS),
                ribbonEnabled: settings.RIBBON_MANAGER_ENABLED,
                plugins: this.pluginStates(),
                filters: this.pluginFilters(),
            },
        };
        const preset = this.effectiveForScope(scope);
        settings.RIBBON_SETTINGS = preset.ribbon.map(item => ({ ...item, ribbonIdMap: item.ribbonIdMap ? { ...item.ribbonIdMap } : undefined }));
        settings.RIBBON_GROUPS = normalizeRibbonGroups(preset.ribbonGroups);
        settings.RIBBON_MANAGER_ENABLED = preset.ribbonEnabled;
        for (const plugin of settings.Plugins) {
            const state = Object.prototype.hasOwnProperty.call(preset.plugins, plugin.id) ? preset.plugins[plugin.id] : undefined;
            if (state) { plugin.enabled = state.enabled; plugin.delay = state.delay; }
        }
        this.restorePluginFilters(preset.filters);
    }

    /** 关闭投影：把外域改动写回该预设，并恢复本机实时值。 */
    async closeProjection(): Promise<void> {
        const projection = this.projection;
        if (!projection) return;
        const settings = this.manager.settings;
        this.projection = undefined;
        this.storeSnapshot(projection.scope.presetId, {
            ribbon: settings.RIBBON_SETTINGS,
            ribbonGroups: settings.RIBBON_GROUPS,
            ribbonEnabled: settings.RIBBON_MANAGER_ENABLED,
            plugins: this.pluginStates(),
            filters: this.pluginFilters(),
        }, projection.live);
        this.restoreLive(projection.live);
        await this.manager.saveSettings({ captureDevice: false });
    }

    /** 离开带作用域的栏目时恢复本机视图；Switch pages restore live values. */
    noteActivePage(page: string): void {
        if (this.projection && this.projection.page !== page) void this.closeProjection().catch(error => this.report(error));
    }
    /** 栏目重新渲染时补投影，避免从其他页返回后丢掉外域视图。 */
    ensureProjection(page: ScopePage): void {
        if (!this.ready || !this.data.enabled) return;
        const scope = this.selectedScope(page);
        if (this.isLiveScope(scope)) return;
        if (this.projection) return;
        this.project(scope, page);
    }
    async flushProjection(): Promise<void> { await this.closeProjection(); }

    private restoreLive(live: LiveSnapshot): void {
        const settings = this.manager.settings;
        settings.RIBBON_SETTINGS = live.ribbon;
        settings.RIBBON_GROUPS = live.ribbonGroups;
        settings.RIBBON_MANAGER_ENABLED = live.ribbonEnabled;
        this.restorePluginFilters(live.filters);
        for (const plugin of settings.Plugins) {
            const state = live.plugins[plugin.id];
            if (state) { plugin.enabled = state.enabled; plugin.delay = state.delay; }
        }
    }

    /**
     * live 仅在投影时传入：预设里没有记录的插件，只有用户在外域明确改过才写入，
     * 避免「仅保存」打开一次就把本机的插件状态带进另一台设备的预设。
     */
    private storeSnapshot(presetId: string, snapshot: LiveSnapshot, live?: LiveSnapshot): void {
        const found = this.presetById(presetId);
        if (!found) return;
        const before = JSON.stringify([found.preset.plugins, found.preset.filters, found.preset.ribbon, found.preset.ribbonGroups, found.preset.ribbonEnabled]);
        found.preset.ribbon = cloneRibbon(snapshot.ribbon);
        found.preset.ribbonGroups = normalizeRibbonGroups(snapshot.ribbonGroups);
        found.preset.ribbonEnabled = snapshot.ribbonEnabled;
        const nextPlugins = this.manager.overview.persistentPlugins(snapshot.plugins, presetId);
        const mergedPlugins = { ...found.preset.plugins };
        for (const [id, state] of Object.entries(nextPlugins)) {
            const known = Object.prototype.hasOwnProperty.call(found.preset.plugins, id);
            const baseline = live?.plugins[id];
            const edited = Boolean(live) && (!baseline || baseline.enabled !== state.enabled || baseline.delay !== state.delay);
            if (known || edited) mergedPlugins[id] = state;
        }
        found.preset.plugins = mergedPlugins;
        found.preset.filters = snapshot.filters;
        if (!found.preset.configured && before !== JSON.stringify([found.preset.plugins, found.preset.filters, found.preset.ribbon, found.preset.ribbonGroups, found.preset.ribbonEnabled])) {
            found.preset.configured = true;
        }
    }

    /** 捕获时只有值真的变了才标记“已配置”，避免空保存把新类型锁死。 */
    private captureInto(preset: DevicePreset, extras: { appearance?: ScopedAppearance }, markConfigured = true): void {
        const before = JSON.stringify([preset.plugins, preset.filters, preset.ribbon, preset.ribbonGroups, preset.ribbonEnabled, preset.appearance]);
        capturePreset(preset, this.manager.settings, extras);
        preset.plugins = this.manager.overview.persistentPlugins(preset.plugins, preset.id);
        preset.appearance = this.manager.overview.persistentAppearance(preset.appearance, preset.id);
        preset.filters = this.pluginFilters();
        if (markConfigured && !preset.configured && before !== JSON.stringify([preset.plugins, preset.filters, preset.ribbon, preset.ribbonGroups, preset.ribbonEnabled, preset.appearance])) {
            preset.configured = true;
        }
    }

    private pluginStates(): Record<string, DevicePluginState> {
        return Object.fromEntries(this.manager.settings.Plugins.map(plugin => [plugin.id, { enabled: plugin.enabled, delay: plugin.delay }]));
    }
    private pluginFilters(): DevicePluginFilters {
        const active = this.manager.managerModal?.getCurrentDeviceFilters();
        if (active) return active;
        const settings = this.manager.settings;
        const values = (items: string[] | undefined, fallback: string): string[] => [...(items?.length ? items : [fallback]).filter(Boolean)];
        return {
            search: settings.FILTER_SEARCH || '',
            status: values(settings.FILTER_STATUS_VALUES, settings.FILTER_STATUS || 'all'), statusOperator: settings.FILTER_STATUS_OPERATOR,
            group: values(settings.FILTER_GROUP_VALUES, settings.FILTER_GROUP || ''), groupOperator: settings.FILTER_GROUP_OPERATOR,
            tag: values(settings.FILTER_TAG_VALUES, settings.FILTER_TAG || ''), tagOperator: settings.FILTER_TAG_OPERATOR,
            delay: values(settings.FILTER_DELAY_VALUES, settings.FILTER_DELAY || ''), delayOperator: settings.FILTER_DELAY_OPERATOR,
        };
    }
    private restorePluginFilters(filters: DevicePluginFilters): void {
        const settings = this.manager.settings;
        settings.FILTER_SEARCH = filters.search;
        settings.FILTER_STATUS_VALUES = [...filters.status]; settings.FILTER_STATUS = filters.status[0] || 'all';
        settings.FILTER_STATUS_OPERATOR = filters.statusOperator;
        settings.FILTER_GROUP_VALUES = [...filters.group]; settings.FILTER_GROUP = filters.group[0] || '';
        settings.FILTER_GROUP_OPERATOR = filters.groupOperator;
        settings.FILTER_TAG_VALUES = [...filters.tag]; settings.FILTER_TAG = filters.tag[0] || '';
        settings.FILTER_TAG_OPERATOR = filters.tagOperator;
        settings.FILTER_DELAY_VALUES = [...filters.delay]; settings.FILTER_DELAY = filters.delay[0] || '';
        settings.FILTER_DELAY_OPERATOR = filters.delayOperator;
        this.manager.managerModal?.usePersistedFiltersAsSessionFilters();
    }

    /* ---------- 外观作用域 / Scoped appearance ---------- */

    readLiveAppearance(): ScopedAppearance {
        const customCss = this.customCss();
        const theme = customCss?.theme || (customCss as { getTheme?(): string } | undefined)?.getTheme?.() || '';
        const enabled = customCss?.enabledSnippets;
        const snippets: Record<string, boolean> = {};
        const list = enabled instanceof Set ? [...enabled] : Array.isArray(enabled) ? enabled : [];
        for (const id of list) if (typeof id === 'string') snippets[id] = true;
        return { theme, snippets };
    }
    scopeAppearance(page: ScopePage): ScopedAppearance {
        return cloneAppearance(this.effectiveForScope(this.selectedScope(page)).appearance);
    }
    /** 读写当前栏目的外观状态：外域只存储，本机实时应用。 */
    writeAppearance(page: ScopePage, patch: { theme?: string; snippets?: Record<string, boolean> }): Promise<void> {
        if (page === 'themes') return this.run(() => this.manager.overview.writeAppearance(patch));
        return this.run(async () => {
            const scope = this.selectedScope(page);
            const live = this.isLiveScope(scope);
            if (live) {
                if (typeof patch.theme === 'string') this.customCss()?.setTheme?.(patch.theme);
                for (const [snippetId, enabled] of Object.entries(patch.snippets ?? {})) {
                    this.customCss()?.setCssEnabledStatus?.(snippetId, enabled);
                }
            }
            const next = live ? { ...this.readLiveAppearance() } : this.scopeAppearance(page);
            if (typeof patch.theme === 'string') next.theme = patch.theme;
            Object.assign(next.snippets, patch.snippets ?? {});
            const found = this.presetById(scope.presetId);
            if (found) {
                found.preset.appearance = cloneAppearance(next);
                found.preset.configured = true;
            }
            await this.manager.saveSettings({ captureDevice: false });
        });
    }

    /* ---------- 捕获 / Capture ---------- */

    capture(): void {
        if (!this.ready || !this.data.enabled || this.busy) return;
        const projection = this.projection;
        if (projection) {
            this.storeSnapshot(projection.scope.presetId, {
                ribbon: this.manager.settings.RIBBON_SETTINGS,
                ribbonGroups: this.manager.settings.RIBBON_GROUPS,
                ribbonEnabled: this.manager.settings.RIBBON_MANAGER_ENABLED,
                plugins: this.pluginStates(),
                filters: this.pluginFilters(),
            }, projection.live);
            return;
        }
        const bound = this.boundPreset();
        if (bound) this.captureInto(bound, { appearance: this.readLiveAppearance() });
    }

    /** 保存时写回的“本机真实值”；投影期间不能让外域值污染 data.json。 */
    persistedSettings(): Manager['settings'] {
        const raw = this.buildPersistedSettings();
        const states = this.manager.overview.persistentPlugins(Object.fromEntries(raw.Plugins.map(plugin =>
            [plugin.id, { enabled: plugin.enabled, delay: plugin.delay }])), this.boundPresetId);
        const persisted = { ...raw, Plugins: raw.Plugins.map(plugin => ({ ...plugin, ...states[plugin.id] })) };
        // 设备记录只走独立文件；写进 data.json 会让三端互相覆盖并触发同步抖动。
        const management = persisted.DEVICE_MANAGEMENT;
        if (!management) return persisted;
        return { ...persisted, DEVICE_MANAGEMENT: { ...management, devices: [] } };
    }

    private buildPersistedSettings(): Manager['settings'] {
        if (!this.projection) return this.manager.settings;
        const settings = this.manager.settings;
        return {
            ...settings,
            Plugins: settings.Plugins.map(plugin => {
                const live = this.projection?.live.plugins[plugin.id];
                return live ? { ...plugin, enabled: live.enabled, delay: live.delay } : plugin;
            }),
            RIBBON_SETTINGS: this.projection.live.ribbon,
            RIBBON_GROUPS: this.projection.live.ribbonGroups,
            RIBBON_MANAGER_ENABLED: this.projection.live.ribbonEnabled,
            FILTER_SEARCH: this.projection.live.filters.search,
            FILTER_STATUS: this.projection.live.filters.status[0] || 'all',
            FILTER_STATUS_VALUES: this.projection.live.filters.status,
            FILTER_STATUS_OPERATOR: this.projection.live.filters.statusOperator,
            FILTER_GROUP: this.projection.live.filters.group[0] || '',
            FILTER_GROUP_VALUES: this.projection.live.filters.group,
            FILTER_GROUP_OPERATOR: this.projection.live.filters.groupOperator,
            FILTER_TAG: this.projection.live.filters.tag[0] || '',
            FILTER_TAG_VALUES: this.projection.live.filters.tag,
            FILTER_TAG_OPERATOR: this.projection.live.filters.tagOperator,
            FILTER_DELAY: this.projection.live.filters.delay[0] || '',
            FILTER_DELAY_VALUES: this.projection.live.filters.delay,
            FILTER_DELAY_OPERATOR: this.projection.live.filters.delayOperator,
        };
    }

    /* ---------- 身份 / Identity ---------- */

    private persistIdentity(): void {
        const storage = this.manager.app as unknown as LocalStorageApp;
        storage.saveLocalStorage(this.storageKey, { id: this.id, type: this.type,
            platformId: this.platformIdentity, presetId: this.boundPresetId });
    }
    private platformIdentity = '';

    private async loadIdentity(): Promise<StoredIdentity | undefined> {
        const storage = this.manager.app as unknown as LocalStorageApp;
        let stored: StoredIdentity | undefined;
        try {
            const value = storage.loadLocalStorage(this.storageKey);
            if (typeof value === 'object' && value !== null) stored = value as StoredIdentity;
        } catch (error) {
            this.report(error);
        }
        const platformId = await this.readPlatformIdentity();
        this.platformIdentity = platformId;
        const storedId = typeof stored?.id === 'string' && stored.id ? stored.id : '';
        const storedPlatform = typeof stored?.platformId === 'string' ? stored.platformId : '';
        if (platformId && storedPlatform === platformId && storedId) this.id = storedId;
        else if (platformId) this.id = `device-${platformId.slice(0, 24)}`;
        else if (storedId) this.id = storedId;
        else this.id = this.randomId();
        this.type = stored && isDeviceType(stored.type) ? stored.type : detectDeviceType(Platform);
        return stored;
    }

    /** 旧版单设备覆盖一次性合并进对应类型的首份预设。 */
    private migrateLegacyOverrides(legacy: unknown): void {
        const rawDevices = (legacy as { devices?: unknown } | undefined)?.devices;
        if (!Array.isArray(rawDevices)) return;
        const raw = rawDevices.find(item => (item as { id?: unknown })?.id === this.id) as
            { overrides?: Record<string, unknown> } | undefined;
        const overrides = raw?.overrides;
        if (!overrides) return;
        const target = this.presetsFor(this.type)[0];
        if (!target) return;
        const plugins = overrides.plugins as Record<string, { enabled?: unknown; delay?: unknown }> | undefined;
        if (plugins && typeof plugins === 'object') {
            for (const [id, state] of Object.entries(plugins)) {
                if (!state || typeof state.enabled !== 'boolean') continue;
                target.plugins[id] = { enabled: state.enabled, delay: typeof state.delay === 'string' ? state.delay : '' };
            }
        }
        if (Array.isArray(overrides.ribbon)) {
            const ribbon = overrides.ribbon as unknown[];
            if (ribbon.every(item => item && typeof item === 'object')) target.ribbon = cloneRibbon(ribbon as RibbonItem[]);
        }
        if (typeof overrides.ribbonEnabled === 'boolean') target.ribbonEnabled = overrides.ribbonEnabled;
        const appearance = overrides.appearance as { theme?: unknown; snippets?: unknown } | undefined;
        if (appearance && typeof appearance === 'object') {
            if (typeof appearance.theme === 'string') target.appearance.theme = appearance.theme;
            if (appearance.snippets && typeof appearance.snippets === 'object') {
                for (const [id, enabled] of Object.entries(appearance.snippets as Record<string, unknown>)) {
                    if (typeof enabled === 'boolean') target.appearance.snippets[id] = enabled;
                }
            }
        }
        target.configured = true;
        if (this.manager.settings.DEBUG) console.log('[BPM] Migrated legacy device overrides into preset', target.id);
    }

    /** 移动端用 Capacitor 的设备标识做稳定身份；桌面端没有该插件。 */
    private async readPlatformIdentity(): Promise<string> {
        try {
            const capacitor = (globalThis as { Capacitor?: { Plugins?: { Device?: CapacitorDevice } } }).Capacitor;
            const identifier = await capacitor?.Plugins?.Device?.getId?.();
            const value = identifier?.identifier;
            if (typeof value !== 'string' || !value) return '';
            return await this.hashIdentity(value);
        } catch (error) {
            if (this.manager.settings.DEBUG) console.error('[BPM] Platform identity unavailable', error);
            return '';
        }
    }
    private async hashIdentity(value: string): Promise<string> {
        const prefix = Platform.isMobileApp ? (Platform.isAndroidApp ? 'android' : 'ios') : 'desktop';
        const input = `${prefix}:${value}`;
        const subtle = globalThis.crypto?.subtle;
        if (subtle) {
            const data = new TextEncoder().encode(input);
            const digest = await subtle.digest('SHA-256', data);
            return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        }
        let hash = 0x811c9dc5;
        for (let index = 0; index < input.length; index += 1) {
            hash ^= input.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, '0').repeat(4);
    }
    private randomId(): string {
        return typeof globalThis.crypto?.randomUUID === 'function'
            ? globalThis.crypto.randomUUID()
            : `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
    private customCss(): CustomCssLike | undefined {
        return (this.manager.app as unknown as { customCss?: CustomCssLike }).customCss;
    }

    report(error: unknown): void {
        if (this.manager.settings.DEBUG) console.error('[BPM] Device management failed', error);
        const message = error instanceof Error ? error.message : this.manager.translator.t('通用_失败_文本');
        new Notice(`${this.manager.translator.t('设备_失败')}: ${message}`);
    }

    /** 统一串行入口，阻止连续触控交叉应用；Serialize all preset mutations. */
    async run<T>(task: () => Promise<T>): Promise<T> {
        if (this.busy) throw new Error(this.manager.translator.t('设备_忙碌'));
        this.busy = true;
        try { return await task(); } finally { this.busy = false; }
    }

    private localStore(): { load(key: string): unknown; save(key: string, value: unknown): void } | null {
        const storage = this.manager.app as unknown as {
            loadLocalStorage?: (key: string) => unknown;
            saveLocalStorage?: (key: string, value: unknown) => void;
        };
        const load = storage.loadLocalStorage;
        const save = storage.saveLocalStorage;
        if (typeof load !== 'function' || typeof save !== 'function') return null;
        return { load: key => load.call(storage, key), save: (key, value) => save.call(storage, key, value) };
    }

    /** 关闭设备管理时保留“当时绑定预设”的快照，重开时做三方合并。 */
    private rememberDisabledBinding(): void {
        const bound = this.boundPreset();
        const store = this.localStore();
        if (!bound || !store) return;
        try {
            store.save(this.disabledBindingKey, { presetId: bound.id, base: clonePreset(bound) });
        } catch (error) { this.report(error); }
    }

    private takeDisabledBinding(): { presetId: string; base: DevicePreset } | null {
        const store = this.localStore();
        if (!store) return null;
        let raw: unknown;
        try {
            raw = store.load(this.disabledBindingKey);
            store.save(this.disabledBindingKey, null);
        } catch (error) { this.report(error); return null; }
        const record = asRecord(raw);
        if (!record || typeof record.presetId !== 'string') return null;
        const base = asRecord(record.base);
        if (!base || !asRecord(base.plugins) || !Array.isArray(base.ribbon) || !Array.isArray(base.ribbonGroups)
            || !asRecord(base.filters) || !asRecord(base.appearance)) return null;
        try { return { presetId: record.presetId, base: clonePreset(base as unknown as DevicePreset) }; }
        catch (error) { this.report(error); return null; }
    }

    /** 重开设备管理：本机关闭期间的改动与远端对预设的改动都保留，冲突时本机优先。 */
    private mergeDisabledBinding(): void {
        const saved = this.takeDisabledBinding();
        if (!saved || saved.presetId !== this.boundPresetId) return;
        const target = this.presetById(saved.presetId)?.preset;
        if (!target) return;
        try {
            const local = snapshotPreset(this.manager.settings, { appearance: this.readLiveAppearance() },
                { id: target.id, name: target.name, configured: true });
            const merged = mergeSettings(saved.base as unknown as object, local as unknown as object,
                target as unknown as object) as unknown as DevicePreset;
            const before = JSON.stringify([target.plugins, target.filters, target.ribbon, target.ribbonGroups, target.ribbonEnabled, target.appearance]);
            target.plugins = merged.plugins;
            target.filters = merged.filters;
            target.ribbon = merged.ribbon;
            target.ribbonGroups = merged.ribbonGroups;
            target.ribbonEnabled = merged.ribbonEnabled;
            target.appearance = merged.appearance;
            const changed = before !== JSON.stringify([target.plugins, target.filters, target.ribbon, target.ribbonGroups, target.ribbonEnabled, target.appearance]);
            if (changed) {
                target.configured = true;
                new Notice(this.manager.translator.t('设备_关闭期间已合并'), 6000);
            }
        } catch (error) { this.report(error); }
    }

    async setEnabled(enabled: boolean): Promise<void> {
        await this.run(async () => {
            await this.closeProjection();
            const previous = this.data.enabled;
            if (!enabled && previous) this.rememberDisabledBinding();
            if (enabled && !previous) this.mergeDisabledBinding();
            this.data.enabled = enabled;
            try { await this.manager.saveSettings({ captureDevice: false }); }
            catch (error) { this.data.enabled = previous; throw error; }
            if (enabled) {
                this.ensureBinding(this.boundPresetId, true);
                this.adoptIfNeeded(this.type, this.boundPresetId);
                await this.applyCurrent();
            }
        });
    }

    async savePresetById(id: string, preset: DevicePreset): Promise<void> {
        await this.run(async () => {
            const found = this.presetById(id);
            if (!found) throw new Error(this.manager.translator.t('设备_未找到'));
            const previous = found.preset;
            this.data.presets[found.type] = this.presetsFor(found.type).map(item => item.id === id ? clonePreset(preset) : item);
            try { await this.manager.saveSettings({ captureDevice: false }); }
            catch (error) {
                this.data.presets[found.type] = this.presetsFor(found.type).map(item => item.id === id ? previous : item);
                throw error;
            }
            if (this.data.enabled && id === this.boundPresetId) await this.applyCurrent();
        });
    }

    async assign(id: string, type: DeviceType): Promise<void> {
        await this.run(async () => {
            await this.closeProjection();
            const device = this.data.devices.find(item => item.id === id);
            if (!device) throw new Error(this.manager.translator.t('设备_未找到'));
            const previous = device.type;
            const previousType = this.type;
            const previousPreset = this.boundPresetId;
            const previousSelections = { ...this.selections };
            if (id === this.id) {
                if (this.data.enabled) {
                    const bound = this.boundPreset();
                    if (bound) this.captureInto(bound, { appearance: this.readLiveAppearance() }, false);
                }
                this.type = type;
                this.adoptIfNeeded(type);
                this.ensureBinding(this.boundPresetId);
                this.selections = {};
                this.persistIdentity();
            }
            device.type = type;
            if (id === this.id) device.updatedAt = Date.now();
            if (id === this.id) await this.persistOwnDevice();
            try { await this.manager.saveSettings({ captureDevice: false }); }
            catch (error) {
                device.type = previous;
                this.type = previousType;
                this.boundPresetId = previousPreset;
                this.selections = previousSelections;
                if (id === this.id) {
                    try { this.persistIdentity(); } catch (storageError) { this.report(storageError); }
                }
                throw error;
            }
            if (id === this.id && this.data.enabled) await this.applyCurrent();
        });
    }

    async rename(id: string, name: string): Promise<void> {
        const device = this.data.devices.find(item => item.id === id);
        if (!device || !name.trim()) throw new Error(this.manager.translator.t('设备_名称为空'));
        device.name = name.trim();
        device.updatedAt = Date.now();
        // 只有本机记录由本机写盘，改名其他设备保持本地展示。
        if (id === this.id) await this.persistOwnDevice();
        await this.manager.saveSettings();
    }

    async remove(id: string): Promise<void> {
        if (id === this.id) return;
        this.removedDeviceIds.add(id);
        this.data.devices = this.data.devices.filter(device => device.id !== id);
        await this.removeDeviceFile(id);
        await this.manager.saveSettings();
    }

    /* ---------- 设备记录文件 / Device record files ---------- */

    /** 设备记录归入用户数据目录；兼容读取旧版配置根目录。 */
    private deviceFilePath(id: string): string | undefined {
        const configDir = this.manager.app?.vault?.configDir;
        if (!configDir) return undefined;
        return pluginStorage(this.manager).path('data', `devices/${encodeURIComponent(id)}.json`);
    }

    private deviceFilePrefix(): string | undefined {
        const configDir = this.manager.app?.vault?.configDir;
        if (!configDir) return undefined;
        return `${pluginStorage(this.manager).root}/data/devices/`;
    }

    private async writeDeviceFile(device: ManagedDevice): Promise<void> {
        const path = this.deviceFilePath(device.id);
        const adapter = this.manager.app?.vault?.adapter;
        if (!path || !adapter) return;
        const serialized = JSON.stringify(device, null, 2);
        try {
            await pluginStorage(this.manager).write('data', `devices/${encodeURIComponent(device.id)}.json`, serialized);
        } catch (error) { this.report(error); }
    }

    private async removeDeviceFile(id: string): Promise<void> {
        const path = this.deviceFilePath(id);
        const adapter = this.manager.app?.vault?.adapter;
        if (!path || !adapter) return;
        try {
            if (await adapter.exists(path)) await adapter.remove(path);
            const legacy = `${this.manager.app.vault.configDir}/better-plugins-manager-device-${id}.json`;
            if (/^[a-zA-Z0-9._-]{1,128}$/.test(id) && await adapter.exists(legacy)) await adapter.remove(legacy);
        } catch (error) { this.report(error); }
    }

    /** 本机记录与名称/类型变化后立即写盘，其他设备才能同步到。 */
    private async persistOwnDevice(): Promise<void> {
        const own = this.data.devices.find(device => device.id === this.id);
        if (own) await this.writeDeviceFile(own);
    }

    /** 旧版设备记录只存在 data.json；升级后补写记录文件，避免它们从列表消失。 */
    private async bootstrapDeviceFiles(): Promise<void> {
        const adapter = this.manager.app?.vault?.adapter;
        if (!adapter) return;
        for (const device of this.data.devices) {
            if (this.removedDeviceIds.has(device.id)) continue;
            const path = this.deviceFilePath(device.id);
            if (!path) return;
            try {
                if (!(await adapter.exists(path))) await this.writeDeviceFile(device);
            } catch (error) { this.report(error); }
        }
    }

    /**
     * 读取其他设备写入的记录文件并并回内存。
     * 设备记录不走 data.json：那份文件容易被同步规则排除，且多设备共享会互相覆盖。
     * Merge device records from their own files (one file per device).
     */
    async mergeDeviceRecords(): Promise<boolean> {
        if (!this.ready) return false;
        const configDir = this.manager.app?.vault?.configDir;
        const prefix = this.deviceFilePrefix();
        const adapter = this.manager.app?.vault?.adapter;
        if (!configDir || !prefix || !adapter) return false;
        const files: string[] = [];
        try {
            const directory = prefix.replace(/\/$/, '');
            if (await adapter.exists(directory)) files.push(...(await adapter.list(directory)).files);
            files.push(...(await adapter.list(configDir)).files.filter(path => path.startsWith(`${configDir}/better-plugins-manager-device-`)));
        } catch (error) {
            this.report(error);
            return false;
        }
        let changed = false;
        for (const path of files) {
            if (!(path.startsWith(prefix) || path.startsWith(`${configDir}/better-plugins-manager-device-`)) || !path.endsWith('.json')) continue;
            let parsed: unknown;
            try {
                parsed = JSON.parse(await adapter.read(path));
            } catch (error) {
                this.report(error);
                continue;
            }
            if (!isManagedDevice(parsed) || parsed.id === this.id) continue;
            if (this.removedDeviceIds.has(parsed.id)) continue;
            const incoming: ManagedDevice = parsed;
            const known = this.data.devices.find(device => device.id === incoming.id);
            if (known) {
                // 名称/类型按 updatedAt 做双向合并；没有版本字段的旧记录退回 lastSeen。
                const incomingStamp = incoming.updatedAt ?? incoming.lastSeen;
                const knownStamp = known.updatedAt ?? known.lastSeen;
                if (incomingStamp > knownStamp) {
                    const renamed = incoming.name !== known.name;
                    const retyped = incoming.type !== known.type;
                    known.name = incoming.name;
                    known.type = incoming.type;
                    if (incoming.platform) known.platform = incoming.platform;
                    known.updatedAt = incomingStamp;
                    changed = true;
                    if (renamed || retyped) {
                        new Notice(this.manager.translator.t('设备_远程更新', {
                            name: known.name, type: this.label(known.type),
                        }), 5000);
                    }
                }
                if (incoming.lastSeen > known.lastSeen) { known.lastSeen = incoming.lastSeen; changed = true; }
                continue;
            }
            this.data.devices.push({ ...incoming });
            changed = true;
        }
        return changed;
    }

    async apply(options: { refreshViews?: boolean; persist?: boolean } = {}): Promise<void> { await this.run(() => this.applyCurrent(options)); }

    /** 应用本机绑定的预设：投影设置、重算插件运行态，再把新登记的项写回。 */
    private async applyCurrent(options: { refreshViews?: boolean; persist?: boolean } = {}): Promise<void> {
        await this.applyEffective();
        await this.manager.applyDeviceConfiguration(options);
        if (options.persist === false) return;
        const bound = this.boundPreset();
        if (bound) this.captureInto(bound, { appearance: this.readLiveAppearance() });
        await this.manager.saveSettings({ captureDevice: false });
    }

    private async applyEffective(): Promise<void> {
        const bound = this.boundPreset();
        if (!bound) return;
        const preset = this.effectiveForScope({ key: scopeKey(bound.id), type: this.type, presetId: bound.id });
        applyPresetToSettings(preset, this.manager.settings, this.manager.manifest.id);
        if (featureEnabled(this.manager.settings, 'themes')) await this.applyAppearance(preset.appearance);
    }

    private async applyAppearance(appearance: ScopedAppearance): Promise<void> {
        const customCss = this.customCss();
        if (!customCss) return;
        try {
            // 绑定切换也不能把会话覆盖写盘；Rebinding preserves the permanent appearance baseline.
            const persistent = this.manager.overview.persistentAppearance(appearance, this.boundPresetId);
            const live = this.readLiveAppearance();
            const sameAppearance = (other: ScopedAppearance): boolean => live.theme === other.theme
                && Array.from(new Set([...Object.keys(live.snippets), ...Object.keys(other.snippets)]))
                    .every(id => Boolean(live.snippets[id]) === Boolean(other.snippets[id]));
            // 相同预设不重复调用原生外观 setter/loader，避免无内容变化的样式闪动。
            // Identical appearance must not trigger native CSS writes or reloads.
            if (sameAppearance(appearance) && sameAppearance(persistent)) return;
            if (customCss.theme !== persistent.theme) customCss.setTheme?.(persistent.theme);
            const snippetIds = new Set([...Object.keys(this.readLiveAppearance().snippets), ...Object.keys(persistent.snippets)]);
            const enabled = new Set(Object.entries(persistent.snippets).filter(([, flag]) => flag).map(([id]) => id));
            customCss.enabledSnippets = customCss.enabledSnippets instanceof Set ? new Set(enabled) : [...enabled];
            for (const id of snippetIds) customCss.setCssEnabledStatus?.(id, enabled.has(id));
            customCss.theme = appearance.theme;
            const runtimeIds = Object.keys(appearance.snippets).filter(id => appearance.snippets[id]);
            customCss.enabledSnippets = customCss.enabledSnippets instanceof Set ? new Set(runtimeIds) : runtimeIds;
            await customCss.loadTheme?.();
            await customCss.loadSnippets?.();
        } catch (error) {
            this.report(error);
            throw error;
        }
    }
}

function cloneRibbon(items: RibbonItem[]): RibbonItem[] {
    return items.map(item => ({ ...item, ribbonIdMap: item.ribbonIdMap ? { ...item.ribbonIdMap } : undefined }));
}
