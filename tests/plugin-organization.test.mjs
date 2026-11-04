import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const nativeRequire = createRequire(import.meta.url);
class Element {
    children = [];
    classes = new Set();
    listeners = {};
    attributes = {};
    createEl(tag, options = {}) {
        if (typeof options === 'string') options = { cls: options };
        const child = new Element();
        child.tag = tag; child.text = options.text ?? '';
        (options.cls ?? '').split(' ').filter(Boolean).forEach(name => child.classes.add(name));
        this.children.push(child); return child;
    }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    querySelectorAll() { return []; }
    getBoundingClientRect() { return { left: 30, bottom: 70 }; }
}
let submenuSupported = true, lastMenu;
class Menu {
    items = [];
    addItem(callback) {
        const item = {
            setTitle(value) { this.title = value; return this; },
            setIcon(value) { this.icon = value; return this; },
            setDisabled(value) { this.disabled = value; return this; },
            setChecked(value) { this.checked = value; return this; },
            onClick(callback) { this.click = callback; return this; },
        };
        if (submenuSupported) item.setSubmenu = function () { this.submenu = new Menu(); return this.submenu; };
        callback(item); this.items.push(item); return this;
    }
    addSeparator() {}
    showAtPosition(position) { this.position = position; lastMenu = this; }
    showAtMouseEvent() { lastMenu = this; }
}
class Base {}
const notices = [];
const obsidian = {
    Modal: Base, FuzzySuggestModal: Base, SuggestModal: Base, Plugin: Base, PluginSettingTab: Base,
    Menu, Notice: class { constructor(message) { notices.push(message); } }, Platform: {},
    setIcon(element, icon) { element.icon = icon; },
};
const bundle = await build({
    entryPoints: ['src/modal/manager-modal.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['obsidian', 'electron'], loader: { '.webp': 'dataurl' }, logLevel: 'silent',
    plugins: [{ name: 'unrelated-command-registry', setup(builder) {
        builder.onLoad({ filter: /[/\\]src[/\\]command\.ts$/ }, () => ({ contents: 'export default function Commands() {}', loader: 'ts' }));
    } }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), loaded, loaded.exports);

function fixture() {
    const modal = Object.create(loaded.exports.ManagerModal.prototype), calls = [], pending = [];
    const settings = {
        HIDES: ['b', 'unrelated'], GROUPS: [{ id: 'writing', name: 'Writing' }, { id: 'tools', name: 'Tools' }],
        TAGS: [{ id: 'bpm-install', name: 'Installed by BPM' }, { id: 'favorite', name: 'Favorite' }, { id: 'work', name: 'Work' }],
        Plugins: ['self', 'a', 'b', 'c'].map(id => ({ id, group: id === 'a' ? 'writing' : '', tags: id === 'a' ? ['favorite'] : [], enabled: true, delay: 'later' })),
    };
    let foreign = false;
    modal.settings = settings;
    modal.manager = { settings, manifest: { id: 'self' }, translator: { t: key => key },
        devices: { isProjectingForeign: () => foreign },
        async saveSettings() { calls.push(['stage', structuredClone(settings)]); },
    };
    modal.app = {};
    modal.modalPageEl = new Element();
    modal.bulkEditMode = true;
    modal.bulkSelectedPluginIds = new Set(['a', 'b']);
    modal.displayPlugins = settings.Plugins;
    modal.bindLongPressTooltip = () => {};
    modal.refreshFilterOptions = async force => { calls.push(['refresh', force]); };
    modal.action = work => (...args) => { pending.push(work(...args)); };
    const trigger = async callback => { assert.equal(callback(), undefined); await Promise.all(pending.splice(0)); };
    return { modal, settings, calls, trigger, setForeign(value) { foreign = value; } };
}
function bulkButtons(modal) {
    const host = new Element(); modal.renderBulkBar(host);
    return host.children[0].children[1].children;
}
const label = button => button.children.find(child => child.classes.has('manager-bulk-bar__button-label')).text;

test('bulk visibility hides a mixed selection, then unhides it, retaining the selection and unrelated entries', async () => {
    const { modal, settings, calls, trigger } = fixture();
    modal.bulkSelectedPluginIds.add('self'); modal.bulkSelectedPluginIds.add('uninstalled');
    let button = bulkButtons(modal)[0];
    assert.equal(label(button), '批量编辑_隐藏'); assert.equal(button.children[0].icon, 'eye-off');
    await trigger(button.listeners.click);
    assert.deepEqual(settings.HIDES, ['b', 'unrelated', 'a']);
    assert.deepEqual([...modal.bulkSelectedPluginIds], ['a', 'b']);
    button = bulkButtons(modal)[0];
    assert.equal(label(button), '批量编辑_取消隐藏'); assert.equal(button.children[0].icon, 'eye');
    await trigger(button.listeners.click);
    assert.deepEqual(settings.HIDES, ['unrelated']);
    assert.equal(calls.filter(([name]) => name === 'stage').length, 2);
    assert.equal(calls.filter(([name]) => name === 'refresh').length, 2);
    assert.ok(settings.Plugins.every(plugin => plugin.enabled === true && plugin.delay === 'later'));
    assert.deepEqual([...modal.bulkSelectedPluginIds], ['a', 'b']);
});

test('bulk visibility cannot hide the manager, an empty selection, or change this device from a foreign preset', async () => {
    const { modal, settings, calls, setForeign } = fixture(), original = [...settings.HIDES];
    modal.bulkSelectedPluginIds = new Set(['self']);
    assert.equal(bulkButtons(modal)[0].disabled, true);
    await modal.applyBulkHidden();
    modal.bulkSelectedPluginIds.add('a'); setForeign(true);
    assert.equal(bulkButtons(modal)[0].disabled, true);
    await modal.applyBulkHidden();
    assert.deepEqual(settings.HIDES, original); assert.equal(calls.length, 0);
});

test('selecting the displayed list remains available in More without replacing bulk Hide', () => {
    const { modal } = fixture();
    modal.showBulkMoreMenu({});
    lastMenu.items.find(item => item.title === '批量编辑_全选当前列表').click();
    assert.deepEqual([...modal.bulkSelectedPluginIds], ['a', 'b', 'c']);
});

test('quick organization menus use checked native submenus and stage only an existing group or unassigned tag', async () => {
    const { modal, settings, calls, trigger } = fixture(), menu = new Menu();
    modal.addPluginOrganizationMenu(menu, 'a', new Element());
    assert.deepEqual(menu.items.map(item => [item.title, item.icon]), [['菜单_快速添加分组', 'folder-tree'], ['菜单_快速添加标签', 'tags']]);
    const groups = menu.items[0].submenu.items, tags = menu.items[1].submenu.items;
    assert.equal(groups[0].checked, true); assert.equal(groups[0].disabled, true);
    assert.equal(tags[0].checked, true); assert.equal(tags[0].disabled, true);
    assert.deepEqual(tags.map(item => item.title), ['Favorite', 'Work']);
    await trigger(groups[1].click); await trigger(tags[1].click);
    const plugin = settings.Plugins.find(item => item.id === 'a');
    assert.equal(plugin.group, 'tools'); assert.deepEqual(plugin.tags, ['favorite', 'work']);
    assert.equal(calls.filter(([name]) => name === 'stage').length, 2);
    await modal.assignPluginGroup('a', 'tools'); await modal.assignPluginTag('a', 'work');
    await modal.assignPluginGroup('a', 'deleted'); await modal.assignPluginTag('a', 'deleted');
    await modal.assignPluginTag('a', 'bpm-install');
    assert.equal(calls.filter(([name]) => name === 'stage').length, 2);
    assert.ok(settings.Plugins.every(item => item.enabled === true && item.delay === 'later'));
});

test('quick organization disables empty categories and supports native menu fallback without setSubmenu', async () => {
    const { modal, settings, trigger } = fixture();
    settings.GROUPS = []; settings.TAGS = [{ id: 'bpm-install', name: 'Automatic' }];
    const empty = new Menu(); modal.addPluginOrganizationMenu(empty, 'a', new Element());
    assert.ok(empty.items.every(item => item.disabled));
    settings.GROUPS = [{ id: 'tools', name: 'Tools' }];
    submenuSupported = false;
    try {
        const fallback = new Menu(); modal.addPluginOrganizationMenu(fallback, 'a', new Element());
        fallback.items[0].click();
        assert.deepEqual(lastMenu.position, { x: 30, y: 70 });
        assert.equal(lastMenu.items[0].title, 'Tools');
        await trigger(lastMenu.items[0].click);
        assert.equal(settings.Plugins.find(item => item.id === 'a').group, 'tools');
    } finally { submenuSupported = true; }
});
