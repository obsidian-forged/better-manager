const STRIPS = [
    '.manager-setting__tabs', '.manager-toolbar__tabs', '.manager-toolbar__tools',
    '.manager-repo-page__switcher', '.manager-install__segmented',
    '.manager-transfer-strategy__controls', '.ribbon-manager-filter-group',
    '.manager-page-tools', '.manager-food',
].join(',');

interface ScrollStrip {
    track: HTMLElement;
    update(): void;
    dispose(): void;
}

/** 共用浮动滑块，不改变顶栏的 flex 层级；Overlay thumbs preserve each strip's flex structure. */
export class FloatingScrollbars {
    private readonly view = this.root.ownerDocument.defaultView ?? window;
    private readonly strips = new Map<HTMLElement, ScrollStrip>();
    private readonly mutations: MutationObserver;
    private readonly resize: ResizeObserver;
    private readonly observed = new Set<Element>();
    private frame: number | null = null;
    private closed = false;

    constructor(private readonly root: HTMLElement) {
        this.resize = new this.view.ResizeObserver(() => this.schedule());
        // 重绘后在首帧前恢复滑块，后台窗口也不依赖动画帧；Restore strips before paint, even in background windows.
        this.mutations = new this.view.MutationObserver(() => this.refresh());
        this.mutations.observe(root, { childList: true, subtree: true, characterData: true });
        this.refresh();
    }

    private schedule(): void {
        if (this.closed || this.frame !== null) return;
        this.frame = this.view.requestAnimationFrame(() => { this.frame = null; this.refresh(); });
    }

    private refresh(): void {
        if (this.closed) return;
        for (const [viewport, strip] of this.strips) {
            // 原有视图可能 empty() 后复用同一条带；Reattach when a view clears and reuses its viewport.
            if (!this.root.contains(viewport) || strip.track.parentElement !== viewport) {
                strip.dispose();
                this.strips.delete(viewport);
            }
        }
        const desired = new Set<Element>();
        this.root.querySelectorAll<HTMLElement>(STRIPS).forEach(viewport => {
            if (!this.strips.has(viewport)) this.strips.set(viewport, this.attach(viewport));
            // 标签显隐或翻译引起的宽度变化也要更新；Observe content widths as well as the viewport.
            desired.add(viewport);
            Array.from(viewport.children).forEach(child => {
                if (child instanceof this.view.HTMLElement && !child.hasClass('bpm-scroll-strip__track')) desired.add(child);
            });
        });
        this.observed.forEach(element => {
            if (!desired.has(element)) { this.resize.unobserve(element); this.observed.delete(element); }
        });
        desired.forEach(element => {
            if (!this.observed.has(element)) { this.resize.observe(element); this.observed.add(element); }
        });
        this.strips.forEach(strip => strip.update());
    }

