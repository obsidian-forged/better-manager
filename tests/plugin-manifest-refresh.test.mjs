import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const nativeRequire = createRequire(import.meta.url);
class Base {}
const obsidian = {
    Plugin: Base, Modal: Base, SuggestModal: Base, FuzzySuggestModal: Base, PluginSettingTab: Base,
    ItemView: Base, ButtonComponent: Base, Menu: Base, Setting: Base, DropdownComponent: Base, ToggleComponent: Base,
    Platform: {}, normalizePath: path => path.replaceAll('\\', '/'),
};
async function load(entry) {
    const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false,
        external: ['obsidian', 'electron'], loader: { '.webp': 'dataurl' }, logLevel: 'silent' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(name =>
        name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), module, module.exports);
    return module.exports;
}
const { default: Manager } = await load('src/main.ts');
const { ManagerModal } = await load('src/modal/manager-modal.ts');
const { DEFAULT_SETTINGS } = await load('src/settings/data.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
    const timers = new Map(), cleanup = [], calls = [];
    let nextTimer = 0;
    globalThis.window = {
        setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
        clearTimeout(handle) { timers.delete(handle); },
    };
    const original = { id: 'custom', name: 'Old name', description: 'Old description', author: 'Author', version: '1.0.0' };
    let disk = { ...original };
    const registry = { manifests: { custom: original }, enabledPlugins: new Set(['custom']), async loadManifests() {
        calls.push('read'); registry.manifests.custom = { ...disk };
    } };
    const manager = new Manager();
    manager.manifest = { id: 'self', name: 'Manager', description: 'Manager description' };
    manager.appPlugins = registry;
    manager.settings = structuredClone(DEFAULT_SETTINGS);
    const record = { id: 'custom', name: 'My alias', desc: 'My description', group: 'work', tags: ['favorite'], note: 'My note', delay: '', enabled: true };
    manager.settings.Plugins = [record];
    manager.app = { vault: { configDir: '.custom-config', adapter: { onFileChange() { calls.push('native-event'); } } } };
    manager.register = callback => cleanup.push(callback);
    manager.reportError = (context, error) => calls.push([context, error.message]);
    manager.saveSettings = async () => { calls.push('save'); };
    manager.adoptExternalLocalSettings = async () => { calls.push('settings-read'); };
    manager.refreshConfigConflict = () => {};
    manager.refreshSettingsSaveState = () => {};
    const modal = Object.create(ManagerModal.prototype);
    Object.assign(modal, { appPlugins: registry, searchIndex: new Map(), modalEl: { isConnected: true } });
    modal.reloadShowData = async () => { calls.push('redraw'); };
    manager.managerModal = modal;
    const nativeEvent = manager.app.vault.adapter.onFileChange;
    return { manager, registry, modal, record, calls, timers, cleanup, nativeEvent,
        rename(name) { disk = { ...disk, name, description: `${name} description` }; },
        async tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); await flush(); },
    };
}

test('search finds both custom labels and current manifest metadata after renaming without a version bump', () => {
    const { modal, record, registry } = fixture();
    const before = modal.getPluginSearchText(record, registry.manifests.custom);
    assert.ok(before.includes('my alias'));
    assert.ok(before.includes('old name'));
    const renamed = { ...registry.manifests.custom, name: '新名称', description: 'New manifest description' };
    const after = modal.getPluginSearchText(record, renamed);
    for (const text of ['my alias', 'my description', '新名称', 'new manifest description', 'author']) assert.ok(after.includes(text), text);
    assert.ok(!after.includes('old name'));
});

test('legacy records adopt manifest labels once and keep user organization', async () => {
    const f = fixture();
    await f.manager.refreshFromDisk();
    assert.equal(f.record.name, 'Old name');
    assert.equal(f.record.desc, 'Old description');
    assert.equal(f.record.manifestName, 'Old name');
    assert.equal(f.record.manifestDescription, 'Old description');
    assert.equal(f.record.group, 'work');
    assert.ok(f.record.tags.includes('favorite'));
    assert.equal(f.record.note, 'My note');
});

