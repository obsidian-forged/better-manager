import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const built = await build({ entryPoints: ['src/on-demand/commands.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
const loaded = { exports: {} };
new Function('module', 'exports', built.outputFiles[0].text)(loaded, loaded.exports);
const { OnDemandCommands } = loaded.exports;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
    const state = { version: '1', loads: 0, executions: [], errors: [], writes: [], failWrite: false };
    const commands = {};
    const host = { registry: { commands, addCommand(command) { commands[command.id] = command; return command; }, removeCommand(id) { delete commands[id]; }, executeCommandById(id) { state.executions.push(id); return true; } },
        async loadPlugin() { state.loads++; commands['p:run'] = { id: 'p:run', name: 'Run', editorCallback() { throw new Error('Must use native executor'); } }; },
        canLoad: () => true, manifestVersion: () => state.version,
        async readCache() { return { schema: 1, plugins: { p: { version: '1', commands: [{ id: 'p:run', name: 'Run', icon: 'star' }] } } }; },
        async writeCache(value) { if (state.failWrite) throw new Error('disk'); state.writes.push(value); }, failed(id, error) { state.errors.push([id, error]); } };
    return { state, host, engine: new OnDemandCommands(host), commands };
}
test('concurrent triggers load once and each uses the native editor executor', async () => {
    const { engine, host, state } = fixture(); const gate = deferred(); const load = host.loadPlugin;
    host.loadPlugin = async () => { await gate.promise; await load(); };
    await engine.initialize(); engine.arm('p');
    const first = engine.trigger('p', 'p:run'), second = engine.trigger('p', 'p:run');
    gate.resolve(); await Promise.all([first, second]);
    assert.equal(state.loads, 1); assert.deepEqual(state.executions, ['p:run', 'p:run']);
});
test('load failure rearms a retry and checkCallback only checks before native execution', async () => {
    const { engine, host, state, commands } = fixture(); const load = host.loadPlugin; let fail = true;
    host.loadPlugin = async () => { if (fail) throw new Error('load failed'); await load(); commands['p:run'].checkCallback = checking => { assert.equal(checking, true); return false; }; };
    await engine.initialize(); engine.arm('p'); await engine.trigger('p', 'p:run');
    assert.equal(state.errors.length, 1); assert.equal(typeof commands['p:run'].callback, 'function');
    fail = false; await engine.trigger('p', 'p:run'); assert.deepEqual(state.executions, []);
});
test('version changes invalidate placeholders; malformed JSON is ignored', async () => {
    const { engine, state, commands } = fixture(); await engine.initialize(); state.version = '2'; engine.arm('p'); assert.deepEqual(commands, {});
    const broken = fixture(); broken.host.readCache = async () => ({ schema: 1, plugins: { p: { version: '1', commands: [{ id: 'other:run', name: 'Wrong' }] } } });
    await broken.engine.initialize(); broken.engine.arm('p'); assert.deepEqual(broken.commands, {});
});
test('capture saves metadata only and failed writes preserve the old snapshot', async () => {
    const { engine, host, state, commands } = fixture(); await engine.initialize(); engine.arm('p'); await engine.capture('p');
    assert.deepEqual(state.writes[0].plugins.p.commands, []);
    await host.loadPlugin(); await engine.capture('p'); assert.deepEqual(state.writes[1].plugins.p.commands, [{ id: 'p:run', name: 'Run' }]);
    state.failWrite = true; state.version = '2'; await engine.capture('p'); delete commands['p:run']; engine.arm('p'); assert.deepEqual(commands, {});
    state.version = '1'; engine.arm('p'); assert.equal(commands['p:run'].name, 'Run'); assert.equal(state.errors.length, 1);
});
test('disarm and dispose invalidate pending triggers and never delete real replacements', async () => {
    for (const action of ['disarm', 'dispose']) {
        const { engine, host, state, commands } = fixture(); const gate = deferred(); const load = host.loadPlugin;
        host.loadPlugin = async () => { await gate.promise; await load(); };
        await engine.initialize(); engine.arm('p'); const pending = engine.trigger('p', 'p:run');
        if (action === 'disarm') engine.disarm('p'); else engine.dispose();
        gate.resolve(); await pending; assert.deepEqual(state.executions, []);
        const real = commands['p:run']; engine.dispose(); assert.equal(commands['p:run'], real);
        await engine.capture('p'); assert.deepEqual(state.writes, []);
    }
});
test('beforeLoad and disarm remove only owned placeholders', async () => {
    const { engine, commands } = fixture(); await engine.initialize(); engine.arm('p');
    const real = { id: 'p:run', name: 'Real', callback() {} }; commands['p:run'] = real;
    engine.beforeLoad('p'); assert.equal(commands['p:run'], real); engine.disarm('p'); assert.equal(commands['p:run'], real);
});

test('a checkCallback that rejects the trigger loads the plugin but executes nothing', async () => {
    const { engine, host, state, commands } = fixture();
    const load = host.loadPlugin;
    host.loadPlugin = async () => {
        await load();
        commands['p:run'].checkCallback = checking => { assert.equal(checking, true); return false; };
    };
    await engine.initialize(); engine.arm('p');
    await engine.trigger('p', 'p:run');
    assert.equal(state.loads, 1);
    assert.deepEqual(state.executions, []);
    assert.deepEqual(state.errors, []);
});

test('an editor-only command forwards to the native executor after loading', async () => {
    const { engine, host, state, commands } = fixture();
    const load = host.loadPlugin;
    host.loadPlugin = async () => {
        await load();
        delete commands['p:run'].callback;
        commands['p:run'].editorCallback = () => { throw new Error('must not call directly'); };
    };
    await engine.initialize(); engine.arm('p');
    await engine.trigger('p', 'p:run');
    assert.deepEqual(state.executions, ['p:run']);
    assert.deepEqual(state.errors, []);
});

test('a command that disappears after loading reports one failure and does not execute', async () => {
    const { engine, host, state } = fixture();
    const load = host.loadPlugin;
    host.loadPlugin = async () => {
        await load();
        delete host.registry.commands['p:run'];
    };
    await engine.initialize(); engine.arm('p');
    await engine.trigger('p', 'p:run');
    assert.deepEqual(state.executions, []);
    assert.equal(state.errors.length, 1);
    assert.match(String(state.errors[0][1]), /Command unavailable/);
});
