import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const nativeRequire = createRequire(import.meta.url);
async function load(entry) {
    const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs',
        write: false, external: ['obsidian', 'electron'], logLevel: 'silent' });
    const module = { exports: {} };
    // 使用内存中的真实迁移模块，不读写 vault；Exercise production migrations without vault IO.
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(name => {
        if (name === 'obsidian') return {};
        return nativeRequire(name);
    }, module, module.exports);
    return module.exports;
}
const { runMigrations } = await load('src/migrations.ts');
const { DEFAULT_SETTINGS } = await load('src/settings/data.ts');
function fixture(overrides = {}) {
    let saves = 0;
    const manager = { settings: { ...structuredClone(DEFAULT_SETTINGS), MIGRATION_VERSION: '1.1.11', ...overrides },
        manifest: { version: '1.2.0' }, getAppLanguage: () => 'en', async saveSettings() { saves++; } };
    return { manager, saves: () => saves };
}

test('new installs default to current-page labels with hover labels enabled', async () => {
    const { manager } = fixture({ MIGRATION_VERSION: '' });
    assert.equal(DEFAULT_SETTINGS.TOOLBAR_LABEL_MODE, 'active');
    assert.equal(DEFAULT_SETTINGS.TOOLBAR_HOVER_LABELS, true);
    await runMigrations(manager);
    assert.equal(manager.settings.TOOLBAR_LABEL_MODE, 'active');
    assert.equal(manager.settings.TOOLBAR_HOVER_LABELS, true);
    assert.equal(manager.settings.RELEASE_HIGHLIGHTS_PENDING, '');
});

test('upgrading overrides both earlier label preferences and persists once', async () => {
    for (const mode of ['always', 'active', 'hidden']) {
        const { manager, saves } = fixture({ TOOLBAR_LABEL_MODE: mode, TOOLBAR_HOVER_LABELS: false });
        assert.equal(await runMigrations(manager), true);
        assert.equal(manager.settings.TOOLBAR_LABEL_MODE, 'active');
        assert.equal(manager.settings.TOOLBAR_HOVER_LABELS, true);
        assert.equal(manager.settings.MIGRATION_VERSION, '1.2.0');
        assert.equal(manager.settings.RELEASE_HIGHLIGHTS_PENDING, '1.2.0');
        assert.equal(saves(), 1);
    }
});

test('subsequent loads preserve choices made after the 1.2.0 migration', async () => {
    const { manager, saves } = fixture();
    await runMigrations(manager);
    manager.settings.TOOLBAR_LABEL_MODE = 'hidden';
    manager.settings.TOOLBAR_HOVER_LABELS = false;
    manager.settings.RELEASE_HIGHLIGHTS_PENDING = '';
    assert.equal(await runMigrations(manager), false);
    assert.equal(manager.settings.TOOLBAR_LABEL_MODE, 'hidden');
    assert.equal(manager.settings.TOOLBAR_HOVER_LABELS, false);
    assert.equal(manager.settings.RELEASE_HIGHLIGHTS_PENDING, '');
    assert.equal(saves(), 1);
});

test('startup can batch the migration into its existing deferred settings save', async () => {
    const { manager, saves } = fixture({ TOOLBAR_LABEL_MODE: 'always', TOOLBAR_HOVER_LABELS: false });
    assert.equal(await runMigrations(manager, { save: false }), true);
    assert.equal(manager.settings.TOOLBAR_LABEL_MODE, 'active');
    assert.equal(manager.settings.TOOLBAR_HOVER_LABELS, true);
    assert.equal(saves(), 0);
});
