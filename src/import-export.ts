import { toText } from './shared/text';
import { normalizePath, PluginManifest } from "obsidian";
import type Manager from "main";
import {
	BetaSource,
	Delay,
	InstallHistoryItem,
	ManagerPlugin,
	PluginLayoutItem,
	RibbonGroup,
	RibbonItem,
	Tag,
	Type,
} from "./data/types";
import { installPluginFromGithub, installThemeFromGithub, sanitizeRepo } from "./github-install";
import { normalizeRibbonGroups } from './devices/device-presets';

export const MANAGER_TRANSFER_SCHEMA = "better-plugins-manager.transfer/v1";

export interface ManagerTransferBuildOptions {
	plugins: boolean;
	themes: boolean;
	pluginConfigs: boolean;
	taxonomy: boolean;
	layout: boolean;
	sources: boolean;
	workspaceSettings: boolean;
	selectedPluginIds?: string[];
	selectedThemeNames?: string[];
	selectedPluginConfigIds?: string[];
}

export type ManagerTransferVersionStrategy = "latest" | "package";

export interface ManagerTransferImportOptions {
	installMissing: boolean;
	installVersionStrategy: ManagerTransferVersionStrategy;
	applyPluginMetadata: boolean;
	applyEnabledState: boolean;
	applyPluginConfigs: boolean;
	applyWorkspaceSettings: boolean;
	applyLayout: boolean;
	applySources: boolean;
	applyThemes: boolean;
	applyActiveTheme: boolean;
	selectedPluginConfigIds?: string[];
}

export interface ManagerTransferPluginFile {
	path: string;
	encoding: "base64";
	data: string;
	size: number;
}

export interface ManagerTransferPlugin {
	id: string;
	name: string;
	version?: string;
	author?: string;
	description?: string;
	repo?: string;
	pluginUrl?: string;
	downloadUrl?: string;
	enabled?: boolean;
	group?: string;
	tags?: string[];
	delay?: string;
	note?: string;
	customDescription?: string;
	installedViaBpm?: boolean;
	files?: ManagerTransferPluginFile[];
	fileCount?: number;
	fileBytes?: number;
	source?: {
		mode: BetaSource["mode"];
		frozenVersion?: string;
		includePrerelease?: boolean;
		updateCheckMode?: BetaSource["updateCheckMode"];
		updateDelayDays?: number;
		autoUpdate: boolean;
		localVersion?: string;
		latestVersion?: string;
		latestPublishedAt?: string;
		installedReleaseTag?: string;
		installedReleasePublishedAt?: string;
		latestReleaseTag?: string;
		latestReleasePublishedAt?: string;
		installedAt?: number;
	};
}

export interface ManagerTransferTheme {
	name: string;
	version?: string;
	author?: string;
	repo?: string;
	downloadUrl?: string;
	active: boolean;
	installed: boolean;
	files?: ManagerTransferPluginFile[];
	fileCount?: number;
	fileBytes?: number;
	source?: {
		mode: BetaSource["mode"];
		frozenVersion?: string;
		includePrerelease?: boolean;
		updateCheckMode?: BetaSource["updateCheckMode"];
		updateDelayDays?: number;
		autoUpdate: boolean;
		localVersion?: string;
		latestVersion?: string;
		latestPublishedAt?: string;
		installedReleaseTag?: string;
		installedReleasePublishedAt?: string;
		latestReleaseTag?: string;
		latestReleasePublishedAt?: string;
		installedAt?: number;
	};
}

export interface ManagerTransferPluginConfig {
	id: string;
	name: string;
	path: "data.json";
	encoding: "base64";
	data: string;
	size: number;
}

export interface ManagerTransferWorkspaceSettings {
	persistence: boolean;
	delayMode: boolean;
	hideBpmTag: boolean;
	startupCheckUpdates: boolean;
	pluginOverviewLayout?: string;
	itemStyle: string;
	groupStyle: string;
	tagStyle: string;
	fadeOutDisabledPlugins: boolean;
}

export interface ManagerTransferPackage {
	schema: typeof MANAGER_TRANSFER_SCHEMA;
	version: 1;
	exportedAt: string;
	generator: {
		id: string;
		name: string;
		version: string;
	};
	counts: {
		plugins: number;
		themes: number;
		pluginConfigs?: number;
		groups: number;
		tags: number;
		delays: number;
		sources: number;
		ribbonItems: number;
		layoutItems: number;
	};
	options: ManagerTransferBuildOptions;
	data: {
		plugins: ManagerTransferPlugin[];
		themes: ManagerTransferTheme[];
		pluginConfigs?: ManagerTransferPluginConfig[];
		groups: Type[];
		tags: Tag[];
		delays: Delay[];
		repoMap: Record<string, string>;
		bpmInstalled: string[];
		betaSources: BetaSource[];
		installHistory: InstallHistoryItem[];
		pluginLayout: PluginLayoutItem[];
		hiddenPlugins: string[];
		ribbonSettings: RibbonItem[];
		ribbonGroups?: RibbonGroup[];
		workspaceSettings?: ManagerTransferWorkspaceSettings;
	};
}

export interface ManagerTransferPreview {
	pluginsTotal: number;
	pluginsInstalled: number;
	pluginsMissing: number;
	pluginsInstallable: number;
	pluginsBundled: number;
	pluginsWithoutRepo: number;
	themesTotal: number;
	themesInstalled: number;
	themesMissing: number;
	themesInstallable: number;
	themesBundled: number;
	themesWithoutRepo: number;
	pluginConfigs: number;
	groups: number;
	tags: number;
	delays: number;
	sources: number;
	layoutItems: number;
	ribbonItems: number;
	exportedAt: string;
	generatorName: string;
	generatorVersion: string;
}

export interface ManagerTransferFailure {
	id: string;
	name: string;
	reason: string;
}

export interface ManagerTransferImportResult {
	installedPlugins: number;
	updatedPlugins: number;
	skippedPlugins: number;
	failedPlugins: ManagerTransferFailure[];
	installedThemes: number;
	updatedThemes: number;
	skippedThemes: number;
	failedThemes: ManagerTransferFailure[];
	appliedPluginConfigs: number;
	skippedPluginConfigs: number;
	failedPluginConfigs: ManagerTransferFailure[];
	settingsMerged: boolean;
	layoutMerged: boolean;
	sourcesMerged: boolean;
}

