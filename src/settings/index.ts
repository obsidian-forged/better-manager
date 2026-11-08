import { FloatingScrollbars } from '../ui/floating-scrollbars';
import { SettingsSaveButton } from '../ui/settings-save-button';
import { ScopeSelect } from '../ui/scope-select';
import { App, ButtonComponent, ExtraButtonComponent, PluginSettingTab, requireApiVersion, setIcon, Setting, ToggleComponent } from 'obsidian';
import type { SettingDefinitionItem, SettingDefinitionPage } from 'obsidian';
import { protectionText } from './protection-text';
import { SettingsSearch, SettingsSearchPage } from './search-view';
import { SyncNoticeView } from '../ui/sync-notice-view';
import { syncNativeSettingsPageTitle } from './native-page-title';
import Manager from "../main";
import type BaseSetting from './base-setting';

import ManagerBasis from './ui/manager-basis';
import ManagerStyle from './ui/manager-style';
import ManagerDelay from './ui/manager-delay';
import ManagerTag from './ui/manager-tag';
import ManagerGroup from './ui/manager-group';
import ManagerMainPage from './ui/manager-main-page';


class ManagerSettingTab extends PluginSettingTab {
    manager: Manager;
    app: App;
    contentEl!: HTMLDivElement;
    private scrollbars?: FloatingScrollbars;
    private search?: SettingsSearch;
    private syncNoticeView?: SyncNoticeView;
    private settingsSaveButton?: SettingsSaveButton;
    private navigationSaveButton?: ExtraButtonComponent;
    private navigation?: ScopeSelect;
    private navigationObserver?: MutationObserver;
    private closeObserver?: MutationObserver;
    private nativeContainer?: HTMLElement;
    private readonly restoreFrames = new Map<number, Window>();
    public isVisible = false;

    private get renderRoot(): HTMLElement { return this.nativeContainer ?? this.containerEl; }

    /** 1.13+ 使用真实设置分页及搜索索引，旧版本仍调用 display；Keep the existing editor in native settings pages. */
    getSettingDefinitions(): SettingDefinitionItem[] {
        const pages = this.searchPages();
        const indexed = SettingsSearch.index(pages, this.containerEl.ownerDocument, this.manager.translator.t('功能开关_个性化'));
        this.observeNavigation();
        const t = (key: string) => this.manager.translator.t(key);
        // 原生分页列表补上与编辑页一致的搜索/保存按钮；搜索按钮打开完整设置搜索。
        // Mirror the editor's search/save buttons on the native page list; search opens the full settings search.
        return [{ type: 'group', cls: 'manager-setting-navigation', heading: t('管理器_BPM设置_短'),
            items: pages.map((page, index): SettingDefinitionPage => ({
            type: 'page',
            name: page.label,
            desc: this.navigationDescription(page),
            items: [{
                name: page.label,
                desc: indexed.filter(item => item.page === index).map(item => `${item.name} ${item.description}`).join(' '),
                aliases: indexed.filter(item => item.page === index).flatMap(item => [item.name, item.description]).filter(Boolean),
                render: setting => {
                    this.hide();
                    const root = setting.settingEl;
                    root.empty();
                    root.removeClass('setting-item');
                    this.nativeContainer = root;
                    this.activeTabIndex = index;
                    this.displayEditor();
                    return () => {
                        if (this.nativeContainer !== root) return;
                        this.hide();
                        this.nativeContainer = undefined;
                    };
                },
            }],
        })) }];
    }

    /** 原生入口保留名称和项目概览，再补原生图标；Decorate only this tab's native page entries. */
    private navigationDescription(page: SettingsSearchPage): DocumentFragment {
        const doc = this.containerEl.ownerDocument;
        const fragment = (doc.defaultView ?? window).createFragment();
        const summary = (doc.defaultView ?? window).createDiv({ cls: 'manager-setting-navigation__summary' });
        summary.setAttribute('data-bpm-setting-icon', page.icon ?? 'settings-2');
        summary.setText(page.description);
        if (page.disabled) {
            summary.addClass('manager-setting-navigation__summary--disabled');
            const toggle = new ToggleComponent(summary);
            toggle.setValue(false);
            toggle.setTooltip(this.manager.translator.t('设置_延迟启动_开启'));
            toggle.toggleEl.addEventListener('click', (event) => event.stopPropagation());
            toggle.onChange((value) => {
                if (!value) return;
                this.enableDelayFromNavigation().catch(error => this.manager.devices?.report(error));
            });
        }
        fragment.append(summary);
        return fragment;
    }

