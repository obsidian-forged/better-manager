import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const compiled = await build({ stdin: { contents: `export * from './src/settings/config-files'; export * from './src/settings/config-protection';`,
    resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const module = { exports: {} }; new Function('module', 'exports', compiled.outputFiles[0].text)(module, module.exports);
const { ConfigFiles, ConfigProtection } = module.exports;
const root = '.obsidian/plugins/bpm', hash = async text => createHash('sha256').update(text).digest('hex');

async function fixture(removeIcons = false) {
    const files = new Map([[`${root}/data.json`, '{"name":"before"}'], [`${root}/data/icons.css`, 'before-icons'],
        [`${root}/data/devices/phone.json`, JSON.stringify({ id: 'phone', name: 'Before phone', type: 'phone', lastSeen: 1, updatedAt: 1 })]]);
    const folders = new Set(), writes = [];
    let anchor, inject = () => {};
    for (const path of files.keys()) { const parts = path.split('/'); parts.pop(); while (parts.length) { folders.add(parts.join('/')); parts.pop(); } }
    const adapter = {
        async exists(path) { return files.has(path) || folders.has(path); },
        async read(path) { assert.ok(files.has(path)); return files.get(path); },
        async write(path, text) { inject(path, 'before'); files.set(path, text); writes.push(path); inject(path, 'after'); },
        async mkdir(path) { folders.add(path); },
        async remove(path) { inject(path, 'before'); files.delete(path); writes.push(path); inject(path, 'after'); },
        async list(path) { return { files: [...files.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')),
            folders: [...folders].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')) }; },
    };
    const local = { read: () => structuredClone(anchor), write: value => { inject('local-anchor', 'before'); anchor = structuredClone(value); inject('local-anchor', 'after'); } };
    function reopen() {
        const io = new ConfigFiles(adapter, '.obsidian', 'bpm', 'device-a', hash, local);
        return { io, store: new ConfigProtection(io, 'device-a', hash) };
    }
    const { io, store } = reopen(), value = await store.load(); store.begin(value); value.name = 'after';
    store.stageFile('data/icons.css', removeIcons ? null : 'after-icons', true);
    store.stageFile('data/devices/phone.json', JSON.stringify({ id: 'phone', name: 'After phone', type: 'phone', lastSeen: 1, updatedAt: 2 }), true);
    await store.stage(value); writes.length = 0;
    return { files, writes, adapter, io, store, value, reopen, inject: callback => { inject = callback; } };
}

for (const removeIcons of [false, true]) test(`each ${removeIcons ? 'deletion' : 'write'} and anchor failure preserves a recoverable multi-file Save`, async t => {
    const sample = await fixture(removeIcons), operations = [];
    sample.inject((path, phase) => { if (phase === 'before') operations.push(path); });
    assert.equal((await sample.store.publish(sample.value, sample.store.current.files, () => true)).status, 'saved');
    for (let index = 0; index < operations.length; index++) for (const phase of ['before', 'after']) {
        await t.test(`${index + 1}/${operations.length} ${operations[index].includes('/.bpm/') ? 'private snapshot' : operations[index]}: ${phase}`, async () => {
            const f = await fixture(removeIcons); let count = -1, failed = false;
            f.inject((path, point) => {
                if (point === 'before') count++;
                if (!failed && count === index && point === phase) { failed = true; throw new Error('Injected I/O failure'); }
            });
            await assert.rejects(f.store.publish(f.value, f.store.current.files, () => true), /Injected I\/O failure/);
            f.inject(() => {});
            const recovered = f.reopen(); await recovered.io.recoverPreparedCommit();
            const value = await recovered.store.load(); assert.equal(value.name, 'after');
            const result = await recovered.store.publish(value, recovered.store.current.files, () => true);
            assert.ok(['saved', 'noop'].includes(result.status));
            assert.equal(JSON.parse(f.files.get(`${root}/data.json`)).name, 'after');
            assert.equal(f.files.get(`${root}/data/icons.css`), removeIcons ? undefined : 'after-icons');
            assert.equal(JSON.parse(f.files.get(`${root}/data/devices/phone.json`)).name, 'After phone');
            assert.equal(recovered.io.hasPendingTransaction, false);
            const fresh = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-new', hash, { read: () => undefined, write() {} });
            assert.equal((await fresh.readShared()).value.name, 'after');
        });
    }
});
