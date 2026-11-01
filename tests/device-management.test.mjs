import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// 无浏览器、无个人库副作用；Exercise production modules with a native API test double.
const nativeRequire = createRequire(import.meta.url);
const platform = { isMobileApp: false, isTablet: false };
const notices = [];
class NativeBase {}
const obsidian = { Platform: platform, Plugin: NativeBase, Modal: NativeBase, SuggestModal: NativeBase, PluginSettingTab: NativeBase,
    Notice: class { constructor(message) { notices.push(message); } } };
async function load(entry) {
    const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs',
        write: false, external: ['obsidian', 'electron'], loader: { '.webp': 'dataurl' }, logLevel: 'silent' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'crypto', result.outputFiles[0].text)(name => {
        if (name === 'obsidian') return obsidian;
        if (name === 'electron') return {};
        return nativeRequire(name);
    }, module, module.exports, { randomUUID });
    return module.exports;
}
const model = await load('src/devices/device-presets.ts');
const { DeviceManager } = await load('src/devices/device-manager.ts');
const { default: Manager } = await load('src/main.ts');
const { DEFAULT_SETTINGS } = await load('src/settings/data.ts');
const record = (id, enabled, tags = []) => ({ id, name: id, desc: '', group: '', tags, enabled, delay: '', note: '' });
const ribbon = { bpmUniqueId: 'a', name: 'A', icon: 'star', visible: true, order: 0, ribbonIdMap: { en: 'a' } };
const firstOf = (settings, type) => settings.DEVICE_MANAGEMENT.presets[type][0];
const keyOf = (settings, type) => `preset:${firstOf(settings, type).id}`;
const DEVICES_DIR = '.obsidian/better-plugins-manager-device-';
/** 最小 DataAdapter：设备记录按文件夹里的 JSON 文件同步 / In-memory adapter for device files. */
function memoryAdapter(files = {}) {
    return {
        files,
        async exists(path) { return Object.prototype.hasOwnProperty.call(files, path); },
        async mkdir() {},
        async list(dir) { return { files: Object.keys(files).filter(path => path.startsWith(`${dir}/`)), folders: [] }; },
        async read(path) { if (!(path in files)) throw new Error('ENOENT'); return files[path]; },
        async write(path, data) { files[path] = data; },
        async remove(path) { delete files[path]; },
    };
}
async function fixture(options = {}) {
    platform.isMobileApp = false;
    platform.isTablet = false;
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.Plugins = [record('self', true), record('a', true), record('b', false), record('ignored', true, ['bpm-ignore'])];
    settings.RIBBON_SETTINGS = [structuredClone(ribbon)];
    const calls = [];
    let local;
    const manager = new Manager();
    manager.settings = settings;
    manager.manifest = { id: 'self' };
    manager.translator = { t: (key, vars) => `${key}${vars?.names || ''}` };
    manager.app = { loadLocalStorage: () => local, saveLocalStorage: (_key, value) => { local = value; } };
    if (options.adapter) manager.app.vault = { configDir: '.obsidian', adapter: options.adapter };
    manager.appPlugins = {
        manifests: Object.fromEntries(settings.Plugins.map(plugin => [plugin.id, { id: plugin.id, name: plugin.name }])),
        enabledPlugins: new Set(['self', 'a', 'ignored']),
        plugins: { self: {}, a: {}, ignored: {} },
        async enablePlugin(id) { calls.push(['runtime-enable', id]); this.plugins[id] = {}; },
        async disablePlugin(id) { calls.push(['runtime-disable', id]); delete this.plugins[id]; },
        async enablePluginAndSave(id) { calls.push(['enable', id]); this.enabledPlugins.add(id); this.plugins[id] = {}; },
        async disablePluginAndSave(id) { calls.push(['disable', id]); this.enabledPlugins.delete(id); delete this.plugins[id]; },
    };
    manager.saveData = async () => { calls.push(['save']); };
    manager.refreshRibbonManagerFeature = async () => { calls.push(['ribbon']); };
    manager.devices = new DeviceManager(manager);
    await manager.devices.initialize();
    return { manager, settings, calls, getLocal: () => local, setLocal: (value) => { local = value; } };
}