    private observeNavigation(): void {
        this.navigationObserver?.disconnect();
        const root = this.containerEl;
        const view = root.ownerDocument.defaultView ?? window;
        const decorate = () => {
            root.querySelectorAll<HTMLElement>('.manager-setting-navigation > .setting-item-heading > .setting-item-name').forEach(heading => {
                if (heading.hasClass('manager-setting-navigation__heading')) return;
                const label = heading.textContent ?? this.manager.translator.t('管理器_BPM设置_短');
                heading.empty();
                heading.addClass('manager-setting-navigation__heading');
                const icon = heading.createSpan({ cls: 'manager-setting-navigation__heading-icon', attr: { 'aria-hidden': 'true' } });
                setIcon(icon, 'settings');
                heading.createSpan({ cls: 'manager-setting-navigation__heading-label', text: label });
            });
            root.querySelectorAll<HTMLElement>('.manager-setting-navigation__summary').forEach(summary => {
                const row = summary.closest<HTMLElement>('.setting-item.mod-navigable');
                if (!row || row.hasClass('manager-setting-navigation__entry')) return;
                row.addClass('manager-setting-navigation__entry');
                if (summary.hasClass('manager-setting-navigation__summary--disabled')) {
                    row.addClass('manager-setting-navigation__entry--disabled');
                }
                const icon = row.createSpan({ cls: 'manager-setting-navigation__icon', attr: { 'aria-hidden': 'true' } });
                setIcon(icon, summary.getAttribute('data-bpm-setting-icon') ?? 'settings-2');
                row.prepend(icon);
            });
            // 原生分页列表同样提供搜索与保存入口；保存只在手动保存模式显示。
            // The native page list also gets search and save controls; save only for manual saving.
            root.querySelectorAll<HTMLElement>('.manager-setting-navigation > .setting-item-heading > .setting-item-control').forEach(control => {
                if (!control.querySelector('.manager-setting-search__native-trigger')) {
                    const search = new ExtraButtonComponent(control);
                    search.extraSettingsEl.addClass('manager-setting-search__native-trigger');
                    search.setIcon('search').setTooltip(this.manager.translator.t('设置_搜索_标题'));
                    search.onClick(() => this.openSearchFromNavigation());
                }
                const existing = control.querySelector<HTMLElement>('.bpm-settings-save');
                if (this.manager.settings?.MANUAL_CONFIG_SAVE === false) {
                    if (existing) {
                        existing.remove();
                        if (this.navigationSaveButton?.extraSettingsEl === existing) this.navigationSaveButton = undefined;
                    }
                    return;
                }
                if (existing) return;
                const button = new ExtraButtonComponent(control);
                this.navigationSaveButton = button;
                button.extraSettingsEl.addClass('bpm-settings-save');
                button.onClick(() => { void this.manager.savePendingSettings(); });
                this.refreshNavigationSave();
            });
        };
        this.navigationObserver = new view.MutationObserver(decorate);
        this.navigationObserver.observe(root, { childList: true, subtree: true });
        decorate();
    }

    /** 从原生分类列表打开完整设置搜索；Open the full settings search from the native page list. */
    private openSearchFromNavigation(): void {
        const rows = this.containerEl.querySelectorAll<HTMLElement>('.manager-setting-navigation .setting-item.mod-navigable');
        const index = this.activeTabIndex >= 0 && this.activeTabIndex < rows.length ? this.activeTabIndex : 0;
        const row = rows[index] ?? rows[0];
        if (!row) return;
        row.click();
        const view = this.containerEl.ownerDocument.defaultView ?? window;
        view.setTimeout(() => this.renderRoot.querySelector<HTMLButtonElement>('.manager-setting-search__trigger')?.click(), 0);
    }

