import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
    stdin: { contents: `export { configItemChangeIndex, configItemChanged } from './src/settings/conflict-choices';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(() => ({}), module, module.exports);
const { configItemChangeIndex, configItemChanged } = module.exports;

const base = {
    LANGUAGE: 'zh',
    RECENT_INSTALL_DAYS: 7,
    TAGS: [{ id: 'tools', name: '工具' }],
    Plugins: [
        { id: 'tasks', enabled: true, delay: '', group: '', tags: [], note: '' },
        { id: 'calendar', enabled: true, delay: '', group: '', tags: [], note: '' },
    ],
    DEVICE_MANAGEMENT: {
        presets: {
            computer: [{ id: 'pc', name: 'PC', updatedAt: 1, plugins: { tasks: { enabled: true } }, appearance: {} }],
            tablet: [], phone: [],
        },
        devices: [],
    },
};

test('changed plugins, presets and settings are indexed for per-item unsaved marks', () => {
    const current = structuredClone(base);
    current.LANGUAGE = 'en';
    current.Plugins[0].enabled = false;
    current.DEVICE_MANAGEMENT.presets.computer[0].plugins.tasks.enabled = false;
    const index = configItemChangeIndex(current, base);
    assert.equal(configItemChanged(index, { kind: 'field', id: 'LANGUAGE' }), true);
    assert.equal(configItemChanged(index, { kind: 'field', id: 'DEBUG' }), false);
    assert.equal(configItemChanged(index, { kind: 'plugin', id: 'tasks' }), true);
    assert.equal(configItemChanged(index, { kind: 'plugin', id: 'calendar' }), false);
    assert.equal(configItemChanged(index, { kind: 'plugin', id: 'tasks', presetId: 'pc' }), true);
    assert.equal(configItemChanged(index, { kind: 'plugin', id: 'calendar', presetId: 'pc' }), false);
    assert.equal(configItemChanged(index, { kind: 'preset', id: 'pc' }), true);
});

test('unchanged metadata, unchanged arrays and added or removed items behave predictably', () => {
    const metadataOnly = structuredClone(base);
    metadataOnly.DEVICE_MANAGEMENT.presets.computer[0].updatedAt = 99;
    let index = configItemChangeIndex(metadataOnly, base);
    assert.equal(configItemChanged(index, { kind: 'preset', id: 'pc' }), false);

    const added = structuredClone(base);
    added.Plugins.push({ id: 'new-plugin', enabled: true, delay: '', group: '', tags: [], note: '' });
    added.TAGS.push({ id: 'startup', name: '启动' });
    index = configItemChangeIndex(added, base);
    assert.equal(configItemChanged(index, { kind: 'plugin', id: 'new-plugin' }), true);
    assert.equal(configItemChanged(index, { kind: 'field', id: 'TAGS' }), true);

    const same = configItemChangeIndex(structuredClone(base), base);
    assert.equal(configItemChanged(same, { kind: 'plugin', id: 'tasks' }), false);
    assert.equal(configItemChanged(same, { kind: 'plugin', id: 'tasks', presetId: 'pc' }), false);
    assert.equal(configItemChanged(same, { kind: 'preset', id: 'pc' }), false);
});
