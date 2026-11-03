import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

let current;
const notices = [];
const api = {
    Notice: class { constructor(text) { notices.push(text); } },
    Platform: { isMobile: false },
    normalizePath: value => value.replace(/\\/g, '/'),
    requireApiVersion: version => version.split('.').map(Number).reduce((sum, value) => sum * 1000 + value, 0) <= current.host.split('.').map(Number).reduce((sum, value) => sum * 1000 + value, 0),
    requestUrl: async input => current.request(input),
};
const compiled = await build({ stdin: { contents: `export * from './src/updates/update-service'; export * from './src/updates/update-policy'; export * from './src/catalog/obsidian-io'; export * from './src/catalog/catalog-installer';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, format: 'cjs', platform: 'node', write: false, external: ['obsidian', 'electron'], logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(name => { if (name === 'obsidian') return api; throw Error(`Unexpected dependency ${name}`); }, module, module.exports);
const { UpdateService, sourceIdentity, notificationsMuted, getCatalogService, catalogVersions, installCatalogRelease } = module.exports;
let sequence = 0;
const root = id => `.obsidian/plugins/${id}`;
const manifest = (id, version = '1.0.0', extra = {}) => ({ id, name: id, version, minAppVersion: '1.5.8', ...extra });
const release = (tag, version = tag.replace(/^v/, ''), extra = {}) => ({ tag, version, minAppVersion: '1.5.8', date: '2020-01-01T00:00:00Z', ...extra });

function harness(ids = ['a', 'b', 'c']) {
    notices.length = 0;
    api.Platform.isMobile = false;
    const number = ++sequence;
    const files = new Map();
    const requests = [], operations = [], writes = [], releases = new Map();
    const manifests = { 'better-plugins-manager': manifest('better-plugins-manager', '1.2.4') };
    const enabledPlugins = new Set(), plugins = {}, mappings = {};
    for (const id of ids) {
        manifests[id] = manifest(id);
        mappings[id] = `team/test-${number}-${id}`;
        releases.set(mappings[id], [release('2.0.0'), release('1.0.0', '1.0.0', { date: '2019-01-01T00:00:00Z' })]);
        files.set(root(id), 'directory');
        files.set(`${root(id)}/manifest.json`, JSON.stringify(manifests[id]));
        files.set(`${root(id)}/main.js`, 'old main');
        files.set(`${root(id)}/styles.css`, 'old styles');
        files.set(`${root(id)}/data.json`, 'current user settings');
        if (id !== 'b') { enabledPlugins.add(id); plugins[id] = { _loaded: true }; }
    }
    const state = {
        host: '1.12.0', requests, operations, files, releases, writes, officialCalls: 0, saved: undefined,
        failWrite: undefined, beforeRequest: undefined,
        async request(input) {
            requests.push(input);
            await state.beforeRequest?.(input);
            const url = new URL(input.url);
            let json, text;
            if (url.hostname === 'api.github.com') {
                const parts = url.pathname.split('/');
                const repo = `${parts[2]}/${parts[3]}`;
                const values = releases.get(repo);
                if (!values) return { status: 404, text: '', arrayBuffer: new ArrayBuffer(0), headers: {} };
                const response = value => ({ tag_name: value.tag, prerelease: value.prerelease || false, published_at: value.date,
                    assets: ['manifest.json', 'main.js', ...(value.styles ? ['styles.css'] : [])].map(name => ({ name, browser_download_url: `https://files.example/${repo}/${encodeURIComponent(value.tag)}/${name}` })) });
                if (parts[5] === 'latest') json = response(values.find(value => value.latest) || values[0]);
                else if (parts[5] === 'tags') { const value = values.find(value => value.tag === decodeURIComponent(parts[6])); if (!value) return { status: 404 }; json = response(value); }
                else json = values.map(response);
            } else if (url.hostname === 'files.example') {
                const parts = url.pathname.split('/');
                const repo = `${parts[1]}/${parts[2]}`;
                const value = releases.get(repo)?.find(value => value.tag === decodeURIComponent(parts[3]));
                if (!value) return { status: 404 };
                const id = Object.entries(mappings).find(([, value]) => value === repo)?.[0];
                text = parts[4] === 'manifest.json' ? JSON.stringify(manifest(value.id || id, value.version, { minAppVersion: value.minAppVersion, isDesktopOnly: value.isDesktopOnly })) : `build ${value.version}`;
            } else if (state.external?.has(input.url)) {
                const value = state.external.get(input.url);
                if (value instanceof Error) throw value;
                text = typeof value === 'string' ? value : JSON.stringify(value);
            } else throw Error(`Unexpected request: ${input.url}`);
            return { status: 200, json, text, headers: {}, arrayBuffer: new ArrayBuffer((text || '').length) };
        },
    };
    const manager = {
        manifest: manifests['better-plugins-manager'], updateStatus: {},
        settings: { DEBUG: false, GITHUB_PROXY: '', BETA_SOURCES: [], REPO_MAP: mappings, BPM_INSTALLED: [], Plugins: ids.map(id => ({ id, name: id, desc: '', enabled: enabledPlugins.has(id), tags: [], group: '', delay: '', note: '' })),
            PLUGIN_UPDATE_RULES: {}, PLUGIN_INSTALLATIONS: {}, PLUGIN_UPDATE_CHECK_MODE: 'release', PLUGIN_UPDATE_COMPATIBILITY_MODE: 'compatible', PLUGIN_UPDATE_DELAY_DAYS: 0 },
        app: { vault: { configDir: '.obsidian', adapter: {
            exists: async path => files.has(path), read: async path => { if (!files.has(path)) throw Error('File missing'); return files.get(path); },
            write: async (path, value) => { if (state.failWrite?.(path, value)) throw Error(`Disk failure: ${path}`); writes.push(path); operations.push(`write:${path}`); files.set(path, value); },
            remove: async path => { operations.push(`remove:${path}`); files.delete(path); }, mkdir: async path => files.set(path, 'directory'),
        } } },
        appPlugins: { manifests, enabledPlugins, plugins,
            disablePlugin: async id => { operations.push(`disable:${id}`); delete plugins[id]; },
            enablePlugin: async id => { operations.push(`enable:${id}`); plugins[id] = { _loaded: true }; },
            enablePluginAndSave: async id => { operations.push(`enable:${id}`); enabledPlugins.add(id); plugins[id] = { _loaded: true }; },
            disablePluginAndSave: async id => { enabledPlugins.delete(id); delete plugins[id]; },
            loadManifests: async () => { for (const [path, value] of files) if (path.endsWith('/manifest.json')) { const item = JSON.parse(value); manifests[item.id] = item; } },
        },
        translator: { t: (key, vars) => `${key}${vars ? JSON.stringify(vars) : ''}` },
        tasks: { start: () => ({ update() {}, done() {}, fail() {} }) },
        getPluginUpdateCheckOptions: () => ({ updateCheckMode: manager.settings.PLUGIN_UPDATE_CHECK_MODE, compatibilityMode: manager.settings.PLUGIN_UPDATE_COMPATIBILITY_MODE, updateDelayDays: manager.settings.PLUGIN_UPDATE_DELAY_DAYS }),
        fetchOfficialStats: async () => { state.officialCalls++; return {}; },
        getGithubToken: async () => 'test-token', hasGithubToken: () => true,
        repoResolver: { resolveRepo: async id => mappings[id], setRepo: async (id, repo) => { mappings[id] = repo; }, setRepoBinding: async (id, repo) => { if (repo) mappings[id] = repo; else delete mappings[id]; } },
        applyRibbonSettings() {}, applySpecialPluginTags() {},
        saveSettings: async () => { state.saved = structuredClone(manager.settings); },
    };
    manager.updates = new UpdateService(manager);
    current = state;
    return { state, manager, updates: manager.updates };
}

