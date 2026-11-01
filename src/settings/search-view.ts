import { ButtonComponent, TextComponent } from 'obsidian';
import type { ManagerSettingTab } from './index';
import { rankSettings, SearchableSetting } from './search';

export interface SettingsSearchPage {
    label: string;
    render(container: HTMLElement): void;
}
interface SettingsSearchItem extends SearchableSetting { page: number; ordinal: number; }

/** 索引原生设置的名称与说明，结果跳回原控件，避免复制控件状态；Navigate to the original controls. */
export class SettingsSearch {
    private readonly items: SettingsSearchItem[] = [];
    private results?: HTMLElement;
    private matches: SettingsSearchItem[] = [];

    constructor(private readonly tab: ManagerSettingTab, private readonly pages: SettingsSearchPage[],
        private readonly exit: (page?: number, ordinal?: number) => void) {}

    static rows(container: HTMLElement): HTMLElement[] {
        return Array.from(container.querySelectorAll<HTMLElement>('.setting-item:not(.setting-item-heading), .manager-personalize'));
    }

    open(topbar: HTMLElement): void {
        const t = (key: string) => this.tab.manager.translator.t(key);
        this.pages.forEach((page, pageIndex) => {
            const scratch = topbar.ownerDocument.createElement('div');
            page.render(scratch);
            SettingsSearch.rows(scratch).forEach((row, ordinal) => {
                const personalize = row.hasClass('manager-personalize');
                const name = personalize ? t('功能开关_个性化') : row.querySelector('.setting-item-name')?.textContent?.trim() ?? '';
                const description = personalize
                    ? Array.from(row.querySelectorAll('button')).map(button => button.textContent?.trim() || button.getAttribute('aria-label') || '').join(' ')
                    : row.querySelector('.setting-item-description')?.textContent?.trim() ?? '';
                if (name || description) this.items.push({ name, description, page: pageIndex, ordinal });
            });
        });
        topbar.empty();
        topbar.addClass('manager-setting__topbar--search');
        const input = new TextComponent(topbar);
        input.inputEl.type = 'search';
        input.inputEl.addClass('manager-setting-search__input');
        input.setPlaceholder(t('设置_搜索_占位'));
        input.inputEl.setAttribute('aria-label', t('设置_搜索_占位'));
        new ButtonComponent(topbar).setIcon('x').setTooltip(t('设置_搜索_关闭')).onClick(() => this.exit());
        this.tab.contentEl.empty();
        this.results = this.tab.contentEl.createDiv('manager-setting-search__results');
        input.onChange(query => this.render(query));
        input.inputEl.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.exit(); }
            if (event.key === 'Enter' && !event.isComposing && this.matches[0]) {
                event.preventDefault();
                this.exit(this.matches[0].page, this.matches[0].ordinal);
            }
        });
        this.render('');
        input.inputEl.focus();
    }

    private render(query: string): void {
        if (!this.results) return;
        const t = (key: string) => this.tab.manager.translator.t(key);
        this.results.empty();
        this.matches = rankSettings(this.items, query);
        this.results.createDiv({ cls: 'manager-setting-search__status',
            text: !query.trim() ? t('设置_搜索_占位') : this.matches.length ? `${t('设置_搜索_结果')}: ${this.matches.length}` : t('设置_搜索_无结果'),
            attr: { role: 'status', 'aria-live': 'polite' } });
        this.matches.forEach(item => {
            const button = this.results?.createEl('button', { cls: 'manager-setting-search__result', attr: { type: 'button' } });
            if (!button) return;
            button.createSpan({ cls: 'manager-setting-search__page', text: this.pages[item.page].label });
            button.createSpan({ cls: 'manager-setting-search__name', text: item.name });
            if (item.description) button.createSpan({ cls: 'manager-setting-search__description', text: item.description });
            button.addEventListener('click', () => this.exit(item.page, item.ordinal));
        });
    }
}
