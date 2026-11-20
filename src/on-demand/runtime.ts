import { ButtonComponent, ItemView, Menu, Notice, Platform, WorkspaceLeaf } from 'obsidian';
import type { App } from 'obsidian';
import type Manager from '../main';
import { featureEnabled } from '../features';
import { BPM_IGNORE_TAG } from '../data/types';
import type { WorkspaceWithRibbon } from '../obsidian-internals';
import { pluginStorage } from '../storage/plugin-storage';
import { CommandRegistry, OnDemandCommands } from './commands';
import type { OnDemandSettings } from '../settings/data';
import { Entry, EntryOptions, OnDemandSettingsHost, OnDemandSettingsModal } from './settings-modal';
import { ondemandText } from './text';

export const ON_DEMAND_VIEW = 'bpm-on-demand';
const CACHE_FILE = 'on-demand-commands.json';
const POLL_MS = 2500;
class OnDemandCancelled extends Error {}
const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/** 按需加载：命令占位、休眠/唤醒与可选界面入口。
 * On-demand loading: command placeholders, sleep/wake and optional UI entries. */
export class OnDemandRuntime implements OnDemandSettingsHost {
    readonly app: App;
    private readonly commands: OnDemandCommands;
    private readonly loaded = new Set<string>();
    private readonly loading = new Map<string, Promise<void>>();
    private readonly pending = new Map<string, boolean>();
    private readonly ribbon = new Map<string, HTMLElement>();
    private settingsModal?: OnDemandSettingsModal;
    private pollTimer?: number;
    private panelSignature = '';
    private lastModes = new Set<string>();
    private lastViews = true;
    private disposed = false;

    constructor(private readonly manager: Manager) {
        this.app = manager.app;
        const registry = (manager.app as unknown as { commands?: CommandRegistry }).commands;
        this.commands = new OnDemandCommands({
            registry: registry ?? { commands: {}, addCommand: command => command, removeCommand: () => {}, executeCommandById: () => false },
            loadPlugin: id => this.loadForUse(id),
            canLoad: id => !this.disposed && this.authorized(id),
            manifestVersion: id => this.manager.appPlugins.manifests[id]?.version,
            readCache: () => this.readCache(),
            writeCache: value => this.writeCache(value),
            failed: (id, error) => { if (!(error instanceof OnDemandCancelled)) this.report(id, error, Boolean(id)); },
        });
    }

    async initialize(): Promise<void> {
        this.manager.settings.ON_DEMAND = this.normalizedSettings();
        this.lastModes = new Set(this.modeIds());
        this.manager.registerView(ON_DEMAND_VIEW, leaf => new OnDemandPanelView(leaf, this));
        this.manager.registerEvent(this.app.workspace.on('file-menu', menu => { this.addMenuEntries(menu); }));
        this.manager.registerEvent(this.app.workspace.on('editor-menu', menu => { this.addMenuEntries(menu); }));
        this.manager.addCommand({ id: 'open-on-demand-panel', name: this.text('openCommand'), callback: () => { this.openPanel(); } });
        await this.commands.initialize();
        if (this.disposed) return;
        this.syncAll();
        if (this.app.workspace.layoutReady) this.ensureView();
        else this.app.workspace.onLayoutReady(() => { if (!this.disposed) this.ensureView(); });
        this.pollTimer = window.setInterval(() => { this.syncAll(); }, POLL_MS);
    }

    configured(id: string): boolean {
        return !this.disposed && this.modeIds().includes(id);
    }

    /** 当前预设下用户仍希望启用该插件；Whether the effective preset still enables it. */
    authorized(id: string): boolean {
        return this.configured(id) && this.wanted(id) && this.canUse(id);
    }

