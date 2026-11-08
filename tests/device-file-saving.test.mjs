import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { randomUUID, webcrypto } from 'node:crypto';

// Production save/device modules, with no browser or personal-vault access.
globalThis.window = { addEventListener() {}, removeEventListener() {}, crypto: webcrypto, setTimeout, clearTimeout };
const nativeRequire = createRequire(import.meta.url);
class NativeBase {}
const obsidian = { normalizePath: path => path, Platform: { isMobileApp: false, isTablet: false },
    Plugin: NativeBase, Modal: NativeBase, SuggestModal: NativeBase, PluginSettingTab: NativeBase, Notice: class {} };
async function load(entry) {
    const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false,
        external: ['obsidian', 'electron'], loader: { '.webp': 'dataurl' }, logLevel: 'silent' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'crypto', result.outputFiles[0].text)(name =>
        name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), module, module.exports, { randomUUID });
    return module.exports;
}
const { DeviceManager } = await load('src/devices/device-manager.ts');
const { default: Manager } = await load('src/main.ts');
const { DEFAULT_SETTINGS } = await load('src/settings/data.ts');
const ROOT = '.obsidian/plugins/self/';
const file = id => `${ROOT}data/devices/${id}.json`;
const other = { id: 'other', name: 'Original tablet', type: 'tablet', lastSeen: 9, updatedAt: 100 };
async function fixture() {
    const files = { [file('other')]: JSON.stringify(other) }, writes = [], locals = new Map();
    const adapter = {
        async exists(path) { return Object.hasOwn(files, path) || Object.keys(files).some(name => name.startsWith(path + '/')); },
        async mkdir() {},
        async list(path) { return { files: Object.keys(files).filter(name => name.startsWith(path + '/')), folders: [] }; },
        async read(path) { if (!Object.hasOwn(files, path)) throw new Error('Missing test file'); return files[path]; },
        async write(path, text) { writes.push(path); files[path] = text; },
        async remove(path) { writes.push(path); delete files[path]; },
    };
    const manager = new Manager();
    manager.settings = structuredClone(DEFAULT_SETTINGS);
    manager.settings.CONFIG_SYNC_PROTECTION = true;
    manager.settings.Plugins = [{ id: 'self', name: 'Self', enabled: true, delay: '', tags: [], group: '', desc: '', note: '' }];
    manager.manifest = { id: 'self' };
    manager.translator = { t: key => key };
    manager.app = { vault: { configDir: '.obsidian', adapter }, workspace: {},
        loadLocalStorage: key => locals.get(key), saveLocalStorage: (key, value) => { locals.set(key, value); } };
    manager.appPlugins = { manifests: { self: { id: 'self' } }, enabledPlugins: new Set(['self']), plugins: { self: {} } };
    manager.loadData = async () => Object.hasOwn(files, `${ROOT}data.json`) ? JSON.parse(files[`${ROOT}data.json`]) : null;
    manager.saveData = async value => { files[`${ROOT}data.json`] = JSON.stringify(value); };
    manager.refreshRibbonManagerFeature = async () => {};
    manager.devices = new DeviceManager(manager);
    await manager.devices.initialize();
    files[ROOT + 'data.json'] = JSON.stringify(manager.devices.persistedSettings());
    await manager.loadSettings();
    await manager.devices.initialize();
    assert.equal(await manager.savePendingSettings(), true);
    writes.length = 0;
    const action = async callback => {
        const end = manager.configProtection.beginUserAction();
        try { return await callback(); } finally { end(); }
    };
    const close = () => { manager.devices.dispose(); manager.configProtection.destroy(); };
    return { manager, files, writes, adapter, action, close };
}

test('another device name and type remain drafts until Save and survive restart', async t => {
    const f = await fixture(); t.after(f.close);
    const { manager, files, action } = f, previous = files[file('other')];
    await action(() => manager.devices.rename('other', 'Saved phone'));
    await action(() => manager.devices.assign('other', 'phone'));
    assert.equal(files[file('other')], previous);
    assert.equal(manager.hasUnsavedSettings, true);
    assert.equal(await manager.savePendingSettings(), true);
    assert.equal(JSON.parse(files[file('other')]).name, 'Saved phone');
    assert.equal(JSON.parse(files[file('other')]).type, 'phone');
    manager.devices.dispose(); manager.configProtection.destroy();
    await manager.loadSettings();
    manager.devices = new DeviceManager(manager); await manager.devices.initialize();
    const restored = manager.devices.data.devices.find(device => device.id === 'other');
    assert.equal(restored.name, 'Saved phone'); assert.equal(restored.type, 'phone');
});

