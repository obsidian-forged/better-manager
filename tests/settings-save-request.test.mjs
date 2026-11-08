import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/settings/save-request.ts'], bundle: true, platform: 'node', format: 'cjs',
    write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
const { queueSettingsSave, reconcileSettingsRecord, applySettingsEdit, settingsSaveMessage } = module.exports;

test('an incomplete bundle notice distinguishes absent files from mismatched content', () => {
    const issues = [{ path: 'data/icons.css', kind: 'missing' }, { path: 'data/devices/phone.json', kind: 'different' },
        { path: 'data/devices/removed.json', kind: 'unexpected' }];
    const zh = settingsSaveMessage('zh-CN', 'incomplete', issues), en = settingsSaveMessage('en', 'incomplete', issues);
    assert.match(zh, /文件缺失: data\/icons\.css/); assert.match(zh, /内容不一致: data\/devices\/phone\.json/);
    assert.match(zh, /草稿已保留/); assert.match(zh, /应已删除的文件仍存在/);
    assert.match(en, /Missing file: data\/icons\.css/); assert.match(en, /Content mismatch: data\/devices\/phone\.json/);
    assert.match(en, /draft was kept/);
});

test('queued automatic work cannot capture a later edit or consume its explicit save intent', async () => {
    let release;
    let tail = new Promise(resolve => { release = resolve; });
    const enqueue = task => { const pending = tail.then(task); tail = pending; return pending; };
    const requests = [];
    const settings = { groups: [{ id: 'group', name: 'Original' }] };
    const automatic = queueSettingsSave(settings, true, enqueue, async request => { requests.push(request); });
    settings.groups[0].name = 'Edited';
    const manual = queueSettingsSave(settings, false, enqueue, async request => { requests.push(request); });
    settings.groups[0].name = 'Newer edit';
    assert.equal(requests.length, 0);
    release();
    await Promise.all([automatic, manual]);
    assert.deepEqual(requests.map(request => [request.value.groups[0].name, request.automatic]), [['Original', true], ['Edited', false]]);
    assert.equal(JSON.parse(requests[1].serialized).groups[0].name, 'Edited');
});

test('an explicit request with unchanged content still reaches the persistence policy', async () => {
    const requests = [];
    const enqueue = task => task();
    await queueSettingsSave({ enabled: true }, true, enqueue, async request => { requests.push(request); });
    await queueSettingsSave({ enabled: true }, false, enqueue, async request => { requests.push(request); });
    assert.deepEqual(requests.map(request => request.automatic), [true, false]);
});

test('saved selections keep existing setting callbacks attached across reordered groups and presets', () => {
    const current = { groups: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], preset: { enabled: true, old: 'remove' } };
    const list = current.groups, group = current.groups[0], preset = current.preset;
    const callback = name => { group.name = name; };
    reconcileSettingsRecord(current, { groups: [{ id: 'b', name: 'Remote B' }, { id: 'a', name: 'Remote A' }], preset: { enabled: false } });
    assert.equal(current.groups, list);
    assert.equal(current.groups[1], group);
    assert.equal(current.preset, preset);
    assert.equal('old' in preset, false);
    callback('Edited after Save');
    assert.equal(current.groups[1].name, 'Edited after Save');
});

test('unfamiliar configuration keys remain ordinary data during reconciliation', () => {
    const current = {};
    const incoming = JSON.parse('{"__proto__":{"bpmPolluted":true},"constructor":{"enabled":false}}');
    reconcileSettingsRecord(current, incoming);
    assert.equal(Object.getPrototypeOf(current), Object.prototype);
    assert.equal({}.bpmPolluted, undefined);
    assert.equal(Object.hasOwn(current, '__proto__'), true);
    assert.equal(current.__proto__.bpmPolluted, true);
    assert.equal(current.constructor.enabled, false);
});

test('a renamed preset keeps confirmed plugin choices when its timestamp also changes', () => {
    const base = { presets: [{ id: 'phone', name: 'Phone', updatedAt: 1, plugins: { tasks: { enabled: true, delay: '' } } }] };
    const selected = structuredClone(base);
    selected.presets[0].plugins.tasks.enabled = false;
    selected.presets.push({ id: 'remote-only', name: 'Tablet', plugins: {} });
    const edited = structuredClone(base);
    edited.presets[0].name = 'Renamed phone';
    edited.presets[0].updatedAt = 2;
    const result = applySettingsEdit(base, edited, selected);
    assert.equal(result.presets[0].plugins.tasks.enabled, false);
    assert.equal(result.presets[0].name, 'Renamed phone');
    assert.equal(result.presets[0].updatedAt, 2);
    assert.equal(result.presets[1].id, 'remote-only');
    assert.equal(selected.presets[0].name, 'Phone');
});