export type ManagerTransferProgress = (processed: number, total: number, current?: string) => void;

export const DEFAULT_TRANSFER_BUILD_OPTIONS: ManagerTransferBuildOptions = {
	plugins: true,
	themes: true,
	pluginConfigs: false,
	taxonomy: false,
	layout: false,
	sources: false,
	workspaceSettings: false,
};

export const DEFAULT_TRANSFER_IMPORT_OPTIONS: ManagerTransferImportOptions = {
	installMissing: false,
	installVersionStrategy: "latest",
	applyPluginMetadata: false,
	applyEnabledState: false,
	applyPluginConfigs: false,
	applyWorkspaceSettings: false,
	applyLayout: false,
	applySources: false,
	applyThemes: false,
	applyActiveTheme: false,
};

interface ThemeManifestJson {
	name?: string;
	version?: string;
	author?: string;
}

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cleanRepo = (repo?: string): string => {
	const normalized = sanitizeRepo(repo || "");
	return normalized.includes("/") ? normalized : "";
};

const getSourceKey = (source: BetaSource): string => `${source.type}:${cleanRepo(source.repo) || source.id}`;

const getActiveThemeName = (manager: Manager): string => {
	const customCss = (manager.app as unknown as {
		customCss?: { theme?: string; getTheme?: () => string };
	}).customCss;
	return customCss?.theme || customCss?.getTheme?.() || "";
};

const readJsonIfExists = async <T>(manager: Manager, path: string): Promise<T | null> => {
	const adapter = manager.app.vault.adapter;
	try {
		if (!(await adapter.exists(path))) return null;
		return JSON.parse(await adapter.read(path)) as T;
	} catch {
		return null;
	}
};

const SKIPPED_PACKAGE_EXPORT_FOLDERS = new Set([".git", "node_modules"]);

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;
	let binary = "";
	for (let i = 0; i < bytes.length; i += chunkSize) {
		let chunk = "";
		const end = Math.min(i + chunkSize, bytes.length);
		for (let j = i; j < end; j++) {
			chunk += String.fromCharCode(bytes[j]);
		}
		binary += chunk;
	}
	return btoa(binary);
};

const base64ToArrayBuffer = (data: string): ArrayBuffer => {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
};

const decodeBase64Text = (data: string): string => new TextDecoder().decode(base64ToArrayBuffer(data));

const getSafePluginId = (pluginId: string): string => {
	const id = (pluginId || "").trim();
	if (!id || id === "." || id === "..") return "";
	if (id.includes("/") || id.includes("\\") || id.includes(":")) return "";
	return id;
};

const getSafePackageFolderName = (name: string): string => {
	const folder = (name || "").trim();
	if (!folder || folder === "." || folder === "..") return "";
	if (folder.includes("/") || folder.includes("\\") || folder.includes(":")) return "";
	return folder;
};

const normalizePackageRelativePath = (path: string): string => {
	const normalized = normalizePath((path || "").replace(/\\/g, "/"));
	const segments = normalized.split("/").filter(Boolean);
	if (segments.length === 0) return "";
	if (segments.some((segment) => segment === "." || segment === ".." || segment.includes(":"))) return "";
	return segments.join("/");
};

const getPluginDir = (manager: Manager, pluginId: string): string => {
	return normalizePath(`${manager.app.vault.configDir}/plugins/${pluginId}`);
};

const getPluginConfigPath = (manager: Manager, pluginId: string): string => {
	return normalizePath(`${getPluginDir(manager, pluginId)}/data.json`);
};

const getThemeDir = (manager: Manager, themeFolder: string): string => {
	return normalizePath(`${manager.app.vault.configDir}/themes/${themeFolder}`);
};

const getRelativePackageFilePath = (baseDir: string, filePath: string): string => {
	const normalizedDir = normalizePath(baseDir);
	const normalizedFile = normalizePath(filePath);
	const prefix = `${normalizedDir}/`;
	return normalizedFile.startsWith(prefix) ? normalizedFile.slice(prefix.length) : "";
};

const shouldSkipPackageExportFolder = (folderPath: string): boolean => {
	const folderName = folderPath.split("/").pop() || folderPath;
	return SKIPPED_PACKAGE_EXPORT_FOLDERS.has(folderName);
};

const ensureFolderExists = async (manager: Manager, folder: string): Promise<void> => {
	const adapter = manager.app.vault.adapter;
	const normalized = normalizePath(folder);
	const parts = normalized.split("/").filter(Boolean);
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!(await adapter.exists(current))) {
			await adapter.mkdir(current);
		}
	}
};

const ensureParentFolderExists = async (manager: Manager, filePath: string): Promise<void> => {
	const parts = normalizePath(filePath).split("/");
	parts.pop();
	if (parts.length > 0) {
		await ensureFolderExists(manager, parts.join("/"));
	}
};

const collectPackageFiles = async (manager: Manager, baseDir: string): Promise<ManagerTransferPluginFile[]> => {
	const adapter = manager.app.vault.adapter;
	if (!(await adapter.exists(baseDir))) return [];

	const files: ManagerTransferPluginFile[] = [];
	const walk = async (folder: string): Promise<void> => {
		const listed = await adapter.list(folder);
		const listedFiles = [...(listed.files || [])].sort((a, b) => a.localeCompare(b));
		for (const filePath of listedFiles) {
			const relativePath = normalizePackageRelativePath(getRelativePackageFilePath(baseDir, filePath));
			if (!relativePath) continue;
			const data = await adapter.readBinary(filePath);
			files.push({
				path: relativePath,
				encoding: "base64",
				data: arrayBufferToBase64(data),
				size: data.byteLength,
			});
		}

		const folders = [...(listed.folders || [])].sort((a, b) => a.localeCompare(b));
		for (const childFolder of folders) {
			if (shouldSkipPackageExportFolder(childFolder)) continue;
			await walk(childFolder);
		}
	};

	await walk(baseDir);
	return files;
};

/*
const collectPluginFiles = async (manager: Manager, pluginId: string): Promise<ManagerTransferPluginFile[]> => {
	const safePluginId = getSafePluginId(pluginId);
	if (!safePluginId) return [];
	return collectPackageFiles(manager, getPluginDir(manager, safePluginId));
};
*/