    /** 应用预设的启用状态：启用者休眠，禁用者退出按需管理。
     * Apply the preset state: enabled plugins sleep, disabled ones leave the queue. */
    async apply(id: string, enabled: boolean): Promise<void> {
        if (!this.configured(id)) return;
        this.pending.set(id, enabled);
        try {
            if (!this.canUse(id)) {
                // BPM 忽略、移动端桌面限定或功能关闭时不接管该插件。
                // Leave ignored, desktop-only-on-mobile and feature-disabled plugins untouched.
                this.commands.disarm(id);
                this.loaded.delete(id);
            } else if (!enabled) {
                this.commands.disarm(id);
                this.loaded.delete(id);
                await this.stop(id, this.persistChanges() && this.isPersisted(id));
            } else if (this.isRunning(id)) {
                if (!this.loaded.has(id)) await this.sleep(id, this.persistChanges());
            } else {
                await this.prepare(id, this.persistChanges());
            }
        } finally {
            // 记录由调用方在原生操作后更新；短暂保留本次目标状态。
            // The caller updates the record after the native operation; keep the target briefly.
            window.setTimeout(() => { if (this.pending.get(id) === enabled) this.pending.delete(id); }, 0);
        }
        this.syncAll();
    }

    async loadNow(id: string): Promise<void> {
        if (this.disposed || !this.authorized(id) || this.isRunning(id)) return;
        this.commands.beforeLoad(id);
        try {
            await this.ensureLoaded(id);
            await this.commands.afterLoad(id);
        } catch (error) {
            this.loaded.delete(id);
            if (!(error instanceof OnDemandCancelled)) {
                this.report(id, error, true);
                this.commands.arm(id);
            }
        }
        this.syncAll();
    }

    async configure(id: string, onDemand: boolean): Promise<void> {
        if (this.disposed || id === this.manager.manifest.id) return;
        const value = this.normalizedSettings();
        const plugins = new Set(value.plugins);
        if (onDemand) plugins.add(id); else plugins.delete(id);
        value.plugins = [...plugins].sort();
        this.manager.settings.ON_DEMAND = value;
        this.lastModes = new Set(value.plugins);
        await this.saveSettings();
        if (onDemand) {
            if (this.canUse(id) && this.recordEnabled(id)) {
                this.loaded.delete(id);
                if (this.isRunning(id)) await this.sleep(id);
                else await this.prepare(id);
            }
        } else {
            this.commands.disarm(id);
            this.loaded.delete(id);
            await this.normalize(id);
        }
        this.ensureView();
        this.syncAll();
    }

    async setOptions(patch: Partial<EntryOptions>): Promise<void> {
        const value = this.normalizedSettings();
        value.ribbon = patch.ribbon ?? value.ribbon;
        value.views = patch.views ?? value.views;
        value.menus = patch.menus ?? value.menus;
        this.manager.settings.ON_DEMAND = value;
        await this.saveSettings();
        this.ensureView();
        this.syncAll();
    }

    openSettings(): void {
        if (this.settingsModal) return;
        this.settingsModal = new OnDemandSettingsModal(this);
        this.settingsModal.open();
    }

    /** 设置弹窗宿主：当前已安装插件及其状态。 / Settings host: installed plugins and their state. */
    plugins(): Entry[] {
        const entries: Entry[] = [];
        const savedById = new Map(this.manager.settings.Plugins.map(item => [item.id, item]));
        const modes = new Set(this.modeIds());
        for (const manifest of Object.values(this.manager.appPlugins.manifests)) {
            if (manifest.id === this.manager.manifest.id) continue;
            const saved = savedById.get(manifest.id);
            entries.push({
                id: manifest.id,
                name: saved?.name || manifest.name || manifest.id,
                configured: modes.has(manifest.id),
                authorized: this.recordEnabled(manifest.id) && this.canUse(manifest.id),
                running: this.isRunning(manifest.id),
                commands: this.commands.count(manifest.id),
            });
        }
        return entries.sort((left, right) => left.name.localeCompare(right.name));
    }

    options(): EntryOptions {
        const value = this.manager.settings.ON_DEMAND;
        return {
            ribbon: value?.ribbon !== false,
            views: value?.views !== false,
            menus: value?.menus !== false,
        };
    }

    language(): string {
        return this.manager.settings.LANGUAGE || 'en';
    }

    text(key: Parameters<typeof ondemandText>[1], vars: Record<string, string | number> = {}): string {
        return ondemandText(this.language(), key, vars);
    }

    begin(editor: object): void {
        this.settingsModal = editor as OnDemandSettingsModal;
    }

    end(editor: object): void {
        if (this.settingsModal === editor) this.settingsModal = undefined;
    }

    failed(error: unknown): void {
        this.report('', error, true);
    }

