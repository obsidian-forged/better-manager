import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { randomUUID, webcrypto } from 'node:crypto';

globalThis.window = { addEventListener() {}, removeEventListener() {}, crypto: webcrypto };
const nativeRequire = createRequire(import.meta.url);
class NativeBase {}
const notices = [];
const obsidian = { normalizePath: path => path, Platform: { isMobileApp: false, isTablet: false },
    Plugin: NativeBase, Modal: NativeBase, SuggestModal: NativeBase, PluginSettingTab: NativeBase,
    Notice: class { constructor(message) { notices.push(message); } } };
async function load(entry) {
    const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false,
        external: ['obsidian', 'electron'], loader: { '.webp': 'dataurl' }, logLevel: 'silent' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'crypto', result.outputFiles[0].text)(name =>
        name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), module, module.exports, { randomUUID });
    return module.exports;
}
const { default: Manager } = await load('src/main.ts');
const { DEFAULT_SETTINGS } = await load('src/settings/data.ts');
const { CONFIG_LOCAL_ESTABLISHED_STORAGE_KEY, CONFIG_MODE_STORAGE_KEY, CONFIG_CLEANUP_STORAGE_KEY } = await load('src/settings/config-mode.ts');

const disk = (overrides = {}) => ({ ...structuredClone(DEFAULT_SETTINGS), ...overrides });

function storage(appLocals) {
    return { loadLocalStorage: key => appLocals.get(key), saveLocalStorage: (key, value) => { appLocals.set(key, value); } };
}
async function localFixture(initial = disk(), existingLocals) {
    const manager = new Manager();
    let stored = structuredClone(initial);
    const writes = [], locals = existingLocals ?? new Map([[CONFIG_MODE_STORAGE_KEY, 'off']]);
    manager.settings = structuredClone(initial ?? disk());
    manager.translator = { t: key => key };
    manager.manifest = { id: 'self' };
    manager.app = { vault: { getName: () => 'test', configDir: '.obsidian', adapter: {
        exists: async path => path.endsWith('/data.json') && stored !== null,
    } }, ...storage(locals) };
    manager.appPlugins = { enabledPlugins: new Set() };
    manager.loadData = async () => structuredClone(stored);
    manager.saveData = async value => { writes.push(structuredClone(value)); stored = structuredClone(value); };
    manager.reportError = (context, error) => { manager.syncErrors = manager.syncErrors || []; manager.syncErrors.push({ context, error }); };
    await manager.loadSettings();
    return {
        manager, writes, locals,
        disk: () => stored,
        replaceDisk(value) { stored = structuredClone(value); },
    };
}

test('manual save merges external fields and adopts them so a later save does not revert', async () => {
    const f = await localFixture(), { manager } = f;
    manager.settings.SEARCH = 'local edit';
    await manager.saveSettings({ captureDevice: false });
    f.replaceDisk(disk({ RECENT_INSTALL_DAYS: 21 }));
    assert.equal(await manager.savePendingSettings(), true);
    assert.equal(f.disk().SEARCH, 'local edit');
    assert.equal(f.disk().RECENT_INSTALL_DAYS, 21);
    assert.equal(manager.settings.RECENT_INSTALL_DAYS, 21, 'the external value is adopted into memory');
    // 后续保存必须保留外部值，不能被陈旧内存改回去；A later save must keep the external value.
    manager.settings.CENTER = true;
    await manager.saveSettings({ captureDevice: false });
    assert.equal(await manager.savePendingSettings(), true);
    assert.equal(f.disk().RECENT_INSTALL_DAYS, 21);
    assert.equal(f.disk().CENTER, true);
    assert.equal(manager.settings.RECENT_INSTALL_DAYS, 21);
});