const collectPluginConfig = async (
	manager: Manager,
	manifest: PluginManifest
): Promise<ManagerTransferPluginConfig | null> => {
	const pluginId = getSafePluginId(manifest.id);
	if (!pluginId) return null;
	const adapter = manager.app.vault.adapter;
	const path = getPluginConfigPath(manager, pluginId);
	if (!(await adapter.exists(path))) return null;
	const data = await adapter.readBinary(path);
	return {
		id: pluginId,
		name: manifest.name || pluginId,
		path: "data.json",
		encoding: "base64",
		data: arrayBufferToBase64(data),
		size: data.byteLength,
	};
};

const collectThemeFiles = async (manager: Manager, themeFolder: string): Promise<ManagerTransferPluginFile[]> => {
	const safeThemeFolder = getSafePackageFolderName(themeFolder);
	if (!safeThemeFolder) return [];
	return collectPackageFiles(manager, getThemeDir(manager, safeThemeFolder));
};

const hasPluginFileBundle = (plugin: ManagerTransferPlugin): boolean => {
	return Array.isArray(plugin.files) && plugin.files.length > 0;
};

const hasThemeFileBundle = (theme: ManagerTransferTheme): boolean => {
	return Array.isArray(theme.files) && theme.files.length > 0;
};

const validatePluginFileBundle = (plugin: ManagerTransferPlugin): void => {
	const manifestFile = (plugin.files || []).find((file) => normalizePackageRelativePath(file.path).toLowerCase() === "manifest.json");
	const mainFile = (plugin.files || []).find((file) => normalizePackageRelativePath(file.path).toLowerCase() === "main.js");
	if (!manifestFile || !mainFile) {
		throw new Error("Plugin package must include manifest.json and main.js.");
	}

	const manifest = JSON.parse(decodeBase64Text(manifestFile.data)) as { id?: string };
	if (manifest.id && manifest.id !== plugin.id) {
		throw new Error(`Plugin id mismatch: package entry ${plugin.id}, manifest ${manifest.id}.`);
	}
};

const writePluginFileBundle = async (manager: Manager, plugin: ManagerTransferPlugin): Promise<void> => {
	const pluginId = getSafePluginId(plugin.id);
	if (!pluginId) throw new Error("Unsafe plugin id.");

	const files = plugin.files || [];
	if (files.length === 0) throw new Error("Plugin package does not include files.");
	validatePluginFileBundle(plugin);

	const adapter = manager.app.vault.adapter;
	const pluginDir = getPluginDir(manager, pluginId);
	await ensureFolderExists(manager, pluginDir);

	for (const file of files) {
		if (file.encoding !== "base64") throw new Error(`Unsupported file encoding: ${toText(file.encoding, "unknown")}`);
		const relativePath = normalizePackageRelativePath(file.path);
		if (!relativePath) throw new Error(`Unsafe plugin file path: ${file.path}`);
		const targetPath = normalizePath(`${pluginDir}/${relativePath}`);
		if (!targetPath.startsWith(`${pluginDir}/`)) throw new Error(`Unsafe plugin file path: ${file.path}`);
		await ensureParentFolderExists(manager, targetPath);
		await adapter.writeBinary(targetPath, base64ToArrayBuffer(file.data));
	}
};

const writePluginConfigFile = async (
	manager: Manager,
	config: ManagerTransferPluginConfig
): Promise<void> => {
	const pluginId = getSafePluginId(config.id);
	if (!pluginId) throw new Error("Unsafe plugin id.");
	if (config.encoding !== "base64") throw new Error(`Unsupported file encoding: ${toText(config.encoding, "unknown")}`);
	if (normalizePackageRelativePath(config.path).toLowerCase() !== "data.json") {
		throw new Error(`Unsupported config file path: ${config.path}`);
	}
	if (!manager.appPlugins.manifests[pluginId]) {
		throw new Error("Plugin is not installed.");
	}

	const adapter = manager.app.vault.adapter;
	const pluginDir = getPluginDir(manager, pluginId);
	const targetPath = getPluginConfigPath(manager, pluginId);
	await ensureFolderExists(manager, pluginDir);
	await adapter.writeBinary(targetPath, base64ToArrayBuffer(config.data));
};

const validateThemeFileBundle = (theme: ManagerTransferTheme): void => {
	const manifestFile = (theme.files || []).find((file) => normalizePackageRelativePath(file.path).toLowerCase() === "manifest.json");
	const themeCssFile = (theme.files || []).find((file) => normalizePackageRelativePath(file.path).toLowerCase() === "theme.css");
	if (!manifestFile || !themeCssFile) {
		throw new Error("Theme package must include manifest.json and theme.css.");
	}

	const manifest = JSON.parse(decodeBase64Text(manifestFile.data)) as { name?: string };
	if (manifest.name && manifest.name !== theme.name) {
		throw new Error(`Theme name mismatch: package entry ${theme.name}, manifest ${manifest.name}.`);
	}
};

const writeThemeFileBundle = async (manager: Manager, theme: ManagerTransferTheme): Promise<void> => {
	const themeFolder = getSafePackageFolderName(theme.name);
	if (!themeFolder) throw new Error("Unsafe theme name.");

	const files = theme.files || [];
	if (files.length === 0) throw new Error("Theme package does not include files.");
	validateThemeFileBundle(theme);

	const adapter = manager.app.vault.adapter;
	const themeDir = getThemeDir(manager, themeFolder);
	await ensureFolderExists(manager, themeDir);

	for (const file of files) {
		if (file.encoding !== "base64") throw new Error(`Unsupported file encoding: ${toText(file.encoding, "unknown")}`);
		const relativePath = normalizePackageRelativePath(file.path);
		if (!relativePath) throw new Error(`Unsafe theme file path: ${file.path}`);
		const targetPath = normalizePath(`${themeDir}/${relativePath}`);
		if (!targetPath.startsWith(`${themeDir}/`)) throw new Error(`Unsafe theme file path: ${file.path}`);
		await ensureParentFolderExists(manager, targetPath);
		await adapter.writeBinary(targetPath, base64ToArrayBuffer(file.data));
	}
};

