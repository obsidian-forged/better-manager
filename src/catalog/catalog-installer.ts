import { Notice, requestUrl } from 'obsidian';
import type Manager from '../main';
import { catalogUrl, CatalogEntry, CatalogRelease } from './catalog';
import { parseInstallManifest } from './install-manifest';
import { installPluginFiles, PluginInstallOptions } from '../install/plugin-installer';
import type { ReleaseVersion } from '../github-install';
import { assertHttpSuccess } from '../network/http-error';

const pending = new WeakMap<Manager, Map<string, Promise<string>>>();

/** 独立源始终无认证请求，不转发 GitHub 密钥 / Independent sources never receive GitHub credentials. */
async function download(url: string): Promise<string> {
    const response = await requestUrl({ url: catalogUrl(url), throw: false });
    assertHttpSuccess(response);
    if (response.arrayBuffer.byteLength > 64 * 1024 * 1024) throw new Error('Plugin file exceeds 64 MiB');
    return response.text;
}

export function catalogManifest(manager: Manager, entry: CatalogEntry, release: CatalogRelease, force = false): Promise<string> {
    if (!release.manifest || !release.main) return Promise.reject(new Error('Release must provide manifest.json and main.js URLs'));
    let cache = pending.get(manager);
    if (!cache) { cache = new Map(); pending.set(manager, cache); }
    const key = `${entry.key}\n${release.manifest}`;
    if (!force) { const work = cache.get(key); if (work) return work; }
    const work = download(release.manifest).then(text => { parseInstallManifest(JSON.parse(text) as unknown, entry.id); return text; });
    cache.set(key, work);
    const active = cache;
    void work.finally(() => { if (active.get(key) === work) active.delete(key); }).catch(error => { if (manager.settings.DEBUG) console.error('[BPM] Catalog manifest failed', error); });
    return work;
}

export async function catalogVersions(manager: Manager, entry: CatalogEntry, force = false): Promise<ReleaseVersion[]> {
    const versions: ReleaseVersion[] = [];
    // 限制并发、保留源内发布顺序；Keep source order and bound concurrent requests.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, entry.releases.length) }, async () => {
        while (next < entry.releases.length) {
            const index = next++, release = entry.releases[index];
            const version: ReleaseVersion = { version: release.version, publishedAt: release.publishedAt, prerelease: release.prerelease, body: release.notes, compatibilityChecked: false,
                manifestUrl: release.manifest, mainUrl: release.main, stylesUrl: release.styles };
            try {
                const manifest = parseInstallManifest(JSON.parse(await catalogManifest(manager, entry, release, force)) as unknown, entry.id);
                Object.assign(version, { minAppVersion: manifest.minAppVersion, manifestVersion: manifest.version, isDesktopOnly: manifest.isDesktopOnly, compatibilityChecked: true });
            } catch (error) { version.metadataError = error instanceof Error ? error.message : 'Manifest unavailable'; }
            versions[index] = version;
        }
    }));
    return versions.sort((a, b) => (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0));
}

export async function installCatalogRelease(manager: Manager, entry: CatalogEntry, release: CatalogRelease,
    options: Pick<PluginInstallOptions, 'quiet' | 'guard' | 'expectedManifestVersion' | 'onError'> = {}): Promise<boolean> {
    const task = manager.tasks.start({ title: manager.translator.t('任务_获取发布', { name: entry.name }), progress: 0.04 });
    try {
        if (entry.id === manager.manifest.id) throw new Error(manager.translator.t('更新规则_原因_self'));
        await options.guard?.();
        if (!release.manifest || !release.main) throw new Error('Release must provide manifest.json and main.js URLs');
        // 点击安装后重新读取清单，避免使用过期的缓存作为写盘依据 / Re-read the manifest at installation time.
        const [manifestText, mainJs, styles] = await Promise.all([
            catalogManifest(manager, entry, release, true), download(release.main), release.styles ? download(release.styles) : Promise.resolve(null),
        ]);
        await installPluginFiles(manager, { manifestText, mainJs, styles }, { ...options, source: { kind: 'catalog', key: entry.key, sourceId: entry.source.id, pluginId: entry.id, url: entry.source.url },
            tag: release.version, label: entry.name, publishedAt: release.publishedAt, expectedId: entry.id }, task);
        task.done();
        return true;
    } catch (error) {
        task.fail();
        options.onError?.(error);
        if (manager.settings.DEBUG) console.error('[BPM] Catalog installation failed', error);
        if (!options.quiet) new Notice(`${manager.translator.t('安装_错误_通用')} ${error instanceof Error ? error.message : ''}`);
        return false;
    }
}
