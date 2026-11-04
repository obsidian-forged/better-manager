import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

let response;
const obsidian = {
    Notice: class {},
    debounce: () => Object.assign(() => {}, { cancel() {} }),
    requestUrl: async () => response,
};
const bundle = await build({ stdin: { contents: `
    export { default as Agreement } from './src/agreement';
    export { TroubleshootAlgorithm } from './src/troubleshoot/troubleshoot-algorithm';
    export { cloneState } from './src/troubleshoot/troubleshoot-state';
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'], logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => {
    if (name === 'obsidian') return obsidian;
    throw new Error(`Unexpected module ${name}`);
}, module, module.exports);
const { Agreement, TroubleshootAlgorithm, cloneState } = module.exports;
const jsonResponse = json => ({ status: 200, headers: {}, text: JSON.stringify(json), json });
function fixture() {
    const calls = [], enabledPlugins = new Set(['self', 'a']);
    const manager = { manifest: { id: 'self' }, settings: { Plugins: ['self', 'a', 'b'].map(id => ({ id, enabled: enabledPlugins.has(id) })) },
        translator: { t: text => text }, register: callback => calls.push(['cleanup', callback]),
        async saveSettings() { calls.push(['save']); }, applyRibbonSettings() { calls.push(['ribbon']); },
        appPlugins: { manifests: { self: {}, a: {}, b: {} }, enabledPlugins,
            async enablePluginAndSave(id) { calls.push(['enable', id]); enabledPlugins.add(id); },
            async disablePluginAndSave(id) { calls.push(['disable', id]); enabledPlugins.delete(id); },
            async installPlugin() { calls.push(['install']); } } };
    return { manager, calls };
}

test('troubleshooting uses the typed plugin registry and preserves the manager itself', async () => {
    const { manager, calls } = fixture(), algorithm = new TroubleshootAlgorithm({}, manager);
    assert.deepEqual(algorithm.getEnabledPlugins(), ['a']);
    await algorithm.setEnabledPlugins(['b']);
    assert.deepEqual(calls, [['disable', 'a'], ['enable', 'b'], ['save'], ['ribbon']]);
    assert.deepEqual([...manager.appPlugins.enabledPlugins], ['self', 'b']);
    assert.equal(manager.settings.Plugins.find(item => item.id === 'b').enabled, true);
});

test('troubleshooting state copies never mutate the source history or algorithm branches', () => {
    const { manager } = fixture(), algorithm = new TroubleshootAlgorithm({}, manager), source = algorithm.initState();
    source.history.push({ action: 'test-pair', previousEnabledPlugins: ['a'], suspectPoolSnapshot: ['a', 'b'] });
    source.algorithmState.c1 = ['a']; source.result = { plugin1: 'a', plugin2: 'b' };
    const copied = cloneState(source);
    copied.originalEnabledPlugins.push('b'); copied.history[0].previousEnabledPlugins.length = 0;
    copied.algorithmState.currentSet.length = 0; copied.algorithmState.c1.push('b'); copied.result.plugin1 = 'b';
    assert.deepEqual(source.originalEnabledPlugins, ['a']);
    assert.deepEqual(source.history[0].previousEnabledPlugins, ['a']);
    assert.deepEqual(source.algorithmState.currentSet, ['a']);
    assert.deepEqual(source.algorithmState.c1, ['a']); assert.equal(source.result.plugin1, 'a');
});

test('the community registry narrows unknown entries and rejects invalid container shapes', async () => {
    const { manager } = fixture(), agreement = new Agreement(manager);
    response = jsonResponse([null, { id: '__proto__', repo: 'evil/repo' }, { id: 123 }, { id: 'valid-plugin', repo: 'author/repo', name: 'Valid', downloads: 200 }]);
    await agreement.fetchCommunityPlugins();
    assert.deepEqual(Object.keys(agreement.communityPlugins), ['valid-plugin']);
    assert.equal(agreement.communityPlugins['valid-plugin'].downloads, undefined);
    response = jsonResponse({ unexpected: [] });
    await assert.rejects(agreement.fetchCommunityPlugins(), /Invalid community plugin registry/);
});

test('protocol installation rejects an unrelated downloaded plugin before invoking the native installer', async () => {
    const { manager, calls } = fixture(), agreement = new Agreement(manager);
    agreement.loaded = true; agreement.communityPlugins.a = { id: 'a', repo: 'author/repo' };
    response = jsonResponse({ id: 'other', version: '1.0.0', minAppVersion: '1.5.8' });
    await assert.rejects(agreement.pluginInstall('a', '2.0.0'), /Plugin ID mismatch/);
    assert.equal(calls.some(([name]) => name === 'install'), false);
});

test('registry HTTP failures preserve status information for the caller', async () => {
    const { manager } = fixture(), agreement = new Agreement(manager);
    response = { status: 403, headers: {}, text: JSON.stringify({ message: 'Access denied' }) };
    await assert.rejects(agreement.fetchCommunityPlugins(), /HTTP 403: Access denied/);
});

test('protocol installation leaves a missing enable parameter disabled', async () => {
    const { manager } = fixture(), agreement = new Agreement(manager), calls = [];
    agreement.pluginInstall = async (...args) => { calls.push(args); };
    await agreement.parsePluginInstall({ id: 'a' });
    assert.deepEqual(calls, [['a', '', false, '']]);
});

test('protocol installation preserves explicit enable values and forwards the repository', async () => {
    const { manager } = fixture(), agreement = new Agreement(manager), calls = [];
    agreement.pluginInstall = async (...args) => { calls.push(args); };
    await agreement.parsePluginInstall({ id: 'a', version: 'v2.0.0', enable: '', github: 'author/custom-repo' });
    await agreement.parsePluginInstall({ id: 'a', enable: 'false' });
    assert.deepEqual(calls, [['a', 'v2.0.0', true, 'author/custom-repo'], ['a', '', false, '']]);
});
