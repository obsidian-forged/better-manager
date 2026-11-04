import { ButtonComponent, TextComponent } from 'obsidian';
import type { ManagerSettingTab } from './index';
import { rankSettings, SearchableSetting } from './search';

export interface SettingsSearchPage {
    label: string;
    icon?: string;
    render(container: HTMLElement): void;
}
export interface SettingsSearchItem extends SearchableSetting { page: number; ordinal: number; }

/** 索引原生设置的名称与说明，结果跳回原控件，避免复制控件状态；Navigate to the original controls. */
export class SettingsSearch {
    private readonly items: SettingsSearchItem[] = [];
    private results?: HTMLElement;
    private matches: SettingsSearchItem[] = [];
    private topbar?: HTMLElement;
    private layer?: HTMLElement;
    private doc?: Document;
    private win?: Window | null;
    private destroyed = false;

    constructor(private readonly tab: ManagerSettingTab, private readonly pages: SettingsSearchPage[],
        private readonly exit: (page?: number, ordinal?: number) => void) {}

    static rows(container: HTMLElement): HTMLElement[] {
        return Array.from(container.querySelectorAll<HTMLElement>('.setting-item:not(.setting-item-heading), .manager-personalize'));
    }

    /** 自有搜索与原生声明式搜索使用同一份设置名和说明；Share real control metadata with native settings search. */
    static index(pages: SettingsSearchPage[], doc: Document, personalizeLabel: string): SettingsSearchItem[] {
        const items: SettingsSearchItem[] = [];
        pages.forEach((page, pageIndex) => {
            const scratch = (doc.defaultView ?? window).createDiv();
            page.render(scratch);
            SettingsSearch.rows(scratch).forEach((row, ordinal) => {
                const personalize = row.hasClass('manager-personalize');
                const name = personalize ? personalizeLabel : row.querySelector('.setting-item-name')?.textContent?.trim() ?? '';
                const description = personalize
                    ? Array.from(row.querySelectorAll('button')).map(button => button.textContent?.trim() || button.getAttribute('aria-label') || '').join(' ')
                    : row.querySelector('.setting-item-description')?.textContent?.trim() ?? '';
                if (name || description) items.push({ name, description, page: pageIndex, ordinal });
            });
        });
        return items;
    }

    open(topbar: HTMLElement): void {
        const t = (key: string) => this.tab.manager.translator.t(key);
        this.items.length = 0;
        this.items.push(...SettingsSearch.index(this.pages, topbar.ownerDocument, t('功能开关_个性化')));
        this.doc = topbar.ownerDocument;
        this.win = this.doc.defaultView;
        this.topbar = topbar;
        // 保留顶栏 DOM，只让原有控件淡出；搜索层覆盖其上，下面的内容保持可见。
        topbar.addClass('manager-setting__topbar--search');
        this.layer = topbar.createDiv('manager-setting-search__layer');
        const field = this.layer.createDiv('manager-setting-search__field');
        const input = new TextComponent(field);
        input.inputEl.type = 'search';
        input.inputEl.addClass('manager-setting-search__input');
        input.setPlaceholder(t('设置_搜索_占位'));
        input.inputEl.setAttribute('aria-label', t('设置_搜索_占位'));
        const close = new ButtonComponent(this.layer)
            .setIcon('x')
            .setTooltip(t('设置_搜索_关闭'))
            .onClick(() => this.exit());
        close.buttonEl.addClass('manager-setting-search__close');
        this.results = this.doc.body.createDiv('manager-setting-search__results manager-setting-search__results--floating');
        input.onChange(query => this.render(query));
        input.inputEl.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.exit(); }
            if (event.key === 'Enter' && !event.isComposing && this.matches[0]) {
                event.preventDefault();
                this.exit(this.matches[0].page, this.matches[0].ordinal);
            }
        });
        this.doc.addEventListener('pointerdown', this.onDocumentPointerDown, true);
        this.doc.addEventListener('scroll', this.onDocumentScroll, true);
        this.win?.addEventListener('resize', this.onResize);
        // 强制一次布局后直接展开；隐藏窗口里 rAF 可能停摆，不能依赖它启动过渡。
        this.layer.getBoundingClientRect();
        this.layer.addClass('is-open');
        this.positionResults();
        this.render('');
        input.inputEl.focus();
    }

    /** 顶部淡出、搜索框展开期间保持内容可读 / Content stays mounted while the header fades. */
    private positionResults(): void {
        if (!this.topbar || !this.results) return;
        const rect = this.topbar.getBoundingClientRect();
        const viewportWidth = this.win?.innerWidth ?? this.doc?.documentElement.clientWidth ?? rect.width;
        const viewportHeight = this.win?.innerHeight ?? this.doc?.documentElement.clientHeight ?? 0;
        const margin = 8;
        const width = Math.min(Math.max(rect.width, 240), 560);
        const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
        const maxHeight = Math.max(160, viewportHeight - rect.bottom - 24);
        this.results.setCssStyles({
            left: `${Math.round(left)}px`,
            top: `${Math.round(rect.bottom + 6)}px`,
            width: `${Math.round(width)}px`,
            maxHeight: `${Math.round(maxHeight)}px`,
        });
    }

    private readonly onDocumentPointerDown = (event: PointerEvent): void => {
        const target = event.target as Node | null;
        if (target && (this.topbar?.contains(target) || this.results?.contains(target))) return;
        this.exit();
    };

    private readonly onDocumentScroll = (event: Event): void => {
        const target = event.target as Node | null;
        if (target && this.results?.contains(target)) return;
        this.positionResults();
    };

    private readonly onResize = (): void => this.positionResults();

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.topbar?.removeClass('manager-setting__topbar--search');
        this.layer?.remove();
        this.results?.remove();
        this.layer = undefined;
        this.results = undefined;
        this.doc?.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
        this.doc?.removeEventListener('scroll', this.onDocumentScroll, true);
        this.win?.removeEventListener('resize', this.onResize);
        this.doc = undefined;
        this.win = null;
        this.topbar = undefined;
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
