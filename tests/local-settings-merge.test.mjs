import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const built = await build({ stdin: { contents: "export * from './src/settings/local-settings-merge';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('module', 'exports', built.outputFiles[0].text)(module, module.exports);
const { mergeLocalSettings } = module.exports;

test('keeps local edits and edits from another device when they touch different keys', () => {
    const base = { language: 'en', center: false, groups: [] };
    const edited = { ...base, center: true };
    const remote = { ...base, language: 'zh-cn' };
    const merged = mergeLocalSettings(base, edited, remote);
    assert.equal(merged.center, true);
    assert.equal(merged.language, 'zh-cn');
});

test('local wins when both sides changed the same field', () => {
    const merged = mergeLocalSettings({ center: false }, { center: true }, { center: false, centerNote: 'x' });
    assert.equal(merged.center, true);
    assert.equal(merged.centerNote, 'x');
});

test('untouched local fields adopt external changes and deletions', () => {
    const merged = mergeLocalSettings({ a: 1, b: 2 }, { a: 1, b: 2 }, { a: 9 });
    assert.equal(merged.a, 9);
    assert.equal('b' in merged, false);
});

test('local device records are not blanked by a protected peer', () => {
    const device = { id: 'machine-a', name: 'Desktop', type: 'computer', lastSeen: 5 };
    const base = { DEVICE_MANAGEMENT: { enabled: true, devices: [device] } };
    const edited = { DEVICE_MANAGEMENT: { enabled: true, devices: [device] } };
    const remote = { DEVICE_MANAGEMENT: { enabled: false, devices: [] } };
    const merged = mergeLocalSettings(base, edited, remote);
    assert.equal(merged.DEVICE_MANAGEMENT.enabled, false);
    assert.deepEqual(merged.DEVICE_MANAGEMENT.devices, [device]);
});

test('local device edits win while remote device additions are kept when IDs are unique', () => {
    const local = { id: 'a', name: 'Renamed', type: 'computer', lastSeen: 5 };
    const remoteLocal = { id: 'a', name: 'Old', type: 'computer', lastSeen: 5 };
    const remoteOnly = { id: 'b', name: 'Tablet', type: 'tablet', lastSeen: 9 };
    const base = { DEVICE_MANAGEMENT: { enabled: true, devices: [remoteLocal] } };
    const edited = { DEVICE_MANAGEMENT: { enabled: true, devices: [local] } };
    const remote = { DEVICE_MANAGEMENT: { enabled: true, devices: [remoteLocal, remoteOnly] } };
    const merged = mergeLocalSettings(base, edited, remote);
    // 本机改过的记录保留本机值，远端新增的记录并入；Remote additions survive while local edits win.
    assert.deepEqual(merged.DEVICE_MANAGEMENT.devices, [local, remoteOnly]);
});

test('plugin arrays merge by stable id instead of replacing the whole list', () => {
    const base = { Plugins: [{ id: 'a', enabled: true }, { id: 'b', enabled: true }] };
    const edited = { Plugins: [{ id: 'a', enabled: false }, { id: 'b', enabled: true }] };
    const remote = { Plugins: [{ id: 'a', enabled: true, note: 'remote' }, { id: 'b', enabled: false }] };
    const merged = mergeLocalSettings(base, edited, remote);
    assert.deepEqual(merged.Plugins, [{ id: 'a', enabled: false, note: 'remote' }, { id: 'b', enabled: false }]);
});

test('an unchanged local side adopts the remote configuration wholesale', () => {
    const base = { a: 1 };
    const merged = mergeLocalSettings(base, { ...base }, { a: 2, b: 3 });
    assert.deepEqual(merged, { a: 2, b: 3 });
});
