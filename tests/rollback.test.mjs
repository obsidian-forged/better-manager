import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const api = { Platform: { isMobile: false }, normalizePath: value => value.replace(/\\/g, '/'), requireApiVersion: value => value !== '99.0.0', Notice: class {} };
const built = await build({ stdin: { contents: "export * from './src/rollback/plugin-history'; export * from './src/rollback/config-merge'; export * from './src/install/plugin-installer'; export * from './src/repo-resolver';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, format: 'cjs', platform: 'node', write: false, external: ['obsidian'], logLevel: 'silent' });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(() => api, loaded, loaded.exports);
const { PluginHistory, mergeConfigStructure, installPluginFiles, RepoResolver } = loaded.exports;
const root = '.obsidian/plugins/example';
const manifest = version => JSON.stringify({ id: 'example', name: 'Example', version, minAppVersion: '1.5.8' });
const task = { update() {} };
function fixture(enabled = true) {
    const files = new Map([[`${root}/manifest.json`, manifest('1.0.0')], [`${root}/main.js`, 'build 1'], [`${root}/styles.css`, 'styles 1'],
        [`${root}/data.json`, JSON.stringify({ color: 'red', nested: { size: 5 }, removed: true })], [`${root}/data/user.txt`, 'keep user data']]);
    const writes = [], registry = { manifests: { example: JSON.parse(manifest('1.0.0')) }, plugins: enabled ? { example: {} } : {}, enabledPlugins: new Set(enabled ? ['example'] : []) };
    const state = { files, writes, fail: undefined, failLoad: undefined, unload: undefined };
    const adapter = {
        exists: async path => files.has(path), read: async path => { if (!files.has(path)) throw Error(`Missing ${path}`); return files.get(path); },
        write: async (path, text) => { if (state.fail?.(path, text)) throw Error('Disk failure'); writes.push(path); files.set(path, text); },
        mkdir: async path => files.set(path, 'directory'), remove: async path => files.delete(path),
        list: async path => ({ files: [...files.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')), folders: [] }),
    };
    registry.disablePlugin = async id => { state.unload?.(); delete registry.plugins[id]; };
    registry.enablePlugin = async id => { if (state.failLoad?.(registry.manifests[id].version)) throw Error('Load failure'); registry.plugins[id] = {}; };
    registry.enablePluginAndSave = async id => { await registry.enablePlugin(id); registry.enabledPlugins.add(id); };
    registry.disablePluginAndSave = async id => { await registry.disablePlugin(id); registry.enabledPlugins.delete(id); };
    registry.loadManifests = async () => { registry.manifests.example = JSON.parse(files.get(`${root}/manifest.json`)); };
    const manager = { manifest: { id: 'better-plugins-manager' }, app: { vault: { configDir: '.obsidian', adapter } }, appPlugins: registry,
        settings: { PLUGIN_ROLLBACK_ENABLED: false, PLUGIN_ROLLBACK_LIMIT: 10, PLUGIN_INSTALLATIONS: {}, REPO_MAP: {}, PLUGIN_SOURCE_UNBOUND: [], BPM_INSTALLED: [], Plugins: [] }, updateStatus: {},
        translator: { t: key => key }, saveSettings: async () => {}, applyRibbonSettings() {}, applySpecialPluginTags() {}, repoResolver: { setRepo: async () => {} } };
    manager.repoResolver = new RepoResolver(manager);
    manager.history = new PluginHistory(manager, true);
    return { state, manager, history: manager.history, registry };
}
async function update(manager, version = '2.0.0') {
    await installPluginFiles(manager, { manifestText: manifest(version), mainJs: `build ${version}`, styles: null },
        { source: { kind: 'github', repo: 'team/example' }, tag: version, label: 'Example', quiet: true }, task);
}
test('release availability blocks rollback and automatic backups even when old settings enable them', async () => {
    const { manager, state } = fixture(); manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
    const history = new PluginHistory(manager); manager.history = history;
    assert.equal(history.available, false); assert.equal(history.enabled(), false);
    await update(manager);
    assert.equal([...state.files.keys()].some(path => path.includes('/history/')), false);
    assert.equal(manager.settings.PLUGIN_ROLLBACK_ENABLED, true);
    await assert.rejects(history.create('example', 'Unavailable'), /回退_未开启/);
    await assert.rejects(history.rename('example', 'a-b', 'Unavailable'), /回退_未开启/);
    await assert.rejects(history.remove('example', 'a-b'), /回退_未开启/);
});
test('backups are opt-in; enabled updates retain the previous build without writing user configuration', async () => {
    const { state, manager, history } = fixture();
    await update(manager);
    assert.deepEqual(await history.list('example'), []);
    manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
    await update(manager, '3.0.0');
    const points = await history.list('example');
    assert.equal(points.length, 1); assert.equal(points[0].version, '2.0.0');
    assert.equal(points[0].receipt.tag, '2.0.0');
    assert.equal(points[0].files['styles.css'], null);
    assert.equal(state.writes.includes(`${root}/data.json`), false);
});

test('updates preserve session-only runtime overrides without changing persistent enablement', async () => {
    for (const persisted of [false, true]) {
        const { manager, registry } = fixture(persisted);
        const running = !persisted;
        if (running) registry.plugins.example = {}; else delete registry.plugins.example;
        manager.settings.Plugins.push({ id: 'example', enabled: running, tags: [] });
        await update(manager);
        assert.equal(registry.enabledPlugins.has('example'), persisted);
        assert.equal(Boolean(registry.plugins.example), running);
        assert.equal(manager.settings.Plugins[0].enabled, running);
    }
});

test('failed updates also preserve session-only runtime and persistent enablement', async () => {
    for (const persisted of [false, true]) {
        const { state, manager, registry } = fixture(persisted);
        const running = !persisted;
        if (running) registry.plugins.example = {}; else delete registry.plugins.example;
        state.fail = (path, text) => path === `${root}/main.js` && text === 'build 2.0.0';
        await assert.rejects(update(manager), /Disk failure/);
        assert.equal(registry.enabledPlugins.has('example'), persisted);
        assert.equal(Boolean(registry.plugins.example), running);
        assert.equal(state.files.get(`${root}/main.js`), 'build 1');
    }
});
test('named restore points survive retention and restoring a build retains current settings and enabled state', async () => {
    const { state, manager, history, registry } = fixture(false);
    manager.settings.PLUGIN_ROLLBACK_ENABLED = true; manager.settings.PLUGIN_ROLLBACK_LIMIT = 1;
    const point = await history.create('example', 'Before upgrade');
    await update(manager); await update(manager, '3.0.0');
    assert.equal((await history.list('example')).filter(point => point.automatic).length, 1);
    state.files.set(`${root}/data.json`, '{"color":"blue","newOption":42}');
    const plan = await history.prepare('example', point.id);
    await history.restore(plan);
    assert.equal(registry.manifests.example.version, '1.0.0');
    assert.equal(registry.enabledPlugins.has('example'), false); assert.equal(Boolean(registry.plugins.example), false);
    assert.equal(state.files.get(`${root}/data.json`), '{"color":"blue","newOption":42}');
    assert.equal(state.files.get(`${root}/data/user.txt`), 'keep user data');
    assert.ok((await history.list('example')).some(item => item.id === point.id));
});
test('structural config restore keeps current matching values and previews removed or filled fields', async () => {
    const { state, manager, history } = fixture(); manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
    const point = await history.create('example', 'Old structure');
    await update(manager);
    state.files.set(`${root}/data.json`, JSON.stringify({ color: 'blue', nested: { size: 12, newField: true }, added: 99 }));
    const plan = await history.prepare('example', point.id, true);
    assert.deepEqual(plan.removed.sort(), ['$.added', '$.nested.newField']); assert.deepEqual(plan.restored, ['$.removed']);
    await history.restore(plan);
    assert.deepEqual(JSON.parse(state.files.get(`${root}/data.json`)), { color: 'blue', nested: { size: 12 }, removed: true });
    assert.equal(state.files.get(`${root}/main.js`), 'build 1');
});
test('restore revalidates preview, snapshot integrity, platform and explicit opt-in', async () => {
    const { state, manager, history } = fixture(); manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
    const point = await history.create('example', 'Stable'), plan = await history.prepare('example', point.id);
    state.files.set(`${root}/data.json`, '{}');
    await assert.rejects(history.restore(plan), /回退_预览变化/);
    const newer = await history.prepare('example', point.id);
    await history.rename('example', point.id, 'Renamed');
    await assert.rejects(history.restore(newer), /回退_预览变化/);
    const path = [...state.files.keys()].find(path => path.endsWith(`${point.id}.json`));
    const snapshot = JSON.parse(state.files.get(path)); snapshot.files['manifest.json'] = manifest('different');
    state.files.set(path, JSON.stringify(snapshot));
    await assert.rejects(history.prepare('example', point.id), /version mismatch/);
    manager.settings.PLUGIN_ROLLBACK_ENABLED = false;
    await assert.rejects(history.create('example', ''), /回退_未开启/);
    await assert.rejects(history.list('../escape'), /回退_无效插件/);
    await assert.rejects(history.list(manager.manifest.id), /回退_无效插件/);
});
test('backup failure aborts updates and restores a running plugin before any build write', async () => {
    const { state, manager, registry } = fixture(); manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
    state.fail = path => path.includes('/data/history/');
    await assert.rejects(update(manager), /Disk failure/);
    assert.equal(state.files.get(`${root}/main.js`), 'build 1');
    assert.ok(registry.plugins.example); assert.equal(state.writes.includes(`${root}/main.js`), false);
});
test('restore load failure rolls back build and merged settings together', async () => {
    const { state, manager, history, registry } = fixture(); manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
    const point = await history.create('example', 'Original'); await update(manager);
    state.files.set(`${root}/data.json`, '{"color":"blue","newField":1}');
    const plan = await history.prepare('example', point.id, true);
    state.failLoad = version => version === '1.0.0';
    await assert.rejects(history.restore(plan), /Load failure/);
    assert.equal(registry.manifests.example.version, '2.0.0'); assert.ok(registry.plugins.example);
    assert.equal(state.files.get(`${root}/data.json`), '{"color":"blue","newField":1}');
    assert.equal(manager.settings.PLUGIN_INSTALLATIONS.example.tag, '2.0.0');
});
test('config changes during unload require a new preview without replacing build or config', async () => {
    const { state, manager, history, registry } = fixture(); manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
    const point = await history.create('example', 'Original'); await update(manager);
    const plan = await history.prepare('example', point.id);
    state.unload = () => state.files.set(`${root}/data.json`, '{"savedOnUnload":true}');
    await assert.rejects(history.restore(plan), /回退_预览变化/);
    assert.equal(registry.manifests.example.version, '2.0.0'); assert.ok(registry.plugins.example);
    assert.equal(state.files.get(`${root}/data.json`), '{"savedOnUnload":true}');
});
test('array merging retains current records and order without resurrecting deleted records', () => {
    const result = mergeConfigStructure({ items: [{ id: 'old', enabled: false, size: 1 }], empty: [], unknown: null },
        { items: [{ id: 'new', enabled: true, size: 8, extra: 1 }], empty: ['keep'], unknown: { current: true } });
    assert.deepEqual(result.value, { items: [{ id: 'new', enabled: true, size: 8 }], empty: ['keep'], unknown: { current: true } });
    assert.throws(() => mergeConfigStructure({ items: [1] }, { items: ['changed type'] }), /Cannot infer/);
});

const github = (repo, version = '1.0.0') => ({ source: { kind: 'github', repo }, tag: `v${version}`, manifestVersion: version });
const catalog = (version = '1.0.0') => ({ source: { kind: 'catalog', key: 'private:example', sourceId: 'private', pluginId: 'example', url: 'https://plugins.example/catalog.json' }, tag: version, manifestVersion: version });
const pointPath = (state, point) => [...state.files.keys()].find(path => path.endsWith(`${point.id}.json`));
async function bind(manager, receipt) {
    manager.settings.PLUGIN_INSTALLATIONS.example = receipt;
    await manager.repoResolver.setRepoBinding('example', receipt.source.kind === 'github' ? receipt.source.repo : null);
}
test('cross-source rollback restores receipt, repository mapping and the persistent resolver cache', async () => {
    for (const [original, replacement] of [[github('original/example'), github('fork/example', '2.0.0')], [github('original/example'), catalog('2.0.0')], [catalog(), github('fork/example', '2.0.0')]]) {
        const { state, manager, history } = fixture(); manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
        await bind(manager, original);
        const point = await history.create('example', 'Original source');
        await installPluginFiles(manager, { manifestText: manifest('2.0.0'), mainJs: 'new build', styles: null }, { ...replacement, label: 'Replacement', quiet: true }, task);
        await history.restore(await history.prepare('example', point.id));
        assert.deepEqual(manager.settings.PLUGIN_INSTALLATIONS.example.source, original.source);
        assert.equal(manager.settings.PLUGIN_INSTALLATIONS.example.tag, original.tag);
        const repo = original.source.kind === 'github' ? original.source.repo : undefined;
        assert.equal(manager.settings.REPO_MAP.example, repo);
        const cache = JSON.parse(state.files.get('.obsidian/plugins/better-plugins-manager/cache/community-plugins.json'));
        assert.equal(cache.example, repo);
        assert.deepEqual(manager.settings.PLUGIN_SOURCE_UNBOUND, []);
    }
});
test('legacy points with receipts recover their source and tolerate omitted optional build files', async () => {
    const { state, manager, history } = fixture(); manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
    await bind(manager, github('original/example'));
    const point = await history.create('example', 'Legacy');
    const path = pointPath(state, point), old = JSON.parse(state.files.get(path));
    delete old.binding; delete old.files['styles.css']; delete old.files['data.json'];
    state.files.set(path, JSON.stringify(old));
    await update(manager);
    const plan = await history.prepare('example', point.id);
    assert.equal(plan.snapshot.binding.repo, 'original/example');
    await history.restore(plan);
    assert.equal(await manager.repoResolver.resolveRepo('example'), 'original/example');
    assert.equal(manager.settings.PLUGIN_INSTALLATIONS.example.tag, 'v1.0.0');
    assert.equal(state.files.has(`${root}/styles.css`), false);
});
test('legacy points without provenance clear the new source and block discovery until explicitly rebound', async () => {
    const { state, manager, history } = fixture(); manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
    const point = await history.create('example', 'No provenance'), path = pointPath(state, point), old = JSON.parse(state.files.get(path));
    delete old.binding; delete old.receipt; state.files.set(path, JSON.stringify(old));
    await update(manager);
    await history.restore(await history.prepare('example', point.id));
    assert.equal(manager.settings.REPO_MAP.example, undefined);
    assert.equal(manager.settings.PLUGIN_INSTALLATIONS.example, undefined);
    assert.deepEqual(manager.settings.PLUGIN_SOURCE_UNBOUND, ['example']);
    assert.equal(await manager.repoResolver.resolveRepo('example'), null);
    // A fresh resolver must also ignore even a stale on-disk community cache.
    state.files.set('.obsidian/plugins/better-plugins-manager/cache/community-plugins.json', '{"example":"fork/example"}');
    assert.equal(await new RepoResolver(manager).resolveRepo('example'), null);
    await update(manager);
    assert.deepEqual(manager.settings.PLUGIN_SOURCE_UNBOUND, []);
    assert.equal(await manager.repoResolver.resolveRepo('example'), 'team/example');
});
test('points captured before receipts existed retain their explicit repository mapping', async () => {
    const { manager, history } = fixture(); manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
    await manager.repoResolver.setRepo('example', 'original/example');
    const point = await history.create('example', 'Mapping only'); await update(manager);
    await history.restore(await history.prepare('example', point.id));
    assert.equal(await manager.repoResolver.resolveRepo('example'), 'original/example');
    assert.equal(manager.settings.PLUGIN_INSTALLATIONS.example, undefined);
    assert.deepEqual(manager.settings.PLUGIN_SOURCE_UNBOUND, []);
});
test('source changes after preview abort before build replacement', async () => {
    const { state, manager, history } = fixture(); manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
    const point = await history.create('example', 'Old'); await update(manager);
    const plan = await history.prepare('example', point.id);
    await bind(manager, github('changed/example', '2.0.0'));
    await assert.rejects(history.restore(plan), /回退_预览变化/);
    assert.equal(state.files.get(`${root}/main.js`), 'build 2.0.0');
    assert.equal(manager.settings.REPO_MAP.example, 'changed/example');
});
test('failed provenance persistence restores the previous build, receipt and resolver cache', async () => {
    const { state, manager, history, registry } = fixture(); manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
    await bind(manager, github('original/example'));
    const point = await history.create('example', 'Old'); await update(manager);
    let failOnce = true;
    manager.saveSettings = async () => { if (failOnce) { failOnce = false; throw Error('Settings failure'); } };
    await assert.rejects(history.restore(await history.prepare('example', point.id)), /Settings failure/);
    assert.equal(registry.manifests.example.version, '2.0.0'); assert.ok(registry.plugins.example);
    assert.equal(state.files.get(`${root}/main.js`), 'build 2.0.0');
    assert.equal(manager.settings.PLUGIN_INSTALLATIONS.example.tag, '2.0.0');
    assert.equal(await manager.repoResolver.resolveRepo('example'), 'team/example');
    assert.equal(JSON.parse(state.files.get('.obsidian/plugins/better-plugins-manager/cache/community-plugins.json')).example, 'team/example');
});

test('mixed and reordered plugin choices use stable identity and discriminator instead of the first object', () => {
    const old = { choices: [{ id: 'template', type: 'Template', templatePath: 'old.md' }, { id: 'capture', type: 'Capture', captureTo: 'old.md' },
        { id: 'macro', type: 'Macro', commands: [{ id: 'script', type: 'UserScript', settings: {} }, { id: 'wait', type: 'Wait', time: 10 }] }] };
    const current = { choices: [{ id: 'capture', type: 'Capture', captureTo: 'new-inbox.md' }, { id: 'template', type: 'Template', templatePath: 'new-template.md' },
        { id: 'macro', type: 'Macro', commands: [{ id: 'wait', type: 'Wait', time: 900 }, { id: 'script', type: 'UserScript', settings: { arbitraryKey: 'new', nested: { value: 7 } } }] }] };
    const merged = mergeConfigStructure(old, current);
    assert.deepEqual(merged.value, current); assert.deepEqual(merged.removed, []); assert.deepEqual(merged.restored, []);
    assert.throws(() => mergeConfigStructure(old, { choices: [{ id: 'new', type: 'UnknownChoice', payload: 1 }] }), /Cannot infer.*choices/);
    assert.throws(() => mergeConfigStructure([{ value: 1 }, { different: 2 }], [{ third: 3 }]), /Cannot infer/);
});
test('failed new runtime configuration migrations restore data.json even when only build files were requested', async () => {
    const { manager, registry, state } = fixture();
    const before = state.files.get(`${root}/data.json`), enable = registry.enablePlugin;
    registry.enablePlugin = async id => {
        if (registry.manifests[id].version === '2.0.0') { state.files.set(`${root}/data.json`, '{"migratedThenCrashed":true}'); throw Error('Migration crashed'); }
        await enable(id);
    };
    await assert.rejects(update(manager), /Migration crashed/);
    assert.equal(state.files.get(`${root}/data.json`), before);
    assert.equal(registry.manifests.example.version, '1.0.0'); assert.ok(registry.plugins.example);
});
test('failed restored runtime migrations restore the current configuration in build-only mode', async () => {
    const { manager, registry, state, history } = fixture(); manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
    const point = await history.create('example', 'Before upgrade'); await update(manager);
    const before = state.files.get(`${root}/data.json`), enable = registry.enablePlugin;
    registry.enablePlugin = async id => {
        if (registry.manifests[id].version === '1.0.0') { state.files.set(`${root}/data.json`, '{"oldRuntimeMutatedThenCrashed":true}'); throw Error('Old migration crashed'); }
        await enable(id);
    };
    await assert.rejects(history.restore(await history.prepare('example', point.id)), /Old migration crashed/);
    assert.equal(state.files.get(`${root}/data.json`), before);
    assert.equal(registry.manifests.example.version, '2.0.0'); assert.ok(registry.plugins.example);
});

test('dictionary preservation is explicit, previewed and revalidated when restoring', async () => {
    const { state, manager, history } = fixture(); manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
    state.files.set(`${root}/data.json`, '{"scripts":{"custom":{"region":"old"}},"strict":{"size":1}}');
    const point = await history.create('example', 'Dictionary'); await update(manager);
    state.files.set(`${root}/data.json`, '{"scripts":{"custom":{"region":"current","newUserKey":"keep"}},"strict":{"size":9,"newOption":true}}');
    const initial = await history.prepare('example', point.id, true);
    assert.ok(initial.preservableObjects.includes('$.scripts.custom'));
    const plan = await history.prepare('example', point.id, true, ['$.scripts.custom']);
    assert.deepEqual(plan.removed, ['$.strict.newOption']);
    await history.restore(plan);
    assert.deepEqual(JSON.parse(state.files.get(`${root}/data.json`)), { scripts: { custom: { region: 'current', newUserKey: 'keep' } }, strict: { size: 9 } });
});

test('real QuickAdd migration fixtures preserve mixed workflows and expose irreversible renamed fields', async () => {
    const { readFile } = await import('node:fs/promises');
    const fixture = JSON.parse(await readFile(new URL('./fixtures/rollback-quickadd.json', import.meta.url), 'utf8'));
    const initial = mergeConfigStructure(fixture.previous, fixture.current);
    const path = initial.preservableObjects.find(path => path.endsWith('.settings'));
    assert.ok(path);
    const result = mergeConfigStructure(fixture.previous, fixture.current, [path]);
    const choices = result.value.choices[0].choices;
    assert.deepEqual(choices.map(choice => choice.type), ['Macro', 'Capture', 'Template']);
    assert.equal(choices.find(choice => choice.type === 'Capture').captureTo, 'CurrentInbox.md');
    assert.equal(choices.find(choice => choice.type === 'Template').templatePath, 'Templates/new-current.md');
    const commands = choices.find(choice => choice.type === 'Macro').macro.commands;
    assert.equal(commands.find(command => command.type === 'Wait').time, 875);
    assert.equal(commands.find(command => command.type === 'UserScript').settings.newUserKey, 'keep this');
    assert.ok(result.removed.includes('$.templateFolderPaths'));
    assert.ok(result.restored.includes('$.templateFolderPath'));
    assert.ok(result.restored.some(path => path.endsWith('.fileExistsMode')));
});
test('real Templater migration fixtures retain tuple arrays, reordered records and newly added user entries', async () => {
    const { readFile } = await import('node:fs/promises');
    const fixture = JSON.parse(await readFile(new URL('./fixtures/rollback-templater.json', import.meta.url), 'utf8'));
    const result = mergeConfigStructure(fixture.previous, fixture.current);
    for (const key of ['templates_pairs', 'folder_templates', 'command_timeout', 'templates_folder', 'user_scripts_folder']) assert.deepEqual(result.value[key], fixture.current[key]);
    assert.ok(result.removed.includes('$.data_version'));
    assert.ok(result.removed.includes('$.trigger_on_file_creation_mode'));
    assert.ok(result.restored.includes('$.trigger_on_file_creation'));
    assert.equal(result.value.trigger_on_file_creation, false);
});
test('dictionary paths distinguish literal punctuation from nested property names', () => {
    const previous = { 'a.b': { old: 1 }, a: { b: { old: 1 } } }, current = { 'a.b': { old: 2, new: 3 }, a: { b: { old: 4, new: 5 } } };
    const merged = mergeConfigStructure(previous, current, ['$["a.b"]']);
    assert.deepEqual(merged.value, { 'a.b': { old: 2, new: 3 }, a: { b: { old: 4 } } });
    assert.deepEqual(merged.removed, ['$.a.b.new']);
});

test('catalog bindings never leak back into GitHub discovery through a stale community cache', async () => {
    const { manager, state } = fixture(); await bind(manager, catalog());
    state.files.set('.obsidian/plugins/better-plugins-manager/cache/community-plugins.json', '{"example":"wrong/fork"}');
    assert.equal(await new RepoResolver(manager).resolveRepo('example'), null);
});
test('invalid source metadata or mismatched source plugin IDs cannot replace a build', async () => {
    const { manager, state, history } = fixture(); manager.settings.PLUGIN_ROLLBACK_ENABLED = true;
    await bind(manager, catalog()); const point = await history.create('example', 'Valid'), path = pointPath(state, point), original = state.files.get(path);
    for (const mutate of [value => { value.binding.receipt.source.pluginId = 'different'; }, value => { value.binding.receipt.manifestVersion = '9.0.0'; }, value => { value.binding.repo = '../escape'; }]) {
        const value = JSON.parse(original); mutate(value); state.files.set(path, JSON.stringify(value));
        await assert.rejects(history.prepare('example', point.id), /source|binding/);
        assert.equal(state.files.get(`${root}/main.js`), 'build 1');
    }
});

test('explicitly rebinding a repository clears incompatible receipts while normal discovery respects receipts', async () => {
    const { manager } = fixture(); await bind(manager, catalog());
    await manager.repoResolver.setRepo('example', 'new/team');
    assert.equal(manager.settings.PLUGIN_INSTALLATIONS.example, undefined);
    assert.equal(await manager.repoResolver.resolveRepo('example'), 'new/team');
    await bind(manager, github('original/example'));
    manager.settings.REPO_MAP.example = 'stale/fork';
    assert.equal(await manager.repoResolver.resolveRepo('example'), 'original/example');
    await manager.repoResolver.setRepo('example', 'different/team');
    assert.equal(manager.settings.PLUGIN_INSTALLATIONS.example, undefined);
    assert.equal(await manager.repoResolver.resolveRepo('example'), 'different/team');
});

test('installation persists source and plugin registration together once and undoes both on save failure', async () => {
    const { manager, state, registry } = fixture();
    let saves = 0; manager.saveSettings = async () => { saves++; };
    await update(manager);
    assert.equal(saves, 1);
    assert.equal(manager.settings.PLUGIN_INSTALLATIONS.example.tag, '2.0.0');
    assert.equal(manager.settings.BPM_INSTALLED.includes('example'), true);
    const before = structuredClone(manager.settings.Plugins), receipt = structuredClone(manager.settings.PLUGIN_INSTALLATIONS.example);
    manager.settings.BPM_INSTALLED = [];
    let failOnce = true;
    manager.saveSettings = async () => { if (failOnce) { failOnce = false; throw Error('Registration save failure'); } };
    await assert.rejects(update(manager, '3.0.0'), /Registration save failure/);
    assert.equal(registry.manifests.example.version, '2.0.0'); assert.ok(registry.plugins.example);
    assert.equal(state.files.get(`${root}/main.js`), 'build 2.0.0');
    assert.deepEqual(manager.settings.Plugins, before); assert.deepEqual(manager.settings.BPM_INSTALLED, []);
    assert.deepEqual(manager.settings.PLUGIN_INSTALLATIONS.example.source, receipt.source);
    assert.equal(manager.settings.PLUGIN_INSTALLATIONS.example.tag, receipt.tag);
});
