import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['src/tasks/task-center.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('module', 'exports', built.outputFiles[0].text)(module, module.exports);
const { BackgroundTaskCenter } = module.exports;

test('running tasks report clamped progress and settle once', () => {
    const center = new BackgroundTaskCenter(assert.ifError);
    const task = center.start({ title: 'Downloading', progress: 0.2 });
    assert.equal(center.runningCount(), 1);
    assert.deepEqual(center.snapshots().map(({ title, progress, status }) => ({ title, progress, status })),
        [{ title: 'Downloading', progress: 0.2, status: 'running' }]);

    task.update({ title: 'Downloading files', progress: 2 });
    assert.equal(center.snapshots()[0].progress, 1);
    task.update({ progress: -1 });
    assert.equal(center.snapshots()[0].progress, 0);
    assert.equal(center.snapshots()[0].title, 'Downloading files');

    task.done();
    assert.equal(center.snapshots()[0].status, 'done');
    assert.equal(center.snapshots()[0].progress, 1);
    task.update({ title: 'Late update', progress: 0.1 });
    assert.equal(center.snapshots()[0].title, 'Downloading files');
    assert.equal(center.snapshots()[0].progress, 1);
    task.fail();
    assert.equal(center.snapshots()[0].status, 'done');
    assert.equal(center.runningCount(), 0);
});

test('only settled tasks can be dismissed', () => {
    const center = new BackgroundTaskCenter(assert.ifError);
    const running = center.start({ title: 'Running' });
    assert.equal(center.dismiss(running.id), false);
    assert.equal(center.snapshots().length, 1);

    running.fail();
    assert.equal(center.runningCount(), 0);
    assert.equal(center.dismiss(running.id), true);
    assert.equal(center.snapshots().length, 0);
    assert.equal(center.dismiss(running.id), false);
});

test('subscribers are notified on start, progress, settle and dismiss only once unsubscribed', () => {
    const center = new BackgroundTaskCenter(assert.ifError);
    let calls = 0;
    const unsubscribe = center.subscribe(() => { calls++; });
    const task = center.start({ title: 'Task' });
    task.update({ progress: 0.5 });
    task.done();
    assert.equal(calls, 3);
    center.dismiss(task.id);
    assert.equal(calls, 4);
    unsubscribe();
    center.start({ title: 'Another' });
    assert.equal(calls, 4);
});

test('a throwing subscriber does not break other subscribers', () => {
    const errors = [];
    const center = new BackgroundTaskCenter(error => errors.push(error));
    let informed = 0;
    const failure = new Error('boom');
    center.subscribe(() => { throw failure; });
    center.subscribe(() => { informed++; });
    center.start({ title: 'Task' });
    assert.equal(informed, 1);
    assert.deepEqual(errors, [failure]);
});

test('settled tasks are trimmed before running tasks when the list grows', () => {
    const center = new BackgroundTaskCenter(assert.ifError);
    const running = center.start({ title: 'Running' });
    const finished = [];
    for (let index = 0; index < 45; index++) {
        const task = center.start({ title: `Task ${index}` });
        task.done();
        finished.push(task);
    }
    const snapshots = center.snapshots();
    assert.equal(snapshots.length, 40);
    assert.equal(snapshots[0].title, 'Running');
    assert.equal(center.runningCount(), 1);
    assert.equal(center.snapshots().some(task => task.id === finished[0].id), false);
    assert.equal(center.dismiss(running.id), false);
});
