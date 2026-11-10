import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';

globalThis.window = { crypto: webcrypto, setTimeout, clearTimeout };
const hash = async text => createHash('sha256').update(text).digest('hex');
const bundle = await build({ stdin: { contents: `export * from './src/settings/protected-session'; export * from './src/settings/config-revision';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', external: ['obsidian'], write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => {
    if (name === 'obsidian') return { Notice: class {} };
    throw new Error(`Unexpected test dependency: ${name}`);
}, module, module.exports);
const { ProtectedConfigSession, createConfigRevision, encodeConfig } = module.exports;
const root = '.obsidian/plugins/better-plugins-manager';

async function fixture(t) {
    const local = { LANGUAGE: 'en', RECENT_INSTALL_DAYS: 7, Plugins: [{ id: 'tasks', enabled: true, note: 'local' }],
        DEVICE_MANAGEMENT: { enabled: true, defaultPresets: { computer: 'computer', phone: 'phone', tablet: '' }, presets: {
            computer: [{ id: 'computer', name: 'Computer', plugins: { tasks: { enabled: true } } }],
            phone: [{ id: 'phone', name: 'Phone', plugins: { tasks: { enabled: true } } }, { id: 'removed', name: 'Local only', plugins: {} }], tablet: [],
        } } };
    const localFiles = { 'data/icons.css': 'local icons', 'data/devices/removed.json': '{"id":"removed","name":"Local device"}' };
    const files = { [`${root}/data.json`]: JSON.stringify(local), ...Object.fromEntries(Object.entries(localFiles).map(([path, value]) => [`${root}/${path}`, value])) };
    const writes = [], locals = new Map();
    const adapter = {
        async exists(path) { return path in files || Object.keys(files).some(file => file.startsWith(`${path}/`)); },
        async mkdir() {},
        async list(path) { return { files: Object.keys(files).filter(file => file.startsWith(`${path}/`)), folders: [] }; },
        async read(path) { if (!(path in files)) throw new Error(`ENOENT: ${path}`); return files[path]; },
        async write(path, text) { writes.push(path); files[path] = text; },
        async remove(path) { writes.push(path); delete files[path]; },
        async stat(path) { return path in files ? { type: 'file' } : null; },
    };
    const manager = { settings: structuredClone(local), manifest: { id: 'better-plugins-manager' },
        app: { vault: { configDir: '.obsidian', adapter }, loadLocalStorage: key => locals.get(key), saveLocalStorage: (key, value) => { locals.set(key, value); } },
        async loadData() { return JSON.parse(files[`${root}/data.json`]); } };
    const session = new ProtectedConfigSession(manager, 'local-device', value => structuredClone(value), () => {});
    t.after(() => session.destroy());
    manager.settings = await session.load(); session.begin();
    manager.settings.RECENT_INSTALL_DAYS = 14; await session.save(manager.settings);
    const incoming = structuredClone(local);
    incoming.LANGUAGE = 'fr'; incoming.Plugins[0].enabled = false; incoming.Plugins[0].note = 'remote';
    incoming.DEVICE_MANAGEMENT.presets.computer[0].plugins.tasks.enabled = false;
    incoming.DEVICE_MANAGEMENT.presets.phone = [{ id: 'phone', name: 'Remote phone', plugins: { tasks: { enabled: false } } }];
    const incomingFiles = { 'data/icons.css': 'remote icons', 'data/devices/removed.json': null, 'data/devices/added.json': '{"id":"added","name":"Remote device"}' };
    async function incomingRevision(value = incoming, parent = session.protection.current) {
        const snapshot = await createConfigRevision(value, 'remote-device', [parent], await session.files.fileDigests(incomingFiles), hash);
        for (const [path, text] of Object.entries(incomingFiles)) {
            if (text === null) delete files[`${root}/${path}`]; else files[`${root}/${path}`] = text;
        }
        files[`${root}/data.json`] = JSON.stringify(encodeConfig(snapshot));
        return snapshot;
    }
    await incomingRevision();
    assert.equal((await session.publish(manager.settings, () => true)).status, 'conflict');
    return { session, manager, files, writes, adapter, localFiles, incoming, incomingFiles, incomingRevision,
        sharedWrites: () => writes.filter(path => !path.includes('/.bpm/')) };
}

for (const side of ['local', 'incoming']) test(`one ${side} action stages the configuration choice; generated files follow policy`, async t => {
    const f = await fixture(t), { session } = f;
    const choices = await session.prepareConflictChoices();
    choices.toggleItem({ kind: 'plugin', id: 'tasks', presetId: 'phone' });
    assert.equal(choices.allSide(), 'mixed');
    const expectedId = session.protection.conflict.id, epoch = session.mutationEpoch;
    const before = f.files[`${root}/data.json`], sharedWrites = f.sharedWrites().length, baseline = structuredClone(f.manager.settings);
    const calls = [];
    const choose = session.protection.choose.bind(session.protection), stage = session.protection.stage.bind(session.protection);
    session.protection.choose = (value, files) => { calls.push('choose'); return choose(value, files); };
    session.protection.stage = async value => { calls.push('stage'); return stage(value); };
    await session.confirmAllConflictChoices(side, expectedId);
    assert.deepEqual(calls, ['choose', 'stage']);
    assert.equal(session.mutationEpoch, epoch + 1);
    assert.deepEqual(session.resolvedBaseline, baseline);
    assert.equal(choices.allSide(), side);
    assert.equal(session.protection.paused, false);
    const selected = session.protection.confirmedSelection;
    assert.deepEqual(selected.value, side === 'incoming' ? f.incoming : baseline);
    assert.deepEqual(selected.files, {
        'data/icons.css': side === 'incoming' ? 'remote icons' : 'local icons',
        'data/devices/removed.json': f.localFiles['data/devices/removed.json'],
        'data/devices/added.json': null,
    });
    assert.equal(f.files[`${root}/data.json`], before);
    assert.equal(f.sharedWrites().length, sharedWrites);
    const published = await session.publish(f.manager.settings, () => true);
    assert.ok(['saved', 'noop'].includes(published.status));
    assert.deepEqual(published.value, selected.value);
    assert.equal(session.resolvedBaseline, undefined);
    assert.equal(f.files[`${root}/data/icons.css`], side === 'incoming' ? 'remote icons' : 'local icons');
    assert.equal(`${root}/data/devices/removed.json` in f.files, true);
    assert.equal(`${root}/data/devices/added.json` in f.files, false);
});

for (const mode of ['all-source', 'individual']) test(`a conflict replaced while file copies are loading rejects the old ${mode} action without choosing the new conflict`, async t => {
    const f = await fixture(t), { session } = f;
    const conflict = session.protection.conflict;
    let release, entered;
    const blocked = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const filesFor = session.files.filesFor.bind(session.files);
    session.files.filesFor = async snapshot => {
        if (snapshot.id === conflict.incoming.id) { entered(); await blocked; }
        return filesFor(snapshot);
    };
    const confirming = mode === 'all-source' ? session.confirmAllConflictChoices('incoming', conflict.id) : session.confirmConflictChoices(conflict.id);
    await started;
    const next = structuredClone(f.incoming); next.LANGUAGE = 'de';
    await f.incomingRevision(next, conflict.incoming);
    assert.equal((await session.publish(f.manager.settings, () => true)).status, 'conflict');
    const nextId = session.protection.conflict.id;
    assert.notEqual(nextId, conflict.id);
    release();
    await assert.rejects(confirming, /incoming configuration changed/);
    assert.equal(session.protection.conflict.id, nextId);
    assert.equal(session.protection.confirmedSelection, undefined);
    assert.equal(session.protection.paused, true);
    assert.equal(session.conflictChoices.allSide(), 'local');
    assert.equal(f.sharedWrites().length, 0);
});

test('missing or unready file copies reject all-source confirmation without consuming the selection', async t => {
    const f = await fixture(t), { session } = f, choices = session.conflictChoices;
    const id = choices.id;
    choices.toggleItem({ kind: 'field', id: 'LANGUAGE' });
    const filesFor = session.files.filesFor.bind(session.files);
    session.files.filesFor = async () => { throw new Error('Preserved configuration file unavailable'); };
    await assert.rejects(session.confirmAllConflictChoices('local', id), /file unavailable/);
    assert.equal(choices.ready, false); assert.equal(choices.itemSide({ kind: 'field', id: 'LANGUAGE' }), 'incoming');
    session.files.filesFor = filesFor;
    session.prepareConflictChoices = async () => choices;
    await assert.rejects(session.confirmAllConflictChoices('local', id), /not ready/);
    assert.equal(choices.itemSide({ kind: 'field', id: 'LANGUAGE' }), 'incoming');
    assert.equal(session.protection.confirmedSelection, undefined);
    assert.equal(session.protection.paused, true);
    assert.equal(f.sharedWrites().length, 0);
});

test('all-source confirmation preserves its selected private draft if staging fails and can be retried', async t => {
    const f = await fixture(t), { session } = f;
    const id = session.protection.conflict.id, write = f.adapter.write.bind(f.adapter);
    f.adapter.write = async (path, text) => { if (path.endsWith('/draft.json')) throw new Error('Private draft busy'); return write(path, text); };
    await assert.rejects(session.confirmAllConflictChoices('incoming', id), /Private draft busy/);
    assert.deepEqual(session.protection.confirmedSelection.value, f.incoming);
    assert.equal(session.conflictChoices.allSide(), 'incoming');
    assert.equal(f.sharedWrites().length, 0);
    f.adapter.write = write;
    await session.confirmAllConflictChoices('local', id);
    assert.equal(session.conflictChoices.allSide(), 'local');
    assert.equal(session.protection.confirmedSelection.value.LANGUAGE, 'en');
    assert.equal(f.sharedWrites().length, 0);
});

test('a queued all-source confirmation rechecks the conflict after an earlier edit changes its identity', async t => {
    const f = await fixture(t), { session } = f;
    await session.prepareConflictChoices();
    const id = session.protection.conflict.id, write = f.adapter.write.bind(f.adapter);
    let release, entered;
    const blocked = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    f.adapter.write = async (path, text) => { if (path.endsWith('/draft.json')) { entered(); await blocked; } return write(path, text); };
    f.manager.settings.RECENT_INSTALL_DAYS = 21;
    const earlier = session.save(f.manager.settings); await started;
    const confirming = session.confirmAllConflictChoices('incoming', id);
    release(); await earlier;
    await assert.rejects(confirming, /incoming configuration changed/);
    assert.notEqual(session.protection.conflict.id, id);
    assert.equal(session.protection.confirmedSelection, undefined);
    assert.equal(session.protection.paused, true);
    assert.equal(f.sharedWrites().length, 0);
});

test('individual confirmation remains compatible with mixed choices and later edits retain selected fields', async t => {
    const f = await fixture(t), { session } = f;
    const choices = await session.prepareConflictChoices();
    choices.toggleItem({ kind: 'field', id: 'LANGUAGE' });
    const id = session.protection.conflict.id;
    await session.confirmConflictChoices(id);
    assert.equal(choices.allSide(), 'mixed');
    assert.equal(session.protection.confirmedSelection.value.LANGUAGE, 'fr');
    assert.equal(session.protection.confirmedSelection.value.DEVICE_MANAGEMENT.presets.computer[0].plugins.tasks.enabled, true);
    f.manager.settings.RECENT_INSTALL_DAYS = 21; await session.save(f.manager.settings);
    assert.equal(session.protection.confirmedSelection.value.LANGUAGE, 'fr');
    assert.equal(session.protection.confirmedSelection.value.RECENT_INSTALL_DAYS, 21);
    await session.confirmConflictChoices(); // Older callers may still omit the expected identity.
    assert.equal(session.protection.confirmedSelection.value.LANGUAGE, 'fr');
    assert.equal(f.sharedWrites().length, 0);
});
