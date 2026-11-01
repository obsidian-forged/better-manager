import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/settings/session-store.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { SettingsSessionStore, mergeSettings } = module.exports;
function fixture(initial = { style: 'cards', name: 'initial' }, cache = null) {
    const state = { shared: structuredClone(initial), cache: structuredClone(cache), sharedWrites: 0, cacheWrites: 0, failShared: false };
    const io = {
        async readShared() { return structuredClone(state.shared); },
        async writeShared(value) { if (state.failShared) throw new Error('disk busy'); state.sharedWrites++; state.shared = structuredClone(value); },
        async readCache() { return structuredClone(state.cache); },
        async writeCache(value) { state.cacheWrites++; state.cache = structuredClone(value); },
        async removeCache() { state.cache = null; },
    };
    return { state, io, store: new SettingsSessionStore(io, 'device-a') };
}
test('an open editor buffers external changes without changing its configuration', async () => {
    const { state, store } = fixture(); const current = await store.load(); store.begin();
    state.shared.style = 'list';
    assert.deepEqual(store.external(state.shared), { changed: true });
    assert.equal(current.style, 'cards');
    assert.deepEqual(store.external({ name: 'initial', style: 'list' }), { changed: false });
    const merged = await store.finish(current);
    assert.equal(merged.style, 'list');
    assert.equal(state.sharedWrites, 0);
});
test('protected edits write only to cache and merge back with independent remote edits on close', async () => {
    const { state, store } = fixture(); const current = await store.load(); store.begin();
    await store.activateCache(current);
    current.name = 'local edit'; state.shared.style = 'list';
    store.external(state.shared); await store.save(current);
    assert.equal(state.sharedWrites, 0); assert.equal(state.cache.value.name, 'local edit');
    assert.equal(store.usingCache, true);
    const merged = await store.finish(current);
    assert.deepEqual(merged, { style: 'list', name: 'local edit' });
    assert.equal(state.cache, null); assert.equal(store.usingCache, false);
});
test('normal saves also preserve remote fields without requiring protection', async () => {
    const { store, state } = fixture(); const current = await store.load(); store.begin();
    current.name = 'local'; state.shared.style = 'remote';
    await store.save(current);
    assert.deepEqual(state.shared, { name: 'local', style: 'remote' });
    current.name = 'second'; await store.save(current);
    assert.equal(state.shared.style, 'remote');
});
test('changes made just before opening the editor are not mistaken for a clean baseline', async () => {
    const { store, state } = fixture(); const current = await store.load();
    current.name = 'newly discovered'; store.begin(); await store.save(current);
    assert.equal(state.shared.name, 'newly discovered');
});
test('merges named presets and plugin records by ID, including independent additions and edits', () => {
    const base = { presets: [{ id: 'computer', plugins: { a: true }, name: 'Computer' }, { id: 'phone', name: 'Phone' }] };
    const local = structuredClone(base); const remote = structuredClone(base);
    local.presets[0].plugins.a = false;
    remote.presets[1].name = 'Mobile'; remote.presets.push({ id: 'tablet', name: 'Tablet' });
    const merged = mergeSettings(base, local, remote);
    assert.equal(merged.presets[0].plugins.a, false);
    assert.equal(merged.presets[1].name, 'Mobile');
    assert.equal(merged.presets[2].id, 'tablet');
});
test('locally deleted records stay deleted while remote independent records survive', () => {
    const base = { records: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] };
    const local = { records: [{ id: 'b', name: 'B' }] };
    const remote = { records: [{ id: 'a', name: 'remote A' }, { id: 'b', name: 'remote B' }, { id: 'c', name: 'C' }] };
    assert.deepEqual(mergeSettings(base, local, remote).records, [{ id: 'b', name: 'remote B' }, { id: 'c', name: 'C' }]);
});
test('failed shared saves retain the recovery cache and the next load recovers it', async () => {
    const { store, state, io } = fixture(); const current = await store.load(); store.begin();
    await store.activateCache(current); current.name = 'recover me'; await store.save(current);
    state.shared.style = 'remote'; state.failShared = true;
    await assert.rejects(store.finish(current), /disk busy/);
    assert.equal(state.cache.value.name, 'recover me'); assert.equal(store.usingCache, true);
    state.failShared = false;
    const next = new SettingsSessionStore(io, 'device-a');
    assert.deepEqual(await next.load(), { name: 'recover me', style: 'remote' });
    assert.equal(state.cache, null);
});
test('a cache from another device is never adopted or overwritten', async () => {
    const cache = { version: 1, owner: 'device-b', base: {}, value: { style: 'foreign' } };
    const { state, store } = fixture(undefined, cache); const current = await store.load();
    assert.equal(current.style, 'cards'); store.begin();
    await assert.rejects(store.activateCache(current), /another device/);
    assert.deepEqual(state.cache, cache);
});
test('reopening during a close keeps cache protection until the final editor closes', async () => {
    const { state, store } = fixture(); const current = await store.load(); store.begin();
    await store.activateCache(current); current.name = 'edit'; await store.save(current);
    assert.equal(await store.finish(current, () => false), undefined);
    assert.equal(store.usingCache, true); assert.notEqual(state.cache, null);
    current.name = 'reopened'; await store.save(current); await store.finish(current);
    assert.equal(state.shared.name, 'reopened'); assert.equal(state.cache, null);
});