test('three types migrate into at least one independent named preset each', async () => {
    const { settings } = await fixture();
    const data = settings.DEVICE_MANAGEMENT;
    assert.equal(data.enabled, false);
    assert.deepEqual(Object.keys(data.presets), ['computer', 'tablet', 'phone']);
    for (const type of ['computer', 'tablet', 'phone']) {
        assert.equal(data.presets[type].length, 1);
        assert.ok(data.presets[type][0].id);
        assert.ok(data.presets[type][0].name);
    }
    firstOf(settings, 'tablet').plugins.a.enabled = false;
    firstOf(settings, 'tablet').ribbon[0].ribbonIdMap.en = 'changed';
    assert.equal(firstOf(settings, 'computer').plugins.a.enabled, true);
    assert.equal(settings.RIBBON_SETTINGS[0].ribbonIdMap.en, 'a');
    assert.equal(firstOf(settings, 'phone').ribbon[0].ribbonIdMap.en, 'a');
});

test('default presets survive normalization and control missing bindings without changing explicit bindings', async () => {
    const { manager, settings, setLocal, getLocal } = await fixture();
    const original = manager.devices.boundPresetId;
    const next = await manager.devices.createPreset('computer');
    await manager.devices.setDefaultPreset(next);
    assert.equal(manager.devices.boundPresetId, original);
    let restarted = new DeviceManager(manager);
    await restarted.initialize();
    assert.equal(restarted.boundPresetId, original);
    setLocal({ ...getLocal(), presetId: 'missing' });
    restarted = new DeviceManager(manager);
    await restarted.initialize();
    assert.equal(restarted.boundPresetId, next);
    assert.equal(settings.DEVICE_MANAGEMENT.defaultPresets.computer, next);
    await manager.devices.deletePreset(next);
    assert.equal(settings.DEVICE_MANAGEMENT.defaultPresets.computer, original);
});

test('session plugin state changes runtime without leaking into either native autostart or BPM saves', async () => {
    const { manager, settings, calls } = await fixture();
    await manager.devices.setEnabled(true);
    manager.overview.setMode('plugins', 'session');
    await manager.overview.setPluginState('a', { enabled: false, delay: 'later' });
    assert.equal(manager.appPlugins.enabledPlugins.has('a'), true);
    assert.equal(Boolean(manager.appPlugins.plugins.a), false);
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'a').enabled, false);
    assert.ok(calls.some(call => call[0] === 'runtime-disable'));
    await manager.saveSettings();
    const saved = manager.devices.persistedSettings();
    assert.equal(saved.Plugins.find(plugin => plugin.id === 'a').enabled, true);
    assert.equal(saved.Plugins.find(plugin => plugin.id === 'a').delay, '');
    assert.equal(firstOf(settings, 'computer').plugins.a.enabled, true);
    assert.equal(firstOf(settings, 'computer').plugins.a.delay, '');
    manager.overview.setMode('plugins', 'persistent');
    await manager.overview.setPluginState('a', { enabled: false });
    assert.equal(manager.devices.persistedSettings().Plugins.find(plugin => plugin.id === 'a').enabled, false);
    assert.equal(manager.appPlugins.enabledPlugins.has('a'), false);
});

test('foreign session changes survive scope switches but never change persisted presets or local runtime', async () => {
    const { manager, settings, calls } = await fixture();
    await manager.devices.setEnabled(true);
    await manager.devices.selectScope('plugins', keyOf(settings, 'phone'));
    const before = calls.filter(call => call[0] === 'runtime-disable').length;
    manager.overview.setMode('plugins', 'session');
    await manager.overview.setPluginState('a', { enabled: false });
    await manager.devices.closeProjection();
    assert.equal(firstOf(settings, 'phone').plugins.a.enabled, true);
    assert.equal(calls.filter(call => call[0] === 'runtime-disable').length, before);
    await manager.devices.selectScope('plugins', keyOf(settings, 'phone'));
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'a').enabled, false);
    await manager.saveSettings();
    assert.equal(firstOf(settings, 'phone').plugins.a.enabled, true);
});

test('failed native session operations keep state and baseline unchanged', async () => {
    const { manager, settings } = await fixture();
    manager.overview.setMode('plugins', 'session');
    manager.appPlugins.disablePlugin = async () => { throw new Error('native failure'); };
    await assert.rejects(manager.overview.setPluginState('a', { enabled: false }), /native failure/);
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'a').enabled, true);
    assert.equal(manager.overview.pluginState('a'), undefined);
});

