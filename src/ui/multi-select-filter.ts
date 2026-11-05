import { setIcon } from 'obsidian';

export interface MultiSelectFilterOption {
    value: string;
    label: string;
    icon?: string;
    count?: number;
}

export interface MultiSelectFilterOptions {
    options: MultiSelectFilterOption[];
    values: string[];
    allValue: string;
    allLabel: string;
    label: string;
    onChange: (values: string[]) => void;
    icon?: string;
    collapseAllSelected?: boolean;
    fixed?: boolean;
}

/** 共用多选筛选菜单；Shared multi-select with owner-window positioning and touch-safe selection. */
export class MultiSelectFilter {
    readonly rootEl: HTMLElement;
    readonly buttonEl: HTMLButtonElement;
    readonly menuEl: HTMLElement;
    private readonly doc: Document;
    private readonly view: Window;
    private readonly summary: HTMLElement;
    private readonly count: HTMLElement;
    private readonly icon?: HTMLElement;
    private readonly field: HTMLElement | null;
    private readonly section: HTMLElement | null;
    private readonly mobilePanel: HTMLElement | null;
    private readonly container: HTMLElement | null;
    private options: MultiSelectFilterOption[];
    private values: string[];
    private open = false;
    private readonly choices = new Map<string, { button: HTMLButtonElement; check: HTMLElement }>();
    private pointerStart?: { x: number; y: number };
    private moved = false;
    private readonly outside = (event: Event): void => {
        if (!this.containsEvent(this.rootEl, event)) this.close();
    };
    private readonly scroll = (event: Event): void => {
        if (!this.containsEvent(this.menuEl, event)) this.close();
    };
    private readonly resize = (): void => this.close();

