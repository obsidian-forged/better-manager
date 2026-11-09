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
    onHide(callback) { this.hiddenCallback = callback; }
    hide() { this.hidden = true; const callback = this.hiddenCallback; this.hiddenCallback = undefined; callback?.(); return this; }
    addSeparator() {}
    showAtPosition(position) { this.position = position; lastMenu = this; }
    showAtMouseEvent() { lastMenu = this; }
}
class Base {}
const notices = [];
let confirmResult = true, lastConfirmation;
const obsidian = {
    Modal: Base, FuzzySuggestModal: Base, SuggestModal: Base, Plugin: Base, PluginSettingTab: Base,
    Menu, Notice: class { constructor(message) { notices.push(message); } }, Platform: {},
    setIcon(element, icon) { element.icon = icon; },
    async bulkConfirm(_app, _manager, options) { lastConfirmation = options; return confirmResult; },
};
const bundle = await build({
    entryPoints: ['src/modal/manager-modal.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['obsidian', 'electron'], loader: { '.webp': 'dataurl' }, logLevel: 'silent',
    plugins: [{ name: 'unrelated-command-registry', setup(builder) {
        builder.onLoad({ filter: /[/\\]src[/\\]command\.ts$/ }, () => ({ contents: 'export default function Commands() {}', loader: 'ts' }));
        builder.onLoad({ filter: /[/\\]bulk-status-confirm-modal\.ts$/ }, () => ({ contents: 'import { bulkConfirm } from "obsidian"; export const confirmBulkStatusChange = bulkConfirm;', loader: 'ts' }));
    } }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), loaded, loaded.exports);

function fixture() {
    const modal = Object.create(loaded.exports.ManagerModal.prototype), calls = [], pending = [];
    const settings = {
        HIDES: ['b', 'unrelated'], GROUPS: [{ id: 'writing', name: 'Writing' }, { id: 'tools', name: 'Tools' }],
        TAGS: [{ id: 'bpm-install', name: 'Installed by BPM' }, { id: 'favorite', name: 'Favorite' }, { id: 'work', name: 'Work' }],
        DELAYS: [{ id: 'later', name: 'Later', time: 10 }, { id: 'slow', name: 'Slow', time: 30 }],
        Plugins: ['self', 'a', 'b', 'c'].map(id => ({ id, group: id === 'a' ? 'writing' : '', tags: id === 'a' ? ['favorite'] : [], enabled: true, delay: 'later' })),
    };
    let foreign = false;
    modal.settings = settings;
    modal.manager = { settings, manifest: { id: 'self' }, translator: { t: key => key },
        devices: { isProjectingForeign: () => foreign },
        overview: { async setPluginState(id, patch) { const plugin = settings.Plugins.find(item => item.id === id); if (plugin) Object.assign(plugin, patch); } },
        async saveSettings() { calls.push(['stage', structuredClone(settings)]); },
    };
    modal.app = {};
    modal.appPlugins = { manifests: Object.fromEntries(settings.Plugins.map(plugin => [plugin.id, { id: plugin.id }])) };
    modal.singleStartedPluginIds = new Set();
    modal.isManagedPluginEnabled = id => settings.Plugins.find(plugin => plugin.id === id)?.enabled;
    modal.showInlineProgress = () => ({ update() {}, hide() { calls.push(['progress-hidden']); } });
    modal.manager.applyRibbonSettings = () => {};
    modal.reloadShowData = async () => { calls.push(['reload']); };
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
test('custom layout settings preview does not replace the selected sorting mode', () => {
    const { modal, settings } = fixture();
    settings.PLUGIN_OVERVIEW_SORT = 'name-asc';
    modal.layoutSettingsPreview = true; modal.editorMode = true;
    modal.hasActiveStatusFilter = () => false;
    modal.getGroupFilterValues = () => []; modal.getTagFilterValues = () => []; modal.getDelayFilterValues = () => [];
    modal.searchText = '';
    const layout = [{ type: 'plugin', id: 'b' }, { type: 'plugin', id: 'a' }];
    assert.equal(modal.getPluginOverviewSort(), 'name-asc');
    assert.equal(modal.getSortedPluginLayoutItems(layout, new Map(), new Map(), new Map()), layout);
    assert.equal(modal.shouldRenderPluginLayoutSeparators(), true);
    modal.editorMode = false;
    assert.equal(modal.shouldRenderPluginLayoutSeparators(), false);
    assert.equal(settings.PLUGIN_OVERVIEW_SORT, 'name-asc');
});
const label = button => button.children.find(child => child.classes.has('manager-bulk-bar__button-label')).text;

test('bulk visibility hides a mixed selection, then unhides it, retaining the selection and unrelated entries', async () => {
    const { modal, settings, calls, trigger } = fixture();
    modal.bulkSelectedPluginIds.add('self'); modal.bulkSelectedPluginIds.add('uninstalled');
    let button = bulkButtons(modal).find(button => label(button) === '批量编辑_隐藏');
    assert.equal(label(button), '批量编辑_隐藏'); assert.equal(button.children[0].icon, 'eye-off');
    await trigger(button.listeners.click);
    assert.deepEqual(settings.HIDES, ['b', 'unrelated', 'a']);
    assert.deepEqual([...modal.bulkSelectedPluginIds], ['a', 'b']);
    button = bulkButtons(modal).find(button => label(button) === '批量编辑_取消隐藏');
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
    assert.equal(bulkButtons(modal).find(button => label(button) === '批量编辑_隐藏').disabled, true);
    await modal.applyBulkHidden();
    modal.bulkSelectedPluginIds.add('a'); setForeign(true);
    assert.equal(bulkButtons(modal).find(button => label(button) === '批量编辑_隐藏').disabled, true);
    await modal.applyBulkHidden();
    assert.deepEqual(settings.HIDES, original); assert.equal(calls.length, 0);
});

test('selecting the displayed list remains available in More without replacing bulk Hide', () => {
    const { modal } = fixture();
    modal.showBulkMoreMenu({});
    lastMenu.items.find(item => item.title === '批量编辑_全选当前列表').click();
    assert.deepEqual([...modal.bulkSelectedPluginIds], ['a', 'b', 'c']);
});

test('bulk bar exposes Select current list directly and excludes the manager and filtered-out plugins', () => {
    const { modal, settings } = fixture();
    modal.displayPlugins = settings.Plugins.filter(plugin => plugin.id === 'self' || plugin.id === 'c');
    const button = bulkButtons(modal).find(button => label(button) === '批量编辑_全选当前列表');
    assert.ok(button); button.listeners.click();
    assert.deepEqual([...modal.bulkSelectedPluginIds], ['c']);
});

test('bulk status skips protected plugins, continues after one failure and never separately saves the session', async () => {
    const { modal, settings, calls } = fixture();
    settings.Plugins.find(plugin => plugin.id === 'b').tags = ['bpm-ignore'];
    modal.manager.overview.setPluginState = async (id, patch) => {
        calls.push(['plugin-state', id, patch]);
        if (id === 'a') throw new Error('Native unload failed');
        Object.assign(settings.Plugins.find(plugin => plugin.id === id), patch);
    };
    const start = notices.length;
    await modal.applyPluginsEnabled(settings.Plugins, false);
    assert.deepEqual(calls.filter(([name]) => name === 'plugin-state').map(([, id]) => id), ['a', 'c']);
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'c').enabled, false);
    assert.equal(calls.filter(([name]) => name === 'stage').length, 0);
    assert.equal(calls.filter(([name]) => name === 'progress-hidden').length, 1);
    assert.ok(notices.slice(start).includes('批量编辑_启停失败'));
    assert.equal(lastConfirmation.skippedCount, 2);
    assert.equal(modal.bulkStatusChanging, false);
});

test('bulk enabling skips desktop-only plugins on this mobile device but allows editing a foreign preset', async () => {
    const { modal, settings, setForeign } = fixture();
    settings.Plugins.forEach(plugin => { plugin.enabled = false; });
    modal.appPlugins.manifests.a.isDesktopOnly = true;
    obsidian.Platform.isMobileApp = true;
    try {
        await modal.applyPluginsEnabled(settings.Plugins, true);
        assert.equal(settings.Plugins.find(plugin => plugin.id === 'a').enabled, false);
        assert.equal(settings.Plugins.find(plugin => plugin.id === 'b').enabled, true);
        setForeign(true);
        await modal.applyPluginsEnabled([settings.Plugins.find(plugin => plugin.id === 'a')], true);
        assert.equal(settings.Plugins.find(plugin => plugin.id === 'a').enabled, true);
    } finally { obsidian.Platform.isMobileApp = false; }
});

test('category menus target all current members independently of the filtered overview and respect cancellation', async () => {
    const { modal, settings, trigger } = fixture();
    settings.Plugins.find(plugin => plugin.id === 'b').group = 'writing';
    settings.Plugins.find(plugin => plugin.id === 'c').tags = ['favorite'];
    modal.displayPlugins = [];
    modal.showOneClickMenu({});
    const categoryMenu = lastMenu.items.find(item => item.title === '批量编辑_分组开关');
    if (categoryMenu.submenu) lastMenu = categoryMenu.submenu;
    else categoryMenu.click();
    const group = lastMenu.items.find(item => item.title === 'Writing');
    assert.equal(group.icon, 'folder-tree');
    await trigger(group.submenu.items.find(item => item.title === '批量编辑_全部禁用').click);
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'a').enabled, false);
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'b').enabled, false);
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'c').enabled, true);
    modal.showOneClickMenu({});
    lastMenu = lastMenu.items.find(item => item.title === '批量编辑_标签开关').submenu;
    const tag = lastMenu.items.find(item => item.title === 'Favorite');
    confirmResult = false;
    try { await trigger(tag.submenu.items.find(item => item.title === '批量编辑_全部禁用').click); }
    finally { confirmResult = true; }
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'c').enabled, true);
    await trigger(tag.submenu.items.find(item => item.title === '批量编辑_全部禁用').click);
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'c').enabled, false);
});

