import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const nativeRequire = createRequire(import.meta.url);

class Element {
    children = [];
    classes = new Set();
    isConnected = true;
    constructor(doc) { this.ownerDocument = doc; }
    createDiv(cls = '') { const child = new Element(this.ownerDocument); child.parentElement = this; child.addClass(cls); this.children.push(child); return child; }
    addClass(...classes) { classes.forEach(cls => this.classes.add(cls)); }
    removeClass(...classes) { classes.forEach(cls => this.classes.delete(cls)); }
    hasClass(cls) { return this.classes.has(cls); }
    empty() { this.children = []; }
    closest() { return null; }
    querySelector(selector) { return this.children.find(child => child.hasClass(selector.slice(1))) ?? null; }
    querySelectorAll(selector) {
        if (selector === 'button') return this.children.filter(child => child.button);
        return this.children.filter(child => child.hasClass('setting-item') && !child.hasClass('setting-item-heading') || child.hasClass('manager-personalize'));
    }
}
function document() {
    const doc = {};
    doc.defaultView = { createDiv: () => new Element(doc) };
    return doc;
}
class Base { constructor(app) { this.app = app; this.containerEl = new Element(document()); } }
const obsidian = { PluginSettingTab: Base, Plugin: Base, Modal: Base, FuzzySuggestModal: Base, SuggestModal: Base, Menu: Base };
const result = await build({ stdin: { contents: "export { ManagerSettingTab } from './src/settings/index'; export { SettingsSearch } from './src/settings/search-view';", resolveDir: process.cwd() },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['obsidian', 'electron'], loader: { '.webp': 'dataurl' }, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(name => name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), module, module.exports);
const { ManagerSettingTab, SettingsSearch } = module.exports;

function pages() {
    return ['General', 'Appearance'].map((label, page) => ({ label, render(container) {
        const row = container.createDiv('setting-item');
        row.createDiv('setting-item-name').textContent = page ? 'Toolbar labels' : 'Recent install window';
        row.createDiv('setting-item-description').textContent = page ? 'Show labels on hover' : 'Days to mark newly installed plugins';
        container.createDiv('setting-item-heading');
    } }));
}

test('native and BPM settings search index real setting names and descriptions without headings', () => {
    const indexed = SettingsSearch.index(pages(), document(), 'Personalize');
    assert.deepEqual(indexed.map(item => [item.page, item.ordinal, item.name, item.description]), [
        [0, 0, 'Recent install window', 'Days to mark newly installed plugins'],
        [1, 0, 'Toolbar labels', 'Show labels on hover'],
    ]);
});

test('native definitions mount the live editor on the matching page and legacy display returns to its own root', () => {
    const editing = new Set();
    const manager = { register() {}, translator: { t: key => key }, beginSettingsEditing: owner => editing.add(owner), endSettingsEditing: owner => editing.delete(owner) };
    const tab = new ManagerSettingTab({}, manager), legacyRoot = tab.containerEl, mounts = [];
    tab.searchPages = pages;
    tab.renderSettings = () => { mounts.push({ root: tab.renderRoot, page: tab.activeTabIndex }); };
    const definitions = tab.getSettingDefinitions();
    assert.deepEqual(definitions.map(item => [item.type, item.name]), [['page', 'General'], ['page', 'Appearance']]);
    assert.ok(definitions[0].items[0].aliases.includes('Days to mark newly installed plugins'));
    assert.ok(definitions[1].items[0].aliases.includes('Toolbar labels'));
    const nativeRoot = new Element(document()); nativeRoot.addClass('setting-item');
    const cleanup = definitions[1].items[0].render({ settingEl: nativeRoot });
    assert.deepEqual(mounts.at(-1), { root: nativeRoot, page: 1 });
    assert.equal(nativeRoot.hasClass('setting-item'), false);
    assert.equal(tab.isVisible, true);
    assert.equal(editing.has(tab), true);
    cleanup();
    assert.equal(tab.isVisible, false);
    assert.equal(editing.has(tab), false);
    tab.display();
    assert.equal(mounts.at(-1).root, legacyRoot);
    assert.equal(tab.containerEl, legacyRoot);
});