test('session appearance uses native loaders and excludes unrelated session snippets from permanent saves', async () => {
    const { manager, settings } = await fixture();
    const writes = [];
    const css = { theme: 'Original', enabledSnippets: new Set(['base']),
        async loadTheme() {}, async loadSnippets() {},
        setTheme(theme) { this.theme = theme; writes.push(['theme', theme]); },
        setCssEnabledStatus(id, enabled) { if (enabled) this.enabledSnippets.add(id); else this.enabledSnippets.delete(id); writes.push(['snippets', [...this.enabledSnippets].sort()]); },
    };
    manager.app.customCss = css;
    await manager.devices.setEnabled(true);
    css.theme = 'Original'; css.enabledSnippets = new Set(['base']);
    writes.length = 0;
    manager.overview.setMode('themes', 'session');
    await manager.devices.writeAppearance('themes', { theme: 'Temporary', snippets: { temporary: true } });
    assert.equal(css.theme, 'Temporary');
    assert.equal(css.enabledSnippets.has('temporary'), true);
    assert.equal(writes.length, 0);
    await manager.saveSettings();
    assert.equal(firstOf(settings, 'computer').appearance.theme, 'Original');
    assert.equal(firstOf(settings, 'computer').appearance.snippets.temporary, undefined);
    manager.overview.setMode('themes', 'persistent');
    await manager.devices.writeAppearance('themes', { snippets: { saved: true } });
    assert.deepEqual(writes, [['snippets', ['base', 'saved']]]);
    assert.equal(css.enabledSnippets.has('temporary'), true);
    assert.equal(firstOf(settings, 'computer').appearance.snippets.saved, true);
    assert.equal(firstOf(settings, 'computer').appearance.theme, 'Original');
});

test('ribbon groups remain independent when device presets are copied and applied', async () => {
    const { manager, settings } = await fixture();
    settings.RIBBON_GROUPS = [{ id: 'mobile', name: 'Mobile', icon: 'smartphone', members: ['a'] }];
    manager.devices.capture();
    const computer = firstOf(settings, 'computer');
    computer.ribbonGroups = structuredClone(settings.RIBBON_GROUPS);
    const phone = firstOf(settings, 'phone');
    phone.ribbonGroups = [{ id: 'phone', name: 'Phone', icon: 'tablet', members: [] }];
    model.applyPresetToSettings(phone, settings, 'self');
    assert.equal(settings.RIBBON_GROUPS[0].id, 'phone');
    settings.RIBBON_GROUPS[0].name = 'Edited';
    assert.equal(computer.ribbonGroups[0].name, 'Mobile');
    assert.equal(phone.ribbonGroups[0].name, 'Phone');
});

test('legacy single-preset data is wrapped into arrays without changing settings', async () => {
    const { settings } = await fixture();
    const legacy = {
        enabled: false,
        presets: {
            computer: { plugins: { a: { enabled: false, delay: 'later' } }, ribbon: [ribbon], ribbonEnabled: true, appearance: { theme: 't', snippets: {} } },
            tablet: {}, phone: {},
        },
        devices: [],
    };
    const normalized = model.normalizeDeviceManagement(legacy, model.snapshotPreset(settings));
    assert.equal(normalized.presets.computer.length, 1);
    assert.equal(normalized.presets.computer[0].plugins.a.enabled, false);
    assert.equal(normalized.presets.computer[0].appearance.theme, 't');
    assert.equal(normalized.presets.tablet.length, 1);
});

test('platform fallback distinguishes tablets, phones and desktop independently of device IDs', async () => {
    assert.equal(model.detectDeviceType({ isMobileApp: false, isTablet: false }), 'computer');
    assert.equal(model.detectDeviceType({ isMobileApp: true, isTablet: true }), 'tablet');
    assert.equal(model.detectDeviceType({ isMobileApp: true, isTablet: false }), 'phone');
});

test('synced unknown data cannot introduce extra types or invalid ribbon entries', async () => {
    const { settings } = await fixture();
    const normalized = model.normalizeDeviceManagement({ enabled: 'yes', presets: {
        car: {}, phone: { plugins: { x: { enabled: 'yes' } }, ribbon: [null, {}, ribbon, ribbon, { ...ribbon, order: Infinity }] },
    }, devices: [null, { id: '1', name: 'A', type: 'car' }, { id: '2', name: 'B', type: 'phone' }] }, model.snapshotPreset(settings));
    assert.equal(normalized.enabled, false);
    assert.equal(Object.keys(normalized.presets).length, 3);
    assert.equal(normalized.presets.phone[0].plugins.x, undefined);
    assert.equal(normalized.presets.phone[0].ribbon.length, 1);
    assert.equal(normalized.devices.length, 1);
});

