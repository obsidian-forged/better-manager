import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const nativeRequire = createRequire(import.meta.url);
class Base {}
class El {
    constructor() { this.children = []; this.attrs = {}; this.text = ''; this.cls = ''; this.removed = 0; }
    empty() { this.children = []; }
    createEl(tag, options = {}) { return this.#child(options); }
    createDiv(options) { return this.#child(options); }
    #child(options = {}) {
        const element = new El();
        if (typeof options === 'string') element.cls = options;
        else { element.cls = options.cls || ''; element.text = options.text || ''; }
        this.children.push(element);
        return element;
    }
    setText(text) { this.text = text; }
    setAttribute(name, value) { this.attrs[name] = value; }
    addClass(cls) { this.cls += ` ${cls}`; }
    remove() { this.removed++; }
}
class ItemView extends Base {
    constructor(leaf) { super(); this.leaf = leaf; this.contentEl = new El(); }
}
class ButtonComponent extends Base {
    constructor(container) { super(); this.container = container; this.buttonEl = new El(); }
    setButtonText(text) { this.text = text; return this; }
    setTooltip(tooltip) { this.tooltip = tooltip; return this; }
    onClick(callback) { this.callback = callback; return this; }
}
class MenuItem {
    setTitle(title) { this.title = title; return this; }
    setIcon(icon) { this.icon = icon; return this; }
    setSection(section) { this.section = section; return this; }
    setIsLabel(label) { this.label = label; return this; }
    onClick(callback) { this.callback = callback; return this; }
}
class Menu {
    constructor() { this.items = []; }
    addItem(callback) { const item = new MenuItem(); callback(item); this.items.push(item); return item; }
}
const notices = [];
class Notice extends Base { constructor(message) { super(); notices.push(message); } }
const obsidian = {
    ItemView, ButtonComponent, Menu, Notice, Platform: { isMobileApp: false },
    Modal: Base, Setting: Base, DropdownComponent: Base, ToggleComponent: Base,
    normalizePath: path => path.replaceAll('\\', '/'),
};

async function load() {
    const result = await build({ entryPoints: ['src/on-demand/runtime.ts'], bundle: true, platform: 'node', format: 'cjs',
        write: false, external: ['obsidian'], logLevel: 'silent' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(name =>
        name === 'obsidian' ? obsidian : nativeRequire(name), module, module.exports);
    return module.exports;
}
const { OnDemandRuntime, ON_DEMAND_VIEW } = await load();
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0)); };

