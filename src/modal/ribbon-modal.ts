import { FloatingScrollbars } from '../ui/floating-scrollbars';
import { createActionHandler } from '../ui/action-handler';
import { App, Modal, Notice, Platform, Setting, setIcon, getIconIds, FuzzySuggestModal, ButtonComponent, ExtraButtonComponent, TextComponent, ToggleComponent } from "obsidian";
import Manager from "main";
import { RibbonItem } from "../data/types";
import { confirmWithModal } from "../utils";
import { RIBBON_GROUP_ITEM_PREFIX } from "../manager/ribbon-groups";
import { SystemRibbonManager } from "../manager/system-ribbon-manager";
import { DeviceScopeBar } from "../devices/device-scope-bar";
import { ScopeSelect } from "../ui/scope-select";
import { MultiSelectFilter } from "../ui/multi-select-filter";

class GroupIconPicker extends FuzzySuggestModal<string> {
    constructor(app: App, private readonly choose: (icon: string) => void) { super(app); }
    getItems(): string[] { return getIconIds(); }
    getItemText(icon: string): string { return icon; }
    onChooseItem(icon: string): void { this.choose(icon); }
    renderSuggestion(match: { item: string }, el: HTMLElement): void {
        el.addClass('ribbon-group-icon-option');
        const iconEl = el.createSpan({ cls: 'ribbon-group-icon-option__icon' });
        setIcon(iconEl, match.item);
        el.createSpan({ cls: 'ribbon-group-icon-option__label', text: match.item });
    }
}

type RibbonStatusFilter = 'visible' | 'hidden' | 'disabled';

export class RibbonModal extends Modal {
    private readonly action = createActionHandler(error => {
        if (this.manager.settings.DEBUG) console.error('[BPM] Ribbon action failed', error);
        new Notice(`${this.manager.translator.t('安装_错误_通用')} ${error instanceof Error ? error.message : ''}`);
    });
    private scrollbars?: FloatingScrollbars;
    manager: Manager;
    private renderRootEl?: HTMLElement;
    private dragDocument?: Document;
    private readonly frames = new Set<{ view: Window; id: number; run: () => void; flush: boolean }>();
    private renderToolbarInRoot = true;
    private groupSelects: ScopeSelect[] = [];

    /** 重绘、换页与关闭均清理菜单监听；Clean up shared menus across rendering and page lifecycles. */
    closeGroupMenus(): void {
        this.closeItemGroupMenus();
        this.closeFilterMenus();
    }

    private closeFilterMenus(): void {
        this.filterSelects.forEach(select => select.close());
        this.filterSelects = [];
        this.statusSelects.forEach(select => select.close());
        this.statusSelects = [];
    }

    private closeItemGroupMenus(): void {
        this.groupSelects.forEach(select => select.close());
        this.groupSelects = [];
    }

    // 过滤和搜索
    private statusFilters = new Set<RibbonStatusFilter>();
    private groupFilter = '';
    private filterSelects: ScopeSelect[] = [];
    private statusSelects: MultiSelectFilter[] = [];
    private externalFilterBar = false;
    private externalFilterHost?: HTMLElement;
    private groupsCollapsed = false;
    private showGroupedItems = false;
    private searchQuery = "";

    // 拖拽相关变量
    draggedItemEl: HTMLElement | null = null;
    draggedItem: RibbonItem | null = null;
    ghostEl: HTMLElement | null = null;
    placeholderEl: HTMLElement | null = null;
    dragStartIndex = -1;
    dragOffsetX = 0;
    dragOffsetY = 0;
    activePointerId: number | null = null;
    private handleDragEndEvent = (e: PointerEvent) => { this.action(async () => { await this.handleDragEnd(e); })(); };

    constructor(app: App, manager: Manager) {
        super(app);
        this.manager = manager;
    }

    /** 嵌入式页面把过滤栏放到外部标题里时使用。 */
    setExternalFilterBar(value: boolean): void {
        this.externalFilterBar = value;
        if (!value) this.externalFilterHost = undefined;
    }

    mountFilterBar(containerEl: HTMLElement): void {
        this.closeFilterMenus();
        this.externalFilterHost = containerEl;
        containerEl.empty();
        this.buildFilterBar(containerEl, () => this.refreshSearchResults());
    }

    /** 搜索只更新结果，保留输入焦点、选区与输入法；Keep the input mounted while filtering results. */
    private refreshSearchResults(): void {
        const root = this.renderRootEl ?? this.contentEl;
        const list = root.querySelector<HTMLElement>('.draggable-list-container');
        if (list) this.renderFilteredList(root, list);
    }

    /** 列表与外置筛选栏共用一次刷新，避免高亮和数量停在旧状态；Refresh external controls with the list. */
    private refreshExternalFilterBar(): void {
        if (this.externalFilterBar && this.externalFilterHost?.isConnected) this.mountFilterBar(this.externalFilterHost);
    }

    onOpen(): void {
        this.manager.beginSettingsEditing(this);
        this.scrollbars?.destroy();
        this.scrollbars = new FloatingScrollbars(this.modalEl);
        if (!this.manager.isRibbonManagerEnabled()) {
            this.close();
            return;
        }

        this.manager.ribbonModal = this;
        this.modalEl.addClass("ribbon-manager-modal");
        // 移动端弹窗高度有限：压缩说明文字与分组区的留白，把空间留给列表。
        if (Platform.isMobileApp) this.modalEl.addClass("ribbon-manager-modal--compact");
        this.titleEl.setText(this.manager.translator.t("Ribbon_标题"));
        // 弹窗同样支持按设备预设查看/编辑 Ribbon。
        this.manager.devices?.ensureProjection("ribbon");
        this.syncRibbonItems();
        this.display();
    }

