import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const nativeRequire = createRequire(import.meta.url);
let request;
class Base {}
const obsidian = {
    Modal: Base, FuzzySuggestModal: Base, SuggestModal: Base, Plugin: Base, PluginSettingTab: Base,
    Notice: class {}, Platform: { isMobile: false }, normalizePath: value => value,
    requireApiVersion: () => true, requestUrl: input => request(input),
};
const bundle = await build({
    stdin: { contents: `export { applyManagerTransferPackage } from './src/import-export'; export { ManagerModal } from './src/modal/manager-modal';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['obsidian', 'electron'],
    loader: { '.webp': 'dataurl' }, logLevel: 'silent',
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), loaded, loaded.exports);
const { applyManagerTransferPackage, ManagerModal } = loaded.exports;

const plugin = { id: 'expected-plugin', name: 'Expected plugin', repo: 'author/plugin', version: '2.0.0', enabled: true };
const directory = id => `.obsidian/plugins/${id}`;
const manifest = id => ({ id, name: id, version: '2.0.0', minAppVersion: '1.5.8' });

function fixture(downloadedId, existing = false) {
    const files = new Map([[`${directory('keep-plugin')}/data.json`, 'unrelated configuration']]);
    const writes = [], lifecycle = [];
    const manifests = existing ? { [downloadedId]: { ...manifest(downloadedId), version: '1.0.0' } } : {};
    if (existing) {
        files.set(`${directory(downloadedId)}/manifest.json`, JSON.stringify(manifests[downloadedId]));
        files.set(`${directory(downloadedId)}/main.js`, 'original build');
        files.set(`${directory(downloadedId)}/styles.css`, 'original styles');
        files.set(`${directory(downloadedId)}/data.json`, 'original configuration');
    }
    const registry = { manifests, plugins: existing ? { [downloadedId]: { originalRuntime: true } } : {}, enabledPlugins: new Set(existing ? [downloadedId] : []),
        async loadManifests() {
            for (const [path, value] of files) if (path.endsWith('/manifest.json')) {
                const item = JSON.parse(value); registry.manifests[item.id] = item;
            }
        },
        async enablePlugin(id) { lifecycle.push(['enable', id]); registry.plugins[id] = {}; },
        async enablePluginAndSave(id) { await registry.enablePlugin(id); registry.enabledPlugins.add(id); },
        async disablePlugin(id) { lifecycle.push(['disable', id]); delete registry.plugins[id]; },
        async disablePluginAndSave(id) { await registry.disablePlugin(id); registry.enabledPlugins.delete(id); },
    };
    const manager = {
        manifest: { id: 'better-plugins-manager' }, appPlugins: registry,
        settings: { DEBUG: false, REPO_MAP: {}, PLUGIN_INSTALLATIONS: {}, PLUGIN_SOURCE_UNBOUND: [], BPM_INSTALLED: [], Plugins: [] },
        app: { vault: { configDir: '.obsidian', adapter: {
            exists: async path => files.has(path), read: async path => files.get(path),
            mkdir: async path => { writes.push(path); files.set(path, 'directory'); },
            write: async (path, value) => { writes.push(path); files.set(path, value); },
            remove: async path => { writes.push(path); files.delete(path); },
        } } },
        translator: { t: key => key }, getGithubToken: async () => undefined,
        tasks: { start: () => ({ update() {}, done() {}, fail() {} }) },
        repoResolver: { async setRepoBinding(id, repo) { manager.settings.REPO_MAP[id] = repo; } },
        async saveSettings() {}, applyRibbonSettings() {}, applySpecialPluginTags() {},
    };
    request = async input => {
        if (input.url.startsWith('https://api.github.com/repos/author/plugin/releases/')) {
            return { status: 200, json: { tag_name: '2.0.0', assets: ['manifest.json', 'main.js', 'styles.css'].map(name => ({ name, browser_download_url: `https://files.example/${name}` })) }, headers: {} };
        }
        assert.ok(input.url.startsWith('https://files.example/'), `Unexpected request: ${input.url}`);
        return { status: 200, text: input.url.endsWith('/manifest.json') ? JSON.stringify(manifest(downloadedId)) : 'downloaded build', headers: {} };
    };
    return { manager, registry, files, writes, lifecycle };
}

const entrances = {
    async package(manager) {
        return applyManagerTransferPackage(manager, { data: { plugins: [plugin] } }, {
            installMissing: true, installVersionStrategy: 'package', applyEnabledState: true,
            applySources: false, applyPluginMetadata: false, applyPluginConfigs: false,
            applyWorkspaceSettings: false, applyLayout: false, applyThemes: false, applyActiveTheme: false,
        });
    },
    async modal(manager) {
        const modal = Object.create(ManagerModal.prototype);
        modal.manager = manager; modal.appPlugins = manager.appPlugins; modal.settings = manager.settings;
        modal.invalidatePluginCaches = () => {};
        const result = modal.createEmptyTransferResult();
        await modal.downloadTransferPlugin(plugin, result);
        return result;
    },
};

for (const [name, run] of Object.entries(entrances)) {
    for (const existing of [false, true]) {
        test(`Transfer Pack ${name} rejects a different ${existing ? 'installed' : 'new'} plugin ID before writing or enabling`, async () => {
            const { manager, registry, files, writes, lifecycle } = fixture('unexpected-plugin', existing);
            const before = { files: [...files], manifests: structuredClone(registry.manifests), plugins: { ...registry.plugins }, enabled: [...registry.enabledPlugins], settings: structuredClone(manager.settings) };
            const result = await run(manager);
            assert.equal(result.installedPlugins, 0);
            assert.deepEqual(result.failedPlugins.map(item => item.id), [plugin.id]);
            assert.deepEqual(writes, []);
            assert.deepEqual(lifecycle, []);
            assert.deepEqual([...files], before.files);
            assert.deepEqual(registry.manifests, before.manifests);
            assert.deepEqual(registry.plugins, before.plugins);
            assert.deepEqual([...registry.enabledPlugins], before.enabled);
            assert.deepEqual(manager.settings, before.settings);
        });
    }

    test(`Transfer Pack ${name} installs the matching plugin and records its source`, async () => {
        const { manager, registry, files, writes, lifecycle } = fixture(plugin.id);
        const result = await run(manager);
        assert.equal(result.installedPlugins, 1);
        assert.deepEqual(result.failedPlugins, []);
        assert.ok(writes.includes(`${directory(plugin.id)}/manifest.json`));
        assert.equal(JSON.parse(files.get(`${directory(plugin.id)}/manifest.json`)).id, plugin.id);
        assert.ok(registry.enabledPlugins.has(plugin.id));
        assert.ok(lifecycle.some(([action, id]) => action === 'enable' && id === plugin.id));
        assert.equal(manager.settings.PLUGIN_INSTALLATIONS[plugin.id].source.repo, plugin.repo);
        assert.equal(files.get(`${directory('keep-plugin')}/data.json`), 'unrelated configuration');
    });
}