test('queued automatic saves use current memory so an earlier merge is not overwritten', async () => {
    const f = await localFixture(), { manager } = f;
    f.replaceDisk(disk({ RECENT_INSTALL_DAYS: 21 }));
    manager.settings.FILTER_SEARCH = 'first';
    const first = manager.saveSettings({ automatic: true });
    manager.settings.FILTER_SEARCH = 'second';
    const second = manager.saveSettings({ automatic: true });
    await Promise.all([first, second]);
    assert.equal(f.disk().FILTER_SEARCH, 'second');
    assert.equal(f.disk().RECENT_INSTALL_DAYS, 21);
    assert.equal(manager.settings.RECENT_INSTALL_DAYS, 21);
});

test('uses the atomic adapter.process when the file exists and merges inside it', async () => {
    const f = await localFixture(), { manager } = f;
    let text = JSON.stringify(f.disk());
    let calls = 0;
    manager.app.vault.adapter = {
        exists: async () => true,
        process: async (path, fn) => { calls++; const next = fn(text); text = next; return next; },
    };
    manager.loadData = async () => JSON.parse(text);
    text = JSON.stringify(disk({ RECENT_INSTALL_DAYS: 66 }));
    manager.settings.SEARCH = 'local via process';
    await manager.saveSettings({ captureDevice: false });
    assert.equal(await manager.savePendingSettings(), true);
    const written = JSON.parse(text);
    assert.equal(calls, 1);
    assert.equal(written.SEARCH, 'local via process');
    assert.equal(written.RECENT_INSTALL_DAYS, 66);
});

test('a partial external file cannot remove device management during a merge', async () => {
    const management = { enabled: false, defaultPresets: { computer: 'c', tablet: '', phone: '' },
        presets: { computer: [], tablet: [], phone: [] }, devices: [] };
    const f = await localFixture(disk({ DEVICE_MANAGEMENT: management })), { manager } = f;
    f.replaceDisk({ CENTER: false, SEARCH: '' });
    manager.settings.CENTER = true;
    await manager.saveSettings({ captureDevice: false });
    assert.equal(await manager.savePendingSettings(), true);
    assert.ok(manager.settings.DEVICE_MANAGEMENT, 'device management must survive a partial external file');
});

test('automatic saves never recreate a previously established file that is temporarily missing or empty', async () => {
    for (const missing of [null, {}]) {
        const f = await localFixture(), { manager } = f;
        assert.equal(f.locals.get(CONFIG_LOCAL_ESTABLISHED_STORAGE_KEY), 'yes');
        manager.settings.RECENT_INSTALL_DAYS = 14;
        f.replaceDisk(missing);
        await manager.saveSettings({ captureDevice: false, automatic: true });
        assert.deepEqual(f.disk(), missing);
        manager.settings.CENTER = true;
        await manager.saveSettings({ captureDevice: false });
        assert.equal(await manager.savePendingSettings(), false, 'an explicit retry cannot treat a known file as a new install');
        assert.deepEqual(f.disk(), missing);
        assert.equal(manager.hasUnsavedSettings, true, 'the attempted edit remains pending');
    }
});

test('an automatic startup save does not create a new data.json, but an explicit first save can', async () => {
    const f = await localFixture(null), { manager } = f;
    manager.settings.CENTER = true;
    await manager.saveSettings({ captureDevice: false, automatic: true });
    assert.equal(f.disk(), null);
    assert.equal(f.writes.length, 0);
    assert.equal(manager.hasUnsavedSettings, true, 'the blocked automatic write remains visible as pending');
    await manager.saveSettings({ captureDevice: false });
    assert.equal(await manager.savePendingSettings(), true);
    assert.equal(f.disk().CENTER, true);
    assert.equal(f.locals.get(CONFIG_LOCAL_ESTABLISHED_STORAGE_KEY), 'yes');
});