    // 同步 Ribbon 项：登记尚未见过的新图标并把配置应用到原生状态
    // 面板打开时调用一次，保证列表列全（显隐与顺序由 Obsidian 原生状态承载）
    syncRibbonItems(): void {
        if (!this.manager.isRibbonManagerEnabled()) return;

        this.manager.applyRibbonSettings();
    }

    private getRibbonFallbackIcon(item: RibbonItem): string {
        const source = `${item.bpmUniqueId} ${item.name} ${item.icon || ""}`.toLowerCase();
        if (
            source.includes("refresh") ||
            source.includes("reload") ||
            source.includes("sync") ||
            source.includes("刷新") ||
            source.includes("重载") ||
            source.includes("同步")
        ) {
            return "refresh-cw";
        }
        return "help-circle";
    }

    /** 该 Ribbon 条目所属插件是否已被禁用（分组入口没有所属插件）。 */
    private isRibbonItemPluginDisabled(item: RibbonItem): boolean {
        if (!item.bpmUniqueId || item.bpmUniqueId.startsWith(RIBBON_GROUP_ITEM_PREFIX)) return false;
        const pluginId = SystemRibbonManager.pluginPrefixOf(item.bpmUniqueId);
        if (!pluginId) return false;
        const plugin = this.manager.settings.Plugins.find(record => record.id === pluginId);
        return Boolean(plugin && plugin.enabled === false);
    }

    /** 已保存但插件 manifest 不存在：插件被卸载/删除后仍可从配置中识别。 */
    private isRibbonItemPluginMissing(item: RibbonItem): boolean {
        if (!item.bpmUniqueId || item.bpmUniqueId.startsWith(RIBBON_GROUP_ITEM_PREFIX)) return false;
        const pluginId = SystemRibbonManager.pluginPrefixOf(item.bpmUniqueId);
        if (!pluginId || this.manager.appPlugins?.manifests?.[pluginId]) return false;
        // Obsidian 核心插件不提供 manifest，不能按社区插件缺失处理。
        const core = (this.manager.app as { internalPlugins?: { plugins?: Record<string, unknown> } } | undefined)
            ?.internalPlugins?.plugins;
        if (core && Object.prototype.hasOwnProperty.call(core, pluginId)) return false;
        // 系统 Ribbon 项没有插件映射；只有带插件前缀映射的条目才判为未加载。
        return Object.values(item.ribbonIdMap || {}).some(id => typeof id === 'string' && id.startsWith(`${pluginId}:`));
    }

    /** 未启用或所属插件缺失都归入禁用类，不再算作显示中；Unavailable plugins share the disabled state. */
    private getRibbonItemStatus(item: RibbonItem): RibbonStatusFilter {
        if (this.isRibbonItemPluginMissing(item) || this.isRibbonItemPluginDisabled(item)) return "disabled";
        return item.visible ? "visible" : "hidden";
    }

    private renderRibbonItemIcon(iconEl: HTMLElement, item: RibbonItem) {
        iconEl.empty();
        const icon = item.icon?.trim();
        try {
            if (icon) setIcon(iconEl, icon);
        } catch {
            // 插件卸载后图标可能不可用，立即渲染替代图标；Render the fallback for unavailable plugin icons.
            setIcon(iconEl, this.getRibbonFallbackIcon(item));
            return;
        }
        if (!iconEl.querySelector("svg")) {
            iconEl.empty();
            setIcon(iconEl, this.getRibbonFallbackIcon(item));
        }
    }

    display(targetEl?: HTMLElement, showToolbar = this.renderToolbarInRoot) {
        this.closeGroupMenus();
        const contentEl = targetEl || this.renderRootEl || this.contentEl;
        this.renderRootEl = contentEl;
        this.renderToolbarInRoot = showToolbar;
        contentEl.empty();
        if (!this.manager.isRibbonManagerEnabled()) return;

        if (showToolbar) this.renderScopeBar(contentEl);
        // 手机端把「边栏编排 / Ribbon 分组」窗口化，列表占满剩余高度。
        if (showToolbar) {
            this.externalFilterBar = false;
            if (Platform.isMobileApp) this.renderMobileSectionsBar(contentEl);
            else this.renderToolbar(contentEl);
        }
        if (!Platform.isMobileApp) this.renderGroups(contentEl);
        this.renderDraggableList(contentEl);
        this.refreshExternalFilterBar();
    }

    private renderToolbar(containerEl: HTMLElement) {
        const t = (k: string) => this.manager.translator.t(k);
        const toolbar = containerEl.createDiv("manager-hidden-toolbar ribbon-manager-toolbar");
        const toolbarText = toolbar.createDiv("manager-hidden-toolbar__text");
        toolbarText.createDiv({ cls: "manager-hidden-toolbar__title", text: t("Ribbon_功能编排_标题") });
        toolbarText.createDiv({
            cls: "manager-hidden-toolbar__desc",
            text: t("Ribbon_功能编排_说明")
        });
        const toolbarActions = toolbar.createDiv("manager-hidden-toolbar__actions");
        const resetBtn = new ButtonComponent(toolbarActions);
        resetBtn.setIcon("rotate-ccw");
        resetBtn.setButtonText(t("通用_重置_文本"));
        resetBtn.setTooltip(t("Ribbon_重置_提示"));
        resetBtn.onClick(this.action(async () => {
            if (!(await confirmWithModal(this.app, this.manager, t("Ribbon_重置_确认")))) return;
            await this.resetRibbonLayout();
        }));
    }

