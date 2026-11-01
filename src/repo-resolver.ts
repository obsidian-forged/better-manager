import { normalizePath, requestUrl } from "obsidian";
import Manager from "main";
import { resolveGithubUrl } from "./github-url";
import { pluginStorage } from './storage/plugin-storage';

/** BPM 自动标记的标签 id。该 id 写入 settings 后不能随显示语言变化。 */
export const BPM_TAG_ID = "bpm-install";

/** 社区插件 id -> GitHub 仓库 的本地缓存文件名。 */
const CACHE_FILE = "better-plugins-manager-community-plugins-cache.json";

/** Obsidian 官方社区插件列表地址，数据形态稳定为 [{ id, repo, ... }]。 */
const COMMUNITY_PLUGINS_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";

/** 插件 id 到 GitHub 仓库路径的映射，repo 通常为 owner/repo。 */
type RepoMap = Record<string, string>;

/** 官方 community-plugins.json 中本模块关心的最小字段集合。 */
type CommunityPluginEntry = {
	id?: unknown;
	repo?: unknown;
};

/**
 * 负责把 Obsidian 插件 id 解析为 GitHub 仓库地址。
 *
 * 设计边界：
 * - settings.REPO_MAP 是“已确认映射”，来源包括用户手动填写、BPM 安装流程和历史解析结果。
 * - community-plugins-cache.json 是官方社区列表的本地快照，用来减少网络请求和离线失败。
 * - 本类只维护 repo 映射，不负责版本判断、安装、更新 UI 或导出笔记。
 */
export class RepoResolver {
	private manager: Manager;
	private cacheLoaded = false;
	private cacheLoadPromise: Promise<void> | null = null;
	private communityListPromise: Promise<RepoMap> | null = null;
	private cache: RepoMap = {};

	constructor(manager: Manager) {
		this.manager = manager;
	}

	/**
	 * 统一读取 settings.REPO_MAP。
	 *
	 * 理论上 loadSettings 会用 DEFAULT_SETTINGS 补齐该字段；这里仍做兜底，
	 * 是为了兼容极早期数据或外部手动编辑 data.json 导致字段缺失的情况。
	 */
	private get settingsRepoMap(): RepoMap {
		if (!this.manager.settings.REPO_MAP) {
			this.manager.settings.REPO_MAP = {};
		}
		return this.manager.settings.REPO_MAP;
	}

	/**
	 * 把未知 JSON 数据收敛为干净的 RepoMap。
	 *
	 * 缓存文件可能被用户手动编辑、同步工具截断或旧版本写入异常数据；
	 * 这里只保留字符串 key/value，避免把非法结构带进运行时缓存。
	 */
	private toRepoMap(value: unknown): RepoMap {
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};

