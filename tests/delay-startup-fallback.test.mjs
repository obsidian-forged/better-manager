import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const nativeRequire = createRequire(import.meta.url);
class Base {}
const obsidian = {
    Plugin: Base, Modal: Base, SuggestModal: Base, FuzzySuggestModal: Base, PluginSettingTab: Base,
    ItemView: Base, ButtonComponent: Base, Menu: Base, Setting: Base, DropdownComponent: Base, ToggleComponent: Base,
    Platform: { isMobileApp: false }, normalizePath: path => path.replaceAll('\\', '/'),
};
const built = await build({ entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['obsidian', 'electron'], loader: { '.webp': 'dataurl' }, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(name =>
    name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), module, module.exports);
const { default: Manager } = module.exports;

function managerWith(settings) {
    const manager = new Manager();
    manager.settings = settings;
    manager.manifest = { id: 'self' };
    manager.reportError = () => {};
    manager.delayWaitSeconds = () => 0;
    manager.delayQueueRunning = false;
    manager.lastDelayStartReport = [];
    return manager;
}

test('a device preset failure still drains the delay queue', async () => {
    const manager = managerWith({ DELAY: true, DEVICE_MANAGEMENT: { enabled: true }, Plugins: [{ id: 'a', enabled: true }], FEATURES: {} });
    manager.devices = { apply: async () => { throw new Error('appearance failed'); } };
    manager.appPlugins = { plugins: {}, manifests: { a: { id: 'a' } } };
    let builds = 0, drains = 0;
    manager.buildDelayQueue = () => { builds++; return [{ id: 'a', earliestAt: 0 }]; };
    manager.drainDelayQueue = async () => { drains++; };
    await assert.rejects(manager.runDelayedStartup(), /appearance failed/);
    assert.equal(builds, 1);
    assert.equal(drains, 1);
});

test('one failing on-demand plugin does not stop the remaining startup loop', async () => {
    const manager = managerWith({ DELAY: false, DEVICE_MANAGEMENT: { enabled: false }, Plugins: [], FEATURES: {} });
    const applied = [];
    manager.onDemand = { configured: () => true, apply: async id => { applied.push(id); if (id === 'a') throw new Error('on-demand failed'); } };
    manager.settings.Plugins = [{ id: 'a', enabled: true }, { id: 'b', enabled: true }];
    await manager.runDelayedStartup();
    assert.deepEqual(applied, ['a', 'b']);
});

test('initialization failure restores enabled managed plugins natively', async () => {
    const manager = managerWith({ DELAY: true, FEATURES: {}, Plugins: [
        { id: 'a', enabled: true, tags: [] },
        { id: 'b', enabled: false, tags: [] },
        { id: 'c', enabled: true, tags: ['bpm-ignore'] },
        { id: 'd', enabled: true, tags: [] },
        { id: 'e', enabled: true, tags: [] },
        { id: 'self', enabled: true, tags: [] },
    ] });
    manager.onDemand = { configured: id => id === 'd' };
    const restored = [];
    manager.appPlugins = {
        manifests: { a: {}, b: {}, c: {}, d: {}, e: { id: 'e', isDesktopOnly: true }, self: {} },
        enablePluginAndSave: async id => { restored.push(id); },
    };
    obsidian.Platform.isMobileApp = true;
    try {
        assert.equal(await manager.recoverNativeStartupAfterFailure(), true);
        assert.deepEqual(restored, ['a']);
    } finally {
        obsidian.Platform.isMobileApp = false;
    }
});

test('without delay mode there is no native startup recovery', async () => {
    const manager = managerWith({ DELAY: false, FEATURES: {}, Plugins: [{ id: 'a', enabled: true, tags: [] }] });
    manager.appPlugins = { manifests: { a: {} }, enablePluginAndSave: async () => { throw new Error('must not be called'); } };
    assert.equal(await manager.recoverNativeStartupAfterFailure(), false);
});

test('a settled delay queue with nothing running restores the preset-enabled plugins', async () => {
    const manager = managerWith({ DELAY: true, FEATURES: {}, DEVICE_MANAGEMENT: {
        enabled: true, presets: { computer: [{ id: 'p1', plugins: { a: { enabled: true }, b: { enabled: false }, c: { enabled: true } } }] },
    }, Plugins: [{ id: 'a', enabled: false, tags: [] }, { id: 'b', enabled: false, tags: [] }, { id: 'c', enabled: false, tags: [] }] });
    manager.devices = { boundPreset: () => manager.settings.DEVICE_MANAGEMENT.presets.computer[0] };
    manager.appPlugins = { plugins: {}, manifests: { a: {}, b: {}, c: {} }, enablePluginAndSave: async () => {} };
    const restored = [];
    manager.appPlugins.enablePluginAndSave = async id => { restored.push(id); };
    const notices = [];
    manager.reportError = (_context, _error, notify) => { if (notify) notices.push('notified'); };
    assert.equal(await manager.ensureDelayedPluginsStarted(), true);
    assert.deepEqual(restored, ['a', 'c']);
    assert.deepEqual(notices, ['notified']);
});

test('recovery is skipped while any expected plugin runs or the queue is still draining', async () => {
    const settings = { DELAY: true, FEATURES: {}, DEVICE_MANAGEMENT: { enabled: false }, Plugins: [{ id: 'a', enabled: true, tags: [] }] };
    const manager = managerWith(settings);
    manager.appPlugins = { plugins: {}, manifests: { a: {} }, enablePluginAndSave: async () => { throw new Error('must not run'); } };
    manager.delayQueueRunning = true;
    assert.equal(await manager.ensureDelayedPluginsStarted(), false);
    manager.delayQueueRunning = false;
    manager.appPlugins.plugins.a = { _loaded: true };
    assert.equal(await manager.ensureDelayedPluginsStarted(), false);
});

test('initialization recovery uses the bound preset when records were not projected yet', async () => {
    const manager = managerWith({ DELAY: true, FEATURES: {}, DEVICE_MANAGEMENT: { enabled: true }, Plugins: [
        { id: 'a', enabled: false, tags: [] }, { id: 'b', enabled: false, tags: [] },
    ] });
    manager.devices = { boundPreset: () => ({ plugins: { a: { enabled: true }, b: { enabled: false } } }) };
    const restored = [];
    manager.appPlugins = { manifests: { a: {}, b: {} }, enablePluginAndSave: async id => { restored.push(id); } };
    assert.equal(await manager.recoverNativeStartupAfterFailure(), true);
    assert.deepEqual(restored, ['a']);
});