test('saving a remote preset never changes this device and keeps remote-only plugin choices', async () => {
    const { manager, settings, calls } = await fixture();
    settings.DEVICE_MANAGEMENT.enabled = true;
    const phone = model.clonePreset(firstOf(settings, 'phone'));
    phone.plugins.a.enabled = false;
    phone.plugins.remote = { enabled: true, delay: 'later' };
    phone.ribbon[0].visible = false;
    await manager.devices.savePresetById(phone.id, phone);
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'a').enabled, true);
    assert.equal(settings.RIBBON_SETTINGS[0].visible, true);
    assert.equal(calls.some(([action]) => action === 'disable'), false);
    await manager.saveSettings();
    assert.equal(firstOf(settings, 'phone').plugins.remote.enabled, true);
    assert.equal(firstOf(settings, 'phone').ribbon[0].visible, false);
});

test('current preset reconciles runtime state, protects self/ignored plugins and updates Ribbon', async () => {
    const { manager, settings, calls } = await fixture();
    const current = firstOf(settings, 'computer');
    current.plugins.self.enabled = false;
    current.plugins.ignored.enabled = false;
    current.plugins.a.enabled = false;
    current.plugins.b.enabled = true;
    current.ribbon[0].visible = false;
    await manager.devices.setEnabled(true);
    assert.deepEqual(calls.filter(([action]) => ['enable', 'disable'].includes(action)), [['disable', 'a'], ['enable', 'b']]);
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'self').enabled, true);
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'ignored').enabled, true);
    assert.equal(settings.RIBBON_SETTINGS[0].visible, false);
});

test('manual type reassignment saves the old preset, rebinds and applies the new type', async () => {
    const { manager, settings } = await fixture();
    await manager.devices.setEnabled(true);
    settings.RIBBON_SETTINGS[0].visible = false;
    await manager.devices.assign(manager.devices.id, 'tablet');
    assert.equal(firstOf(settings, 'computer').ribbon[0].visible, false);
    assert.equal(settings.RIBBON_SETTINGS[0].visible, true);
    assert.equal(manager.devices.boundPresetId, firstOf(settings, 'tablet').id);
    const restarted = new DeviceManager(manager);
    await restarted.initialize();
    assert.equal(restarted.type, 'tablet');
    assert.equal(restarted.id, manager.devices.id);
    assert.equal(restarted.boundPresetId, firstOf(settings, 'tablet').id);
});

test('mobile never enables a desktop-only plugin, but preserves its configured intent', async () => {
    const { manager, settings, calls } = await fixture();
    platform.isMobileApp = true;
    manager.appPlugins.manifests.b.isDesktopOnly = true;
    firstOf(settings, 'computer').plugins.b.enabled = true;
    await manager.devices.setEnabled(true);
    assert.equal(calls.some(([action, id]) => action === 'enable' && id === 'b'), false);
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'b').enabled, true);
    assert.equal(manager.buildDelayQueue(Date.now()).some(item => item.id === 'b'), false);
});

test('delayed presets remove native autostart and reuse the existing queue', async () => {
    const { manager, settings, calls } = await fixture();
    settings.DELAY = true;
    let queue;
    manager.drainDelayQueue = async function () { queue = [...this.delayQueue]; };
    await manager.devices.setEnabled(true);
    assert.ok(calls.some(([action, id]) => action === 'disable' && id === 'a'));
    assert.deepEqual(queue.map(item => item.id), ['a']);
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'a').enabled, true);
});

test('runtime failures are surfaced, retain saved intent and release the operation lock', async () => {
    const { manager, settings } = await fixture();
    firstOf(settings, 'computer').plugins.b.enabled = true;
    manager.appPlugins.enablePluginAndSave = async () => { throw new Error('fixture failure'); };
    await assert.rejects(manager.devices.setEnabled(true), /设备_插件失败b/);
    assert.equal(manager.devices.busy, false);
    assert.equal(firstOf(settings, 'computer').plugins.b.enabled, true);
});

test('ordinary saves only update the bound preset and disabling management preserves runtime state', async () => {
    const { manager, settings, calls } = await fixture();
    await manager.devices.setEnabled(true);
    settings.Plugins.find(plugin => plugin.id === 'a').enabled = false;
    await manager.saveSettings();
    assert.equal(firstOf(settings, 'computer').plugins.a.enabled, false);
    assert.equal(firstOf(settings, 'phone').plugins.a.enabled, true);
    calls.length = 0;
    await manager.devices.setEnabled(false);
    assert.deepEqual(calls, [['save']]);
});