function fixture({ vaultName = 'Vault A', local = new Map(), sharedDisk, basePath = `/vaults/${vaultName}` } = {}) {
    const disk = sharedDisk ?? new Map(), state = {
        loads: [], executes: [], saves: 0, disableSaves: 0, disableNow: 0, errors: [], ribbons: [], commands: [], viewStates: [], detached: 0,
        intervals: new Map(), nextInterval: 0, fileMenus: [], editorMenus: [], views: {},
    };
    const commands = {};
    const registry = {
        commands,
        addCommand(command) { commands[command.id] = command; return command; },
        removeCommand(id) { delete commands[id]; },
        executeCommandById(id) { state.executes.push(id); return true; },
    };
    const manifests = {
        lazy: { id: 'lazy', name: 'Lazy', description: '', version: '1.0.0' },
        other: { id: 'other', name: 'Other', description: '', version: '2.0.0' },
    };
    const plugins = {};
    const enabledPlugins = new Set();
    const install = id => {
        plugins[id] = { _loaded: true };
        enabledPlugins.add(id);
        commands[`${id}:run`] = { id: `${id}:run`, name: 'Run', callback() { state.executes.push(id); } };
    };
    const uninstall = id => {
        delete plugins[id];
        enabledPlugins.delete(id);
        for (const commandId of Object.keys(commands)) if (commandId.startsWith(`${id}:`)) delete commands[commandId];
    };
    const settings = {
        Plugins: [
            { id: 'lazy', name: 'Lazy', desc: '', enabled: true, delay: '', group: '', tags: [], note: '' },
            { id: 'other', name: 'Other', desc: '', enabled: true, delay: '', group: '', tags: [], note: '' },
        ],
        DELAY: false, LANGUAGE: 'en', FEATURES: {}, DEBUG: false,
        ON_DEMAND: { plugins: [], ribbon: true, views: true, menus: true },
    };
    const adapter = {
        getBasePath: () => basePath,
        async exists(path) { return disk.has(path); },
        async read(path) { return disk.get(path); },
        async write(path, text) { disk.set(path, text); },
        async mkdir() {},
    };
    const leaves = [];
    const makeLeaf = () => {
        const leaf = {
            view: undefined,
            async setViewState(viewState) {
                state.viewStates.push(viewState);
                if (viewState.type === ON_DEMAND_VIEW && state.views[ON_DEMAND_VIEW]) leaf.view = state.views[ON_DEMAND_VIEW](leaf);
            },
            detach() { state.detached++; const index = leaves.indexOf(leaf); if (index >= 0) leaves.splice(index, 1); },
        };
        leaves.push(leaf);
        return leaf;
    };
    const workspace = {
        layoutReady: true,
        on(name, callback) { (name === 'file-menu' ? state.fileMenus : state.editorMenus).push(callback); return { name }; },
        onLayoutReady(callback) { callback(); },
        getLeavesOfType(type) { return leaves.filter(leaf => leaf.view?.getViewType() === type); },
        getRightLeaf() { return makeLeaf(); },
        leftRibbon: { items: [], onChange() {} },
    };
    const localState = local;
    const app = {
        workspace,
        vault: { getName: () => vaultName, configDir: '.obsidian', adapter },
        loadLocalStorage(key) { return localState.get(key) ?? null; },
        saveLocalStorage(key, value) { localState.set(key, value); },
        commands: registry,
    };
    const manager = {
        app, appPlugins: { manifests, plugins, enabledPlugins, commands: registry,
            async enablePlugin(id) { state.loads.push(id); install(id); return true; },
            async disablePlugin(id) { state.disableNow++; uninstall(id); },
            async enablePluginAndSave(id) { state.saves++; install(id); },
            async disablePluginAndSave(id) { state.disableSaves++; state.saves++; uninstall(id); },
        },
        settings, manifest: { id: 'self' },
        devices: { isProjectingForeign: () => false },
        overview: { mode: () => 'persistent' },
        registerView(type, creator) { state.views[type] = creator; },
        registerEvent(event) { state.commands.push(event); },
        addCommand(command) { state.commands.push(command); },
        addRibbonIcon(icon, title, callback) {
            const element = new El();
            element.icon = icon; element.title = title; element.callback = callback;
            state.ribbons.push(element);
            return element;
        },
        reportError(context, error) { state.errors.push([context, error]); },
        async saveSettings() { state.settingsSaves = (state.settingsSaves || 0) + 1; },
        async savePendingSettings() { state.settingsSaves = (state.settingsSaves || 0) + 1; },
    };
    const runtime = new OnDemandRuntime(manager);
    return { runtime, manager, state, disk, registry, manifests, plugins, enabledPlugins, settings, leaves, local, install };
}

const originalWindow = globalThis.window;
function withWindow() {
    globalThis.window = {
        setTimeout: (callback, delay = 0) => setTimeout(callback, delay),
        clearTimeout,
        setInterval: callback => { fixtureWindow.intervals.set(++fixtureWindow.count, callback); return fixtureWindow.count; },
        clearInterval: handle => { fixtureWindow.intervals.delete(handle); },
    };
}
const fixtureWindow = { intervals: new Map(), count: 0 };
withWindow();
after(() => { globalThis.window = originalWindow; });

async function initialized(options) {
    const f = fixture(options);
    await f.runtime.initialize();
    return f;
}

test('first on-demand choice loads once, remembers commands, removes the startup entry and sleeps', async () => {
    const f = await initialized();
    f.enabledPlugins.add('lazy');
    await f.runtime.configure('lazy', true);
    assert.deepEqual(f.state.loads, ['lazy']);
    assert.equal(f.enabledPlugins.has('lazy'), false);
    assert.equal(f.runtime.configured('lazy'), true);
    assert.deepEqual(f.runtime.sleeping().map(entry => entry.id), ['lazy']);
    assert.equal(f.registry.commands['lazy:run'].name, 'Run');
    assert.equal(f.state.ribbons.length, 1);
    await flush();
    await f.registry.commands['lazy:run'].callback();
    await flush();
    assert.equal(f.plugins.lazy !== undefined, true);
    assert.deepEqual(f.state.executes, ['lazy:run']);
    assert.equal(f.state.ribbons.length, 1);
    f.runtime.dispose();
});

