import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['src/ui/settings-close-controller.ts'], bundle: true, platform: 'node',
    format: 'cjs', write: false, logLevel: 'silent' });
const loaded = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(loaded, loaded.exports);
const { SettingsCloseController } = loaded.exports;

function fixture({ manual = true, dirty = true, saving = false, decision = false, saveSucceeds = true } = {}) {
    const calls = [];
    let open = true;
    const host = { settings: { MANUAL_CONFIG_SAVE: manual }, hasUnsavedSettings: dirty, isSavingSettings: saving,
        async savePendingSettings() {
            calls.push('save');
            if (saveSucceeds) host.hasUnsavedSettings = false;
            return saveSucceeds;
        },
        async discardPendingSettings() { calls.push('discard'); host.hasUnsavedSettings = false; } };
    const actions = {
        isOpen: () => open,
        async prepareDraft() { calls.push('draft'); },
        async confirmSave() { calls.push('confirm'); return decision; },
        saving() { calls.push('saving'); },
        close(allowAutomaticSave) { calls.push(['close', allowAutomaticSave]); open = false; },
    };
    const controller = new SettingsCloseController(host, actions);
    return { controller, host, actions, calls, isOpen: () => open, teardown() { open = false; } };
}

test('clean and session-only editors close without asking to save', async () => {
    const f = fixture({ dirty: false });
    await f.controller.request();
    assert.deepEqual(f.calls, ['draft', ['close', false]]);
});

test('Don’t save, including dismissing the confirmation, discards the local draft', async () => {
    const f = fixture();
    await f.controller.request();
    assert.deepEqual(f.calls, ['draft', 'confirm', 'discard', ['close', false]]);
    assert.equal(f.host.hasUnsavedSettings, false);
});

test('Save and close uses the shared save entry and closes only once it is clean', async () => {
    const f = fixture({ decision: true });
    await f.controller.request();
    assert.deepEqual(f.calls, ['draft', 'confirm', 'save', ['close', false]]);
    assert.equal(f.host.hasUnsavedSettings, false);
});

test('a failed or conflicting save leaves the editor and draft open for review', async () => {
    const f = fixture({ decision: true, saveSucceeds: false });
    await f.controller.request();
    assert.deepEqual(f.calls, ['draft', 'confirm', 'save']);
    assert.equal(f.isOpen(), true); assert.equal(f.host.hasUnsavedSettings, true);
});

test('new edits staged during Save are not discarded by closing the editor', async () => {
    const f = fixture({ decision: true });
    f.host.savePendingSettings = async () => { f.calls.push('save-with-new-draft'); return true; };
    await f.controller.request();
    assert.deepEqual(f.calls, ['draft', 'confirm', 'save-with-new-draft']);
    assert.equal(f.isOpen(), true);
});

test('new edits staged while Discard waits keep the editor open for another explicit choice', async () => {
    const f = fixture();
    f.host.discardPendingSettings = async () => { f.calls.push('discard-with-new-draft'); };
    await f.controller.request();
    assert.deepEqual(f.calls, ['draft', 'confirm', 'discard-with-new-draft']);
    assert.equal(f.isOpen(), true); assert.equal(f.host.hasUnsavedSettings, true);
});

test('repeated clicks share one pending prompt and cannot publish twice', async () => {
    const f = fixture();
    let answer;
    f.actions.confirmSave = () => { f.calls.push('confirm'); return new Promise(resolve => { answer = resolve; }); };
    const first = f.controller.request();
    await Promise.resolve();
    await f.controller.request();
    assert.deepEqual(f.calls, ['draft', 'confirm']);
    answer(true); await first;
    assert.deepEqual(f.calls, ['draft', 'confirm', 'save', ['close', false]]);
});

test('tearing down an editor while its prompt is open prevents later publication', async () => {
    const f = fixture();
    let answer;
    f.actions.confirmSave = () => new Promise(resolve => { answer = resolve; });
    const closing = f.controller.request();
    await Promise.resolve(); f.teardown(); answer(true); await closing;
    assert.deepEqual(f.calls, ['draft']);
});

test('an opted-in close save keeps the existing automatic close path', async () => {
    const f = fixture({ manual: false });
    await f.controller.request();
    assert.deepEqual(f.calls, ['draft', ['close', true]]);
});

test('Don’t save stays authoritative if another editor changes the saving mode', async () => {
    const f = fixture();
    f.actions.confirmSave = async () => { f.host.settings.MANUAL_CONFIG_SAVE = false; return false; };
    await f.controller.request();
    assert.deepEqual(f.calls, ['draft', 'discard', ['close', false]]);
    assert.equal(f.host.hasUnsavedSettings, false);
});

test('a debounced search draft is captured before deciding whether to ask', async () => {
    const f = fixture({ dirty: false });
    f.actions.prepareDraft = async () => { f.calls.push('draft'); f.host.hasUnsavedSettings = true; };
    await f.controller.request();
    assert.deepEqual(f.calls, ['draft', 'confirm', 'discard', ['close', false]]);
});

test('a pending explicit save cannot be interrupted by closing', async () => {
    const f = fixture({ saving: true });
    await f.controller.request();
    assert.deepEqual(f.calls, ['saving']);
    assert.equal(f.isOpen(), true);
});

test('draft preparation failure leaves the editor open and permits retry', async () => {
    const f = fixture();
    f.actions.prepareDraft = async () => { throw new Error('Draft unavailable'); };
    await assert.rejects(f.controller.request(), /Draft unavailable/);
    assert.equal(f.isOpen(), true); assert.deepEqual(f.calls, []);
    f.actions.prepareDraft = async () => {};
    await f.controller.request();
    assert.deepEqual(f.calls, ['confirm', 'discard', ['close', false]]);
});