test('failed persistence does not rebind or overwrite the saved preset', async () => {
    const { manager, settings } = await fixture();
    await manager.devices.setEnabled(true);
    const before = structuredClone(firstOf(settings, 'computer'));
    // 设备记录不再写 data.json，只有其它设置变化时才会落盘；先制造一处真实改动。
    settings.GROUPS = [{ id: 'g1', name: 'G1', color: '#000000' }];
    manager.saveData = async () => { throw new Error('disk full'); };
    await assert.rejects(manager.devices.assign(manager.devices.id, 'tablet'), /disk full/);
    assert.equal(manager.devices.type, 'computer');
    assert.equal(settings.DEVICE_MANAGEMENT.devices[0].type, 'computer');
    const draft = model.clonePreset(before);
    draft.plugins.a.enabled = false;
    await assert.rejects(manager.devices.savePresetById(before.id, draft), /disk full/);
    assert.deepEqual(firstOf(settings, 'computer'), before);
    await assert.rejects(manager.devices.setEnabled(false), /disk full/);
    assert.equal(settings.DEVICE_MANAGEMENT.enabled, true);
});

test('startup application persists newly discovered Ribbon icons in the bound preset', async () => {
    const { manager, settings } = await fixture();
    settings.DEVICE_MANAGEMENT.enabled = true;
    manager.refreshRibbonManagerFeature = async () => {
        settings.RIBBON_SETTINGS.push({ ...ribbon, bpmUniqueId: 'new-icon' });
        await manager.saveSettings();
    };
    await manager.devices.apply();
    assert.equal(firstOf(settings, 'computer').ribbon.length, 2);
    assert.equal(firstOf(settings, 'phone').ribbon.length, 1);
});

test('concurrent device operations are rejected while an application is in progress', async () => {
    const { manager } = await fixture();
    let finish;
    const pending = manager.devices.run(() => new Promise(resolve => { finish = resolve; }));
    await assert.rejects(manager.devices.setEnabled(true), /设备_忙碌/);
    finish();
    await pending;
    assert.equal(manager.devices.busy, false);
});

test('a type can hold several presets and edits stay in the selected one', async () => {
    const { manager, settings } = await fixture();
    await manager.devices.setEnabled(true);
    const firstId = firstOf(settings, 'computer').id;
    const newId = await manager.devices.createPreset('computer');
    assert.ok(newId && newId !== firstId);
    assert.equal(settings.DEVICE_MANAGEMENT.presets.computer.length, 2);
    await manager.devices.selectScope('themes', `preset:${newId}`);
    await manager.devices.writeAppearance('themes', { theme: 'second-theme' });
    const second = manager.devices.presetById(newId).preset;
    assert.equal(second.appearance.theme, 'second-theme');
    assert.notEqual(firstOf(settings, 'computer').appearance.theme, 'second-theme');
    assert.equal(manager.devices.boundPresetId, firstId);
});

test('binding another preset changes what this device applies and is remembered', async () => {
    const { manager, settings } = await fixture();
    await manager.devices.setEnabled(true);
    const newId = await manager.devices.createPreset('computer');
    manager.devices.presetById(newId).preset.plugins.a.enabled = false;
    await manager.devices.bindPreset(newId);
    assert.equal(manager.devices.boundPresetId, newId);
    const restarted = new DeviceManager(manager);
    await restarted.initialize();
    assert.equal(restarted.boundPresetId, newId);
});

test('projecting a foreign preset rewrites memory but never the persisted live values', async () => {
    const { manager, settings } = await fixture();
    await manager.devices.setEnabled(true);
    firstOf(settings, 'phone').plugins.a.enabled = false;
    await manager.devices.selectScope('plugins', keyOf(settings, 'phone'));
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'a').enabled, false);
    assert.equal(manager.devices.persistedSettings().Plugins.find(plugin => plugin.id === 'a').enabled, true);
    await manager.devices.closeProjection();
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'a').enabled, true);
    assert.equal(firstOf(settings, 'phone').plugins.a.enabled, false);
});

test('ribbon edits while projecting a foreign preset land in that preset only', async () => {
    const { manager, settings } = await fixture();
    await manager.devices.setEnabled(true);
    settings.RIBBON_SETTINGS[0].visible = true;
    await manager.devices.selectScope('ribbon', keyOf(settings, 'phone'));
    settings.RIBBON_SETTINGS[0].visible = false;
    await manager.saveSettings();
    assert.equal(firstOf(settings, 'phone').ribbon[0].visible, false);
    assert.equal(firstOf(settings, 'computer').ribbon[0].visible, true);
    assert.equal(manager.devices.persistedSettings().RIBBON_SETTINGS[0].visible, true);
    await manager.devices.closeProjection();
    assert.equal(settings.RIBBON_SETTINGS[0].visible, true);
});