    hide(): void {
        this.clearRestoreFrames();
        this.isVisible = false;
        this.scrollbars?.destroy(); this.scrollbars = undefined;
        this.search?.destroy(); this.search = undefined;
        this.syncNoticeView?.destroy(); this.syncNoticeView = undefined;
        this.settingsSaveButton?.destroy(); this.settingsSaveButton = undefined;
        this.navigation?.close(); this.navigation = undefined;
        // Switching native settings tabs hides this tab, but does not close its editor session.
        const modal = this.renderRoot.closest('.modal-container');
        this.closeObserver?.disconnect();
        if (!modal?.isConnected) this.manager.endSettingsEditing(this);
        else {
            this.closeObserver = new MutationObserver(() => {
                if (modal.isConnected) return;
                this.closeObserver?.disconnect();
                this.closeObserver = undefined;
                this.manager.endSettingsEditing(this);
            });
            this.closeObserver.observe(modal.ownerDocument.body, { childList: true, subtree: true });
        }
    }

    constructor(app: App, manager: Manager) {
        super(app, manager);
        this.manager = manager;
        this.app = app;
        // 只修饰 BPM 设置页根容器，避免原生灰色面板与黑底割裂；Scope the background fix to BPM settings.
        this.containerEl.addClass('manager-setting__root');
        if (requireApiVersion('1.11.0')) this.icon = 'settings';
        manager.register(() => { this.clearRestoreFrames(); this.closeObserver?.disconnect(); this.syncNoticeView?.destroy(); this.settingsSaveButton?.destroy(); this.navigation?.close(); this.navigationObserver?.disconnect(); });
    }

    display(): void {
        if (this.nativeContainer) this.hide();
        this.nativeContainer = undefined;
        this.displayEditor();
    }

    private displayEditor(): void {
        this.closeObserver?.disconnect(); this.closeObserver = undefined;
        this.isVisible = true;
        this.manager.beginSettingsEditing(this);
        this.renderSettings();
    }

    refreshConfigConflict(): void {
        this.renderRoot.toggleClass('has-config-conflict', Boolean(this.manager.configProtection?.protection.paused));
        this.syncNoticeView?.refresh();
    }

    refreshSettingsSaveState(): void { this.settingsSaveButton?.refresh(); this.refreshNavigationSave(); }

    /** 原生分页列表的保存按钮与顶栏共用状态；Keep the native-list save button in sync with the topbar. */
    private refreshNavigationSave(): void {
        const button = this.navigationSaveButton;
        if (!button) return;
        const saving = this.manager.isSavingSettings, dirty = this.manager.hasUnsavedSettings;
        button.setIcon(saving ? 'loader-circle' : 'save').setDisabled(saving)
            .setTooltip(protectionText(this.manager, saving ? 'saving' : dirty ? 'saveSettings' : 'checkSaveSettings'));
        button.extraSettingsEl.toggleClass('has-unsaved-settings', dirty);
        button.extraSettingsEl.toggleClass('is-saving', saving);
    }

    /** 记住当前分页，重绘后回到同一页并恢复滚动位置，避免改一次配置就跳回顶部。 */
    private activeTabIndex = 0;

    private scrollContainer(): HTMLElement | null {
        let el: HTMLElement | null = this.renderRoot;
        while (el) {
            const overflowY = getComputedStyle(el).overflowY;
            if (overflowY === 'auto' || overflowY === 'scroll') return el;
            el = el.parentElement;
        }
        return null;
    }

    private restoreScroll(element: HTMLElement, top: number): void {
        const view = element.ownerDocument.defaultView;
        if (!view) return;
        const frame = view.requestAnimationFrame(() => {
            this.restoreFrames.delete(frame);
            if (element.isConnected) element.scrollTop = top;
        });
        this.restoreFrames.set(frame, view);
    }

    private clearRestoreFrames(): void {
        this.restoreFrames.forEach((view, frame) => view.cancelAnimationFrame(frame));
        this.restoreFrames.clear();
    }