test('automatic saves stay pending with sync enabled and explicit Save merges the latest file', async () => {
    const f = await localFixture(), { manager } = f;
    manager.syncServiceDetected = true;
    manager.settings.CENTER = true;
    await manager.saveSettings({ captureDevice: false, automatic: true });
    assert.equal(f.disk().CENTER, disk().CENTER);
    assert.equal(manager.hasUnsavedSettings, true);
    f.replaceDisk(disk({ RECENT_INSTALL_DAYS: 73 }));
    await manager.saveSettings({ captureDevice: false });
    assert.equal(await manager.savePendingSettings(), true);
    assert.equal(f.disk().CENTER, true);
    assert.equal(f.disk().RECENT_INSTALL_DAYS, 73);
});

test('converting a protected file in single-machine mode waits for explicit Save when sync is enabled', async () => {
    const legacy = disk({ CENTER: true, _bpmRevision: { id: 'old-protected-revision' } });
    const f = await localFixture(legacy), { manager } = f;
    manager.syncServiceDetected = true;
    manager.settings.CENTER = false;
    await manager.saveSettings({ captureDevice: false, automatic: true });
    assert.deepEqual(f.disk(), legacy);
    await manager.saveSettings({ captureDevice: false });
    f.replaceDisk(disk({ RECENT_INSTALL_DAYS: 73, _bpmRevision: { id: 'old-protected-revision' } }));
    assert.equal(await manager.savePendingSettings(), true);
    assert.equal(f.disk().CENTER, false);
    assert.equal(f.disk().RECENT_INSTALL_DAYS, 73);
    assert.equal(f.disk()._bpmRevision, undefined);
});

test('a failed sync check keeps automatic settings changes pending', async () => {
    const f = await localFixture(), { manager } = f;
    manager.syncServiceDetectionFailed = true;
    manager.settings.CENTER = true;
    await manager.saveSettings({ captureDevice: false, automatic: true });
    assert.equal(f.disk().CENTER, disk().CENTER);
    assert.equal(manager.hasUnsavedSettings, true);
});

test('an unverified missing-file state is never treated as a fresh install', async () => {
    const f = await localFixture(null), { manager } = f;
    manager.app.vault.adapter.exists = async () => { throw new Error('adapter unavailable'); };
    await manager.loadSettings();
    assert.equal(manager.localSettingsFresh, false);
    manager.settings.CENTER = true;
    await manager.saveSettings({ captureDevice: false, automatic: true });
    await manager.saveSettings({ captureDevice: false });
    assert.equal(await manager.savePendingSettings(), false);
    assert.equal(f.disk(), null);
});

test('the FNS plugin is detected before the warning dialog runs', async () => {
    const manager = new Manager();
    manager.app = { vault: { configDir: '.obsidian', adapter: {
        exists: async () => false,
        read: async () => { throw new Error('core plugin list should not be read'); },
    } } };
    manager.appPlugins = { enabledPlugins: new Set(['fast-note-sync']) };
    assert.equal(await manager.hasEnabledSyncService(), true);
});

test('an FNS plugin enabled after startup is detected before a background write', async () => {
    const f = await localFixture(), { manager } = f;
    manager.appPlugins.enabledPlugins.add('fast-note-sync');
    manager.settings.CENTER = true;
    await manager.saveSettings({ captureDevice: false, automatic: true });
    assert.equal(f.disk().CENTER, disk().CENTER);
    assert.equal(manager.hasUnsavedSettings, true);
});

test('the established-file guard survives a plugin restart while the shared file is missing', async () => {
    const first = await localFixture();
    const reopened = await localFixture(null, first.locals);
    reopened.manager.settings.SEARCH = 'stale local value';
    await reopened.manager.saveSettings({ captureDevice: false, automatic: true });
    assert.equal(reopened.disk(), null);
    assert.equal(reopened.writes.length, 0);
    await reopened.manager.saveSettings({ captureDevice: false });
    assert.equal(await reopened.manager.savePendingSettings(), false);
    assert.equal(reopened.disk(), null);
});