test('manual refresh rereads disk and shows the renamed plugin card', async () => {
    const f = fixture();
    await f.manager.refreshFromDisk();
    assert.equal(f.modal.getUniquePluginManifests()[0].name, 'Old name');
    f.rename('Changed name');
    await f.manager.refreshFromDisk();
    assert.equal(f.modal.getUniquePluginManifests()[0].name, 'Changed name');
    assert.ok(f.modal.getPluginSearchText(f.record, f.registry.manifests.custom).includes('changed name'));
    // 列表标题使用插件记录，必须与搜索结果同步。
    // The card title uses the plugin record, so it must follow the manifest too.
    assert.equal(f.record.name, 'Changed name');
    assert.equal(f.record.desc, 'Changed name description');
    assert.equal(f.record.manifestName, 'Changed name');
    assert.equal(f.record.group, 'work');
    assert.equal(f.record.note, 'My note');
    assert.equal(f.calls.filter(call => call === 'read').length, 2);
    assert.equal(f.calls.filter(call => call === 'redraw').length, 2);
});

test('user-edited labels survive later manifest renames while the source marker advances', async () => {
    const f = fixture();
    await f.manager.refreshFromDisk();
    f.record.name = 'My alias';
    f.record.desc = 'My description';
    f.rename('Renamed upstream');
    await f.manager.refreshFromDisk();
    assert.equal(f.record.name, 'My alias');
    assert.equal(f.record.desc, 'My description');
    assert.equal(f.record.manifestName, 'Renamed upstream');
    assert.equal(f.record.manifestDescription, 'Renamed upstream description');
});

test('automatic manifest events coalesce and refresh metadata without reading settings; noise does not redraw', async () => {
    const f = fixture();
    f.manager.startPluginManifestWatch();
    const adapter = f.manager.app.vault.adapter;
    for (const path of [null, undefined, '', '.custom-config/plugins/custom/data.json', '.obsidian/plugins/custom/manifest.json', '.custom-config/plugins/custom/nested/manifest.json']) adapter.onFileChange(path);
    assert.equal(f.timers.size, 0);
    f.rename('自动名称');
    adapter.onFileChange('.custom-config/plugins/custom/manifest.json');
    adapter.onFileChange('.custom-config/plugins/custom/manifest.json');
    assert.equal(f.timers.size, 1);
    await f.tick();
    assert.equal(f.registry.manifests.custom.name, '自动名称');
    assert.equal(f.record.name, '自动名称');
    assert.equal(f.record.manifestName, '自动名称');
    assert.equal(f.calls.filter(call => call === 'redraw').length, 1);
    assert.ok(!f.calls.includes('settings-read'));
    adapter.onFileChange('.custom-config/plugins/custom/manifest.json');
    await f.tick();
    assert.equal(f.calls.filter(call => call === 'redraw').length, 1);
    f.cleanup.forEach(callback => callback());
    assert.equal(adapter.onFileChange, f.nativeEvent);
});

test('unload cancels pending manifest events and suppresses in-flight UI work', async () => {
    const f = fixture();
    f.manager.startPluginManifestWatch();
    f.manager.app.vault.adapter.onFileChange('.custom-config/plugins/custom/manifest.json');
    f.cleanup.forEach(callback => callback());
    assert.equal(f.timers.size, 0);
    let release;
    f.registry.loadManifests = () => new Promise(resolve => { release = resolve; });
    const refresh = f.manager.refreshPluginManifests();
    f.manager.isUnloaded = true;
    release();
    await refresh;
    assert.ok(!f.calls.includes('redraw'));
});

test('manual refresh failure leaves records intact and a later refresh can recover', async () => {
    const f = fixture(), before = structuredClone(f.manager.settings.Plugins), read = f.registry.loadManifests;
    f.registry.loadManifests = async () => { throw new Error('Read denied'); };
    await assert.rejects(f.manager.refreshFromDisk(), /Read denied/);
    assert.deepEqual(f.manager.settings.Plugins, before);
    assert.ok(!f.calls.includes('redraw'));
    f.registry.loadManifests = read;
    f.rename('Recovered');
    await f.manager.refreshFromDisk();
    assert.equal(f.registry.manifests.custom.name, 'Recovered');
});

test('a manifest event during an earlier read performs another read and shows the latest metadata', async () => {
    const f = fixture();
    f.manager.startPluginManifestWatch();
    let release;
    const read = f.registry.loadManifests;
    f.registry.loadManifests = async () => {
        f.registry.loadManifests = read;
        await new Promise(resolve => { release = resolve; });
    };
    const earlier = f.manager.refreshPluginManifests();
    f.rename('Latest name');
    f.manager.app.vault.adapter.onFileChange('.custom-config/plugins/custom/manifest.json');
    await f.tick();
    assert.equal(f.registry.manifests.custom.name, 'Old name');
    release();
    await earlier;
    await flush();
    assert.equal(f.registry.manifests.custom.name, 'Latest name');
    assert.equal(f.calls.filter(call => call === 'redraw').length, 1);
    f.cleanup.forEach(callback => callback());
});
