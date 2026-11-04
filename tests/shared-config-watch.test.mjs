import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['src/settings/shared-config-watch.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const loaded = { exports: {} };
new Function('module', 'exports', built.outputFiles[0].text)(loaded, loaded.exports);
const { SharedConfigWatch } = loaded.exports;
const root = '.obsidian/plugins/better-plugins-manager';
const data = `${root}/data.json`, icons = `${root}/data/icons.css`, device = `${root}/data/devices/phone.json`;

async function fixture() {
    const files = new Map([[data, '{"value":0}'], [icons, 'initial'], [device, '{"name":"Phone","lastSeen":1}']]);
    let now = 10_000, next = 0, enabled = true;
    const timers = new Map(), notices = [], errors = [];
    const reader = { exists: async path => files.has(path), read: async path => files.get(path) };
    const time = { now: () => now, later(callback, delay) { const id = ++next; timers.set(id, { callback, at: now + delay }); return id; }, cancel: id => timers.delete(id) };
    const watch = new SharedConfigWatch(root, reader, () => enabled, path => notices.push(path), error => errors.push(error), time);
    await watch.prime([data, icons, device]);
    async function advance(milliseconds) {
        now += milliseconds;
        for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
        await watch.settled();
    }
    async function change(path, text) { if (text === null) files.delete(path); else files.set(path, text); watch.observe(path); await advance(250); }
    return { watch, files, reader, notices, errors, timers, advance, change, setEnabled(value) { enabled = value; } };
}

test('three content changes to the same file within three seconds warn without writing or adopting settings', async () => {
    const f = await fixture();
    await f.change(data, '{"value":1}'); await f.change(data, '{"value":2}');
    assert.deepEqual(f.notices, []);
    await f.change(data, '{"value":3}');
    assert.deepEqual(f.notices, [data]);
    assert.equal(f.files.get(data), '{"value":3}');
    assert.deepEqual(f.errors, []);
});

test('different files and changes outside the rolling window cannot combine to trigger a warning', async () => {
    const f = await fixture();
    await f.change(data, '{"value":1}'); await f.change(icons, 'first'); await f.change(device, '{"name":"Tablet"}');
    await f.advance(3_001);
    await f.change(data, '{"value":2}'); await f.change(data, '{"value":3}');
    assert.deepEqual(f.notices, []);
});

test('JSON format, key order, revision metadata, device heartbeat and repeated identical events do not count', async () => {
    const f = await fixture();
    for (let index = 0; index < 5; index++) {
        await f.change(data, JSON.stringify({ _bpmRevision: { generation: index }, value: 0 }, null, index));
        await f.change(device, JSON.stringify({ lastSeen: index, name: 'Phone' }));
        f.watch.observe(icons); await f.advance(250);
    }
    await f.change(data, '{"value":1}'); await f.change(data, '{"value":2}');
    assert.deepEqual(f.notices, []);
});

test('atomic replacement events coalesce into one effective change', async () => {
    const f = await fixture();
    for (let value = 1; value <= 2; value++) {
        f.files.delete(data); f.watch.observe(data); await f.advance(100);
        f.files.set(data, JSON.stringify({ value })); f.watch.observe(data); f.watch.observe(data);
        await f.advance(250);
    }
    assert.deepEqual(f.notices, []);
    await f.change(data, '{"value":3}'); assert.deepEqual(f.notices, [data]);
});

test('continuous events inspect each bounded window instead of deferring detection indefinitely', async () => {
    const f = await fixture(); let reads = 0;
    const read = f.reader.read; f.reader.read = async path => { reads++; return read(path); };
    for (let value = 1; value <= 10; value++) {
        f.files.set(data, JSON.stringify({ value })); f.watch.observe(data);
        await f.advance(100);
    }
    assert.equal(reads, 3);
    assert.deepEqual(f.notices, [data]);
});

test('continuous duplicate events are inspected but never counted as content modifications', async () => {
    const f = await fixture(); let reads = 0;
    const read = f.reader.read; f.reader.read = async path => { reads++; return read(path); };
    for (let event = 0; event < 10; event++) { f.watch.observe(data); await f.advance(100); }
    assert.equal(reads, 3); assert.deepEqual(f.notices, []);
});

test('an unavailable startup baseline is established conservatively on the first successful read', async () => {
    const f = await fixture(), other = `${root}/data/devices/tablet.json`;
    for (let value = 0; value <= 2; value++) await f.change(other, JSON.stringify({ name: `Tablet ${value}` }));
    assert.deepEqual(f.notices, []);
    await f.change(other, '{"name":"Tablet 3"}'); assert.deepEqual(f.notices, [other]);
});

test('local publications and delayed echoes reset the file counter and never produce warnings', async () => {
    const f = await fixture();
    await f.change(data, '{"value":1}'); await f.change(data, '{"value":2}');
    for (let value = 3; value <= 6; value++) {
        const text = JSON.stringify({ value });
        await f.watch.write(data, text, async () => { f.watch.observe(data); f.files.set(data, text); });
        await f.advance(250); f.watch.observe(data); await f.advance(250);
    }
    await f.change(data, '{"value":7}');
    assert.deepEqual(f.notices, []);
    await f.watch.remove(data, async () => { f.files.delete(data); f.watch.observe(data); }); await f.advance(250);
    assert.deepEqual(f.notices, []);
});

test('the cooldown is shared across files and expires after one minute', async () => {
    const f = await fixture();
    for (let value = 1; value <= 3; value++) await f.change(data, JSON.stringify({ value }));
    for (const text of ['first', 'second', 'third']) await f.change(icons, text);
    assert.deepEqual(f.notices, [data]);
    await f.advance(60_000);
    for (const text of ['fourth', 'fifth', 'sixth']) await f.change(icons, text);
    assert.deepEqual(f.notices, [data, icons]);
});

test('disabled warnings still advance the baseline; scripts and recovery files are outside this detector', async () => {
    const f = await fixture(); f.setEnabled(false);
    for (let value = 1; value <= 5; value++) await f.change(data, JSON.stringify({ value }));
    for (const path of [`${root}/main.js`, `${root}/styles.css`, `${root}/.bpm/owner/draft.json`, `${root}/data/history/point.json`]) {
        for (let value = 1; value <= 3; value++) await f.change(path, `${value}`);
    }
    f.setEnabled(true); f.watch.observe(data); await f.advance(250);
    await f.change(data, '{"value":6}'); await f.change(data, '{"value":7}');
    assert.deepEqual(f.notices, []);
});

test('a read overlapping a local write is reread, and disposal cancels pending observations', async () => {
    const f = await fixture();
    let release, entered;
    const blocked = new Promise(resolve => { release = resolve; }), reading = new Promise(resolve => { entered = resolve; });
    const original = f.reader.read; let blockedOnce = false;
    f.reader.read = async path => { const value = await original(path); if (!blockedOnce) { blockedOnce = true; entered(); await blocked; } return value; };
    f.files.set(data, '{"value":1}'); f.watch.observe(data); const pending = f.advance(250); await reading;
    await f.watch.write(data, '{"value":2}', async () => { f.files.set(data, '{"value":2}'); });
    release(); await pending; await f.advance(250);
    await f.change(data, '{"value":3}'); await f.change(data, '{"value":4}');
    assert.deepEqual(f.notices, []);
    f.watch.observe(data); f.watch.destroy(); await f.advance(250);
    assert.equal(f.timers.size, 0); assert.deepEqual(f.notices, []);
});

test('inspection failures are surfaced without retries or disk repairs', async () => {
    const f = await fixture();
    f.reader.read = async () => { throw new Error('Permission denied'); };
    f.watch.observe(data); await f.advance(250);
    assert.match(f.errors[0].message, /Permission denied/);
    assert.equal(f.timers.size, 0); assert.deepEqual(f.notices, []);
});
