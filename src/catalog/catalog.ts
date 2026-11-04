/** 插件目录与统计数据契约 / Plugin catalog and statistics contracts. */
export const OFFICIAL_CATALOG = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";
export const OFFICIAL_STATS = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json";
export const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

export interface VersionDownloads { version: string; downloads: number }
export interface CatalogStats {
    downloads?: number;
    updated?: number;
    versions: VersionDownloads[];
}
export interface CatalogPlugin {
    id: string;
    name: string;
    author: string;
    description: string;
    repo: string;
    repositoryUrl?: string;
    openness: "open-source" | "closed-source" | "unknown";
    publisher?: string;
    originUrl?: string;
    homepage?: string;
    version?: string;
    minAppVersion?: string;
    isDesktopOnly?: boolean;
    license?: string;
    lastMaintainedAt?: string;
    tags: string[];
    features: string[];
    useCases: string[];
    quickStart: string[];
    screenshots: { url: string; caption: string }[];
    demoUrl?: string;
    releases: CatalogRelease[];
}
export interface CatalogRelease {
    version: string;
    publishedAt?: string;
    downloads?: number;
    prerelease: boolean;
    notes: string;
    manifest?: string;
    main?: string;
    styles?: string;
}
export interface CatalogSource {
    id: string;
    name: string;
    url?: string;
    official: boolean;
    fetchedAt: number;
    plugins: CatalogPlugin[];
    stats: Record<string, CatalogStats>;
    warning?: string;
}
export interface CatalogEntry extends CatalogPlugin {
    key: string;
    source: CatalogSource;
    stats?: CatalogStats;
}
export interface RepositoryDetails {
    stars?: number;
    forks?: number;
    openIssuesAndPullRequests?: number;
    archived?: boolean;
    pushedAt?: string;
    createdAt?: string;
    license?: string;
    topics: string[];
    latestPublishedAt?: string;
    releases: { tag: string; publishedAt?: string; prerelease: boolean; downloads?: number; notes?: string }[];
    releasesTruncated: boolean;
    fetchedAt: number;
    warnings: string[];
}
export interface CatalogIO {
    request(url: string, githubApi: boolean): Promise<unknown>;
    read(): Promise<unknown>;
    write(value: unknown): Promise<void>;
}

export const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
export const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const count = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const date = (value: unknown): string | undefined => {
    const result = text(value);
    return result && Number.isFinite(Date.parse(result)) ? result : undefined;
};

export function catalogRepo(value: unknown): string {
    const repo = text(value).replace(/^https:\/\/github\.com\//i, "").replace(/\.git\/?$/, "").replace(/\/$/, "");
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo) || [".", ".."].includes(repo.split("/")[1])) {
        throw new Error("Invalid GitHub repository: expected owner/repo");
    }
    return repo;
}

export function catalogUrl(value: string): string {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Catalog URLs must use HTTPS without credentials or fragments");
    url.searchParams.forEach((_value, key) => {
        if (/token|secret|password|auth|api.?key/i.test(key)) throw new Error("Do not put credentials in catalog URLs");
    });
    return url.href;
}

function optionalUrl(value: unknown, base?: string): string | undefined {
    const candidate = text(value);
    return candidate ? catalogUrl(base ? new URL(candidate, base).href : candidate) : undefined;
}