test('plugin edits under a foreign preset stay out of runtime and land in that preset', async () => {
    const { manager, settings } = await fixture();
    await manager.devices.setEnabled(true);
    await manager.devices.selectScope('plugins', keyOf(settings, 'phone'));
    settings.Plugins.find(plugin => plugin.id === 'a').enabled = false;
    await manager.saveSettings();
    assert.equal(firstOf(settings, 'phone').plugins.a.enabled, false);
    assert.equal(firstOf(settings, 'computer').plugins.a.enabled, true);
    assert.equal(manager.devices.persistedSettings().Plugins.find(plugin => plugin.id === 'a').enabled, true);
    await manager.devices.closeProjection();
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'a').enabled, true);
});

test('a type keeps at least one preset and deleting the bound preset rebinds', async () => {
    const { manager, settings } = await fixture();
    await manager.devices.setEnabled(true);
    const only = firstOf(settings, 'computer');
    await assert.rejects(manager.devices.deletePreset(only.id), /设备_至少保留预设/);
    const newId = await manager.devices.createPreset('computer');
    await manager.devices.bindPreset(newId);
    await manager.devices.deletePreset(newId);
    assert.equal(settings.DEVICE_MANAGEMENT.presets.computer.length, 1);
    assert.equal(manager.devices.boundPresetId, only.id);
});

test('group and tag edits stay global while delay stays scoped', async () => {
    const { manager, settings } = await fixture();
    await manager.devices.setEnabled(true);
    await manager.devices.selectScope('plugins', keyOf(settings, 'phone'));
    const record = settings.Plugins.find(plugin => plugin.id === 'a');
    record.group = 'shared-group';
    record.tags = ['shared-tag'];
    record.delay = 'later';
    await manager.saveSettings();
    const persisted = manager.devices.persistedSettings().Plugins.find(plugin => plugin.id === 'a');
    assert.equal(persisted.group, 'shared-group');
    assert.deepEqual(persisted.tags, ['shared-tag']);
    assert.equal(firstOf(settings, 'phone').plugins.a.delay, 'later');
    assert.deepEqual(Object.keys(firstOf(settings, 'phone').plugins.a).sort(), ['delay', 'enabled']);
});

test('a refreshed platform id migrates the existing device record instead of duplicating it', async () => {
    const { manager, settings } = await fixture();
    const beforeId = manager.devices.id;
    const presetId = manager.devices.boundPresetId;
    globalThis.Capacitor = { Plugins: { Device: { getId: async () => ({ identifier: 'android-stable-id' }) } } };
    try {
        const restarted = new DeviceManager(manager);
        await restarted.initialize();
        assert.notEqual(restarted.id, beforeId);
        assert.equal(settings.DEVICE_MANAGEMENT.devices.length, 1);
        assert.equal(settings.DEVICE_MANAGEMENT.devices[0].id, restarted.id);
        assert.equal(restarted.boundPresetId, presetId);
        assert.equal(restarted.type, 'computer');
    } finally {
        delete globalThis.Capacitor;
    }
});

test('a missing bound preset falls back to the first preset and notifies', async () => {
    const { manager, setLocal, getLocal } = await fixture();
    const local = getLocal();
    setLocal({ ...local, presetId: 'preset-missing' });
    notices.length = 0;
    const restarted = new DeviceManager(manager);
    await restarted.initialize();
    assert.equal(restarted.boundPresetId, manager.devices.presetsFor('computer')[0].id);
    assert.ok(notices.some(message => String(message).includes('设备_预设回退')));
});

test('new presets get unique names and binding follows the selected preset', async () => {
    const { manager, settings } = await fixture();
    await manager.devices.setEnabled(true);
    const first = await manager.devices.createPreset('computer');
    const second = await manager.devices.createPreset('computer');
    const names = manager.devices.presetsFor('computer').map(preset => preset.name);
    assert.equal(new Set(names).size, names.length);
    await manager.devices.bindPreset(second);
    assert.equal(manager.devices.boundPresetId, second);
    assert.equal(manager.devices.selectedScopeKey('plugins'), `preset:${second}`);
    await manager.devices.bindPreset(first);
    assert.equal(manager.devices.selectedScopeKey('themes'), `preset:${first}`);
    assert.equal(settings.DEVICE_MANAGEMENT.presets.computer.length, 3);
});

