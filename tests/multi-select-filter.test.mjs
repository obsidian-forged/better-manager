import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/ui/multi-select-filter.ts'], bundle: true, platform: 'node', format: 'cjs',
    write: false, external: ['obsidian'] });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(() => ({ setIcon(element, icon) { element.icon = icon; } }), loaded, loaded.exports);
const { MultiSelectFilter } = loaded.exports;

class Events {
    listeners = new Map();
    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    dispatch(type, init = {}) {
        const event = { target: this, detail: 1, stopPropagation() { this.stopped = true; }, preventDefault() {}, ...init };
        for (let target = this; target && !event.stopped; target = target.parentElement ?? (target instanceof Element ? target.ownerDocument : null)) {
            for (const listener of target.listeners.get(type) ?? []) listener(event);
        }
    }
    listenerCount() { return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0); }
}
class Element extends Events {
    children = [];
    classes = new Set();
    attributes = new Map();
    rect = { left: 20, top: 40, bottom: 80, width: 280, right: 300 };
    constructor(doc) { super(); this.ownerDocument = doc; }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    createEl(tag, options = {}) {
        if (typeof options === 'string') options = { cls: options };
        const child = new Element(this.ownerDocument);
        child.tag = tag; child.parentElement = this; child.text = options.text ?? '';
        child.addClass(...(options.cls ?? '').split(' ').filter(Boolean));
        for (const [key, value] of Object.entries(options.attr ?? {})) child.setAttribute(key, value);
        this.children.push(child); return child;
    }
    addClass(...names) { names.forEach(name => this.classes.add(name)); }
    removeClass(...names) { names.forEach(name => this.classes.delete(name)); }
    toggleClass(name, value) { value ? this.classes.add(name) : this.classes.delete(name); }
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key); }
    setText(text) { this.text = text; }
    setCssStyles(styles) { this.styles = { ...this.styles, ...styles }; }
    getBoundingClientRect() { return this.rect; }
    empty() { this.children = []; }
    focus() { this.ownerDocument.activeElement = this; }
    closest(selector) {
        for (let node = this; node; node = node.parentElement) if (node.classes.has(selector.slice(1))) return node;
        return null;
    }
    contains(target) {
        for (let node = target; node; node = node.parentElement) if (node === this) return true;
        return false;
    }
    instanceOf(type) { return this instanceof type; }
}
function fixture(overrides = {}) {
    const doc = new Events(), view = new Events();
    Object.assign(view, { innerWidth: 360, innerHeight: 640, Node: Element });
    doc.defaultView = view;
    const parent = new Element(doc), changes = [];
    const select = new MultiSelectFilter(parent, { label: 'Status', allValue: 'all', allLabel: 'All',
        options: [{ value: 'enabled', label: 'Enabled' }, { value: 'disabled', label: 'Disabled' }], values: [],
        onChange: values => changes.push(values), ...overrides });
    const choices = () => select.menuEl.children.filter(child => child.tag === 'button');
    const summary = () => select.buttonEl.children.find(child => child.classes.has('manager-multiselect-filter__summary')).text;
    const count = () => select.buttonEl.children.find(child => child.classes.has('manager-multiselect-filter__count')).text;
    return { select, parent, choices, summary, count, changes, doc, view };
}

test('shared multi-select preserves option focus, multi-choice state, and All reset without rebuilding the menu', () => {
    const { select, choices, summary, count, changes, doc } = fixture();
    select.buttonEl.dispatch('click');
    const [all, enabled, disabled] = choices();
    enabled.focus(); enabled.dispatch('click');
    assert.equal(choices()[1], enabled);
    assert.equal(doc.activeElement, enabled);
    assert.equal(enabled.getAttribute('aria-selected'), 'true');
    assert.equal(select.buttonEl.getAttribute('aria-expanded'), 'true');
    disabled.dispatch('click');
    assert.deepEqual(changes.at(-1), ['enabled', 'disabled']);
    assert.equal(summary(), 'Enabled +1'); assert.equal(count(), '2');
    enabled.dispatch('click');
    assert.deepEqual(changes.at(-1), ['disabled']); assert.equal(summary(), 'Disabled');
    all.dispatch('click');
    assert.deepEqual(changes.at(-1), []); assert.equal(summary(), 'All');
    assert.equal(all.getAttribute('aria-selected'), 'true');
    assert.ok(select.buttonEl.children.find(child => child.classes.has('manager-multiselect-filter__count')).classes.has('is-empty'));
    select.close();
});

