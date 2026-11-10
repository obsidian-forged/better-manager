import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const built = await build({ stdin: { contents: "export * from './src/settings/config-mode';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('module', 'exports', built.outputFiles[0].text)(module, module.exports);
const { resolveConfigSyncProtection } = module.exports;

test('fresh installs default to the single-file mode', () => {
    assert.equal(resolveConfigSyncProtection(null), false);
    assert.equal(resolveConfigSyncProtection(undefined), false);
});

test('a saved device-local choice always wins', () => {
    assert.equal(resolveConfigSyncProtection({ CONFIG_SYNC_PROTECTION: true }, false), false);
    assert.equal(resolveConfigSyncProtection({ CONFIG_SYNC_PROTECTION: false }, true), true);
    assert.equal(resolveConfigSyncProtection(null, true), true);
    assert.equal(resolveConfigSyncProtection(null, false), false);
});

test('a protected-era file or cache keeps protection when no device choice exists', () => {
    assert.equal(resolveConfigSyncProtection({}), false);
    assert.equal(resolveConfigSyncProtection({ LANGUAGE: 'zh' }), false);
    assert.equal(resolveConfigSyncProtection({}, undefined, true), true);
    assert.equal(resolveConfigSyncProtection({ _bpmRevision: { schema: 1 } }), true);
});

test('an explicit legacy value always wins', () => {
    assert.equal(resolveConfigSyncProtection({ CONFIG_SYNC_PROTECTION: false }), false);
    assert.equal(resolveConfigSyncProtection({ CONFIG_SYNC_PROTECTION: true }), true);
    assert.equal(resolveConfigSyncProtection({ CONFIG_SYNC_PROTECTION: 'true' }), false);
});

test('invalid payloads fall back to the simple path unless a cache exists', () => {
    assert.equal(resolveConfigSyncProtection([]), false);
    assert.equal(resolveConfigSyncProtection('settings'), false);
    assert.equal(resolveConfigSyncProtection([], undefined, true), true);
    assert.equal(resolveConfigSyncProtection('settings', undefined, true), true);
});