const getInstalledThemeNames = async (manager: Manager): Promise<Set<string>> => {
	const names = new Set<string>();
	const adapter = manager.app.vault.adapter;
	const themesDir = normalizePath(`${manager.app.vault.configDir}/themes`);
	if (!(await adapter.exists(themesDir))) return names;

	try {
		const listed = await adapter.list(themesDir);
		for (const folder of listed.folders || []) {
			const folderName = folder.split("/").pop() || folder;
			names.add(folderName);
			const manifest = await readJsonIfExists<ThemeManifestJson>(manager, normalizePath(`${folder}/manifest.json`));
			if (manifest?.name) names.add(manifest.name);
		}
	} catch {
		return names;
	}

	return names;
};

export const collectInstalledThemes = async (
	manager: Manager,
	selectedThemeNames?: Set<string>,
	includeFiles = false,
	includeSource = false
): Promise<ManagerTransferTheme[]> => {
	const adapter = manager.app.vault.adapter;
	const themesDir = normalizePath(`${manager.app.vault.configDir}/themes`);
	const activeTheme = getActiveThemeName(manager);
	const themes: ManagerTransferTheme[] = [];
	const sources = (manager.settings.BETA_SOURCES || []).filter((source) => source.type === "theme");
	const usedSources = new Set<BetaSource>();

	if (await adapter.exists(themesDir)) {
		try {
			const listed = await adapter.list(themesDir);
			for (const folder of listed.folders || []) {
				const folderName = folder.split("/").pop() || folder;
				const manifest = await readJsonIfExists<ThemeManifestJson>(manager, normalizePath(`${folder}/manifest.json`));
				const name = manifest?.name || folderName;
				let source = sources.find((item) => item.id === name || item.id === folderName);
				if (!source && manifest?.version) {
					const versionMatches = sources.filter((item) =>
						!usedSources.has(item) &&
						(item.localVersion === manifest.version || item.latestVersion === manifest.version)
					);
					if (versionMatches.length === 1) source = versionMatches[0];
				}
				if (source) usedSources.add(source);
				const repo = cleanRepo(source?.repo);
				if (selectedThemeNames && !selectedThemeNames.has(name) && !selectedThemeNames.has(folderName)) continue;
				const files = includeFiles ? await collectThemeFiles(manager, folderName) : [];
				const fileBytes = files.reduce((sum, file) => sum + file.size, 0);
				themes.push({
					name,
					version: manifest?.version || source?.localVersion || source?.latestVersion,
					author: manifest?.author,
					repo: repo || undefined,
					downloadUrl: repo ? `https://github.com/${repo}` : undefined,
					active: activeTheme === name || activeTheme === folderName,
					installed: true,
					...(includeFiles ? {
						files,
						fileCount: files.length,
						fileBytes,
					} : {}),
					source: includeSource && source ? {
						mode: source.mode,
						frozenVersion: source.frozenVersion,
						includePrerelease: source.includePrerelease,
						updateCheckMode: source.updateCheckMode,
						updateDelayDays: source.updateDelayDays,
						autoUpdate: source.autoUpdate,
						localVersion: source.localVersion,
						latestVersion: source.latestVersion,
						latestPublishedAt: source.latestPublishedAt,
						installedReleaseTag: source.installedReleaseTag,
						installedReleasePublishedAt: source.installedReleasePublishedAt,
						latestReleaseTag: source.latestReleaseTag,
						latestReleasePublishedAt: source.latestReleasePublishedAt,
						installedAt: source.installedAt,
					} : undefined,
				});
			}
		} catch {
			// Theme export should not fail just because the theme directory cannot be listed.
		}
	}

	return themes.sort((a, b) => a.name.localeCompare(b.name));
};

const resolvePluginRepo = async (manager: Manager, pluginId: string): Promise<string> => {
	const mapped = cleanRepo(manager.settings.REPO_MAP?.[pluginId]);
	if (mapped) return mapped;

	try {
		return cleanRepo(await manager.repoResolver.resolveRepo(pluginId) || "");
	} catch {
		return "";
	}
};

const buildTransferPlugin = async (
	manager: Manager,
	record: ManagerPlugin,
	manifest: PluginManifest,
	includeSource = false
): Promise<ManagerTransferPlugin> => {
	const repo = await resolvePluginRepo(manager, record.id);
	const source = includeSource ? (manager.settings.BETA_SOURCES || []).find((item) => {
		if (item.type !== "plugin") return false;
		if (item.id === record.id) return true;
		return repo && cleanRepo(item.repo) === repo;
	}) : undefined;
	const pluginUrl = `https://obsidian.md/plugins?id=${encodeURIComponent(record.id)}`;

	return {
		id: record.id,
		name: record.name || manifest.name || record.id,
		version: manifest.version || source?.localVersion || "",
		author: manifest.author,
		repo: repo || undefined,
		pluginUrl,
		downloadUrl: repo ? `https://github.com/${repo}` : pluginUrl,
		source: source ? {
			mode: source.mode,
			frozenVersion: source.frozenVersion,
			includePrerelease: source.includePrerelease,
			updateCheckMode: source.updateCheckMode,
			updateDelayDays: source.updateDelayDays,
			autoUpdate: source.autoUpdate,
			localVersion: source.localVersion,
			latestVersion: source.latestVersion,
			latestPublishedAt: source.latestPublishedAt,
			installedReleaseTag: source.installedReleaseTag,
			installedReleasePublishedAt: source.installedReleasePublishedAt,
			latestReleaseTag: source.latestReleaseTag,
			latestReleasePublishedAt: source.latestReleasePublishedAt,
			installedAt: source.installedAt,
		} : undefined,
	};
};

