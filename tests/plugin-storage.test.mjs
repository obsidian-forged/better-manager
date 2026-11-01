import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({ entryPoints: ['src/storage/plugin-storage.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['obsidian'], write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(() => ({ normalizePath: path => path }), module, module.exports);
const { PluginStorage } = module.exports;
function fixture() {
    const files = new Map(), directories = new Set(['.obsidian/plugins/bpm']);
    let writes = 0;
    const adapter = {
        exists: async path => files.has(path) || directories.has(path),
        mkdir: async path => { assert.ok(directories.has(path.slice(0, path.lastIndexOf('/')))); directories.add(path); },
        read: async path => files.get(path),
        write: async (path, text) => { writes++; files.set(path, text); },
        remove: async path => { files.delete(path); },
    };
    const storage = new PluginStorage({ manifest: { id: 'bpm' }, app: { vault: { configDir: '.obsidian', adapter } } });
    return { storage, files, adapter, writes: () => writes };
}
test('nested runtime directories are created and identical content is not written twice', async () => {
    const f = fixture();
    await f.storage.write('data', 'recovery/local.cache', 'settings');
    await f.storage.write('data', 'recovery/local.cache', 'settings');
    assert.equal(f.writes(), 1);
    assert.equal(await f.storage.read('data', 'recovery/local.cache'), 'settings');
});
test('migration preserves legacy files unless explicitly moving recovery data', async () => {
    const f = fixture(); f.files.set('legacy', 'old');
    assert.equal(await f.storage.read('cache', 'repo.json', ['legacy']), 'old');
    assert.equal(f.files.get('legacy'), 'old');
    await f.storage.read('data', 'recovery/local.cache', ['legacy'], true);
    assert.equal(f.files.has('legacy'), false);
});
test('failed migration verification keeps the legacy recovery file', async () => {
    const f = fixture(); f.files.set('legacy', 'valuable');
    f.adapter.write = async path => { f.files.set(path, 'corrupted'); };
    await assert.rejects(f.storage.read('data', 'recovery/local.cache', ['legacy'], true), /verification/);
    assert.equal(f.files.get('legacy'), 'valuable');
});
test('startup creates the data and cache folders', async () => {
    const f = fixture();
    await f.storage.ensureAreas();
    assert.equal(await f.adapter.exists('.obsidian/plugins/bpm/data'), true);
    assert.equal(await f.adapter.exists('.obsidian/plugins/bpm/cache'), true);
});

test('paths cannot escape the data and cache folders', () => {
    const { storage } = fixture();
    for (const path of ['', '../secret', '/secret', 'x/../../secret', 'x\\secret', 'x/./y', 'x\u0000y']) {
        assert.throws(() => storage.path('data', path), /Invalid/);
    }
});
