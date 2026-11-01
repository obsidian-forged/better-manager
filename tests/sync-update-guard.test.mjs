import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/ui/sync-update-guard.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { SyncUpdateGuard } = module.exports;

test('warns after three external changes within ten seconds and cools down for one minute', () => {
    let now = 1000; const guard = new SyncUpdateGuard(() => now);
    assert.equal(guard.observe(true, true), false);
    now += 2000; assert.equal(guard.observe(true, true), false);
    now += 2000; assert.equal(guard.observe(true, true), true);
    for (let i = 0; i < 6; i++) { now += 500; assert.equal(guard.observe(true, true), false); }
    now += 60_000;
    assert.equal(guard.observe(true, true), false);
    now += 100; assert.equal(guard.observe(true, true), false);
    now += 100; assert.equal(guard.observe(true, true), true);
});
test('hidden views, unchanged content and occasional updates do not warn', () => {
    let now = 0; const guard = new SyncUpdateGuard(() => now);
    for (let i = 0; i < 5; i++) assert.equal(guard.observe(false, true), false);
    assert.equal(guard.observe(true, true), false);
    for (let i = 0; i < 5; i++) assert.equal(guard.observe(true, false), false);
    now += 11_000; assert.equal(guard.observe(true, true), false);
    assert.equal(guard.observe(false, false), false);
    assert.equal(guard.observe(true, true), false);
});