export const buildManagerTransferPackage = async (
	manager: Manager,
	options: ManagerTransferBuildOptions,
	onProgress?: ManagerTransferProgress
): Promise<ManagerTransferPackage> => {
	const selectedPluginIds = options.selectedPluginIds ? new Set(options.selectedPluginIds) : undefined;
	const selectedThemeNames = options.selectedThemeNames ? new Set(options.selectedThemeNames) : undefined;
	const selectedPluginConfigIds = options.selectedPluginConfigIds ? new Set(options.selectedPluginConfigIds) : undefined;
	const manifests = Object.values(manager.appPlugins.manifests);
	const records = manifests
		.filter((manifest) => manifest.id !== manager.manifest.id)
		.filter((manifest) => !selectedPluginIds || selectedPluginIds.has(manifest.id))
		.map((manifest) => ({
			manifest,
			record: manager.settings.Plugins.find((record) => record.id === manifest.id) || {
				id: manifest.id,
				name: manifest.name || manifest.id,
				desc: manifest.description || "",
				group: "",
				tags: [],
				enabled: manager.appPlugins.enabledPlugins.has(manifest.id),
				delay: "",
				note: "",
			},
		}));
	const configManifests = manifests
		.filter((manifest) => manifest.id !== manager.manifest.id)
		.filter((manifest) => !selectedPluginConfigIds || selectedPluginConfigIds.has(manifest.id));
	const total = Math.max(1,
		(options.plugins ? records.length : 0)
		+ (options.pluginConfigs ? configManifests.length : 0)
		+ (options.themes ? 1 : 0)
	);
	let processed = 0;

	const plugins: ManagerTransferPlugin[] = [];
	if (options.plugins) {
		for (const { record, manifest } of records) {
			plugins.push(await buildTransferPlugin(manager, record, manifest, Boolean(options.sources)));
			processed++;
			onProgress?.(processed, total, record.name || record.id);
		}
	}

	const pluginConfigs: ManagerTransferPluginConfig[] = [];
	if (options.pluginConfigs) {
		for (const manifest of configManifests) {
			const config = await collectPluginConfig(manager, manifest);
			if (config) pluginConfigs.push(config);
			processed++;
			onProgress?.(processed, total, manifest.name || manifest.id);
		}
	}

	const themes = options.themes ? await collectInstalledThemes(manager, selectedThemeNames, false, Boolean(options.sources)) : [];
	if (options.themes) {
		processed++;
		onProgress?.(processed, total, "themes");
	}

	const exportedPluginIds = new Set(plugins.map((plugin) => plugin.id));
	const exportedPluginRepos = new Set(plugins.map((plugin) => cleanRepo(plugin.repo)).filter(Boolean));
	const exportedThemeNames = new Set(themes.map((theme) => theme.name));
	const exportedThemeRepos = new Set(themes.map((theme) => cleanRepo(theme.repo)).filter(Boolean));
	const sourceBelongsToPackage = (source: BetaSource): boolean => {
		const repo = cleanRepo(source.repo);
		if (source.type === "plugin") {
			return exportedPluginIds.has(source.id) || Boolean(repo && exportedPluginRepos.has(repo));
		}
		return exportedThemeNames.has(source.id) || Boolean(repo && exportedThemeRepos.has(repo));
	};
	const sourceRepos = new Set<string>();
	const sources = options.sources ? cloneJson((manager.settings.BETA_SOURCES || []).filter((source) => {
		const belongs = sourceBelongsToPackage(source);
		if (belongs) {
			const repo = cleanRepo(source.repo);
			if (repo) sourceRepos.add(`${source.type}:${repo}`);
		}
		return belongs;
	})) : [];
	const pluginLayout = options.layout ? cloneJson((manager.settings.PLUGIN_LAYOUT || [])
		.filter((item) => item.type === "separator" || (item.id !== manager.manifest.id && exportedPluginIds.has(item.id)))) : [];
	const hiddenPlugins = options.layout ? (manager.settings.HIDES || [])
		.filter((id) => id !== manager.manifest.id && exportedPluginIds.has(id)) : [];
	const ribbonSettings = options.layout ? cloneJson(manager.settings.RIBBON_SETTINGS || []) : [];
	const ribbonGroups = options.layout ? cloneJson(manager.settings.RIBBON_GROUPS || []) : [];
	const groups = options.taxonomy ? cloneJson(manager.settings.GROUPS || []) : [];
	const tags = options.taxonomy ? cloneJson(manager.settings.TAGS || []) : [];
	const delays = options.taxonomy ? cloneJson(manager.settings.DELAYS || []) : [];
	const repoMap = options.sources || options.plugins
		? Object.fromEntries(Object.entries(manager.settings.REPO_MAP || {})
			.filter(([pluginId]) => exportedPluginIds.has(pluginId)))
		: {};
	const bpmInstalled = options.sources || options.plugins
		? (manager.settings.BPM_INSTALLED || []).filter((id) => exportedPluginIds.has(id))
		: [];
	const installHistory = options.sources ? cloneJson((manager.settings.INSTALL_HISTORY || []).filter((item) => {
		const repo = cleanRepo(item.repo);
		return Boolean(repo && sourceRepos.has(`${item.type}:${repo}`));
	})) : [];
	const workspaceSettings = options.workspaceSettings ? {
		persistence: Boolean(manager.settings.PERSISTENCE),
		delayMode: Boolean(manager.settings.DELAY),
		hideBpmTag: Boolean(manager.settings.HIDE_BPM_TAG),
		startupCheckUpdates: Boolean(manager.settings.STARTUP_CHECK_UPDATES),
		pluginOverviewLayout: manager.settings.PLUGIN_OVERVIEW_LAYOUT,
		itemStyle: manager.settings.ITEM_STYLE,
		groupStyle: manager.settings.GROUP_STYLE,
		tagStyle: manager.settings.TAG_STYLE,
		fadeOutDisabledPlugins: Boolean(manager.settings.FADE_OUT_DISABLED_PLUGINS),
	} : undefined;

	return {
		schema: MANAGER_TRANSFER_SCHEMA,
		version: 1,
		exportedAt: new Date().toISOString(),
		generator: {
			id: manager.manifest.id,
			name: manager.manifest.name,
			version: manager.manifest.version,
		},
		counts: {
			plugins: plugins.length,
			themes: themes.length,
			pluginConfigs: pluginConfigs.length,
			groups: groups.length,
			tags: tags.length,
			delays: delays.length,
			sources: sources.length,
			ribbonItems: ribbonSettings.length,
			layoutItems: pluginLayout.length,
		},
		options: cloneJson(options),
		data: {
			plugins,
			themes,
			pluginConfigs,
			groups,
			tags,
			delays,
			repoMap,
			bpmInstalled,
			betaSources: sources,
			installHistory,
			pluginLayout,
			hiddenPlugins,
			ribbonSettings,
			ribbonGroups,
			workspaceSettings,
		},
	};
};

