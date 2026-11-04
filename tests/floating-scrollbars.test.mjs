import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['src/ui/floating-scrollbars.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const loaded = { exports: {} };
new Function('module', 'exports', compiled.outputFiles[0].text)(loaded, loaded.exports);
const { FloatingScrollbars } = loaded.exports;
class Element {
    instanceOf(ctor) { return this instanceof ctor; }
    classes = new Set(); children = []; listeners = new Map(); captures = new Set(); scrollLeft = 0; clientWidth = 220; scrollWidth = 520;
    addClass(...names) { names.forEach(name => this.classes.add(name)); }
    removeClass(...names) { names.forEach(name => this.classes.delete(name)); }
    hasClass(name) { return this.classes.has(name); }
    toggleClass(name, enabled) { if (enabled) this.classes.add(name); else this.classes.delete(name); }
    contains(child) { return child === this || this.children.some(item => item.contains(child)); }
    createDiv(options) {
        const child = new Element(); child.ownerDocument = this.ownerDocument; child.parentElement = this;
        child.addClass(typeof options === 'string' ? options : options.cls); this.children.push(child); return child;
    }
    setCssStyles(values) { if (values.width) this.clientWidth = Number.parseFloat(values.width); }
    getBoundingClientRect() { return { width: this.clientWidth }; }
    addEventListener(name, callback, options) { this.listeners.set(name, { callback, options }); }
    removeEventListener(name) { this.listeners.delete(name); }
    hasPointerCapture(id) { return this.captures.has(id); }
    setPointerCapture(id) { this.captures.add(id); }
    releasePointerCapture(id) { this.captures.delete(id); }
    remove() { this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
}
function fixture({ range = true } = {}) {
    const view = { HTMLElement: Element, Node: Element, getComputedStyle: el => ({ overflowX: el.overflowX || 'auto' }),
        MutationObserver: class { observe() {} disconnect() {} }, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
        requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout, clearTimeout };
    const viewport = new Element(), root = new Element(); root.ownerDocument = viewport.ownerDocument = { defaultView: view };
    root.children.push(viewport); root.querySelectorAll = () => [viewport]; viewport.parentElement = root;
    if (!range) viewport.scrollWidth = viewport.clientWidth;
    const button = viewport.createDiv('button');
    const scrollbars = new FloatingScrollbars(root);
    const fire = (name, values = {}) => {
        const event = { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 150, clientY: 20, detail: 1, target: button,
            preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...values };
        viewport.listeners.get(name)?.callback(event); return event;
    };
    return { viewport, scrollbars, fire };
}
test('horizontal touch drags scroll managed strips and suppress the subsequent filter click', () => {
    const { viewport, scrollbars, fire } = fixture();
    try {
        fire('pointerdown'); const move = fire('pointermove', { clientX: 60, clientY: 24 });
        assert.equal(viewport.scrollLeft, 90); assert.equal(move.prevented, true); assert.equal(viewport.hasPointerCapture(1), true);
        assert.equal(viewport.listeners.get('pointerdown').options.capture, true);
        assert.equal(viewport.listeners.get('pointermove').options.passive, false);
        fire('pointerup'); assert.equal(viewport.hasPointerCapture(1), false);
        assert.equal(fire('click').prevented, true);
        assert.equal(fire('click', { detail: 0 }).prevented, undefined);
    } finally { scrollbars.destroy(); }
});
test('vertical scrolling, simple taps and non-overflowing strips keep their native behavior', () => {
    const { viewport, scrollbars, fire } = fixture();
    try {
        fire('pointerdown'); assert.equal(fire('pointermove', { clientY: 90 }).prevented, undefined); assert.equal(viewport.scrollLeft, 0);
        assert.equal(fire('pointermove', { clientX: 30, clientY: 100 }).prevented, undefined);
        fire('pointercancel'); fire('pointerdown'); fire('pointerup'); assert.equal(fire('click').prevented, undefined);
        fire('pointerdown', { pointerType: 'mouse' }); fire('pointermove', { pointerType: 'mouse', clientX: 40 }); assert.equal(viewport.scrollLeft, 0);
    } finally { scrollbars.destroy(); }
    const short = fixture({ range: false });
    try { short.fire('pointerdown'); assert.equal(short.fire('pointermove', { clientX: 30 }).prevented, undefined); assert.equal(short.viewport.scrollLeft, 0); }
    finally { short.scrollbars.destroy(); }
});
test('multitouch and teardown release pointer capture without leaving handlers behind', () => {
    const { viewport, scrollbars, fire } = fixture();
    fire('pointerdown'); fire('pointermove', { clientX: 40 });
    fire('pointerdown', { pointerId: 2, isPrimary: false }); assert.equal(viewport.hasPointerCapture(1), false);
    fire('pointerdown'); fire('pointermove', { clientX: 40 }); scrollbars.destroy();
    assert.equal(viewport.captures.size, 0); assert.equal(viewport.listeners.size, 0);
    assert.equal(viewport.hasClass('bpm-scroll-strip'), false);
});

test('thumb drag visibility is cleared on release, cancellation, capture loss and teardown', () => {
    const { viewport, scrollbars } = fixture();
    const thumb = viewport.children.find(child => child.hasClass('bpm-scroll-strip__track')).children[0];
    const start = () => thumb.listeners.get('pointerdown').callback({
        isPrimary: true, button: 0, pointerId: 3, clientX: 10,
        preventDefault() {}, stopPropagation() {},
    });
    for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        start();
        assert.equal(viewport.hasClass('is-strip-dragging'), true);
        assert.equal(thumb.hasClass('is-dragging'), true);
        thumb.listeners.get(ending).callback({ pointerId: 3 });
        assert.equal(viewport.hasClass('is-strip-dragging'), false);
        assert.equal(thumb.hasClass('is-dragging'), false);
        assert.equal(thumb.captures.size, 0);
    }
    start();
    scrollbars.destroy();
    assert.equal(viewport.hasClass('is-strip-dragging'), false);
    assert.equal(thumb.hasClass('is-dragging'), false);
});