test('exclusions persist and stop network checks without changing enabled state', async () => {
    const { state, manager, updates } = harness();
    const enabled = [...manager.appPlugins.enabledPlugins];
    await updates.setRule('a', { excluded: true });
    assert.equal((await updates.check('a')).reason, 'excluded');
    assert.equal(state.requests.length, 0);
    assert.deepEqual([...manager.appPlugins.enabledPlugins], enabled);
    manager.settings = structuredClone(state.saved);
    assert.equal(updates.rule('a').excluded, true);
    await updates.setRule('a', {});
    assert.equal((await updates.check('a', { force: true })).hasUpdate, true);
});

test('skipping a release is source-specific and does not hide a later release; muting preserves results', async () => {
    const { state, manager, updates } = harness(['a']);
    const status = await updates.check('a', { force: true });
    await updates.skip('a', status.sourceIdentity, { ...status.target, version: 'v2.0.0' });
    assert.equal((await updates.check('a', { force: true })).reason, 'skipped-version');
    assert.equal(updates.blockReason('a', 'github:another/repo', '2.0.0'), undefined);
    state.releases.get(manager.settings.REPO_MAP.a).unshift(release('3.0.0'));
    assert.equal((await updates.check('a', { force: true })).hasUpdate, true);
    await updates.setRule('a', { ...updates.rule('a'), muteUntil: Date.now() + 86400000 });
    assert.equal(manager.updateStatus.a.hasUpdate, true);
    assert.equal((await updates.check('a', { force: true })).remoteVersion, '3.0.0');
    assert.equal(manager.updateStatus.a.hasUpdate, true);
    assert.equal(updates.muted('a'), true);
    assert.equal(notificationsMuted(manager.settings.PLUGIN_UPDATE_RULES, 'a', Date.now() + 86400001), false);
    await updates.skip('a', status.sourceIdentity, { version: 'Release-A', prerelease: false });
    assert.equal(updates.blockReason('a', status.sourceIdentity, 'release-a'), undefined);
});

