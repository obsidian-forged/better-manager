import { setIcon } from 'obsidian';
import { createBpmFilterSelectField } from './filter-field';

export interface ScopeOption { value: string; label: string; group?: string; }

/** 工具栏共用的单选菜单；Shared toolbar single-select with bounded positioning and cleanup. */
export class ScopeSelect {
    readonly field: HTMLElement;
    readonly control: HTMLElement;
    readonly trigger: HTMLButtonElement;
    private readonly root: HTMLElement;
    private readonly menu: HTMLElement;
    private readonly doc: Document;
    private readonly win: Window;
    private open = false;
    private value: string;
    private readonly summary: HTMLElement;
    private readonly choices = new Map<string, HTMLButtonElement>();
    private readonly outside = (event: Event) => {
        if (event.target instanceof Node && this.root.contains(event.target)) return;
        this.close();
    };
    private readonly scroll = (event: Event) => {
        if (event.target instanceof Node && this.menu.contains(event.target)) return;
        this.close();
    };
    private readonly resize = () => this.close();

    /** 行内选择器复用相同菜单，省略字段标签；Reuse the same menu without a toolbar field label. */
    static compact(parent: HTMLElement, label: string, value: string, options: ScopeOption[], onChange: (value: string) => void): ScopeSelect {
        return new ScopeSelect(parent, label, '', value, options, onChange, false, undefined, 'compact');
    }

    constructor(parent: HTMLElement, label: string, icon: string, value: string, options: ScopeOption[],
        onChange: (value: string) => void, disabled = false, badge?: string, presentation: 'field' | 'compact' = 'field') {
        const compact = presentation === 'compact';
        const group = compact ? parent.createDiv('manager-scope-select--compact') : createBpmFilterSelectField(parent, label, icon);
        const control = compact ? group : group.parentElement;
        const field = compact ? group : control?.parentElement;
        if (!control || !field) throw new Error('Scope select field is not attached');
        this.control = control;
        this.field = field;
        this.value = value;
        this.doc = parent.ownerDocument;
        this.win = this.doc.defaultView ?? window;
        this.root = group.createDiv('manager-multiselect-filter');
        this.trigger = this.root.createEl('button', { cls: 'manager-multiselect-filter__trigger', attr: {
            type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
            'aria-label': `${label}: ${options.find(option => option.value === value)?.label ?? ''}`,
        } });
        this.trigger.disabled = disabled;
        this.summary = this.trigger.createSpan({ cls: 'manager-multiselect-filter__summary', text: options.find(option => option.value === value)?.label ?? '' });
        if (badge) this.trigger.createSpan({ cls: 'manager-multiselect-filter__count', text: badge });
        setIcon(this.trigger.createSpan('manager-multiselect-filter__chevron'), 'chevron-down');
        this.menu = this.root.createDiv('manager-multiselect-filter__menu');
        this.menu.setAttribute('role', 'listbox');
        this.menu.setAttribute('aria-label', label);
        let groupName: string | undefined;
        let pointerStart: { x: number; y: number } | undefined;
        let moved = false;
        this.menu.addEventListener('pointerdown', event => { pointerStart = { x: event.clientX, y: event.clientY }; moved = false; });
        this.menu.addEventListener('pointermove', event => {
            if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 8) moved = true;
        });
        this.menu.addEventListener('pointercancel', () => { moved = true; });
        for (const option of options) {
            if (option.group && option.group !== groupName) {
                this.menu.createDiv({ cls: 'manager-device-scope__group', text: option.group });
                groupName = option.group;
            }
            const selected = option.value === value;
            const button = this.menu.createEl('button', { cls: 'manager-multiselect-filter__option', attr: {
                type: 'button', role: 'option', 'aria-selected': `${selected}`,
            } });
            button.toggleClass('is-selected', selected);
            setIcon(button.createSpan('manager-multiselect-filter__check'), selected ? 'check' : 'circle');
            button.createSpan({ cls: 'manager-multiselect-filter__option-label', text: option.label });
            this.choices.set(option.value, button);
            button.addEventListener('click', () => {
                if (moved) return;
                this.close();
                this.trigger.focus();
                if (this.value !== option.value) {
                    this.setValue(option.value);
                    onChange(option.value);
                }
            });
        }
        this.trigger.addEventListener('click', () => { if (this.open) this.close(); else this.show(); });
        this.root.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); this.close(); this.trigger.focus(); }
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            if (!this.open) this.show();
            const buttons = Array.from(this.menu.querySelectorAll('button'));
            const index = buttons.indexOf(this.doc.activeElement as HTMLButtonElement);
            buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1) + buttons.length) % buttons.length]?.focus();
        });
    }
    /** 更新摘要与选中态，避免选中值被构造闭包固定；Keep reusable menus in sync after selection. */
    setValue(value: string): void {
        const choice = this.choices.get(value);
        if (!choice) return;
        this.value = value;
        const label = choice.querySelector('.manager-multiselect-filter__option-label')?.textContent ?? '';
        this.summary.setText(label);
        this.trigger.setAttribute('aria-label', `${this.menu.getAttribute('aria-label') ?? ''}: ${label}`);
        for (const [key, button] of this.choices) {
            const selected = key === value;
            button.toggleClass('is-selected', selected);
            button.setAttribute('aria-selected', `${selected}`);
            const check = button.querySelector<HTMLElement>('.manager-multiselect-filter__check');
            if (check) setIcon(check, selected ? 'check' : 'circle');
        }
    }
    private show(): void {
        const rect = this.trigger.getBoundingClientRect();
        const width = Math.min(Math.max(260, rect.width), this.win.innerWidth - 16);
        const up = this.win.innerHeight - rect.bottom < 220 && rect.top > 220;
        this.menu.setCssStyles({ top: up ? 'auto' : `${rect.bottom + 4}px`, bottom: up ? `${this.win.innerHeight - rect.top + 4}px` : 'auto',
            left: `${Math.max(8, Math.min(rect.left, this.win.innerWidth - width - 8))}px`, width: `${width}px`, minWidth: '0' });
        this.open = true;
        this.root.addClass('is-open');
        this.menu.addClass('is-fixed');
        this.field.addClass('is-filter-menu-open');
        this.root.closest('.manager-section--filters')?.addClass('is-filter-menu-open');
        this.root.closest('.manager-container')?.addClass('has-open-filter-menu');
        this.trigger.setAttribute('aria-expanded', 'true');
        this.doc.addEventListener('click', this.outside);
        this.doc.addEventListener('scroll', this.scroll, true);
        this.win.addEventListener('resize', this.resize);
    }
    close(): void {
        this.open = false;
        this.root.removeClass('is-open');
        this.menu.removeClass('is-fixed');
        this.field.removeClass('is-filter-menu-open');
        this.root.closest('.manager-section--filters')?.removeClass('is-filter-menu-open');
        this.root.closest('.manager-container')?.removeClass('has-open-filter-menu');
        this.trigger.setAttribute('aria-expanded', 'false');
        this.doc.removeEventListener('click', this.outside);
        this.doc.removeEventListener('scroll', this.scroll, true);
        this.win.removeEventListener('resize', this.resize);
    }
}
