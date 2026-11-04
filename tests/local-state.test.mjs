import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/storage/local-state.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent' });
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { LocalStateStore } = module.exports;
const browserStorage = () => {
    const values = new Map();
    return { values, getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const owner = (resource, pluginId = 'self', configDir = '.custom') => ({
    manifest: { id: pluginId },
    app: { vault: { getName: () => 'Same name', configDir, adapter: { getResourcePath: () => resource } } },
});

test('native local state takes priority and retains the app receiver', () => {
    const app = { values: new Map(),
        get vault() { throw new Error('The fallback namespace must not be read'); },
        loadLocalStorage(key) { return this.values.get(key); },
        saveLocalStorage(key, value) { this.values.set(key, value); } };
    const store = new LocalStateStore({ app, manifest: { id: 'self' } }, () => { throw new Error('Fallback storage was used'); });
    store.saveLocalStorage('owner', { id: 'native' });
    assert.deepEqual(store.loadLocalStorage('owner'), { id: 'native' });
    assert.deepEqual(app.values.get('owner'), { id: 'native' });
});

test('legacy storage isolates same-named vaults, plugins and configuration folders', () => {
    const browser = browserStorage(), fallback = () => browser;
    const scopes = [owner('app://local/first-vault/'), owner('app://local/second-vault/'),
        owner('app://local/first-vault/', 'other-plugin'), owner('app://local/first-vault/', 'self', '.alternate')];
    const stores = scopes.map(scope => new LocalStateStore(scope, fallback));
    for (const [index, store] of stores.entries()) store.saveLocalStorage('bpm-config-anchor-owner', { index });
    for (const [index, scope] of scopes.entries()) {
        assert.deepEqual(new LocalStateStore(scope, fallback).loadLocalStorage('bpm-config-anchor-owner'), { index });
    }
    assert.equal(browser.values.size, scopes.length);
});

test('legacy storage has a vault-name fallback and explicitly removes undefined values', () => {
    const browser = browserStorage(), scope = owner('');
    delete scope.app.vault.adapter;
    const store = new LocalStateStore(scope, () => browser);
    store.saveLocalStorage('device', null);
    assert.equal(browser.values.size, 1);
    assert.equal(store.loadLocalStorage('device'), null);
    store.saveLocalStorage('device', undefined);
    assert.equal(browser.values.size, 0);
    assert.equal(store.loadLocalStorage('device'), null);
});

test('storage, serialization and corrupt JSON failures reach the caller', () => {
    const denied = new Error('Storage denied'), scope = owner('app://local/test/');
    const unavailable = new LocalStateStore(scope, () => { throw denied; });
    assert.throws(() => unavailable.loadLocalStorage('owner'), error => error === denied);
    assert.throws(() => unavailable.saveLocalStorage('owner', 'value'), error => error === denied);
    const browser = browserStorage(), store = new LocalStateStore(scope, () => browser);
    store.saveLocalStorage('owner', 'valid');
    const key = [...browser.values.keys()][0]; browser.values.set(key, '{broken');
    assert.throws(() => store.loadLocalStorage('owner'), SyntaxError);
    const circular = {}; circular.self = circular;
    assert.throws(() => store.saveLocalStorage('owner', circular), TypeError);
    assert.throws(() => store.saveLocalStorage('owner', () => {}), /cannot be serialized/);
});
