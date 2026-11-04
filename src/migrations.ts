import Manager from "main";
import { BPM_TAG_ID, ensureBpmTagExists } from "src/repo-resolver";
import { normalizePath, parseYaml, stringifyYaml } from "obsidian";

/**
 * 单个迁移任务。
 *
 * 约定：
 * - 每个迁移必须可重复执行；即使用户回滚 data.json 或手动改 MIGRATION_VERSION，也不能产生重复数据。
 * - run 返回 true 表示迁移修改了 settings，需要立即保存；返回 false/void 表示没有 settings 变更。
 * - 文件迁移应该自行处理单文件失败，避免一篇损坏笔记阻塞整个插件启动。
 */
type Migration = {
	version: string;
	run: (manager: Manager, context: { fromVersion: string }) => Promise<boolean | void> | boolean | void;
};

/** Markdown frontmatter 的解析结果。 */
type ParsedFrontmatter = {
	frontmatter: Record<string, unknown> | null;
	body: string;
};

/**
 * 将版本号拆成可比较的数字段。
 *
 * 插件版本通常是 0.3.2 这种 semver-like 字符串；这里额外兼容 v0.3.2、0.3.2-beta.1
 * 这类输入，只提取每段开头的数字。无法识别的片段按 0 处理，保证比较函数稳定返回。
 */
const parseVersionParts = (version: string): number[] => {
	return (version || "0")
		.replace(/^v/i, "")
		.split(".")
		.map((part) => {
			const match = part.match(/^\d+/);
			return match ? Number(match[0]) : 0;
		});
};

/**
 * 比较两个版本号。
 *
 * 返回值：
 * - 1：a > b
 * - 0：a === b
 * - -1：a < b
 */
const compareVersions = (a: string, b: string): number => {
	const left = parseVersionParts(a);
	const right = parseVersionParts(b);
	const len = Math.max(left.length, right.length);

	for (let i = 0; i < len; i++) {
		const ai = left[i] ?? 0;
		const bi = right[i] ?? 0;
		if (ai > bi) return 1;
		if (ai < bi) return -1;
	}
	return 0;
};

/**
 * 解析 Markdown 顶部 YAML frontmatter。
 *
 * 只处理文件开头的标准 --- 块；没有 frontmatter 或 YAML 解析失败时返回 null，
 * body 始终保留原正文，方便迁移在重写 frontmatter 时不碰用户正文内容。
 */
const parseFrontmatter = (content: string): ParsedFrontmatter => {
	if (!content.startsWith("---")) return { frontmatter: null, body: content };

	const end = content.indexOf("\n---", 3);
	if (end === -1) return { frontmatter: null, body: content };

	const raw = content.slice(3, end).trim();
	let frontmatter: Record<string, unknown> | null = null;
	try {
		const parsed: unknown = parseYaml(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			frontmatter = parsed as Record<string, unknown>;
		}
	} catch {
		frontmatter = null;
	}

	return {
		frontmatter,
		body: content.slice(end + 4),
	};
};

/**
 * 重新组装 Markdown。
 *
 * body 可能来自旧文件，保留它原本是否以换行开头的习惯；
 * stringifyYaml 只负责结构化字段，用户正文不参与 YAML 序列化。
 */
const buildMarkdownWithFrontmatter = (frontmatter: Record<string, unknown>, body: string): string => {
	const yaml = stringifyYaml(frontmatter).trimEnd();
	return `---\n${yaml}\n---${body.startsWith("\n") ? "" : "\n"}${body}`;
};

/** 判断文件是否位于导出目录内。 */
const listMarkdownFilesInFolder = async (manager: Manager, folderPath: string): Promise<string[]> => {
	const adapter = manager.app.vault.adapter;
	const normalizedFolder = normalizePath(folderPath);
	const result: string[] = [];
	let listed;

	try {
		listed = await adapter.list(normalizedFolder);
	} catch {
		return result;
	}

	for (const filePath of listed.files) {
		if (filePath.toLowerCase().endsWith(".md")) result.push(filePath);
	}

	for (const childFolder of listed.folders) {
		result.push(...await listMarkdownFilesInFolder(manager, childFolder));
	}

	return result;
};

/**
 * 迁移 0.3.1：修复早期默认数据。
 *
 * 早期版本可能存在：
 * - 语言未按 Obsidian 当前语言初始化。
 * - 默认分组/默认标签残留在用户数据中。
 * - BPM 安装标签缺失。
 * - 插件记录缺少 name，导致 UI 或导出显示 id 兜底不一致。
 */
