import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const nativeRequire = createRequire(import.meta.url);

// 验证真实面板的重绘/事件链，不启动或改动个人库；Exercise production rendering with native API doubles.
class Element {
    ownerDocument = { defaultView: { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {} };
    children = [];
    classes = new Set();
    attributes = {};
    dataset = {};
    listeners = {};
    isConnected = true;
    scrollTop = 0;
    createDiv(options = {}) { return this.createEl('div', options); }
    createSpan(options = {}) { return this.createEl('span', options); }
    createEl(tag, options = {}) {
        const child = new Element(); child.tag = tag;
        child.ownerDocument = this.ownerDocument;
        child.parentElement = this;
        if (typeof options === 'string') options = { cls: options };
        child.text = options.text ?? '';
        child.addClass(...(options.cls ?? '').split(' ').filter(Boolean));
        Object.assign(child.attributes, options.attr);
        this.children.push(child); return child;
    }
    addClass(...names) { names.forEach(name => this.classes.add(name)); }
    removeClass(...names) { names.forEach(name => this.classes.delete(name)); }
    hasClass(name) { return this.classes.has(name); }
    toggleClass(name, enabled) { if (enabled) this.classes.add(name); else this.classes.delete(name); }
    closest() { return null; }
    querySelector(selector) {
        for (const child of this.children) {
            if (selector.startsWith('.') ? child.classes.has(selector.slice(1)) : child.tag === selector) return child;
            const nested = child.querySelector(selector);
            if (nested) return nested;
        }
        return null;
    }
    querySelectorAll() { return []; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    setText(value) { this.text = value; }
    empty() { this.children = []; }
    insertBefore(child, reference) {
        if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child);
        const index = this.children.indexOf(reference);
        this.children.splice(index < 0 ? this.children.length : index, 0, child);
        child.parentElement = this;
        return child;
    }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    removeEventListener(name) { delete this.listeners[name]; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
    getBoundingClientRect() { return { left: 0, bottom: 30, top: 0, width: 300, height: 100 }; }
    setCssStyles() {}
}
class Base { constructor(app) { this.app = app; this.contentEl = new Element(); } }
class Button {
    constructor(parent) { this.buttonEl = parent.createEl('button'); }
    setIcon(icon) { this.buttonEl.icon = icon; return this; }
    setButtonText(text) { this.buttonEl.text = text; return this; }
    setTooltip() { return this; }
    setDisabled(disabled) { this.buttonEl.disabled = disabled; return this; }
    onClick(callback) { this.buttonEl.click = callback; return this; }
}
class Text {
    constructor(parent) { this.inputEl = parent.createEl('input'); }
    setPlaceholder() { return this; }
    setValue() { return this; }
    onChange(callback) { this.change = callback; this.inputEl.input = callback; return this; }
}
class Toggle extends Text { setTooltip() { return this; } }
let lastMenu;
class Menu {
    items = [];
    constructor() { lastMenu = this; }
    addItem(callback) {
        const item = { setTitle(value) { this.title = value; return this; }, setIcon() { return this; }, setDisabled(value) { this.disabled = value; return this; }, onClick(value) { this.click = value; return this; },
            setSubmenu() { this.submenu = new Menu(); return this.submenu; } };
        callback(item); this.items.push(item); return this;
    }
    addSeparator() { return this; }
    showAtMouseEvent() { lastMenu = this; }
}
const obsidian = { Modal: Base, FuzzySuggestModal: Base, SuggestModal: Base, Plugin: Base, PluginSettingTab: Base, Menu,
    ButtonComponent: Button, TextComponent: Text, ToggleComponent: Toggle, Platform: { isMobileApp: true }, setIcon(el, name) { el.icon = name; } };
const bundle = await build({ entryPoints: ['src/modal/ribbon-modal.ts'], bundle: true, platform: 'node', format: 'cjs',
    write: false, external: ['obsidian', 'electron'], loader: { '.webp': 'dataurl' }, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), module, module.exports);
const { RibbonModal } = module.exports;
function fixture() {
    const manager = { settings: { RIBBON_SETTINGS: [{ visible: true }, { visible: false }], RIBBON_GROUPS: [] },
        isRibbonManagerEnabled: () => true, translator: { t: key => key } };
    const panel = new RibbonModal({}, manager);
    const rendered = [];
    panel.renderFilteredList = () => { rendered.push([...panel.statusFilters].sort()); };
    let scopes = 0;
    panel.renderScopeBar = () => { scopes++; };
    return { panel, rendered, scopes: () => scopes };
}
const buttons = host => host.children[0].children[0].children.filter(child => child.tag === 'button');

test('embedded Ribbon supports multi-select status filters and clears them via All', () => {
    const { panel, rendered, scopes } = fixture();
    const host = new Element(); const page = new Element();
    panel.setExternalFilterBar(true); panel.mountFilterBar(host); panel.display(page, false);
    assert.equal(scopes(), 0);
    const states = () => buttons(host).map(button => button.classes.has('is-active'));
    const pressed = () => buttons(host).map(button => button.attributes['aria-pressed']);
    assert.deepEqual(states(), [true, false, false, false]);
    buttons(host)[1].click();
    assert.deepEqual(states(), [false, true, false, false]);
    buttons(host)[2].click();
    assert.deepEqual(states(), [false, true, true, false]);
    buttons(host)[3].click();
    assert.deepEqual(states(), [true, false, false, false]);
    assert.deepEqual(rendered.at(-1), []);
    buttons(host)[3].click();
    assert.deepEqual(states(), [false, false, false, true]);
    buttons(host)[0].click();
    assert.deepEqual(states(), [true, false, false, false]);
    assert.deepEqual(pressed(), ['true', 'false', 'false', 'false']);
    assert.equal(host.children.length, 1);
    assert.ok(rendered.length > 0);
});
test('standalone mobile Ribbon keeps its own single device selector', () => {
    const { panel, scopes } = fixture();
    panel.display(new Element());
    assert.equal(scopes(), 1);
});

test('Ribbon frames cancel through their own windows and preserve pending configuration work on close', () => {
    const { panel } = fixture();
    const cancelled = [];
    const view = name => ({ requestAnimationFrame: () => 7, cancelAnimationFrame: id => cancelled.push([name, id]) });
    const first = new Element(), second = new Element();
    first.ownerDocument = { defaultView: view('first') };
    second.ownerDocument = { defaultView: view('second') };
    let restored = 0, staged = 0;
    panel.scheduleFrame(first, () => restored++);
    panel.scheduleFrame(second, () => staged++, true);
    panel.clearFrames();
    assert.deepEqual(cancelled, [['first', 7], ['second', 7]]);
    assert.equal(restored, 0);
    assert.equal(staged, 1);
    panel.clearFrames();
    assert.equal(staged, 1);
});

function statusFixture() {
    const { panel } = fixture();
    panel.manager.settings.Plugins = [{ id: 'enabled', enabled: true }, { id: 'disabled', enabled: false }];
    panel.manager.settings.RIBBON_SETTINGS = [
        { bpmUniqueId: 'enabled', name: 'Visible', visible: true },
        { bpmUniqueId: 'enabled#2', name: 'Hidden', visible: false },
        { bpmUniqueId: 'disabled', name: 'Disabled visible', visible: true },
        { bpmUniqueId: 'disabled#2', name: 'Disabled hidden', visible: false },
        { bpmUniqueId: 'core', name: 'Core', visible: true },
        { bpmUniqueId: 'bpm-group:tools', name: 'Group', visible: false },
    ];
    return panel;
}

test('Ribbon status selections exclude disabled plugins from visible and hidden results', () => {
    const panel = statusFixture();
    const ids = filters => {
        panel.statusFilters = new Set(filters);
        return panel.getFilteredRibbonItems().map(item => item.bpmUniqueId);
    };
    assert.deepEqual(ids(['visible']), ['enabled', 'core']);
    assert.deepEqual(ids(['hidden']), ['enabled#2', 'bpm-group:tools']);
    assert.deepEqual(ids(['visible', 'hidden']), ['enabled', 'enabled#2', 'core', 'bpm-group:tools']);
    assert.deepEqual(ids(['disabled']), ['disabled', 'disabled#2']);
    assert.deepEqual(ids(['visible', 'disabled']), ['enabled', 'disabled', 'disabled#2', 'core']);
    assert.equal(ids([]).length, 6);
    // Filtering never rewrites the visibility restored when the plugin is enabled again.
    panel.manager.settings.Plugins[1].enabled = true;
    assert.deepEqual(ids(['visible']), ['enabled', 'disabled', 'core']);
    assert.deepEqual(ids(['hidden']), ['enabled#2', 'disabled#2', 'bpm-group:tools']);
});

test('Ribbon status counts are disjoint and filtering retains group scope and search', () => {
    const panel = statusFixture(), host = new Element();
    panel.mountFilterBar(host);
    assert.deepEqual(buttons(host).map(button => button.children.at(-1).text), [
        '通用_全部_文本 6', 'Ribbon_显示 2', 'Ribbon_隐藏 2', 'Ribbon_插件被禁用 2',
    ]);
    panel.manager.settings.RIBBON_GROUPS = [{ id: 'tools', name: 'Tools', members: ['enabled#2', 'disabled#2'] }];
    panel.groupFilter = 'tools';
    panel.statusFilters = new Set(['hidden']);
    assert.deepEqual(panel.getFilteredRibbonItems().map(item => item.bpmUniqueId), ['enabled#2']);
    panel.statusFilters.add('disabled');
    panel.searchQuery = 'disabled';
    assert.deepEqual(panel.getFilteredRibbonItems().map(item => item.bpmUniqueId), ['disabled#2']);
    panel.groupFilter = '';
    assert.deepEqual(panel.getFilteredRibbonItems().map(item => item.bpmUniqueId), ['disabled']);
    panel.showGroupedItems = true;
    assert.deepEqual(panel.getFilteredRibbonItems().map(item => item.bpmUniqueId), ['disabled', 'disabled#2']);
});

test('Ribbon shared status dropdown keeps search mounted and synchronizes desktop buttons and All', () => {
    const panel = statusFixture(), host = new Element(), page = new Element();
    panel.setExternalFilterBar(true); panel.mountFilterBar(host); panel.display(page, false);
    const input = host.querySelector('.ribbon-search-input');
    const menu = host.querySelector('.ribbon-manager-state-menu');
    const options = menu.querySelector('.manager-multiselect-filter__menu').children.filter(child => child.tag === 'button');
    const selected = () => buttons(host).map(button => button.attributes['aria-pressed']);
    const count = () => menu.querySelector('.manager-multiselect-filter__count').text;
    const choose = index => options[index].listeners.click({ detail: 0 });
    assert.ok(menu); assert.equal(count(), '6');
    choose(1);
    assert.deepEqual(selected(), ['false', 'true', 'false', 'false']); assert.equal(count(), '2');
    assert.deepEqual(panel.getFilteredRibbonItems().map(item => item.bpmUniqueId), ['enabled', 'core']);
    choose(2);
    assert.deepEqual(selected(), ['false', 'true', 'true', 'false']); assert.equal(count(), '4');
    assert.equal(host.querySelector('.ribbon-search-input'), input);
    assert.equal(host.querySelector('.ribbon-manager-state-menu'), menu);
    choose(3);
    assert.deepEqual(selected(), ['true', 'false', 'false', 'false']); assert.equal(count(), '6');
    buttons(host)[3].click();
    assert.equal(options[3].attributes['aria-selected'], 'true'); assert.equal(count(), '2');
    choose(0);
    input.input('visible');
    assert.equal(host.querySelector('.ribbon-search-input'), input);
    assert.deepEqual(panel.getFilteredRibbonItems().map(item => item.bpmUniqueId), ['enabled', 'disabled']);
});

test('compact menu icons follow selection and summary menus keep their entry icon', async () => {
    const built = await build({ entryPoints: ['src/ui/scope-select.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['obsidian'] });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', built.outputFiles[0].text)(() => obsidian, loaded, loaded.exports);
    const { ScopeSelect } = loaded.exports;
    const options = [{ value: 'all', label: 'Total 5', icon: 'layout-grid' }, { value: 'enabled', label: 'Enabled 4', icon: 'circle-check' }];
    const select = ScopeSelect.compact(new Element(), 'Status', 'all', options, () => {}, 'list-filter');
    const icon = select.trigger.querySelector('.manager-scope-select__icon');
    assert.equal(icon.icon, 'layout-grid');
    select.setValue('enabled');assert.equal(icon.icon, 'circle-check');assert.equal(icon.hidden, false);
    assert.equal(select.field.querySelector('.manager-scope-select__option-icon').icon, 'layout-grid');
    const custom = ScopeSelect.compact(new Element(), 'Status', '', options, () => {}, 'list-filter');
    assert.equal(custom.trigger.querySelector('.manager-scope-select__icon').icon, 'list-filter');
    const summary = ScopeSelect.summary(new Element(), 'Statistics', [{ value: '5', label: 'Sources', icon: 'radio-tower' }]);
    assert.equal(summary.trigger.querySelector('.manager-scope-select__icon').icon, 'chart-column');
    assert.equal(summary.field.querySelector('.manager-scope-select__stat').querySelector('.manager-multiselect-filter__check').icon, 'radio-tower');
});

test('Ribbon search keeps the same input mounted for consecutive edits in embedded and standalone panels', () => {
    for (const embedded of [true, false]) {
        const { panel } = fixture(), host = new Element(), page = new Element(), queries = [];
        panel.renderFilteredList = (_root, list) => { list.empty(); queries.push(panel.searchQuery); };
        if (embedded) { panel.setExternalFilterBar(true); panel.mountFilterBar(host); }
        panel.display(page, !embedded);
        const controls = embedded ? host : page;
        const input = controls.querySelector('.ribbon-search-input');
        const list = page.querySelector('.draggable-list-container');
        assert.ok(input); assert.ok(list);
        for (const query of ['s', 'sy', 'sync', '同步', '', 'missing']) {
            input.input(query);
            assert.equal(controls.querySelector('.ribbon-search-input'), input);
            assert.equal(page.querySelector('.draggable-list-container'), list);
            assert.equal(queries.at(-1), query);
        }
        assert.equal(queries.length, 7);
    }
});

test('mobile page changes synchronize identity and filters without rebuilding chrome on same-page refreshes', async () => {
    const built = await build({ entryPoints: ['src/modal/manager-modal.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
        external: ['obsidian', 'electron'], loader: { '.webp': 'dataurl' }, logLevel: 'silent' });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', built.outputFiles[0].text)(name => name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), loaded, loaded.exports);
    const modal = Object.create(loaded.exports.ManagerModal.prototype), header = { dataset: { page: 'plugins' } };
    modal.modalChromeEl = { querySelector: () => header };
    let chromeRenders = 0, renderedPage;
    modal.showHeadMobile = () => { chromeRenders++; header.dataset.page = modal.activePage === 'sources' ? 'install' : modal.activePage; };
    const wasMobile = obsidian.Platform.isMobile; obsidian.Platform.isMobile = true;
    try {
        modal.activePage = 'install'; modal.syncMobilePageChrome(); assert.equal(chromeRenders, 1);
        modal.syncMobilePageChrome(); assert.equal(chromeRenders, 1);
        modal.activePage = 'sources'; modal.syncMobilePageChrome(); assert.equal(chromeRenders, 1);
        modal.activePage = 'plugins'; modal.syncMobilePageChrome(); assert.equal(chromeRenders, 2);
        modal.manager = { devices: { noteActivePage() {} } };
        modal.installToolbarMenus = [];
        modal.modalPageEl = new Element(); modal.ensureAllowedActivePage = () => {};
        modal.getAvailableDesktopPages = () => ['plugins', 'install']; modal.nextRenderGeneration = () => 1;
        modal.clearPluginOverviewLayoutClass = () => {}; modal.showInstallPanel = () => { renderedPage = modal.activePage; };
        modal.syncPageChrome = () => modal.syncMobilePageChrome();
        modal.activePage = 'install'; modal.renderContent();
        assert.equal(renderedPage, 'install'); assert.equal(header.dataset.page, 'install'); assert.equal(chromeRenders, 3);
        modal.renderContent(); assert.equal(chromeRenders, 3);
    } finally { obsidian.Platform.isMobile = wasMobile; }
});

test('global toolbar moves settings into More and shows explicit Save only in manual mode', async () => {
    const built = await build({ entryPoints: ['src/modal/manager-modal.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
        external: ['obsidian', 'electron'], loader: { '.webp': 'dataurl' }, logLevel: 'silent' });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', built.outputFiles[0].text)(name => name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), loaded, loaded.exports);
    const modal = Object.create(loaded.exports.ManagerModal.prototype);
    const host = new Element(), body = new Element(); host.ownerDocument.body = body; body.ownerDocument = host.ownerDocument;
    const actions = [];
    let unsubscribe = 0;
    modal.manager = { manifest: { id: 'bpm' }, settings: { LANGUAGE: 'en', MANUAL_CONFIG_SAVE: true }, hasUnsavedSettings: false, isSavingSettings: false,
        async savePendingSettings() { actions.push('save'); return true; }, translator: { t: key => key }, tasks: {
        subscribe: () => () => { unsubscribe++; }, runningCount: () => 0, snapshots: () => [],
    } };
    modal.bindLongPressTooltip = () => {};
    modal.refreshConfigConflict = () => {};
    modal.action = callback => () => { void callback(); };
    modal.openSettingsTab = id => actions.push(id);
    modal.close = () => actions.push('close');
    modal.renderGlobalTools(host);
    const getTools = () => host.children.filter(child => !child.classes.has('manager-sync-notice'));
    const tools = getTools();
    const notice = host.children.find(child => child.classes.has('manager-sync-notice'));
    assert.equal(notice.classes.has('is-active'), false);
    assert.deepEqual(tools.map(child => child.icon), ['save', 'more-vertical', 'x']);
    assert.ok(tools.every(child => child.classes.has('manager-global-tool')));
    assert.equal(tools[0].disabled, false);
    assert.equal(tools[0].attributes['aria-label'], 'Check and save settings');
    modal.manager.hasUnsavedSettings = true; modal.refreshSettingsSaveState();
    assert.equal(tools[0].classes.has('has-unsaved-settings'), true);
    tools[0].click(); assert.deepEqual(actions, ['save']);
    const more = tools[1]; more.listeners.click({});
    lastMenu.items.find(item => item.title === '管理器_BPM设置_短').click();
    assert.deepEqual(actions, ['save', 'bpm']);
    assert.equal(lastMenu.items.some(item => item.title === 'Save changes'), false);
    assert.equal(more.dataset.bpmFeaturePage, 'settings');
    const contacts = lastMenu.items.find(item => item.title === '管理器_联系方式');
    assert.equal(contacts.submenu.items.length, 3);
    assert.ok(contacts.submenu.items.some(item => item.title === '管理器_GITHUB_描述'));
    assert.equal(lastMenu.items.some(item => item.title === '管理器_GITHUB_描述'), false);
    lastMenu.items.find(item => item.title === '任务_标题').click();
    assert.equal(more.attributes['aria-expanded'], 'true');
    assert.equal(lastMenu.items.some(item => item.title === '通用_关闭窗口'), false);
    modal.manager.settings.MANUAL_CONFIG_SAVE = false;
    modal.refreshSettingsSaveState();
    assert.deepEqual(getTools(), [more, tools[2]]);
    assert.equal(host.children.includes(notice), true);
    more.listeners.click({});
    const fallbackSave = lastMenu.items.find(item => item.title === 'Save changes');
    assert.equal(fallbackSave.disabled, false);
    fallbackSave.click();
    await Promise.resolve();
    assert.deepEqual(actions, ['save', 'bpm', 'save']);
    modal.manager.isSavingSettings = true;
    more.listeners.click({});
    assert.equal(lastMenu.items.find(item => item.title === 'Save changes').disabled, true);
    modal.manager.isSavingSettings = false;
    modal.manager.settings.MANUAL_CONFIG_SAVE = true;
    modal.refreshSettingsSaveState();
    assert.deepEqual(getTools().map(child => child.icon), ['save', 'more-vertical', 'x']);
    assert.equal(getTools()[1], more);
    assert.equal(getTools()[2], tools[2]);
    tools[2].listeners.click({});
    assert.deepEqual(actions, ['save', 'bpm', 'save', 'close']);
    modal.taskCenterView.destroy();
    assert.equal(body.children.length, 0); assert.equal(unsubscribe, 1);
});

test('recent installs lead the status options and support the shared window, multi-select and exclusion', async () => {
    const built = await build({ entryPoints: ['src/modal/manager-modal.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
        external: ['obsidian', 'electron'], loader: { '.webp': 'dataurl' }, logLevel: 'silent' });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', built.outputFiles[0].text)(name => name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), loaded, loaded.exports);
    const modal = Object.create(loaded.exports.ManagerModal.prototype);
    modal.manager = { translator: { t: key => key } };
    modal.settings = { RECENT_INSTALL_DAYS: 7 };
    assert.deepEqual(Object.keys(modal.getStatusFilterOptions()).slice(0, 3), ['recently-installed', 'all', 'enabled']);
    const now = Date.now(), day = 86400000;
    assert.equal(modal.isRecentlyInstalled(now - 7 * day, now), true);
    for (const time of [undefined, NaN, now + 1, now - 7 * day - 1]) assert.equal(modal.isRecentlyInstalled(time, now), false);
    modal.pluginDateMetaById = new Map([['new', { installedAt: now - day }], ['old', { installedAt: now - 30 * day }]]);
    const plugin = { group: '', tags: [], note: '' };
    assert.equal(modal.matchesStatusFilter(plugin, { id: 'new' }, true, ['recently-installed'], 'contains'), true);
    assert.equal(modal.matchesStatusFilter(plugin, { id: 'old' }, true, ['recently-installed'], 'contains'), false);
    assert.equal(modal.matchesStatusFilter(plugin, { id: 'old' }, false, ['recently-installed', 'disabled'], 'contains'), true);
    assert.equal(modal.matchesStatusFilter(plugin, { id: 'new' }, true, ['recently-installed'], 'not-contains'), false);
    modal.settings.RECENT_INSTALL_DAYS = 0;
    assert.equal(modal.isRecentlyInstalled(now - day, now), false);
    const labels = [];
    modal.bindLongPressTooltip = () => {};
    modal.createMultiSelectFilter = (_parent, options, _values, allValue, allLabel) => { labels.push({ options, allValue, allLabel }); return {}; };
    for (const name of ['Status', 'Group', 'Tag']) {
        modal[`get${name}FilterValues`] = () => [];
        modal[`get${name}FilterOperator`] = () => 'contains';
    }
    modal.getGroupFilterOptions = () => [['', 'All groups']];
    modal.getTagFilterOptions = () => [['', 'All tags']];
    modal.renderPluginFilterControls({ status: new Element(), group: new Element(), tag: new Element() }, () => {});
    assert.equal(labels[0].allLabel, '筛选_全部_描述');
    assert.equal(labels[0].options[0][0], 'recently-installed');
});

test('conflict warnings use one notice icon while navigation keeps accessible text without duplicate glyphs', async () => {
    const built = await build({ stdin: { contents: "export { ManagerModal } from './src/modal/manager-modal'; export { SyncNoticeView } from './src/ui/sync-notice-view';", resolveDir: process.cwd() },
        bundle: true, platform: 'node', format: 'cjs', write: false, external: ['obsidian', 'electron'], loader: { '.webp': 'dataurl' }, logLevel: 'silent' });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', built.outputFiles[0].text)(name => name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), loaded, loaded.exports);
    const modal = Object.create(loaded.exports.ManagerModal.prototype), host = new Element();
    modal.manager = { settings: { LANGUAGE: 'en' }, configProtection: { protection: { paused: true } } };
    let differences = new Set(['plugins', 'settings']);
    modal.getConflictFeaturePages = () => differences;
    modal.getPageNavigationItems = () => [{ page: 'plugins', label: 'Plugins' }, { page: 'ribbon', label: 'Ribbon' }];
    const pluginTab = host.createEl('button'), ribbonTab = host.createEl('button'), compact = host.createEl('button'), mobile = host.createEl('button'), more = host.createEl('button');
    pluginTab.dataset.page = 'plugins'; ribbonTab.dataset.page = 'ribbon';
    pluginTab.setAttribute('title', 'Plugins'); pluginTab.setAttribute('aria-label', 'Open plugins');
    pluginTab.createSpan().icon = 'list'; ribbonTab.createSpan().icon = 'list';
    compact.createSpan().icon = 'list'; mobile.createSpan().icon = 'list'; more.createSpan().icon = 'more-vertical';
    const controls = [pluginTab, ribbonTab, compact, mobile, more], children = controls.map(control => [...control.children]);
    const labels = new Map();
    modal.pageTabBar = { trigger: compact, setOptionLabel: (page, label) => labels.set(page, label) };
    modal.modalEl = { querySelectorAll: selector => selector.startsWith('.manager-toolbar__tab') ? [pluginTab, ribbonTab]
        : selector === '.manager-mobile-page-switch' ? [mobile] : [more] };
    modal.syncConflictNavigation(); modal.syncConflictNavigation();
    assert.equal(labels.get('plugins'), 'Plugins · Differences'); assert.equal(labels.get('ribbon'), 'Ribbon');
    assert.equal(pluginTab.attributes.title, 'Plugins · This feature has different settings');
    assert.equal(pluginTab.attributes['aria-label'], 'Open plugins · This feature has different settings');
    assert.ok(controls.every((control, index) => control.children.length === children[index].length
        && control.children.every((child, childIndex) => child === children[index][childIndex])));
    const notice = new loaded.exports.SyncNoticeView(modal.manager, host, () => {});
    const all = element => element.children.flatMap(child => [child, ...all(child)]);
    assert.equal(all(host).filter(element => element.icon === 'triangle-alert').length, 1);
    assert.equal(all(host).some(element => element.classes.has('bpm-feature-difference')), false);
    differences = new Set(); modal.syncConflictNavigation();
    assert.equal(labels.get('plugins'), 'Plugins');
    assert.equal(pluginTab.attributes.title, 'Plugins'); assert.equal(pluginTab.attributes['aria-label'], 'Open plugins');
    modal.manager.configProtection.protection.paused = false; notice.refresh();
    assert.equal(all(host).filter(element => element.icon === 'triangle-alert').length, 0);
    notice.destroy();
});