    isDisposed(): boolean {
        return this.disposed;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer);
        this.pollTimer = undefined;
        for (const element of this.ribbon.values()) this.removeRibbonIcon(element);
        this.ribbon.clear();
        this.commands.dispose();
        for (const leaf of this.app.workspace.getLeavesOfType(ON_DEMAND_VIEW)) leaf.detach();
        this.settingsModal?.close();
        this.settingsModal = undefined;
        this.loaded.clear();
        this.pending.clear();
    }

    /** 已休眠且在当前预设启用的插件，供按钮、菜单和侧栏共用。
     * Sleeping plugins enabled by the current preset, shared by every loading surface. */
    sleeping(): Entry[] {
        return this.plugins().filter(entry => entry.configured && entry.authorized && !entry.running);
    }

    private wanted(id: string): boolean {
        if (this.pending.has(id)) return this.pending.get(id) === true;
        return this.recordEnabled(id);
    }

    private recordEnabled(id: string): boolean {
        return this.manager.settings.Plugins.find(item => item.id === id)?.enabled === true;
    }

    private canUse(id: string): boolean {
        if (id === this.manager.manifest.id) return false;
        if (!featureEnabled(this.manager.settings, 'plugins')) return false;
        const manifest = this.manager.appPlugins.manifests[id];
        if (!manifest || Platform.isMobileApp && manifest.isDesktopOnly) return false;
        const saved = this.manager.settings.Plugins.find(item => item.id === id);
        return !saved?.tags?.includes(BPM_IGNORE_TAG);
    }

    private isRunning(id: string): boolean {
        return Boolean(this.manager.appPlugins.plugins?.[id]);
    }

    private isPersisted(id: string): boolean {
        return this.manager.appPlugins.enabledPlugins.has(id);
    }

    /** 预览会话或外部预设投影不得改写原生启动列表。
     * Preview sessions and foreign projections never rewrite the native startup list. */
    private persistChanges(): boolean {
        return !this.manager.devices?.isProjectingForeign('plugins') && this.manager.overview.mode('plugins') !== 'session';
    }

    private loadForUse(id: string): Promise<void> {
        return this.ensureLoaded(id);
    }

    /** 合并同一插件的并发加载，避免双重 onload。Coalesce concurrent loads of one plugin. */
    private ensureLoaded(id: string): Promise<void> {
        const existing = this.loading.get(id);
        if (existing) return existing;
        const task = (async () => {
            await this.manager.appPlugins.enablePlugin(id);
            if (!this.isRunning(id)) throw new Error(`Plugin did not start: ${id}`);
            if (!this.authorized(id)) {
                // 加载期间预设或配置已撤销按需项；不要留下一个已加载但已禁用的插件。
                // The mode or preset was withdrawn during the load; do not leave a loaded, disabled plugin.
                await this.stop(id, false);
                throw new OnDemandCancelled();
            }
            this.loaded.add(id);
            this.syncAll();
        })();
        this.loading.set(id, task);
        void task.finally(() => { if (this.loading.get(id) === task) this.loading.delete(id); }).catch(() => {});
        return task;
    }

    /** 缓存可用则只挂占位；否则运行一次采集命令后休眠。
     * Arm cached placeholders, or run once to capture commands and go back to sleep. */
    private async prepare(id: string, persist = true): Promise<void> {
        if (this.commands.ready(id)) {
            this.commands.arm(id);
            // 从原生启动列表移除，否则下次启动仍会先加载再休眠。
            // Remove it from the native startup list, or the next launch loads it before sleeping.
            await this.stop(id, persist);
            return;
        }
        if (this.isRunning(id)) { await this.sleep(id, persist); return; }
        this.commands.beforeLoad(id);
        try {
            await this.ensureLoaded(id);
        } catch (error) {
            if (!(error instanceof OnDemandCancelled)) {
                this.report(id, error);
                this.commands.arm(id);
            }
            return;
        }
        await this.commands.afterLoad(id);
        await this.stop(id, persist);
        this.commands.arm(id);
    }

    private async sleep(id: string, persist = true): Promise<void> {
        await this.commands.capture(id);
        await this.stop(id, persist);
        this.commands.arm(id);
    }

    private async stop(id: string, persist: boolean): Promise<void> {
        const running = this.isRunning(id);
        if (!running && !(persist && this.isPersisted(id))) return;
        try {
            if (persist) await this.manager.appPlugins.disablePluginAndSave(id);
            else if (running) await this.manager.appPlugins.disablePlugin(id);
        } catch (error) {
            this.report(id, error);
        }
    }

    /** 关闭按需后恢复原生启用；Restore native enabling after leaving on-demand mode. */
    private async normalize(id: string): Promise<void> {
        if (!this.canUse(id) || !this.recordEnabled(id)) return;
        try {
            if (this.manager.settings.DELAY) {
                if (!this.isRunning(id)) await this.manager.appPlugins.enablePlugin(id);
            } else if (!this.isPersisted(id)) {
                await this.manager.appPlugins.enablePluginAndSave(id);
            }
        } catch (error) {
            this.report(id, error, true);
        }
    }

    private syncAll(): void {
        if (this.disposed) return;
        const modes = new Set(this.modeIds());
        for (const id of this.lastModes) {
            if (!modes.has(id)) this.commands.disarm(id);
        }
        for (const id of modes) {
            if (this.isRunning(id)) this.commands.beforeLoad(id);
            else if (this.authorized(id) && this.commands.ready(id)) this.commands.arm(id);
            else this.commands.disarm(id);
        }
        const added = [...modes].filter(id => !this.lastModes.has(id));
        const removedAll = this.lastModes.size > 0 && modes.size === 0;
        const addedFirst = this.lastModes.size === 0 && modes.size > 0;
        this.lastModes = modes;
        // 配置同步可能在运行时增删按需项；视图只在过渡时调整。
        // Configuration sync may add or remove modes at runtime; adjust the view only on transitions.
        const views = this.options().views;
        if (addedFirst || removedAll || views !== this.lastViews) {
            this.lastViews = views;
            this.ensureView();
        }
        this.syncSurfaces();
        // 配置同步新增的按需项在此刻生效；本地 configure 已先行处理。
        // Modes added by configuration sync take effect here; local configure already handled them.
        for (const id of added) void this.apply(id, this.recordEnabled(id)).catch(error => this.report(id, error));
    }

    private syncSurfaces(): void {
        const entries = this.sleeping();
        this.syncRibbon(entries);
        const signature = entries.map(entry => `${entry.id}:${entry.name}:${entry.commands}`).join('|');
        if (signature === this.panelSignature) return;
        this.panelSignature = signature;
        this.refreshPanels();
    }

    private syncRibbon(entries: Entry[]): void {
        const options = this.options();
        const wanted = new Set(options.ribbon ? entries.map(entry => entry.id) : []);
        for (const [id, element] of [...this.ribbon]) {
            if (wanted.has(id)) continue;
            this.removeRibbonIcon(element);
            this.ribbon.delete(id);
        }
        // 关闭选项后不得再次补回；A disabled option must not re-add the buttons below.
        if (!options.ribbon) return;
        for (const entry of entries) {
            const title = this.text('loadLabel', { name: entry.name });
            const existing = this.ribbon.get(entry.id);
            if (existing) {
                existing.setAttribute('aria-label', title);
                continue;
            }
            const element = this.manager.addRibbonIcon('power', title, () => { void this.loadNow(entry.id); });
            this.ribbon.set(entry.id, element);
        }
    }

    private removeRibbonIcon(element: HTMLElement): void {
        const ribbon = (this.app.workspace as WorkspaceWithRibbon).leftRibbon;
        const items = ribbon?.items;
        if (items) {
            const index = items.findIndex(item => item?.buttonEl === element);
            if (index >= 0) {
                items.splice(index, 1);
                ribbon?.onChange?.(false);
            }
        }
        element.remove();
    }

    private addMenuEntries(menu: Menu): void {
        if (this.disposed || !this.options().menus) return;
        for (const entry of this.sleeping()) {
            menu.addItem(item => item
                .setTitle(this.text('loadLabel', { name: entry.name }))
                .setIcon('power')
                .setSection('bpm-on-demand')
                .onClick(() => { void this.loadNow(entry.id); }));
        }
    }

    private ensureView(): void {
        if (this.disposed || !this.app.workspace.layoutReady) return;
        const leaves = this.app.workspace.getLeavesOfType(ON_DEMAND_VIEW);
        const wanted = this.options().views && this.modeIds().length > 0;
        if (!wanted) {
            for (const leaf of leaves) leaf.detach();
            return;
        }
        if (leaves.length) return;
        const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getRightLeaf(true);
        if (leaf) void leaf.setViewState({ type: ON_DEMAND_VIEW, active: false });
    }

    private openPanel(): void {
        const workspace = this.app.workspace;
        const leaf = workspace.getLeavesOfType(ON_DEMAND_VIEW)[0]
            ?? workspace.getRightLeaf(false) ?? workspace.getRightLeaf(true);
        if (!leaf) return;
        void leaf.setViewState({ type: ON_DEMAND_VIEW, active: true });
    }

    private refreshPanels(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(ON_DEMAND_VIEW)) {
            const view: unknown = leaf.view;
            if (view instanceof OnDemandPanelView) view.render();
        }
    }

    /** 规范化配置中的按需字段；Normalize the on-demand block stored in settings. */
    private normalizedSettings(): OnDemandSettings {
        const current: unknown = this.manager.settings.ON_DEMAND;
        const source = record(current) ? current : {};
        const plugins = Array.isArray(source.plugins)
            ? source.plugins.filter((id): id is string => typeof id === 'string' && id !== this.manager.manifest.id)
            : [];
        return {
            plugins: [...new Set(plugins)].sort(),
            ribbon: source.ribbon !== false,
            views: source.views !== false,
            menus: source.menus !== false,
        };
    }

    private modeIds(): string[] {
        const value = this.manager.settings.ON_DEMAND;
        return Array.isArray(value?.plugins) ? value.plugins : [];
    }

    private async saveSettings(): Promise<void> {
        // 按需界面没有独立的保存按钮；显式选择后立即发布为一次用户编辑。
        // The on-demand modal has no Save button; publish an explicit choice as a user edit now.
        try { await this.manager.savePendingSettings({ notify: false }); }
        catch (error) { this.report('', error); }
    }

    private async readCache(): Promise<unknown> {
        try {
            const text = await pluginStorage(this.manager).read('cache', CACHE_FILE);
            return text === undefined ? null : JSON.parse(text);
        } catch (error) {
            this.report('', error);
            return null;
        }
    }

    private async writeCache(value: unknown): Promise<void> {
        await pluginStorage(this.manager).write('cache', CACHE_FILE, JSON.stringify(value));
    }

    private report(id: string, error: unknown, notify = false): void {
        this.manager.reportError(id ? `On-demand plugin ${id} failed` : 'On-demand runtime failed', error, false);
        if (!notify || this.disposed) return;
        const name = id ? (this.manager.appPlugins.manifests[id]?.name || id) : '';
        const detail = error instanceof Error ? error.message : String(error);
        new Notice(name ? `${this.text('loadFailed', { name })}: ${detail}` : detail, 8000);
    }
}