test('tracked sources share compatibility, age, prerelease, frozen-version and exclusion rules', async () => {
    const { state, manager, updates } = harness(['a']);
    const repo = manager.settings.REPO_MAP.a;
    const tracked = { id: 'a', type: 'plugin', repo, mode: 'frozen', frozenVersion: '2.0.0', enabled: true, autoUpdate: true };
    manager.settings.BETA_SOURCES.push(tracked);
    state.releases.set(repo, [release('2.0.0', '2.0.0', { minAppVersion: '99.0.0' }), release('1.0.0')]);
    assert.equal((await updates.check('a', { force: true })).reason, 'incompatible');
    state.releases.set(repo, [release('2.0.0', '2.0.0', { prerelease: true }), release('1.0.0')]);
    assert.equal((await updates.check('a', { force: true })).reason, 'prerelease');
    state.releases.set(repo, [release('2.0.0', '2.0.0', { date: new Date().toISOString() }), release('1.0.0')]);
    tracked.updateDelayDays = 7;
    assert.equal((await updates.check('a', { force: true })).reason, 'too-new');
    await updates.setRule('a', { excluded: true });
    await updates.checkTracked(tracked);
    assert.equal(tracked.updatePolicyReason, 'excluded');
});

test('compatible GitHub Latest is preferred even when a compatibility release has a later date', async () => {
    const { state, manager, updates } = harness(['a']);
    manager.appPlugins.manifests.a.version = '4.14.2';
    state.releases.set(manager.settings.REPO_MAP.a, [release('4.14.3', '4.14.3', { date: '2025-01-01T00:00:00Z' }),
        release('4.21.1', '4.21.1', { date: '2024-01-01T00:00:00Z', minAppVersion: '1.13.0', latest: true }),
        release('4.14.2', '4.14.2', { date: '2024-12-01T00:00:00Z' })]);
    assert.equal((await updates.check('a', { force: true })).remoteVersion, '4.14.3');
    state.host = '1.14.0';
    const status = await updates.check('a', { force: true });
    assert.equal(status.remoteVersion, '4.21.1');
    assert.equal(status.hasUpdate, true);
});

test('release receipts reconcile tags that differ from manifest versions without repeated updates', async () => {
    const { state, manager, updates } = harness(['a']);
    state.releases.set(manager.settings.REPO_MAP.a, [release('release-2026-05', '2.0.0'), release('1.0.0')]);
    let status = await updates.check('a', { force: true });
    assert.equal(status.hasUpdate, true);
    assert.equal(await updates.install('a', status, true, '1.0.0'), true);
    assert.equal(manager.settings.PLUGIN_INSTALLATIONS.a.tag, 'release-2026-05');
    assert.equal((await updates.check('a', { force: true })).hasUpdate, false);
    delete manager.settings.PLUGIN_INSTALLATIONS.a;
    assert.equal((await updates.check('a', { force: true })).hasUpdate, false);
});