    constructor(parent: HTMLElement, private readonly config: MultiSelectFilterOptions) {
        this.doc = parent.ownerDocument;
        this.view = this.doc.defaultView ?? window;
        this.options = config.options;
        this.values = this.normalize(config.values);
        this.rootEl = parent.createDiv('manager-multiselect-filter');
        this.buttonEl = this.rootEl.createEl('button', { cls: 'manager-multiselect-filter__trigger', attr: {
            type: 'button', 'aria-label': config.label, 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
        } });
        if (config.icon || config.options.some(option => option.icon)) {
            this.icon = this.buttonEl.createSpan('manager-multiselect-filter__check manager-scope-select__icon');
        }
        this.summary = this.buttonEl.createSpan('manager-multiselect-filter__summary');
        this.count = this.buttonEl.createSpan('manager-multiselect-filter__count');
        setIcon(this.buttonEl.createSpan('manager-multiselect-filter__chevron'), 'chevron-down');
        this.menuEl = this.rootEl.createDiv({ cls: 'manager-multiselect-filter__menu', attr: {
            role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': config.label,
        } });
        this.field = this.rootEl.closest<HTMLElement>('.manager-filter-field');
        this.section = this.rootEl.closest<HTMLElement>('.manager-section--filters');
        this.mobilePanel = this.rootEl.closest<HTMLElement>('.bpm-mobile-header__filters');
        this.container = this.rootEl.closest<HTMLElement>('.manager-container');
        this.rootEl.addEventListener('pointerdown', event => {
            this.pointerStart = { x: event.clientX, y: event.clientY };
            this.moved = false;
        });
        this.rootEl.addEventListener('pointermove', event => {
            if (this.pointerStart && Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 8) this.moved = true;
        });
        this.rootEl.addEventListener('pointercancel', () => { this.moved = true; });
        this.buttonEl.addEventListener('click', event => {
            event.stopPropagation();
            if (this.moved && event.detail !== 0) return;
            if (this.open) this.close();
            else this.show();
        });
        this.rootEl.addEventListener('click', event => event.stopPropagation());
        this.rootEl.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault(); this.close(); this.buttonEl.focus();
                return;
            }
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            if (!this.open) this.show();
            const buttons = Array.from(this.choices.values()).map(choice => choice.button);
            const current = buttons.findIndex(button => button === this.doc.activeElement);
            const next = current < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
                : (current + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
            buttons[next]?.focus();
        });
        this.renderOptions();
        this.updateSelection();
    }

    private containsEvent(element: HTMLElement, event: Event): boolean {
        const target = event.target as Node | null;
        return Boolean(target?.instanceOf?.(this.doc.defaultView?.Node ?? Node) && element.contains(target));
    }

    private normalize(values: string[]): string[] {
        const next = [...new Set(values.map(value => value.trim()).filter(value => value && value !== this.config.allValue))];
        const options = this.options.filter(option => option.value !== this.config.allValue);
        return this.config.collapseAllSelected && options.length > 0 && options.every(option => next.includes(option.value)) ? [] : next;
    }

    private updateSelection(): void {
        const first = this.options.find(option => option.value === (this.values[0] ?? this.config.allValue));
        const label = this.values.length ? `${first?.label ?? this.values[0]}${this.values.length > 1 ? ` +${this.values.length - 1}` : ''}` : this.config.allLabel;
        this.summary.setText(label);
        const counts = this.options.some(option => option.count !== undefined);
        const count = counts
            ? (this.values.length ? this.options.filter(option => this.values.includes(option.value)).reduce((total, option) => total + (option.count ?? 0), 0) : first?.count ?? 0)
            : this.values.length;
        this.count.setText(counts || count > 0 ? `${count}` : '');
        this.count.toggleClass('is-empty', !counts && count === 0);
        this.buttonEl.toggleClass('has-selection', this.values.length > 0);
        this.buttonEl.setAttribute('aria-label', `${this.config.label}: ${label}${counts ? ` (${count})` : ''}`);
        if (this.icon) {
            const icon = first?.icon || this.config.icon;
            this.icon.empty();
            if (icon) setIcon(this.icon, icon);
            this.icon.hidden = !icon;
        }
        for (const [value, choice] of this.choices) {
            const all = value === this.config.allValue;
            const selected = all ? this.values.length === 0 : this.values.includes(value);
            choice.button.toggleClass('is-selected', selected);
            choice.button.setAttribute('aria-selected', `${selected}`);
            setIcon(choice.check, all ? (selected ? 'check' : 'circle') : (selected ? 'square-check-big' : 'square'));
        }
    }

    private renderOptions(): void {
        this.menuEl.empty();
        this.choices.clear();
        const all = this.options.find(option => option.value === this.config.allValue)
            ?? { value: this.config.allValue, label: this.config.allLabel };
        for (const option of [all, ...this.options.filter(option => option.value !== this.config.allValue)]) {
            const button = this.menuEl.createEl('button', { cls: 'manager-multiselect-filter__option', attr: { type: 'button', role: 'option' } });
            const check = button.createSpan('manager-multiselect-filter__check');
            if (option.icon) setIcon(button.createSpan('manager-multiselect-filter__check manager-scope-select__option-icon'), option.icon);
            button.createSpan({ cls: 'manager-multiselect-filter__option-label', text: option.label });
            if (option.count !== undefined) button.createSpan({ cls: 'manager-multiselect-filter__count', text: `${option.count}` });
            this.choices.set(option.value, { button, check });
            button.addEventListener('click', event => {
                if (this.moved && event.detail !== 0) return;
                this.values = option.value === this.config.allValue ? [] : this.normalize(this.values.includes(option.value)
                    ? this.values.filter(value => value !== option.value) : [...this.values, option.value]);
                // 不重建选项，键盘焦点与滚动位置保持不变；Keep option focus and scroll stable during multi-selection.
                this.updateSelection();
                this.config.onChange([...this.values]);
            });
        }
    }

    private show(): void {
        const root = this.rootEl.getBoundingClientRect();
        const field = (this.field ?? this.rootEl).getBoundingClientRect();
        if (this.config.fixed) {
            const button = this.buttonEl.getBoundingClientRect();
            const width = Math.max(0, Math.min(Math.max(160, field.width), this.view.innerWidth - 16));
            const left = Math.max(8, Math.min(field.left, this.view.innerWidth - width - 8));
            const up = this.view.innerHeight - button.bottom < 220 && button.top > 220;
            this.menuEl.setCssStyles({ left: `${left}px`, width: `${width}px`, minWidth: '0',
                top: up ? 'auto' : `${button.bottom + 4}px`, bottom: up ? `${this.view.innerHeight - button.top + 4}px` : 'auto' });
            this.menuEl.addClass('is-fixed');
        } else {
            const container = this.container?.getBoundingClientRect();
            const width = Math.max(0, Math.min(field.width, container ? container.width - 16 : this.view.innerWidth - 16));
            const desired = container ? Math.min(field.left, container.right - 8 - width) : field.left;
            const left = Math.max(container ? container.left + 8 : 8, desired) - root.left;
            this.menuEl.setCssStyles({ left: `${left}px`, width: `${width}px`, minWidth: '0' });
        }
        this.open = true;
        this.rootEl.addClass('is-open');
        this.field?.addClass('is-filter-menu-open');
        this.section?.addClass('is-filter-menu-open');
        this.mobilePanel?.addClass('is-filter-menu-open');
        this.container?.addClass('has-open-filter-menu');
        this.buttonEl.setAttribute('aria-expanded', 'true');
        this.doc.addEventListener('click', this.outside);
        this.doc.addEventListener('scroll', this.scroll, true);
        this.view.addEventListener('resize', this.resize);
    }

    setValues(values: string[]): void {
        this.values = this.normalize(values);
        this.updateSelection();
    }

    refreshOptions(options: MultiSelectFilterOption[], values = this.values): void {
        const focused = [...this.choices].find(([, choice]) => choice.button === this.doc.activeElement)?.[0];
        this.options = options;
        const available = new Set(options.map(option => option.value));
        this.values = this.normalize(values.filter(value => available.has(value)));
        this.renderOptions();
        this.updateSelection();
        if (this.open && focused !== undefined) this.choices.get(focused)?.button.focus();
    }

    close(): void {
        this.open = false;
        this.rootEl.removeClass('is-open');
        this.menuEl.removeClass('is-fixed');
        this.menuEl.setCssStyles({ left: '', width: '', top: '', bottom: '' });
        this.field?.removeClass('is-filter-menu-open');
        this.section?.removeClass('is-filter-menu-open');
        this.mobilePanel?.removeClass('is-filter-menu-open');
        this.container?.removeClass('has-open-filter-menu');
        this.buttonEl.setAttribute('aria-expanded', 'false');
        this.doc.removeEventListener('click', this.outside);
        this.doc.removeEventListener('scroll', this.scroll, true);
        this.view.removeEventListener('resize', this.resize);
    }
}
