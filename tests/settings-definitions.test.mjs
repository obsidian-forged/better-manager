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
    createDiv(options = '') { const child = new Element(this.ownerDocument); child.parentElement = this; child.addClass(typeof options === 'string' ? options : options.cls ?? ''); child.textContent = options.text; this.children.push(child); return child; }
    createSpan(options = '') { return this.createDiv(options); }
    setText(value) { this.textContent = value; }
    setAttribute(name, value) { this.attributes ??= {}; this.attributes[name] = value; }
    append(child) { child.parentElement = this; this.children.push(child); }
    prepend(child) { child.parentElement = this; this.children.unshift(child); }
    addClass(...classes) { classes.forEach(cls => this.classes.add(cls)); }
    removeClass(...classes) { classes.forEach(cls => this.classes.delete(cls)); }
    hasClass(cls) { return this.classes.has(cls); }
    empty() { this.children = []; }
    closest(selector) { return this.hasClass(selector.slice(1)) ? this : this.parentElement?.closest(selector) ?? null; }
    querySelector(selector) { return this.children.find(child => child.hasClass(selector.slice(1))) ?? this.children.map(child => child.querySelector(selector)).find(Boolean) ?? null; }
    querySelectorAll(selector) {
        if (selector === 'button') return this.children.filter(child => child.button);
        const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
        if (selector === '*') return descendants;
        if (selector === '.manager-setting-navigation > .setting-item-heading > .setting-item-name') return descendants.filter(child => child.hasClass('setting-item-name') && child.parentElement?.hasClass('setting-item-heading') && child.parentElement?.parentElement?.hasClass('manager-setting-navigation'));
        if (selector === '.manager-setting-navigation__summary') return descendants.filter(child => child.hasClass('manager-setting-navigation__summary'));
        return this.children.filter(child => child.hasClass('setting-item') && !child.hasClass('setting-item-heading') || child.hasClass('manager-personalize'));
    }
}
function document() {
    const doc = {};
    doc.defaultView = { createDiv: options => { const element = new Element(doc); element.addClass(options?.cls ?? ''); return element; },
        MutationObserver: class { observe() {} disconnect() {} } };
    doc.win = doc.defaultView;
    doc.win.createFragment = () => new Element(doc);
    return doc;
}
class Base { constructor(app) { this.app = app; this.containerEl = new Element(document()); } }
const obsidian = { PluginSettingTab: Base, Plugin: Base, Modal: Base, FuzzySuggestModal: Base, SuggestModal: Base, Menu: Base, requireApiVersion: () => true, setIcon: (element, icon) => { element.icon = icon; } };
const result = await build({ stdin: { contents: "export { ManagerSettingTab } from './src/settings/index'; export { SettingsSearch } from './src/settings/search-view'; export { syncNativeSettingsPageTitle } from './src/settings/native-page-title';", resolveDir: process.cwd() },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['obsidian', 'electron'], loader: { '.webp': 'dataurl' }, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(name => name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), module, module.exports);
const { ManagerSettingTab, SettingsSearch, syncNativeSettingsPageTitle } = module.exports;

function pages() {
    return ['General', 'Appearance'].map((label, page) => ({ label, description: page ? 'Customize cards and toolbars.' : 'Configure behavior and saving.', icon: page ? 'palette' : 'settings-2', render(container) {
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
    const rootDefinitions = tab.getSettingDefinitions();
    assert.equal(rootDefinitions[0].type, 'group');
    assert.equal(rootDefinitions[0].heading, '管理器_BPM设置_短');
    const definitions = rootDefinitions[0].items;
    assert.deepEqual(definitions.map(item => [item.type, item.name]), [['page', 'General'], ['page', 'Appearance']]);
    assert.ok(definitions[0].items[0].aliases.includes('Days to mark newly installed plugins'));
    assert.ok(definitions[1].items[0].aliases.includes('Toolbar labels'));
    assert.equal(definitions[0].desc.children[0].attributes['data-bpm-setting-icon'], 'settings-2');
    assert.equal(definitions[1].desc.children[0].attributes['data-bpm-setting-icon'], 'palette');
    assert.equal(definitions[0].desc.children[0].textContent, 'Configure behavior and saving.');
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

test('native settings navigation uses fixed descriptions and a single gear icon in its heading', () => {
    const tab = new ManagerSettingTab({}, { register() {}, translator: { t: key => key } });
    tab.searchPages = pages;
    const group = tab.containerEl.createDiv('manager-setting-navigation');
    const heading = group.createDiv('setting-item-heading').createDiv('setting-item-name');
    heading.setText('Better Manager settings');
    const definitions = tab.getSettingDefinitions();
    assert.equal(definitions[0].cls, 'manager-setting-navigation');
    assert.equal(tab.icon, 'settings');
    assert.equal(heading.children[0].icon, 'settings');
    assert.equal(heading.children[1].textContent, 'Better Manager settings');
    tab.getSettingDefinitions();
    assert.equal(heading.children.length, 2);
    assert.deepEqual(definitions[0].items.map(page => page.desc.children[0].textContent), ['Configure behavior and saving.', 'Customize cards and toolbars.']);
});

test('settings indexes omit user taxonomy values while preserving original control ordinals', () => {
    const indexed = SettingsSearch.index([{ label: 'Groups', description: 'Manage groups.', render(container) {
        const create = container.createDiv('setting-item');
        create.addClass('manager-taxonomy-setting__row', 'manager-taxonomy-setting__row--create');
        create.createDiv('setting-item-name').setText('Create group');
        const custom = container.createDiv('setting-item');
        custom.addClass('manager-taxonomy-setting__row');
        custom.createDiv('setting-item-name').setText('Private project name');
        custom.createDiv('setting-item-description').setText('Sensitive configured value');
        const option = container.createDiv('setting-item');
        option.createDiv('setting-item-name').setText('Group appearance');
        option.createDiv('setting-item-description').setText('Choose label presentation');
    } }], document(), 'Personalize');
    assert.deepEqual(indexed.map(item => [item.ordinal, item.name]), [[0, 'Create group'], [2, 'Group appearance']]);
    assert.equal(JSON.stringify(indexed).includes('Private project'), false);
    assert.equal(JSON.stringify(indexed).includes('Sensitive'), false);
});

test('native page title follows category changes without replacing the back button or changing another page', () => {
    const doc = document(), pageRoot = new Element(doc);
    pageRoot.addClass('setting-page');
    const titlebar = pageRoot.createDiv('setting-page-titlebar');
    const back = titlebar.createDiv('setting-page-back-button');
    const title = titlebar.createDiv('setting-page-title');
    title.setText('General');
    const root = pageRoot.createDiv();
    const page = { rootEl: pageRoot, title: 'General' };
    let modalTitle = '', updates = 0;
    const app = { setting: { pageStack: [{ page }], updatePageTitle() { modalTitle = this.pageStack.at(-1).page.title; updates++; } } };
    syncNativeSettingsPageTitle(root, 'Appearance', app);
    assert.equal(page.title, 'Appearance');
    assert.equal(title.textContent, 'Appearance');
    assert.equal(modalTitle, 'Appearance');
    assert.equal(titlebar.children[0], back);
    assert.equal(titlebar.children.length, 2);
    assert.equal(updates, 1);
    app.setting.pageStack = [{ page: { rootEl: new Element(doc), title: 'Unrelated' } }];
    syncNativeSettingsPageTitle(root, 'Groups', app);
    assert.equal(app.setting.pageStack[0].page.title, 'Unrelated');
    assert.equal(updates, 1);
    syncNativeSettingsPageTitle(undefined, 'Tags', app);
    syncNativeSettingsPageTitle(new Element(doc), 'Legacy', {});
    assert.equal(updates, 1);
});

test('native title DOM fallback works when the optional native stack is absent', () => {
    const pageRoot = new Element(document()); pageRoot.addClass('setting-page');
    const title = pageRoot.createDiv('setting-page-titlebar').createDiv('setting-page-title');
    const root = pageRoot.createDiv();
    syncNativeSettingsPageTitle(root, 'Tags', {});
    assert.equal(title.textContent, 'Tags');
});