test('configured is inferred for legacy data and false for auto-created presets', async () => {
    const { settings } = await fixture();
    assert.equal(firstOf(settings, 'computer').configured, false);
    const baseline = model.snapshotPreset(settings);
    const untouched = model.normalizeDeviceManagement({ enabled: false, presets: { computer: { ribbon: [ribbon] } }, devices: [] }, baseline);
    assert.equal(untouched.presets.computer[0].configured, false);
    const modified = model.normalizeDeviceManagement({ enabled: false,
        presets: { computer: { plugins: { a: { enabled: false, delay: '' } } } }, devices: [] }, baseline);
    assert.equal(modified.presets.computer[0].configured, true);
    assert.equal(untouched.presets.phone[0].configured, false);
});

test('an unconfigured type adopts the only configured preset automatically', async () => {
    const { manager, settings } = await fixture();
    settings.DEVICE_MANAGEMENT.enabled = true;
    const phone = firstOf(settings, 'phone');
    phone.configured = true;
    phone.plugins.a.enabled = false;
    phone.ribbon[0].visible = false;
    notices.length = 0;
    const restarted = new DeviceManager(manager);
    await restarted.initialize();
    const computer = firstOf(settings, 'computer');
    assert.equal(computer.configured, true);
    assert.equal(computer.plugins.a.enabled, false);
    assert.equal(computer.ribbon[0].visible, false);
    assert.ok(notices.some(message => String(message).includes('设备_自动复用')));
});

test('multiple configured candidates are not adopted automatically', async () => {
    const { manager, settings } = await fixture();
    settings.DEVICE_MANAGEMENT.enabled = true;
    for (const type of ['phone', 'tablet']) {
        const preset = firstOf(settings, type);
        preset.configured = true;
        preset.plugins.a.enabled = false;
    }
    const restarted = new DeviceManager(manager);
    await restarted.initialize();
    assert.equal(firstOf(settings, 'computer').configured, false);
});

test('copying another preset replaces settings but keeps id and name', async () => {
    const { manager, settings } = await fixture();
    const target = firstOf(settings, 'computer');
    const targetName = target.name;
    const source = firstOf(settings, 'phone');
    source.configured = true;
    source.plugins.a.enabled = false;
    source.plugins.a.delay = 'later';
    source.ribbon[0].visible = false;
    await manager.devices.copyConfig(target.id, source.id);
    const copied = manager.devices.presetById(target.id).preset;
    assert.equal(copied.name, targetName);
    assert.equal(copied.id, target.id);
    assert.equal(copied.plugins.a.enabled, false);
    assert.equal(copied.plugins.a.delay, 'later');
    assert.equal(copied.ribbon[0].visible, false);
    assert.equal(copied.configured, true);
});

test('quick apply copies the current editor filters into a target device preset', async () => {
    const { manager, settings } = await fixture();
    const target = firstOf(settings, 'phone');
    settings.FILTER_SEARCH = 'mobile';
    settings.FILTER_STATUS_VALUES = ['enabled'];
    settings.FILTER_STATUS_OPERATOR = 'not-contains';
    settings.FILTER_GROUP_VALUES = ['reading'];
    settings.FILTER_TAG_VALUES = ['work'];
    settings.FILTER_DELAY_VALUES = ['later'];
    await manager.devices.quickApply(target.id, 'plugins', 'window');
    assert.equal(target.filters.search, 'mobile');
    assert.deepEqual(target.filters.status, ['enabled']);
    assert.equal(target.filters.statusOperator, 'not-contains');
    assert.deepEqual(target.filters.group, ['reading']);
    assert.deepEqual(target.filters.tag, ['work']);
    assert.deepEqual(target.filters.delay, ['later']);
});

test('device scope projection applies preset filters and restores the live filters', async () => {
    const { manager, settings } = await fixture();
    const tablet = firstOf(settings, 'tablet');
    tablet.filters.search = 'tablet search';
    tablet.filters.status = ['disabled'];
    settings.DEVICE_MANAGEMENT.enabled = true;
    settings.FILTER_SEARCH = 'desktop search';
    settings.FILTER_STATUS_VALUES = ['enabled'];
    await manager.devices.selectScope('plugins', keyOf(settings, 'tablet'));
    assert.equal(settings.FILTER_SEARCH, 'tablet search');
    assert.deepEqual(settings.FILTER_STATUS_VALUES, ['disabled']);
    settings.FILTER_SEARCH = 'edited tablet search';
    settings.FILTER_STATUS_VALUES = ['all'];
    await manager.devices.closeProjection();
    assert.equal(tablet.filters.search, 'edited tablet search');
    assert.deepEqual(tablet.filters.status, ['all']);
    assert.equal(settings.FILTER_SEARCH, 'desktop search');
    assert.deepEqual(settings.FILTER_STATUS_VALUES, ['enabled']);
});