test('batch updates execute sequentially, restore failed files, continue, preserve state and rescan once', async () => {
    const { state, manager, updates } = harness();
    let scans = 0;
    const checkAll = updates.checkAll.bind(updates);
    updates.checkAll = async (...args) => { scans++; return checkAll(...args); };
    const plan = await updates.prepare();
    assert.equal(plan.rows.filter(row => row.status.hasUpdate).length, 3);
    assert.equal(plan.rows.find(row => row.pluginId === manager.manifest.id).status.reason, 'self');
    let failed = false;
    state.failWrite = (path, value) => { if (!failed && path === `${root('b')}/main.js` && value === 'build 2.0.0') { failed = true; return true; } return false; };
    const report = await updates.run(plan);
    assert.deepEqual(report.results.filter(result => result.row.pluginId !== manager.manifest.id).map(result => result.outcome), ['updated', 'failed', 'updated']);
    assert.equal(scans, 2);
    assert.equal(notices.length, 0);
    assert.deepEqual([...manager.appPlugins.enabledPlugins].sort(), ['a', 'c']);
    assert.equal(manager.appPlugins.manifests.b.version, '1.0.0');
    assert.equal(state.files.get(`${root('b')}/main.js`), 'old main');
    for (const id of ['a', 'b', 'c']) assert.equal(state.files.get(`${root(id)}/data.json`), 'current user settings');
    assert.ok(state.operations.indexOf('enable:a') < state.operations.indexOf(`write:${root('b')}/manifest.json`));
    assert.ok(state.operations.indexOf(`write:${root('b')}/main.js`) < state.operations.indexOf('disable:c'));
});

test('batch execution never silently substitutes a new target or installs an excluded item', async () => {
    const { state, manager, updates } = harness();
    const plan = await updates.prepare();
    state.releases.get(manager.settings.REPO_MAP.a).unshift(release('3.0.0'));
    await updates.setRule('b', { excluded: true });
    const report = await updates.run(plan);
    assert.equal(report.results.find(result => result.row.pluginId === 'a').reason, 'changed');
    assert.equal(report.results.find(result => result.row.pluginId === 'b').reason, 'excluded');
    assert.equal(manager.appPlugins.manifests.a.version, '1.0.0');
    assert.equal(manager.appPlugins.manifests.c.version, '2.0.0');
});

test('a rule changed while downloading is revalidated before any build file is written', async () => {
    const { state, manager, updates } = harness(['a']);
    const plan = await updates.prepare();
    state.beforeRequest = input => { if (input.url.endsWith('/main.js')) manager.settings.PLUGIN_UPDATE_RULES.a = { excluded: true }; };
    const report = await updates.run(plan);
    assert.equal(report.results.find(result => result.row.pluginId === 'a').reason, 'excluded');
    assert.equal(state.writes.length, 0);
});

test('independent historical installs retain source identity and detect equal-date updates without GitHub credentials', async () => {
    const { state, manager, updates } = harness([]);
    state.external = new Map();
    const service = getCatalogService(manager);
    const payload = { schemaVersion: 1, name: 'Independent', plugins: [{ id: 'independent', name: 'Independent', repositoryUrl: 'https://git.example/team/plugin', releases: [
        { version: 'build-2', publishedAt: '2025-01-01T00:00:00Z', manifest: 'https://cdn.example/2/manifest.json', main: 'https://cdn.example/2/main.js' },
        { version: 'build-1', publishedAt: '2025-01-01T00:00:00Z', manifest: 'https://cdn.example/1/manifest.json', main: 'https://cdn.example/1/main.js', styles: 'https://cdn.example/1/styles.css' },
    ] }] };
    for (const version of [1, 2]) {
        state.external.set(`https://cdn.example/${version}/manifest.json`, manifest('independent', `${version}.0.0`));
        state.external.set(`https://cdn.example/${version}/main.js`, `build ${version}`);
    }
    state.external.set('https://cdn.example/1/styles.css', 'old styles');
    await service.importSource(payload, 'source.json');
    const entry = service.entries()[0];
    assert.equal((await catalogVersions(manager, entry)).length, 2);
    assert.equal(await installCatalogRelease(manager, entry, entry.releases[1], { quiet: true }), true);
    assert.equal(manager.appPlugins.manifests.independent.version, '1.0.0');
    assert.equal(manager.settings.REPO_MAP.independent, undefined);
    assert.equal(sourceIdentity(manager.settings.PLUGIN_INSTALLATIONS.independent.source), `catalog:${entry.key}`);
    const plan = await updates.prepare();
    assert.equal(plan.rows.find(row => row.pluginId === 'independent').status.remoteVersion, 'build-2');
    const report = await updates.run(plan);
    assert.equal(report.results.find(result => result.row.pluginId === 'independent').outcome, 'updated');
    assert.equal(manager.appPlugins.manifests.independent.version, '2.0.0');
    assert.equal((await updates.check('independent')).hasUpdate, false);
    assert.equal(state.files.has(`${root('independent')}/styles.css`), false);
    assert.equal(state.requests.some(input => input.headers?.Authorization || input.url.includes('github.com')), false);
    await service.remove(entry.source.id);
    const count = state.requests.length;
    assert.equal((await updates.check('independent')).reason, 'source-unavailable');
    assert.equal(state.requests.length, count);
});