test('device disk events cannot replace a trusted or staged selection', async t => {
    const f = await fixture(); t.after(f.close);
    const { manager, files, action } = f;
    await action(() => manager.devices.rename('other', 'My draft'));
    files[file('other')] = JSON.stringify({ ...other, name: 'Uncommitted remote', type: 'phone', updatedAt: Date.now() + 10_000 });
    await manager.devices.mergeDeviceRecords();
    const selected = manager.devices.data.devices.find(device => device.id === 'other');
    assert.equal(selected.name, 'My draft'); assert.equal(selected.type, 'tablet');
});

test('restoring bytes already on disk replaces a different pending device draft', async t => {
    const f = await fixture(); t.after(f.close);
    const { manager, files, action } = f, original = JSON.parse(files[file('other')]);
    await action(() => manager.devices.rename('other', 'Draft'));
    await action(() => manager.devices.writeDeviceFile(original));
    assert.equal(JSON.parse((await manager.configProtection.readFile('data/devices/other.json')).value).name, original.name);
});

test('reading this device prefers its unsaved record over physical disk', async t => {
    const f = await fixture(); t.after(f.close);
    const { manager, files, action } = f, id = manager.devices.id, disk = files[file(id)];
    await action(() => manager.devices.rename(id, 'Unsaved computer'));
    assert.equal((await manager.devices.loadOwnDeviceFile()).name, 'Unsaved computer');
    assert.equal(files[file(id)], disk);
});

test('failed device writes and deletes reject and restore the visible record and deletion guard', async t => {
    const f = await fixture(); t.after(f.close);
    const { manager } = f, session = manager.configProtection, original = session.stageFile.bind(session);
    session.stageFile = async path => { if (path.startsWith('data/devices/')) throw new Error('Draft disk is full'); return false; };
    try {
        await assert.rejects(manager.devices.rename('other', 'Lost name'), /Draft disk is full/);
        await assert.rejects(manager.devices.assign('other', 'phone'), /Draft disk is full/);
        await assert.rejects(manager.devices.remove('other'), /Draft disk is full/);
        const restored = manager.devices.data.devices.find(device => device.id === 'other');
        assert.deepEqual(restored, other);
    } finally { session.stageFile = original; }
    manager.devices.data.devices = manager.devices.data.devices.filter(device => device.id !== 'other');
    await manager.devices.mergeDeviceRecords();
    assert.ok(manager.devices.data.devices.some(device => device.id === 'other'));
});

test('a failed settings stage restores a successfully staged device file', async t => {
    const f = await fixture(); t.after(f.close);
    const { manager } = f, original = manager.saveSettings, before = (await manager.configProtection.readFile('data/devices/other.json')).value;
    manager.saveSettings = async () => { throw new Error('Settings draft write failed'); };
    try { await assert.rejects(manager.devices.rename('other', 'Draft'), /Settings draft write failed/); }
    finally { manager.saveSettings = original; }
    assert.equal((await manager.configProtection.readFile('data/devices/other.json')).value, before);
    assert.equal(manager.devices.data.devices.find(device => device.id === 'other').name, other.name);
});

test('a failed local identity write restores type, binding, preset contents and record metadata', async t => {
    const f = await fixture(); t.after(f.close);
    const { manager } = f, devices = manager.devices;
    const before = { type: devices.type, binding: devices.boundPresetId, presets: structuredClone(devices.data.presets),
        record: { ...devices.data.devices.find(device => device.id === devices.id) } };
    const original = manager.app.saveLocalStorage;
    let failed = false;
    manager.app.saveLocalStorage = (key, value) => {
        if (key === 'better-plugins-manager-device' && !failed) { failed = true; throw new Error('Local state is full'); }
        return original(key, value);
    };
    try { await assert.rejects(devices.assign(devices.id, 'phone'), /Local state is full/); }
    finally { manager.app.saveLocalStorage = original; }
    assert.equal(devices.type, before.type); assert.equal(devices.boundPresetId, before.binding);
    assert.deepEqual(devices.data.presets, before.presets);
    assert.deepEqual(devices.data.devices.find(device => device.id === devices.id), before.record);
});

test('unchanged name and type do not create a draft or refresh metadata', async t => {
    const f = await fixture(); t.after(f.close);
    const { manager, action } = f, before = { ...manager.devices.data.devices.find(device => device.id === 'other') };
    await action(() => manager.devices.rename('other', before.name));
    await action(() => manager.devices.assign('other', before.type));
    assert.deepEqual(manager.devices.data.devices.find(device => device.id === 'other'), before);
    assert.equal(manager.hasUnsavedSettings, false);
    assert.equal(f.writes.length, 0);
});

test('discard restores renamed and removed devices without publishing them', async t => {
    const f = await fixture(); t.after(f.close);
    const { manager, action, files } = f, disk = files[file('other')];
    await action(() => manager.devices.rename('other', 'Discarded'));
    await action(() => manager.devices.remove('other'));
    await manager.discardPendingSettings();
    assert.equal(manager.devices.data.devices.find(device => device.id === 'other').name, other.name);
    assert.equal(manager.hasUnsavedSettings, false);
    assert.equal(files[file('other')], disk);
});
