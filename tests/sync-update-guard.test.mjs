import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/ui/sync-update-guard.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { SyncUpdateGuard } = module.exports;

test('the first external change warns immediately and repeated updates share a one-minute cooldown', () => {
    let now = 1000; const guard = new SyncUpdateGuard(() => now);
    assert.equal(guard.observe(true), true);
    for (let i = 0; i < 6; i++) { now += 500; assert.equal(guard.observe(true), false); }
    now += 60_000;
    assert.equal(guard.observe(true), true);
});
test('local write echoes and unchanged content do not warn or delay the next external warning', () => {
    let now = 0; const guard = new SyncUpdateGuard(() => now);
    for (let i = 0; i < 5; i++) assert.equal(guard.observe(false), false);
    assert.equal(guard.observe(true), true);
    now += 61_000;
    assert.equal(guard.observe(false), false);
    assert.equal(guard.observe(true), true);
});