    renderSettings(): void {
        this.clearRestoreFrames();
        const containerEl = this.renderRoot;
        this.search?.destroy();
        this.search = undefined;
        const scroller = this.scrollContainer();
        const scrollTop = scroller?.scrollTop ?? 0;
        // 分页内容自身也是滚动容器，改配置触发的重绘要沿用它的位置。
        const contentTop = this.contentEl?.scrollTop ?? 0;
        const restore = () => {
            if (scroller && scrollTop > 0) {
                scroller.scrollTop = scrollTop;
                this.restoreScroll(scroller, scrollTop);
            }
            if (contentTop > 0) {
                this.contentEl.scrollTop = contentTop;
                const content = this.contentEl;
                this.restoreScroll(content, contentTop);
            }
        };
        this.scrollbars?.destroy();
        this.navigation?.close(); this.navigation = undefined;
        this.settingsSaveButton?.destroy();
        this.settingsSaveButton = undefined;
        containerEl.empty();
        containerEl.addClass('manager-setting__container');
        this.syncNoticeView?.destroy(); this.syncNoticeView = undefined;
        this.refreshConfigConflict();
        const topbar = containerEl.createDiv();
        topbar.addClass('manager-setting__topbar');
        const navigationHost = topbar.createDiv('manager-setting__navigation');
        const navigationLabel = this.manager.translator.t('设置_切换设置');
        const label = navigationHost.createSpan('manager-setting__brand');
        setIcon(label.createSpan({ cls: 'manager-setting__brand-icon', attr: { 'aria-hidden': 'true' } }), 'settings');
        label.createSpan({ cls: 'manager-setting__brand-label', text: navigationLabel });
        this.syncNoticeView = new SyncNoticeView(this.manager, topbar, () => {
            if (this.manager.configProtection?.protection.paused) this.manager.openConfigConflict();
            else this.manager.showPrivateCacheWarning();
        });
        const searchButton = new ButtonComponent(topbar).setIcon('search').setTooltip(this.manager.translator.t('设置_搜索_标题'));
        searchButton.buttonEl.addClass('manager-setting-search__trigger');
        searchButton.onClick(() => {
            this.search = new SettingsSearch(this, this.searchPages(), (page, ordinal) => {
                if (page !== undefined) this.activeTabIndex = page;
                this.renderSettings();
                if (ordinal !== undefined) {
                    const target = SettingsSearch.rows(this.contentEl)[ordinal];
                    target?.addClass('manager-setting-search__target');
                    target?.scrollIntoView({ block: 'center' });
                    const control = target?.querySelector<HTMLElement>('input, select, textarea, button');
                    control?.focus({ preventScroll: true });
                } else this.renderRoot.querySelector<HTMLButtonElement>('.manager-setting-search__trigger')?.focus();
            });
            this.search.open(topbar);
        });
        this.settingsSaveButton = new SettingsSaveButton(this.manager, topbar);
        this.contentEl = containerEl.createDiv();
        this.contentEl.addClass('manager-setting__content');

        const pages = this.searchPages();
        const activate = (value: string) => {
            if (value === 'overview') {
                this.activeTabIndex = -1;
                this.contentEl.empty();
                this.renderOverview(this.contentEl);
                return;
            }
            const index = Number(value), page = pages[index];
            if (!page) return;
            this.activeTabIndex = index;
            this.contentEl.empty();
            page.render(this.contentEl);
            syncNativeSettingsPageTitle(this.nativeContainer, page.label, this.app);
        };
        this.activeTabIndex = Math.min(this.activeTabIndex, pages.length - 1);
        const initial = this.activeTabIndex < 0 ? 'overview' : `${this.activeTabIndex}`;
        this.navigation = ScopeSelect.compact(navigationHost, navigationLabel, initial, [
            { value: 'overview', label: this.manager.translator.t('设置_全部分类'), icon: 'layout-grid' },
            ...pages.map((page, index) => ({ value: `${index}`, label: page.label, icon: page.icon })),
        ], activate);
        this.navigation.field.addClass('manager-setting__page-select');
        activate(initial);
        this.scrollbars = new FloatingScrollbars(containerEl);
        restore();
    }
    /** 类似原生分类列表的设置总览；A settings overview equivalent to the native category list. */
    private renderOverview(container: HTMLElement): void {
        const t = (key: string) => this.manager.translator.t(key);
        const page = container.createDiv('manager-setting__overview');
        const title = page.createDiv('manager-setting__overview-title');
        setIcon(title.createSpan('manager-setting__overview-title-icon'), 'settings');
        title.createSpan({ text: t('管理器_BPM设置_短') });
        const list = page.createDiv('manager-setting__overview-list');
        this.searchPages().forEach((item, index) => {
            const row = new Setting(list).setName(item.label).setDesc(item.description);
            row.settingEl.addClass('manager-setting__overview-entry');
            const icon = row.nameEl.createSpan('manager-setting__overview-icon');
            setIcon(icon, item.icon ?? 'settings-2');
            row.nameEl.prepend(icon);
            const arrow = row.controlEl.createSpan('manager-setting__overview-arrow');
            setIcon(arrow, 'chevron-right');
            if (item.disabled) row.settingEl.addClass('manager-setting__overview-entry--disabled');
            row.settingEl.addEventListener('click', (event) => {
                if (event.target instanceof Element && event.target.closest('.checkbox-container')) return;
                this.activeTabIndex = index;
                this.renderSettings();
            });
            if (item.disabled) {
                const toggle = new ToggleComponent(row.controlEl);
                toggle.setValue(false);
                toggle.setTooltip(t('设置_延迟启动_开启'));
                toggle.toggleEl.addEventListener('click', (event) => event.stopPropagation());
                toggle.onChange((value) => {
                    if (value) this.enableDelayFromNavigation().catch(error => this.manager.devices?.report(error));
                });
            }
        });
        syncNativeSettingsPageTitle(this.nativeContainer, t('管理器_BPM设置_短'), this.app);
    }

