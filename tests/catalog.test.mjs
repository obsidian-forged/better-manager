import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const built = await build({ entryPoints: ['src/catalog/catalog.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('module', 'exports', built.outputFiles[0].text)(module, module.exports);
const { CatalogService, parseCatalog, parseStats, parseReleases, catalogUrl, catalogRepo, compareCatalogVersions, OFFICIAL_CATALOG, OFFICIAL_STATS } = module.exports;
async function loadModule(entry) {
    const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
    const module = { exports: {} };
    new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
    return module.exports;
}
const { discoveryOrder, lowExposure, relevance, matchesScenario } = await loadModule('src/catalog/discovery.ts');
const { CatalogTryList } = await loadModule('src/catalog/try-list.ts');
const plugin = (id = 'custom-plugin', repo = 'team/plugin') => ({ id, repo, name: 'Custom plugin', author: 'Author' });
const catalog = (name = 'Custom', plugins = [plugin()]) => ({ schemaVersion: 1, name, plugins });
const harness = (request = async () => { throw Error('Unexpected request'); }, persisted) => {
    const state = { writes: [], persisted, calls: [] };
    const service = new CatalogService({
        read: async () => state.persisted,
        write: async value => { state.writes.push(structuredClone(value)); state.persisted = structuredClone(value); },
        request: async (...args) => { state.calls.push(args); return request(...args); },
    });
    return { service, state };
};

test('official-style catalog preserves legacy IDs and normalizes GitHub URLs', () => {
    const parsed = parseCatalog([plugin('ObsidianAnkiSync', 'https://github.com/team/plugin.git'), plugin('waka_time_box'), plugin('scrybble.ink')], 'Official');
    assert.equal(parsed.plugins[0].repo, 'team/plugin');
    assert.equal(parsed.plugins[0].repositoryUrl, 'https://github.com/team/plugin.git');
    assert.equal(parsed.plugins[1].id, 'waka_time_box');
});

test('independent sources support GitLab/Gitee/self-hosted repositories and no repository', () => {
    for (const repositoryUrl of ['https://gitlab.com/team/subgroup/plugin', 'https://gitee.com/team/plugin', 'https://git.example.org/team/plugin']) {
        const result = parseCatalog(catalog('Private', [{ id: 'unlisted', repositoryUrl, lastMaintainedAt: '2026-10-29T00:00:00Z' }]), 'Imported');
        assert.equal(result.plugins[0].repo, '');
        assert.equal(result.plugins[0].repositoryUrl, repositoryUrl);
        assert.equal(result.plugins[0].lastMaintainedAt, '2026-10-29T00:00:00Z');
    }
    assert.equal(parseCatalog(catalog('Metadata only', [{ id: 'no-repo' }]), 'Imported').plugins[0].repo, '');
});

test('source availability is explicit and never inferred from repositories or licenses', () => {
    const parsed = parseCatalog(catalog('Mixed', [
        { id: 'closed', openness: 'closed-source', repositoryUrl: 'https://github.com/vendor/binaries', publisher: 'Vendor', originUrl: 'https://vendor.example/plugin' },
        { id: 'open', openness: 'open-source', repositoryUrl: 'https://git.example/team/source', license: 'MIT' },
        { id: 'unknown', repo: 'team/plugin', license: 'MIT' },
        { id: 'closed-no-repo', openness: 'closed-source', homepage: 'https://vendor.example/plugin' },
    ]), 'Mixed');
    assert.deepEqual(parsed.plugins.map(item => item.openness), ['closed-source', 'open-source', 'unknown', 'closed-source']);
    assert.equal(parsed.plugins[0].publisher, 'Vendor');
    assert.equal(parsed.plugins[0].originUrl, 'https://vendor.example/plugin');
    assert.throws(() => parseCatalog(catalog('Missing code', [{ id: 'open', openness: 'open-source' }]), 'Test'), /source repository/);
    assert.throws(() => parseCatalog(catalog('Invalid', [{ id: 'bad', openness: 'public' }]), 'Test'), /openness/);
});

test('documented import example works offline and retains open/closed-source provenance across reload', async () => {
    const fixture = JSON.parse(await readFile(new URL('../docs/catalog-source.example.json', import.meta.url), 'utf8'));
    const { service, state } = harness();
    await service.importSource(fixture, 'example.json');
    assert.equal(state.calls.length, 0);
    assert.equal(service.entries().length, 2);
    assert.equal(service.entries()[1].openness, 'closed-source');
    assert.equal(service.entries()[1].repositoryUrl, undefined);
    assert.equal(service.entries()[1].originUrl, 'https://vendor.example.org/plugin');
    assert.equal(service.entries()[0].stats.versions.length, 2);
    const restored = harness(undefined, state.persisted);
    await restored.service.load();
    assert.deepEqual(restored.service.entries(), service.entries());
});

test('version chart orders prereleases before stable releases without discarding arbitrary tags', () => {
    const versions = ['v1.10.0', '1.2.0', '1.2.0-rc.10', '1.2.0-rc.2', '1.2.0-beta.1'];
    assert.deepEqual(versions.sort(compareCatalogVersions), ['1.2.0-beta.1', '1.2.0-rc.2', '1.2.0-rc.10', '1.2.0', 'v1.10.0']);
    assert.equal(compareCatalogVersions('v1.0.0', '1.0.0+build.1'), 0);
    assert.equal(['nightly-10', 'nightly-2'].sort(compareCatalogVersions)[0], 'nightly-2');
});

test('independent releases retain compatibility, metadata and relative file URLs', () => {
    const result = parseCatalog(catalog('Custom', [{ id: 'unlisted', version: '1.2.0', minAppVersion: '1.8.0', isDesktopOnly: false,
        license: 'MIT', tags: ['Editor'], releases: [{ version: '1.2.0', downloads: 0, manifest: './1.2.0/manifest.json', main: './1.2.0/main.js', notes: '<script>plain text</script>' }] }]),
    'Imported', 'https://cdn.example.org/plugins/catalog.json');
    assert.equal(result.plugins[0].releases[0].main, 'https://cdn.example.org/plugins/1.2.0/main.js');
    assert.equal(result.plugins[0].releases[0].downloads, 0);
    assert.equal(result.plugins[0].isDesktopOnly, false);
    assert.equal(result.plugins[0].releases[0].notes, '<script>plain text</script>');
});

test('invalid schemas, duplicate identities, traversal IDs and unsafe URLs are rejected', () => {
    for (const value of [null, {}, [], { ...catalog(), schemaVersion: 2 }, catalog('Dup', [plugin(), plugin()]),
        catalog('Traversal', [plugin('../bad')]), catalog('Unsafe', [plugin('id', 'javascript:alert(1)')]),
        catalog('Unsafe file', [{ id: 'id', releases: [{ version: '1', main: 'file:///tmp/main.js' }] }]),
        catalog('Dup release', [{ id: 'id', releases: [{ version: '1' }, { version: '1' }] }])]) {
        assert.throws(() => parseCatalog(value, 'Test'));
    }
    for (const url of ['http://example.org/a', 'file:///tmp/a', 'https://user:pass@example.org/a', 'https://example.org/a?token=secret', 'https://example.org/a#fragment']) assert.throws(() => catalogUrl(url));
    for (const repo of ['a/..', '../repo', 'a/repo/extra', 'https://evil.org/a/repo', 'a/repo?key=value']) assert.throws(() => catalogRepo(repo));
});

test('statistics distinguish missing values from zero and sort version labels numerically', () => {
    const stats = parseStats({ p: { downloads: 0, updated: 'invalid', '1.10.0': 10, '1.2.0': 2, '1.0.0': 0, '1.1.0': -1, '1.3.0': '3', '1.4.0': Infinity } });
    assert.equal(stats.p.downloads, 0);
    assert.equal(stats.p.updated, undefined);
    assert.deepEqual(stats.p.versions, [{ version: '1.0.0', downloads: 0 }, { version: '1.2.0', downloads: 2 }, { version: '1.10.0', downloads: 10 }]);
    assert.equal(parseStats({ p: {} }).p.downloads, undefined);
});

test('release downloads use main.js only and never sum unrelated assets', () => {
    const releases = parseReleases([
        { tag_name: '1.0', assets: [{ name: 'main.js', download_count: 20 }, { name: 'manifest.json', download_count: 30 }, { name: 'styles.css', download_count: 40 }] },
        { tag_name: '1.1', assets: [{ name: 'manifest.json', download_count: 10 }] },
        { tag_name: '1.2', draft: true, assets: [] },
        { tag_name: '1.3', assets: [{ name: 'main.js', download_count: 0 }] },
    ]);
    assert.deepEqual(releases.map(release => release.downloads), [20, undefined, 0]);
});

test('same plugin ID in independent sources never overwrites official metadata or uses official stats', async () => {
    const { service, state } = harness(async url => url === OFFICIAL_CATALOG ? [plugin()] : { 'custom-plugin': { downloads: 999, '1.0': 999 } });
    await service.load();
    await service.refresh('official');
    await service.importSource(catalog('Independent', [plugin('custom-plugin', 'other/repo')]), 'file.json');
    const entries = service.entries();
    assert.equal(entries.length, 2);
    assert.notEqual(entries[0].key, entries[1].key);
    assert.equal(entries[0].stats.downloads, 999);
    assert.equal(entries[1].stats, undefined);
    assert.equal(entries[1].repo, 'other/repo');
    assert.deepEqual(state.calls.map(call => call[0]), [OFFICIAL_CATALOG, OFFICIAL_STATS]);
});

test('custom-source import makes no official or GitHub request and retains its own statistics', async () => {
    const value = { ...catalog('Standalone', [{ id: 'not-official', repositoryUrl: 'https://gitee.com/team/plugin' }]), stats: { 'not-official': { downloads: 33, '1.0': 33 } } };
    const { service, state } = harness();
    await service.load();
    await service.importSource(value, 'source.json');
    assert.equal(state.calls.length, 0);
    assert.equal(service.entries()[0].stats.downloads, 33);
    const restored = harness(undefined, state.persisted);
    await restored.service.load();
    assert.deepEqual(restored.service.entries(), service.entries());
});

test('URL preview validates without persisting and import commits the reviewed snapshot without refetching', async () => {
    const value = catalog('Reviewed', [{ id: 'independent', tags: ['Writing'], features: ['Offline'], releases: [{ version: '1.0', main: './main.js' }] }]);
    const { service, state } = harness(async () => structuredClone(value));
    const preview = await service.previewUrl('https://example.org/catalog.json');
    assert.equal(state.writes.length, 0);
    assert.equal(service.getSources().length, 0);
    assert.equal(preview.catalog.plugins[0].releases[0].main, 'https://example.org/main.js');
    value.name = 'Changed remotely';
    await service.importSource(preview.value, preview.name, preview.url);
    assert.equal(state.calls.length, 1);
    assert.equal(service.getSources()[0].name, 'Reviewed');
    assert.deepEqual(service.entries()[0].features, ['Offline']);
    const restored = harness(undefined, state.persisted);
    await restored.service.load();
    assert.deepEqual(restored.service.entries()[0].features, ['Offline']);
});

test('invalid URL previews reject without modifying the existing source snapshot', async () => {
    const { service, state } = harness(async () => ({ schemaVersion: 2, plugins: [] }));
    await service.importSource(catalog('Existing'), 'existing.json');
    const before = structuredClone(state.persisted);
    await assert.rejects(service.previewUrl('https://example.org/bad.json'), /schemaVersion/);
    assert.deepEqual(state.persisted, before);
    assert.equal(state.writes.length, 1);
    assert.equal(service.getSources()[0].name, 'Existing');
});

test('URL sources resolve files relative to the source and refresh without losing earlier data on error', async () => {
    let fail = false;
    const { service } = harness(async () => { if (fail) throw Error('offline'); return catalog(); });
    await service.importUrl('https://example.org/catalog.json');
    const before = service.entries();
    fail = true;
    await assert.rejects(service.refresh('url:https://example.org/catalog.json'), /offline/);
    assert.deepEqual(service.entries(), before);
    await service.remove('url:https://example.org/catalog.json');
    assert.equal(service.entries().length, 0);
});

test('failed official statistics refresh keeps previous counts and marks them stale', async () => {
    let fail = false;
    const { service } = harness(async url => {
        if (url === OFFICIAL_CATALOG) return [plugin()];
        if (fail) throw Error('statistics unavailable');
        return { 'custom-plugin': { downloads: 123 } };
    });
    await service.refresh('official');
    fail = true;
    await service.refresh('official');
    assert.equal(service.entries()[0].stats.downloads, 123);
    assert.match(service.getSources()[0].warning, /retained earlier data/);
});

test('source mutations are serialized and failed persistence never changes active entries', async () => {
    const { service, state } = harness();
    await Promise.all([service.importSource(catalog('One'), 'one.json'), service.importSource(catalog('Two'), 'two.json')]);
    assert.equal(service.getSources().length, 2);
    assert.equal(state.writes[1].sources.length, 2);
    const failed = new CatalogService({ read: async () => undefined, write: async () => { throw Error('disk full'); }, request: async () => undefined });
    await assert.rejects(failed.importSource(catalog(), 'a.json'), /disk full/);
    assert.equal(failed.entries().length, 0);
});

test('GitHub details reuse in-flight and cached responses and preserve activity semantics', async () => {
    const { service, state } = harness(async url => url.endsWith('/releases?per_page=100&page=1') ? [
        { tag_name: '1.0', published_at: '2026-10-01T00:00:00Z', assets: [] },
    ] : { full_name: 'team/plugin', pushed_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-30T00:00:00Z', stargazers_count: 0, archived: false });
    const [a, b] = await Promise.all([service.repository('team/plugin'), service.repository('TEAM/PLUGIN')]);
    assert.equal(a, b);
    assert.equal(a.pushedAt, '2026-10-20T00:00:00Z');
    assert.equal(a.stars, 0);
    assert.equal(a.archived, false);
    assert.equal(a.latestPublishedAt, '2026-10-01T00:00:00Z');
    await service.repository('team/plugin');
    assert.equal(state.calls.length, 2);
});

test('release history paginates with a visible bounded-history flag', async () => {
    const { service, state } = harness(async url => url.includes('/releases?')
        ? Array.from({ length: 100 }, (_, index) => ({ tag_name: `${url.includes('page=1') ? 1 : url.includes('page=2') ? 2 : 3}.${index}`, assets: [] }))
        : { full_name: 'team/plugin' });
    const details = await service.repository('team/plugin');
    assert.equal(details.releases.length, 300);
    assert.equal(details.releasesTruncated, true);
    assert.equal(state.calls.length, 4);
});

test('partial release failures remain visible without hiding available repository metadata', async () => {
    const { service } = harness(async url => { if (url.includes('/releases?')) throw Error('HTTP 403'); return { full_name: 'team/plugin', forks_count: 12 }; });
    const details = await service.repository('team/plugin');
    assert.equal(details.forks, 12);
    assert.match(details.warnings[0], /HTTP 403/);
});

test('discover gives small independent sources equal turns without using download counts', async () => {
    const { service } = harness();
    await service.importSource(catalog('Large', Array.from({ length: 100 }, (_, i) => plugin(`large-${i}`))), 'large.json');
    await service.importSource(catalog('Small', [plugin('small-only')]), 'small.json');
    await service.importSource(catalog('Another', [plugin('another-only')]), 'another.json');
    const entries = service.entries();
    const first = discoveryOrder(entries, 'stable-seed');
    assert.equal(new Set(first.slice(0, 3).map(item => item.source.id)).size, 3);
    assert.equal(new Set(first.map(item => item.key)).size, 102);
    assert.deepEqual(discoveryOrder(entries.map(item => ({ ...item, stats: { downloads: 99999999, versions: [] } })), 'stable-seed').map(item => item.key), first.map(item => item.key));
    assert.notDeepEqual(discoveryOrder(entries, 'another-seed').map(item => item.key), first.map(item => item.key));
});

test('search ranks use-case relevance and requires all search terms', async () => {
    const { service } = harness();
    await service.importSource(catalog('Cases', [
        { ...plugin('writing'), name: 'Writing toolkit', useCases: ['Write daily notes'], quickStart: ['Open a sample note'], tags: ['Editor'] },
        { ...plugin('popular'), description: 'Includes writing features', name: 'Popular toolkit' },
    ]), 'cases.json');
    const [writing, popular] = service.entries();
    assert.ok(relevance(writing, 'writing') > relevance(popular, 'writing'));
    assert.ok(relevance(writing, 'daily notes') > 0);
    assert.equal(relevance(writing, 'daily nonexistent'), -1);
    assert.equal(matchesScenario(writing, 'writing'), true);
    assert.equal(matchesScenario(writing, 'planning'), false);
});

test('low-exposure lane includes unknown counts without treating them as zero', async () => {
    const { service } = harness();
    await service.importSource({ ...catalog('Exposure', [plugin('a'), plugin('b'), plugin('c'), plugin('d'), plugin('unknown')]),
        stats: { a: { downloads: 0 }, b: { downloads: 10 }, c: { downloads: 100 }, d: { downloads: 1000 } } }, 'source.json');
    const chosen = lowExposure(service.entries());
    assert.deepEqual(chosen.map(item => item.id), ['a', 'b', 'unknown']);
    assert.equal(chosen[2].stats, undefined);
});

const libraryHarness = (persisted, failWrite = false) => {
    const state = { persisted, writes: 0 };
    const library = new CatalogTryList({ read: async () => state.persisted, write: async value => {
        if (failWrite) throw Error('disk full');
        state.persisted = structuredClone(value);
        state.writes++;
    } });
    return { library, state };
};

test('try-list persists notes and decisions without changing catalog or installed state', async () => {
    const { service } = harness();
    await service.importSource(catalog(), 'source.json');
    const entry = service.entries()[0];
    const { library, state } = libraryHarness();
    await library.load();
    await Promise.all([library.add(entry), library.add(entry)]);
    assert.equal(library.all().length, 1);
    await Promise.all([library.update(entry.key, { note: 'Useful for a weekly review' }), library.update(entry.key, { decision: 'keep' })]);
    assert.equal(library.all()[0].note, 'Useful for a weekly review');
    assert.equal(library.all()[0].decision, 'keep');
    await service.remove(entry.source.id);
    assert.equal(library.all()[0].sourceName, 'Custom');
    const restored = libraryHarness(state.persisted);
    await restored.library.load();
    assert.deepEqual(restored.library.all(), library.all());
    assert.equal('backup' in library.all()[0], false);
    assert.equal('installed' in library.all()[0], false);
});

test('same-ID entries from different sources have independent try-list notes', async () => {
    const { service } = harness();
    await service.importSource(catalog('One'), 'one.json');
    await service.importSource(catalog('Two'), 'two.json');
    const [one, two] = service.entries();
    const { library } = libraryHarness();
    await library.add(one);
    await library.add(two);
    await library.update(one.key, { note: 'First source' });
    assert.equal(library.all()[1].note, '');
    await library.remove(one.key);
    assert.equal(library.has(two.key), true);
});

test('try-list rejects forged source binding and unsafe repository links; failed writes keep prior state', async () => {
    const { service } = harness();
    await service.importSource(catalog(), 'source.json');
    const { library, state } = libraryHarness();
    await library.add(service.entries()[0]);
    for (const patch of [{ key: 'forged' }, { repositoryUrl: 'javascript:alert(1)' }, { decision: 'installed' }]) {
        const forged = structuredClone(state.persisted);
        Object.assign(forged.items[0], patch);
        await assert.rejects(libraryHarness(forged).library.load());
    }
    const failed = libraryHarness(undefined, true);
    await assert.rejects(failed.library.add(service.entries()[0]), /disk full/);
    assert.equal(failed.library.all().length, 0);
});

test('starter materials survive source reload and reject unsafe image/demo URLs', async () => {
    const { service, state } = harness();
    const entry = { ...plugin(), useCases: ['Write a review'], quickStart: ['Open an example'],
        screenshots: [{ url: './preview.png', caption: 'Example screenshot' }], demoUrl: 'https://example.org/demo' };
    await service.importSource(catalog('Materials', [entry]), 'source.json', 'https://example.org/catalog.json');
    const restored = harness(undefined, state.persisted);
    await restored.service.load();
    assert.equal(restored.service.entries()[0].screenshots[0].url, 'https://example.org/preview.png');
    assert.deepEqual(restored.service.entries()[0].quickStart, ['Open an example']);
    assert.throws(() => parseCatalog(catalog('Unsafe', [{ ...entry, screenshots: [{ url: 'data:image/svg+xml,bad' }] }]), 'Test'));
    assert.throws(() => parseCatalog(catalog('Unsafe', [{ ...entry, screenshots: [], demoUrl: 'javascript:alert(1)' }]), 'Test'));
});
