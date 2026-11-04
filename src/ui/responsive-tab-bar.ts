import { Platform } from 'obsidian';
import { ScopeOption, ScopeSelect } from './scope-select';

/** 分页只切换呈现方式，不重建页面内容；Keep navigation and its page state independent of layout. */
export class ResponsiveTabBar {
    private readonly select: ScopeSelect;
    private readonly resize: ResizeObserver;
    private readonly mutations: MutationObserver;
    private destroyed = false;
    get trigger(): HTMLButtonElement { return this.select.trigger; }

    constructor(private readonly host: HTMLElement, private readonly rail: HTMLElement, label: string,
        value: string, options: ScopeOption[], onChange: (value: string) => void,
        private readonly availableWidth: () => number = () => host.clientWidth, measuredPeers: HTMLElement[] = []) {
        host.addClass('bpm-responsive-tabs');
        rail.addClass('bpm-responsive-tabs__rail');
        this.select = ScopeSelect.compact(host, label, value, options, onChange);
        this.select.field.addClass('bpm-responsive-tabs__select');
        const view = host.ownerDocument.defaultView ?? window;
        this.resize = new view.ResizeObserver(() => this.update());
        this.resize.observe(host);
        for (const peer of measuredPeers) this.resize.observe(peer);
        this.mutations = new view.MutationObserver(() => this.update());
        this.mutations.observe(rail, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
        this.update();
    }

    setValue(value: string): void {
        this.select.setValue(value);
        this.update();
    }

    setOptionLabel(value: string, label: string): void { this.select.setOptionLabel(value, label); }

    private update(): void {
        if (this.destroyed || !this.host.isConnected || this.host.clientWidth === 0) return;
        const available = this.availableWidth();
        this.host.addClass('is-tabs-measuring');
        const required = this.rail.getBoundingClientRect().width;
        this.host.removeClass('is-tabs-measuring');
        const compact = Platform.isMobile || required > available + 1;
        if (!compact) this.select.close();
        this.host.toggleClass('is-tabs-compact', compact);
        this.rail.setAttribute('aria-hidden', `${compact}`);
    }

    destroy(): void {
        this.destroyed = true;
        this.resize.disconnect();
        this.mutations.disconnect();
        this.select.close();
        this.select.field.remove();
        this.rail.removeClass('bpm-responsive-tabs__rail');
        this.rail.removeAttribute('aria-hidden');
        this.host.removeClass('bpm-responsive-tabs', 'is-tabs-compact', 'is-tabs-measuring');
    }
}
