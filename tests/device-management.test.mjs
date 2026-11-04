import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { randomUUID, webcrypto, createHash } from 'node:crypto';
globalThis.window = { addEventListener() {}, removeEventListener() {}, crypto: webcrypto, setTimeout: callback => setTimeout(callback, 0), clearTimeout };
const hash = async text => createHash('sha256').update(text).digest('hex');

// 无浏览器、无个人库副作用；Exercise production modules with a native API test double.
const nativeRequire = createRequire(import.meta.url);
const platform = { isMobileApp: false, isTablet: false };
const notices = [];
class NativeBase {}
const obsidian = { normalizePath: path => path, Platform: platform, Plugin: NativeBase, Modal: NativeBase, SuggestModal: NativeBase, PluginSettingTab: NativeBase,
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
const { createConfigRevision, encodeConfig } = await load('src/settings/config-revision.ts');
async function remoteChild(manager, value) {
    const head = manager.configProtection.protection.current;
    return encodeConfig(await createConfigRevision(value, 'remote-device', [head], head.files, hash));
}
const record = (id, enabled, tags = []) => ({ id, name: id, desc: '', group: '', tags, enabled, delay: '', note: '' });
const ribbon = { bpmUniqueId: 'a', name: 'A', icon: 'star', visible: true, order: 0, ribbonIdMap: { en: 'a' } };
const firstOf = (settings, type) => settings.DEVICE_MANAGEMENT.presets[type][0];
const keyOf = (settings, type) => `preset:${firstOf(settings, type).id}`;
const DEVICES_DIR = '.obsidian/plugins/self/data/devices/';
/** 最小 DataAdapter：设备记录按文件夹里的 JSON 文件同步 / In-memory adapter for device files. */
function memoryAdapter(files = {}) {
    return {
        files,
        async exists(path) { return Object.prototype.hasOwnProperty.call(files, path) || Object.keys(files).some(file => file.startsWith(path + '/')); },
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
    const locals = new Map();
    const manager = new Manager();
    manager.settings = settings;
    manager.manifest = { id: 'self' };
    manager.translator = { t: (key, vars) => `${key}${vars?.names || ''}` };
    manager.app = { loadLocalStorage: key => locals.get(key), saveLocalStorage: (key, value) => { locals.set(key, value); } };
    manager.loadData = async () => null;
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
    return { manager, settings, calls, getLocal: () => locals.get(manager.devices.storageKey), setLocal: (value) => { locals.set(manager.devices.storageKey, value); } };
}

test('reapplying an unchanged appearance does not write or reload native styles', async () => {
    const { manager, settings } = await fixture();
    const calls = [];
    manager.app.customCss = { theme: 'Current', enabledSnippets: new Set(['base']),
        setTheme() { calls.push('theme-write'); }, setCssEnabledStatus() { calls.push('snippet-write'); },
        async loadTheme() { calls.push('theme-load'); }, async loadSnippets() { calls.push('snippet-load'); } };
    settings.DEVICE_MANAGEMENT.enabled = true;
    firstOf(settings, 'computer').appearance = { theme: 'Current', snippets: { base: true, disabled: false } };
    await manager.devices.apply(); await manager.devices.apply();
    assert.deepEqual(calls, []);
});

test('the void plugin lifecycle stops initialization after an unload during settings I/O', async () => {
    const manager = new Manager();
    manager.app = { plugins: {}, workspace: {} };
    let release, started = 0, destroyed = 0;
    const blocked = new Promise(resolve => { release = resolve; });
    manager.loadSettings = async () => { started++; await blocked; };
    manager.configProtection = { destroy() { destroyed++; } };
    manager.addRibbonIcon = () => { throw new Error('Initialization resumed after unload'); };
    assert.equal(manager.onload(), undefined);
    assert.equal(started, 1);
    manager.onunload();
    release();
    await manager.initialization;
    assert.ok(destroyed >= 1);
    assert.equal(manager.startupTimers.size, 0);
    assert.equal(manager.devices, undefined);
});

test('a failed asynchronous initialization releases native resources and reports the failure', async () => {
    const manager = new Manager(), before = notices.length;
    manager.app = { workspace: {} };
    manager.settings = structuredClone(DEFAULT_SETTINGS);
    manager.initialize = async () => { throw new Error('Initialization test failure'); };
    let unloaded = 0;
    manager.unload = () => { unloaded++; manager.onunload(); };
    assert.equal(manager.onload(), undefined);
    await manager.initialization;
    assert.equal(unloaded, 1);
    assert.equal(notices.length, before + 1);
    assert.equal(manager.isUnloaded, true);
});

test('yield cancellation releases both the owning window frame and its fallback timer', async () => {
    const { manager } = await fixture(), previousFrame = window.requestAnimationFrame, previousCancel = window.cancelAnimationFrame;
    const frames = new Map(), cancelled = [];
    window.requestAnimationFrame = callback => { frames.set(42, callback); return 42; };
    window.cancelAnimationFrame = handle => { cancelled.push(handle); frames.delete(handle); };
    try {
        const pending = manager.yieldToMainThread();
        assert.equal(frames.size, 1);
        manager.cancelDelayQueue();
        await pending;
        assert.deepEqual(cancelled, [42]);
        assert.equal(frames.size, 0);
        assert.equal(manager.delayYieldTimer, null);
        assert.equal(manager.delayYieldFrame, null);
    } finally {
        window.requestAnimationFrame = previousFrame;
        window.cancelAnimationFrame = previousCancel;
    }
});

test('shared file events and editor close do not read, pause, apply or publish settings', async () => {
    const adapter=memoryAdapter(),{manager}=await fixture({adapter}),path='.obsidian/plugins/self/data.json';
    adapter.files[path]=JSON.stringify(manager.devices.persistedSettings());await manager.loadSettings();const current=manager.settings;
    let renders=0,reads=0;const read=adapter.read;adapter.read=async path=>{reads++;return read(path);};
    manager.managerModal={modalEl:{isConnected:true},refreshStyleSettings(){renders++;},reloadShowData(){renders++;}};
    const editor={};manager.beginSettingsEditing(editor);
    for(const days of [8,9,10]){const remote=JSON.parse(adapter.files[path]);remote.RECENT_INSTALL_DAYS=days;adapter.files[path]=JSON.stringify(remote);manager.onExternalSettingsChange();}
    assert.equal(reads,0);assert.equal(manager.settings,current);assert.equal(manager.settings.RECENT_INSTALL_DAYS,7);assert.equal(manager.configProtection.protection.paused,false);
    manager.settings.RECENT_INSTALL_DAYS=14;await manager.saveSettings();manager.endSettingsEditing(editor);await manager.settingsSaveQueue;
    assert.equal(JSON.parse(adapter.files[path]).RECENT_INSTALL_DAYS,10);assert.equal(manager.hasUnsavedSettings,true);
    assert.equal(await manager.savePendingSettings(),false);assert.equal(manager.configProtection.protection.paused,true);
    await manager.configProtection.choose(manager.devices.persistedSettings(),manager.configProtection.protection.pendingFiles);
    assert.equal(await manager.savePendingSettings(),true);assert.equal(JSON.parse(adapter.files[path]).RECENT_INSTALL_DAYS,14);assert.equal(manager.settings,current);assert.equal(renders,0);
});

test('explicit Save preserves local edits and requires a reviewed choice for concurrent fields', async () => {
    const adapter=memoryAdapter(),{manager}=await fixture({adapter}),path='.obsidian/plugins/self/data.json';
    adapter.files[path]=JSON.stringify(manager.devices.persistedSettings());await manager.loadSettings();manager.beginSettingsEditing({});
    manager.settings.RECENT_INSTALL_DAYS=14;await manager.saveSettings();const remote=JSON.parse(adapter.files[path]);remote.LANGUAGE='fr';adapter.files[path]=JSON.stringify(remote);
    manager.onExternalSettingsChange();assert.equal(manager.configProtection.protection.paused,false);assert.equal(await manager.savePendingSettings(),false);
    const selected=structuredClone(manager.devices.persistedSettings());selected.LANGUAGE='fr';await manager.configProtection.choose(selected,manager.configProtection.protection.pendingFiles);
    assert.equal(await manager.savePendingSettings(),true);const saved=JSON.parse(adapter.files[path]);assert.equal(saved.RECENT_INSTALL_DAYS,14);assert.equal(saved.LANGUAGE,'fr');assert.equal(manager.settings.LANGUAGE,'fr');
});

test('file echoes stay inert and only an explicit Save reports newly received differences', async () => {
    const adapter=memoryAdapter(),{manager}=await fixture({adapter}),path='.obsidian/plugins/self/data.json';
    adapter.files[path]=JSON.stringify(manager.devices.persistedSettings());await manager.loadSettings();manager.beginSettingsEditing({});const count=notices.length;
    manager.settings.RECENT_INSTALL_DAYS=12;await manager.saveSettings();manager.onExternalSettingsChange();assert.equal(notices.length,count);
    const remote=JSON.parse(adapter.files[path]);remote.LANGUAGE='fr';adapter.files[path]=JSON.stringify(remote);manager.onExternalSettingsChange();
    assert.equal(notices.length,count);assert.equal(manager.configProtection.protection.paused,false);assert.notEqual(manager.settings.LANGUAGE,'fr');
    assert.equal(await manager.savePendingSettings(),false);assert.ok(Object.keys(adapter.files).some(path=>path.includes('/conflicts/')));assert.ok(notices.length>count);
});

async function drainEditorClose(manager) {
    // A close publishes outside the staging queue so it cannot deadlock its own Save request.
    for (let pass = 0; pass < 3; pass++) { await new Promise(resolve => setImmediate(resolve)); await manager.settingsSaveQueue; }
}
async function closeSaveFixture() {
    const adapter = memoryAdapter(), { manager } = await fixture({ adapter });
    manager.settings.MANUAL_CONFIG_SAVE = false;
    const path = '.obsidian/plugins/self/data.json';
    adapter.files[path] = JSON.stringify(manager.devices.persistedSettings());
    await manager.loadSettings();
    return { adapter, manager, path };
}

test('manual saving remains the default for new and previously stored settings', async () => {
    assert.equal(DEFAULT_SETTINGS.MANUAL_CONFIG_SAVE, true);
    const adapter = memoryAdapter(), { manager } = await fixture({ adapter });
    const path = '.obsidian/plugins/self/data.json', stored = structuredClone(manager.devices.persistedSettings());
    delete stored.MANUAL_CONFIG_SAVE; adapter.files[path] = JSON.stringify(stored);
    await manager.loadSettings();
    assert.equal(manager.settings.MANUAL_CONFIG_SAVE, true);
});

test('failure to prime read-only sync warnings reports the limitation without breaking configuration protection', async () => {
    const adapter = memoryAdapter(), { manager } = await fixture({ adapter });
    const path = '.obsidian/plugins/self/data.json';
    adapter.files[path] = JSON.stringify(manager.devices.persistedSettings());
    const read = adapter.read, before = notices.length; let failures = 0;
    adapter.read = async target => {
        if (target === path && manager.configProtection?.protection.current) { failures++; throw new Error('Transient diagnostic read failure'); }
        return read(target);
    };
    await manager.loadSettings();
    assert.equal(failures, 1); assert.equal(notices.length, before + 1);
    assert.match(notices.at(-1), /External BPM settings changes could not be checked/);
    assert.equal(manager.settings.RECENT_INSTALL_DAYS, 7);
    assert.ok(manager.configProtection.protection.current.id);
    adapter.read = read;
    assert.ok((await manager.configProtection.files.readShared()).id);
    manager.configProtection.destroy();
});

test('optional close saving waits for the last editor and retains the explicit Save entry point', async () => {
    const { adapter, manager, path } = await closeSaveFixture(), first = {}, second = {};
    const original = adapter.files[path];
    manager.beginSettingsEditing(first); manager.beginSettingsEditing(second);
    manager.settings.RECENT_INSTALL_DAYS = 19; await manager.saveSettings({ captureDevice: false });
    manager.endSettingsEditing(first); await drainEditorClose(manager);
    assert.equal(adapter.files[path], original);
    manager.endSettingsEditing(second); await drainEditorClose(manager);
    assert.equal(JSON.parse(adapter.files[path]).RECENT_INSTALL_DAYS, 19);
    assert.equal(manager.hasUnsavedSettings, false);
    assert.equal(await manager.savePendingSettings(), true);
});

test('optional close saving preserves both conflicting versions and never adopts external settings', async () => {
    const { adapter, manager, path } = await closeSaveFixture(), editor = {};
    manager.beginSettingsEditing(editor);
    manager.settings.RECENT_INSTALL_DAYS = 19; await manager.saveSettings({ captureDevice: false });
    const remote = JSON.parse(adapter.files[path]); remote.LANGUAGE = 'fr'; adapter.files[path] = JSON.stringify(remote);
    const incoming = adapter.files[path];
    manager.endSettingsEditing(editor); await drainEditorClose(manager);
    assert.equal(adapter.files[path], incoming);
    assert.equal(manager.configProtection.protection.paused, true);
    assert.equal(manager.settings.RECENT_INSTALL_DAYS, 19); assert.notEqual(manager.settings.LANGUAGE, 'fr');
    assert.ok(Object.keys(adapter.files).some(path => path.includes('/conflicts/')));
    assert.equal(manager.hasUnsavedSettings, true);
});

test('reopening during an opted-in close save cancels it before shared publication', async () => {
    const { adapter, manager, path } = await closeSaveFixture(), editor = {}, reopened = {};
    const original = adapter.files[path]; manager.beginSettingsEditing(editor);
    manager.settings.RECENT_INSTALL_DAYS = 19; await manager.saveSettings({ captureDevice: false });
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    manager.devices.mergeDeviceRecords = async () => { entered(); await gate; return false; };
    manager.endSettingsEditing(editor); await started;
    manager.beginSettingsEditing(reopened); release(); await drainEditorClose(manager);
    assert.equal(adapter.files[path], original); assert.equal(manager.hasUnsavedSettings, true);
});

test('session-only changes never become a close-save publication or a pending draft', async () => {
    const { adapter, manager, path } = await closeSaveFixture(), editor = {};
    manager.settings.DEVICE_MANAGEMENT.enabled = true;
    manager.beginSettingsEditing(editor);
    const original = adapter.files[path];
    manager.overview.setMode('plugins', 'session'); await manager.overview.setPluginState('a', { enabled: false });
    manager.endSettingsEditing(editor); await drainEditorClose(manager);
    assert.equal(adapter.files[path], original); assert.equal(manager.hasUnsavedSettings, false);
});
test('manual edits after confirmation retain the other selected fields until explicit Save',async()=>{
    const adapter=memoryAdapter(),{manager}=await fixture({adapter}),path='.obsidian/plugins/self/data.json';
    adapter.files[path]=JSON.stringify(manager.devices.persistedSettings());await manager.loadSettings();manager.beginSettingsEditing({});
    manager.settings.RECENT_INSTALL_DAYS=14;await manager.saveSettings();const remote=JSON.parse(adapter.files[path]);remote.LANGUAGE='fr';adapter.files[path]=JSON.stringify(remote);
    assert.equal(await manager.savePendingSettings(),false);const selected=structuredClone(manager.devices.persistedSettings());selected.LANGUAGE='fr';
    await manager.configProtection.choose(selected,manager.configProtection.protection.pendingFiles);
    manager.settings.RECENT_INSTALL_DAYS=21;await manager.saveSettings({captureDevice:false});
    assert.equal(manager.configProtection.protection.confirmedSelection.value.LANGUAGE,'fr');assert.equal(await manager.savePendingSettings(),true);
    const saved=JSON.parse(adapter.files[path]);assert.equal(saved.LANGUAGE,'fr');assert.equal(saved.RECENT_INSTALL_DAYS,21);
});
test('a user edit while Save is staging cancels that click and keeps the newer draft',async()=>{
    const adapter=memoryAdapter(),{manager}=await fixture({adapter}),path='.obsidian/plugins/self/data.json';
    adapter.files[path]=JSON.stringify(manager.devices.persistedSettings());await manager.loadSettings();manager.beginSettingsEditing({});manager.settings.RECENT_INSTALL_DAYS=14;await manager.saveSettings();
    let release,entered;const blocked=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
    manager.devices.mergeDeviceRecords=async()=>{entered();await blocked;return false;};
    const publishing=manager.savePendingSettings();await started;manager.settings.RECENT_INSTALL_DAYS=21;const later=manager.saveSettings({captureDevice:false});release();
    assert.equal(await publishing,false);await later;assert.equal(JSON.parse(adapter.files[path]).RECENT_INSTALL_DAYS,7);
    assert.equal(manager.hasUnsavedSettings,true);assert.equal(manager.configProtection.protection.current.value.RECENT_INSTALL_DAYS,7);
    assert.equal(manager.settings.RECENT_INSTALL_DAYS,21);
});
test('explicit Save retries an incomplete bundle after its missing file arrives',async()=>{
    const adapter=memoryAdapter(),{manager}=await fixture({adapter}),path='.obsidian/plugins/self/data.json';
    adapter.files[path]=JSON.stringify(manager.devices.persistedSettings());await manager.loadSettings();manager.beginSettingsEditing({});
    const head=manager.configProtection.protection.current,remote=structuredClone(head.value);remote.LANGUAGE='fr';
    const incoming=await createConfigRevision(remote,'remote-device',[head],{...head.files,'data/icons.css':await hash('remote icons')},hash);
    adapter.files[path]=JSON.stringify(encodeConfig(incoming));assert.equal(await manager.savePendingSettings(),false);assert.equal(manager.configProtection.protection.paused,false);
    adapter.files['.obsidian/plugins/self/data/icons.css']='remote icons';assert.equal(await manager.savePendingSettings(),false);assert.equal(manager.configProtection.protection.paused,true);
    await manager.configProtection.prepareConflictChoices();await manager.configProtection.selectConflictSection('file:data/icons.css','incoming');await manager.configProtection.confirmConflictChoices();
    assert.equal(await manager.savePendingSettings(),true);assert.equal(JSON.parse(adapter.files[path])._bpmRevision.files['data/icons.css'],await hash('remote icons'));
});

test('a reviewed remote preset applies only after explicit Save and never on editor close', async () => {
    const adapter=memoryAdapter(),{manager,settings}=await fixture({adapter});settings.DEVICE_MANAGEMENT.enabled=true;
    const path='.obsidian/plugins/self/data.json';adapter.files[path]=JSON.stringify(manager.devices.persistedSettings());await manager.loadSettings();
    let applications=0,closes=0,rebuilds=0;manager.devices.apply=async options=>{applications++;assert.equal(options.persist,false);};
    manager.managerModal={modalEl:{isConnected:true},close(){closes++;},refreshRibbonFeatureAvailability(){rebuilds++;}};
    const first={},second={};manager.beginSettingsEditing(first);manager.beginSettingsEditing(second);const remote=JSON.parse(adapter.files[path]);firstOf(remote,'computer').plugins.a.enabled=false;
    adapter.files[path]=JSON.stringify(await remoteChild(manager,remote));manager.onExternalSettingsChange();manager.endSettingsEditing(first);manager.endSettingsEditing(second);await manager.settingsSaveQueue;
    assert.equal(applications,0);assert.equal(await manager.savePendingSettings(),false);await manager.configProtection.choose(remote,manager.configProtection.protection.pendingFiles);
    assert.equal(await manager.savePendingSettings(),true);assert.equal(applications,1);assert.equal(closes,0);assert.equal(rebuilds,0);
});

test('saving a reviewed filter-only change does not reload plugin, appearance or Ribbon runtime state', async () => {
    const adapter=memoryAdapter(),{manager,settings}=await fixture({adapter});settings.DEVICE_MANAGEMENT.enabled=true;
    const path='.obsidian/plugins/self/data.json';adapter.files[path]=JSON.stringify(manager.devices.persistedSettings());await manager.loadSettings();
    let applications=0;manager.devices.apply=async()=>{applications++;};const editor={};manager.beginSettingsEditing(editor);const before=manager.devices.boundRuntimeFingerprint();
    const remote=JSON.parse(adapter.files[path]);firstOf(remote,'computer').filters.search='remote search';adapter.files[path]=JSON.stringify(await remoteChild(manager,remote));manager.onExternalSettingsChange();
    manager.endSettingsEditing(editor);await manager.settingsSaveQueue;assert.notEqual(firstOf(manager.settings,'computer').filters.search,'remote search');
    assert.equal(await manager.savePendingSettings(),false);await manager.configProtection.choose(remote,manager.configProtection.protection.pendingFiles);assert.equal(await manager.savePendingSettings(),true);
    assert.equal(manager.devices.boundRuntimeFingerprint(),before);assert.equal(firstOf(manager.settings,'computer').filters.search,'remote search');assert.equal(applications,0);
});

test('background Ribbon reconciliation preserves views while explicit feature changes can refresh them', async () => {
    const { manager } = await fixture(); let closes = 0, rebuilds = 0;
    manager.refreshRibbonManagerFeature = Manager.prototype.refreshRibbonManagerFeature;
    manager.isRibbonManagerEnabled = () => false;
    manager.stopRibbonRuntimeFeatures = () => {};
    manager.clearLegacyRibbonOverrides = () => {};
    manager.ribbonModal = { close() { closes++; } };
    manager.managerModal = { modalEl: { isConnected: true }, refreshRibbonFeatureAvailability() { rebuilds++; } };
    await manager.refreshRibbonManagerFeature({ refreshViews: false });
    assert.equal(closes, 0); assert.equal(rebuilds, 0);
    await manager.refreshRibbonManagerFeature();
    assert.equal(closes, 1); assert.equal(rebuilds, 1);
});

test('applying an externally synced preset does not capture runtime state or write settings back', async () => {
    const { manager, settings } = await fixture(); settings.DEVICE_MANAGEMENT.enabled = true;
    const before = structuredClone(firstOf(settings, 'computer'));
    const options = []; let saves = 0;
    manager.applyDeviceConfiguration = async value => { options.push(value); };
    manager.saveSettings = async () => { saves++; };
    await manager.devices.apply({ refreshViews: false, persist: false });
    assert.equal(saves, 0); assert.deepEqual(options[0], { refreshViews: false, persist: false });
    assert.deepEqual(firstOf(settings, 'computer'), before);
    await manager.devices.apply(); assert.equal(saves, 1);
});

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

test('inheritance copies the full configuration into the bound preset and never overwrites configured types', async () => {
    const { manager, settings } = await fixture();
    const computer = firstOf(settings, 'computer');
    computer.configured = true;
    computer.plugins.a.enabled = false;
    computer.filters.search = 'computer-only';
    const tablet = firstOf(settings, 'tablet');
    tablet.configured = false;
    const second = structuredClone(tablet);
    second.id = 'tablet-second';
    second.name = 'Tablet 2';
    settings.DEVICE_MANAGEMENT.presets.tablet.push(second);

    manager.devices.adoptIfNeeded('tablet', second.id);
    assert.equal(second.configured, true);
    assert.equal(second.plugins.a.enabled, false);
    assert.equal(second.filters.search, 'computer-only');
    assert.equal(tablet.configured, false);

    // 已配置的类型不再被继承覆盖，即使调用时指定了另一份预设。
    tablet.configured = true;
    tablet.plugins.a.enabled = true;
    tablet.filters.search = 'tablet-only';
    manager.devices.adoptIfNeeded('tablet', 'tablet-second');
    assert.equal(tablet.plugins.a.enabled, true);
    assert.equal(tablet.filters.search, 'tablet-only');
});

test('opening a foreign preset does not absorb live state for plugins the preset never configured', async () => {
    const { manager, settings, calls } = await fixture();
    await manager.devices.setEnabled(true);
    settings.Plugins.push(record('newp', true));
    manager.appPlugins.manifests.newp = { id: 'newp', name: 'newp' };
    const phone = firstOf(settings, 'phone');
    assert.equal(phone.plugins.newp, undefined);

    await manager.devices.selectScope('plugins', keyOf(settings, 'phone'));
    await manager.devices.closeProjection();
    assert.equal(phone.plugins.newp, undefined);

    await manager.devices.selectScope('plugins', keyOf(settings, 'phone'));
    calls.length = 0;
    await manager.overview.setPluginState('newp', { enabled: false });
    await manager.devices.closeProjection();
    assert.equal(phone.plugins.newp.enabled, false);
    assert.equal(calls.some(([action, id]) => ['enable', 'disable', 'runtime-enable', 'runtime-disable'].includes(action) && id === 'newp'), false);
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
    assert.equal(manager.devices.persistedSettings().Plugins.find(plugin => plugin.id === 'a').delay, '');
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
    assert.deepEqual(calls, []); assert.equal(manager.hasUnsavedSettings, true);
});

test('a failed explicit Save retains staged device choices and exposes them as unsaved', async () => {
    const {manager,settings}=await fixture();await manager.devices.setEnabled(true);manager.saveData=async()=>{throw Error('disk full');};
    await manager.devices.assign(manager.devices.id,'tablet');assert.equal(manager.devices.type,'tablet');assert.equal(await manager.savePendingSettings(),false);assert.equal(manager.hasUnsavedSettings,true);
    const preset=firstOf(settings,'computer'),draft=model.clonePreset(preset);draft.plugins.a.enabled=false;await manager.devices.savePresetById(preset.id,draft);
    assert.equal(await manager.savePendingSettings(),false);assert.equal(firstOf(settings,'computer').plugins.a.enabled,false);
    await manager.devices.setEnabled(false);assert.equal(await manager.savePendingSettings(),false);assert.equal(settings.DEVICE_MANAGEMENT.enabled,false);
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
    window.Capacitor = { Plugins: { Device: { getId: async () => ({ identifier: 'android-stable-id' }) } } };
    try {
        const restarted = new DeviceManager(manager);
        await restarted.initialize();
        assert.notEqual(restarted.id, beforeId);
        assert.equal(settings.DEVICE_MANAGEMENT.devices.length, 1);
        assert.equal(settings.DEVICE_MANAGEMENT.devices[0].id, restarted.id);
        assert.equal(restarted.boundPresetId, presetId);
        assert.equal(restarted.type, 'computer');
    } finally {
        delete window.Capacitor;
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

test('multiple configured candidates adopt the bound/first configured preset deterministically', async () => {
    const { manager, settings } = await fixture();
    settings.DEVICE_MANAGEMENT.enabled = true;
    for (const type of ['phone', 'tablet']) {
        const preset = firstOf(settings, type);
        preset.configured = true;
        preset.plugins.a.enabled = false;
    }
    const restarted = new DeviceManager(manager);
    notices.length = 0;
    await restarted.initialize();
    const computer = firstOf(settings, 'computer');
    assert.equal(computer.configured, true);
    assert.equal(computer.plugins.a.enabled, false);
    assert.ok(notices.some(message => String(message).includes('设备_自动复用')));
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

test('quick apply can replace only the selected configuration sections', async () => {
    const { manager, settings } = await fixture();
    const target = firstOf(settings, 'phone');
    target.plugins.a.enabled = true;
    target.filters.search = 'phone';
    target.ribbon[0].visible = false;
    settings.Plugins.find(plugin => plugin.id === 'a').enabled = false;
    settings.FILTER_SEARCH = 'desktop';
    settings.RIBBON_SETTINGS[0].visible = true;

    await manager.devices.quickApply(target.id, 'ribbon', 'window',
        { plugins: false, filters: false, ribbon: true, appearance: false });

    assert.equal(target.plugins.a.enabled, true);
    assert.equal(target.filters.search, 'phone');
    assert.equal(target.ribbon[0].visible, true);
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

test('remote name and type updates win only when their revision is newer', async () => {
    const adapter = memoryAdapter({
        [`${DEVICES_DIR}known.json`]: JSON.stringify({ id: 'known', name: 'Original', type: 'tablet', lastSeen: 9, updatedAt: 100 }),
    });
    const { manager, settings } = await fixture({ adapter });
    await manager.devices.mergeDeviceRecords();
    let record = settings.DEVICE_MANAGEMENT.devices.find(device => device.id === 'known');
    assert.equal(record.name, 'Original');
    adapter.files[`${DEVICES_DIR}known.json`] = JSON.stringify({ id: 'known', name: 'Remote', type: 'phone', lastSeen: 20, updatedAt: 200 });
    notices.length = 0;
    await manager.devices.mergeDeviceRecords();
    record = settings.DEVICE_MANAGEMENT.devices.find(device => device.id === 'known');
    assert.equal(record.name, 'Remote');
    assert.equal(record.type, 'phone');
    assert.ok(notices.some(message => String(message).includes('设备_远程更新')));

    await manager.devices.rename('known', 'Local');
    adapter.files[`${DEVICES_DIR}known.json`] = JSON.stringify({ id: 'known', name: 'Older remote', type: 'computer', lastSeen: 30, updatedAt: 200 });
    await manager.devices.mergeDeviceRecords();
    record = settings.DEVICE_MANAGEMENT.devices.find(device => device.id === 'known');
    assert.equal(record.name, 'Local');
    assert.equal(record.type, 'phone');
});

test('re-enabling device management merges changes made while it was off', async () => {
    const { manager, settings } = await fixture();
    await manager.devices.setEnabled(true);
    await manager.devices.setEnabled(false);
    settings.Plugins.find(plugin => plugin.id === 'a').enabled = false;
    await manager.devices.setEnabled(true);
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'a').enabled, false);
    assert.equal(firstOf(settings, 'computer').plugins.a.enabled, false);
    assert.equal(manager.appPlugins.enabledPlugins.has('a'), false);
});

test('scope selections are remembered per page', async () => {
    const { manager, settings } = await fixture();
    await manager.devices.setEnabled(true);
    await manager.devices.selectScope('themes', keyOf(settings, 'phone'));
    await manager.devices.selectScope('plugins', keyOf(settings, 'tablet'));
    assert.equal(manager.devices.selectedScopeKey('themes'), keyOf(settings, 'phone'));
    assert.equal(manager.devices.selectedScopeKey('plugins'), keyOf(settings, 'tablet'));
    assert.equal(manager.devices.selectedScopeKey('ribbon'), keyOf(settings, 'computer'));
    await manager.devices.bindPreset(manager.devices.boundPresetId);
    assert.equal(manager.devices.selectedScopeKey('themes'), keyOf(settings, 'computer'));
});

test('renaming this device rewrites its own record file', async () => {
    const adapter = memoryAdapter();
    const { manager } = await fixture({ adapter });
    await manager.devices.rename(manager.devices.id, 'Renamed device');
    const own = JSON.parse(adapter.files[`${DEVICES_DIR}${manager.devices.id}.json`]);
    assert.equal(own.name, 'Renamed device');
});

test('a stale or default snapshot cannot replace a preset configured remotely', async () => {
    const adapter = memoryAdapter();
    const { manager } = await fixture({ adapter });
    const path = '.obsidian/plugins/self/data.json';
    adapter.files[path] = JSON.stringify(manager.devices.persistedSettings());
    let writes = 0;
    manager.saveData = async value => { writes++; adapter.files[path] = JSON.stringify(value); };
    await manager.loadSettings();

    const localPreset = manager.settings.DEVICE_MANAGEMENT.presets.computer[0];
    localPreset.configured = true;
    localPreset.plugins.a = { enabled: true, delay: '' };
    localPreset.updatedAt = 200;

    const remote = JSON.parse(adapter.files[path]);
    const stale = remote.DEVICE_MANAGEMENT.presets.computer[0];
    stale.configured = false;
    stale.plugins = {};
    stale.ribbon = [];
    delete stale.updatedAt;
    adapter.files[path] = JSON.stringify(remote);

    const previousWindow = globalThis.window;
    globalThis.window = { addEventListener() {}, removeEventListener() {}, crypto: webcrypto, setTimeout: callback => setTimeout(callback, 0), clearTimeout };
    try {
        manager.onExternalSettingsChange();
        await manager.settingsSaveQueue;
        const protectedPreset = manager.settings.DEVICE_MANAGEMENT.presets.computer[0];
        assert.equal(protectedPreset.configured, true);
        assert.equal(protectedPreset.plugins.a.enabled, true);
        assert.equal(protectedPreset.updatedAt, 200);
        // 外部快照只合并到内存，不再回声写盘；否则会与配置同步插件形成死循环。
        assert.equal(writes, 0);
    } finally { globalThis.window = previousWindow; }
});

test('a newer timestamp cannot silently resolve concurrent presets; an explicit choice can accept it', async () => {
    const adapter = memoryAdapter();
    const { manager } = await fixture({ adapter });
    const path = '.obsidian/plugins/self/data.json';
    adapter.files[path] = JSON.stringify(manager.devices.persistedSettings());
    manager.saveData = async value => { adapter.files[path] = JSON.stringify(value); };
    await manager.loadSettings();

    const localPreset = manager.settings.DEVICE_MANAGEMENT.presets.computer[0];
    localPreset.configured = true;
    localPreset.plugins.a = { enabled: true, delay: '' };
    localPreset.updatedAt = 200;

    const remote = JSON.parse(adapter.files[path]);
    const newer = remote.DEVICE_MANAGEMENT.presets.computer[0];
    newer.configured = true;
    newer.plugins = { b: { enabled: false, delay: '' } };
    newer.updatedAt = 300;
    adapter.files[path] = JSON.stringify(remote);

    const previousWindow = globalThis.window;
    globalThis.window = { addEventListener() {}, removeEventListener() {}, crypto: webcrypto, setTimeout: callback => setTimeout(callback, 0), clearTimeout };
    try {
        manager.onExternalSettingsChange();
        await manager.settingsSaveQueue;
        assert.equal(manager.configProtection.protection.paused, false);
        assert.equal(await manager.savePendingSettings(), false);
        assert.equal(manager.settings.DEVICE_MANAGEMENT.presets.computer[0].updatedAt, 200);
        const editor = {}; manager.beginSettingsEditing(editor);
        await manager.configProtection.choose(remote, manager.configProtection.protection.pendingFiles);
        manager.endSettingsEditing(editor); await manager.settingsSaveQueue;
        assert.equal(await manager.savePendingSettings(), true);
        const mergedPreset = manager.settings.DEVICE_MANAGEMENT.presets.computer[0];
        assert.equal(mergedPreset.updatedAt, 300);
        assert.equal(mergedPreset.plugins.a, undefined);
        assert.equal(mergedPreset.plugins.b.enabled, false);
    } finally { globalThis.window = previousWindow; }
});

test('startup apply does not capture or rewrite presets', async () => {
    const adapter = memoryAdapter();
    const { manager, settings, calls } = await fixture({ adapter });
    settings.DEVICE_MANAGEMENT.enabled = true;
    const before = JSON.stringify(settings.DEVICE_MANAGEMENT.presets);
    calls.length = 0;
    await manager.devices.apply({ refreshViews: false, persist: false });
    assert.equal(calls.some(call => call[0] === 'save'), false);
    assert.equal(JSON.stringify(settings.DEVICE_MANAGEMENT.presets), before);
});

test('rewriting an unchanged device record is skipped', async () => {
    const adapter = memoryAdapter();
    const { manager } = await fixture({ adapter });
    let writes = 0;
    const write = adapter.write.bind(adapter);
    adapter.write = async (path, data) => { writes++; return write(path, data); };
    await manager.devices.persistOwnDevice();
    assert.equal(writes, 0);
});

test('device file changes are merged from adapter events without polling', async () => {
    const adapter = memoryAdapter();
    adapter.onFileChange = () => undefined;
    const { manager } = await fixture({ adapter });
    manager.settings.DEVICE_MANAGEMENT.enabled = true;
    const devices = manager.devices;
    let calls = 0;
    const original = devices.mergeDeviceRecords.bind(devices);
    devices.mergeDeviceRecords = async () => { calls++; return false; };
    try {
        adapter.onFileChange(`${DEVICES_DIR}probe.json`);
        await new Promise(resolve => setTimeout(resolve, 250));
        assert.equal(calls, 1);
        adapter.onFileChange('.obsidian/plugins/self/data/other.json');
        await new Promise(resolve => setTimeout(resolve, 250));
        assert.equal(calls, 1);
    } finally {
        devices.mergeDeviceRecords = original;
        devices.dispose();
    }
});

test('explicit Save rebuilds a foreign projection without capturing its obsolete preview', async () => {
    const { manager, settings } = await fixture();
    settings.DEVICE_MANAGEMENT.enabled = true;
    firstOf(settings, 'phone').plugins.a = { enabled: false, delay: '' };
    await manager.devices.selectScope('plugins', keyOf(settings, 'phone'));
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'a').enabled, false);
    // 模拟明确保存后采用的新配置；The committed live state and selected preset have both changed.
    settings.Plugins.find(plugin => plugin.id === 'a').enabled = false;
    firstOf(settings, 'phone').plugins.a = { enabled: true, delay: 'selected' };
    manager.devices.reconcileAfterExplicitSave();
    assert.equal(manager.devices.isProjectingForeign('plugins'), true);
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'a').enabled, true);
    assert.equal(manager.devices.persistedSettings().Plugins.find(plugin => plugin.id === 'a').enabled, false);
    assert.equal(firstOf(settings, 'phone').plugins.a.delay, 'selected');
    await manager.devices.closeProjection();
    assert.equal(settings.Plugins.find(plugin => plugin.id === 'a').enabled, false);
    assert.equal(firstOf(settings, 'phone').plugins.a.enabled, true);
});

test('current-session operations do not stage settings or configure a persistent preset', async () => {
    const { manager, settings } = await fixture();
    settings.DEVICE_MANAGEMENT.enabled = true;
    manager.app.customCss = { theme: 'Original', enabledSnippets: new Set(), async loadTheme() {}, async loadSnippets() {} };
    const presets = JSON.stringify(settings.DEVICE_MANAGEMENT.presets);
    let staged = 0;
    manager.saveSettings = async () => { staged++; };
    manager.overview.setMode('plugins', 'session');
    manager.overview.setMode('themes', 'session');
    await manager.overview.setPluginState('a', { enabled: false, delay: 'temporary' });
    await manager.overview.writeAppearance({ theme: 'Temporary', snippets: { temporary: true } });
    assert.equal(staged, 0);
    assert.equal(JSON.stringify(settings.DEVICE_MANAGEMENT.presets), presets);
    assert.equal(manager.devices.persistedSettings().Plugins.find(plugin => plugin.id === 'a').enabled, true);
    assert.equal(manager.overview.persistentAppearance(manager.devices.readLiveAppearance(), manager.devices.boundPresetId).theme, 'Original');
});

test('saved selections rebase permanent values without saving unrelated session overrides', async () => {
    const { manager } = await fixture();
    manager.app.customCss = { theme: 'Original', enabledSnippets: new Set(['base']), async loadTheme() {}, async loadSnippets() {} };
    manager.overview.setMode('plugins', 'session');
    manager.overview.setMode('themes', 'session');
    await manager.overview.setPluginState('a', { enabled: false });
    await manager.overview.writeAppearance({ theme: 'Temporary', snippets: { temporary: true } });
    const scope = manager.devices.boundPresetId;
    manager.overview.reconcileSavedState(scope, { a: { enabled: true, delay: 'saved delay' } }, { theme: 'Selected', snippets: { base: false } });
    assert.deepEqual(manager.overview.effectivePlugins({}, scope).a, { enabled: false, delay: 'saved delay' });
    assert.deepEqual(manager.overview.persistentPlugins({}, scope).a, { enabled: true, delay: 'saved delay' });
    assert.deepEqual(manager.overview.persistentAppearance(manager.devices.readLiveAppearance(), scope), { theme: 'Selected', snippets: { base: false } });
    assert.deepEqual(manager.overview.effectiveAppearance({ theme: '', snippets: {} }, scope), { theme: 'Temporary', snippets: { base: false, temporary: true } });
});

test('current-session changes leave the explicit Save control clean while permanent changes mark it dirty', async () => {
    const adapter = memoryAdapter(), { manager, settings } = await fixture({ adapter });
    settings.DEVICE_MANAGEMENT.enabled = true;
    const path = '.obsidian/plugins/self/data.json';
    adapter.files[path] = JSON.stringify(manager.devices.persistedSettings());
    await manager.loadSettings();
    manager.app.customCss = { theme: 'Original', enabledSnippets: new Set(), async loadTheme() {}, async loadSnippets() {} };
    manager.beginSettingsEditing({});
    const shared = adapter.files[path];
    assert.equal(manager.hasUnsavedSettings, false);
    manager.overview.setMode('plugins', 'session');
    manager.overview.setMode('themes', 'session');
    await manager.overview.setPluginState('a', { enabled: false });
    await manager.overview.writeAppearance({ theme: 'Temporary' });
    assert.equal(manager.hasUnsavedSettings, false);
    assert.equal(Object.keys(adapter.files).some(path => path.endsWith('/draft.json')), false);
    assert.equal(adapter.files[path], shared);
    manager.overview.setMode('plugins', 'persistent');
    assert.equal(manager.hasUnsavedSettings, false);
    await manager.overview.setPluginState('a', { enabled: false });
    assert.equal(manager.hasUnsavedSettings, true);
    assert.equal(adapter.files[path], shared);
});

for (const phase of ['marker-written', 'publication-returned']) {
    test(`new edits after ${phase} preserve the committed conflict choice in the next draft`, async () => {
        const adapter = memoryAdapter(), { manager } = await fixture({ adapter });
        const path = '.obsidian/plugins/self/data.json';
        adapter.files[path] = JSON.stringify(manager.devices.persistedSettings());
        await manager.loadSettings();
        manager.beginSettingsEditing({});
        manager.settings.RECENT_INSTALL_DAYS = 14;
        await manager.saveSettings();
        const remote = JSON.parse(adapter.files[path]);
        remote.LANGUAGE = 'fr';
        adapter.files[path] = JSON.stringify(remote);
        assert.equal(await manager.savePendingSettings(), false);
        const selected = structuredClone(manager.devices.persistedSettings());
        selected.LANGUAGE = 'fr';
        await manager.configProtection.choose(selected, manager.configProtection.protection.pendingFiles);
        let newer, injected = false;
        const edit = () => {
            if (injected) return;
            injected = true;
            manager.settings.RECENT_INSTALL_DAYS = 21;
            newer = manager.saveSettings({ captureDevice: false });
        };
        if (phase === 'marker-written') {
            const write = adapter.write.bind(adapter);
            adapter.write = async (target, text) => { await write(target, text); if (target === path) edit(); };
        } else {
            const publish = manager.configProtection.publish.bind(manager.configProtection);
            manager.configProtection.publish = async (...args) => { const result = await publish(...args); edit(); return result; };
        }
        assert.equal(await manager.savePendingSettings(), true);
        await newer;
        await manager.settingsSaveQueue;
        assert.equal(JSON.parse(adapter.files[path]).LANGUAGE, 'fr');
        assert.equal(JSON.parse(adapter.files[path]).RECENT_INSTALL_DAYS, 14);
        assert.equal(manager.settings.LANGUAGE, 'fr');
        assert.equal(manager.settings.RECENT_INSTALL_DAYS, 21);
        assert.equal(manager.hasUnsavedSettings, true);
        const draftPath = Object.keys(adapter.files).find(path => path.endsWith('/draft.json'));
        assert.equal(JSON.parse(adapter.files[draftPath]).value.LANGUAGE, 'fr');
        assert.equal(JSON.parse(adapter.files[draftPath]).value.RECENT_INSTALL_DAYS, 21);
        assert.equal(await manager.savePendingSettings(), true);
        assert.equal(JSON.parse(adapter.files[path]).LANGUAGE, 'fr');
        assert.equal(JSON.parse(adapter.files[path]).RECENT_INSTALL_DAYS, 21);
    });
}
