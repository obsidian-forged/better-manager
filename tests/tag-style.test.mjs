import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/ui/tag-style.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { tagStyleProperties, applyTagStyle } = module.exports;

test('tag colors preserve full and shorthand hex values across visual modes', () => {
    assert.equal(tagStyleProperties('#abc', 'a')['--bpm-tag-bg'], '#AABBCC');
    assert.equal(tagStyleProperties('#AABBCC', 'b')['--bpm-tag-bg'], 'transparent');
    assert.equal(tagStyleProperties('#102030', 'c')['--bpm-tag-bg'], 'rgba(16, 32, 48, 0.3)');
    assert.equal(tagStyleProperties('#EEF020', 'd')['--bpm-tag-border'], '#FFFF52');
});

test('external colors cannot inject arbitrary declarations or resource requests', () => {
    for (const value of ['red; background: url(https://example.invalid)', '#fff; color: red', {}, null, 123]) {
        const props = tagStyleProperties(value, 'c');
        assert.equal(props['--bpm-tag-fg'], 'var(--text-accent)');
        assert.equal(props['--bpm-tag-bg'], 'var(--background-modifier-hover)');
    }
});

test('switching tag modes replaces every property without stale fill or dashed border', () => {
    const classes = new Set(), properties = {};
    const element = { addClass: name => classes.add(name), setCssProps: props => Object.assign(properties, props) };
    applyTagStyle(element, '#123456', 'unknown');
    assert.equal(properties['--bpm-tag-border-style'], 'dashed');
    applyTagStyle(element, '#123456', 'a');
    assert.equal(properties['--bpm-tag-border-style'], 'solid');
    applyTagStyle(element, '#123456', 'b');
    assert.equal(properties['--bpm-tag-bg'], 'transparent');
    assert.ok(classes.has('manager-tag--styled'));
});