		const map: RepoMap = {};
		Object.entries(value as Record<string, unknown>).forEach(([pluginId, repo]) => {
			if (typeof repo !== "string") return;
			const normalizedId = pluginId.trim();
			const normalizedRepo = repo.trim();
			if (normalizedId && normalizedRepo) {
				map[normalizedId] = normalizedRepo;
			}
		});
		return map;
	}

	/** 从磁盘加载社区列表缓存；失败时降级为空缓存，不阻断插件启动。 */
	private async loadCacheFromFile(): Promise<void> {
		try {
			const content = await pluginStorage(this.manager).read('cache', 'community-plugins.json',
				[normalizePath(`${this.manager.app.vault.configDir}/${CACHE_FILE}`)]);
			if (content === undefined) return;
			this.cache = this.toRepoMap(JSON.parse(content));
		} catch (e) {
			if (this.manager.settings.DEBUG) console.error("[BPM] Failed to load repository cache", e);
			this.cache = {};
		}
	}

	/**
	 * 将内存缓存写回磁盘。
	 *
	 * 写缓存只是性能优化；失败不应影响解析结果，所以这里只记录错误。
	 */
	private async writeCache(): Promise<void> {
		try {
			await pluginStorage(this.manager).write('cache', 'community-plugins.json', JSON.stringify(this.cache, null, 2));
		} catch (e) {
			if (this.manager.settings.DEBUG) console.error("[BPM] Failed to write repository cache", e);
		}
	}

	/**
	 * 确保缓存只初始化一次。
	 *
	 * 多个更新检查可能同时调用 resolveRepo()；复用同一个 Promise 可以避免重复读盘，
	 * 也能保证 settings.REPO_MAP 始终覆盖磁盘快照中的旧值。
	 */
	private async ensureCacheLoaded(): Promise<void> {
		if (this.cacheLoaded) return;
		if (!this.cacheLoadPromise) {
			this.cacheLoadPromise = (async () => {
				await this.loadCacheFromFile();
				this.cache = { ...this.cache, ...this.toRepoMap(this.settingsRepoMap) };
				this.cacheLoaded = true;
			})();
		}
		await this.cacheLoadPromise;
	}

	/**
	 * 把官方社区插件列表转换为 RepoMap。
	 *
	 * requestUrl 的 json 类型较宽，这里显式校验数组和字段类型，
	 * 避免 GitHub 返回错误页、代理注入内容或接口结构变化时污染缓存。
	 */
	private parseCommunityList(value: unknown): RepoMap {
		if (!Array.isArray(value)) return {};

		const map: RepoMap = {};
		value.forEach((item: CommunityPluginEntry) => {
			if (typeof item?.id !== "string" || typeof item?.repo !== "string") return;

			const pluginId = item.id.trim();
			const repo = item.repo.trim();
			if (pluginId && repo) {
				map[pluginId] = repo;
			}
		});
		return map;
	}

	/** 真正发起网络请求；外层 fetchCommunityList() 负责并发复用和重试窗口。 */
	private async requestCommunityList(): Promise<RepoMap> {
		try {
			const res = await requestUrl({ url: resolveGithubUrl(this.manager, COMMUNITY_PLUGINS_URL), throw: false });
			if (res.status >= 400) {
				if (this.manager.settings.DEBUG) {
					console.warn("[BPM] Community plugin list request failed", res.status);
				}
				return {};
			}

			const map = this.parseCommunityList(res.json);
			if (Object.keys(map).length === 0) return {};

			this.cache = { ...this.cache, ...map };
			await this.writeCache();
			return map;
		} catch (e) {
			console.error("[BPM] Failed to fetch community plugin list", e);
			return {};
		}
	}

	/**
	 * 获取官方社区插件列表。
	 *
	 * 同一时间只允许一个网络请求在路上；请求完成后清空 Promise，
	 * 这样本次失败不会永久缓存空结果，下一次缺失映射时仍可重试。
	 */
	private async fetchCommunityList(): Promise<RepoMap> {
		if (!this.communityListPromise) {
			this.communityListPromise = this.requestCommunityList()
				.finally(() => {
					this.communityListPromise = null;
				});
		}
		return this.communityListPromise;
	}

	/**
	 * 解析插件对应的 GitHub 仓库。
	 *
	 * 优先级：
	 * 1. settings.REPO_MAP：用户或 BPM 安装流程确认过的映射。
	 * 2. 本地缓存：上次官方社区列表解析出的快照。
	 * 3. 官方社区列表：网络可用时刷新并写入缓存。
	 */
	public async resolveRepo(pluginId: string): Promise<string | null> {
		const normalizedPluginId = pluginId.trim();
		if (!normalizedPluginId) return null;

		await this.ensureCacheLoaded();

		const fromSettings = this.settingsRepoMap[normalizedPluginId];
		if (fromSettings) return fromSettings;

		const fromCache = this.cache[normalizedPluginId];
		if (fromCache) return fromCache;

		const remote = await this.fetchCommunityList();
		const found = remote[normalizedPluginId];
		if (!found) return null;

		/**
		 * 保持旧行为：把已解析成功的仓库写入 settings.REPO_MAP。
		 *
		 * 这样导出笔记、更新检查和后续离线解析都能使用同一份“已确认映射”。
		 * 只保存 settings，不触发额外导出，避免保存链路互相递归。
		 */
		this.settingsRepoMap[normalizedPluginId] = found;
		await this.manager.saveSettings();
		return found;
	}

	/**
	 * 手动或安装流程写入仓库映射。
	 *
	 * 该方法同时更新 settings 和缓存，确保 UI、导出笔记、更新检查立即读到同一结果。
	 */
	public async setRepo(pluginId: string, repo: string): Promise<void> {
		const normalizedPluginId = pluginId.trim();
		const normalizedRepo = repo.trim();
		if (!normalizedPluginId || !normalizedRepo) return;

		await this.ensureCacheLoaded();

		this.cache[normalizedPluginId] = normalizedRepo;
		this.settingsRepoMap[normalizedPluginId] = normalizedRepo;

		// 先保存 settings 保证用户数据落盘，再写性能缓存；缓存失败不会丢失用户映射。
		await this.manager.saveSettings();
		await this.writeCache();
	}
}

/**
 * 确保 BPM 安装标签存在。
 *
 * 迁移、启动初始化和记录修复都会调用它；函数只负责“存在性补齐”，
 * 不保存 settings，由调用方决定是否把更大的初始化批次一起落盘。
 */
export const ensureBpmTagExists = (manager: Manager): void => {
	if (!manager.settings.TAGS.find((tag) => tag.id === BPM_TAG_ID)) {
		manager.settings.TAGS.push({
			id: BPM_TAG_ID,
			name: manager.translator ? manager.translator.t("标签_BPM安装_名称") : "BPM Installed",
			color: "#409EFF",
		});
	}
};
