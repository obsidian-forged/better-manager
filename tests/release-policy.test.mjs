import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const nativeRequire = createRequire(import.meta.url);
async function load(entry, obsidian = {}) {
    const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false,
        external: ['obsidian', 'electron'], logLevel: 'silent' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(name =>
        name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), module, module.exports);
    return module.exports;
}
const policy = await load('src/release-policy.ts');
const source = await load('src/source-release.ts', { requireApiVersion: () => true });
const now = Date.parse('2026-10-28T12:00:00Z');
const release = (version, publishedAt, extra = {}) => ({ version, publishedAt, prerelease: false, ...extra });
const settings = (overrides = {}) => ({ id: 'a', repo: 'owner/repo', type: 'plugin', mode: 'latest',
    includePrerelease: false, autoUpdate: false, enabled: true, updateDelayDays: 2,
    localVersion: '1.0.0', ...overrides });

test('GitHub Latest wins over a newer compatibility release only on supported Obsidian versions', async () => {
    const versions = [release('4.14.3', '2026-10-28T00:00:00Z', { minAppVersion: '1.8.0' }),
        release('4.21.1', '2026-10-20T00:00:00Z', { isGithubLatest: true, minAppVersion: '1.13.0' })];
    const olderHost = await load('src/source-release.ts', { requireApiVersion: minimum => minimum !== '1.13.0' });
    assert.equal(olderHost.pickSourceTargetRelease(settings({ updateDelayDays: 0 }), versions)?.tag, '4.14.3');
    assert.equal(source.pickSourceTargetRelease(settings({ updateDelayDays: 0 }), versions)?.tag, '4.21.1');
});

test('failed manifest lookups cannot be recommended as compatible releases', () => {
    const versions = [release('2.0.0', '2026-10-20T00:00:00Z', { isGithubLatest: true, compatibilityChecked: false }),
        release('1.0.0', '2026-10-19T00:00:00Z', { minAppVersion: '1.8.0', compatibilityChecked: true })];
    assert.equal(source.pickSourceTargetRelease(settings({ updateDelayDays: 0 }), versions)?.tag, '1.0.0');
});

test('GitHub stable metadata cannot promote SemVer prereleases', () => {
    for (const tag of ['1.33.0-rc-1', 'v1.33.0-rc.1', '1.33.0-beta.1', '2.0.0-1+build.2']) {
        assert.equal(policy.isPrereleaseRelease(tag, false), true, tag);
    }
    for (const tag of ['1.33.0', 'v1.33.0+build.1', 'release-2026-10', '1.0.0-preview/other']) {
        assert.equal(policy.isPrereleaseRelease(tag, false), false, tag);
    }
    assert.equal(policy.isPrereleaseRelease('1.33.0', true), true);
});

test('undated releases are deferred only when a minimum age is configured', () => {
    assert.equal(policy.isReleaseOldEnough(undefined, 2, now), false);
    assert.equal(policy.isReleaseOldEnough('invalid', 2, now), false);
    assert.equal(policy.isReleaseOldEnough(undefined, 0, now), true);
    assert.equal(policy.isReleaseOldEnough('invalid', 0, now), true);
    assert.equal(policy.isReleaseOldEnough('2026-10-26T11:59:59Z', 2, now), true);
    assert.equal(policy.isReleaseOldEnough('2026-10-26T12:00:01Z', 2, now), false);
});

test('eligible selection excludes undated GitHub Latest and marks the source deferred', () => {
    const config = settings();
    const versions = [release('1.3.0', undefined, { isGithubLatest: true }),
        release('1.2.0', '2026-10-25T00:00:00Z')];
    const picked = source.pickSourceTargetRelease(config, versions);
    assert.equal(picked?.tag, '1.2.0');
    const onlyUnknown = settings();
    source.syncSourceReleaseCheck(onlyUnknown, versions.slice(0, 1), '1.0.0');
    assert.equal(onlyUnknown.deferredPublicationDate, true);
    assert.equal(onlyUnknown.latestReleaseTag, '');
    assert.equal(source.sourceHasUpdate(onlyUnknown), false);
});

test('a pinned source with an unknown date cannot bypass its age policy', () => {
    const pinned = settings({ mode: 'frozen', frozenVersion: '1.2.0' });
    assert.equal(source.pickSourceTargetRelease(pinned, []), null);
    assert.equal(source.sourceHasUpdate(pinned), false);
    const zero = settings({ mode: 'frozen', frozenVersion: '1.2.0', updateDelayDays: 0 });
    assert.equal(source.pickSourceTargetRelease(zero, [])?.tag, '1.2.0');
});

test('version mode also defers missing dates and honors valid age boundaries', () => {
    const config = settings({ updateCheckMode: 'version', latestVersion: '1.2.0' });
    assert.equal(source.sourceHasVersionUpdate(config), false);
    config.latestPublishedAt = '2026-10-25T00:00:00Z';
    assert.equal(source.sourceHasVersionUpdate(config), true);
});

test('empty release lists with a known remote version are deferred, not updated', () => {
    const config = settings({ latestVersion: '1.1.0', latestReleaseTag: '1.1.0' });
    source.syncSourceReleaseCheck(config, [], '1.0.0');
    assert.equal(config.deferredPublicationDate, true);
    assert.equal(source.sourceHasReleaseUpdate(config), false);
    assert.equal(source.sourceHasVersionUpdate(config), false);
});
