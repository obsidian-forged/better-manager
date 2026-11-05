import type Manager from '../main';
import { captureSourceBinding } from '../updates/source-binding';
import { UpdateGuardError } from '../updates/update-policy';
import type { CatalogEntry, CatalogRelease, CatalogService } from './catalog';

const origin = (entry: CatalogEntry): string => JSON.stringify({ key: entry.key, id: entry.id, repo: entry.repo,
    sourceId: entry.source.id, url: entry.source.url, official: entry.source.official });
const releaseFiles = (release: CatalogRelease): string => JSON.stringify({ version: release.version, manifest: release.manifest,
    main: release.main, styles: release.styles, publishedAt: release.publishedAt, prerelease: release.prerelease });

/** 版本选择绑定已审阅的来源与资源；Keep a version choice bound to its reviewed origin and download URLs. */
export function createCatalogInstallGuard(manager: Manager, service: CatalogService, entry: CatalogEntry): (version: string) => void {
    const binding = JSON.stringify(captureSourceBinding(manager, entry.id));
    const selectedOrigin = origin(entry);
    const independent = entry.releases.some(release => release.manifest && release.main);
    const releases = new Map(entry.releases.map(release => [release.version, releaseFiles(release)]));
    return version => {
        if (JSON.stringify(captureSourceBinding(manager, entry.id)) !== binding) {
            throw new UpdateGuardError('changed', manager.translator.t('批量更新_清单变化'));
        }
        const current = service.entries().find(item => item.key === entry.key);
        if (!current || origin(current) !== selectedOrigin) throw new UpdateGuardError('changed', manager.translator.t('目录_来源冲突'));
        if (independent) {
            const release = current.releases.find(release => release.version === version);
            if (!release || releaseFiles(release) !== releases.get(version)) {
                throw new UpdateGuardError('changed', manager.translator.t('批量更新_清单变化'));
            }
        }
    };
}