export const parseManagerTransferPackage = (raw: string): ManagerTransferPackage => {
	const parsed = JSON.parse(raw) as ManagerTransferPackage;
	if (!parsed || parsed.schema !== MANAGER_TRANSFER_SCHEMA || parsed.version !== 1 || !parsed.data) {
		throw new Error("Unsupported Obsidian plugin transfer package.");
	}
	return parsed;
};

export const createManagerTransferPreview = async (
	manager: Manager,
	transferPackage: ManagerTransferPackage
): Promise<ManagerTransferPreview> => {
	const manifests = manager.appPlugins.manifests as Record<string, PluginManifest | undefined>;
	const installedThemes = await getInstalledThemeNames(manager);
	const plugins = transferPackage.data.plugins || [];
	const themes = transferPackage.data.themes || [];
	const pluginConfigs = transferPackage.data.pluginConfigs || [];
	const pluginInstalled = plugins.filter((plugin) => Boolean(manifests[plugin.id])).length;
	const pluginsBundled = plugins.filter((plugin) => hasPluginFileBundle(plugin)).length;
	const pluginInstallable = plugins.filter((plugin) =>
		!manifests[plugin.id] && (hasPluginFileBundle(plugin) || Boolean(plugin.repo))
	).length;
	const themeInstalled = themes.filter((theme) => installedThemes.has(theme.name)).length;
	const themesBundled = themes.filter((theme) => hasThemeFileBundle(theme)).length;
	const themeInstallable = themes.filter((theme) =>
		!installedThemes.has(theme.name) && (hasThemeFileBundle(theme) || Boolean(theme.repo))
	).length;

	return {
		pluginsTotal: plugins.length,
		pluginsInstalled: pluginInstalled,
		pluginsMissing: Math.max(0, plugins.length - pluginInstalled),
		pluginsInstallable: pluginInstallable,
		pluginsBundled,
		pluginsWithoutRepo: plugins.filter((plugin) => !manifests[plugin.id] && !hasPluginFileBundle(plugin) && !plugin.repo).length,
		themesTotal: themes.length,
		themesInstalled: themeInstalled,
		themesMissing: Math.max(0, themes.length - themeInstalled),
		themesInstallable: themeInstallable,
		themesBundled,
		themesWithoutRepo: themes.filter((theme) => !installedThemes.has(theme.name) && !hasThemeFileBundle(theme) && !theme.repo).length,
		pluginConfigs: pluginConfigs.length,
		groups: (transferPackage.data.groups || []).length,
		tags: (transferPackage.data.tags || []).length,
		delays: (transferPackage.data.delays || []).length,
		sources: (transferPackage.data.betaSources || []).length,
		layoutItems: (transferPackage.data.pluginLayout || []).length,
		ribbonItems: (transferPackage.data.ribbonSettings || []).length,
		exportedAt: transferPackage.exportedAt,
		generatorName: transferPackage.generator.name,
		generatorVersion: transferPackage.generator.version,
	};
};

const mergeById = <T extends { id: string }>(target: T[], incoming: T[]): void => {
	const map = new Map(target.map((item) => [item.id, item]));
	for (const item of incoming) {
		const existing = map.get(item.id);
		if (existing) {
			Object.assign(existing, cloneJson(item));
		} else {
			target.push(cloneJson(item));
		}
	}
};

const mergeSources = (manager: Manager, incoming: BetaSource[]): void => {
	if (!Array.isArray(manager.settings.BETA_SOURCES)) manager.settings.BETA_SOURCES = [];
	const target = manager.settings.BETA_SOURCES;
	const map = new Map(target.map((source) => [getSourceKey(source), source]));
	for (const source of incoming) {
		const cloned = cloneJson(source);
		cloned.repo = cleanRepo(cloned.repo) || cloned.repo;
		const key = getSourceKey(cloned);
		const existing = map.get(key);
		if (existing) {
			Object.assign(existing, cloned);
		} else {
			target.push(cloned);
			map.set(key, cloned);
		}
	}
};

const mergeInstallHistory = (manager: Manager, incoming: InstallHistoryItem[]): void => {
	if (!Array.isArray(manager.settings.INSTALL_HISTORY)) manager.settings.INSTALL_HISTORY = [];
	const existing = manager.settings.INSTALL_HISTORY;
	const seen = new Set(existing.map((item) => `${item.type}:${cleanRepo(item.repo)}:${item.version || ""}`));
	for (const item of incoming) {
		const key = `${item.type}:${cleanRepo(item.repo)}:${item.version || ""}`;
		if (seen.has(key)) continue;
		existing.push(cloneJson(item));
		seen.add(key);
	}
};

const upsertPluginRecord = (
	manager: Manager,
	plugin: ManagerTransferPlugin,
	manifest?: PluginManifest,
	applyMetadata = true
): ManagerPlugin => {
	let record = manager.settings.Plugins.find((item) => item.id === plugin.id);
	if (!record) {
		record = {
			id: plugin.id,
			name: manifest?.name || plugin.name || plugin.id,
			desc: manifest?.description || plugin.description || plugin.customDescription || "",
			group: "",
			tags: [],
			enabled: Boolean(plugin.enabled),
			delay: "",
			note: "",
		};
		manager.settings.Plugins.push(record);
	}

	record.name = manifest?.name || plugin.name || record.name;
	if (applyMetadata) {
		record.desc = plugin.customDescription || plugin.description || record.desc;
		record.group = plugin.group || "";
		record.tags = [...(plugin.tags || [])];
		record.delay = plugin.delay || "";
		record.note = plugin.note || "";
	}
	return record;
};

const getPackageVersionForInstall = (
	versionStrategy: ManagerTransferVersionStrategy,
	version?: string,
	source?: { frozenVersion?: string }
): string | undefined => {
	if (versionStrategy !== "package") return undefined;
	return source?.frozenVersion || version || undefined;
};

const setPluginEnabled = async (manager: Manager, pluginId: string, enabled: boolean): Promise<void> => {
	if (pluginId === manager.manifest.id) return;
	if (enabled) {
		await manager.appPlugins.enablePluginAndSave(pluginId);
	} else {
		await manager.appPlugins.disablePluginAndSave(pluginId);
	}
};