    private attach(viewport: HTMLElement): ScrollStrip {
        viewport.addClass('bpm-scroll-strip');
        const track = viewport.createDiv({ cls: 'bpm-scroll-strip__track', attr: { 'aria-hidden': 'true' } });
        const thumb = track.createDiv('bpm-scroll-strip__thumb');
        let hideTimer: number | undefined;
        let drag: { pointerId: number; x: number; scroll: number; scale: number } | undefined;
        let gesture: { pointerId: number; x: number; y: number; scroll: number; axis?: 'x' | 'y' } | undefined;
        let suppressClick = false;
        const update = () => {
            const range = viewport.scrollWidth - viewport.clientWidth;
            const scrollable = /^(auto|scroll)$/.test(this.view.getComputedStyle(viewport).overflowX) && range > 1;
            track.hidden = !scrollable;
            viewport.toggleClass('is-strip-scrollable', scrollable);
            if (!scrollable) return;
            const width = Math.max(0, viewport.clientWidth - 4);
            const thumbWidth = Math.min(width, Math.max(18, width * viewport.clientWidth / viewport.scrollWidth));
            // 轨道位于滚动内容中，抵消 scrollLeft 后固定在可视区；Cancel content scrolling for the overlay.
            track.setCssStyles({ width: `${width}px`, transform: `translateX(${viewport.scrollLeft}px)` });
            thumb.setCssStyles({ width: `${thumbWidth}px`, transform: `translateX(${Math.min(1, Math.max(0, viewport.scrollLeft / range)) * (width - thumbWidth)}px)` });
        };
        const onScroll = () => {
            update();
            viewport.addClass('is-strip-scrolling');
            if (hideTimer !== undefined) this.view.clearTimeout(hideTimer);
            hideTimer = this.view.setTimeout(() => { viewport.removeClass('is-strip-scrolling'); hideTimer = undefined; }, 900);
        };
        const endDrag = () => {
            const pointerId = drag?.pointerId;
            drag = undefined;
            thumb.removeClass('is-dragging');
            if (pointerId !== undefined && thumb.hasPointerCapture(pointerId)) thumb.releasePointerCapture(pointerId);
        };
        const startDrag = (event: PointerEvent) => {
            if (!event.isPrimary || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const travel = track.clientWidth - thumb.getBoundingClientRect().width;
            if (travel <= 0) return;
            drag = { pointerId: event.pointerId, x: event.clientX, scroll: viewport.scrollLeft, scale: (viewport.scrollWidth - viewport.clientWidth) / travel };
            thumb.addClass('is-dragging');
            thumb.setPointerCapture(event.pointerId);
        };
        const moveDrag = (event: PointerEvent) => {
            if (drag?.pointerId !== event.pointerId) return;
            viewport.scrollLeft = drag.scroll + (event.clientX - drag.x) * drag.scale;
        };
        const startGesture = (event: PointerEvent) => {
            if (!event.isPrimary) { cancelGesture(); return; }
            suppressClick = false;
            gesture = event.pointerType === 'mouse' || track.contains(event.target instanceof this.view.Node ? event.target : null)
                ? undefined : { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scroll: viewport.scrollLeft };
        };
        const moveGesture = (event: PointerEvent) => {
            if (!gesture || gesture.pointerId !== event.pointerId) return;
            const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
            if (Math.hypot(dx, dy) <= 8) return;
            suppressClick = true;
            gesture.axis ??= Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            // Keep vertical page scrolling native; horizontal strips own only horizontal drags.
            if (gesture.axis !== 'x' || viewport.scrollWidth <= viewport.clientWidth + 1 || !/^(auto|scroll)$/.test(this.view.getComputedStyle(viewport).overflowX)) return;
            event.preventDefault();
            if (!viewport.hasPointerCapture(event.pointerId)) viewport.setPointerCapture(event.pointerId);
            viewport.scrollLeft = gesture.scroll - dx;
            onScroll();
        };
        const endGesture = () => {
            if (gesture && Math.abs(viewport.scrollLeft - gesture.scroll) > 2) suppressClick = true;
            if (gesture && viewport.hasPointerCapture(gesture.pointerId)) viewport.releasePointerCapture(gesture.pointerId);
            gesture = undefined;
        };
        const cancelGesture = () => { if (gesture) suppressClick = true; endGesture(); };
        const onClick = (event: MouseEvent) => {
            // 保留键盘激活，阻止滑动/拖动后的误触；Keep keyboard activation, suppress post-swipe clicks.
            if (track.contains(event.target instanceof this.view.Node ? event.target : null) || (suppressClick && event.detail !== 0)) {
                event.preventDefault(); event.stopPropagation();
            }
        };
        viewport.addEventListener('scroll', onScroll, { passive: true });
        viewport.addEventListener('pointerdown', startGesture, { passive: true, capture: true });
        viewport.addEventListener('pointermove', moveGesture, { passive: false, capture: true });
        viewport.addEventListener('pointerup', endGesture, { passive: true, capture: true });
        viewport.addEventListener('pointercancel', cancelGesture, { passive: true, capture: true });
        viewport.addEventListener('lostpointercapture', endGesture);
        viewport.addEventListener('click', onClick, true);
        thumb.addEventListener('pointerdown', startDrag);
        thumb.addEventListener('pointermove', moveDrag);
        thumb.addEventListener('pointerup', endDrag);
        thumb.addEventListener('pointercancel', endDrag);
        thumb.addEventListener('lostpointercapture', endDrag);
        return { track, update, dispose: () => {
            endDrag();
            endGesture();
            if (hideTimer !== undefined) this.view.clearTimeout(hideTimer);
            viewport.removeEventListener('scroll', onScroll);
            viewport.removeEventListener('pointerdown', startGesture, true);
            viewport.removeEventListener('pointermove', moveGesture, true);
            viewport.removeEventListener('pointerup', endGesture, true);
            viewport.removeEventListener('pointercancel', cancelGesture, true);
            viewport.removeEventListener('lostpointercapture', endGesture);
            viewport.removeEventListener('click', onClick, true);
            thumb.removeEventListener('pointerdown', startDrag);
            thumb.removeEventListener('pointermove', moveDrag);
            thumb.removeEventListener('pointerup', endDrag);
            thumb.removeEventListener('pointercancel', endDrag);
            thumb.removeEventListener('lostpointercapture', endDrag);
            viewport.removeClass('bpm-scroll-strip', 'is-strip-scrolling', 'is-strip-scrollable');
            track.remove();
        } };
    }

    /** 关闭/隐藏时解除全部观察与事件；Release observers and handlers when the view closes. */
    destroy(): void {
        this.closed = true;
        this.mutations.disconnect();
        this.resize.disconnect();
        this.observed.clear();
        if (this.frame !== null) this.view.cancelAnimationFrame(this.frame);
        this.strips.forEach(strip => strip.dispose());
        this.strips.clear();
    }
}