const migrate031 = async (manager: Manager): Promise<boolean> => {
	let changed = false;

	if (!manager.settings.LANGUAGE_INITIALIZED || !manager.settings.LANGUAGE) {
		manager.settings.LANGUAGE = manager.getAppLanguage();
		manager.settings.LANGUAGE_INITIALIZED = true;
		changed = true;
	}

	if (manager.settings.GROUPS?.some((group) => group.id === "default")) {
		manager.settings.GROUPS = manager.settings.GROUPS.filter((group) => group.id !== "default");
		changed = true;
	}

	if (manager.settings.TAGS?.some((tag) => tag.id === "default")) {
		manager.settings.TAGS = manager.settings.TAGS.filter((tag) => tag.id !== "default");
		changed = true;
	}

	const hadBpmTag = manager.settings.TAGS?.some((tag) => tag.id === BPM_TAG_ID);
	ensureBpmTagExists(manager);
	if (!hadBpmTag) changed = true;

	manager.settings.Plugins?.forEach((plugin) => {
		if (!plugin.name) {
			plugin.name = plugin.id;
			changed = true;
		}
	});

	return changed;
};

/**
 * 迁移 0.3.2：从旧版导出笔记中移除 bpm_ro_updated。
 *
 * bpm_ro_updated 曾用于记录导出更新时间，但它会让导出笔记在没有业务变化时也频繁变更，
 * 对同步工具、Git 版本管理和 Obsidian 文件监听都不友好。这个字段是只读派生信息，
 * 删除后不会丢失用户可编辑数据。
 */
const migrate032 = async (manager: Manager): Promise<void> => {
	const exportDir = (manager.settings as unknown as Record<string, unknown>)["EXPORT_DIR"];
	if (typeof exportDir !== "string" || !exportDir) return;

	const exportedMarkdownFiles = await listMarkdownFilesInFolder(manager, exportDir);

	for (const filePath of exportedMarkdownFiles) {
		try {
			const oldContent = await manager.app.vault.adapter.read(filePath);
			const parsed = parseFrontmatter(oldContent);
			const frontmatter = parsed.frontmatter;

			if (!frontmatter?.["bpm_ro_id"] || !("bpm_ro_updated" in frontmatter)) continue;

			delete frontmatter["bpm_ro_updated"];
			const nextContent = buildMarkdownWithFrontmatter(frontmatter, parsed.body);
			if (nextContent !== oldContent) {
				await manager.app.vault.adapter.write(filePath, nextContent);
			}
		} catch (e) {
			if (manager.settings.DEBUG) {
				console.warn("[BPM] Failed to migrate exported plugin note", filePath, e);
			}
		}
	}
};

/** 按版本升序排列的迁移表。新增迁移只需要追加一个更高版本。 */
const migrations: Migration[] = [
	{
		version: "0.3.1",
		run: migrate031,
	},
	{
		version: "0.3.2",
		run: migrate032,
	},
	{
		version: "1.2.0",
		// 升级仅统一一次，随后尊重用户选择；Apply new defaults once, preserving later user choices.
		run: (manager, context) => {
			manager.settings.TOOLBAR_LABEL_MODE = "active";
			manager.settings.TOOLBAR_HOVER_LABELS = true;
			// 新安装不弹窗；Only existing installations receive the upgrade tour.
			if (context.fromVersion) manager.settings.RELEASE_HIGHLIGHTS_PENDING = "1.2.0";
			return true;
		},
	},
];

/**
 * 执行所有未完成迁移。
 *
 * 运行时机在 Manager.onload() 早期，settings 已经通过 DEFAULT_SETTINGS 补齐，
 * 但 translator、UI 和复杂运行态尚未完全初始化，所以迁移代码应尽量只操作 settings
 * 和必要的 vault 文件，不依赖界面对象。
 */
export const runMigrations = async (manager: Manager, options: { save?: boolean } = {}): Promise<boolean> => {
	const currentVersion = manager.manifest.version;
	const lastMigrationVersion = manager.settings.MIGRATION_VERSION || "";
	const pendingMigrations = migrations
		.filter((migration) => compareVersions(migration.version, lastMigrationVersion) > 0)
		.sort((a, b) => compareVersions(a.version, b.version));

	let anyChange = false;

	for (const migration of pendingMigrations) {

		const previousMigrationVersion = manager.settings.MIGRATION_VERSION || "";
		const settingsChanged = await migration.run(manager, { fromVersion: lastMigrationVersion });
		manager.settings.MIGRATION_VERSION = migration.version;

		/**
		 * 即使迁移本身只改了 vault 文件，也必须保存 MIGRATION_VERSION。
		 * 否则下次启动会重复执行已经完成的迁移。
		 */
		if (settingsChanged || manager.settings.MIGRATION_VERSION !== previousMigrationVersion) {
			anyChange = true;
		}
	}

	/**
	 * 迁移表不一定每个发布版本都有条目。
	 *
	 * 当插件升级到没有新迁移的版本时，仍把 MIGRATION_VERSION 推进到当前插件版本，
	 * 表示“截至当前版本无需额外迁移”，避免未来每次启动都重新扫描旧迁移表。
	 */
	if (!manager.settings.MIGRATION_VERSION || compareVersions(manager.settings.MIGRATION_VERSION, currentVersion) < 0) {
		manager.settings.MIGRATION_VERSION = currentVersion;
		anyChange = true;
	}

	if (anyChange && options.save !== false) {
		await manager.saveSettings();
	}
	return anyChange;
};