    /** 手机端：用两个按钮代替常驻的「边栏编排 / Ribbon 分组」区域，列表获得更多高度。 */
    private renderMobileSectionsBar(containerEl: HTMLElement): void {
        const t = (k: string) => this.manager.translator.t(k);
        const bar = containerEl.createDiv("ribbon-manager-mobile-sections");
        const layoutBtn = new ButtonComponent(bar);
        layoutBtn.setIcon("sliders-horizontal").setButtonText(t("Ribbon_功能编排_标题"));
        layoutBtn.onClick(() => this.openLayoutWindow());
        const groupsBtn = new ButtonComponent(bar);
        groupsBtn.setIcon("folder-tree").setButtonText(t("Ribbon_分组"));
        groupsBtn.onClick(() => this.openGroupsWindow());
    }

    private scopeBar?: DeviceScopeBar;

    /** 弹窗内的设备预设选择器（移动端），切换后按新预设重绘。 */
    private renderScopeBar(containerEl: HTMLElement): void {
        if (!Platform.isMobileApp) return;
        const host = containerEl.createDiv("ribbon-manager-scope");
        if (!this.scopeBar) this.scopeBar = new DeviceScopeBar(this.manager, () => this.displayWithoutSearch());
        this.scopeBar.render(host, "ribbon");
    }

    /** 重绘后恢复滚动位置，避免移动端调整顺序时跳回顶部。 */
    private rerenderPreservingScroll(): void {
        const scroller = this.renderRootEl ?? this.contentEl;
        const top = scroller?.scrollTop || 0;
        this.displayWithoutSearch();
        if (!scroller || top <= 0) return;
        scroller.scrollTop = top;
        this.scheduleFrame(scroller, () => { if (scroller.isConnected) scroller.scrollTop = top; });
    }

    private scheduleFrame(element: HTMLElement, run: () => void, flush = false): void {
        const view = element.ownerDocument.defaultView;
        if (!view) { if (flush) run(); return; }
        const pending = { view, id: 0, run, flush };
        pending.id = view.requestAnimationFrame(() => { this.frames.delete(pending); run(); });
        this.frames.add(pending);
    }

    private clearFrames(): void {
        const frames = [...this.frames];
        this.frames.clear();
        for (const frame of frames) {
            frame.view.cancelAnimationFrame(frame.id);
            if (frame.flush) frame.run();
        }
    }

    /** 把条目移动到指定 0 基序号，其余条目顺延并重新编号。 */
    private async moveItemToPosition(item: RibbonItem, targetIndex: number): Promise<void> {
        const all = this.manager.settings.RIBBON_SETTINGS;
        const ordered = [...all].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const currentIndex = ordered.findIndex(entry => entry.bpmUniqueId === item.bpmUniqueId);
        const target = Math.max(0, Math.min(ordered.length - 1, targetIndex));
        if (currentIndex === -1 || target === currentIndex) return;
        const [moved] = ordered.splice(currentIndex, 1);
        ordered.splice(target, 0, moved);
        ordered.forEach((entry, index) => { entry.order = index; });
        all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        await this.manager.saveSettings();
        this.manager.applyRibbonSettings();
        this.rerenderPreservingScroll();
    }

    private openLayoutWindow(): void {
        const t = (k: string) => this.manager.translator.t(k);
        const modal = new Modal(this.app);
        modal.modalEl.addClass("ribbon-layout-window");
        modal.onOpen = () => {
            modal.titleEl.setText(t("Ribbon_功能编排_标题"));
            modal.contentEl.empty();
            modal.contentEl.createEl("p", { cls: "ribbon-layout-window__desc", text: t("Ribbon_功能编排_说明") });
            const actions = modal.contentEl.createDiv("ribbon-layout-window__actions");
            const resetBtn = new ButtonComponent(actions);
            resetBtn.setIcon("rotate-ccw").setButtonText(t("通用_重置_文本"));
            resetBtn.onClick(this.action(async () => {
                if (!(await confirmWithModal(this.app, this.manager, t("Ribbon_重置_确认")))) return;
                await this.resetRibbonLayout();
                modal.close();
            }));
        };
        modal.open();
    }

    private groupsModalEl?: HTMLElement;

    private openGroupsWindow(): void {
        const t = (k: string) => this.manager.translator.t(k);
        const modal = new Modal(this.app);
        modal.modalEl.addClass("ribbon-groups-window");
        modal.onOpen = () => {
            modal.titleEl.setText(t("Ribbon_分组"));
            this.groupsModalEl = modal.contentEl;
            this.renderGroups(modal.contentEl, true);
        };
        modal.onClose = () => { this.groupsModalEl = undefined; };
        modal.open();
    }

    private refreshGroupsWindow(): void {
        const el = this.groupsModalEl;
        if (!el || !el.isConnected) return;
        el.empty();
        this.renderGroups(el, true);
    }

    /** Group settings use native controls / 分组编辑使用 Obsidian 原生控件。 */
    /** 分组变更：先同步排序入口，再应用原生状态，最后落盘。 */
    private commitRibbonGroups(): void {
        this.manager.syncRibbonGroupItems();
        this.manager.applyRibbonSettings();
        this.action(async () => { await this.manager.saveSettings(); })();
        this.refreshGroupsWindow();
    }