export const applyManagerTransferPackage = async (
	manager: Manager,
	transferPackage: ManagerTransferPackage,
	options: ManagerTransferImportOptions,
	onProgress?: ManagerTransferProgress
): Promise<ManagerTransferImportResult> => {
	const result: ManagerTransferImportResult = {
		installedPlugins: 0,
		updatedPlugins: 0,
		skippedPlugins: 0,
		failedPlugins: [],
		installedThemes: 0,
		updatedThemes: 0,
		skippedThemes: 0,
		failedThemes: [],
		appliedPluginConfigs: 0,
		skippedPluginConfigs: 0,
		failedPluginConfigs: [],
		settingsMerged: false,
		layoutMerged: false,
		sourcesMerged: false,
	};
	const plugins = transferPackage.data.plugins || [];
	const themes = transferPackage.data.themes || [];
	const pluginConfigs = transferPackage.data.pluginConfigs || [];
	const selectedPluginConfigIds = options.selectedPluginConfigIds ? new Set(options.selectedPluginConfigIds) : undefined;
	const importPluginConfigs = pluginConfigs.filter((config) => !selectedPluginConfigIds || selectedPluginConfigIds.has(config.id));
	const total = Math.max(1, plugins.length + themes.length + (options.applyPluginConfigs ? importPluginConfigs.length : 0) + 3);
	let processed = 0;
	const tick = (current?: string) => {
		processed++;
		onProgress?.(processed, total, current);
	};

	if (options.applyWorkspaceSettings && transferPackage.data.workspaceSettings) {
		const workspace = transferPackage.data.workspaceSettings;
		manager.settings.PERSISTENCE = workspace.persistence;
		manager.settings.DELAY = workspace.delayMode;
		manager.settings.HIDE_BPM_TAG = workspace.hideBpmTag;
		manager.settings.STARTUP_CHECK_UPDATES = workspace.startupCheckUpdates;
		manager.settings.PLUGIN_OVERVIEW_LAYOUT = workspace.pluginOverviewLayout === "two-column"
			? workspace.pluginOverviewLayout
			: "list";
		manager.settings.ITEM_STYLE = workspace.itemStyle || manager.settings.ITEM_STYLE;
		manager.settings.GROUP_STYLE = workspace.groupStyle || manager.settings.GROUP_STYLE;
		manager.settings.TAG_STYLE = workspace.tagStyle || manager.settings.TAG_STYLE;
		manager.settings.FADE_OUT_DISABLED_PLUGINS = workspace.fadeOutDisabledPlugins;
		result.settingsMerged = true;
	}
	tick("settings");

	if (options.applyPluginMetadata) {
		mergeById(manager.settings.GROUPS, transferPackage.data.groups || []);
		mergeById(manager.settings.TAGS, transferPackage.data.tags || []);
		mergeById(manager.settings.DELAYS, transferPackage.data.delays || []);
		result.settingsMerged = true;
	}

	if (options.applyLayout) {
		manager.settings.PLUGIN_LAYOUT = cloneJson(transferPackage.data.pluginLayout || []);
		manager.settings.HIDES = [...(transferPackage.data.hiddenPlugins || [])];
		manager.settings.RIBBON_SETTINGS = cloneJson(transferPackage.data.ribbonSettings || []);
		manager.settings.RIBBON_GROUPS = normalizeRibbonGroups(transferPackage.data.ribbonGroups);
		result.layoutMerged = true;
	}
	tick("layout");

	if (options.applySources) {
		manager.settings.REPO_MAP = { ...(manager.settings.REPO_MAP || {}), ...(transferPackage.data.repoMap || {}) };
		manager.settings.BPM_INSTALLED = Array.from(new Set([
			...(manager.settings.BPM_INSTALLED || []),
			...(transferPackage.data.bpmInstalled || []),
		]));
		mergeSources(manager, transferPackage.data.betaSources || []);
		mergeInstallHistory(manager, transferPackage.data.installHistory || []);
		result.sourcesMerged = true;
	}
	tick("sources");

	for (const plugin of plugins) {
		if (plugin.id === manager.manifest.id) {
			result.skippedPlugins++;
			tick(plugin.name || plugin.id);
			continue;
		}

		const repo = cleanRepo(plugin.repo);
		const wasInstalled = Boolean(manager.appPlugins.manifests[plugin.id]);
		const wasEnabled = manager.appPlugins.enabledPlugins.has(plugin.id);
		let installed = wasInstalled;
		let restoredFromBundle = false;

		if (!installed && hasPluginFileBundle(plugin) && !options.installMissing) {
			result.skippedPlugins++;
			tick(plugin.name || plugin.id);
			continue;
		}

		if (hasPluginFileBundle(plugin)) {
			try {
				if (wasEnabled) {
					try {
						await manager.appPlugins.disablePlugin(plugin.id);
					} catch {
						// The plugin may not currently be loaded even if Obsidian remembers it as enabled.
					}
				}
				await writePluginFileBundle(manager, plugin);
				await manager.appPlugins.loadManifests();
				installed = Boolean(manager.appPlugins.manifests[plugin.id]);
				if (!installed) throw new Error("Plugin files were written, but Obsidian did not load the manifest.");
				restoredFromBundle = true;
				if (!wasInstalled) result.installedPlugins++;
			} catch (error) {
				if (wasEnabled) {
					try {
						await manager.appPlugins.enablePlugin(plugin.id);
					} catch {
						// Best-effort runtime restore only.
					}
				}
				result.failedPlugins.push({
					id: plugin.id,
					name: plugin.name,
					reason: (error as Error)?.message || "Failed to restore plugin files from package.",
				});
				tick(plugin.name || plugin.id);
				continue;
			}
		} else if (!installed && options.installMissing && repo) {
			const version = getPackageVersionForInstall(options.installVersionStrategy, plugin.version, plugin.source);
			const ok = await installPluginFromGithub(manager, repo, version, options.applySources && plugin.installedViaBpm, plugin.id);
			await manager.appPlugins.loadManifests();
			installed = Boolean(manager.appPlugins.manifests[plugin.id]);
			if (ok && installed) {
				result.installedPlugins++;
				if (!options.applyEnabledState) {
					try {
						await manager.appPlugins.disablePluginAndSave(plugin.id);
					} catch {
						// Keep import moving; record.enabled is synced below from runtime state.
					}
				}
			} else {
				result.failedPlugins.push({
					id: plugin.id,
					name: plugin.name,
					reason: "Download completed but the expected plugin id was not found.",
				});
				tick(plugin.name || plugin.id);
				continue;
			}
		}

		if (!installed) {
			result.skippedPlugins++;
			if (!repo) {
				result.failedPlugins.push({
					id: plugin.id,
					name: plugin.name,
					reason: "Missing repository information.",
				});
			}
			tick(plugin.name || plugin.id);
			continue;
		}

		if (restoredFromBundle && !options.applyEnabledState && wasEnabled) {
			try {
				await manager.appPlugins.enablePlugin(plugin.id);
			} catch (error) {
				result.failedPlugins.push({
					id: plugin.id,
					name: plugin.name,
					reason: (error as Error)?.message || "Failed to reload plugin after restoring files.",
				});
			}
		}

		if (repo && options.applySources) await manager.repoResolver.setRepo(plugin.id, repo);
		const manifest = manager.appPlugins.manifests[plugin.id] as PluginManifest | undefined;
		const record = upsertPluginRecord(manager, plugin, manifest, options.applyPluginMetadata);
		if (!options.applyEnabledState) {
			record.enabled = manager.appPlugins.enabledPlugins.has(plugin.id);
		}
		if (options.applySources && plugin.installedViaBpm && !manager.settings.BPM_INSTALLED.includes(plugin.id)) {
			manager.settings.BPM_INSTALLED.push(plugin.id);
		}

		if (options.applyEnabledState) {
			record.enabled = Boolean(plugin.enabled);
			try {
				await setPluginEnabled(manager, plugin.id, Boolean(plugin.enabled));
			} catch (error) {
				result.failedPlugins.push({
					id: plugin.id,
					name: plugin.name,
					reason: (error as Error)?.message || "Failed to apply enabled state.",
				});
			}
		}

		if (wasInstalled) result.updatedPlugins++;
		tick(plugin.name || plugin.id);
	}

	if (options.applyThemes) {
		let installedThemes = await getInstalledThemeNames(manager);
		for (const theme of themes) {
			const repo = cleanRepo(theme.repo);
			const wasInstalled = installedThemes.has(theme.name);
			let installed = wasInstalled;

			if (!installed && hasThemeFileBundle(theme) && !options.installMissing) {
				result.skippedThemes++;
				tick(theme.name);
				continue;
			}

			if (hasThemeFileBundle(theme)) {
				try {
					await writeThemeFileBundle(manager, theme);
					installedThemes = await getInstalledThemeNames(manager);
					installed = installedThemes.has(theme.name);
					if (!installed) throw new Error("Theme files were written, but Obsidian did not load the theme manifest.");
					if (!wasInstalled) result.installedThemes++;
				} catch (error) {
					result.failedThemes.push({
						id: theme.name,
						name: theme.name,
						reason: (error as Error)?.message || "Failed to restore theme files from package.",
					});
					tick(theme.name);
					continue;
				}
			} else if (!installed && options.installMissing && repo) {
				const version = getPackageVersionForInstall(options.installVersionStrategy, theme.version, theme.source);
				const ok = await installThemeFromGithub(manager, repo, version);
				installedThemes = await getInstalledThemeNames(manager);
				installed = ok || installedThemes.has(theme.name);
				if (ok) {
					result.installedThemes++;
				}
			}

			if (!installed) {
				result.skippedThemes++;
				if (!repo) {
					result.failedThemes.push({
						id: theme.name,
						name: theme.name,
						reason: "Missing repository information.",
					});
				}
				tick(theme.name);
				continue;
			}

			if (repo && options.applySources) {
				mergeSources(manager, [{
					id: theme.name,
					repo,
					type: "theme",
					mode: theme.source?.mode || "latest",
					frozenVersion: theme.source?.frozenVersion,
					includePrerelease: theme.source?.includePrerelease,
					updateCheckMode: theme.source?.updateCheckMode,
					updateDelayDays: theme.source?.updateDelayDays,
					autoUpdate: Boolean(theme.source?.autoUpdate),
					enabled: true,
					localVersion: theme.source?.localVersion || theme.version,
					latestVersion: theme.source?.latestVersion || theme.version,
					latestPublishedAt: theme.source?.latestPublishedAt,
					installedReleaseTag: theme.source?.installedReleaseTag,
					installedReleasePublishedAt: theme.source?.installedReleasePublishedAt,
					latestReleaseTag: theme.source?.latestReleaseTag,
					latestReleasePublishedAt: theme.source?.latestReleasePublishedAt,
					installedAt: theme.source?.installedAt,
					lastChecked: Date.now(),
				}]);
			}

			if (theme.active && options.applyActiveTheme) {
				// customCss is an internal Obsidian API, so keep it optional.
				(manager.app as unknown as { customCss?: { setTheme?: (name: string) => void } }).customCss?.setTheme?.(theme.name);
			}

			if (wasInstalled) result.updatedThemes++;
			tick(theme.name);
		}
	}

	if (options.applyPluginConfigs) {
		for (const config of importPluginConfigs) {
			if (config.id === manager.manifest.id) {
				result.skippedPluginConfigs++;
				tick(config.name || config.id);
				continue;
			}

			const wasEnabled = manager.appPlugins.enabledPlugins.has(config.id);
			try {
				if (wasEnabled) {
					try {
						await manager.appPlugins.disablePlugin(config.id);
					} catch {
						// Keep import moving; the file write below is still safe.
					}
				}
				await writePluginConfigFile(manager, config);
				if (wasEnabled) {
					try {
						await manager.appPlugins.enablePlugin(config.id);
					} catch (error) {
						throw new Error((error as Error)?.message || "Config was written, but the plugin could not be reloaded.");
					}
				}
				result.appliedPluginConfigs++;
			} catch (error) {
				if (wasEnabled) {
					try {
						await manager.appPlugins.enablePlugin(config.id);
					} catch {
						// Best-effort runtime restore only.
					}
				}
				result.failedPluginConfigs.push({
					id: config.id,
					name: config.name,
					reason: (error as Error)?.message || "Failed to import plugin config.",
				});
			}
			tick(config.name || config.id);
		}
	}

	await manager.saveSettings();
	// 导入过程会批量启停插件，收尾统一走唯一应用入口（登记新图标 + 写入原生状态）
	manager.applyRibbonSettings();
	return result;
};
