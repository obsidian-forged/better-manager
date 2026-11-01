import { App, PluginSettingTab } from 'obsidian';
import Manager from "../main";

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

    constructor(app: App, manager: Manager) {
        super(app, manager);
        this.manager = manager;
        this.app = app;
    }

    display(): void {
        this.renderSettings();
    }

    /** 记住当前分页，重绘后回到同一页并恢复滚动位置，避免改一次配置就跳回顶部。 */
    private activeTabIndex = 0;

    private scrollContainer(): HTMLElement | null {
        let el: HTMLElement | null = this.containerEl;
        while (el) {
            const overflowY = getComputedStyle(el).overflowY;
            if (overflowY === 'auto' || overflowY === 'scroll') return el;
            el = el.parentElement;
        }
        return null;
    }

    renderSettings(): void {
        const { containerEl } = this;
        const scroller = this.scrollContainer();
        const scrollTop = scroller?.scrollTop ?? 0;
        // 分页内容自身也是滚动容器，改配置触发的重绘要沿用它的位置。
        const contentTop = this.contentEl?.scrollTop ?? 0;
        const restore = () => {
            if (scroller && scrollTop > 0) {
                scroller.scrollTop = scrollTop;
                requestAnimationFrame(() => { if (scroller.isConnected) scroller.scrollTop = scrollTop; });
            }
            if (contentTop > 0) {
                this.contentEl.scrollTop = contentTop;
                const content = this.contentEl;
                requestAnimationFrame(() => { if (content.isConnected) content.scrollTop = contentTop; });
            }
        };
        containerEl.empty();
        containerEl.addClass('manager-setting__container');
        const tabsEl = this.containerEl.createEl('div');
        tabsEl.addClass('manager-setting__tabs');
        tabsEl.setAttribute('role', 'tablist');
        tabsEl.setAttribute('data-slot', 'tabs-list');
        this.contentEl = this.containerEl.createEl('div');
        this.contentEl.addClass('manager-setting__content');

        const tabItems = [
            { text: this.manager.translator.t('设置_基础设置_前缀'), content: () => this.basisDisplay() },
            { text: this.manager.translator.t('设置_主页面功能_前缀'), content: () => this.mainPageDisplay() },
            { text: this.manager.translator.t('设置_样式设置_前缀'), content: () => this.styleDisplay() },
            { text: this.manager.translator.t('设置_分组设置_前缀'), content: () => this.groupDisplay() },
            { text: this.manager.translator.t('设置_标签设置_前缀'), content: () => this.tagDisplay() },

        ];
        if (this.manager.settings.DELAY) tabItems.push({ text: this.manager.translator.t('设置_延迟设置_前缀'), content: () => this.delayDisplay() });

        const tabItemsEls: HTMLButtonElement[] = [];

        tabItems.forEach((item, index) => {
            const itemEl = tabsEl.createEl('button');
            itemEl.type = 'button';
            itemEl.addClass('manager-setting__tabs-item');
            itemEl.setAttribute('role', 'tab');
            itemEl.setAttribute('tabindex', '0');
            itemEl.setAttribute('data-slot', 'tabs-trigger');
            itemEl.textContent = item.text;
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
        restore();
    }
    basisDisplay() { this.contentEl.empty(); new ManagerBasis(this).render(); }
    mainPageDisplay() { this.contentEl.empty(); new ManagerMainPage(this).render(); }
    styleDisplay() { this.contentEl.empty(); new ManagerStyle(this).render(); }
    delayDisplay() { this.contentEl.empty(); new ManagerDelay(this).render(); }
    groupDisplay() { this.contentEl.empty(); new ManagerGroup(this).render(); }
    tagDisplay() { this.contentEl.empty(); new ManagerTag(this).render(); }
}

export { ManagerSettingTab };

