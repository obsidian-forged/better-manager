import { FloatingScrollbars } from '../ui/floating-scrollbars';
import { SettingsSaveButton } from '../ui/settings-save-button';
import { App, ButtonComponent, PluginSettingTab, setIcon } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import { SettingsSearch, SettingsSearchPage } from './search-view';
import { ConfigConflictView } from './conflict-view';
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
    private conflictView?: ConfigConflictView;
    private settingsSaveButton?: SettingsSaveButton;
    private closeObserver?: MutationObserver;
    private nativeContainer?: HTMLElement;
    private readonly restoreFrames = new Map<number, Window>();
    public isVisible = false;

    private get renderRoot(): HTMLElement { return this.nativeContainer ?? this.containerEl; }

    /** 1.13+ 使用真实设置分页及搜索索引，旧版本仍调用 display；Keep the existing editor in native settings pages. */
    getSettingDefinitions(): SettingDefinitionItem[] {
        const pages = this.searchPages();
        const indexed = SettingsSearch.index(pages, this.containerEl.ownerDocument, this.manager.translator.t('功能开关_个性化'));
        return pages.map((page, index) => ({
            type: 'page',
            name: page.label,
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
        }));
    }

    hide(): void {
        this.clearRestoreFrames();
        this.isVisible = false;
        this.scrollbars?.destroy(); this.scrollbars = undefined;
        this.search?.destroy(); this.search = undefined;
        this.conflictView?.destroy(); this.conflictView = undefined;
        this.settingsSaveButton?.destroy(); this.settingsSaveButton = undefined;
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
        manager.register(() => { this.clearRestoreFrames(); this.closeObserver?.disconnect(); this.conflictView?.destroy(); this.settingsSaveButton?.destroy(); });
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
        void this.conflictView?.refresh().catch(error => {
            if (this.manager.settings.DEBUG) console.error('[BPM] Settings conflict view failed', error);
        });
    }

    refreshSettingsSaveState(): void { this.settingsSaveButton?.refresh(); }

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
        this.settingsSaveButton?.destroy();
        this.settingsSaveButton = undefined;
        containerEl.empty();
        containerEl.addClass('manager-setting__container');
        this.conflictView?.destroy();
        this.conflictView = new ConfigConflictView(this.manager, containerEl.createDiv());
        this.refreshConfigConflict();
        const topbar = containerEl.createDiv();
        topbar.addClass('manager-setting__topbar');
        const brand = topbar.createDiv('manager-setting__brand');
        setIcon(brand.createSpan('manager-setting__brand-icon'), 'settings');
        brand.createSpan({ cls: 'manager-setting__brand-label', text: this.manager.translator.t('管理器_BPM设置_短') });
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
        const tabsWrap = topbar.createDiv();
        tabsWrap.addClass('manager-setting__tabs-wrap');
        const tabsEl = tabsWrap.createDiv();
        tabsEl.addClass('manager-setting__tabs');
        tabsEl.setAttribute('role', 'tablist');
        tabsEl.setAttribute('data-slot', 'tabs-list');
        this.settingsSaveButton = new SettingsSaveButton(this.manager, topbar);
        this.contentEl = containerEl.createDiv();
        this.contentEl.addClass('manager-setting__content');

        const tabItems = [
            { text: this.manager.translator.t('设置_基础设置_前缀'), icon: 'settings-2', content: () => this.basisDisplay() },
            { text: this.manager.translator.t('设置_主页面功能_前缀'), icon: 'mouse-pointer-click', content: () => this.mainPageDisplay() },
            { text: this.manager.translator.t('设置_样式设置_前缀'), icon: 'palette', content: () => this.styleDisplay() },
            { text: this.manager.translator.t('设置_分组设置_前缀'), icon: 'folder-tree', content: () => this.groupDisplay() },
            { text: this.manager.translator.t('设置_标签设置_前缀'), icon: 'tags', content: () => this.tagDisplay() },

        ];
        if (this.manager.settings.DELAY) tabItems.push({ text: this.manager.translator.t('设置_延迟设置_前缀'), icon: 'timer', content: () => this.delayDisplay() });

        const tabItemsEls: HTMLButtonElement[] = [];

        tabItems.forEach((item, index) => {
            const itemEl = tabsEl.createEl('button');
            itemEl.type = 'button';
            itemEl.addClass('manager-setting__tabs-item');
            itemEl.setAttribute('role', 'tab');
            itemEl.setAttribute('tabindex', '0');
            itemEl.setAttribute('data-slot', 'tabs-trigger');
            const iconEl = itemEl.createSpan('manager-setting__tabs-icon');
            iconEl.setAttribute('aria-hidden', 'true');
            setIcon(iconEl, item.icon);
            itemEl.createSpan({ cls: 'manager-setting__tabs-label', text: item.text });
            tabItemsEls.push(itemEl);
            const activate = () => {
                this.activeTabIndex = index;
                tabItemsEls.forEach(tabEl => {
                    tabEl.removeClass('manager-setting__tabs-item_is-active');
                    tabEl.setAttribute('aria-selected', 'false');
                    tabEl.setAttribute('data-state', 'inactive');
                });
                itemEl.addClass('manager-setting__tabs-item_is-active');
                itemEl.setAttribute('aria-selected', 'true');
                itemEl.setAttribute('data-state', 'active');
                item.content();
            };
            itemEl.setAttribute('aria-selected', 'false');
            itemEl.setAttribute('data-state', 'inactive');
            if (index === Math.min(this.activeTabIndex, tabItems.length - 1)) activate();
            itemEl.addEventListener('click', activate);
            itemEl.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                activate();
            });
        });
        this.scrollbars = new FloatingScrollbars(containerEl);
        restore();
    }
    private searchPages(): SettingsSearchPage[] {
        const pages: Array<{ key: string; view: new (tab: ManagerSettingTab, container?: HTMLElement) => BaseSetting }> = [
            { key: '设置_基础设置_前缀', view: ManagerBasis },
            { key: '设置_主页面功能_前缀', view: ManagerMainPage },
            { key: '设置_样式设置_前缀', view: ManagerStyle },
            { key: '设置_分组设置_前缀', view: ManagerGroup },
            { key: '设置_标签设置_前缀', view: ManagerTag },
        ];
        if (this.manager.settings.DELAY) pages.push({ key: '设置_延迟设置_前缀', view: ManagerDelay });
        return pages.map(page => ({ label: this.manager.translator.t(page.key), render: container => new page.view(this, container).render() }));
    }
    basisDisplay() { this.contentEl.empty(); new ManagerBasis(this).render(); }
    mainPageDisplay() { this.contentEl.empty(); new ManagerMainPage(this).render(); }
    styleDisplay() { this.contentEl.empty(); new ManagerStyle(this).render(); }
    delayDisplay() { this.contentEl.empty(); new ManagerDelay(this).render(); }
    groupDisplay() { this.contentEl.empty(); new ManagerGroup(this).render(); }
    tagDisplay() { this.contentEl.empty(); new ManagerTag(this).render(); }
}

export { ManagerSettingTab };

