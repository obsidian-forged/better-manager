import type { CatalogEntry } from './catalog';

/** 仅使用插件源声明的维护/发布日期，统计更新时间不代表版本更新 / Statistics refresh dates are not release dates. */
export function catalogActivity(entry: CatalogEntry): number | undefined {
    const dates = [entry.lastMaintainedAt, ...entry.releases.map(release => release.publishedAt)]
        .flatMap(value => value && Number.isFinite(Date.parse(value)) ? [Date.parse(value)] : []);
    return dates.length ? Math.max(...dates) : undefined;
}

export function matchesStoreFilters(entry: CatalogEntry, minimumDownloads: number, recentDays: number, now = Date.now()): boolean {
    if (minimumDownloads > 0 && (entry.stats?.downloads === undefined || entry.stats.downloads < minimumDownloads)) return false;
    if (recentDays > 0) {
        const activity = catalogActivity(entry);
        if (activity === undefined || activity > now || now - activity > recentDays * 86400000) return false;
    }
    return true;
}
