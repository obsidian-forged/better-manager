export interface ManagerPlugin {
	id: string;
	name: string;
	desc: string;
	group: string;
	tags: string[];
	enabled: boolean;
	delay: string;
	note: string;
}

export interface Type {
	id: string;
	name: string;
	color: string;
}

export interface Tag {
	id: string;
	name: string;
	color: string;
}

// 已知的特殊 Tag
export const BPM_TAG_ID = "bpm-install"; // BPM 安装标识
export const BPM_IGNORE_TAG = "bpm-ignore"; // BPM 忽略标识
export const EONDR_PLUGIN_TAG_ID = "bpm-eondr-plugin"; // Eondr 自有插件标识

export interface Delay {

	id: string;
	name: string;
	time: number;
}

export interface RibbonItem {
	bpmUniqueId: string; // 唯一标识符
	name: string;
	icon: string;
	visible: boolean;
	order: number;
	ribbonIdMap?: {
		en?: string;
		zh?: string;
	};
}

/** Ribbon group stored with a device preset / 随设备预设保存的 Ribbon 分组。 */
export interface RibbonGroup {
	id: string;
	name: string;
	icon: string;
	members: string[];
	/** 组内独立排序号；不修改成员原本的 RibbonItem.order。 */
	memberOrders?: Record<string, number>;
}

export interface PluginLayoutItem {
	id: string;
	type: "plugin" | "separator";
	title?: string;
}

export type ReleaseCompatibilityMode = "compatible" | "all";

export interface BetaSource {
    updatePolicyReason?: string;
    latestManifestVersion?: string;
	id: string;
	repo: string;
	type: "plugin" | "theme";
	mode: "latest" | "frozen";
	frozenVersion?: string;
	includePrerelease?: boolean;
	updateCheckMode?: "release" | "version";
	compatibilityMode?: ReleaseCompatibilityMode;
	updateDelayDays?: number;
	autoUpdate: boolean;
	enabled: boolean;
	localVersion?: string;
	latestVersion?: string;
	latestPublishedAt?: string;
	installedReleaseTag?: string;
	installedReleasePublishedAt?: string;
	installedReleaseIsGithubLatest?: boolean;
	latestReleaseTag?: string;
	latestReleasePublishedAt?: string;
	latestReleaseIsGithubLatest?: boolean;
	deferredPublicationDate?: boolean;
	installedAt?: number;
	lastChecked?: number;
	error?: string;
}

export interface InstallHistoryItem {
	repo: string;
	type: "plugin" | "theme";
	version?: string;
	trackSource?: boolean;
	usedAt?: number;
}

export interface SharedVaultEntry {
	id: string;
	name: string;
	path: string;
	pluginsLinked?: boolean;
	themesLinked?: boolean;
	createdAt: number;
	lastSeenAt?: number;
}
