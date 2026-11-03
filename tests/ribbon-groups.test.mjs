import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const menuItems = [];
const headerClasses = new Set();
globalThis.activeDocument = { createDocumentFragment() { return { createSpan() {
    return { closest(selector) { assert.equal(selector, '.menu-item'); return { addClass(name) { headerClasses.add(name); } }; } };
} }; } };
class Menu {
    addItem(render) {
        const item = { setTitle(value) { this.title = value; return this; },
            setIcon(value) { this.icon = value; return this; },
            setDisabled(value) { this.disabled = value; return this; },
            setIsLabel(value) { this.isLabel = value; return this; },
            onClick(callback) { this.click = callback; return this; } };
        render(item);
        menuItems.push(item);
    }
    addSeparator() {}
    showAtMouseEvent() {}
}
const bundle = await build({ entryPoints: ['src/manager/ribbon-groups.ts'], bundle: true, platform: 'node',
    format: 'cjs', write: false, external: ['obsidian'], logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => {
    if (name !== 'obsidian') throw new Error(name);
    return { Menu, getIconIds: () => ['folder', 'star'], setIcon: (button, icon) => { button.icon = icon; } };
}, module, module.exports);
const { RibbonGroups } = module.exports;

test('group uses a native icon, proxies its visible member and removes stale icons', () => {
    let calls = 0;
    const native = { id: 'plugin:action', callback: () => { calls++; }, hidden: true };
    const ribbon = { items: [native] };
    const settings = { RIBBON_GROUPS: [{ id: 'one', name: 'Tools', icon: 'star', members: ['action'] }],
        RIBBON_SETTINGS: [{ bpmUniqueId: 'action', name: 'Action', icon: 'star', visible: true,
            ribbonIdMap: { en: 'plugin:action' } }] };
    const manager = { settings, app: { workspace: { leftRibbon: ribbon } },
        addRibbonIcon(icon, title, callback) {
            const button = { icon, title, remove() { this.removed = true; }, setAttr() {} };
            ribbon.items.push({ id: `manager:${title}`, buttonEl: button, callback });
            return button;
        } };
    const groups = new RibbonGroups(manager);
    groups.sync(ribbon);
    const groupItem = ribbon.items[1];
    assert.equal(groups.isGroupItem(groupItem), true);
    assert.equal(groupItem.buttonEl.icon, 'star');
    groupItem.callback({});
    assert.equal(headerClasses.has('bpm-group-menu-label'), true);
    assert.equal(menuItems.at(-1).title, 'Action');
    menuItems.at(-1).click();
    assert.equal(calls, 1);
    settings.RIBBON_GROUPS = [];
    groups.sync(ribbon);
    assert.equal(ribbon.items.length, 1);
    assert.equal(groupItem.buttonEl.removed, true);
});