test('a cached sleeping plugin arms without loading and is dropped from the native startup list', async () => {
    const first = await initialized();
    first.enabledPlugins.add('lazy');
    await first.runtime.configure('lazy', true);
    first.runtime.dispose();

    const second = new OnDemandRuntime(first.manager);
    await second.initialize();
    first.enabledPlugins.add('lazy');
    const before = first.state.loads.length;
    await second.apply('lazy', true);
    assert.equal(first.state.loads.length, before);
    assert.equal(first.enabledPlugins.has('lazy'), false);
    assert.equal(first.registry.commands['lazy:run'].name, 'Run');
    second.dispose();
});

test('disabling the preset disarms placeholders; enabling again arms without loading', async () => {
    const f = await initialized();
    f.enabledPlugins.add('lazy');
    await f.runtime.configure('lazy', true);
    assert.ok(f.registry.commands['lazy:run']);
    await f.runtime.apply('lazy', false);
    assert.equal(f.registry.commands['lazy:run'], undefined);
    const loads = f.state.loads.length;
    await f.runtime.apply('lazy', true);
    assert.equal(f.state.loads.length, loads);
    assert.ok(f.registry.commands['lazy:run']);
    f.runtime.dispose();
});

test('load now runs the plugin and keeps it running for the session', async () => {
    const f = await initialized();
    f.enabledPlugins.add('lazy');
    await f.runtime.configure('lazy', true);
    const loads = f.state.loads.length;
    await f.runtime.loadNow('lazy');
    assert.equal(f.state.loads.length, loads + 1);
    assert.ok(f.plugins.lazy);
    assert.deepEqual(f.runtime.sleeping(), []);
    assert.equal(f.state.ribbons.length, 1); // ribbon removed from the DOM, element stays in the fixture list
    assert.equal(f.state.ribbons[0].removed, 1);
    f.runtime.dispose();
});

test('surface options persist in configuration and control ribbon and menus', async () => {
    const f = await initialized();
    f.enabledPlugins.add('lazy');
    await f.runtime.configure('lazy', true);
    const menu = new Menu();
    f.state.fileMenus[0](menu);
    assert.equal(menu.items.length, 1);
    assert.match(menu.items[0].title, /Lazy/);

    await f.runtime.setOptions({ ribbon: false, menus: false });
    assert.equal(f.state.ribbons[0].removed, 1);
    assert.equal(f.runtime.ribbon.size, 0);
    assert.equal(f.state.ribbons.length, 1);
    const hidden = new Menu();
    f.state.fileMenus[0](hidden);
    assert.equal(hidden.items.length, 0);

    const second = new OnDemandRuntime(f.manager);
    await second.initialize();
    assert.deepEqual(second.options(), { ribbon: false, views: true, menus: false });
    second.dispose();
    f.runtime.dispose();
});

test('the panel lists sleeping plugins and opens through the registered view', async () => {
    const f = await initialized();
    f.enabledPlugins.add('lazy');
    await f.runtime.configure('lazy', true);
    assert.equal(f.state.viewStates[0].type, ON_DEMAND_VIEW);
    const leaf = f.leaves.find(item => item.view);
    assert.ok(leaf);
    const content = leaf.view.contentEl;
    assert.equal(content.children.filter(child => child.cls === 'setting-item').length, 1);
    assert.match(content.children[0].children[0].children[0].text, /Lazy/);
    f.runtime.dispose();
});

test('modes live in shared settings and dispose removes owned runtime state', async () => {
    const f = await initialized();
    f.enabledPlugins.add('lazy');
    await f.runtime.configure('lazy', true);
    assert.deepEqual(f.settings.ON_DEMAND.plugins, ['lazy']);
    const restarted = new OnDemandRuntime(f.manager);
    await restarted.initialize();
    assert.equal(restarted.configured('lazy'), true);
    restarted.dispose();

    f.runtime.dispose();
    assert.equal(f.registry.commands['lazy:run'], undefined);
    assert.equal(f.state.ribbons[0].removed, 1);
    assert.equal(f.state.detached, 1);
    assert.equal(fixtureWindow.intervals.size, 0);
});

