import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';

globalThis.window = { crypto: webcrypto, setTimeout, clearTimeout };
const hash = async text => createHash('sha256').update(text).digest('hex');
const bundle = await build({ stdin: { contents: `export * from './src/settings/protected-session'; export * from './src/settings/config-revision'; export * from './src/settings/session-store';`,
    resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['obsidian'], write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => {
    if (name === 'obsidian') return { Notice: class {} };
    throw new Error(`Unexpected test dependency: ${name}`);
}, module, module.exports);
const { ProtectedConfigSession, createConfigRevision, encodeConfig, settingsFingerprint } = module.exports;
const root = '.obsidian/plugins/better-plugins-manager';
const normalize = value => ({ LANGUAGE: 'en', RECENT_INSTALL_DAYS: 7, ...structuredClone(value) });

async function fixture(t, local = { Plugins: [{ id: 'tasks', enabled: true, version: '1' }] }, localFiles = {}) {
    const files = { [`${root}/data.json`]: JSON.stringify(local),
        ...Object.fromEntries(Object.entries(localFiles).map(([path, text]) => [`${root}/${path}`, text])) };
    const writes = [], anchors = new Map();
    const adapter = {
        async exists(path) { return path in files || Object.keys(files).some(file => file.startsWith(`${path}/`)); },
        async mkdir() {},
        async list(path) { return { files: Object.keys(files).filter(file => file.startsWith(`${path}/`)), folders: [] }; },
        async read(path) { if (!(path in files)) throw new Error(`ENOENT: ${path}`); return files[path]; },
        async write(path, text) { writes.push(path); files[path] = text; },
        async remove(path) { writes.push(path); delete files[path]; },
        async stat(path) { return path in files ? { type: 'file' } : null; },
    };
    const manager = { settings: normalize(local), manifest: { id: 'better-plugins-manager' },
        app: { vault: { configDir: '.obsidian', adapter }, loadLocalStorage: key => anchors.get(key),
            saveLocalStorage: (key, value) => { anchors.set(key, value); } },
        async loadData() { return JSON.parse(files[`${root}/data.json`]); } };
    function session() {
        const value = new ProtectedConfigSession(manager, 'local-device', normalize, () => {});
        t.after(() => value.destroy());
        return value;
    }
    const current = session();
    manager.settings = normalize(await current.load());
    current.begin();
    const initial = structuredClone(current.protection.current);
    async function incoming(value, incomingFiles = localFiles, parent = initial) {
        const snapshot = await createConfigRevision(value, 'remote-device', [parent], await current.files.fileDigests(incomingFiles), hash);
        for (const path of new Set([...Object.keys(localFiles), ...Object.keys(incomingFiles)])) {
            const text = incomingFiles[path];
            if (text === null || text === undefined) delete files[`${root}/${path}`]; else files[`${root}/${path}`] = text;
        }
        files[`${root}/data.json`] = JSON.stringify(encodeConfig(snapshot));
        return snapshot;
    }
    return { current, manager, files, writes, local, localFiles, initial, incoming, session,
        sharedWrites: () => writes.filter(path => !path.includes('/.bpm/')) };
}

test('default normalization and known bookkeeping differences finish Save without conflict or shared writes', async t => {
    const f = await fixture(t), remote = normalize(f.local);
    remote.Plugins[0].version = '2'; remote.MIGRATION_VERSION = '1.2.20'; remote.RELEASE_HIGHLIGHTS_PENDING = '1.2.20';
    const incoming = await f.incoming(remote), before = f.files[`${root}/data.json`];
    assert.equal((await f.current.publish(f.manager.settings, () => true)).status, 'noop');
    assert.equal(f.current.protection.conflict, undefined);
    assert.equal(f.current.hasPendingChanges, false);
    assert.equal(f.current.protection.current.id, incoming.id);
    assert.equal(f.files[`${root}/data.json`], before);
    assert.deepEqual(f.sharedWrites(), []);
});

test('a real local edit can save across an equivalent remote revision while keeping both parents', async t => {
    const f = await fixture(t), remote = normalize(f.local);
    f.manager.settings.RECENT_INSTALL_DAYS = 14; await f.current.save(f.manager.settings);
    remote.Plugins[0].version = '2';
    const incoming = await f.incoming(remote);
    assert.equal((await f.current.publish(f.manager.settings, () => true)).status, 'saved');
    const saved = JSON.parse(f.files[`${root}/data.json`]);
    assert.equal(saved.RECENT_INSTALL_DAYS, 14);
    assert.deepEqual(saved._bpmRevision.parents, [f.initial.id, incoming.id]);
    assert.equal(f.current.protection.conflict, undefined);
});

test('associated JSON key order, formatting and device heartbeat changes are a no-op without touching disk', async t => {
    const path = 'data/devices/phone.json';
    const f = await fixture(t, { LANGUAGE: 'en' }, { [path]: '{"id":"phone","name":"Phone","lastSeen":1,"updatedAt":1}' });
    await f.incoming(f.local, { [path]: '{\n"updatedAt": 2,"lastSeen":2,"name":"Phone","id":"phone"\n}' });
    const before = { config: f.files[`${root}/data.json`], device: f.files[`${root}/${path}`] };
    assert.equal((await f.current.publish(f.manager.settings, () => true)).status, 'noop');
    assert.equal(f.files[`${root}/data.json`], before.config);
    assert.equal(f.files[`${root}/${path}`], before.device);
    assert.deepEqual(f.sharedWrites(), []);
});

test('a renamed or deleted device file remains a real conflict with a visible difference', async t => {
    for (const text of ['{"id":"phone","name":"Renamed","lastSeen":2}', null]) {
        const path = 'data/devices/phone.json';
        const f = await fixture(t, { LANGUAGE: 'en' }, { [path]: '{"id":"phone","name":"Phone","lastSeen":1}' });
        await f.incoming(f.local, { [path]: text });
        assert.equal((await f.current.publish(f.manager.settings, () => true)).status, 'conflict');
        const choices = await f.current.prepareConflictChoices();
        assert.deepEqual(choices.sections.map(section => section.id), [`file:${path}`]);
        assert.ok(choices.sections[0].differences.length > 0);
        assert.deepEqual(f.sharedWrites(), []);
    }
});

test('real source changes, plugin settings and deletions never become a bookkeeping no-op', async t => {
    const local = { LANGUAGE: 'en', Plugins: [{ id: 'tasks', enabled: true, version: '1' }],
        PLUGIN_INSTALLATIONS: { tasks: { version: '1', source: { kind: 'github', repo: 'owner/one' } } },
        custom: { version: '1', updatedAt: 1 }, TAGS: [{ id: 'keep', name: 'Keep' }] };
    for (const edit of [
        value => { value.PLUGIN_INSTALLATIONS.tasks.version = '2'; },
        value => { value.PLUGIN_INSTALLATIONS.tasks.source.repo = 'owner/two'; },
        value => { value.Plugins[0].enabled = false; },
        value => { value.custom.updatedAt = 2; },
        value => { delete value.TAGS; },
    ]) {
        const f = await fixture(t, local), remote = structuredClone(local); edit(remote);
        await f.incoming(remote);
        assert.equal((await f.current.publish(f.manager.settings, () => true)).status, 'conflict');
        const choices = await f.current.prepareConflictChoices();
        assert.ok(choices.sections.some(section => section.differences.length > 0));
        assert.deepEqual(f.sharedWrites(), []);
    }
});

test('an old raw-only conflict is cleared privately on reload without rewriting synced content', async t => {
    const f = await fixture(t), incoming = await f.incoming(normalize(f.local));
    await f.current.files.readShared(); // Validate/cache the incoming snapshot before preserving the old-format conflict.
    const localFiles = {}, local = normalize(f.local);
    const id = await hash(settingsFingerprint({ base: f.initial.id, local, incoming: incoming.id, files: localFiles }));
    await f.current.files.preserveConflict({ id, reason: 'concurrent', base: f.initial, local, incoming, localFiles });
    const before = f.files[`${root}/data.json`], reopened = f.session();
    await reopened.load();
    assert.equal(reopened.protection.conflict, undefined);
    assert.equal(await reopened.files.readConflict(), undefined);
    assert.equal(f.files[`${root}/data.json`], before);
    assert.deepEqual(f.sharedWrites(), []);
});

test('a reviewed selection survives a bookkeeping-only incoming revision and retains every real parent', async t => {
    const f = await fixture(t), remote = normalize(f.local);
    f.manager.settings.RECENT_INSTALL_DAYS = 14; await f.current.save(f.manager.settings);
    remote.Plugins[0].enabled = false;
    const reviewed = await f.incoming(remote);
    assert.equal((await f.current.publish(f.manager.settings, () => true)).status, 'conflict');
    const id = f.current.protection.conflict.id;
    await f.current.confirmAllConflictChoices('local', id);
    const refreshed = structuredClone(remote); refreshed.Plugins[0].version = '2';
    const latest = await f.incoming(refreshed, {}, reviewed);
    assert.equal((await f.current.publish(f.manager.settings, () => true)).status, 'saved');
    const saved = JSON.parse(f.files[`${root}/data.json`]);
    assert.equal(saved.Plugins[0].enabled, true); assert.equal(saved.RECENT_INSTALL_DAYS, 14);
    assert.deepEqual(saved._bpmRevision.parents, [f.initial.id, reviewed.id, latest.id]);
    assert.equal(f.current.protection.conflict, undefined);
});

test('empty preset-type presence differences stay visible instead of producing an empty conflict', async t => {
    const f = await fixture(t, { DEVICE_MANAGEMENT: { presets: { phone: [] } } });
    await f.incoming({ DEVICE_MANAGEMENT: { presets: {} } });
    assert.equal((await f.current.publish(f.manager.settings, () => true)).status, 'conflict');
    const choices = await f.current.prepareConflictChoices();
    assert.deepEqual(choices.sections.map(section => section.id), ['settings']);
    assert.deepEqual(choices.sections[0].differences.map(item => item.path), [['DEVICE_MANAGEMENT', 'presets', 'phone']]);
    assert.deepEqual(choices.sections[0].differences[0].local, []);
    assert.equal(choices.sections[0].differences[0].incoming, undefined);
    assert.deepEqual(f.sharedWrites(), []);
});

for (const [key, previous, next] of [
    ['MIGRATION_VERSION', '1.2.19', '1.2.20'],
    ['LANGUAGE_INITIALIZED', false, true],
    ['RELEASE_HIGHLIGHTS_PENDING', '1.2.20', ''],
]) {
    const local = { Plugins: [{ id: 'tasks', enabled: true, version: '1' }], [key]: previous };
    test(`a local ${key} change is saved across an equivalent remote revision and survives reload`, async t => {
        const f = await fixture(t, local), remote = structuredClone(local);
        f.manager.settings[key] = next; await f.current.save(f.manager.settings, true);
        remote.Plugins[0].version = '2';
        const incoming = await f.incoming(remote);
        assert.equal((await f.current.publish(f.manager.settings, () => true)).status, 'saved');
        const saved = JSON.parse(f.files[`${root}/data.json`]);
        assert.equal(saved[key], next);
        assert.deepEqual(saved._bpmRevision.parents, [f.initial.id, incoming.id]);
        assert.equal(f.current.protection.conflict, undefined);
        const reopened = f.session();
        assert.equal((await reopened.load())[key], next);
    });
    test(`a local ${key} change already implemented by the incoming version remains a no-op`, async t => {
        const f = await fixture(t, local), remote = structuredClone(local);
        f.manager.settings[key] = next; await f.current.save(f.manager.settings, true);
        remote[key] = next; await f.incoming(remote);
        const before = f.files[`${root}/data.json`];
        assert.equal((await f.current.publish(f.manager.settings, () => true)).status, 'noop');
        assert.equal(f.files[`${root}/data.json`], before);
        assert.deepEqual(f.sharedWrites(), []);
    });
    test(`a remote-only ${key} change remains a no-op instead of restoring the stale local marker`, async t => {
        const f = await fixture(t, local), remote = structuredClone(local);
        remote[key] = next; await f.incoming(remote);
        const before = f.files[`${root}/data.json`];
        assert.equal((await f.current.publish(f.manager.settings, () => true)).status, 'noop');
        assert.equal(f.current.protection.current.value[key], next);
        assert.equal(f.files[`${root}/data.json`], before);
        assert.deepEqual(f.sharedWrites(), []);
    });
}

test('a former real conflict can save a local lifecycle marker once its effective configuration matches the incoming version', async t => {
    const local = { Plugins: [{ id: 'tasks', enabled: true }], RELEASE_HIGHLIGHTS_PENDING: '1.2.20' };
    const f = await fixture(t, local), remote = structuredClone(local);
    f.manager.settings.RECENT_INSTALL_DAYS = 14; await f.current.save(f.manager.settings);
    remote.Plugins[0].enabled = false;
    const incoming = await f.incoming(remote);
    assert.equal((await f.current.publish(f.manager.settings, () => true)).status, 'conflict');
    // The user edits the actual settings to the same state without selecting a global source.
    f.manager.settings = normalize(remote); f.manager.settings.RELEASE_HIGHLIGHTS_PENDING = '';
    await f.current.save(f.manager.settings);
    assert.equal(f.current.protection.confirmedSelection, undefined);
    assert.equal((await f.current.publish(f.manager.settings, () => true)).status, 'saved');
    const saved = JSON.parse(f.files[`${root}/data.json`]);
    assert.equal(saved.Plugins[0].enabled, false); assert.equal(saved.RELEASE_HIGHLIGHTS_PENDING, '');
    assert.deepEqual(saved._bpmRevision.parents, [f.initial.id, incoming.id]);
    assert.equal(f.current.protection.conflict, undefined);
});

test('an existing pause does not block a pending lifecycle acknowledgement when the latest incoming content now matches', async t => {
    const local = { Plugins: [{ id: 'tasks', enabled: true }], RELEASE_HIGHLIGHTS_PENDING: '1.2.20' };
    const f = await fixture(t, local), remote = structuredClone(local);
    f.manager.settings.RELEASE_HIGHLIGHTS_PENDING = ''; await f.current.save(f.manager.settings);
    remote.Plugins[0].enabled = false;
    const conflicted = await f.incoming(remote);
    assert.equal((await f.current.publish(f.manager.settings, () => true)).status, 'conflict');
    const id = f.current.protection.conflict.id;
    const latest = await f.incoming(local, {}, conflicted);
    assert.equal(f.current.protection.conflict.id, id);
    assert.equal(f.current.protection.confirmedSelection, undefined);
    assert.equal((await f.current.publish(f.manager.settings, () => true)).status, 'saved');
    const saved = JSON.parse(f.files[`${root}/data.json`]);
    assert.equal(saved.RELEASE_HIGHLIGHTS_PENDING, '');
    assert.deepEqual(saved._bpmRevision.parents, [f.initial.id, conflicted.id, latest.id]);
    assert.equal(f.current.protection.conflict, undefined);
});
