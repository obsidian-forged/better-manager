import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const nativeRequire = createRequire(import.meta.url);
const result = await build({ entryPoints: ['src/ribbon-migration.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(nativeRequire, module, module.exports);
const { migrateLegacyRibbonSettings } = module.exports;

const legacyItem = (id, order, visible = true) => ({ id, name: id, icon: 'star', visible, order });

test('converts every legacy entry in one pass and keeps visibility and order', () => {
    const settings = {
        RIBBON_SETTINGS: [
            legacyItem('plugin-a:Alpha', 0, true),
            legacyItem('plugin-b:Beta', 1, false),
            legacyItem('plugin-c:Gamma', 2, true),
        ],
    };
    assert.equal(migrateLegacyRibbonSettings(settings), true);
    const list = settings.RIBBON_SETTINGS;
    assert.equal(list.length, 3);
    assert.deepEqual(list.map(item => item.visible), [true, false, true]);
    assert.deepEqual(list.map(item => item.order), [0, 1, 2]);
    assert.deepEqual(list.map(item => item.bpmUniqueId), ['plugin-a', 'plugin-b', 'plugin-c']);
    assert.equal(list.some(item => 'id' in item), false);
    list.forEach(item => assert.deepEqual(item.ribbonIdMap, { en: item.ribbonIdMap.en, zh: item.ribbonIdMap.zh }));
});

test('same plugin prefix gets a unique sequence id without losing entries', () => {
    const settings = {
        RIBBON_SETTINGS: [
            legacyItem('plugin-a:Alpha', 0),
            legacyItem('plugin-a:Beta', 1),
        ],
    };
    assert.equal(migrateLegacyRibbonSettings(settings), true);
    const ids = settings.RIBBON_SETTINGS.map(item => item.bpmUniqueId);
    assert.deepEqual(ids, ['plugin-a', 'plugin-a#2']);
    assert.equal(new Set(ids).size, 2);
});

test('existing modern entries stay untouched and already covered legacy ids are dropped', () => {
    const modern = { bpmUniqueId: 'plugin-a', name: 'Alpha', icon: 'star', visible: false, order: 5, ribbonIdMap: { en: 'plugin-a:Alpha' } };
    const settings = { RIBBON_SETTINGS: [structuredClone(modern), legacyItem('plugin-a:Alpha', 0, true)] };
    assert.equal(migrateLegacyRibbonSettings(settings), true);
    assert.deepEqual(settings.RIBBON_SETTINGS, [modern]);
});

test('entries without id or bpmUniqueId are preserved instead of silently dropped', () => {
    const mystery = { name: 'Mystery', icon: 'help-circle', visible: true, order: 9 };
    const settings = { RIBBON_SETTINGS: [legacyItem('plugin-a:Alpha', 0), mystery] };
    assert.equal(migrateLegacyRibbonSettings(settings), true);
    const list = settings.RIBBON_SETTINGS;
    assert.equal(list.length, 2);
    assert.ok(list.includes(mystery));
    assert.ok(list.some(item => item.bpmUniqueId === 'plugin-a'));
});

test('nothing to migrate reports false and leaves settings untouched', () => {
    const settings = { RIBBON_SETTINGS: [{ bpmUniqueId: 'plugin-a', name: 'A', icon: 'star', visible: true, order: 0 }] };
    const before = structuredClone(settings);
    assert.equal(migrateLegacyRibbonSettings(settings), false);
    assert.deepEqual(settings, before);
});

test('non-array settings are ignored', () => {
    assert.equal(migrateLegacyRibbonSettings({}), false);
    assert.equal(migrateLegacyRibbonSettings({ RIBBON_SETTINGS: null }), false);
});
