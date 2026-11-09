import { displayTooltip, requireApiVersion, setIcon, setTooltip } from 'obsidian';

export interface RichTooltipContent {
    title: string;
    description?: string;
    icon?: string;
}

/** Native tooltip placement, with a compact icon/title and wrapping explanation. */
export class RichTooltips {
    private readonly content = new WeakMap<HTMLElement, RichTooltipContent>();
    private timer?: number;
    private bubble?: HTMLElement;
    private target?: HTMLElement;
    private readonly view: Window | null;

    constructor(private readonly root: HTMLElement) {
        this.view = root.ownerDocument.defaultView;
        root.addEventListener('mouseover', this.enter);
        root.addEventListener('focusin', this.enter);
        root.addEventListener('mouseout', this.leave);
        root.addEventListener('focusout', this.leave);
        root.addEventListener('pointerdown', this.clear);
        root.addEventListener('keydown', this.keydown);
        root.addEventListener('touchmove', this.clear, { passive: true });
        root.addEventListener('scroll', this.clear, true);
    }

    bind(element: HTMLElement, content: RichTooltipContent): void {
        this.content.set(element, content);
        element.setAttribute('data-bpm-tooltip', '');
        // Versions before 1.8.7 retain the complete, accessible text tooltip.
        setTooltip(element, [content.title, content.description].filter(Boolean).join('\n'));
    }

    private find(event: Event): HTMLElement | undefined {
        const target = event.target as Node | null;
        if (!target?.instanceOf?.(this.root.ownerDocument.defaultView?.HTMLElement ?? HTMLElement)) return;
        const element = target.closest<HTMLElement>('[data-bpm-tooltip]');
        return element && this.root.contains(element) ? element : undefined;
    }

    private enter = (event: Event): void => {
        const element = this.find(event);
        if (!element || !this.view || !requireApiVersion('1.8.7')) return;
        // Replace the native plain-text hover for these controls only.
        event.stopPropagation();
        if (element === this.target) return;
        this.clear();
        this.target = element;
        this.timer = this.view.setTimeout(() => {
            this.timer = undefined;
            const content = this.content.get(element);
            if (!content || !element.isConnected) { this.clear(); return; }
            const fragment = element.ownerDocument.adoptNode(createFragment());
            const header = fragment.createDiv('bpm-rich-tooltip__heading');
            const svg = element.querySelector('svg');
            const icon = content.icon ?? Array.from(svg?.classList ?? [])
                .find(name => name.startsWith('lucide-'))?.slice(7);
            if (icon) setIcon(header.createSpan('bpm-rich-tooltip__icon'), icon);
            header.createSpan({ text: content.title });
            if (content.description) fragment.createDiv({ cls: 'bpm-rich-tooltip__description', text: content.description });
            if (requireApiVersion('1.8.7')) displayTooltip(element, fragment, { classes: ['bpm-rich-tooltip'] });
            this.bubble = element.ownerDocument.querySelector<HTMLElement>('.tooltip.bpm-rich-tooltip') ?? undefined;
        }, 350);
    };

    private leave = (event: MouseEvent | FocusEvent): void => {
        const related = event.relatedTarget as Node | null;
        if (related?.instanceOf?.(this.root.ownerDocument.defaultView?.Node ?? Node) && this.target?.contains(related)) return;
        this.clear();
    };

    private clear = (): void => {
        if (this.timer !== undefined) this.view?.clearTimeout(this.timer);
        this.timer = undefined;
        this.target = undefined;
        this.bubble?.remove();
        this.bubble = undefined;
    };

    private keydown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') this.clear();
    };

    destroy(): void {
        this.clear();
        this.root.removeEventListener('mouseover', this.enter);
        this.root.removeEventListener('focusin', this.enter);
        this.root.removeEventListener('mouseout', this.leave);
        this.root.removeEventListener('focusout', this.leave);
        this.root.removeEventListener('pointerdown', this.clear);
        this.root.removeEventListener('keydown', this.keydown);
        this.root.removeEventListener('touchmove', this.clear);
        this.root.removeEventListener('scroll', this.clear, true);
    }
}