test('a session preview unloads without rewriting the native startup list', async () => {
    const f = await initialized();
    f.enabledPlugins.add('lazy');
    await f.runtime.configure('lazy', true);
    f.plugins.lazy = { _loaded: true };
    f.enabledPlugins.add('lazy');
    const saves = f.state.disableSaves;
    f.manager.overview.mode = () => 'session';
    await f.runtime.apply('lazy', false);
    assert.equal(f.state.disableSaves, saves);
    assert.ok(f.state.disableNow >= 1);
    assert.equal(f.enabledPlugins.has('lazy'), false);
    f.runtime.dispose();
});

test('configuration changes from another device disarm and re-arm placeholders', async () => {
    const f = await initialized();
    f.enabledPlugins.add('lazy');
    await f.runtime.configure('lazy', true);
    assert.ok(f.registry.commands['lazy:run']);
    f.settings.ON_DEMAND.plugins = [];
    const poll = [...fixtureWindow.intervals.values()].at(-1);
    poll();
    await flush();
    assert.equal(f.registry.commands['lazy:run'], undefined);
    assert.deepEqual(f.runtime.sleeping(), []);
    f.settings.ON_DEMAND.plugins = ['lazy'];
    poll();
    await flush();
    assert.equal(f.registry.commands['lazy:run'].name, 'Run');
    f.runtime.dispose();
});

test('a plugin disabled outside the manager is re-armed on the next poll and a running one is disarmed', async () => {
    const f = await initialized();
    f.enabledPlugins.add('lazy');
    await f.runtime.configure('lazy', true);
    f.plugins.lazy = { _loaded: true };
    f.registry.commands['lazy:run'] = { id: 'lazy:run', name: 'Real', callback() {} };
    const poll = [...fixtureWindow.intervals.values()].at(-1);
    poll();
    await flush();
    assert.equal(f.state.ribbons[0].removed, 1);
    delete f.plugins.lazy;
    delete f.registry.commands['lazy:run'];
    poll();
    await flush();
    assert.equal(f.registry.commands['lazy:run'].name, 'Run');
    f.runtime.dispose();
});

test('a stale command cache drops old placeholders instead of exposing removed commands', async () => {
    const f = await initialized();
    f.enabledPlugins.add('lazy');
    await f.runtime.configure('lazy', true);
    assert.ok(f.registry.commands['lazy:run']);
    f.manifests.lazy.version = '2.0.0';
    const poll = [...fixtureWindow.intervals.values()].at(-1);
    poll();
    await flush();
    assert.equal(f.registry.commands['lazy:run'], undefined);
    assert.equal(f.runtime.sleeping().length, 1);
    f.runtime.dispose();
});

test('concurrent load requests run onload once', async () => {
    const f = await initialized();
    f.enabledPlugins.add('lazy');
    await f.runtime.configure('lazy', true);
    const load = f.manager.appPlugins.enablePlugin;
    let release;
    f.manager.appPlugins.enablePlugin = async id => {
        await new Promise(resolve => { release = resolve; });
        return load(id);
    };
    const before = f.state.loads.length;
    const first = f.runtime.loadNow('lazy');
    const second = f.runtime.loadNow('lazy');
    await flush();
    release();
    await Promise.all([first, second]);
    assert.equal(f.state.loads.length, before + 1);
    assert.ok(f.plugins.lazy);
    f.runtime.dispose();
});

test('a mode added by configuration sync sleeps an already running plugin', async () => {
    const f = await initialized();
    f.install('lazy');
    f.settings.ON_DEMAND.plugins = ['lazy'];
    assert.ok(f.plugins.lazy);
    const poll = [...fixtureWindow.intervals.values()].at(-1);
    poll();
    await flush();
    await flush();
    assert.equal(f.plugins.lazy, undefined);
    assert.equal(f.enabledPlugins.has('lazy'), false);
    assert.equal(f.runtime.sleeping().length, 1);
    f.runtime.dispose();
});

