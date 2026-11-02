import { Notice, normalizePath, requestUrl } from "obsidian";
import type { PluginManifest, RequestUrlResponse } from "obsidian";
import Manager from "main";
import type { ManagerPlugin } from "./data/types";
import { BPM_TAG_ID } from "./repo-resolver";
import { resolveGithubUrl } from "./github-url";
import { isPrereleaseRelease } from "./release-policy";
import type { BackgroundTaskHandle } from "./tasks/task-center";

/**
 * GitHub release 资源描述。
 *
 * BPM 安装插件时只关心 release asset 的文件名和下载地址：
 * - manifest.json 是 Obsidian 插件元信息。
 * - main.js 是编译后的插件入口。
 * - styles.css 是可选样式文件。
 */
interface ReleaseAsset {
	name: string;
	browser_download_url: string;
}

/**
 * GitHub releases API 的最小响应结构。
 *
 * 这里没有完整建模 GitHub API，只保留安装和版本选择需要的字段。
 */
interface ReleaseResponse {
	tag_name?: string;
	name?: string;
	body?: string;
	draft?: boolean;
	prerelease?: boolean;
	published_at?: string;
	html_url?: string;
	assets?: ReleaseAsset[];
}

/** manifest.json 中 BPM 安装流程需要读取的字段。 */
interface PluginManifestJson {
	id: string;
	name?: string;
	description?: string;
	version?: string;
}

/** 带 GitHub 状态信息的错误，方便 catch 阶段给出更准确提示。 */
interface GithubRequestError extends Error {
	status?: number;
	rateRemaining?: string;
	rateReset?: string;
}

interface PluginFiles {
	manifestText: string | null;
	mainJs: string | null;
	styles: string | null;
}

export interface ReleaseVersion {
	version: string;
	prerelease: boolean;
	name?: string;
	body?: string;
	publishedAt?: string;
	url?: string;
	minAppVersion?: string;
	manifestVersion?: string;
	isGithubLatest?: boolean;
	compatibilityChecked?: boolean;
}

export interface FetchReleaseVersionOptions {
	includeManifest?: boolean;
	/** 先用 Atom/raw 兜底源，避免在 GitHub API 限额耗尽时才失败。 */
	preferFallback?: boolean;
}

const API_BASE = "https://api.github.com";
const RELEASES_PER_PAGE = 100;
const RELEASE_VERSION_CACHE_TTL_MS = 5 * 60 * 1000;
const RELEASE_FALLBACK_CACHE_TTL_MS = 60 * 1000;

/**
 * release 列表缓存。
 *
 * 更新检查和版本选择弹窗都可能在短时间内反复查询同一个仓库。
 * 用一个很短的内存 TTL 可以明显减少 GitHub API 请求量，同时又不会让版本信息长期陈旧。
 */
const releaseVersionCache = new Map<string, { expiresAt: number; versions: ReleaseVersion[] }>();

const getToken = async (manager: Manager): Promise<string | undefined> => manager.getGithubToken();