/** 版本号轴使用数值排序，保留特殊 tag / Numeric version ordering preserves unusual tags. */
export function compareCatalogVersions(a: string, b: string): number {
    const pattern = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/i;
    const left = pattern.exec(a);
    const right = pattern.exec(b);
    if (left && right) {
        for (let i = 1; i <= 3; i++) {
            const order = Number(left[i]) - Number(right[i]);
            if (order) return order;
        }
        if (Boolean(left[4]) !== Boolean(right[4])) return left[4] ? -1 : 1;
        const lhs = left[4]?.split(".") || [];
        const rhs = right[4]?.split(".") || [];
        for (let i = 0; i < Math.max(lhs.length, rhs.length); i++) {
            if (lhs[i] === undefined) return -1;
            if (rhs[i] === undefined) return 1;
            const numericLeft = /^\d+$/.test(lhs[i]);
            const numericRight = /^\d+$/.test(rhs[i]);
            if (numericLeft !== numericRight) return numericLeft ? -1 : 1;
            const order = numericLeft ? Number(lhs[i]) - Number(rhs[i]) : lhs[i] < rhs[i] ? -1 : lhs[i] > rhs[i] ? 1 : 0;
            if (order) return order;
        }
        return 0;
    }
    return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

export function parseStats(value: unknown): Record<string, CatalogStats> {
    const result = Object.create(null) as Record<string, CatalogStats>;
    if (!record(value)) return result;
    for (const [id, raw] of Object.entries(value)) {
        if (!record(raw)) continue;
        const versions = Object.entries(raw)
            .filter(([key]) => !["downloads", "updated"].includes(key))
            .flatMap(([version, downloads]) => {
                const valid = count(downloads);
                return valid === undefined ? [] : [{ version, downloads: valid }];
            })
            .sort((a, b) => compareCatalogVersions(a.version, b.version));
        const updated = count(raw.updated);
        result[id] = { downloads: count(raw.downloads), updated: updated && updated <= 8640000000000000 ? updated : undefined, versions };
    }
    return result;
}

export function parseCatalog(value: unknown, fallbackName: string, base?: string): Pick<CatalogSource, "name" | "plugins" | "stats"> {
    if (record(value) && value.schemaVersion !== 1) throw new Error("Unsupported catalog schemaVersion; expected 1");
    const entries: unknown = Array.isArray(value) ? value : record(value) ? value.plugins : undefined;
    if (!Array.isArray(entries) || !entries.length || entries.length > 20000) throw new Error("Catalog must contain 1–20000 plugins");
    const seen = new Set<string>();
    const plugins = entries.map((item: unknown, index: number): CatalogPlugin => {
        if (!record(item)) throw new Error(`Invalid plugin at entry ${index + 1}`);
        const id = text(item.id);
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id) || id.includes("..")) throw new Error(`Invalid plugin ID at entry ${index + 1}`);
        if (seen.has(id)) throw new Error(`Duplicate plugin ID: ${id}`);
        seen.add(id);
        const repository = text(item.repositoryUrl) || text(item.repo);
        const repositoryUrl = repository ? /^https:\/\//i.test(repository) ? catalogUrl(repository) : `https://github.com/${catalogRepo(repository)}` : undefined;
        const repo = repositoryUrl && new URL(repositoryUrl).hostname === "github.com" ? catalogRepo(repositoryUrl) : "";
        if (item.openness !== undefined && !["open-source", "closed-source", "unknown"].includes(text(item.openness))) throw new Error(`Invalid openness for ${id}`);
        const openness = item.openness === "open-source" ? "open-source" : item.openness === "closed-source" ? "closed-source" : "unknown";
        if (openness === "open-source" && !repositoryUrl) throw new Error(`Open-source plugin ${id} must provide its source repository URL`);
        const releases: CatalogRelease[] = [];
        if (item.releases !== undefined && !Array.isArray(item.releases)) throw new Error(`Invalid releases for ${id}`);
        const releaseVersions = new Set<string>();
        if (Array.isArray(item.releases)) for (const raw of item.releases) {
            if (!record(raw) || !text(raw.version) || releaseVersions.has(text(raw.version))) throw new Error(`Invalid or duplicate release for ${id}`);
            releaseVersions.add(text(raw.version));
            releases.push({ version: text(raw.version), publishedAt: date(raw.publishedAt), downloads: count(raw.downloads),
                prerelease: raw.prerelease === true, notes: text(raw.notes), manifest: optionalUrl(raw.manifest, base),
                main: optionalUrl(raw.main, base), styles: optionalUrl(raw.styles, base) });
        }
        return { id, repo, repositoryUrl, openness, publisher: text(item.publisher) || undefined, originUrl: optionalUrl(item.originUrl, base),
            name: text(item.name) || id, author: text(item.author), description: text(item.description),
            homepage: optionalUrl(item.homepage, base), version: text(item.version) || undefined, minAppVersion: text(item.minAppVersion) || undefined,
            isDesktopOnly: typeof item.isDesktopOnly === "boolean" ? item.isDesktopOnly : undefined,
            license: text(item.license) || undefined, lastMaintainedAt: date(item.lastMaintainedAt),
            tags: Array.isArray(item.tags) ? item.tags.flatMap((tag: unknown) => text(tag) ? [text(tag)] : []) : [],
            features: Array.isArray(item.features) ? item.features.flatMap((feature: unknown) => text(feature) ? [text(feature)] : []) : [],
            useCases: Array.isArray(item.useCases) ? item.useCases.flatMap((item: unknown) => text(item) ? [text(item)] : []) : [],
            quickStart: Array.isArray(item.quickStart) ? item.quickStart.flatMap((step: unknown) => text(step) ? [text(step)] : []) : [],
            screenshots: Array.isArray(item.screenshots) ? item.screenshots.map((shot: unknown) => {
                if (!record(shot) || !text(shot.url)) throw new Error(`Invalid screenshot for ${id}`);
                return { url: catalogUrl(base ? new URL(text(shot.url), base).href : text(shot.url)), caption: text(shot.caption) };
            }) : [], demoUrl: optionalUrl(item.demoUrl, base), releases };
    });
    return { name: record(value) ? text(value.name) || fallbackName : fallbackName, plugins,
        stats: parseStats(record(value) ? value.stats : undefined) };
}