class OnDemandPanelView extends ItemView {
    constructor(leaf: WorkspaceLeaf, private readonly runtime: OnDemandRuntime) {
        super(leaf);
    }

    getViewType(): string {
        return ON_DEMAND_VIEW;
    }

    getDisplayText(): string {
        return this.runtime.text('panelTitle');
    }

    getIcon(): string {
        return 'plug';
    }

    async onOpen(): Promise<void> {
        this.render();
    }

    render(): void {
        if (this.runtime.isDisposed()) return;
        this.contentEl.empty();
        const entries = this.runtime.sleeping();
        if (!entries.length) {
            this.contentEl.createEl('p', { text: this.runtime.text('panelEmpty') });
            return;
        }
        for (const entry of entries) {
            const row = this.contentEl.createDiv('setting-item');
            const info = row.createDiv('setting-item-info');
            info.createDiv({ cls: 'setting-item-name', text: entry.name });
            info.createDiv({ cls: 'setting-item-description', text: this.runtime.text('status', {
                state: this.runtime.text('sleeping'), count: entry.commands,
            }) });
            const control = row.createDiv('setting-item-control');
            const button = new ButtonComponent(control);
            button.setButtonText(this.runtime.text('load'))
                .setTooltip(this.runtime.text('loadLabel', { name: entry.name }))
                .onClick(() => { void this.runtime.loadNow(entry.id); });
        }
    }
}