const buildHeaders = (token?: string, accept = "application/vnd.github+json"): Record<string, string> => {
	const headers: Record<string, string> = {
		Accept: accept,
		"User-Agent": "better-plugins-manager",
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	return headers;
};

const getHeader = (headers: Record<string, string> | undefined, name: string): string | undefined => {
	if (!headers) return undefined;
	const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
	return entry?.[1];
};

/**
 * 将用户输入归一化为 GitHub 的 owner/repo 形式。
 *
 * 支持：
 * - owner/repo
 * - https://github.com/owner/repo
 * - git@github.com:owner/repo.git
 * - 带 releases/tree 等后续路径的 GitHub URL
 */
export const sanitizeRepo = (input: string): string => {
	let repo = (input || "").trim();
	repo = repo.split(/[?#]/)[0];
	repo = repo.replace(/^https?:\/\/github.com\//i, "");
	repo = repo.replace(/^git@github.com:/i, "");
	repo = repo.replace(/\.git$/i, "");
	repo = repo.replace(/\/+$/g, "");

	const parts = repo.split("/").filter(Boolean);
	return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : repo;
};

const enrichError = (res: RequestUrlResponse, msg?: string): GithubRequestError => {
	const err = new Error(msg || `GitHub request failed: ${res.status}`) as GithubRequestError;
	err.status = res.status;
	err.rateRemaining = getHeader(res.headers, "x-ratelimit-remaining");
	err.rateReset = getHeader(res.headers, "x-ratelimit-reset");
	return err;
};

/**
 * 读取 JSON 响应。
 *
 * requestUrl 默认会在 400+ 时直接 throw；这里显式设置 throw: false，
 * 让我们能保留 GitHub rate limit 等响应头，后续错误提示会更准确。
 */
const fetchJson = async <T>(manager: Manager, url: string, token?: string): Promise<T> => {
	const res = await requestUrl({ url: resolveGithubUrl(manager, url), headers: buildHeaders(token), throw: false });
	if (res.status >= 400) throw enrichError(res);
	return res.json as T;
};

/** 读取文本响应，主要用于下载 release asset 和 raw.githubusercontent.com 文件。 */
const fetchText = async (manager: Manager, url: string, token?: string): Promise<string> => {
	const res = await requestUrl({ url: resolveGithubUrl(manager, url), headers: buildHeaders(token, "*/*"), throw: false });
	if (res.status >= 400) throw enrichError(res);
	return res.text;
};

/**
 * 获取指定 release。
 *
 * version 为空时使用 latest release；不为空时按 tag 精确查找。
 * tag 中可能出现斜杠等特殊字符，所以放入 URL 前要 encodeURIComponent。
 */
const getRelease = async (manager: Manager, repo: string, version?: string, token?: string): Promise<ReleaseResponse> => {
	const requestedVersion = version?.trim();
	const url = requestedVersion
		? `${API_BASE}/repos/${repo}/releases/tags/${encodeURIComponent(requestedVersion)}`
		: `${API_BASE}/repos/${repo}/releases/latest`;
	return fetchJson<ReleaseResponse>(manager, url, token);
};

const pickAsset = (release: ReleaseResponse, name: string): string | null =>
	release.assets?.find((asset) => asset.name === name)?.browser_download_url ?? null;

const cloneReleaseVersions = (versions: ReleaseVersion[]): ReleaseVersion[] =>
	versions.map((version) => ({ ...version }));

const buildReleaseCacheKey = (repo: string, token?: string, proxy?: string): string =>
	`${repo}\n${token ? "authenticated" : "anonymous"}\n${proxy || "direct"}`;

const buildReleaseCacheKeyWithOptions = (
	repo: string,
	token: string | undefined,
	proxy: string | undefined,
	options?: FetchReleaseVersionOptions
): string => `${buildReleaseCacheKey(repo, token, proxy)}\nmanifest:${options?.includeManifest ? "1" : "0"}\nfallback:${options?.preferFallback ? "1" : "0"}`;

/**
 * 生成 raw 文件候选地址。
 *
 * 许多插件 release tag 使用 v1.2.3，也有一些直接使用 1.2.3。
 * 当 release asset 不完整时，BPM 会在 tag 和 v 前缀变体之间做兜底尝试。
 */
const buildRawTagCandidates = (tag: string): string[] => {
	const candidates = [tag];
	if (tag.startsWith("v") && tag.length > 1) {
		candidates.push(tag.slice(1));
	} else {
		candidates.push(`v${tag}`);
	}
	return Array.from(new Set(candidates));
};

const fetchRawFromTag = async (manager: Manager, repo: string, tag: string, file: string, token?: string): Promise<string> => {
	for (const candidateTag of buildRawTagCandidates(tag)) {
		try {
			return await fetchText(manager, `https://raw.githubusercontent.com/${repo}/${candidateTag}/${file}`, token);
		} catch {
			// Try the next common tag spelling.
		}
	}
	throw new Error(`Raw file missing: ${file}`);
};

const settledValue = <T>(result: PromiseSettledResult<T | null>): T | null =>
	result.status === "fulfilled" ? result.value : null;

/**
 * 并行读取 release asset 中的插件文件。
 *
 * 原实现按 manifest -> main.js -> styles.css 顺序请求。
 * 这里改为并行请求，安装时可以少等多个网络往返；任一资源失败时返回 null，
 * 调用方再决定是否回退到 raw tag。
 */
const fetchPluginFilesFromReleaseAssets = async (manager: Manager, release: ReleaseResponse, token?: string): Promise<PluginFiles> => {
	const manifestUrl = pickAsset(release, "manifest.json");
	const mainJsUrl = pickAsset(release, "main.js");
	const stylesUrl = pickAsset(release, "styles.css");

	const [manifestText, mainJs, styles] = await Promise.allSettled([
		manifestUrl ? fetchText(manager, manifestUrl, token) : Promise.resolve(null),
		mainJsUrl ? fetchText(manager, mainJsUrl, token) : Promise.resolve(null),
		stylesUrl ? fetchText(manager, stylesUrl, token) : Promise.resolve(null),
	]);

	return {
		manifestText: settledValue(manifestText),
		mainJs: settledValue(mainJs),
		styles: settledValue(styles),
	};
};

/**
 * 从仓库 tag 的 raw 文件中补齐缺失文件。
 *
 * release asset 不完整时仍有不少仓库会在 tag 对应源码里保留 manifest.json/main.js。
 * 已经从 release asset 成功拿到的文件会直接复用，不重复下载。
 */
const fetchPluginFilesFromRawTag = async (
	manager: Manager,
	repo: string,
	tag: string,
	token: string | undefined,
	current: PluginFiles
): Promise<PluginFiles> => {
	const [manifestText, mainJs, styles] = await Promise.all([
		current.manifestText ?? fetchRawFromTag(manager, repo, tag, "manifest.json", token),
		current.mainJs ?? fetchRawFromTag(manager, repo, tag, "main.js", token),
		current.styles ?? fetchRawFromTag(manager, repo, tag, "styles.css", token).catch(() => null),
	]);

	return { manifestText, mainJs, styles };
};

/**
 * 已知 tag 时直接拼接 release 下载地址，绕过 GitHub REST API。
 * 这条通道不占用 API 额度，用于 403 限流时的安装兜底。
 */
const fetchPluginFilesFromReleaseDownload = async (
	manager: Manager,
	repo: string,
	tag: string,
	token: string | undefined
): Promise<PluginFiles> => {
	const base = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}`;
	const [manifestText, mainJs, styles] = await Promise.all([
		fetchText(manager, `${base}/manifest.json`, token).catch(() => null),
		fetchText(manager, `${base}/main.js`, token).catch(() => null),
		fetchText(manager, `${base}/styles.css`, token).catch(() => null),
	]);
	return { manifestText, mainJs, styles };
};

/**
 * 更新 BPM 的单个插件记录。
 *
 * 过去安装完成后会调用 synchronizePlugins()，它会扫描全部插件并导出所有插件笔记。
 * 安装/更新 GitHub 单个插件时，只需要 upsert 当前插件记录即可，这能避免插件很多时的
 * 大量无关文件写入。
 */
const upsertInstalledPluginRecord = (
	manager: Manager,
	manifest: PluginManifestJson,
	loadedManifest: PluginManifest | undefined,
	markAsBpm: boolean
) => {
	const pluginId = manifest.id;
	const plugin = manager.settings.Plugins.find((item) => item.id === pluginId);
	const shouldHaveBpmTag = markAsBpm || manager.settings.BPM_INSTALLED.includes(pluginId);
	const nextName = loadedManifest?.name || manifest.name || pluginId;
	const nextDesc = loadedManifest?.description || manifest.description || "";

	if (plugin) {
		plugin.name = nextName;
		plugin.desc = nextDesc || plugin.desc;
		plugin.enabled = true;
		if (shouldHaveBpmTag && !plugin.tags.includes(BPM_TAG_ID)) plugin.tags.push(BPM_TAG_ID);
		manager.applySpecialPluginTags(plugin);
		return;
	}

	const record: ManagerPlugin = {
		id: pluginId,
		name: nextName,
		desc: nextDesc,
		group: "",
		tags: shouldHaveBpmTag ? [BPM_TAG_ID] : [],
		enabled: true,
		delay: "",
		note: "",
	};
	manager.applySpecialPluginTags(record);
	manager.settings.Plugins.push(record);
};

const releaseToVersion = (release: ReleaseResponse, latestTag?: string): ReleaseVersion => ({
	version: release.tag_name || "",
	prerelease: isPrereleaseRelease(release.tag_name, Boolean(release.prerelease)),
	name: release.name || undefined,
	body: release.body || undefined,
	publishedAt: release.published_at || undefined,
	url: release.html_url || undefined,
	isGithubLatest: Boolean(latestTag && release.tag_name === latestTag),
});

const fetchReleaseManifestText = async (
	manager: Manager,
	repo: string,
	release: ReleaseResponse,
	token?: string
): Promise<string | null> => {
	const manifestUrl = pickAsset(release, "manifest.json");
	if (manifestUrl) {
		try {
			return await fetchText(manager, manifestUrl, token);
		} catch {
			// Fall back to the source tag below.
		}
	}

	const tag = release.tag_name || "";
	if (!tag) return null;
	try {
		return await fetchRawFromTag(manager, repo, tag, "manifest.json", token);
	} catch {
		return null;
	}
};

const enrichReleaseVersionWithManifest = async (
	manager: Manager,
	repo: string,
	release: ReleaseResponse,
	version: ReleaseVersion,
	token?: string
): Promise<ReleaseVersion> => {
	const manifestText = await fetchReleaseManifestText(manager, repo, release, token);
	if (!manifestText) return { ...version, compatibilityChecked: true };

	try {
		const manifest = JSON.parse(manifestText) as { version?: string; minAppVersion?: string };
		return {
			...version,
			manifestVersion: typeof manifest.version === "string" ? manifest.version : undefined,
			minAppVersion: typeof manifest.minAppVersion === "string" ? manifest.minAppVersion : undefined,
			compatibilityChecked: true,
		};
	} catch {
		return { ...version, compatibilityChecked: true };
	}
};

/** 解析 GitHub releases Atom；不占 REST API 额度，作为限流时的兜底。 */
const parseAtomReleaseVersions = (xml: string, repo: string): ReleaseVersion[] => {
	if (!xml.trim()) return [];
	const doc = new DOMParser().parseFromString(xml, "application/xml");
	if (doc.querySelector("parsererror")) return [];
	const entries = Array.from(doc.querySelectorAll("entry"));
	const versions: ReleaseVersion[] = [];
	entries.forEach((entry, index) => {
		const href = entry.querySelector('link[rel="alternate"]')?.getAttribute("href")?.trim() ?? "";
		const marker = "/releases/tag/";
		const rawTag = href.includes(marker) ? href.slice(href.indexOf(marker) + marker.length) : "";
		let tag = rawTag;
		if (rawTag) {
			try {
				tag = decodeURIComponent(rawTag);
			} catch {
				tag = rawTag;
			}
		}
		if (!tag) {
			const title = entry.querySelector("title")?.textContent?.trim() ?? "";
			if (/^v?\d+(?:\.\d+)*(?:[-+].+)?$/.test(title)) tag = title;
		}
		if (!tag) return;
		const updated = entry.querySelector("updated")?.textContent?.trim();
		const content = entry.querySelector("content")?.textContent?.trim();
		versions.push({
			version: tag,
			prerelease: isPrereleaseRelease(tag, false),
			name: entry.querySelector("title")?.textContent?.trim() || undefined,
			body: content || undefined,
			publishedAt: updated || undefined,
			url: href || `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`,
			isGithubLatest: index === 0,
		});
	});
	return versions;
};

/** 读取 Atom feed；失败时返回空列表，由调用方决定是否继续回退。 */
export const fetchReleaseVersionsFromAtom = async (manager: Manager, repoInput: string): Promise<ReleaseVersion[]> => {
	const repo = sanitizeRepo(repoInput);
	if (!repo.includes("/")) return [];
	try {
		const res = await requestUrl({
			url: resolveGithubUrl(manager, `https://github.com/${repo}/releases.atom`),
			headers: { Accept: "application/atom+xml, application/xml;q=0.9", "User-Agent": "better-plugins-manager" },
			throw: false,
		});
		if (res.status >= 400) return [];
		return parseAtomReleaseVersions(res.text, repo);
	} catch {
		return [];
	}
};