    /** 从管理器筛选下拉直接打开分组/标签/延迟设置；Open a filter-related settings category. */
    public openFilterPage(page: 'group' | 'tag' | 'delay'): void {
        const key = page === 'group' ? '设置_分组设置_前缀' : page === 'tag' ? '设置_标签设置_前缀' : '设置_延迟设置_前缀';
        const index = this.searchPages().findIndex(item => item.key === key);
        if (index < 0) return;
        // 优先走原生设置页入口，保留原生返回栏与侧栏；Use native page navigation when available.
        const icon = page === 'group' ? 'folder-tree' : page === 'tag' ? 'tags' : 'timer';
        const summary = this.containerEl.querySelector<HTMLElement>(`[data-bpm-setting-icon="${icon}"]`);
        const row = summary?.closest<HTMLElement>('.setting-item');
        if (row) {
            row.click();
            return;
        }
        this.activeTabIndex = index;
        this.renderSettings();
    }

    /** 从分类列表直接开启延迟启动；Enable delay management from the category list. */
    private async enableDelayFromNavigation(): Promise<void> {
        if (this.manager.settings.DELAY) return;
        this.manager.settings.DELAY = true;
        await this.manager.enableDelaysForAllPlugins();
        await this.manager.saveSettings();
        this.renderSettings();
    }

    private searchPages(): SettingsSearchPage[] {
        const pages: Array<{ key: string; descriptionKey: string; icon: string; view: new (tab: ManagerSettingTab, container?: HTMLElement) => BaseSetting; disabled?: boolean }> = [
            { key: '设置_基础设置_前缀', descriptionKey: '设置_导航_基础配置描述', icon: 'settings-2', view: ManagerBasis },
            { key: '设置_主页面功能_前缀', descriptionKey: '设置_导航_功能入口描述', icon: 'mouse-pointer-click', view: ManagerMainPage },
            { key: '设置_样式设置_前缀', descriptionKey: '设置_导航_界面样式描述', icon: 'palette', view: ManagerStyle },
            { key: '设置_分组设置_前缀', descriptionKey: '设置_导航_分组管理描述', icon: 'folder-tree', view: ManagerGroup },
            { key: '设置_标签设置_前缀', descriptionKey: '设置_导航_标签管理描述', icon: 'tags', view: ManagerTag },
            { key: '设置_延迟设置_前缀', descriptionKey: '设置_导航_延迟启动描述', icon: 'timer', view: ManagerDelay, disabled: !this.manager.settings.DELAY },
        ];
        return pages.map(page => ({ key: page.key, label: this.manager.translator.t(page.key), description: this.manager.translator.t(page.descriptionKey), icon: page.icon, disabled: page.disabled, render: container => new page.view(this, container).render() }));
    }
    basisDisplay() { this.contentEl.empty(); new ManagerBasis(this).render(); }
    mainPageDisplay() { this.contentEl.empty(); new ManagerMainPage(this).render(); }
    styleDisplay() { this.contentEl.empty(); new ManagerStyle(this).render(); }
    delayDisplay() { this.contentEl.empty(); new ManagerDelay(this).render(); }
    groupDisplay() { this.contentEl.empty(); new ManagerGroup(this).render(); }
    tagDisplay() { this.contentEl.empty(); new ManagerTag(this).render(); }
}

export { ManagerSettingTab };

