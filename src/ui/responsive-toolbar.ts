/** 按完整布局的实际宽度折叠工具栏；Collapse only when the full layout no longer fits. */
export class ResponsiveToolbar {
    private readonly resize: ResizeObserver;
    private readonly mutations: MutationObserver;
    private destroyed = false;

    constructor(private readonly root: HTMLElement, private readonly expandedGroups: () => HTMLElement[]) {
        root.addClass('bpm-responsive-toolbar');
        this.resize = new ResizeObserver(() => this.update());
        this.resize.observe(root);
        this.mutations = new MutationObserver(records => {
            if (records.some(record => record.target !== root)) this.update();
        });
        this.mutations.observe(root, { subtree: true, childList: true, characterData: true,
            attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
        this.update();
    }

    private update(): void {
        if (this.destroyed || !this.root.isConnected || this.root.clientWidth === 0) return;
        this.root.addClass('is-measuring');
        const win = this.root.ownerDocument.defaultView;
        if (!win) { this.root.removeClass('is-measuring'); return; }
        const css = win.getComputedStyle(this.root);
        const groups = this.expandedGroups().filter(group => win.getComputedStyle(group).display !== 'none');
        const gap = Number.parseFloat(css.columnGap) || 0;
        const required = groups.reduce((width, group) => width + group.getBoundingClientRect().width, 0)
            + Math.max(0, groups.length - 1) * gap;
        const available = this.root.clientWidth - (Number.parseFloat(css.paddingLeft) || 0) - (Number.parseFloat(css.paddingRight) || 0);
        this.root.removeClass('is-measuring');
        this.root.toggleClass('is-compact', required > available + 1);
    }

    destroy(): void {
        this.destroyed = true;
        this.resize.disconnect();
        this.mutations.disconnect();
        this.root.removeClass('bpm-responsive-toolbar', 'is-compact', 'is-measuring');
    }
}
