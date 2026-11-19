import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/settings/sync-exclusion-state.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' });
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { areSyncAdvisoriesSuppressed, setSyncAdvisoriesSuppressed, SYNC_ADVISORY_SUPPRESSION_KEY } = module.exports;
test('advisory suppression persists only in local app state and can be cleared', () => {
    const values = new Map();
    const manager = { settings: { DEBUG: false }, app: { loadLocalStorage: key => values.get(key), saveLocalStorage: (key, value) => values.set(key, value) } };
    assert.equal(areSyncAdvisoriesSuppressed(manager), false);
    setSyncAdvisoriesSuppressed(manager, true);
    assert.equal(values.get(SYNC_ADVISORY_SUPPRESSION_KEY), true);
    assert.equal(areSyncAdvisoriesSuppressed(manager), true);
    setSyncAdvisoriesSuppressed(manager, false);
    assert.equal(areSyncAdvisoriesSuppressed(manager), false);
});
test('unreadable preference leaves advisories enabled', () => {
    assert.equal(areSyncAdvisoriesSuppressed({ settings: { DEBUG: false }, app: { loadLocalStorage() { throw new Error('denied'); }, saveLocalStorage() {} } }), false);
});