test('an atomic writer that observes a missing file cancels without falling back to saveData', async () => {
    const f = await localFixture(), { manager } = f;
    let text = JSON.stringify(f.disk()), calls = 0;
    manager.app.vault.adapter = {
        exists: async path => path.endsWith('/data.json'),
        process: async (path, update) => { calls++; return update(''); },
    };
    manager.loadData = async () => text.trim() ? JSON.parse(text) : null;
    manager.saveData = async value => { f.writes.push(structuredClone(value)); text = JSON.stringify(value); };
    manager.settings.SEARCH = 'must remain pending';
    await manager.saveSettings({ automatic: true, captureDevice: false });
    assert.equal(calls, 1);
    assert.equal(text, JSON.stringify(f.disk()));
    assert.equal(f.writes.length, 0);
});

test('an idle local session adopts external changes without writing', async () => {
    const f = await localFixture(), { manager } = f;
    const before = f.writes.length;
    f.replaceDisk(disk({ RECENT_INSTALL_DAYS: 55 }));
    manager.onExternalSettingsChange();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(manager.settings.RECENT_INSTALL_DAYS, 55);
    assert.equal(f.writes.length, before, 'adoption must not publish a write');
});

test('an external preset update wins over a skewed local wall-clock timestamp without a write echo', async () => {
    const preset = { id: 'computer', name: 'Computer', configured: true, updatedAt: 900,
        plugins: { tasks: { enabled: true, delay: '' } }, ribbon: [], ribbonGroups: [], ribbonEnabled: false,
        filters: {}, appearance: { theme: '', snippets: {} } };
    const initial = disk({ DEVICE_MANAGEMENT: { enabled: true, defaultPresets: { computer: 'computer', phone: '', tablet: '' },
        presets: { computer: [preset], phone: [], tablet: [] }, devices: [] } });
    const f = await localFixture(initial), { manager } = f;
    const remote = structuredClone(f.disk());
    remote.DEVICE_MANAGEMENT.presets.computer[0].updatedAt = 10;
    remote.DEVICE_MANAGEMENT.presets.computer[0].plugins.tasks.enabled = false;
    f.replaceDisk(remote);
    manager.onExternalSettingsChange();
    await new Promise(resolve => setImmediate(resolve));
    const adopted = manager.settings.DEVICE_MANAGEMENT.presets.computer[0];
    assert.equal(adopted.updatedAt, 10);
    assert.equal(adopted.plugins.tasks.enabled, false);
    assert.equal(f.writes.length, 0);
});

test('automatic save merges external fields and adopts them', async () => {
    const f = await localFixture(), { manager } = f;
    manager.settings.FILTER_SEARCH = 'probe';
    f.replaceDisk(disk({ RECENT_INSTALL_DAYS: 33 }));
    await manager.saveSettings({ automatic: true });
    assert.equal(f.disk().FILTER_SEARCH, 'probe');
    assert.equal(f.disk().RECENT_INSTALL_DAYS, 33);
    assert.equal(manager.settings.RECENT_INSTALL_DAYS, 33);
});

test('a change arriving after the merge read aborts the save instead of being overwritten', async () => {
    const f = await localFixture(), { manager } = f;
    manager.settings.SEARCH = 'pending';
    await manager.saveSettings({ captureDevice: false });
    const read = manager.loadData;
    const before = f.writes.length;
    let reads = 0;
    manager.loadData = async () => {
        if (++reads === 2) f.replaceDisk(disk({ RECENT_INSTALL_DAYS: 99 }));
        return read();
    };
    assert.equal(await manager.savePendingSettings(), false);
    assert.equal(f.writes.length, before);
    assert.equal(f.disk().RECENT_INSTALL_DAYS, 99);
    assert.equal(manager.hasUnsavedSettings, true);
});

