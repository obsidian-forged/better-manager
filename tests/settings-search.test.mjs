import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/settings/search.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { rankSettings } = module.exports;
const entries = [
    { name: 'Plugin appearance', description: 'Customize toolbar labels and hover behavior.' },
    { name: 'Toolbar tab labels', description: 'Choose which page labels stay visible.' },
    { name: 'Recent install window', description: 'Show a clock badge for recently installed plugins.' },
    { name: '最近安装时间范围', description: '显示最近安装插件的时钟标签，设为 0 时隐藏。' },
    { name: '启动时检查更新', description: '按发布日期策略暂缓安装新版本。' },
];

test('setting names rank above descriptions, with normalized case and spacing', () => {
    assert.equal(rankSettings(entries, ' TOOLBAR   LABELS ')[0].name, 'Toolbar tab labels');
    assert.equal(rankSettings(entries, 'Recent install window')[0], entries[2]);
});
test('descriptions are searchable even when the title has no matching term', () => {
    assert.deepEqual(rankSettings(entries, '发布日期'), [entries[4]]);
    assert.deepEqual(rankSettings(entries, 'clock badge'), [entries[2]]);
});
test('all query terms must match, including across the name and description', () => {
    assert.deepEqual(rankSettings(entries, '最近 时钟'), [entries[3]]);
    assert.deepEqual(rankSettings(entries, 'toolbar irrelevant'), []);
});
test('bounded spelling corrections find ordinary typos without scattered-letter matches', () => {
    assert.equal(rankSettings(entries, 'toolbr labels')[0], entries[1]);
    assert.deepEqual(rankSettings(entries, 'tlblr'), []);
    assert.deepEqual(rankSettings(entries, '时表'), []);
    assert.deepEqual(rankSettings(entries, ''), []);
});
test('equal relevance preserves the original settings order', () => {
    const rows = [{ name: 'One', description: 'same phrase' }, { name: 'Two', description: 'same phrase' }];
    assert.deepEqual(rankSettings(rows, 'same phrase'), rows);
});