test('system platform detection distinguishes desktop operating systems and mobile platforms', () => {
    assert.equal(model.detectSystemPlatform({ isWin: true }), 'windows');
    assert.equal(model.detectSystemPlatform({ isMacOS: true }), 'macos');
    assert.equal(model.detectSystemPlatform({ isLinux: true }), 'linux');
    assert.equal(model.detectSystemPlatform({ isAndroidApp: true }), 'android');
    assert.equal(model.detectSystemPlatform({ isIosApp: true }), 'ios');
});

test('empty saves do not mark a preset configured, real edits do', async () => {
    const { manager, settings } = await fixture();
    await manager.devices.setEnabled(true);
    assert.equal(firstOf(settings, 'computer').configured, false);
    settings.Plugins.find(plugin => plugin.id === 'a').enabled = false;
    await manager.saveSettings();
    assert.equal(firstOf(settings, 'computer').configured, true);
});

test('device records from other devices are merged from their own files', async () => {
    const adapter = memoryAdapter({
        [`${DEVICES_DIR}other.json`]: JSON.stringify({ id: 'other', name: 'Tablet', type: 'tablet', lastSeen: 10 }),
        [`${DEVICES_DIR}broken.json`]: JSON.stringify({ id: 'broken', name: 5, type: 'tablet', lastSeen: 1 }),
        [`${DEVICES_DIR}notes.txt`]: 'ignored',
    });
    const { manager, settings } = await fixture({ adapter });
    const devices = settings.DEVICE_MANAGEMENT.devices;
    assert.ok(devices.some(device => device.id === 'other'));
    assert.equal(devices.some(device => device.id === 'broken'), false);
    assert.equal(devices.filter(device => device.id === 'other').length, 1);
    // 本机记录也要写成文件，供其他设备读取。
    const own = JSON.parse(adapter.files[`${DEVICES_DIR}${manager.devices.id}.json`]);
    assert.equal(own.id, manager.devices.id);
});

test('a device removed in this session is not resurrected and its file is deleted', async () => {
    const adapter = memoryAdapter({
        [`${DEVICES_DIR}old.json`]: JSON.stringify({ id: 'old', name: 'Old phone', type: 'phone', lastSeen: 5 }),
    });
    const { manager, settings } = await fixture({ adapter });
    assert.ok(settings.DEVICE_MANAGEMENT.devices.some(device => device.id === 'old'));
    await manager.devices.remove('old');
    assert.equal(settings.DEVICE_MANAGEMENT.devices.some(device => device.id === 'old'), false);
    assert.equal(`${DEVICES_DIR}old.json` in adapter.files, false);
    await manager.devices.mergeDeviceRecords();
    assert.equal(settings.DEVICE_MANAGEMENT.devices.some(device => device.id === 'old'), false);
});

test('merging keeps the local name and refreshes the heartbeat of a known device', async () => {
    const adapter = memoryAdapter({
        [`${DEVICES_DIR}known.json`]: JSON.stringify({ id: 'known', name: 'Original', type: 'tablet', lastSeen: 9 }),
    });
    const { manager, settings } = await fixture({ adapter });
    await manager.devices.rename('known', 'Renamed here');
    adapter.files[`${DEVICES_DIR}known.json`] = JSON.stringify({ id: 'known', name: 'Original', type: 'tablet', lastSeen: 20 });
    await manager.devices.mergeDeviceRecords();
    const record = settings.DEVICE_MANAGEMENT.devices.find(device => device.id === 'known');
    assert.equal(record.name, 'Renamed here');
    assert.equal(record.lastSeen, 20);
    assert.equal(settings.DEVICE_MANAGEMENT.devices.filter(device => device.id === 'known').length, 1);
});

test('renaming this device rewrites its own record file', async () => {
    const adapter = memoryAdapter();
    const { manager } = await fixture({ adapter });
    await manager.devices.rename(manager.devices.id, 'Renamed device');
    const own = JSON.parse(adapter.files[`${DEVICES_DIR}${manager.devices.id}.json`]);
    assert.equal(own.name, 'Renamed device');
});
