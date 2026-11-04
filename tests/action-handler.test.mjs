import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/ui/action-handler.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { createActionHandler } = module.exports;

test('UI callbacks return void while forwarding event arguments and async failures', async () => {
    const failures = [], received = [], error = new Error('cannot save');
    const event = { type: 'click' };
    const action = createActionHandler(reason => failures.push(reason));
    const callback = action(async (...args) => { received.push(args); throw error; });
    assert.equal(callback(event, 'target'), undefined);
    await Promise.resolve();
    assert.deepEqual(received, [[event, 'target']]);
    assert.deepEqual(failures, [error]);
});

test('UI callbacks also report synchronous failures from promise-returning adapters', () => {
    const failures = [], error = new Error('adapter failed before promise');
    const callback = createActionHandler(reason => failures.push(reason))(() => { throw error; });
    assert.equal(callback(), undefined);
    assert.deepEqual(failures, [error]);
});
