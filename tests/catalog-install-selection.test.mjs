import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ stdin: { contents: `export * from './src/catalog/catalog'; export * from './src/catalog/install-selection';`,
    resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['obsidian'] });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(() => ({}), loaded, loaded.exports);
const { CatalogService, createCatalogInstallGuard } = loaded.exports;

const release = (version = '2.0.0') => ({ version, manifest: `https://files.example/${version}/manifest.json`,
    main: `https://files.example/${version}/main.js`, styles: `https://files.example/${version}/styles.css` });
const source = (releases = [release()]) => ({ schemaVersion: 1, name: 'Independent', plugins: [{ id: 'plugin', repo: 'team/plugin', releases }] });
async function fixture(releases) {
    const manager = { settings: { REPO_MAP: { plugin: 'team/old' }, PLUGIN_INSTALLATIONS: {}, PLUGIN_SOURCE_UNBOUND: [] },
        translator: { t: key => key } };
    const service = new CatalogService({ read: async () => undefined, write: async () => {}, request: async () => { throw Error('Unexpected network request'); } });
    await service.importSource(source(releases), 'Independent', 'https://source.example/catalog.json');
    const entry = service.entries()[0];
    return { manager, service, entry, guard: createCatalogInstallGuard(manager, service, entry) };
}

test('catalog choices reject changes to legacy repository bindings and explicit unbound state', async () => {
    const { manager, guard } = await fixture();
    guard('2.0.0');
    manager.settings.REPO_MAP.plugin = 'other/plugin';
    assert.throws(() => guard('2.0.0'), /批量更新_清单变化/);
    manager.settings.REPO_MAP.plugin = 'team/old';
    guard('2.0.0');
    manager.settings.PLUGIN_SOURCE_UNBOUND.push('plugin');
    assert.throws(() => guard('2.0.0'), /批量更新_清单变化/);
});

test('catalog choices capture the complete installation receipt while never mutating its source binding', async () => {
    const { manager, service, entry } = await fixture();
    manager.settings.PLUGIN_INSTALLATIONS.plugin = { source: { kind: 'github', repo: 'team/old' }, tag: '1.0.0', manifestVersion: '1.0.0' };
    const before = structuredClone(manager.settings);
    const guard = createCatalogInstallGuard(manager, service, entry);
    guard('2.0.0');
    assert.deepEqual(manager.settings, before);
    manager.settings.PLUGIN_INSTALLATIONS.plugin.tag = '1.1.0';
    assert.throws(() => guard('2.0.0'), /批量更新_清单变化/);
});

test('source removal and same-key origin replacement invalidate the reviewed catalog choice', async () => {
    const { manager, service, entry, guard } = await fixture();
    await service.remove(entry.source.id);
    assert.throws(() => guard('2.0.0'), /目录_来源冲突/);
    const changed = source(); changed.plugins[0].repo = 'another/plugin';
    await service.importSource(changed, 'Independent', entry.source.url);
    assert.throws(() => guard('2.0.0'), /目录_来源冲突/);
    assert.equal(manager.settings.REPO_MAP.plugin, 'team/old');
});

test('changed or removed selected download URLs are rejected even when source identity and URL stay the same', async () => {
    for (const file of ['manifest', 'main', 'styles']) {
        const { service, entry, guard } = await fixture();
        const changed = source(); changed.plugins[0].releases[0][file] = `https://replacement.example/${file}`;
        await service.importSource(changed, 'Independent', entry.source.url);
        assert.throws(() => guard('2.0.0'), /批量更新_清单变化/);
    }
    const { service, entry, guard } = await fixture();
    await service.importSource(source([release('3.0.0')]), 'Independent', entry.source.url);
    assert.throws(() => guard('2.0.0'), /批量更新_清单变化/);
});

test('ordinary catalog refreshes and new unrelated releases preserve a reviewed historical choice', async () => {
    const { service, entry, guard } = await fixture();
    const refreshed = source([release('3.0.0'), release()]);
    refreshed.name = 'Updated display name';
    refreshed.plugins[0].description = 'Updated metadata';
    await service.importSource(refreshed, 'Independent', entry.source.url);
    guard('2.0.0');
});

test('GitHub-backed entries keep repository guards without treating metadata-only release records as install files', async () => {
    const { service, entry, guard } = await fixture([]);
    guard('github-tag');
    await service.importSource(source([{ version: '2.0.0', notes: 'Metadata only' }]), 'Independent', entry.source.url);
    guard('github-tag');
    const changed = source([]); changed.plugins[0].repo = 'another/plugin';
    await service.importSource(changed, 'Independent', entry.source.url);
    assert.throws(() => guard('github-tag'), /目录_来源冲突/);
});