    private renderGroups(containerEl: HTMLElement, inWindow = false): void {
        const groups = this.manager.settings.RIBBON_GROUPS;
        const section = containerEl.createDiv('ribbon-manager-groups');
        const t = (key: string, vars?: Record<string, string | number>) => this.manager.translator.t(key, vars);
        const header = new Setting(section).setName(t('Ribbon_分组')).setDesc(t('Ribbon_分组说明'));
        if (!inWindow) {
            header.addExtraButton(button => {
                button.setIcon(this.groupsCollapsed ? 'chevron-right' : 'chevron-down')
                    .setTooltip(t(this.groupsCollapsed ? 'Ribbon_展开分组' : 'Ribbon_收起分组'))
                    .onClick(() => { this.groupsCollapsed = !this.groupsCollapsed; this.displayWithoutSearch(); });
                button.extraSettingsEl.addClass('ribbon-group-toggle');
            });
        }
        header.addButton(button => {
                button.setIcon('plus').setTooltip(t('Ribbon_添加分组')).onClick(() => {
                    groups.push({ id: `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                        name: t('Ribbon_新分组'), icon: 'folder', members: [] });
                    this.groupsCollapsed = false;
                    this.commitRibbonGroups();
                    this.displayWithoutSearch();
                });
                button.buttonEl.addClass('ribbon-group-add');
            });
        if (this.groupsCollapsed && !inWindow) return;
        const body = section.createDiv('ribbon-manager-groups__body');
        if (!groups.length) {
            const empty = body.createDiv('ribbon-manager-groups__empty');
            setIcon(empty.createSpan('ribbon-manager-groups__empty-icon'), 'folder');
            empty.createSpan({ cls: 'ribbon-manager-groups__empty-text', text: t('Ribbon_暂无分组') });
            return;
        }
        const grid = body.createDiv('ribbon-group-grid');
        for (const group of groups) {
            // 每个分组占约 1/4 行：图标在名称输入框左侧。
            const cell = grid.createDiv('ribbon-group-card');
            cell.setAttribute('aria-label', t('Ribbon_分组项目', { count: group.members.length }));
            const iconButton = new ExtraButtonComponent(cell);
            iconButton.setIcon(group.icon || 'folder').setTooltip(t('Ribbon_选择分组图标'))
                .onClick(() => new GroupIconPicker(this.app, icon => {
                    group.icon = icon;
                    this.commitRibbonGroups();
                    this.displayWithoutSearch();
                }).open());
            iconButton.extraSettingsEl.addClass('ribbon-group-card__icon');

            const nameInput = new TextComponent(cell);
            nameInput.setValue(group.name).setPlaceholder(t('Ribbon_新分组'));
            nameInput.inputEl.addClass('ribbon-group-card__name');
            nameInput.onChange(value => {
                if (!value.trim()) return;
                group.name = value.trim();
                this.commitRibbonGroups();
            });
            nameInput.inputEl.addEventListener("blur", () => this.displayWithoutSearch());

            const removeButton = new ExtraButtonComponent(cell);
            removeButton.setIcon('trash').setTooltip(t('Ribbon_删除分组')).onClick(() => {
                groups.splice(groups.indexOf(group), 1);
                if (this.groupFilter === group.id) this.groupFilter = '';
                if (!groups.length) this.showGroupedItems = false;
                this.commitRibbonGroups();
                this.displayWithoutSearch();
            });
            removeButton.extraSettingsEl.addClass('ribbon-group-card__remove');
        }
    }

    renderDraggableList(containerEl: HTMLElement) {
        const t = (k: string) => this.manager.translator.t(k);
        if (!this.externalFilterBar) this.buildFilterBar(containerEl, () => this.refreshSearchResults());

        if (this.showGroupedItems) {
            containerEl.createDiv({ cls: "ribbon-manager-grouped-hint", text: t("Ribbon_显示已分组提示") });
        }
        const listContainer = containerEl.createDiv("draggable-list-container");
        this.renderFilteredList(containerEl, listContainer);
    }

    displayWithoutSearch(targetEl?: HTMLElement, showToolbar = this.renderToolbarInRoot) {
        this.closeGroupMenus();
        const contentEl = targetEl || this.renderRootEl || this.contentEl;
        this.renderRootEl = contentEl;
        this.renderToolbarInRoot = showToolbar;
        contentEl.empty();
        if (!this.manager.isRibbonManagerEnabled()) return;

        if (showToolbar) this.renderScopeBar(contentEl);
        // 手机端把「边栏编排 / Ribbon 分组」窗口化，列表占满剩余高度。
        if (showToolbar) {
            if (Platform.isMobileApp) this.renderMobileSectionsBar(contentEl);
            else this.renderToolbar(contentEl);
        }
        if (!Platform.isMobileApp) this.renderGroups(contentEl);
        this.renderDraggableList(contentEl);
        this.refreshExternalFilterBar();
    }

    /** 过滤按钮组 + 搜索框；嵌入式 ribbon 页把它挂到概览标题里。 */
    private buildFilterBar(containerEl: HTMLElement, refresh: () => void): void {
        const t = (k: string) => this.manager.translator.t(k);
        const allItems = this.manager.settings.RIBBON_SETTINGS;
        const memberIds = new Set(this.manager.settings.RIBBON_GROUPS.flatMap(group => group.members));
        const ungroupedItems = allItems.filter(item => !memberIds.has(item.bpmUniqueId));
        const scopedItems = this.showGroupedItems ? allItems : ungroupedItems;
        const statuses = scopedItems.map(item => this.getRibbonItemStatus(item));
        const visibleCount = statuses.filter(status => status === "visible").length;
        const hiddenCount = statuses.filter(status => status === "hidden").length;
        const disabledCount = statuses.filter(status => status === "disabled").length;
        const filterBar = containerEl.createDiv("ribbon-manager-filter-bar");

        // 左侧：过滤按钮组
        const filterGroup = filterBar.createDiv("ribbon-manager-filter-group");

        const filters: Array<{ key: "all" | RibbonStatusFilter; label: string; count: number; icon: string }> = [
            { key: "all", label: t("通用_全部_文本"), count: scopedItems.length, icon: "menu" },
            { key: "visible", label: t("Ribbon_显示"), count: visibleCount, icon: "eye" },
            { key: "hidden", label: t("Ribbon_隐藏"), count: hiddenCount, icon: "eye-off" },
            { key: "disabled", label: t("Ribbon_插件被禁用"), count: disabledCount, icon: "ban" },
        ];

        const statusButtons: Array<{ key: "all" | RibbonStatusFilter; button: HTMLButtonElement }> = [];
        const updateStatusControls = () => {
            for (const { key, button } of statusButtons) {
                const active = key === "all" ? this.statusFilters.size === 0 : this.statusFilters.has(key);
                button.toggleClass("is-active", active);
                button.setAttribute('aria-pressed', `${active}`);
            }
            statusSelect.setValues([...this.statusFilters]);
        };
        filters.forEach(filter => {
            const active = filter.key === "all" ? this.statusFilters.size === 0 : this.statusFilters.has(filter.key);
            const btn = new ButtonComponent(filterGroup);
            btn.buttonEl.addClass("ribbon-filter-btn");
            btn.buttonEl.setAttribute('aria-pressed', `${active}`);
            if (active) btn.buttonEl.addClass("is-active");
            statusButtons.push({ key: filter.key, button: btn.buttonEl });

            // 自定义按钮内容：图标 + 文本 + 数量
            btn.buttonEl.empty();
            const iconEl = btn.buttonEl.createSpan({ cls: "ribbon-filter-btn-icon" });
            setIcon(iconEl, filter.icon);
            btn.buttonEl.createSpan({ text: `${filter.label} ${filter.count}`, cls: "ribbon-filter-btn-text" });

            btn.onClick(() => {
                if (filter.key === "all") this.statusFilters.clear();
                else if (this.statusFilters.has(filter.key)) this.statusFilters.delete(filter.key);
                else this.statusFilters.add(filter.key);
                if (this.statusFilters.size === 3) this.statusFilters.clear();
                updateStatusControls();
                refresh();
            });
        });

        // 手机端与插件总览复用同一多选控件，不重建搜索框；Share the overview multi-select without remounting search.
        const statusSelect = new MultiSelectFilter(filterGroup, {
            options: filters.map(filter => ({ value: filter.key, label: filter.label, icon: filter.icon, count: filter.count })),
            values: [...this.statusFilters], allValue: "all", allLabel: t("通用_全部_文本"), label: t("筛选_状态_标签"),
            icon: "list-filter", collapseAllSelected: true, fixed: true,
            onChange: values => {
                this.statusFilters = new Set(values.filter((value): value is RibbonStatusFilter => value === 'visible' || value === 'hidden' || value === 'disabled'));
                updateStatusControls();
                refresh();
            },
        });
        statusSelect.rootEl.addClass("ribbon-manager-state-menu");
        this.statusSelects.push(statusSelect);

        // 分隔线左侧全部是多选状态钮；分组改为 BPM 同款下拉。
        filterGroup.createSpan({ cls: "ribbon-filter-divider" });
        const groupOptions = [{ value: "", label: t("Ribbon_全部分组") },
            ...this.manager.settings.RIBBON_GROUPS.map(group => ({ value: group.id, label: `${group.name} (${group.members.length})` }))];
        this.filterSelects.push(ScopeSelect.compact(filterGroup, t("Ribbon_分组筛选"), this.groupFilter, groupOptions, value => {
            this.groupFilter = value;
            refresh();
        }));

        // 右侧：显示已分组开关 + 搜索框
        const rightSide = filterBar.createDiv("ribbon-manager-filter-right");
        if (this.manager.settings.RIBBON_GROUPS.length) {
            const groupedToggle = rightSide.createDiv("ribbon-manager-grouped-toggle");
            groupedToggle.createSpan({ cls: "ribbon-manager-grouped-toggle__label", text: t("Ribbon_显示已分组") });
            const toggle = new ToggleComponent(groupedToggle);
            toggle.setValue(this.showGroupedItems);
            toggle.setTooltip(t("Ribbon_显示已分组说明"));
            toggle.onChange(value => {
                this.showGroupedItems = value;
                this.displayWithoutSearch();
            });
        }
        const searchContainer = rightSide.createDiv("ribbon-manager-search-container");
        const searchWrapper = searchContainer.createDiv("ribbon-search-wrapper");
        const searchIconEl = searchWrapper.createDiv("ribbon-search-icon");
        setIcon(searchIconEl, "search");

        const searchInput = new TextComponent(searchWrapper);
        searchInput.setPlaceholder(t("Ribbon_搜索_占位"));
        searchInput.inputEl.addClass("ribbon-search-input");

        if (this.searchQuery) {
            searchInput.setValue(this.searchQuery);
        }

        searchInput.onChange((value) => {
            this.searchQuery = value;
            refresh();
        });
    }

    private getFilteredRibbonItems(): RibbonItem[] {
        const allItems = this.manager.settings.RIBBON_SETTINGS;

        // 根据过滤器筛选项目
        const memberIds = new Set(this.manager.settings.RIBBON_GROUPS.flatMap(group => group.members));
        let items = this.showGroupedItems ? allItems : allItems.filter(item => !memberIds.has(item.bpmUniqueId));
        if (this.groupFilter) {
            const group = this.manager.settings.RIBBON_GROUPS.find(entry => entry.id === this.groupFilter);
            if (group) items = allItems.filter(item => group.members.includes(item.bpmUniqueId));
            else this.groupFilter = "";
        }
        if (this.statusFilters.size) {
            items = items.filter(item => this.statusFilters.has(this.getRibbonItemStatus(item)));
        }

        // 根据搜索词过滤
        if (this.searchQuery && this.searchQuery.trim()) {
            const query = this.searchQuery.toLowerCase().trim();
            items = items.filter(item => {
                const name = (item.name || "").toLowerCase();
                const id = (item.bpmUniqueId || "").toLowerCase();
                return name.includes(query) || id.includes(query);
            });
        }

        return items;
    }

    renderFilteredList(containerEl: HTMLElement, listContainer: HTMLElement) {
        this.closeItemGroupMenus();
        listContainer.empty();
        const items = this.getFilteredRibbonItems();
        if (items.length === 0) {
            listContainer.createEl("p", { text: this.manager.translator.t("Ribbon_无项目") });
            return;
        }

        const t = (k: string) => this.manager.translator.t(k);

        items.forEach((item, displayIndex) => {
            // 使用实际配置的 order 作为序号，而不是过滤后的索引
            const actualOrder = item.order ?? displayIndex;
            const setting = new Setting(listContainer);
            const itemEl = setting.settingEl;
            itemEl.addClass("draggable-item");
            itemEl.setAttr("data-index", displayIndex.toString());
            itemEl.setAttr("data-item-id", item.bpmUniqueId);
            itemEl.toggleClass("is-hidden", !item.visible);
            setting.nameEl.addClass("ribbon-manager-item-name-root");
            setting.controlEl.addClass("ribbon-manager-item-control-root");

            // 自定义内容布局
            const itemContent = setting.nameEl.createDiv({ cls: "draggable-item-content" });

            const orderEl = itemContent.createDiv({ cls: "ribbon-manager-item-order" });
            const orderInput = orderEl.createEl("input", {
                cls: "ribbon-manager-item-order__input",
                attr: {
                    type: "text",
                    inputmode: "numeric",
                    value: `${actualOrder + 1}`,
                    "aria-label": t("Ribbon_序号"),
                },
            });
            const commitOrder = () => {
                const total = this.manager.settings.RIBBON_SETTINGS.length;
                const parsed = Number.parseInt(orderInput.value, 10);
                const target = Number.isFinite(parsed) ? Math.min(total, Math.max(1, parsed)) : actualOrder + 1;
                orderInput.value = `${target}`;
                this.action(async () => { await this.moveItemToPosition(item, target - 1); })();
            };
            orderInput.addEventListener("focus", () => orderInput.select());
            orderInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter") { event.preventDefault(); orderInput.blur(); }
                else if (event.key === "Escape") { orderInput.value = `${actualOrder + 1}`; orderInput.blur(); }
            });
            orderInput.addEventListener("blur", commitOrder);

            // 图标
            const pluginDisabled = this.isRibbonItemPluginDisabled(item);
            const pluginMissing = this.isRibbonItemPluginMissing(item);
            const iconEl = itemContent.createDiv({ cls: "setting-item-icon" });
            this.renderRibbonItemIcon(iconEl, item);
            if (pluginDisabled || pluginMissing) {
                iconEl.addClass("ribbon-manager-item-icon--disabled");
                itemEl.addClass(pluginMissing ? "is-plugin-missing" : "is-plugin-disabled");
            }

            const textWrap = itemContent.createDiv({ cls: "ribbon-manager-item-text" });
            const titleLine = textWrap.createDiv({ cls: "ribbon-manager-item-title-line" });
            titleLine.createDiv({
                text: item.name || this.manager.translator.t("Ribbon_未命名"),
                cls: `setting-item-name${pluginDisabled ? " ribbon-manager-item-name--disabled" : ""}`
            });
            const stateEl = titleLine.createSpan({
                text: item.visible ? t("管理器_状态_显示中") : t("管理器_状态_已隐藏"),
                cls: `ribbon-manager-item-state ${item.visible ? "is-visible" : "is-hidden"}`
            });
            if (pluginDisabled) titleLine.createSpan({ cls: "ribbon-manager-disabled-chip", text: t("Ribbon_插件被禁用") });
            if (pluginMissing) titleLine.createSpan({ cls: "ribbon-manager-missing-chip", text: t("Ribbon_插件未加载") });
            const groupOfItem = this.manager.settings.RIBBON_GROUPS.find(group => group.members.includes(item.bpmUniqueId));
            if (groupOfItem) {
                itemEl.addClass("is-grouped-item");
                const chip = titleLine.createSpan({ cls: "ribbon-manager-grouped-chip" });
                setIcon(chip.createSpan("ribbon-manager-grouped-chip__icon"), groupOfItem.icon || "folder");
                chip.createSpan({ text: groupOfItem.name });
            } else if (item.bpmUniqueId.startsWith(RIBBON_GROUP_ITEM_PREFIX)) {
                titleLine.createSpan({ cls: "ribbon-manager-grouped-chip", text: t("Ribbon_分组入口") });
            }

            const controlBar = setting.controlEl.createDiv({ cls: "ribbon-manager-control-bar" });

            // 可见性按钮
            const visibilityDiv = controlBar.createDiv({ cls: "ribbon-manager-control-visibility" });
            const syncVisibilityRow = () => {
                itemEl.toggleClass("is-hidden", !item.visible);
                stateEl.setText(item.visible ? t("管理器_状态_显示中") : t("管理器_状态_已隐藏"));
                stateEl.toggleClass("is-visible", item.visible);
                stateEl.toggleClass("is-hidden", !item.visible);
                visibilityButton.setIcon(item.visible ? "eye" : "eye-off")
                    .setTooltip(this.manager.translator.t(item.visible ? "Ribbon_隐藏" : "Ribbon_显示"));
            };
            const visibilityButton = new ButtonComponent(visibilityDiv)
                .setIcon(item.visible ? "eye" : "eye-off")
                .setTooltip(this.manager.translator.t(item.visible ? "Ribbon_隐藏" : "Ribbon_显示"))
                .onClick(() => {
                    item.visible = !item.visible;
                    // 先让这一行立刻反馈，再把原生显隐与移动端 SAF 写盘推到下一帧/后台。
                    if (this.statusFilters.has("visible") || this.statusFilters.has("hidden")) {
                        this.rerenderPreservingScroll();
                    } else {
                        syncVisibilityRow();
                    }
                    this.scheduleFrame(itemEl, this.action(async () => {
                        this.manager.applyRibbonSettings();
                        await this.manager.saveSettings();
                    }), true);
                });

            if (!item.bpmUniqueId.startsWith(RIBBON_GROUP_ITEM_PREFIX)) {
                const dropdown = ScopeSelect.compact(setting.controlEl, t('Ribbon_分组'), groupOfItem?.id ?? '',
                    [{ value: '', label: t('Ribbon_未分组') }, ...this.manager.settings.RIBBON_GROUPS.map(group => ({ value: group.id, label: group.name }))], id => {
                        for (const group of this.manager.settings.RIBBON_GROUPS) {
                            group.members = group.members.filter(member => member !== item.bpmUniqueId);
                            if (group.memberOrders) delete group.memberOrders[item.bpmUniqueId];
                        }
                        const group = this.manager.settings.RIBBON_GROUPS.find(entry => entry.id === id);
                        if (group) {
                            group.members.push(item.bpmUniqueId);
                            const maxOrder = Math.max(-1, ...Object.values(group.memberOrders || {}));
                            group.memberOrders = { ...(group.memberOrders || {}), [item.bpmUniqueId]: maxOrder + 1 };
                            // 分组入口落在最靠前的成员位置，而不是永远追加到末尾。
                            this.manager.syncRibbonGroupItems();
                            const groupItem = this.manager.settings.RIBBON_SETTINGS.find(entry =>
                                entry.bpmUniqueId === `${RIBBON_GROUP_ITEM_PREFIX}${group.id}`);
                            const memberItem = this.manager.settings.RIBBON_SETTINGS.find(entry => entry.bpmUniqueId === item.bpmUniqueId);
                            if (groupItem && memberItem) {
                                groupItem.order = Math.min(groupItem.order, memberItem.order);
                            }
                        }
                        this.commitRibbonGroups();
                        this.displayWithoutSearch();
                    });
                dropdown.field.addClass('ribbon-manager-group-select');
                this.groupSelects.push(dropdown);
            }

            // 拖拽手柄
            const handle = controlBar.createDiv({
                cls: "ribbon-manager-control-drag",
                attr: { role: "button", "aria-label": t("管理器_布局_拖动排序") }
            });
            setIcon(handle, "grip-vertical");
            handle.setAttr("draggable", "true");
            handle.addEventListener("pointerdown", (e) => this.startDrag(itemEl, displayIndex, item, e));
            // 阻止原生拖拽，使用 pointer events 模拟
            handle.addEventListener("dragstart", (e) => e.preventDefault());
        });
    }

    startDrag(itemEl: HTMLElement, displayIndex: number, draggedItem: RibbonItem, e: PointerEvent) {
        const target = e.targetNode;
        if (target?.instanceOf(itemEl.ownerDocument.defaultView?.Element ?? Element)) target.setPointerCapture(e.pointerId);

        this.draggedItemEl = itemEl;
        this.dragStartIndex = displayIndex;
        this.draggedItem = draggedItem;

        const rect = itemEl.getBoundingClientRect();

        this.dragOffsetX = e.clientX - rect.left;
        this.dragOffsetY = e.clientY - rect.top;
        this.activePointerId = e.pointerId;

        // 创建幽灵元素
        this.ghostEl = itemEl.cloneNode(true) as HTMLElement;
        this.ghostEl.addClass("drag-ghost");
        this.dragDocument = itemEl.ownerDocument;
        this.dragDocument.body.appendChild(this.ghostEl);
        this.ghostEl.setCssStyles({
            width: `${rect.width}px`,
            height: `${rect.height}px`,
        });

        this.updateGhostPosition(e);

        // 创建占位符
        this.placeholderEl = (itemEl.ownerDocument.defaultView ?? window).createDiv();
        this.placeholderEl.className = "drag-gap-placeholder";
        this.placeholderEl.setCssStyles({
            height: `${rect.height}px`,
            marginBottom: "0",
        });

        itemEl.parentNode!.insertBefore(this.placeholderEl, itemEl);
        itemEl.addClass("dragging");

        this.dragDocument.addEventListener("pointermove", this.handleDragMove, { passive: false });
        this.dragDocument.addEventListener("pointerup", this.handleDragEndEvent, { once: true });
        this.dragDocument.addEventListener("pointercancel", this.handleDragEndEvent, { once: true });
    }

    private handleDragMove = (e: PointerEvent) => {
        if (!this.ghostEl || !this.placeholderEl || !this.draggedItemEl) return;
        if (e.pointerId !== this.activePointerId) return;

        e.preventDefault();
        this.updateGhostPosition(e);

        const listContainer = this.placeholderEl.parentNode!;
        const items = Array.from(listContainer.children).filter(
            (el) => el !== this.placeholderEl && !el.classList.contains("dragging") && !el.classList.contains("drag-ghost")
        );

        let dropTarget: Element | null = null;
        for (const item of items) {
            const rect = item.getBoundingClientRect();
            // 当鼠标超过元素中点时视为拖动到该元素之后/位置
            if (e.clientY < rect.top + rect.height / 2) {
                dropTarget = item;
                break;
            }
        }

        if (dropTarget) {
            listContainer.insertBefore(this.placeholderEl, dropTarget);
        } else {
            listContainer.appendChild(this.placeholderEl);
        }
    }

    updateGhostPosition(e: PointerEvent) {
        if (!this.ghostEl) return;
        this.ghostEl.setCssStyles({
            left: `${e.clientX - this.dragOffsetX}px`,
            top: `${e.clientY - this.dragOffsetY}px`,
        });
    }

    private handleDragEnd = async (e: PointerEvent) => {
        if (!this.draggedItemEl || !this.placeholderEl || !this.draggedItem) return;

        const listContainer = this.placeholderEl.parentNode!;

        // 找到 placeholder 之前的元素
        let targetElement: Element | null = null;
        const children = Array.from(listContainer.children);
        for (let i = 0; i < children.length; i++) {
            if (children[i] === this.placeholderEl) {
                // 找到 placeholder 前一个非拖拽元素
                for (let j = i - 1; j >= 0; j--) {
                    if (children[j].matches(".draggable-item:not(.dragging)")) {
                        targetElement = children[j];
                        break;
                    }
                }
                break;
            }
        }

        // 清理
        this.placeholderEl.remove();
        this.placeholderEl = null;
        if (this.ghostEl) {
            this.ghostEl.remove();
            this.ghostEl = null;
        }

        this.draggedItemEl.removeClass("dragging");
        this.clearDragListeners();

        // 读取目标元素的 item-id 并更新实际的 order
        if (targetElement) {
            const targetItemId = targetElement.getAttribute("data-item-id");
            const allItems = this.manager.settings.RIBBON_SETTINGS;
            const targetItem = allItems.find(item => item.bpmUniqueId === targetItemId);

            if (targetItem && this.draggedItem) {
                // 获取目标项的 order，拖拽项插入到其后
                const targetOrder = targetItem.order ?? 0;
                const draggedOrder = this.draggedItem.order ?? 0;

                // 更新所有项的 order
                allItems.forEach(item => {
                    if (item === this.draggedItem) {
                        item.order = targetOrder + 1;
                    } else if (draggedOrder < targetOrder) {
                        // 向下拖拽
                        if ((item.order ?? 0) > draggedOrder && (item.order ?? 0) <= targetOrder) {
                            item.order = (item.order ?? 0) - 1;
                        }
                    } else {
                        // 向上拖拽
                        if ((item.order ?? 0) >= targetOrder + 1 && (item.order ?? 0) < draggedOrder) {
                            item.order = (item.order ?? 0) + 1;
                        }
                    }
                });

                // 重新排序
                allItems.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                allItems.forEach((item, index) => {
                    item.order = index;
                });

                await this.manager.saveSettings();

                // 顺序已写入设置，推入 Obsidian 原生状态
                this.manager.applyRibbonSettings();
            }
        }

        this.draggedItemEl = null;
        this.dragStartIndex = -1;
        this.draggedItem = null;
        this.activePointerId = null;

        this.rerenderPreservingScroll();
    }

    async moveItem(oldIndex: number, newIndex: number) {
        if (!this.manager.isRibbonManagerEnabled()) return;

        const items = this.manager.settings.RIBBON_SETTINGS;
        if (oldIndex < 0 || oldIndex >= items.length || newIndex < 0 || newIndex > items.length) {
            this.display();
            return;
        }

        const [movedItem] = items.splice(oldIndex, 1);
        items.splice(newIndex, 0, movedItem);

        await this.persistRibbonConfig();
        this.display();
    }

    private async persistRibbonConfig() {
        if (!this.manager.isRibbonManagerEnabled()) return;

        const items = this.manager.settings.RIBBON_SETTINGS;
        items.forEach((item, idx) => item.order = idx);
        await this.manager.saveSettings();

        // 显隐与顺序推入 Obsidian 原生状态
        this.manager.applyRibbonSettings();
    }

    async resetRibbonLayout() {
        if (!this.manager.isRibbonManagerEnabled()) return;

        const items = this.manager.settings.RIBBON_SETTINGS;
        items.sort((a, b) => (a.name || a.bpmUniqueId).localeCompare(b.name || b.bpmUniqueId));
        items.forEach((item, idx) => {
            item.visible = true;
            item.order = idx;
        });
        await this.persistRibbonConfig();
        this.displayWithoutSearch();
    }

    private clearDragListeners(): void {
        this.dragDocument?.removeEventListener("pointermove", this.handleDragMove);
        this.dragDocument?.removeEventListener("pointerup", this.handleDragEndEvent);
        this.dragDocument?.removeEventListener("pointercancel", this.handleDragEndEvent);
        this.dragDocument = undefined;
    }

    onClose(): void {
        this.clearFrames();
        this.clearDragListeners();
        this.ghostEl?.remove();
        this.placeholderEl?.remove();
        this.draggedItemEl?.removeClass('dragging');
        this.ghostEl = null;
        this.placeholderEl = null;
        this.draggedItemEl = null;
        this.draggedItem = null;
        this.activePointerId = null;
        this.scrollbars?.destroy();
        this.scrollbars = undefined;
        this.closeGroupMenus();
        this.scopeBar?.close();
        this.manager.ribbonModal = null;
        // 弹窗关闭时结束设备预设投影，避免编辑值残留在内存。
        void this.manager.devices.flushProjection().then(() => this.manager.endSettingsEditing(this))
            .catch(error => this.manager.devices.report(error));
    }
}