test('independent files with an incorrect ID, missing compatibility or failed download cannot overwrite plugins', async () => {
    const { state, manager } = harness(['a']);
    state.external = new Map([['https://cdn.example/manifest.json', manifest('wrong', '2.0.0')], ['https://cdn.example/main.js', 'new main']]);
    const service = getCatalogService(manager);
    await service.importSource({ schemaVersion: 1, name: 'Custom', plugins: [{ id: 'a', releases: [{ version: '2', manifest: 'https://cdn.example/manifest.json', main: 'https://cdn.example/main.js' }] }] }, 'custom.json');
    const entry = service.entries()[0], writes = state.writes.length;
    assert.equal(await installCatalogRelease(manager, entry, entry.releases[0], { quiet: true }), false);
    state.external.set('https://cdn.example/manifest.json', manifest('a', '2.0.0', { minAppVersion: '99.0.0' }));
    assert.equal(await installCatalogRelease(manager, entry, entry.releases[0], { quiet: true }), false);
    state.external.set('https://cdn.example/manifest.json', manifest('a', '2.0.0'));
    state.external.set('https://cdn.example/main.js', new Error('Download interrupted'));
    assert.equal(await installCatalogRelease(manager, entry, entry.releases[0], { quiet: true }), false);
    assert.equal(state.writes.length, writes);
    assert.equal(state.files.get(`${root('a')}/data.json`), 'current user settings');
});

test('explicit install receipts override stale same-ID subscriptions and unknown legacy origins never fall back', async () => {
    const { manager, updates, state } = harness(['a']);
    const repo = manager.settings.REPO_MAP.a;
    manager.settings.PLUGIN_INSTALLATIONS.a = { source: { kind: 'github', repo }, tag: '1.0.0', manifestVersion: '1.0.0' };
    manager.settings.BETA_SOURCES = [{ id: 'a', type: 'plugin', repo: 'wrong/fork', enabled: false, mode: 'frozen', frozenVersion: 'wrong' }];
    const status = await updates.check('a');
    assert.equal(status.repo, repo); assert.equal(status.hasUpdate, true);
    assert.equal(state.requests.some(request => request.url.includes('wrong/fork')), false);
    manager.settings.PLUGIN_SOURCE_UNBOUND = ['a'];
    const count = state.requests.length;
    const stopped = await updates.check('a');
    assert.equal(stopped.reason, 'source-unavailable'); assert.equal(state.requests.length, count);
});

test('a stale subscription cannot regain automatic update authority after a cross-source restore', async () => {
    const { manager, updates, state } = harness(['a']);
    const source = { id: 'a', type: 'plugin', repo: 'previous/fork', enabled: true, autoUpdate: true };
    manager.settings.BETA_SOURCES = [source];
    manager.settings.PLUGIN_INSTALLATIONS.a = { source: { kind: 'github', repo: manager.settings.REPO_MAP.a }, tag: '1.0.0', manifestVersion: '1.0.0' };
    assert.equal(updates.tracksInstallation(source), false);
    await updates.checkTracked(source);
    assert.equal(source.updatePolicyReason, 'source-unavailable'); assert.equal(state.requests.length, 0);
    source.repo = manager.settings.REPO_MAP.a;
    assert.equal(updates.tracksInstallation(source), true);
    manager.settings.PLUGIN_INSTALLATIONS.a = { source: { kind: 'catalog', key: 'external:a', sourceId: 'external', pluginId: 'a' }, tag: '1.0.0', manifestVersion: '1.0.0' };
    assert.equal(updates.tracksInstallation(source), false);
});