export function parseReleases(value: unknown): RepositoryDetails["releases"] {
    if (!Array.isArray(value)) throw new Error("Invalid GitHub release response");
    return value.flatMap((item: unknown) => {
        if (!record(item) || item.draft === true || !text(item.tag_name)) return [];
        const asset: unknown = Array.isArray(item.assets) ? item.assets.find((asset: unknown) => record(asset) && asset.name === "main.js") : undefined;
        return [{ tag: text(item.tag_name), publishedAt: date(item.published_at), prerelease: item.prerelease === true,
            downloads: record(asset) ? count(asset.download_count) : undefined, notes: text(item.body) || undefined }];
    });
}

/** 服务不依赖 DOM，通过适配器隔离 IO / DOM-independent service with injected IO. */
export class CatalogService {
    private sources: CatalogSource[] = [];
    private loaded?: Promise<void>;
    private mutation: Promise<unknown> = Promise.resolve();
    private details = new Map<string, RepositoryDetails>();
    private pending = new Map<string, Promise<RepositoryDetails>>();

    constructor(private io: CatalogIO) {}

    public async load(): Promise<void> {
        if (!this.loaded) this.loaded = this.loadFile().catch(error => { this.loaded = undefined; throw error; });
        await this.loaded;
    }

    private async loadFile(): Promise<void> {
        const value = await this.io.read();
        if (value === undefined || value === null) return;
        if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.sources)) throw new Error("Invalid catalog cache; import or refresh a source to recover");
        const seen = new Set<string>();
        const sources = value.sources.map((raw: unknown): CatalogSource => {
            if (!record(raw) || !text(raw.id) || seen.has(text(raw.id))) throw new Error("Invalid catalog source identity");
            seen.add(text(raw.id));
            const official = raw.id === "official";
            const parsed = parseCatalog({ schemaVersion: 1, name: raw.name, plugins: raw.plugins }, "Catalog");
            // 缓存仍作为不可信输入校验 / Validate persisted snapshots as untrusted input.
            const stats = Object.create(null) as Record<string, CatalogStats>;
            if (record(raw.stats)) for (const [id, stat] of Object.entries(raw.stats)) {
                if (!record(stat)) continue;
                const flat: Record<string, unknown> = { downloads: stat.downloads, updated: stat.updated };
                if (Array.isArray(stat.versions)) for (const point of stat.versions) {
                    if (record(point) && text(point.version) && !["downloads", "updated", "__proto__"].includes(text(point.version))) flat[text(point.version)] = point.downloads;
                }
                Object.assign(stats, parseStats({ [id]: flat }));
            }
            return { ...parsed, id: text(raw.id), official, stats, fetchedAt: count(raw.fetchedAt) ?? 0,
                url: official ? OFFICIAL_CATALOG : text(raw.url) ? catalogUrl(text(raw.url)) : undefined, warning: text(raw.warning) || undefined };
        });
        this.sources = sources;
    }

    public getSources(): readonly CatalogSource[] { return this.sources; }

    public entries(): CatalogEntry[] {
        return this.sources.flatMap(source => source.plugins.map(plugin => ({ ...plugin, key: `${source.id}:${plugin.id}`, source, stats: source.stats[plugin.id] })));
    }

    private commit(action: () => Promise<CatalogSource[]>): Promise<void> {
        const next = this.mutation.then(async () => {
            const sources = await action();
            await this.io.write({ schemaVersion: 1, sources });
            this.sources = sources;
        });
        this.mutation = next.catch(() => undefined); // 调用方接收原始异常；队列可继续 / Caller receives the error; keep the queue usable.
        return next;
    }

    public async importSource(value: unknown, name: string, url?: string): Promise<void> {
        const normalizedUrl = url ? catalogUrl(url) : undefined;
        const parsed = parseCatalog(value, name, normalizedUrl);
        const id = normalizedUrl ? `url:${normalizedUrl}` : `file:${parsed.name}`;
        await this.commit(async () => [...this.sources.filter(source => source.id !== id),
            { ...parsed, id, url: normalizedUrl, official: false, fetchedAt: Date.now(), warning: undefined }]);
    }

    public async importUrl(url: string): Promise<void> {
        const preview = await this.previewUrl(url);
        await this.importSource(preview.value, preview.name, preview.url);
    }

    /** 校验预览不写入；确认后导入同一快照 / Preview never persists; import commits the reviewed snapshot. */
    public async previewUrl(url: string): Promise<{ value: unknown; name: string; url: string; catalog: ReturnType<typeof parseCatalog> }> {
        const normalized = catalogUrl(url);
        const value = await this.io.request(normalized, false);
        const name = new URL(normalized).hostname;
        return { value, name, url: normalized, catalog: parseCatalog(value, name, normalized) };
    }

    public async refresh(id: string, onProgress?: (progress: number) => void): Promise<void> {
        await this.commit(async () => {
            const old = this.sources.find(source => source.id === id);
            const official = id === "official";
            const url = official ? OFFICIAL_CATALOG : old?.url;
            if (!url) throw new Error("Local JSON sources must be reimported from a file");
            onProgress?.(0.15);
            const parsed = parseCatalog(await this.io.request(url, false), old?.name || "Obsidian community", url);
            onProgress?.(0.6);
            let warning: string | undefined;
            if (official) {
                try {
                    const stats = await this.io.request(OFFICIAL_STATS, false);
                    if (!record(stats) || !Object.keys(stats).length) throw new Error("Invalid official statistics response");
                    parsed.stats = parseStats(stats);
                } catch (error) {
                    // 不把旧统计伪装成刚刚刷新 / Retained statistics are explicitly marked stale.
                    parsed.stats = old?.stats || {};
                    warning = `Statistics refresh failed; retained earlier data: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            }
            onProgress?.(0.88);
            const source: CatalogSource = { ...parsed, id, url, official, fetchedAt: Date.now(), warning };
            return [...this.sources.filter(source => source.id !== id), source];
        });
        onProgress?.(1);
    }

    public remove(id: string): Promise<void> {
        return this.commit(async () => this.sources.filter(source => source.id !== id));
    }

    public async repository(repoInput: string, force = false): Promise<RepositoryDetails> {
        const repo = catalogRepo(repoInput);
        const key = repo.toLowerCase();
        const cached = this.details.get(key);
        if (!force && cached && Date.now() - cached.fetchedAt < 3600000) return cached;
        const pending = this.pending.get(key);
        if (pending) return pending;
        const work = this.fetchRepository(repo).then(value => {
            this.details.set(key, value);
            // 防止长会话无限增长 / Bound memory use in long browsing sessions.
            const oldest = this.details.keys().next().value;
            if (this.details.size > 100 && oldest !== undefined) this.details.delete(oldest);
            return value;
        }).finally(() => this.pending.delete(key));
        this.pending.set(key, work);
        return work;
    }

    private async fetchRepository(repo: string): Promise<RepositoryDetails> {
        const base = `https://api.github.com/repos/${repo}`;
        const raw = await this.io.request(base, true);
        if (!record(raw) || !text(raw.full_name)) throw new Error("Invalid GitHub repository response");
        const details: RepositoryDetails = {
            stars: count(raw.stargazers_count), forks: count(raw.forks_count), openIssuesAndPullRequests: count(raw.open_issues_count),
            archived: typeof raw.archived === "boolean" ? raw.archived : undefined,
            pushedAt: date(raw.pushed_at), createdAt: date(raw.created_at),
            license: record(raw.license) ? text(raw.license.spdx_id) || text(raw.license.name) : undefined,
            topics: Array.isArray(raw.topics) ? raw.topics.flatMap((topic: unknown) => text(topic) ? [text(topic)] : []) : [],
            releases: [], releasesTruncated: false, fetchedAt: Date.now(), warnings: [],
        };
        try {
            for (let page = 1; page <= 3; page++) {
                const response = await this.io.request(`${base}/releases?per_page=100&page=${page}`, true);
                details.releases.push(...parseReleases(response));
                if (Array.isArray(response) && response.length < 100) break;
                if (page === 3) details.releasesTruncated = true;
            }
        } catch (error) {
            details.warnings.push(`Release history unavailable or incomplete: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
        const dates = details.releases.flatMap(release => release.publishedAt ? [release.publishedAt] : []).sort();
        details.latestPublishedAt = dates[dates.length - 1];
        return details;
    }
}