test('the effective protection mode follows the live session, not the pending preference', async () => {
    const f = await localFixture(), { manager } = f;
    assert.equal(manager.configSyncProtectionSetting, false);
    assert.equal(manager.configSyncProtectionEnabled, false);
    assert.equal(manager.configSyncProtectionPendingRestart, false);
    assert.equal(await manager.setConfigSyncProtection(true, false), true);
    assert.equal(manager.configSyncProtectionSetting, true);
    assert.equal(f.locals.get(CONFIG_MODE_STORAGE_KEY), 'on');
    assert.equal(manager.configSyncProtectionEnabled, false);
    assert.equal(manager.configSyncProtectionPendingRestart, true);
    manager.configProtection = {};
    assert.equal(manager.configSyncProtectionEnabled, true);
    assert.equal(manager.configSyncProtectionPendingRestart, false);
    assert.equal(await manager.setConfigSyncProtection(false, false), true);
    assert.equal(manager.configSyncProtectionPendingRestart, true);
});

test('the protection switch never writes data.json', async () => {
    const f = await localFixture(), { manager } = f;
    const before = f.writes.length;
    await manager.setConfigSyncProtection(true, false);
    await manager.setConfigSyncProtection(false, true);
    assert.equal(f.writes.length, before, 'the device-local switch must not publish shared settings');
    assert.equal(f.locals.get(CONFIG_CLEANUP_STORAGE_KEY), true);
});

test('disabling protection defers cache deletion to the next local start', async () => {
    const manager = new Manager();
    const locals = new Map([[CONFIG_MODE_STORAGE_KEY, 'on'], ["bpm-settings-cache-owner", "device-owner-1"]]);
    let stored = disk(), writes = [];
    manager.settings = structuredClone(stored);
    manager.translator = { t: key => key };
    manager.manifest = { id: 'self' };
    manager.app = { vault: { getName: () => 'test', configDir: '.obsidian' }, ...storage(locals) };
    manager.loadData = async () => structuredClone(stored);
    manager.saveData = async value => { writes.push(structuredClone(value)); stored = structuredClone(value); };
    manager.reportError = (context, error) => { manager.syncErrors = manager.syncErrors || []; manager.syncErrors.push({ context, error }); };
    manager.configProtection = {
        save: async () => undefined,
        publish: async value => { await manager.saveData(value); return { status: 'saved', value }; },
        discardDraft: async () => undefined,
        beginUserAction: () => () => undefined,
        stageFile: async () => false,
        readFile: async () => undefined,
    };
    manager.protectionPreference = true;
    const removed = [];
    manager.app.vault.adapter = {
        exists: async path => path.includes('/.bpm'),
        rmdir: async (path, recursive) => { removed.push([path, recursive]); },
    };
    assert.equal(await manager.setConfigSyncProtection(false, true), true);
    assert.equal(locals.get(CONFIG_MODE_STORAGE_KEY), 'off');
    assert.equal(locals.get(CONFIG_CLEANUP_STORAGE_KEY), true);
    assert.deepEqual(removed, [], 'the running protected session still owns the cache');
    assert.equal(writes.length, 0, 'switching modes must not rewrite data.json');
    // 模拟下次以单机模式启动：这时才删除缓存。Simulate the next local start.
    const next = new Manager();
    const removedLater = [];
    next.settings = structuredClone(disk());
    next.translator = { t: key => key };
    next.manifest = { id: 'self' };
    next.app = { vault: { getName: () => 'test', configDir: '.obsidian' }, ...storage(locals) };
    next.app.vault.adapter = {
        exists: async path => path.includes('/.bpm'),
        rmdir: async (path, recursive) => { removedLater.push([path, recursive]); },
    };
    next.loadData = async () => structuredClone(stored);
    next.saveData = async value => { stored = structuredClone(value); };
    next.reportError = (context, error) => { next.syncErrors = next.syncErrors || []; next.syncErrors.push({ context, error }); };
    await next.loadSettings();
    assert.deepEqual(removedLater, [['.obsidian/plugins/self/.bpm/device-owner-1', true]]);
    assert.equal(locals.get(CONFIG_CLEANUP_STORAGE_KEY), false);
    assert.equal(next.configProtection, undefined);
});
