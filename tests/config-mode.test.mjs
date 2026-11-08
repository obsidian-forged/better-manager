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

test('legacy settings without the key keep configuration sync protection', () => {
    assert.equal(resolveConfigSyncProtection({}), true);
    assert.equal(resolveConfigSyncProtection({ LANGUAGE: 'zh' }), true);
});

test('an explicit value always wins', () => {
    assert.equal(resolveConfigSyncProtection({ CONFIG_SYNC_PROTECTION: false }), false);
    assert.equal(resolveConfigSyncProtection({ CONFIG_SYNC_PROTECTION: true }), true);
    assert.equal(resolveConfigSyncProtection({ CONFIG_SYNC_PROTECTION: 'true' }), false);
});

test('invalid payloads fall back to the simple path', () => {
    assert.equal(resolveConfigSyncProtection([]), false);
    assert.equal(resolveConfigSyncProtection('settings'), false);
});