test('Ribbon-style choices carry icons and counts, and selecting every disjoint status returns to All', () => {
    const { select, choices, count, changes } = fixture({ collapseAllSelected: true, icon: 'list-filter', options: [
        { value: 'all', label: 'All', icon: 'menu', count: 6 },
        { value: 'visible', label: 'Show', icon: 'eye', count: 2 },
        { value: 'hidden', label: 'Hide', icon: 'eye-off', count: 1 },
        { value: 'disabled', label: 'Plugin disabled', icon: 'ban', count: 3 },
    ] });
    const icon = select.buttonEl.children[0];
    assert.equal(icon.icon, 'menu'); assert.equal(count(), '6');
    choices()[1].dispatch('click');
    assert.equal(icon.icon, 'eye'); assert.equal(count(), '2');
    assert.equal(choices()[2].children.find(child => child.classes.has('manager-scope-select__option-icon')).icon, 'eye-off');
    choices()[2].dispatch('click'); assert.equal(count(), '3');
    choices()[3].dispatch('click');
    assert.deepEqual(changes.at(-1), []); assert.equal(icon.icon, 'menu'); assert.equal(count(), '6');
    assert.equal(choices()[0].getAttribute('aria-selected'), 'true');
});

test('menus use their owner window, remain bounded, and remove outside/scroll/resize listeners when closed', () => {
    const { select, doc, view, choices } = fixture({ fixed: true });
    select.rootEl.rect = { left: 310, right: 590, width: 280 };
    select.buttonEl.dispatch('click');
    assert.equal(select.menuEl.styles.width, '280px'); assert.equal(select.menuEl.styles.left, '72px');
    assert.ok(select.menuEl.classes.has('is-fixed'));
    assert.equal(doc.listenerCount(), 2); assert.equal(view.listenerCount(), 1);
    doc.dispatch('scroll', { target: choices()[1] });
    assert.equal(select.buttonEl.getAttribute('aria-expanded'), 'true');
    doc.dispatch('click', { target: new Element(doc) });
    assert.equal(select.buttonEl.getAttribute('aria-expanded'), 'false');
    assert.equal(doc.listenerCount(), 0); assert.equal(view.listenerCount(), 0);
    select.buttonEl.dispatch('click'); view.dispatch('resize');
    assert.equal(select.buttonEl.getAttribute('aria-expanded'), 'false');
    select.buttonEl.dispatch('click'); doc.dispatch('scroll', { target: new Element(doc) });
    assert.equal(select.buttonEl.getAttribute('aria-expanded'), 'false');
    assert.equal(doc.listenerCount(), 0);
});

test('touch scrolling cannot select a choice while keyboard navigation and selection keep working', () => {
    const { select, choices, changes, doc } = fixture();
    select.buttonEl.dispatch('click');
    const enabled = choices()[1];
    enabled.dispatch('pointerdown', { clientX: 20, clientY: 30 });
    enabled.dispatch('pointermove', { clientX: 20, clientY: 60 });
    enabled.dispatch('click');
    assert.equal(changes.length, 0);
    select.rootEl.dispatch('keydown', { key: 'ArrowDown' });
    assert.equal(doc.activeElement, choices()[0]);
    select.rootEl.dispatch('keydown', { key: 'ArrowDown' });
    assert.equal(doc.activeElement, enabled);
    enabled.dispatch('click', { detail: 0 });
    assert.deepEqual(changes.at(-1), ['enabled']);
    select.rootEl.dispatch('keydown', { key: 'Escape' });
    assert.equal(doc.activeElement, select.buttonEl);
    assert.equal(select.buttonEl.getAttribute('aria-expanded'), 'false');
    enabled.dispatch('pointerdown', { clientX: 20, clientY: 30 });
    enabled.dispatch('click'); assert.deepEqual(changes.at(-1), []);
});

test('option refresh removes unavailable values and keeps current option focus with updated labels', () => {
    const { select, choices, summary, doc } = fixture({ values: ['enabled', 'disabled'] });
    select.buttonEl.dispatch('click'); choices()[1].focus();
    select.refreshOptions([{ value: 'enabled', label: 'Available', icon: 'check' }]);
    assert.equal(summary(), 'Available');
    assert.equal(doc.activeElement, choices()[1]);
    assert.equal(choices()[1].getAttribute('aria-selected'), 'true');
    select.setValues([]); assert.equal(summary(), 'All');
    select.close();
});

test('settings action sits after the options and closes the menu before navigating', () => {
    let opened = 0;
    const { select, choices } = fixture({ settingsAction: { label: 'Go to settings', icon: 'settings-2', onClick: () => { opened++; } } });
    select.buttonEl.dispatch('click');
    const settings = choices().find(button => button.classes.has('manager-multiselect-filter__settings'));
    assert.ok(settings);
    assert.equal(settings.children.find(child => child.classes.has('manager-multiselect-filter__option-label'))?.text, 'Go to settings');
    settings.dispatch('click');
    assert.equal(opened, 1);
    assert.equal(select.buttonEl.getAttribute('aria-expanded'), 'false');
});