test('desktop-only plugins never load through on-demand on mobile', async () => {
    const f = await initialized();
    f.manifests.lazy.isDesktopOnly = true;
    f.settings.Plugins[0].enabled = true;
    obsidian.Platform.isMobileApp = true;
    try {
        await f.runtime.configure('lazy', true);
        await f.runtime.apply('lazy', true);
        assert.deepEqual(f.state.loads, []);
        assert.equal(f.state.ribbons.length, 0);
        assert.deepEqual(f.runtime.sleeping(), []);
    } finally {
        obsidian.Platform.isMobileApp = false;
        f.runtime.dispose();
    }
});

test('an ignored plugin stays outside on-demand loading', async () => {
    const f = await initialized();
    f.settings.Plugins[0].tags = ['bpm-ignore'];
    await f.runtime.configure('lazy', true);
    await f.runtime.apply('lazy', true);
    f.install('lazy');
    await f.runtime.apply('lazy', false);
    assert.ok(f.plugins.lazy);
    assert.deepEqual(f.state.loads, []);
    assert.equal(f.state.ribbons.length, 0);
    assert.deepEqual(f.runtime.sleeping(), []);
    f.runtime.dispose();
});

test('malformed ON_DEMAND values fall back to safe defaults', async () => {
    const f = fixture();
    f.settings.ON_DEMAND = null;
    const runtime = new OnDemandRuntime(f.manager);
    await runtime.initialize();
    assert.deepEqual(runtime.options(), { ribbon: true, views: true, menus: true });
    assert.equal(runtime.configured('lazy'), false);
    f.settings.ON_DEMAND = { plugins: ['lazy', 'lazy', 4, 'self'], ribbon: false };
    assert.equal(runtime.configured('lazy'), true);
    assert.deepEqual(runtime.options(), { ribbon: false, views: true, menus: true });
    runtime.dispose();
});

test('a plugin without commands still sleeps and can be loaded by its entry point', async () => {
    const f = await initialized();
    f.enabledPlugins.add('other');
    const load = f.manager.appPlugins.enablePlugin;
    f.manager.appPlugins.enablePlugin = async id => {
        f.state.loads.push(id);
        f.plugins[id] = { _loaded: true };
        f.enabledPlugins.add(id);
        return true;
    };
    try {
        await f.runtime.configure('other', true);
        assert.equal(f.runtime.sleeping().map(entry => entry.id).includes('other'), true);
        assert.equal(f.state.ribbons.length, 1);
        await f.runtime.loadNow('other');
        assert.ok(f.plugins.other);
    } finally {
        f.manager.appPlugins.enablePlugin = load;
        f.runtime.dispose();
    }
});

test('a failed settings save keeps the choice in memory and reports without rejecting', async () => {
    const f = await initialized();
    f.enabledPlugins.add('lazy');
    f.manager.savePendingSettings = async () => { throw new Error('save denied'); };
    await f.runtime.configure('lazy', true);
    assert.equal(f.runtime.configured('lazy'), true);
    assert.ok(f.state.errors.some(([context]) => context.includes('On-demand')));
    f.runtime.dispose();
});

test('disposing during a load neither throws nor revives polling', async () => {
    const f = await initialized();
    f.enabledPlugins.add('lazy');
    await f.runtime.configure('lazy', true);
    const load = f.manager.appPlugins.enablePlugin;
    let release;
    f.manager.appPlugins.enablePlugin = async id => {
        await new Promise(resolve => { release = resolve; });
        return load(id);
    };
    const pending = f.runtime.loadNow('lazy');
    await flush();
    assert.equal(typeof release, 'function');
    f.runtime.dispose();
    release();
    await pending;
    assert.equal(f.state.errors.length, 0);
    assert.equal(fixtureWindow.intervals.size, 0);
});

test('disabling while a load is in flight leaves the plugin unloaded', async () => {
    const f = await initialized();
    f.enabledPlugins.add('lazy');
    await f.runtime.configure('lazy', true);
    const load = f.manager.appPlugins.enablePlugin;
    let release;
    f.manager.appPlugins.enablePlugin = async id => {
        await new Promise(resolve => { release = resolve; });
        return load(id);
    };
    const pending = f.runtime.loadNow('lazy');
    await flush();
    await f.runtime.apply('lazy', false);
    release();
    await pending;
    await flush();
    assert.equal(f.plugins.lazy, undefined);
    f.runtime.dispose();
});