const fetchManifestVersionFromRaw = async (manager: Manager, repo: string, ref: string): Promise<ReleaseVersion | null> => {
	try {
		const res = await requestUrl({
			url: resolveGithubUrl(manager, `https://raw.githubusercontent.com/${repo}/${ref}/manifest.json`),
			headers: { Accept: "application/json", "User-Agent": "better-plugins-manager" },
			throw: false,
		});
		if (res.status >= 400) return null;
		const manifest = JSON.parse(res.text) as { version?: unknown; minAppVersion?: unknown };
		const version = typeof manifest.version === "string" ? manifest.version.trim() : "";
		if (!version) return null;
		return {
			version,
			prerelease: isPrereleaseRelease(version, false),
			publishedAt: undefined,
			url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(version)}`,
			manifestVersion: version,
			minAppVersion: typeof manifest.minAppVersion === "string" ? manifest.minAppVersion : undefined,
			compatibilityChecked: true,
			isGithubLatest: true,
		};
	} catch {
		return null;
	}
};

const fetchManifestVersionFromTag = async (manager: Manager, repo: string, tag: string): Promise<ReleaseVersion | null> => {
	for (const candidate of buildRawTagCandidates(tag)) {
		const version = await fetchManifestVersionFromRaw(manager, repo, candidate);
		if (version) return version;
	}
	return null;
};

/** Atom → raw manifest 的兜底链；两条都是 GitHub 网页/raw 通道，不占 API 额度。 */
export const fetchFallbackReleaseVersions = async (
	manager: Manager,
	repoInput: string,
	includeManifest = false
): Promise<ReleaseVersion[]> => {
	const repo = sanitizeRepo(repoInput);
	if (!repo.includes("/")) return [];
	const atom = await fetchReleaseVersionsFromAtom(manager, repo);
	if (atom.length) {
		if (includeManifest) {
			const latest = await fetchManifestVersionFromTag(manager, repo, atom[0].version);
			if (latest) {
				atom[0] = {
					...atom[0],
					manifestVersion: latest.manifestVersion,
					minAppVersion: latest.minAppVersion,
					compatibilityChecked: true,
				};
			}
		}
		return atom;
	}
	const candidates = ["HEAD", "main", "master"];
	for (const ref of candidates) {
		const latest = await fetchManifestVersionFromRaw(manager, repo, ref);
		if (latest) return [latest];
	}
	return [];
};

const cacheReleaseVersions = (cacheKey: string, versions: ReleaseVersion[], ttl: number): void => {
	releaseVersionCache.set(cacheKey, {
		expiresAt: Date.now() + ttl,
		versions: cloneReleaseVersions(versions),
	});
};

/**
 * 拉取指定仓库的 release 版本列表。
 *
 * 返回值用于下拉选择和更新检查。短 TTL 缓存可以避免用户打开弹窗、点击刷新、
 * 批量检查更新时反复打同一个 GitHub API。API 不可用时回退到 Atom/raw manifest。
 */
export const fetchReleaseVersions = async (
	manager: Manager,
	repoInput: string,
	options: FetchReleaseVersionOptions = {}
): Promise<ReleaseVersion[]> => {
	const repo = sanitizeRepo(repoInput);
	const token = await getToken(manager);
	const cacheKey = buildReleaseCacheKeyWithOptions(repo, token, manager.settings.GITHUB_PROXY, options);
	const cached = releaseVersionCache.get(cacheKey);
	const now = Date.now();

	if (cached && cached.expiresAt > now) {
		return cloneReleaseVersions(cached.versions);
	}

	if (options.preferFallback) {
		const fallback = await fetchFallbackReleaseVersions(manager, repo, Boolean(options.includeManifest));
		if (fallback.length) {
			cacheReleaseVersions(cacheKey, fallback, RELEASE_FALLBACK_CACHE_TTL_MS);
			return fallback;
		}
	}

	try {
		const latestRelease = await getRelease(manager, repo, undefined, token).catch(() => null);
		const latestTag = latestRelease?.tag_name || undefined;
		const releases: ReleaseResponse[] = [];
		for (let page = 1; ; page++) {
			const url = `${API_BASE}/repos/${repo}/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`;
			const pageReleases = await fetchJson<ReleaseResponse[]>(manager, url, token);
			if (!Array.isArray(pageReleases) || pageReleases.length === 0) break;
			releases.push(...pageReleases);
			if (pageReleases.length < RELEASES_PER_PAGE) break;
		}

		let releaseEntries = releases
			.filter((release) => !release.draft)
			.map((release) => ({ release, version: releaseToVersion(release, latestTag) }))
			.filter((entry) => entry.version.version);

		if (options.includeManifest) {
			releaseEntries = await Promise.all(releaseEntries.map(async (entry) => ({
				release: entry.release,
				version: await enrichReleaseVersionWithManifest(manager, repo, entry.release, entry.version, token),
			})));
		}

		const versions = releaseEntries.map((entry) => entry.version);
		if (versions.length === 0) {
			const fallback = await fetchFallbackReleaseVersions(manager, repo, Boolean(options.includeManifest));
			if (fallback.length) {
				cacheReleaseVersions(cacheKey, fallback, RELEASE_FALLBACK_CACHE_TTL_MS);
				return fallback;
			}
		}

		cacheReleaseVersions(cacheKey, versions, RELEASE_VERSION_CACHE_TTL_MS);
		return versions;
	} catch (error) {
		const fallback = await fetchFallbackReleaseVersions(manager, repo, Boolean(options.includeManifest));
		if (fallback.length) {
			if (manager.settings.DEBUG) console.warn("[BPM] GitHub API unavailable, using Atom/raw fallback", { repo, error });
			cacheReleaseVersions(cacheKey, fallback, RELEASE_FALLBACK_CACHE_TTL_MS);
			return fallback;
		}
		throw error;
	}
};

/**
 * 从 GitHub release 安装或更新 Obsidian 插件。
 *
 * 设计要点：
 * - 优先使用 release asset，因为这是 Obsidian 社区插件推荐的发布方式。
 * - 如果 asset 不完整，再回退到 tag 对应源码里的 raw manifest/main/styles。
 * - manifest/main 是必需文件，styles.css 是可选文件。
 * - 网络下载和文件写入都尽量并行，减少安装等待时间。
 * - 安装后只更新当前插件的 BPM 记录，避免触发全量插件笔记导出。
 */
export const installPluginFromGithub = async (
	manager: Manager,
	repoInput: string,
	version?: string,
	markAsBpm = true
): Promise<boolean> => {
	let task: BackgroundTaskHandle | null = null;
	try {
		const repo = sanitizeRepo(repoInput);
		task = manager.tasks.start({ title: manager.translator.t("任务_获取发布", { name: repo }), progress: 0.04 });
		const token = await getToken(manager);
		let release: ReleaseResponse | null = null;
		let apiError: unknown;
		try {
			release = await getRelease(manager, repo, version, token);
		} catch (error) {
			apiError = error;
		}
		let tag = release?.tag_name || version?.trim() || "";
		if (!release && !tag) {
			const fallback = await fetchFallbackReleaseVersions(manager, repo, false);
			tag = fallback[0]?.version || "";
		}
		if (!release && !tag) throw apiError ?? new Error("未找到发布 tag，无法下载原始文件。");
		task.update({ title: manager.translator.t("任务_下载插件文件", { name: repo }), progress: 0.2 });

		if (manager.settings.DEBUG) console.log("[BPM] install from GitHub", { repo, version, tag, apiFallback: !release });

		let files = release
			? await fetchPluginFilesFromReleaseAssets(manager, release, token)
			: await fetchPluginFilesFromReleaseDownload(manager, repo, tag, token);

		if (manager.settings.DEBUG) {
			console.log("[BPM] release assets picked", {
				manifest: Boolean(files.manifestText),
				main: Boolean(files.mainJs),
				styles: Boolean(files.styles),
			});
		}

		task.update({ progress: 0.58 });
		if (!files.manifestText || !files.mainJs) {
			if (!tag) throw new Error("未找到发布 tag，无法下载原始文件。");
			try {
				files = await fetchPluginFilesFromRawTag(manager, repo, tag, token, files);
				if (manager.settings.DEBUG) {
					console.log("[BPM] fallback to raw tag", {
						repo,
						tag,
						manifest: Boolean(files.manifestText),
						main: Boolean(files.mainJs),
						styles: Boolean(files.styles),
					});
				}
			} catch (error) {
				console.error("[BPM] fallback to raw tag failed", error);
			}
		}

		task.update({ progress: 0.72 });
		if (!files.manifestText || !files.mainJs) {
			task.fail();
			new Notice(manager.translator.t("安装_错误_缺少插件资源"));
			return false;
		}

		const manifest = JSON.parse(files.manifestText) as PluginManifestJson;
		if (!manifest?.id) {
			task.fail();
			new Notice(manager.translator.t("安装_错误_manifest缺少ID"));
			return false;
		}

		if (manager.settings.DEBUG) console.log("[BPM] manifest parsed", { id: manifest.id, version: manifest.version });

		const adapter = manager.app.vault.adapter;
		const pluginDir = normalizePath(`${manager.app.vault.configDir}/plugins/${manifest.id}`);
		const pluginPath = `${pluginDir}/`;
		if (!(await adapter.exists(pluginDir))) await adapter.mkdir(pluginDir);

		if (manager.settings.DEBUG) {
			console.log("[BPM] writing files", {
				pluginDir,
				manifestSize: files.manifestText.length,
				mainSize: files.mainJs.length,
				stylesSize: files.styles?.length,
			});
		}

		task.update({ title: manager.translator.t("任务_写入插件文件", { name: repo }), progress: 0.84 });
		const writes = [
			adapter.write(`${pluginPath}manifest.json`, files.manifestText),
			adapter.write(`${pluginPath}main.js`, files.mainJs),
		];
		if (files.styles) writes.push(adapter.write(`${pluginPath}styles.css`, files.styles));
		await Promise.all(writes);

		task.update({ title: manager.translator.t("任务_启用插件", { name: manifest.name || manifest.id }), progress: 0.94 });
		try {
			await manager.appPlugins.disablePlugin(manifest.id);
		} catch {
			// The plugin may not be enabled yet; enabling below is still the desired final state.
		}
		await manager.appPlugins.enablePluginAndSave(manifest.id);

		// 刚安装/重载的插件可能带来新 ribbon 图标，登记一次
		manager.applyRibbonSettings();

		if (markAsBpm && !manager.settings.BPM_INSTALLED.includes(manifest.id)) {
			manager.settings.BPM_INSTALLED.push(manifest.id);
		}

		await manager.repoResolver.setRepo(manifest.id, repo);
		await manager.appPlugins.loadManifests();

		const loadedManifest = (manager.appPlugins.manifests as Record<string, PluginManifest | undefined>)[manifest.id];
		upsertInstalledPluginRecord(manager, manifest, loadedManifest, markAsBpm);

		if (manager.settings.DEBUG) {
			console.log("[BPM] manifest after reload", {
				id: manifest.id,
				loadedVersion: loadedManifest?.version,
				expected: manifest.version,
			});
		}

		await manager.saveSettings();

		if (manager.settings.DEBUG) console.log("[BPM] install complete", { id: manifest.id, markAsBpm });

		task.done();
		new Notice(manager.translator.t("安装_成功_提示", { name: manifest.name || manifest.id }));
		return true;
	} catch (error) {
		task?.fail();
		const err = error as GithubRequestError;
		console.error(error);
		if (err?.status === 403 && !manager.hasGithubToken()) {
			new Notice(manager.translator.t("安装_错误_限速"));
		} else if (err?.status === 404) {
			new Notice(manager.translator.t("安装_错误_缺少资源"));
		} else {
			new Notice(manager.translator.t("安装_错误_通用"));
		}
		return false;
	}
};

/**
 * 从 GitHub release 安装 Obsidian 主题。
 *
 * 主题安装比插件简单：manifest.json 和 theme.css 都是必需 asset。
 * 下载和写入同样使用并行流程，安装完成后调用 Obsidian 的 customCss 设置当前主题。
 */
export const installThemeFromGithub = async (manager: Manager, repoInput: string, version?: string): Promise<boolean> => {
	let task: BackgroundTaskHandle | null = null;
	try {
		const repo = sanitizeRepo(repoInput);
		task = manager.tasks.start({ title: manager.translator.t("任务_获取发布", { name: repo }), progress: 0.04 });
		const token = await getToken(manager);
		const release = await getRelease(manager, repo, version, token);

		const manifestUrl = pickAsset(release, "manifest.json");
		const themeUrl = pickAsset(release, "theme.css") ?? pickAsset(release, "themes.css") ?? pickAsset(release, "theme-beta.css");
		if (!manifestUrl || !themeUrl) {
			task.fail();
			new Notice(manager.translator.t("安装_错误_缺少主题资源"));
			return false;
		}

		task.update({ title: manager.translator.t("任务_下载主题文件", { name: repo }), progress: 0.3 });
		const [manifestText, themeCss] = await Promise.all([
			fetchText(manager, manifestUrl, token),
			fetchText(manager, themeUrl, token),
		]);

		const manifest = JSON.parse(manifestText) as { name: string };
		if (!manifest?.name) {
			task.fail();
			new Notice(manager.translator.t("安装_错误_主题manifest缺少名称"));
			return false;
		}

		const adapter = manager.app.vault.adapter;
		const themeDir = normalizePath(`${manager.app.vault.configDir}/themes/${manifest.name}`);
		const themePath = `${themeDir}/`;
		if (!(await adapter.exists(themeDir))) await adapter.mkdir(themeDir);

		task.update({ title: manager.translator.t("任务_写入主题文件", { name: manifest.name }), progress: 0.8 });
		await Promise.all([
			adapter.write(`${themePath}theme.css`, themeCss),
			adapter.write(`${themePath}manifest.json`, manifestText),
		]);

		// customCss is an internal Obsidian API, so optional chaining keeps older builds safe.
		// @ts-ignore
		manager.app.customCss?.setTheme?.(manifest.name);

		task.done();
		new Notice(manager.translator.t("安装_主题成功_提示", { name: manifest.name }));
		return true;
	} catch (error) {
		task?.fail();
		console.error(error);
		new Notice(manager.translator.t("安装_主题错误_通用"));
		return false;
	}
};
