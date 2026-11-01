import type Manager from './main';
import { Platform } from 'obsidian';
import { cloneAppearance, DevicePluginState, ScopedAppearance } from './devices/device-presets';

export type OverviewPage = 'plugins' | 'themes';
export type ApplyMode = 'session' | 'persistent';
type AppearancePatch = { theme?: string; snippets?: Record<string, boolean> };
type RuntimeCss = {
    theme: string;
    enabledSnippets: Set<string> | string[];
    setTheme?(theme: string): void;
    setCssEnabledStatus?(id: string, enabled: boolean): void;
    loadTheme?(): Promise<void>;
    loadSnippets?(): Promise<void>;
};

/** 会话覆盖与持久化基线分离；Session overrides never enter either configuration file. */
export class OverviewState {
    private readonly modes: Record<OverviewPage, ApplyMode> = { plugins: 'persistent', themes: 'persistent' };
    private readonly pluginBaselines = new Map<string, Map<string, DevicePluginState>>();
    private readonly pluginOverrides = new Map<string, Map<string, DevicePluginState>>();
    private readonly appearanceBaselines = new Map<string, ScopedAppearance>();
    private readonly appearanceOverrides = new Map<string, ScopedAppearance>();

    constructor(private readonly manager: Manager) {}
    mode(page: OverviewPage): ApplyMode { return this.modes[page]; }
    setMode(page: OverviewPage, mode: ApplyMode): void { this.modes[page] = mode; }
    private scope(page: OverviewPage): string {
        const devices = this.manager.devices;
        return devices.data.enabled ? devices.selectedScope(page).presetId : devices.boundPresetId;
    }
    pluginState(id: string, scope = this.scope('plugins')): DevicePluginState | undefined {
        return this.pluginOverrides.get(scope)?.get(id);
    }
    persistentPlugins(states: Record<string, DevicePluginState>, scope: string): Record<string, DevicePluginState> {
        const result = { ...states };
        for (const [id, state] of this.pluginBaselines.get(scope) ?? []) result[id] = { ...state };
        return result;
    }
    effectivePlugins(states: Record<string, DevicePluginState>, scope: string): Record<string, DevicePluginState> {
        return { ...states, ...Object.fromEntries(this.pluginOverrides.get(scope) ?? []) };
    }
    persistentAppearance(appearance: ScopedAppearance, scope: string): ScopedAppearance {
        return cloneAppearance(this.appearanceBaselines.get(scope) ?? appearance);
    }
    effectiveAppearance(appearance: ScopedAppearance, scope: string): ScopedAppearance {
        return cloneAppearance(this.appearanceOverrides.get(scope) ?? appearance);
    }

    /** 单项与批量共用原生生命周期入口；One lifecycle path for card and bulk operations. */
    async setPluginState(id: string, patch: Partial<DevicePluginState>): Promise<void> {
        const record = this.manager.settings.Plugins.find(plugin => plugin.id === id);
        if (!record || id === this.manager.manifest.id || record.tags.includes('bpm-ignore')) return;
        const scope = this.scope('plugins');
        const session = this.mode('plugins') === 'session';
        const foreign = this.manager.devices.isProjectingForeign('plugins');
        const previous = { enabled: record.enabled, delay: record.delay };
        const next = { ...previous, ...patch };
        // 先完成原生操作再更新记录；Failed native operations leave stored state intact.
        if (!foreign && patch.enabled !== undefined) {
            if (next.enabled && Platform.isMobileApp && this.manager.appPlugins.manifests[id]?.isDesktopOnly) {
                throw new Error(this.manager.translator.t('提示_移动端不支持'));
            }
            const plugins = this.manager.appPlugins;
            if (session || this.manager.settings.DELAY) {
                if (next.enabled) await plugins.enablePlugin(id);
                else await plugins.disablePlugin(id);
            } else if (next.enabled) await plugins.enablePluginAndSave(id);
            else await plugins.disablePluginAndSave(id);
        }
        if (session) {
            const baselines = this.pluginBaselines.get(scope) ?? new Map<string, DevicePluginState>();
            if (!baselines.has(id)) baselines.set(id, previous);
            this.pluginBaselines.set(scope, baselines);
            const overrides = this.pluginOverrides.get(scope) ?? new Map<string, DevicePluginState>();
            overrides.set(id, next);
            this.pluginOverrides.set(scope, overrides);
        } else {
            this.pluginBaselines.get(scope)?.delete(id);
            this.pluginOverrides.get(scope)?.delete(id);
        }
        record.enabled = next.enabled;
        record.delay = next.delay;
        await this.manager.saveSettings();
    }

    async writeAppearance(patch: AppearancePatch): Promise<void> {
        const devices = this.manager.devices;
        const scope = this.scope('themes');
        const foreign = devices.isProjectingForeign('themes');
        const live = foreign ? devices.scopeAppearance('themes') : devices.readLiveAppearance();
        const baseline = this.persistentAppearance(live, scope);
        const next = cloneAppearance(live);
        if (patch.theme !== undefined) next.theme = patch.theme;
        Object.assign(next.snippets, patch.snippets ?? {});
        const session = this.mode('themes') === 'session';
        if (!foreign) {
            const css = (this.manager.app as unknown as { customCss?: RuntimeCss }).customCss;
            if (!css) throw new Error('Appearance API is unavailable');
            if (session) {
                // 原生 setter 会保存配置；Load native CSS with runtime fields only for this session.
                if (patch.theme !== undefined) {
                    if (!css.loadTheme) throw new Error('Theme runtime API is unavailable');
                    css.theme = next.theme;
                    await css.loadTheme();
                }
                if (patch.snippets) {
                    if (!css.loadSnippets) throw new Error('Snippet runtime API is unavailable');
                    const ids = Object.keys(next.snippets).filter(id => next.snippets[id]);
                    css.enabledSnippets = css.enabledSnippets instanceof Set ? new Set(ids) : ids;
                    await css.loadSnippets();
                }
            } else {
                if (patch.theme !== undefined) {
                    if (!css.setTheme) throw new Error('Theme API is unavailable');
                    css.setTheme(next.theme);
                }
                if (patch.snippets) {
                    if (!css.setCssEnabledStatus) throw new Error('Snippet API is unavailable');
                    // setter 保存整个集合，暂用持久化集合，随后恢复会话外观。
                    // Native setters save the entire set; exclude unrelated session overrides.
                    const ids = Object.keys(baseline.snippets).filter(id => baseline.snippets[id]);
                    css.enabledSnippets = css.enabledSnippets instanceof Set ? new Set(ids) : ids;
                    for (const [id, enabled] of Object.entries(patch.snippets)) css.setCssEnabledStatus(id, enabled);
                    const currentIds = Object.keys(next.snippets).filter(id => next.snippets[id]);
                    css.enabledSnippets = css.enabledSnippets instanceof Set ? new Set(currentIds) : currentIds;
                    await css.loadSnippets?.();
                }
            }
        }
        if (!session) {
            if (patch.theme !== undefined) baseline.theme = patch.theme;
            Object.assign(baseline.snippets, patch.snippets ?? {});
        }
        this.appearanceBaselines.set(scope, baseline);
        this.appearanceOverrides.set(scope, next);
        const preset = devices.presetById(scope)?.preset;
        if (preset) { preset.appearance = cloneAppearance(baseline); preset.configured = true; }
        await this.manager.saveSettings();
    }
}