test('quick organization menus use checked native submenus and stage only an existing group or unassigned tag', async () => {
    const { modal, settings, calls, trigger } = fixture(), menu = new Menu();
    modal.addPluginOrganizationMenu(menu, 'a', new Element());
    assert.deepEqual(menu.items.map(item => [item.title, item.icon]), [['菜单_快速添加分组', 'folder-tree'], ['菜单_快速添加标签', 'tags'], ['菜单_快速添加到延迟', 'timer']]);
    const groups = menu.items[0].submenu.items, tags = menu.items[1].submenu.items, delays = menu.items[2].submenu.items;
    assert.equal(groups[0].checked, true); assert.equal(groups[0].disabled, true);
    assert.equal(tags[0].checked, true); assert.equal(tags[0].disabled, true);
    assert.deepEqual(tags.map(item => item.title), ['Favorite', 'Work', '标签编辑_创建标签']);
    assert.equal(groups.at(-1).title, '分组编辑_创建分组');
    assert.deepEqual(delays.map(item => [item.title, item.checked, item.disabled]), [['通用_无延迟_文本', false, false], ['Later (10s)', true, true], ['Slow (30s)', false, false]]);
    await trigger(groups[1].click); await trigger(tags[1].click); await trigger(delays[2].click);
    const plugin = settings.Plugins.find(item => item.id === 'a');
    assert.equal(plugin.group, 'tools'); assert.deepEqual(plugin.tags, ['favorite', 'work']); assert.equal(plugin.delay, 'slow');
    assert.equal(calls.filter(([name]) => name === 'stage').length, 3);
    await modal.assignPluginGroup('a', 'tools'); await modal.assignPluginTag('a', 'work');
    await modal.assignPluginDelay('a', 'slow'); await modal.assignPluginDelay('a', 'deleted');
    await modal.assignPluginGroup('a', 'deleted'); await modal.assignPluginTag('a', 'deleted');
    await modal.assignPluginTag('a', 'bpm-install');
    assert.equal(calls.filter(([name]) => name === 'stage').length, 3);
    await trigger(delays[0].click);
    assert.equal(settings.Plugins.find(item => item.id === 'a').delay, '');
    assert.equal(calls.filter(([name]) => name === 'stage').length, 4);
    assert.ok(settings.Plugins.every(item => item.enabled === true));
});

test('quick organization keeps creation available for empty categories and supports native menu fallback without setSubmenu', async () => {
    const { modal, settings, trigger } = fixture();
    settings.GROUPS = []; settings.TAGS = [{ id: 'bpm-install', name: 'Automatic' }]; settings.DELAYS = [];
    const empty = new Menu(); modal.addPluginOrganizationMenu(empty, 'a', new Element());
    assert.deepEqual(empty.items.map(item => item.disabled), [false, false, true]);
    assert.deepEqual(empty.items[0].submenu.items.map(item => item.title), ['分组编辑_创建分组']);
    assert.deepEqual(empty.items[1].submenu.items.map(item => item.title), ['标签编辑_创建标签']);
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


test('mobile category actions replace their parent sheet even when native submenus exist', () => {
    const { modal } = fixture();
    obsidian.Platform.isMobile = true;
    try {
        modal.showOneClickMenu({});
    const categoryMenu = lastMenu.items.find(item => item.title === '批量编辑_分组开关');
    if (categoryMenu.submenu) lastMenu = categoryMenu.submenu;
    else categoryMenu.click();
        const parent = lastMenu, item = parent.items.find(item => item.title === 'Writing');
        assert.equal(item.submenu, undefined);
        item.click();
        assert.equal(parent.hidden, true);
        assert.notEqual(lastMenu, parent);
        assert.deepEqual(lastMenu.items.map(item => item.title), ['批量编辑_全部启用', '批量编辑_全部禁用']);
    } finally { obsidian.Platform.isMobile = false; }
});

test('one-click menu combines updates and status actions and honors each child switch', async () => {
    const { modal, settings, trigger } = fixture();
    let updates = 0;
    modal.manager.openBatchUpdates = async () => { updates++; };
    modal.showOneClickMenu({});
    assert.equal(lastMenu.items.length, 5);
    await trigger(lastMenu.items.find(item => item.title === '批量更新_标题').click);
    assert.equal(updates, 1);
    settings.TOOLS = { batchUpdate: false, enableAll: false, groupStatus: false };
    modal.showOneClickMenu({});
    assert.deepEqual(lastMenu.items.map(item => item.title), ['批量编辑_禁用当前列表', '批量编辑_标签开关']);
    settings.TOOLS = { updates: false };
    modal.showOneClickMenu({});
    assert.equal(lastMenu.items.some(item => item.title === '批量更新_标题'), false);
});


test('mobile branches wait for the parent closing animation before showing another sheet', () => {
    const { modal } = fixture();
    obsidian.Platform.isMobile = true;
    try {
        modal.showOneClickMenu({});
        const parent = lastMenu;
        parent.hide = function () { this.hidden = true; };
        parent.items.find(item => item.title === '批量编辑_分组开关').click();
        assert.equal(lastMenu, parent);
        assert.equal(parent.hidden, true);
        parent.hiddenCallback();
        assert.notEqual(lastMenu, parent);
        assert.equal(lastMenu.items[0].title, 'Writing');
    } finally { obsidian.Platform.isMobile = false; }
});

test('mobile quick organization also replaces the parent menu instead of creating native submenus', () => {
    const { modal } = fixture();
    obsidian.Platform.isMobile = true;
    try {
        const menu = new Menu();
        modal.addPluginOrganizationMenu(menu, 'a', new Element());
        assert.equal(menu.items[0].submenu, undefined);
        menu.items[0].click();
        assert.equal(menu.hidden, true);
        assert.deepEqual(lastMenu.position, { x: 30, y: 70 });
    } finally { obsidian.Platform.isMobile = false; }
});


test('bulk assignment menus offer contextual creation only for adding groups or tags', () => {
    const { modal } = fixture();
    modal.showBulkGroupMenu({});
    assert.equal(lastMenu.items.at(-1).title, '分组编辑_创建分组');
    modal.showBulkTagMenu({}, 'add');
    assert.equal(lastMenu.items.at(-1).title, '标签编辑_创建标签');
    modal.showBulkTagMenu({}, 'remove');
    assert.equal(lastMenu.items.some(item => item.title === '标签编辑_创建标签'), false);
});
