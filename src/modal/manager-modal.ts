import { FloatingScrollbars } from '../ui/floating-scrollbars';
import { TaskCenterView } from '../ui/task-center-view';
import { isToolInPage, ToolScope } from '../ui/tool-visibility';
import { featureEnabled, toolEnabled, FeatureId, ToolId } from '../features';
import { DevicePanel } from '../devices/device-panel';
import { CatalogModal } from '../catalog/catalog-modal';
import { createBpmFilterField, createBpmFilterSelectField } from '../ui/filter-field';
import { ScopeSelect } from '../ui/scope-select';
import { ResponsiveToolbar } from '../ui/responsive-toolbar';
import { DeviceScopeBar } from '../devices/device-scope-bar';
import type { DevicePluginFilters, ScopePage } from '../devices/device-presets';
import {
    App,
    ButtonComponent,
    DropdownComponent,
    ExtraButtonComponent,
    Menu,
    MenuItem,
    Modal,
    Notice,
    PluginManifest,
    SearchComponent,
    setIcon, 
    Setting,
    TextComponent,
    ToggleComponent,
    Platform,
} from "obsidian";

import { BetaSource, BPM_IGNORE_TAG, EONDR_PLUGIN_TAG_ID, InstallHistoryItem, ManagerPlugin, PluginLayoutItem } from "../data/types";
import { AppearanceProfile, AppearanceProfileMode, DEFAULT_MAIN_PAGE_ACTION_PLACEMENT, FilterOperator, MainPageActionId, ManagerSettings, PluginOverviewSort } from "../settings/data";
import { confirmWithModal, managerOpen } from "../utils";
import { describeHeapDelta, readHeapMB, RECLAIM_NOTICE_THRESHOLD_MB, RECLAIM_SETTLE_MS } from "../memory-reclaim";

import Manager from "main";
import { GroupModal } from "./group-modal";
import { TagsModal } from "./tags-modal";
import { DeleteModal } from "./delete-modal";
import Commands from "src/command";
import { NoteModal } from "./note-modal";
import { HideModal } from "./hide-modal";
import { confirmBulkStatusChange } from "./bulk-status-confirm-modal";
import { TroubleshootPanel } from "../troubleshoot/troubleshoot-panel";
import { installPluginFromGithub, installThemeFromGithub, fetchReleaseVersions, ReleaseVersion, sanitizeRepo } from "../github-install";
import { BPM_TAG_ID } from "src/repo-resolver";
import { normalizePath } from "obsidian";
import { UpdateModal } from "./update-modal";
import { openPluginUpdateCheckModal } from "./update-check-modal";
import { RibbonModal } from "./ribbon-modal";
import {
    applyManagerTransferPackage,
    buildManagerTransferPackage,
    collectInstalledThemes,
    createManagerTransferPreview,
    DEFAULT_TRANSFER_BUILD_OPTIONS,
    DEFAULT_TRANSFER_IMPORT_OPTIONS,
    ManagerTransferBuildOptions,
    ManagerTransferImportOptions,
    ManagerTransferImportResult,
    ManagerTransferPackage,
    ManagerTransferPreview,
    ManagerTransferTheme,
    parseManagerTransferPackage,
} from "../import-export";
import { markSourceInstalledRelease, pickSourceTargetRelease, releaseIsCompatible, sourceHasUpdate as sourceHasConfiguredUpdate, syncSourceReleaseCheck } from "../source-release"; 
import {
    createSharedVaultLinks,
    forgetSharedVault,
    getSharedVaultSnapshot,
    isSharedVaultFsAvailable,
    normalizeSharedVaultInputPath,
    readSharedPluginCatalog,
    readSharedThemeCatalog,
    setCurrentVaultAsSharedMain,
    setSharedVaultPluginEnabled,
    setSharedVaultTheme,
    SharedFolderKind,
    SharedPluginCatalogItem,
    SharedThemeCatalogItem,
    SharedVaultFolderStatus,
    SharedVaultRole,
    SharedVaultStatus,
    unlinkSharedVaultFolder,
} from "../vault-share";
import { AppPluginInstanceLike, getExtraButtonElement, ObsidianAppWithInternals, ObsidianPluginRegistry, VaultAdapterWithBasePath } from "src/obsidian-internals";

type ManagerPage = "devices" | "plugins" | "themes" | "install" | "sources" | "transfer" | "vaults" | "ribbon" | "troubleshoot";
type AppearanceView = "profiles" | "themes" | "snippets";
const SHARED_VAULTS_ENABLED = false;
const SUPPORT_QQ_GROUP_URL = "https://qm.qq.com/cgi-bin/qm/qr?k=kHTS0iC1FC5igTXbdbKzff6_tc54mOF5&jump_from=webapi&authKey=AoSkriW+nDeDzBPqBl9jcpbAYkPXN2QRbrMh0hFbvMrGbqZyRAbJwaD6JKbOy4Nx";
const SUPPORT_QQ_GROUP_LABEL = "\u52a0\u5165 QQ \u7fa4";
const SUPPORT_QQ_GROUP_TOOLTIP = "\u52a0\u5165 QQ \u7fa4\u54a8\u8be2\u95ee\u9898";
type PluginUpdateViewStatus = {
    hasUpdate?: boolean;
    remoteVersion?: string | null;
    repo?: string | null;
    versions?: ReleaseVersion[];
    message?: string;
    error?: string;
};

type PluginRepoActionState = {
    repo: string | null;
    tooltip: string;
    disabled: boolean;
};

type PluginSearchIndexEntry = {
    key: string;
    text: string;
};

type PluginDateMeta = {
    installedAt?: number;
    updatedAt?: number;
};

type StatusFilterValue = "all" | "recently-installed" | "enabled" | "disabled" | "grouped" | "ungrouped" | "tagged" | "untagged" | "noted" | "has-update" | "hidden";

type MultiSelectFilterControl = {
    rootEl: HTMLElement;
    buttonEl: HTMLButtonElement;
    menuEl: HTMLElement;
    setValues: (values: string[]) => void;
    refreshOptions: (options: Array<[string, string]>, values?: string[]) => void;
    close: () => void;
};

type FilterOperatorControl = {
    setValue: (value: FilterOperator) => void;
};

type PluginCardController = {
    cardEl: HTMLElement;
    statusChip: HTMLElement;
    cardIcon: HTMLElement;
    toggleSwitch?: ToggleComponent;
    syncToggleValue?: (value: boolean) => void;
    openPluginSetting?: ExtraButtonComponent | null;
    openPluginSettingEl?: HTMLElement;
    singleStartButton?: ExtraButtonComponent | null;
    restartButton?: ExtraButtonComponent | null;
    enableIgnoredButton?: ExtraButtonComponent | null;
};

type CssSnippetItem = {
    id: string;
    name: string;
    path: string;
    enabled: boolean;
};

type AppearanceJson = {
    enabledCssSnippets?: string[];
    [key: string]: unknown;
};

type CustomCssLike = {
    theme?: string;
    getTheme?: () => string;
    setTheme?: (name: string) => void;
    enabledSnippets?: Set<string> | string[];
    setCssEnabledStatus?: (snippet: string, enabled: boolean) => void;
    loadSnippets?: () => void | Promise<void>;
};

type AppearanceSnippetChoice = "ignore" | "enable" | "disable";

type AppearanceProfileDraft = Omit<AppearanceProfile, "createdAt" | "updatedAt"> & {
    createdAt?: number;
    updatedAt?: number;
};

class AppearanceProfileModal extends Modal {
    private profile: AppearanceProfileDraft;
    private themes: ManagerTransferTheme[];
    private snippets: CssSnippetItem[];
    private manager: Manager;
    private onSave: (profile: AppearanceProfileDraft) => Promise<void>;

    constructor(
        app: App,
        manager: Manager,
        profile: AppearanceProfileDraft,
        themes: ManagerTransferTheme[],
        snippets: CssSnippetItem[],
        onSave: (profile: AppearanceProfileDraft) => Promise<void>
    ) {
        super(app);
        this.manager = manager;
        this.profile = {
            ...profile,
            enableSnippets: [...(profile.enableSnippets || [])],
            disableSnippets: [...(profile.disableSnippets || [])],
        };
        this.themes = themes;
        this.snippets = snippets;
        this.onSave = onSave;
    }

    onOpen() {
        const t = (key: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(key, vars);
        const modalEl = this.contentEl.parentElement;
        modalEl?.addClass("manager-appearance-profile-modal");
        this.titleEl.setText(t(this.profile.id ? "外观总览_方案_编辑标题" : "外观总览_方案_新建标题"));
        this.contentEl.empty();

        let name = this.profile.name || t("外观总览_方案_默认名称");
        let theme = this.profile.theme || "";
        let mode: AppearanceProfileMode = this.profile.mode || "merge";
        let autoApplyOnTheme = Boolean(this.profile.autoApplyOnTheme);
        const snippetChoices = new Map<string, AppearanceSnippetChoice>();
        new Set(this.profile.enableSnippets || []).forEach((id) => snippetChoices.set(id, "enable"));
        new Set(this.profile.disableSnippets || []).forEach((id) => {
            if (!snippetChoices.has(id)) snippetChoices.set(id, "disable");
        });

        new Setting(this.contentEl)
            .setName(t("外观总览_方案_名称"))
            .addText((text) => {
                text.setValue(name);
                text.setPlaceholder(t("外观总览_方案_默认名称"));
                text.onChange((value) => { name = value; });
            });

        new Setting(this.contentEl)
            .setName(t("外观总览_方案_绑定主题"))
            .setDesc(t("外观总览_方案_绑定主题说明"))
            .addDropdown((dropdown) => {
                dropdown.addOption("", t("外观总览_方案_不绑定主题"));
                this.themes.forEach((item) => dropdown.addOption(item.name, item.name));
                dropdown.setValue(theme);
                dropdown.onChange((value) => { theme = value; });
            });

        new Setting(this.contentEl)
            .setName(t("外观总览_方案_应用模式"))
            .setDesc(t("外观总览_方案_应用模式说明"))
            .addDropdown((dropdown) => {
                dropdown.addOption("merge", t("外观总览_方案_合并模式"));
                dropdown.addOption("exact", t("外观总览_方案_精确模式"));
                dropdown.setValue(mode);
                dropdown.onChange((value) => { mode = value as AppearanceProfileMode; });
            });

        new Setting(this.contentEl)
            .setName(t("外观总览_方案_自动应用"))
            .setDesc(t("外观总览_方案_自动应用说明"))
            .addToggle((toggle) => {
                toggle.setValue(autoApplyOnTheme);
                toggle.onChange((value) => { autoApplyOnTheme = value; });
            });

        const snippetHeader = this.contentEl.createDiv("manager-appearance-profile-modal__snippet-header");
        snippetHeader.createSpan({ text: t("外观总览_方案_CSS片段规则") });
        snippetHeader.createSpan({ text: t("外观总览_方案_CSS片段规则说明") });

        const snippetList = this.contentEl.createDiv("manager-appearance-profile-modal__snippet-list");
        if (this.snippets.length === 0) {
            snippetList.createDiv({ cls: "manager-appearance-inline-empty", text: t("外观总览_空_无CSS片段") });
        }
        for (const snippet of this.snippets) {
            const choice = snippetChoices.get(snippet.id) || "ignore";
            const item = new Setting(snippetList);
            item.setName(snippet.name);
            item.setDesc(`${snippet.id}.css`);
            item.addDropdown((dropdown) => {
                dropdown.addOption("ignore", t("外观总览_方案_片段忽略"));
                dropdown.addOption("enable", t("外观总览_方案_片段启用"));
                dropdown.addOption("disable", t("外观总览_方案_片段禁用"));
                dropdown.setValue(choice);
                dropdown.onChange((value) => {
                    const nextChoice = value as AppearanceSnippetChoice;
                    if (nextChoice === "ignore") snippetChoices.delete(snippet.id);
                    else snippetChoices.set(snippet.id, nextChoice);
                });
            });
        }

        const footer = new Setting(this.contentEl);
        footer.settingEl.addClass("manager-appearance-profile-modal__footer");
        footer.addButton((button) => {
            button.setButtonText(t("通用_取消_文本"));
            button.onClick(() => this.close());
        });
        footer.addButton((button) => {
            button.setCta();
            button.setButtonText(t("通用_保存_文本"));
            button.onClick(async () => {
                const normalizedName = name.trim();
                if (!normalizedName) {
                    new Notice(t("外观总览_方案_名称不能为空"));
                    return;
                }
                const enableSnippets = [...snippetChoices.entries()]
                    .filter(([, value]) => value === "enable")
                    .map(([id]) => id)
                    .sort((a, b) => a.localeCompare(b));
                const disableSnippets = [...snippetChoices.entries()]
                    .filter(([, value]) => value === "disable")
                    .map(([id]) => id)
                    .sort((a, b) => a.localeCompare(b));
                await this.onSave({
                    ...this.profile,
                    name: normalizedName,
                    theme,
                    mode,
                    autoApplyOnTheme,
                    enableSnippets,
                    disableSnippets,
                });
                this.close();
            });
        });
    }
}



// ==============================
//          侧边栏 对话框 翻译
// ==============================
export class ManagerModal extends Modal {
    /** 桌面端统一收进“更多”菜单的次要操作。 */
    private static readonly DESKTOP_MORE_ACTION_IDS = new Set<MainPageActionId>([
        'checkUpdate', 'hide', 'openRepo', 'openDir', 'clearConfig', 'delete', 'hotkeys', 'note', 'copyId',
    ]);
    private scrollbars?: FloatingScrollbars;
    manager: Manager;
    settings: ManagerSettings;
    // this.app.plugins
    appPlugins: ObsidianPluginRegistry;
    // this.app.settings
    appSetting: ObsidianAppWithInternals["setting"];
    // [本地][变量] 插件路径
    basePath: string;
    // [本地][变量] 展示插件列表
    displayPlugins: PluginManifest[] = [];

    allPlugins: PluginManifest[] = [];

    // 过滤器
    filter = "";
    statusFilters: string[] = [];
    statusOperator: FilterOperator = "contains";
    // 分组内容
    group = "";
    groups: string[] = [];
    groupOperator: FilterOperator = "contains";
    // 标签内容
    tag = "";
    tags: string[] = [];
    tagOperator: FilterOperator = "contains";
    // 标签内容
    delay = "";
    delays: string[] = [];
    delayOperator: FilterOperator = "contains";
    // 搜索内容
    searchText = "";

    // 安装模式
    installMode = false;
    private activePage: ManagerPage = "plugins";
    private catalogModal?: CatalogModal;
    private appearanceView: AppearanceView = "profiles";
    installType: "plugin" | "theme" = "plugin";
    installRepo = "";
    installVersion = "";
    installVersions: ReleaseVersion[] = [];
    installTrackSource = true;
    searchBarEl?: HTMLElement;
    statusMultiSelect?: MultiSelectFilterControl;
    statusOperatorControl?: FilterOperatorControl;
    groupMultiSelect?: MultiSelectFilterControl;
    tagMultiSelect?: MultiSelectFilterControl;
    delayMultiSelect?: MultiSelectFilterControl;
    private bulkEditMode = false;
    private bulkSelectedPluginIds = new Set<string>();
    actionCollapsed = false;
    filterCollapsed = false;
    private reloadingManifests = false;
    /** 平板宽度足够，过滤器默认展开；手机保持收起。 */
    private mobileFiltersCollapsed = !Platform.isTablet;
    private isCheckingPluginUpdates = false;
    private renderGeneration = 0;
    private searchRenderTimer?: number;
    private searchSaveTimer?: number;
    private searchIndex = new Map<string, PluginSearchIndexEntry>();
    private pluginCardControllers = new Map<string, PluginCardController>();
    private pluginDateMetaById = new Map<string, PluginDateMeta>();
    private bulkBarHostEl?: HTMLElement;
    private singleStartedPluginIds = new Set<string>();
    private expandedSourceConfigKeys = new Set<string>();
    private pluginManifestCache?: { source: Record<string, PluginManifest>; plugins: PluginManifest[] };
    private modalChromeEl?: HTMLElement;
    private modalPageEl?: HTMLElement;
    private pageToolsEl?: HTMLElement;
    private mobileScopeHost?: HTMLElement;
    private mobileOverviewHost?: HTMLElement;
    private mobileContentObserver?: ResizeObserver;
    private mobileHeaderObserver?: ResizeObserver;
    private overviewSortSelect?: ScopeSelect;
    private overviewStatsSelect?: ScopeSelect;
    private overviewToolbarLayout?: ResponsiveToolbar;
    private installToolbarLayout?: ResponsiveToolbar;
    private installToolbarMenus: ScopeSelect[] = [];
    private nativeMobileCloseEl?: HTMLElement;
    private readonly renderBatchSize = 80;
    private readonly desktopPages: ManagerPage[] = SHARED_VAULTS_ENABLED
        ? ["plugins", "themes", "devices", "install", "sources", "transfer", "vaults", "ribbon", "troubleshoot"]
        : ["plugins", "themes", "devices", "install", "sources", "transfer", "ribbon", "troubleshoot"];

    private get pageEl(): HTMLElement {
        return this.modalPageEl ?? this.contentEl;
    }

    private nextRenderGeneration(): number {
        return ++this.renderGeneration;
    }

    private clearScheduledSearchRender() {
        if (this.searchRenderTimer !== undefined) {
            window.clearTimeout(this.searchRenderTimer);
            this.searchRenderTimer = undefined;
        }
    }

    private clearScheduledSearchWork() {
        this.clearScheduledSearchRender();
        if (this.searchSaveTimer !== undefined) {
            window.clearTimeout(this.searchSaveTimer);
            this.searchSaveTimer = undefined;
        }
    }

    private scheduleSearchReload() {
        this.clearScheduledSearchRender();
        this.searchRenderTimer = window.setTimeout(() => {
            this.searchRenderTimer = undefined;
            void this.reloadShowData();
        }, 120);
    }

    private scheduleSearchPersistence() {
        if (!this.settings.PERSISTENCE) return;
        if (this.searchSaveTimer !== undefined) window.clearTimeout(this.searchSaveTimer);
        this.searchSaveTimer = window.setTimeout(() => {
            this.searchSaveTimer = undefined;
            void this.manager.saveSettings();
        }, 350);
    }

    private handleSearchChange(value: string) {
        this.searchText = value;
        if (this.settings.PERSISTENCE) this.settings.FILTER_SEARCH = value;
        this.scheduleSearchPersistence();
        this.scheduleSearchReload();
    }

    private isRenderCurrent(renderGeneration: number, page: ManagerPage): boolean {
        return renderGeneration === this.renderGeneration && this.activePage === page;
    }

    private isRibbonManagerEnabled(): boolean {
        return featureEnabled(this.settings, 'ribbon') && this.settings.RIBBON_MANAGER_ENABLED !== false;
    }

    private getAvailableDesktopPages(): ManagerPage[] {
        return this.desktopPages.filter(page => this.isPageEnabled(page));
    }

    private isPageEnabled(page: ManagerPage): boolean {
        const feature: FeatureId = page === 'sources' ? 'install' : page === 'vaults' ? 'transfer' : page;
        return featureEnabled(this.settings, feature) && (page !== 'ribbon' || this.isRibbonManagerEnabled());
    }

    /** 桌面标签与手机菜单共用栏目定义；Shared navigation preserves feature availability. */
    private getPageNavigationItems(): Array<{ page: ManagerPage; label: string; icon: string; tooltip?: string }> {
        const t = (key: string) => this.manager.translator.t(key);
        const items: Array<{ page: ManagerPage; label: string; icon: string; tooltip?: string }> = [
            { page: 'plugins', label: t('管理器_Tab_插件管理'), icon: 'blocks' },
            { page: 'themes', label: t('外观总览_Tab_标题'), icon: 'palette' },
            { page: 'devices', label: t('设备_标题'), icon: 'monitor-smartphone' },
            { page: 'install', label: t('管理器_Tab_安装来源'), icon: 'download' },
            { page: 'transfer', label: t('导入导出_Tab_标题'), icon: 'archive-restore', tooltip: t('导入导出_Tab_说明') },
            { page: 'vaults', label: t('共享库_Tab_标题'), icon: 'folder-sync', tooltip: t('共享库_Tab_说明') },
            { page: 'ribbon', label: t('管理器_Tab_功能编排'), icon: 'grip-vertical', tooltip: t('Ribbon_功能编排_说明') },
            { page: 'troubleshoot', label: t('排查_Tab_短标题'), icon: 'search-check' },
        ];
        return items.filter(item => (item.page !== 'vaults' || SHARED_VAULTS_ENABLED) && this.isPageEnabled(item.page));
    }

    private normalizeManagerPage(page: ManagerPage): ManagerPage {
        const available = this.getAvailableDesktopPages();
        if (!SHARED_VAULTS_ENABLED && page === 'vaults') return available[0] ?? 'plugins';
        return available.includes(page) ? page : available[0] ?? 'plugins';
    }

    private ensureAllowedActivePage() {
        const nextPage = this.normalizeManagerPage(this.activePage);
        if (nextPage === this.activePage) return;
        this.activePage = nextPage;
        this.installMode = false;
    }

    private getPluginOverviewLayout(): string {
        const layout = this.settings.PLUGIN_OVERVIEW_LAYOUT;
        return layout === "two-column" ? layout : "list";
    }

    private normalizePluginOverviewSort(value?: string): PluginOverviewSort {
        switch (value) {
            case "name-asc":
            case "name-desc":
            case "installed-desc":
            case "installed-asc":
            case "updated-desc":
            case "updated-asc":
                return value;
            default:
                return "layout";
        }
    }

    private getPluginOverviewSort(): PluginOverviewSort {
        return this.normalizePluginOverviewSort(this.settings.PLUGIN_OVERVIEW_SORT);
    }

    private getPluginOverviewSortOptions(): Array<[PluginOverviewSort, string]> {
        const t = (key: string) => this.manager.translator.t(key);
        return [
            ["layout", t("排序_自定义布局")],
            ["name-asc", t("排序_名称升序")],
            ["name-desc", t("排序_名称降序")],
            ["installed-desc", t("排序_安装日期新到旧")],
            ["installed-asc", t("排序_安装日期旧到新")],
            ["updated-desc", t("排序_更新日期新到旧")],
            ["updated-asc", t("排序_更新日期旧到新")],
        ];
    }

    private async setPluginOverviewSort(value: string) {
        this.settings.PLUGIN_OVERVIEW_SORT = this.normalizePluginOverviewSort(value);
        await this.manager.saveSettings();
        await this.reloadShowData();
    }

    private syncPluginOverviewLayoutClass() {
        this.pageEl.removeClass("manager-theme-overview");
        this.pageEl.removeClass("manager-plugin-overview--list");
        this.pageEl.removeClass("manager-plugin-overview--two-column");
        this.pageEl.addClass(`manager-plugin-overview--${this.getPluginOverviewLayout()}`);
    }

    private clearPluginOverviewLayoutClass() {
        this.pageEl.removeClass("manager-theme-overview");
        this.pageEl.removeClass("manager-plugin-overview--list");
        this.pageEl.removeClass("manager-plugin-overview--two-column");
    }

    private getPluginUpdateCount(statusMap?: Record<string, { hasUpdate?: boolean }>): number {
        return Object.values(statusMap || this.manager.updateStatus || {}).filter((status) => status?.hasUpdate).length;
    }

    private getStatusFilterOptions(): Record<string, string> {
        const t = (key: string) => this.manager.translator.t(key);
        return {
            "recently-installed": t("管理器_最近安装"),
            "all": t("筛选_全部_描述"),
            "enabled": t("筛选_仅启用_描述"),
            "disabled": t("筛选_仅禁用_描述"),
            "grouped": t("筛选_已分组_描述"),
            "ungrouped": t("筛选_未分组_描述"),
            "tagged": t("筛选_有标签_描述"),
            "untagged": t("筛选_无标签_描述"),
            "noted": t("筛选_有笔记_描述"),
            "has-update": t("筛选_可更新_描述"),
            "hidden": t("管理器_状态_已隐藏"),
        };
    }

    private getFilterOperatorOptions(): Record<FilterOperator, string> {
        const t = (key: string) => this.manager.translator.t(key);
        return {
            "contains": t("筛选_操作符_包含"),
            "not-contains": t("筛选_操作符_排除"),
        };
    }

    private addOrderedOptions(dropdown: DropdownComponent, options: Array<[string, string]>) {
        for (const [value, text] of options) {
            dropdown.addOption(value, text);
        }
    }

    private getGroupFilterOptions(allLabel: string): Array<[string, string]> {
        const groupCounts = this.settings.Plugins.reduce((acc: { [key: string]: number }, plugin) => { const groupId = plugin.group || ""; acc[groupId] = (acc[groupId] || 0) + 1; return acc; }, { "": 0 });
        return [
            ["", allLabel],
            ...this.settings.GROUPS.map((item): [string, string] => [item.id, `${item.name} [${groupCounts[item.id] || 0}]`]),
        ];
    }

    private getTagFilterOptions(allLabel: string): Array<[string, string]> {
        const tagCounts: { [key: string]: number } = this.settings.Plugins.reduce((acc, plugin) => { plugin.tags.forEach((tag) => { acc[tag] = (acc[tag] || 0) + 1; }); return acc; }, {} as { [key: string]: number });
        return [
            ["", allLabel],
            ...this.settings.TAGS.map((item): [string, string] => [item.id, `${item.name} [${tagCounts[item.id] || 0}]`]),
        ];
    }

    private getDelayFilterOptions(allLabel: string, showTime = false): Array<[string, string]> {
        const delayCounts = this.settings.Plugins.reduce((acc: { [key: string]: number }, plugin) => { const delay = plugin.delay || ""; acc[delay] = (acc[delay] || 0) + 1; return acc; }, { "": 0 });
        return [
            ["", allLabel],
            ...this.settings.DELAYS.map((item): [string, string] => [
                item.id,
                showTime ? `${item.name} (${item.time}s) [${delayCounts[item.id] || 0}]` : `${item.name} (${delayCounts[item.id] || 0})`,
            ]),
        ];
    }

    private formatFilterChipLabel(label: string, operator: FilterOperator): string {
        return operator === "not-contains"
            ? `${this.manager.translator.t("筛选_操作符_排除")} ${label}`
            : label;
    }

    private normalizeFilterOperator(value?: string): FilterOperator {
        return value === "not-contains" ? "not-contains" : "contains";
    }

    private normalizeFilterValues(values: unknown, allValue: string): string[] {
        const normalized: string[] = [];
        const source = Array.isArray(values) ? values : [];
        for (const value of source) {
            const next = `${value || ""}`.trim();
            if (!next || next === allValue || normalized.includes(next)) continue;
            normalized.push(next);
        }
        return normalized;
    }

    private filterValuesByAvailable(values: unknown, availableValues: string[], allValue: string): string[] {
        const available = new Set(availableValues.filter((value) => value && value !== allValue));
        return this.normalizeFilterValues(values, allValue).filter((value) => available.has(value));
    }

    private valuesFromSingleFilter(value: string | undefined, allValue: string): string[] {
        return this.normalizeFilterValues(value ? [value] : [], allValue);
    }

    private getStatusFilterValues(): string[] {
        const availableValues = Object.keys(this.getStatusFilterOptions());
        const values = this.settings.PERSISTENCE
            ? this.filterValuesByAvailable(this.settings.FILTER_STATUS_VALUES, availableValues, "all")
            : this.filterValuesByAvailable(this.statusFilters, availableValues, "all");
        if (values.length > 0) return values;
        const fallback = this.settings.PERSISTENCE ? this.settings.FILTER_STATUS : this.filter;
        return this.filterValuesByAvailable([fallback || "all"], availableValues, "all");
    }

    private getStatusFilterValue(): string {
        return this.getStatusFilterValues()[0] || "all";
    }

    private getStatusFilterOperator(): FilterOperator {
        return this.normalizeFilterOperator(this.settings.PERSISTENCE ? this.settings.FILTER_STATUS_OPERATOR : this.statusOperator);
    }

    private getGroupFilterValues(): string[] {
        const availableValues = this.settings.GROUPS.map((group) => group.id);
        const values = this.settings.PERSISTENCE
            ? this.filterValuesByAvailable(this.settings.FILTER_GROUP_VALUES, availableValues, "")
            : this.filterValuesByAvailable(this.groups, availableValues, "");
        if (values.length > 0) return values;
        const fallback = this.settings.PERSISTENCE ? this.settings.FILTER_GROUP : this.group;
        return this.filterValuesByAvailable([fallback], availableValues, "");
    }

    private getGroupFilterValue(): string {
        return this.getGroupFilterValues()[0] || "";
    }

    private getGroupFilterOperator(): FilterOperator {
        return this.normalizeFilterOperator(this.settings.PERSISTENCE ? this.settings.FILTER_GROUP_OPERATOR : this.groupOperator);
    }

    private getTagFilterValues(): string[] {
        const availableValues = this.settings.TAGS.map((tag) => tag.id);
        const values = this.settings.PERSISTENCE
            ? this.filterValuesByAvailable(this.settings.FILTER_TAG_VALUES, availableValues, "")
            : this.filterValuesByAvailable(this.tags, availableValues, "");
        if (values.length > 0) return values;
        const fallback = this.settings.PERSISTENCE ? this.settings.FILTER_TAG : this.tag;
        return this.filterValuesByAvailable([fallback], availableValues, "");
    }

    private getTagFilterValue(): string {
        return this.getTagFilterValues()[0] || "";
    }

    private getTagFilterOperator(): FilterOperator {
        return this.normalizeFilterOperator(this.settings.PERSISTENCE ? this.settings.FILTER_TAG_OPERATOR : this.tagOperator);
    }

    private getDelayFilterValues(): string[] {
        const availableValues = this.settings.DELAYS.map((delay) => delay.id);
        const values = this.settings.PERSISTENCE
            ? this.filterValuesByAvailable(this.settings.FILTER_DELAY_VALUES, availableValues, "")
            : this.filterValuesByAvailable(this.delays, availableValues, "");
        if (values.length > 0) return values;
        const fallback = this.settings.PERSISTENCE ? this.settings.FILTER_DELAY : this.delay;
        return this.filterValuesByAvailable([fallback], availableValues, "");
    }

    private getDelayFilterValue(): string {
        return this.getDelayFilterValues()[0] || "";
    }

    private getDelayFilterOperator(): FilterOperator {
        return this.normalizeFilterOperator(this.settings.PERSISTENCE ? this.settings.FILTER_DELAY_OPERATOR : this.delayOperator);
    }

    private hasActiveStatusFilter(): boolean {
        return this.getStatusFilterValues().length > 0;
    }

    public persistCurrentFilters() {
        const statusValues = this.getStatusFilterValues();
        const groupValues = this.getGroupFilterValues();
        const tagValues = this.getTagFilterValues();
        const delayValues = this.getDelayFilterValues();
        this.settings.FILTER_SEARCH = this.searchText || "";
        this.settings.FILTER_STATUS_VALUES = statusValues;
        this.settings.FILTER_STATUS = statusValues[0] || "all";
        this.settings.FILTER_STATUS_OPERATOR = this.getStatusFilterOperator();
        this.settings.FILTER_GROUP_VALUES = groupValues;
        this.settings.FILTER_GROUP = groupValues[0] || "";
        this.settings.FILTER_GROUP_OPERATOR = this.getGroupFilterOperator();
        this.settings.FILTER_TAG_VALUES = tagValues;
        this.settings.FILTER_TAG = tagValues[0] || "";
        this.settings.FILTER_TAG_OPERATOR = this.getTagFilterOperator();
        this.settings.FILTER_DELAY_VALUES = delayValues;
        this.settings.FILTER_DELAY = delayValues[0] || "";
        this.settings.FILTER_DELAY_OPERATOR = this.getDelayFilterOperator();
    }

    /** Read the active session filters for device preset capture, even when persistence is off. */
    public getCurrentDeviceFilters(): DevicePluginFilters {
        return {
            search: this.searchText || '',
            status: this.getStatusFilterValues(), statusOperator: this.getStatusFilterOperator(),
            group: this.getGroupFilterValues(), groupOperator: this.getGroupFilterOperator(),
            tag: this.getTagFilterValues(), tagOperator: this.getTagFilterOperator(),
            delay: this.getDelayFilterValues(), delayOperator: this.getDelayFilterOperator(),
        };
    }

    public usePersistedFiltersAsSessionFilters() {
        const statusValues = this.normalizeFilterValues(this.settings.FILTER_STATUS_VALUES, "all");
        const groupValues = this.normalizeFilterValues(this.settings.FILTER_GROUP_VALUES, "");
        const tagValues = this.normalizeFilterValues(this.settings.FILTER_TAG_VALUES, "");
        const delayValues = this.normalizeFilterValues(this.settings.FILTER_DELAY_VALUES, "");
        this.statusFilters = statusValues.length > 0 ? statusValues : this.valuesFromSingleFilter(this.settings.FILTER_STATUS, "all");
        this.filter = this.statusFilters[0] || "all";
        this.groups = groupValues.length > 0 ? groupValues : this.valuesFromSingleFilter(this.settings.FILTER_GROUP, "");
        this.group = this.groups[0] || "";
        this.tags = tagValues.length > 0 ? tagValues : this.valuesFromSingleFilter(this.settings.FILTER_TAG, "");
        this.tag = this.tags[0] || "";
        this.delays = delayValues.length > 0 ? delayValues : this.valuesFromSingleFilter(this.settings.FILTER_DELAY, "");
        this.delay = this.delays[0] || "";
        this.statusOperator = this.normalizeFilterOperator(this.settings.FILTER_STATUS_OPERATOR);
        this.groupOperator = this.normalizeFilterOperator(this.settings.FILTER_GROUP_OPERATOR);
        this.tagOperator = this.normalizeFilterOperator(this.settings.FILTER_TAG_OPERATOR);
        this.delayOperator = this.normalizeFilterOperator(this.settings.FILTER_DELAY_OPERATOR);
        // 作用域切换时，空搜索词也是目标预设的有效状态；不能回退到上一个作用域。
        // An empty search is a valid preset value and must not inherit the previous scope.
        this.searchText = this.settings.FILTER_SEARCH || "";
        // 输入框显示值必须跟着目标预设走，否则会出现「框里还是旧词、列表已按新预设过滤」。
        const searchInput = this.searchEl?.inputEl;
        if (searchInput && searchInput.value !== this.searchText) searchInput.value = this.searchText;
    }

    private migratePersistedFilterValues() {
        if (!this.settings.PERSISTENCE) return;
        const statusValues = this.getStatusFilterValues();
        const groupValues = this.getGroupFilterValues();
        const tagValues = this.getTagFilterValues();
        const delayValues = this.getDelayFilterValues();
        const changed = JSON.stringify(this.settings.FILTER_STATUS_VALUES || []) !== JSON.stringify(statusValues)
            || JSON.stringify(this.settings.FILTER_GROUP_VALUES || []) !== JSON.stringify(groupValues)
            || JSON.stringify(this.settings.FILTER_TAG_VALUES || []) !== JSON.stringify(tagValues)
            || JSON.stringify(this.settings.FILTER_DELAY_VALUES || []) !== JSON.stringify(delayValues)
            || this.settings.FILTER_STATUS !== (statusValues[0] || "all")
            || this.settings.FILTER_GROUP !== (groupValues[0] || "")
            || this.settings.FILTER_TAG !== (tagValues[0] || "")
            || this.settings.FILTER_DELAY !== (delayValues[0] || "");
        if (!changed) return;
        this.settings.FILTER_STATUS_VALUES = statusValues;
        this.settings.FILTER_STATUS = statusValues[0] || "all";
        this.settings.FILTER_GROUP_VALUES = groupValues;
        this.settings.FILTER_GROUP = groupValues[0] || "";
        this.settings.FILTER_TAG_VALUES = tagValues;
        this.settings.FILTER_TAG = tagValues[0] || "";
        this.settings.FILTER_DELAY_VALUES = delayValues;
        this.settings.FILTER_DELAY = delayValues[0] || "";
        void this.manager.saveSettings();
    }

    private setStatusFilterValues(values: string[]) {
        const next = this.normalizeFilterValues(values, "all");
        if (this.settings.PERSISTENCE) {
            this.settings.FILTER_STATUS_VALUES = next;
            this.settings.FILTER_STATUS = next[0] || "all";
            void this.manager.saveSettings();
        } else {
            this.statusFilters = next;
            this.filter = next[0] || "all";
        }
    }

    private setStatusFilterValue(value: string) {
        this.setStatusFilterValues(value && value !== "all" ? [value] : []);
    }

    private setStatusFilterOperator(value: string) {
        const next = this.normalizeFilterOperator(value);
        if (this.settings.PERSISTENCE) {
            this.settings.FILTER_STATUS_OPERATOR = next;
            void this.manager.saveSettings();
        } else {
            this.statusOperator = next;
        }
    }

    private setStatusFilterFromStats(value: StatusFilterValue) {
        this.activePage = "plugins";
        this.installMode = false;
        this.setStatusFilterOperator("contains");
        this.setStatusFilterValue(value);
        this.statusMultiSelect?.setValues(value === "all" ? [] : [value]);
        this.statusOperatorControl?.setValue("contains");
        this.syncPageChrome();
        // 移动端顶栏随页面重建：从设备页等非插件页点统计筛选时，需要补回搜索与过滤区。
        if (Platform.isMobile) this.showHeadMobile();
        void this.reloadShowData();
    }

    private setGroupFilterValues(values: string[]) {
        const next = this.normalizeFilterValues(values, "");
        if (this.settings.PERSISTENCE) {
            this.settings.FILTER_GROUP_VALUES = next;
            this.settings.FILTER_GROUP = next[0] || "";
            void this.manager.saveSettings();
        } else {
            this.groups = next;
            this.group = next[0] || "";
        }
    }

    private setGroupFilterValue(value: string) {
        this.setGroupFilterValues(value ? [value] : []);
    }

    private setGroupFilterOperator(value: string) {
        const next = this.normalizeFilterOperator(value);
        if (this.settings.PERSISTENCE) {
            this.settings.FILTER_GROUP_OPERATOR = next;
            void this.manager.saveSettings();
        } else {
            this.groupOperator = next;
        }
    }

    private setTagFilterValues(values: string[]) {
        const next = this.normalizeFilterValues(values, "");
        if (this.settings.PERSISTENCE) {
            this.settings.FILTER_TAG_VALUES = next;
            this.settings.FILTER_TAG = next[0] || "";
            void this.manager.saveSettings();
        } else {
            this.tags = next;
            this.tag = next[0] || "";
        }
    }

    private setTagFilterValue(value: string) {
        this.setTagFilterValues(value ? [value] : []);
    }

    private setTagFilterOperator(value: string) {
        const next = this.normalizeFilterOperator(value);
        if (this.settings.PERSISTENCE) {
            this.settings.FILTER_TAG_OPERATOR = next;
            void this.manager.saveSettings();
        } else {
            this.tagOperator = next;
        }
    }

    private setDelayFilterValues(values: string[]) {
        const next = this.normalizeFilterValues(values, "");
        if (this.settings.PERSISTENCE) {
            this.settings.FILTER_DELAY_VALUES = next;
            this.settings.FILTER_DELAY = next[0] || "";
            void this.manager.saveSettings();
        } else {
            this.delays = next;
            this.delay = next[0] || "";
        }
    }

    private setDelayFilterValue(value: string) {
        this.setDelayFilterValues(value ? [value] : []);
    }

    private setDelayFilterOperator(value: string) {
        const next = this.normalizeFilterOperator(value);
        if (this.settings.PERSISTENCE) {
            this.settings.FILTER_DELAY_OPERATOR = next;
            void this.manager.saveSettings();
        } else {
            this.delayOperator = next;
        }
    }

    private matchesOperator(matched: boolean, operator: FilterOperator): boolean {
        return operator === "contains" ? matched : !matched;
    }

    private matchesSingleValueFilter(value: string, filterValue: string | string[], operator: FilterOperator): boolean {
        const values = this.normalizeFilterValues(Array.isArray(filterValue) ? filterValue : [filterValue], "");
        if (values.length === 0) return true;
        return this.matchesOperator(values.includes(value), operator);
    }

    private matchesTagFilter(pluginTags: string[] = [], tagId: string | string[], operator: FilterOperator): boolean {
        const values = this.normalizeFilterValues(Array.isArray(tagId) ? tagId : [tagId], "");
        if (values.length === 0) return true;
        return this.matchesOperator(values.some((value) => pluginTags.includes(value)), operator);
    }

    private matchesStatusFilter(
        plugin: ManagerPlugin,
        manifest: PluginManifest,
        isEnabled: boolean,
        filter: string | string[] = this.getStatusFilterValues(),
        operator = this.getStatusFilterOperator(),
        hiddenPluginIds?: Set<string>
    ): boolean {
        const values = this.normalizeFilterValues(Array.isArray(filter) ? filter : [filter], "all");
        if (values.length === 0) return true;

        const matchesStatus = (status: string) => {
            switch (status) {
                case "recently-installed":
                    return this.isRecentlyInstalled(this.readRecentInstallTimestamp(manifest.id));
                case "enabled":
                    return isEnabled;
                case "disabled":
                    return !isEnabled;
                case "grouped":
                    return plugin.group !== "";
                case "ungrouped":
                    return plugin.group === "";
                case "tagged":
                    return plugin.tags.length > 0;
                case "untagged":
                    return plugin.tags.length === 0;
                case "noted":
                    return Boolean(plugin.note);
                case "has-update":
                    return Boolean(this.manager.updateStatus[manifest.id]?.hasUpdate);
                case "hidden":
                    return hiddenPluginIds ? hiddenPluginIds.has(manifest.id) : this.isPluginHidden(manifest.id);
                default:
                    return true;
            }
        };
        const matched = values.some(matchesStatus);

        return this.matchesOperator(matched, operator);
    }

    private formatMultiSelectSummary(values: string[], options: Array<[string, string]>, allLabel: string): string {
        if (values.length === 0) return allLabel;
        const labelsByValue = new Map(options.map(([value, label]) => [value, label]));
        if (values.length === 1) return labelsByValue.get(values[0]) || values[0];
        const firstLabel = labelsByValue.get(values[0]) || values[0];
        return `${firstLabel} +${values.length - 1}`;
    }

    private createMultiSelectFilter(
        container: HTMLElement,
        options: Array<[string, string]>,
        values: string[],
        allValue: string,
        allLabel: string,
        ariaLabel: string,
        onChange: (values: string[]) => void
    ): MultiSelectFilterControl {
        const rootEl = container.createDiv("manager-multiselect-filter");
        const buttonEl = rootEl.createEl("button", { cls: "manager-multiselect-filter__trigger" });
        buttonEl.type = "button";
        buttonEl.setAttribute("aria-label", ariaLabel);
        buttonEl.setAttribute("aria-haspopup", "listbox");
        buttonEl.setAttribute("aria-expanded", "false");
        const summaryEl = buttonEl.createSpan({ cls: "manager-multiselect-filter__summary" });
        const countEl = buttonEl.createSpan({ cls: "manager-multiselect-filter__count" });
        const chevronEl = buttonEl.createSpan({ cls: "manager-multiselect-filter__chevron" });
        setIcon(chevronEl, "chevron-down");
        const menuEl = rootEl.createDiv("manager-multiselect-filter__menu");
        menuEl.setAttribute("role", "listbox");
        menuEl.setAttribute("aria-multiselectable", "true");
        menuEl.setAttribute("aria-label", ariaLabel);
        const filterFieldEl = rootEl.closest<HTMLElement>(".manager-filter-field");
        const filterSectionEl = rootEl.closest<HTMLElement>(".manager-section--filters");
        const mobileFilterPanelEl = rootEl.closest<HTMLElement>(".bpm-mobile-header__filters");
        const managerContainerEl = rootEl.closest<HTMLElement>(".manager-container");

        let currentOptions = options;
        let selectedValues = this.normalizeFilterValues(values, allValue);
        let isOpen = false;

        const updateButton = () => {
            summaryEl.setText(this.formatMultiSelectSummary(selectedValues, currentOptions, allLabel));
            countEl.setText(selectedValues.length > 0 ? `${selectedValues.length}` : "");
            countEl.toggleClass("is-empty", selectedValues.length === 0);
            buttonEl.toggleClass("has-selection", selectedValues.length > 0);
        };

        function handleDocumentClick() {
            close();
        }

        function close() {
            isOpen = false;
            rootEl.removeClass("is-open");
            menuEl.setCssStyles({ left: "", width: "" });
            filterFieldEl?.removeClass("is-filter-menu-open");
            filterSectionEl?.removeClass("is-filter-menu-open");
            mobileFilterPanelEl?.removeClass("is-filter-menu-open");
            managerContainerEl?.removeClass("has-open-filter-menu");
            buttonEl.setAttribute("aria-expanded", "false");
            activeDocument.removeEventListener("click", handleDocumentClick);
        }

        /** 菜单与所属筛选控件左右对齐；控件比管理器宽时再压回容器内。 */
        function positionMenu() {
            const field = filterFieldEl ?? rootEl;
            const rootRect = rootEl.getBoundingClientRect();
            const fieldRect = field.getBoundingClientRect();
            const container = managerContainerEl?.getBoundingClientRect();
            let left = fieldRect.left - rootRect.left;
            let width = fieldRect.width;
            if (container) {
                const maxWidth = container.width - 16;
                if (width > maxWidth) width = maxWidth;
                if (fieldRect.left + left + width > container.right - 8) {
                    left = Math.max(0, container.right - 8 - width - fieldRect.left);
                }
            }
            menuEl.setCssStyles({ left: `${left}px`, width: `${width}px`, minWidth: "0" });
        }

        const toggleOpen = () => {
            if (isOpen) {
                close();
                return;
            }
            isOpen = true;
            rootEl.addClass("is-open");
            filterFieldEl?.addClass("is-filter-menu-open");
            filterSectionEl?.addClass("is-filter-menu-open");
            mobileFilterPanelEl?.addClass("is-filter-menu-open");
            managerContainerEl?.addClass("has-open-filter-menu");
            buttonEl.setAttribute("aria-expanded", "true");
            positionMenu();
            window.setTimeout(() => activeDocument.addEventListener("click", handleDocumentClick), 0);
        };

        const emitChange = () => {
            updateButton();
            onChange([...selectedValues]);
        };

        const renderOptions = () => {
            menuEl.empty();
            const renderAllOption = () => {
                const allOption = menuEl.createEl("button", { cls: "manager-multiselect-filter__option" });
                allOption.type = "button";
                allOption.setAttribute("role", "option");
                allOption.setAttribute("aria-selected", `${selectedValues.length === 0}`);
                allOption.toggleClass("is-selected", selectedValues.length === 0);
                const allCheck = allOption.createSpan({ cls: "manager-multiselect-filter__check" });
                setIcon(allCheck, selectedValues.length === 0 ? "check" : "circle");
                allOption.createSpan({ cls: "manager-multiselect-filter__option-label", text: allLabel });
                allOption.addEventListener("click", () => {
                    selectedValues = [];
                    renderOptions();
                    emitChange();
                });
            };
            if (!currentOptions.some(([value]) => value === allValue)) renderAllOption();

            for (const [value, label] of currentOptions) {
                if (value === allValue) { renderAllOption(); continue; }
                const selected = selectedValues.includes(value);
                const optionEl = menuEl.createEl("button", { cls: "manager-multiselect-filter__option" });
                optionEl.type = "button";
                optionEl.setAttribute("role", "option");
                optionEl.setAttribute("aria-selected", `${selected}`);
                optionEl.toggleClass("is-selected", selected);
                const check = optionEl.createSpan({ cls: "manager-multiselect-filter__check" });
                setIcon(check, selected ? "square-check-big" : "square");
                optionEl.createSpan({ cls: "manager-multiselect-filter__option-label", text: label });
                optionEl.addEventListener("click", () => {
                    selectedValues = selected
                        ? selectedValues.filter((item) => item !== value)
                        : [...selectedValues, value];
                    renderOptions();
                    emitChange();
                });
            }
        };

        buttonEl.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleOpen();
        });
        rootEl.addEventListener("click", (event) => event.stopPropagation());
        rootEl.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                close();
            }
        });

        const control: MultiSelectFilterControl = {
            rootEl,
            buttonEl,
            menuEl,
            setValues: (nextValues: string[]) => {
                selectedValues = this.normalizeFilterValues(nextValues, allValue);
                renderOptions();
                updateButton();
            },
            refreshOptions: (nextOptions: Array<[string, string]>, nextValues?: string[]) => {
                currentOptions = nextOptions;
                const availableValues = new Set(nextOptions.map(([value]) => value).filter((value) => value !== allValue));
                selectedValues = this.normalizeFilterValues(nextValues || selectedValues, allValue)
                    .filter((value) => availableValues.has(value));
                renderOptions();
                updateButton();
            },
            close,
        };

        renderOptions();
        updateButton();
        return control;
    }

    /** 筛选字段的共用结构：图标 + 标签 + 控件，桌面过滤行与移动端过滤面板共用。 */
    private createFilterField(parent: HTMLElement, label: string, icon: string, variant: "select" | "search" | "compound" = "select"): HTMLElement {
        return createBpmFilterField(parent, label, icon, variant);
    }

    private createFilterSelectField(parent: HTMLElement, label: string, icon: string, variant: "select" | "search" | "compound" = "select"): HTMLElement {
        return createBpmFilterSelectField(parent, label, icon, variant);
    }

    private renderPluginFilterControls(
        controls: { status: HTMLElement; group: HTMLElement; tag: HTMLElement; delay?: HTMLElement },
        refreshLayout: () => void
    ) {
        const t = (key: string) => this.manager.translator.t(key);
        const createOperatorToggle = (container: HTMLElement, value: FilterOperator, ariaLabel: string, onChange: (value: string) => void): FilterOperatorControl => {
            const options = this.getFilterOperatorOptions();
            const buttonEl = container.createEl("button", { cls: "manager-filter-operator-toggle" });
            buttonEl.type = "button";
            let currentValue = this.normalizeFilterOperator(value);
            const updateButton = () => {
                const isExclude = currentValue === "not-contains";
                buttonEl.empty();
                setIcon(buttonEl, isExclude ? "circle-slash" : "check");
                buttonEl.toggleClass("is-exclude", isExclude);
                buttonEl.toggleClass("is-include", !isExclude);
                buttonEl.setAttribute("aria-label", `${ariaLabel}: ${options[currentValue]}`);
                buttonEl.setAttribute("aria-pressed", `${isExclude}`);
                buttonEl.setAttribute("title", options[currentValue]);
            };
            buttonEl.addEventListener("click", () => {
                currentValue = currentValue === "contains" ? "not-contains" : "contains";
                updateButton();
                onChange(currentValue);
                refreshLayout();
                void this.reloadShowData();
            });
            updateButton();
            return { setValue: (nextValue: FilterOperator) => {
                currentValue = this.normalizeFilterOperator(nextValue);
                updateButton();
            } };
        };
        const createFilter = (
            type: "status" | "group" | "tag" | "delay",
            container: HTMLElement,
            options: Array<[string, string]>,
            allValue: string,
            ariaLabel: string,
            operatorLabel: string,
            getValues: () => string[],
            getOperator: () => FilterOperator,
            setValues: (values: string[]) => void,
            setOperator: (value: string) => void
        ) => {
            const operatorControl = createOperatorToggle(container, getOperator(), operatorLabel, setOperator);
            if (type === "status") this.statusOperatorControl = operatorControl;
            const allLabel = options.find(([value]) => value === allValue)?.[1] || t("筛选_全部_描述");
            const control = this.createMultiSelectFilter(container, options, getValues(), allValue, allLabel, ariaLabel, values => {
                setValues(values);
                refreshLayout();
                void this.reloadShowData();
            });
            if (type === "status") this.statusMultiSelect = control;
            else if (type === "group") this.groupMultiSelect = control;
            else if (type === "tag") this.tagMultiSelect = control;
            else this.delayMultiSelect = control;
        };

        const allLabel = t("筛选_全部_描述");
        createFilter("status", controls.status, Object.entries(this.getStatusFilterOptions()), "all", t("筛选_状态_标签"), t("筛选_状态取反_标签"),
            () => this.getStatusFilterValues(), () => this.getStatusFilterOperator(), values => this.setStatusFilterValues(values), value => this.setStatusFilterOperator(value));
        createFilter("group", controls.group, this.getGroupFilterOptions(allLabel), "", t("筛选_分组_标签"), t("筛选_分组取反_标签"),
            () => this.getGroupFilterValues(), () => this.getGroupFilterOperator(), values => this.setGroupFilterValues(values), value => this.setGroupFilterOperator(value));
        createFilter("tag", controls.tag, this.getTagFilterOptions(allLabel), "", t("筛选_标签_标签"), t("筛选_标签取反_标签"),
            () => this.getTagFilterValues(), () => this.getTagFilterOperator(), values => this.setTagFilterValues(values), value => this.setTagFilterOperator(value));
        if (controls.delay && this.settings.DELAY) {
            createFilter("delay", controls.delay, this.getDelayFilterOptions(allLabel, true), "", t("筛选_延迟_标签"), t("筛选_延迟取反_标签"),
                () => this.getDelayFilterValues(), () => this.getDelayFilterOperator(), values => this.setDelayFilterValues(values), value => this.setDelayFilterOperator(value));
        }
    }

    private openSupportQQGroup() {
        window.open(SUPPORT_QQ_GROUP_URL);
    }

    private addSupportQQGroupMenuItem(menu: Menu) {
        menu.addItem((item) => item.setTitle(SUPPORT_QQ_GROUP_LABEL).setIcon("message-circle").onClick(() => {
            this.openSupportQQGroup();
        }));
    }

    private preparePluginUpdateButton(button: ButtonComponent) {
        const label = this.manager.translator.t("管理器_检查更新_描述");
        button.setIcon("rss");
        button.setTooltip(label);
        button.buttonEl.addClass("manager-update-trigger");
        button.buttonEl.setAttribute("aria-label", label);
        this.bindLongPressTooltip(button.buttonEl, label);
        button.onClick(() => {
            void this.runPluginUpdateCheck(button);
        });
    }

    private async runPluginUpdateCheck(trigger?: ButtonComponent | HTMLButtonElement) {
        if (!toolEnabled(this.settings, 'updates')) return;
        if (this.isCheckingPluginUpdates) return;

        this.isCheckingPluginUpdates = true;
        const config = await openPluginUpdateCheckModal(this.app, this.manager, this.manager.getPluginUpdateCheckOptions());
        if (!config) {
            this.isCheckingPluginUpdates = false;
            return;
        }
        try {
            await this.manager.setPluginUpdateCheckOptions(config);
        } catch (error) {
            this.isCheckingPluginUpdates = false;
            console.error("[BPM] save update check config failed", error);
            new Notice(this.manager.translator.t("通知_检查更新失败"));
            return;
        }

        const label = this.manager.translator.t("管理器_检查更新_描述");
        const busyLabel = this.manager.translator.t("通知_检测更新中文案");
        const buttonEl = trigger instanceof ButtonComponent ? trigger.buttonEl : trigger;
        const wasDisabled = buttonEl instanceof HTMLButtonElement ? buttonEl.disabled : false;

        buttonEl?.addClass("is-loading");
        buttonEl?.setAttribute("aria-busy", "true");

        if (trigger instanceof ButtonComponent) {
            trigger.setDisabled(true);
            trigger.setIcon("loader");
            trigger.setTooltip(busyLabel);
        } else if (buttonEl instanceof HTMLButtonElement) {
            buttonEl.disabled = true;
            buttonEl.setAttribute("title", busyLabel);
        }

        try {
            const status = await this.manager.checkUpdatesWithNotice({
                ...config,
                onChecked: (pluginId) => this.refreshCheckedPluginUpdateUi(pluginId),
            });
            this.updateStats();
            const count = this.getPluginUpdateCount(status);
            new Notice(this.manager.translator.t("通知_检查更新完成").replace("{count}", `${count}`));
        } catch (error) {
            console.error("检查更新时出错:", error);
            new Notice(this.manager.translator.t("通知_检查更新失败"));
        } finally {
            if (trigger instanceof ButtonComponent) {
                trigger.setIcon("rss");
                trigger.setTooltip(label);
                trigger.setDisabled(wasDisabled);
            } else if (buttonEl instanceof HTMLButtonElement) {
                buttonEl.disabled = wasDisabled;
                buttonEl.setAttribute("title", label);
            }
            buttonEl?.removeClass("is-loading");
            buttonEl?.removeAttribute("aria-busy");
            this.isCheckingPluginUpdates = false;
        }
    }

    private getExtraButtonEl(button: ExtraButtonComponent): HTMLElement | undefined {
        return getExtraButtonElement(button);
    }

    private async openPluginVersionList(pluginId: string, updateInfo?: PluginUpdateViewStatus | null) {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const progress = this.showInlineProgress(t("通知_获取版本中文案"), pluginId);
        progress.update(0, 1, pluginId);
        try {
            let status = updateInfo ?? (this.manager.updateStatus?.[pluginId] as PluginUpdateViewStatus | undefined);
            let repo = status?.repo || this.manager.settings.REPO_MAP?.[pluginId] || null;
            if (!repo) {
                try {
                    repo = await this.manager.repoResolver.resolveRepo(pluginId);
                } catch {
                    repo = null;
                }
            }
            if (!repo) {
                new Notice(t("下载更新_缺少仓库提示"));
                return;
            }

            const versions = await fetchReleaseVersions(this.manager, repo, { includeManifest: true });
            if (!status) status = {};
            status.repo = repo;
            status.versions = versions;
            status.error = "";
            status.message = "";
            const updateOptions = this.manager.getPluginUpdateCheckOptions();
            const target = pickSourceTargetRelease({
                id: pluginId,
                repo,
                type: "plugin",
                mode: "latest",
                includePrerelease: false,
                updateCheckMode: updateOptions.updateCheckMode,
                compatibilityMode: updateOptions.compatibilityMode,
                updateDelayDays: updateOptions.updateDelayDays || undefined,
                autoUpdate: false,
                enabled: true,
            }, versions);
            status.remoteVersion = target?.tag || status.remoteVersion || null;
            this.manager.updateStatus[pluginId] = {
                ...(this.manager.updateStatus?.[pluginId] ?? {}),
                ...status,
            };

            progress.update(1, 1, pluginId);
            this.refreshSinglePluginUpdateUi(pluginId);
            this.updateStats();
            new UpdateModal(this.app, this.manager, pluginId, versions, status.remoteVersion ?? null, repo).open();
        } catch (e) {
            console.error("[BPM] fetch remote versions failed", e);
            new Notice(t("管理器_选择版本_获取失败提示"), 4000);
        } finally {
            progress.hide();
        }
    }

    private openPluginUpdateModal(pluginId: string, updateInfo: PluginUpdateViewStatus) {
        void this.openPluginVersionList(pluginId, updateInfo);
    }

    private addPluginDownloadButton(controlEl: HTMLElement, pluginId: string, updateInfo: PluginUpdateViewStatus, prepend = false) {
        if (!updateInfo.remoteVersion) return;
        if (this.getPluginUpdateProblem(updateInfo)) return;
        if (!this.isMainPageActionOnItem("downloadUpdate")) return;
        const downloadBtn = new ExtraButtonComponent(controlEl);
        downloadBtn.setIcon("download");
        downloadBtn.setTooltip(this.manager.translator.t("管理器_下载更新_描述"));
        downloadBtn.onClick(() => this.openPluginUpdateModal(pluginId, updateInfo));
        const downloadEl = this.getExtraButtonEl(downloadBtn);
        downloadEl?.addClass("manager-plugin-card__download-update");
        downloadEl?.setAttribute("data-update-action", "download");
        if (prepend && downloadEl) controlEl.prepend(downloadEl);
    }

    private getPluginUpdateProblem(updateInfo?: PluginUpdateViewStatus | null): string {
        return updateInfo?.error || updateInfo?.message || "";
    }

    private appendPluginUpdateProblem(versionWrap: HTMLElement, updateInfo: PluginUpdateViewStatus) {
        const message = this.getPluginUpdateProblem(updateInfo);
        if (!message) return;
        const isError = Boolean(updateInfo.error);
        const label = this.manager.translator.t(isError ? "更新_检测错误标签" : "更新_无法检测标签");
        const problem = createSpan({
            text: label,
            cls: ["manager-item__name-update-problem", isError ? "is-error" : "is-warning"],
        });
        problem.setAttribute("role", "status");
        problem.setAttribute("title", this.manager.translator.t("更新_检测错误提示", { message }));
        versionWrap.appendChild(problem);
    }

    private refreshSinglePluginUpdateUi(pluginId: string) {
        const card = Array.from(this.pageEl.querySelectorAll<HTMLElement>(".manager-plugin-card[data-plugin-id]"))
            .find((el) => el.getAttribute("data-plugin-id") === pluginId);
        if (!card) return;

        const updateInfo = this.manager.updateStatus?.[pluginId] as PluginUpdateViewStatus | undefined;
        const updateProblem = this.getPluginUpdateProblem(updateInfo);
        const hasUpdate = Boolean(updateInfo?.hasUpdate);
        const hasRemoteVersion = Boolean(updateInfo?.hasUpdate && updateInfo.remoteVersion && !updateProblem);

        card.toggleClass("has-update", hasUpdate);
        card.toggleClass("has-update-problem", Boolean(updateProblem));

        const versionWrap = card.querySelector<HTMLElement>(".manager-item__versions");
        versionWrap?.querySelectorAll(".manager-item__name-remote-arrow, .manager-item__name-remote, .manager-item__name-update-problem")
            .forEach((el) => el.remove());
        if (versionWrap && updateInfo && updateProblem) {
            this.appendPluginUpdateProblem(versionWrap, updateInfo);
        } else if (versionWrap && hasRemoteVersion && updateInfo?.remoteVersion) {
            const arrow = createSpan({ text: "→", cls: ["manager-item__name-remote-arrow"] });
            const remote = createSpan({ text: updateInfo.remoteVersion, cls: ["manager-item__name-remote"] });
            versionWrap.appendChild(arrow);
            versionWrap.appendChild(remote);
        }

        const controlEl = card.querySelector<HTMLElement>(".manager-plugin-card__actions");
        controlEl?.querySelectorAll(".manager-plugin-card__download-update").forEach((el) => el.remove());
        if (controlEl && hasRemoteVersion && updateInfo && !this.editorMode && !Platform.isMobile) {
            this.addPluginDownloadButton(controlEl, pluginId, updateInfo, true);
        }

        const manifest = this.getUniquePluginManifests().find((plugin) => plugin.id === pluginId);
        const managerPlugin = this.manager.settings.Plugins.find((plugin) => plugin.id === pluginId);
        if (manifest && managerPlugin) {
            const isEnabled = this.isPluginEnabledForDisplay(pluginId, managerPlugin);
            const hiddenPluginIds = new Set(this.settings.HIDES || []);
            if (!this.matchesStatusFilter(managerPlugin, manifest, isEnabled, this.getStatusFilterValues(), this.getStatusFilterOperator(), hiddenPluginIds)) {
                this.removePluginCardFromView(pluginId);
            }
        }
    }

    private findPluginCard(pluginId: string): HTMLElement | null {
        return Array.from(this.pageEl.querySelectorAll<HTMLElement>(".manager-plugin-card[data-plugin-id]"))
            .find((el) => el.getAttribute("data-plugin-id") === pluginId) ?? null;
    }

    private getPluginManifest(pluginId: string): PluginManifest | undefined {
        return (this.appPlugins.manifests as Record<string, PluginManifest | undefined>)?.[pluginId]
            ?? this.getUniquePluginManifests().find((plugin) => plugin.id === pluginId);
    }

    private getManagerPlugin(pluginId: string): ManagerPlugin | undefined {
        return this.manager.settings.Plugins.find((plugin) => plugin.id === pluginId);
    }

    private hasLoadedPluginInstance(pluginId: string): boolean {
        const plugins = (this.appPlugins as { plugins?: Record<string, unknown> | Map<string, unknown> }).plugins;
        if (plugins instanceof Map) return plugins.has(pluginId);
        if (plugins && typeof plugins === "object" && Boolean(plugins[pluginId])) return true;

        const getPlugin = (this.appPlugins as { getPlugin?: (id: string) => unknown }).getPlugin;
        if (typeof getPlugin !== "function") return false;
        try {
            return Boolean(getPlugin.call(this.appPlugins, pluginId));
        } catch {
            return false;
        }
    }

    private isPluginEnabledForDisplay(pluginId: string, managerPlugin?: ManagerPlugin): boolean {
        const session = this.manager.overview.pluginState(pluginId);
        if (session) return session.enabled;
        const pluginSettings = managerPlugin ?? this.getManagerPlugin(pluginId);
        // 外域插件页只展示该作用域保存的状态，不读本机运行时。
        if (this.manager.devices?.isProjectingForeign('plugins')) return Boolean(pluginSettings?.enabled);
        if (this.settings.DELAY && !pluginSettings?.tags?.includes(BPM_IGNORE_TAG)) return Boolean(pluginSettings?.enabled);
        return this.appPlugins.enabledPlugins.has(pluginId)
            || this.singleStartedPluginIds.has(pluginId)
            || this.hasLoadedPluginInstance(pluginId);
    }

    private pluginMatchesCurrentView(managerPlugin: ManagerPlugin, manifest: PluginManifest, isEnabled: boolean): boolean {
        const hiddenPluginIds = new Set(this.settings.HIDES || []);
        const lowerSearchText = this.searchText.trim().toLowerCase();
        if (!this.matchesStatusFilter(managerPlugin, manifest, isEnabled, this.getStatusFilterValues(), this.getStatusFilterOperator(), hiddenPluginIds)) return false;
        if (!this.matchesSingleValueFilter(managerPlugin.group, this.getGroupFilterValues(), this.getGroupFilterOperator())) return false;
        if (!this.matchesTagFilter(managerPlugin.tags, this.getTagFilterValues(), this.getTagFilterOperator())) return false;
        if (!this.matchesSingleValueFilter(managerPlugin.delay, this.getDelayFilterValues(), this.getDelayFilterOperator())) return false;
        if (lowerSearchText !== "" && !this.getPluginSearchText(managerPlugin, manifest).includes(lowerSearchText)) return false;
        const isSelf = manifest.id === this.manager.manifest.id;
        if (!this.editorMode && !isSelf && hiddenPluginIds.has(manifest.id) && !this.getStatusFilterValues().includes("hidden")) return false;
        return true;
    }

    private removePluginCardFromView(pluginId: string) {
        this.findPluginCard(pluginId)?.remove();
        this.pluginCardControllers.delete(pluginId);
        this.displayPlugins = this.displayPlugins.filter((plugin) => plugin.id !== pluginId);
        this.syncPluginEmptyState();
        this.updateBulkBar();
        this.updateStats();
    }

    public refreshPluginCard(pluginId: string, options: { allowReload?: boolean } = {}) {
        if (this.activePage !== "plugins" || this.installMode) return;
        const manifest = this.getPluginManifest(pluginId);
        const managerPlugin = this.getManagerPlugin(pluginId);
        const controller = this.pluginCardControllers.get(pluginId);
        const card = controller?.cardEl ?? this.findPluginCard(pluginId);
        if (!manifest || !managerPlugin || !card) {
            if (options.allowReload || (manifest && managerPlugin && this.pluginMatchesCurrentView(managerPlugin, manifest, this.isPluginEnabledForDisplay(pluginId, managerPlugin)))) {
                void this.reloadShowData();
            }
            return;
        }

        const isSelf = pluginId === this.manager.manifest.id;
        const isEnabled = this.isPluginEnabledForDisplay(pluginId, managerPlugin);
        if (!this.pluginMatchesCurrentView(managerPlugin, manifest, isEnabled)) {
            this.removePluginCardFromView(pluginId);
            return;
        }

        const statusChip = controller?.statusChip ?? card.querySelector<HTMLElement>(".manager-plugin-card__state");
        const cardIcon = controller?.cardIcon ?? card.querySelector<HTMLElement>(".manager-plugin-card__icon");
        card.toggleClass("is-enabled", isEnabled);
        card.toggleClass("is-disabled", !isEnabled);
        card.toggleClass("is-self", isSelf);
        card.toggleClass("is-bpm-ignored", managerPlugin.tags.includes(BPM_IGNORE_TAG));
        card.toggleClass("is-hidden-layout", this.isPluginHidden(pluginId));
        card.toggleClass("is-bulk-selected", this.bulkSelectedPluginIds.has(pluginId));
        const bulkCheckbox = card.querySelector<HTMLInputElement>(".manager-plugin-card__bulk-select input[type='checkbox']");
        if (bulkCheckbox) bulkCheckbox.checked = this.bulkSelectedPluginIds.has(pluginId);
        if (this.settings.FADE_OUT_DISABLED_PLUGINS) card.toggleClass("inactive", !isEnabled);
        else card.removeClass("inactive");

        if (statusChip) {
            statusChip.setText(isSelf
                ? this.manager.translator.t("管理器_状态_管理器")
                : (isEnabled ? this.manager.translator.t("管理器_状态_启用中") : this.manager.translator.t("管理器_状态_已禁用")));
            statusChip.removeClass("is-self", "is-enabled", "is-disabled");
            statusChip.addClass(isSelf ? "is-self" : (isEnabled ? "is-enabled" : "is-disabled"));
        }
        if (cardIcon) {
            this.manager.pluginIcons.render(cardIcon, pluginId, isEnabled);
        }

        controller?.syncToggleValue?.(isSelf ? true : isEnabled);
        controller?.toggleSwitch?.setDisabled(isSelf);
        controller?.singleStartButton?.setDisabled(isSelf || isEnabled);
        controller?.restartButton?.setDisabled(isSelf || !isEnabled);
        controller?.enableIgnoredButton?.setDisabled(isSelf || !managerPlugin.tags.includes(BPM_IGNORE_TAG));
        if (controller?.openPluginSetting) {
            controller.openPluginSetting.setDisabled(!isEnabled);
            controller.openPluginSettingEl?.classList.toggle("manager-display-none", !isEnabled);
        }

        const title = card.querySelector<HTMLElement>(".manager-item__name-title");
        if (title) {
            title.setText(managerPlugin.name);
            title.setAttribute("title", manifest.name || "");
        }
        const localVersion = card.querySelector<HTMLElement>(".manager-item__name-version");
        if (localVersion) localVersion.setText(`[${manifest.version}]`);
        const desc = card.querySelector<HTMLElement>(".manager-plugin-card__desc");
        if (desc) {
            desc.setText(managerPlugin.desc);
            desc.setAttribute("title", manifest.description || "");
        }

        const header = card.querySelector<HTMLElement>(".manager-plugin-card__header");
        const titleRow = header?.querySelector<HTMLElement>('.manager-plugin-card__title-row');
        const metadataRow = header?.querySelector<HTMLElement>('.manager-plugin-card__metadata-row');
        const groupSettingsById = new Map(this.settings.GROUPS.map((group) => [group.id, group]));
        header?.querySelectorAll(".manager-item__name-group").forEach((el) => el.remove());
        if (header && (managerPlugin.group !== "" || this.editorMode)) {
            const group = createSpan({ cls: "manager-item__name-group" });
            const groupSetting = groupSettingsById.get(managerPlugin.group);
            if (groupSetting) {
                const tag = this.manager.createTag(groupSetting.name, groupSetting.color, this.settings.GROUP_STYLE);
                tag.addClass("manager-item__group-chip");
                tag.setAttribute("role", "button");
                tag.setAttribute("tabindex", "0");
                tag.setAttribute("aria-label", this.manager.translator.t("分组编辑_打开切换", { name: managerPlugin.name || manifest.name || manifest.id }));
                const openGroupModal = (event?: Event) => {
                    event?.preventDefault();
                    event?.stopPropagation();
                    new GroupModal(this.app, this.manager, this, managerPlugin).open();
                };
                tag.onclick = openGroupModal;
                tag.addEventListener("keydown", (event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    openGroupModal(event);
                });
                group.appendChild(tag);
            } else if (this.editorMode) {
                const tag = this.manager.createTag("+", "", "");
                tag.onclick = () => { new GroupModal(this.app, this.manager, this, managerPlugin).open(); };
                group.appendChild(tag);
            }
            titleRow?.prepend(group);
        }

        let noteEl = card.querySelector<HTMLElement>(".manager-plugin-card__note");
        if (managerPlugin.note?.length > 0) {
            if (!noteEl) {
                noteEl = createSpan({ cls: "manager-plugin-card__note" });
                noteEl.addEventListener("click", () => { new NoteModal(this.app, this.manager, managerPlugin, this).open(); });
                setIcon(noteEl, "notebook-pen");
                titleRow?.appendChild(noteEl);
            }
        } else {
            noteEl?.remove();
        }

        header?.querySelectorAll(".manager-item__name-delay").forEach((el) => el.remove());
        if (this.settings.DELAY && !this.editorMode && !isSelf && managerPlugin.delay !== "") {
            const delay = this.settings.DELAYS.find((item) => item.id === managerPlugin.delay);
            if (delay) {
                const delayEl = this.createDelayBadge(delay.time);
                metadataRow?.prepend(delayEl);
            }
        }

        if (titleRow) {
            this.renderPluginReleaseBadge(titleRow, manifest.version);
            this.renderDesktopOnlyBadge(titleRow, manifest, titleRow.querySelector<HTMLElement>(".manager-item__versions") ?? undefined);
        }
        if (statusChip?.parentElement) this.renderRecentInstallBadge(statusChip.parentElement, this.readRecentInstallTimestamp(pluginId));

        const tagsEl = card.querySelector<HTMLElement>(".manager-plugin-card__tags");
        let visibleTagCount = 0;
        if (tagsEl) {
            tagsEl.empty();
            const tagSettingsById = new Map(this.settings.TAGS.map((tag) => [tag.id, tag]));
            managerPlugin.tags.forEach((id) => {
                const tagSetting = tagSettingsById.get(id);
                if (!tagSetting) return;
                if ((tagSetting.id === BPM_TAG_ID || tagSetting.id === BPM_IGNORE_TAG) && this.settings.HIDE_BPM_TAG) return;
                const tag = this.manager.createTag(tagSetting.name, tagSetting.color, this.settings.TAG_STYLE);
                if (this.editorMode && tagSetting.id !== BPM_TAG_ID) tag.onclick = () => { new TagsModal(this.app, this.manager, this, managerPlugin).open(); };
                tagsEl.appendChild(tag);
                visibleTagCount++;
            });
            if (this.editorMode) {
                const tag = this.manager.createTag("+", "", "");
                tag.onclick = () => { new TagsModal(this.app, this.manager, this, managerPlugin).open(); };
                tagsEl.appendChild(tag);
            }
        }
        const hasDescription = managerPlugin.desc.trim().length > 0;
        const hasNote = Boolean(managerPlugin.note?.trim().length);
        const noteView = card.querySelector<HTMLElement>(".manager-plugin-card__note-view");
        if (hasNote !== Boolean(noteView)) {
            // 笔记从无到有/从有到无会改变描述区的切换控件，直接重绘卡片列表。
            void this.reloadShowData();
            return;
        }
        if (noteView && hasNote) noteView.setText(managerPlugin.note || "");
        const hasVisibleTags = this.editorMode || visibleTagCount > 0;
        const hasDateMeta = Boolean(card.querySelector(".manager-plugin-card__date-meta"));
        const hasExpandedDetails = this.editorMode || hasDescription || hasNote || hasVisibleTags || hasDateMeta;
        card.toggleClass("has-description", hasDescription);
        card.toggleClass("has-visible-tags", hasVisibleTags);
        card.toggleClass("has-date-meta", hasDateMeta);
        card.querySelector<HTMLElement>(".manager-plugin-card__body")
            ?.toggleClass("manager-plugin-card__body--empty", !hasExpandedDetails);

        this.refreshSinglePluginUpdateUi(pluginId);
        this.syncPluginEmptyState();
        this.updateBulkBar();
        this.updateStats();
    }

    private refreshCheckedPluginUpdateUi(pluginId: string) {
        if (this.activePage !== "plugins" || this.installMode) return;
        const statusValues = this.getStatusFilterValues();
        const statusChangesCardMembership = statusValues.includes("has-update")
            || this.getStatusFilterOperator() === "not-contains";
        if (statusChangesCardMembership) {
            this.refreshPluginCard(pluginId, { allowReload: true });
            return;
        }
        this.refreshSinglePluginUpdateUi(pluginId);
    }

    public refreshVisiblePluginCards() {
        const statusValues = this.getStatusFilterValues();
        if (statusValues.includes("has-update") || this.getStatusFilterOperator() === "not-contains") {
            void this.reloadShowData();
            return;
        }
        const visiblePluginIds = Array.from(this.pageEl.querySelectorAll<HTMLElement>(".manager-plugin-card[data-plugin-id]"))
            .map((card) => card.getAttribute("data-plugin-id"))
            .filter((pluginId): pluginId is string => Boolean(pluginId));
        visiblePluginIds.forEach((pluginId) => this.refreshPluginCard(pluginId));
        this.updateStats();
    }

    private getMainPageActionPlacement(actionId: MainPageActionId) {
        return this.settings.MAIN_PAGE_ACTION_PLACEMENT?.[actionId]
            ?? DEFAULT_MAIN_PAGE_ACTION_PLACEMENT[actionId];
    }

    private isMainPageActionOnItem(actionId: MainPageActionId): boolean {
        return this.getMainPageActionPlacement(actionId) === "item";
    }

    private isMainPageActionInMenu(actionId: MainPageActionId): boolean {
        return this.getMainPageActionPlacement(actionId) === "menu";
    }

    /** 这些次要操作始终进“更多”菜单，不再单独占图标。 */
    private actionInMore(actionId: MainPageActionId): boolean {
        return ManagerModal.DESKTOP_MORE_ACTION_IDS.has(actionId) || this.isMainPageActionInMenu(actionId);
    }

    private createConfiguredItemAction(controlEl: HTMLElement, actionId: MainPageActionId): ExtraButtonComponent | null {
        // 桌面端把这组次要操作收进卡片右下角的“更多”菜单。
        if (ManagerModal.DESKTOP_MORE_ACTION_IDS.has(actionId)) return null;
        if (!this.isMainPageActionOnItem(actionId)) return null;
        return new ExtraButtonComponent(controlEl);
    }

    /** 桌面端更多菜单：检查更新、隐藏、仓库、清空/删除、快捷键、笔记、复制 ID。 */
    private renderDesktopPluginMore(controlEl: HTMLElement, plugin: PluginManifest,
        ManagerPlugin: ManagerPlugin, pluginDir: string, isSelf: boolean): void {
        const t = (key: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(key, vars);
        const more = new ExtraButtonComponent(controlEl);
        more.setIcon("more-vertical");
        more.setTooltip(t("管理器_更多操作_描述"));
        more.extraSettingsEl.addClass("manager-plugin-more");
        const moreEl = getExtraButtonElement(more);
        moreEl?.addEventListener("click", (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const menu = new Menu();
            menu.addItem((item) => item
                .setTitle(t("菜单_检查更新_标题"))
                .setIcon("rss")
                .setDisabled(isSelf)
                .onClick(async () => { await this.runSinglePluginUpdateCheck(plugin.id); }));
            menu.addItem((item) => item
                .setTitle(t("菜单_隐藏插件_标题"))
                .setIcon("eye-off")
                .setDisabled(isSelf)
                .onClick(() => { if (!isSelf) this.togglePluginHidden(plugin.id); }));
            menu.addSeparator();
            const knownRepo = this.manager.settings.REPO_MAP?.[plugin.id] || null;
            menu.addItem((item) => item
                .setTitle(t("管理器_打开仓库_标题"))
                .setIcon("github")
                .onClick(async () => { await this.openPluginRepo(plugin.id, knownRepo); }));
            menu.addItem((item) => item
                .setTitle(t("管理器_打开目录_描述"))
                .setIcon("folder-open")
                .onClick(() => { managerOpen(pluginDir, this.manager); }));
            menu.addItem((item) => item
                .setTitle(t("管理器_清空配置_描述"))
                .setIcon("file-cog")
                .setDisabled(isSelf)
                .onClick(async () => { await this.clearPluginConfig(plugin, isSelf); }));
            menu.addItem((item) => item
                .setTitle(t("管理器_删除插件_描述"))
                .setIcon("trash")
                .setDisabled(isSelf)
                .onClick(async () => { await this.uninstallPluginWithConfirm(plugin, isSelf); }));
            menu.addSeparator();
            menu.addItem((item) => item
                .setTitle(t("菜单_快捷键_标题"))
                .setIcon("circle-plus")
                .onClick(async () => { await this.openPluginHotkeys(plugin.id); }));
            menu.addItem((item) => item
                .setTitle(t("菜单_笔记_标题"))
                .setIcon("notebook-pen")
                .onClick(() => { new NoteModal(this.app, this.manager, ManagerPlugin, this).open(); }));
            menu.addItem((item) => item
                .setTitle(t("菜单_复制ID_标题"))
                .setIcon("copy")
                .onClick(() => { this.copyPluginId(plugin.id); }));
            menu.showAtMouseEvent(event);
        });
    }

    private resolvePluginRepoAction(pluginId: string, repo: string | null): PluginRepoActionState {
        if (repo) {
            return {
                repo,
                tooltip: this.manager.translator.t("管理器_打开仓库_提示").replace("{repo}", repo),
                disabled: false,
            };
        }

        const isBpmInstall = this.manager.settings.BPM_INSTALLED.includes(pluginId);
        return {
            repo: null,
            tooltip: isBpmInstall
                ? this.manager.translator.t("管理器_仓库未记录_提示")
                : this.manager.translator.t("管理器_仓库需手动添加_提示"),
            disabled: true,
        };
    }

    private handleMissingRepo(pluginId: string) {
        const isBpmInstall = this.manager.settings.BPM_INSTALLED.includes(pluginId);
        new Notice(isBpmInstall
            ? this.manager.translator.t("管理器_仓库未记录_提示")
            : this.manager.translator.t("管理器_仓库需手动添加_提示"));
    }

    private async openPluginRepo(pluginId: string, repo?: string | null) {
        const resolvedRepo = repo ?? await this.manager.repoResolver.resolveRepo(pluginId);
        if (resolvedRepo) {
            window.open(`https://github.com/${resolvedRepo}`);
            return;
        }
        this.handleMissingRepo(pluginId);
    }

    /** 外域预设只保存配置，本机插件生命周期/配置文件操作必须切回本机。 */
    private blockForeignScopeAction(action: string): boolean {
        if (!this.manager.devices?.isProjectingForeign()) return false;
        new Notice(this.manager.translator.t('设备_外域操作拦截', { action }), 5000);
        return true;
    }

    private async uninstallPluginWithConfirm(plugin: PluginManifest, isSelf: boolean) {
        if (this.blockForeignScopeAction(this.manager.translator.t('管理器_删除插件_描述'))) return;
        if (isSelf) return;
        new DeleteModal(this.app, this.manager, async () => {
            await this.appPlugins.uninstallPlugin(plugin.id);
            await this.appPlugins.loadManifests();
            this.invalidatePluginCaches();
            void this.reloadShowData();
            Commands(this.app, this.manager);
            this.manager.synchronizePlugins(Object.values(this.appPlugins.manifests).filter((pm: PluginManifest) => pm.id !== this.manager.manifest.id));
            new Notice(this.manager.translator.t("卸载_通知_一"));
        }, { id: plugin.id, name: plugin.name }).open();
    }

    private async clearPluginConfig(plugin: PluginManifest, isSelf: boolean) {
        if (this.blockForeignScopeAction(this.manager.translator.t('管理器_清空配置_描述'))) return;
        if (isSelf) {
            new Notice(this.manager.translator.t("管理器_清空配置_自身拦截"));
            return;
        }
        const configPath = normalizePath(`${this.app.vault.configDir}/plugins/${plugin.id}/data.json`);
        const adapter = this.app.vault.adapter;
        try {
            if (!(await adapter.exists(configPath))) {
                new Notice(this.manager.translator.t("管理器_清空配置_无配置"));
                return;
            }
            const pluginName = plugin.name || plugin.id;
            if (!(await confirmWithModal(this.app, this.manager, this.manager.translator.t("管理器_清空配置_确认", { name: pluginName })))) return;
            await adapter.remove(configPath);
            new Notice(this.manager.translator.t("管理器_清空配置_成功"));
        } catch (error) {
            console.error("[BPM] clear plugin config failed", plugin.id, error);
            new Notice(this.manager.translator.t("管理器_清空配置_失败"));
        }
    }

    private async singleStartPlugin(plugin: PluginManifest) {
        if (this.blockForeignScopeAction(this.manager.translator.t('菜单_单次启动_描述'))) return;
        new Notice(this.manager.translator.t("管理器_单次启动中_提示"));
        await this.appPlugins.enablePlugin(plugin.id);
        this.singleStartedPluginIds.add(plugin.id);
        this.refreshPluginCard(plugin.id, { allowReload: true });
    }

    private async restartPlugin(plugin: PluginManifest) {
        if (this.blockForeignScopeAction(this.manager.translator.t('菜单_重启插件_描述'))) return;
        const heapBefore = readHeapMB();
        new Notice(this.manager.translator.t("管理器_重启中_提示"));
        await this.appPlugins.disablePlugin(plugin.id);
        await this.manager.overview.setPluginState(plugin.id, { enabled: true });
        this.singleStartedPluginIds.delete(plugin.id);
        this.refreshPluginCard(plugin.id, { allowReload: true });
        void this.reportRestartCost(plugin.id, heapBefore);
    }

    /**
     * Reports what a restart cost, once the plugin has had a moment to settle.
     *
     * Measuring cannot give the memory back — see `memory-reclaim.ts` for why no plugin can force
     * a collection, and why one would not help: the previous instance is retained, not garbage. What
     * it does is make the cost visible, so restarting something that rebuilds a large cache on load
     * is a deliberate choice rather than a free one.
     */
    private async reportRestartCost(pluginId: string, heapBefore: number | null): Promise<void> {
        await new Promise((resolve) => window.setTimeout(resolve, RECLAIM_SETTLE_MS));
        const delta = describeHeapDelta(heapBefore, readHeapMB());
        if (!delta) return;
        if (Math.abs(delta.deltaMB) >= RECLAIM_NOTICE_THRESHOLD_MB) {
            new Notice(`${pluginId}: ${delta.label}`, 5000);
        }
    }

    private async enableBpmIgnoredPlugin(plugin: PluginManifest, managerPlugin: ManagerPlugin) {
        if (this.blockForeignScopeAction(this.manager.translator.t('提示_BPM忽略_操作拦截'))) return;
        if (!managerPlugin.tags.includes(BPM_IGNORE_TAG)) return;
        managerPlugin.enabled = this.isPluginEnabledForDisplay(plugin.id, managerPlugin);
        managerPlugin.tags = managerPlugin.tags.filter((tag) => tag !== BPM_IGNORE_TAG);
        this.manager.applySpecialPluginTags(managerPlugin);
        await this.manager.savePluginAndExport(plugin.id);
        this.singleStartedPluginIds.delete(plugin.id);
        Commands(this.app, this.manager);
        // 该插件脱离 BPM 忽略状态后其 ribbon 图标才纳入管理，登记一次
        this.manager.applyRibbonSettings();
        new Notice(this.manager.translator.t("管理器_启用BPM忽略插件中_提示"));
        await this.reloadShowData();
    }

    private togglePluginHidden(pluginId: string) {
        const isHidden = this.settings.HIDES.includes(pluginId);
        this.setPluginHidden(pluginId, !isHidden);
    }

    private setPluginHidden(pluginId: string, hidden: boolean) {
        if (pluginId === this.manager.manifest.id) return;
        if (hidden) {
            if (!this.settings.HIDES.includes(pluginId)) this.settings.HIDES.push(pluginId);
        } else {
            this.settings.HIDES = this.settings.HIDES.filter(id => id !== pluginId);
        }
        void this.manager.saveSettings();
        this.refreshPluginCard(pluginId, { allowReload: true });
    }

    private async openPluginHotkeys(pluginId: string) {
        await this.appSetting.open();
        await this.appSetting.openTabById("hotkeys");
        const tab = this.appSetting.activeTab;
        if (!tab) return;
        tab.searchComponent.inputEl.value = pluginId;
        tab.updateHotkeyVisibility();
        tab.searchComponent.inputEl.blur();
    }

    private openSettingsTab(tabId: string) {
        if (tabId !== this.manager.manifest.id && this.appPlugins.manifests[tabId]
            && this.blockForeignScopeAction(this.manager.translator.t('管理器_插件设置_描述'))) return;
        void (async () => {
            await this.appSetting.open();
            await this.appSetting.openTabById(tabId);
        })();
    }

    private copyPluginId(pluginId: string) {
        void navigator.clipboard.writeText(pluginId);
        new Notice(this.manager.translator.t("通知_ID已复制"));
    }

    private openCatalog(): void {
        if (!toolEnabled(this.settings, 'catalog')) return;
        this.catalogModal?.close();
        this.catalogModal = new CatalogModal(this.app, this.manager, repo => {
            this.installType = "plugin";
            this.installRepo = repo;
            this.installVersion = "";
            this.installVersions = [];
            this.activePage = "install";
            this.syncPageChrome();
            this.renderContent();
            if (Platform.isMobile) this.showHeadMobile();
        });
        this.catalogModal.open();
    }

    private async openPluginMarket() {
        if (!toolEnabled(this.settings, 'pluginMarket')) return;
        await this.appSetting.open();
        await this.appSetting.openTabById("community-plugins");
        window.setTimeout(() => {
            const tab = this.appSetting.activeTab;
            const marketButton = tab?.containerEl?.querySelector<HTMLButtonElement>("button.mod-cta");
            marketButton?.click();
        }, 50);
    }

    private async openAppearanceMarket() {
        if (!toolEnabled(this.settings, 'appearanceMarket')) return;
        await this.appSetting.open();
        await this.appSetting.openTabById("appearance");
        window.setTimeout(() => {
            const tab = this.appSetting.activeTab;
            const marketButton = tab?.containerEl?.querySelector<HTMLButtonElement>("button.mod-cta");
            marketButton?.click();
        }, 50);
    }

    private async runSinglePluginUpdateCheck(pluginId: string) {
        const progress = this.showInlineProgress(this.manager.translator.t("通知_检测更新中文案"), pluginId);
        progress.update(0, 1, pluginId);
        try {
            const status = await this.manager.checkUpdateForPlugin(pluginId, this.manager.getPluginUpdateCheckOptions());
            progress.update(1, 1, pluginId);
            this.refreshSinglePluginUpdateUi(pluginId);
            this.updateStats();
            if (status?.error) {
                new Notice(this.manager.translator.t("通知_检查更新失败"));
            }
        } catch (error) {
            console.error("检查单个插件更新时出错:", error);
            new Notice(this.manager.translator.t("通知_检查更新失败"));
        } finally {
            progress.hide();
        }
    }

    /** 标记 manifest 声明仅桌面端的插件；Mark plugins whose manifest declares desktop-only support. */
    private renderDesktopOnlyBadge(parent: HTMLElement, manifest: Pick<PluginManifest, "isDesktopOnly">, versionWrap?: HTMLElement): void {
        parent.querySelector(".manager-plugin-card__platform-badge")?.remove();
        if (manifest.isDesktopOnly !== true) return;
        const label = this.manager.translator.t("管理器_仅桌面端");
        const badge = createSpan({ cls: "manager-plugin-card__platform-badge" });
        badge.setAttribute("role", "img");
        badge.setAttribute("aria-label", label);
        badge.setAttribute("title", this.manager.translator.t("管理器_仅桌面端_说明"));
        setIcon(badge.createSpan({ cls: "manager-plugin-card__platform-badge-icon" }), "smartphone");
        (versionWrap ?? parent).insertAdjacentElement("afterend", badge);
    }

    /** 仅标记已安装版本的发布通道；Show the installed version channel, independently of update preferences. */
    private renderPluginReleaseBadge(parent: HTMLElement, version: string): void {
        parent.querySelector('.manager-plugin-card__release')?.remove();
        const prerelease = /^v?[0-9]+[.][0-9]+[.][0-9]+-([^+]+)/i.exec(version.trim())?.[1];
        const channel = prerelease ? /(?:^|[.-])(rc|preview)(?=[0-9]*(?:[.-]|$))/i.exec(prerelease)?.[1].toLowerCase() : undefined;
        if (!channel) return;
        const badge = parent.createSpan({ cls: 'manager-plugin-card__release', text: channel === 'rc' ? 'RC' : 'Preview' });
        parent.querySelector('.manager-item__versions')?.insertAdjacentElement('afterend', badge);
    }

    private getRecentInstallDays(): number {
        const days = this.settings.RECENT_INSTALL_DAYS;
        return Number.isFinite(days) && days >= 0 ? Math.floor(days) : 7;
    }

    private isRecentlyInstalled(installedAt?: number, now = Date.now()): boolean {
        const days = this.getRecentInstallDays();
        if (!installedAt || !Number.isFinite(installedAt) || days <= 0) return false;
        const age = now - installedAt;
        return age >= 0 && age <= days * 24 * 60 * 60 * 1000;
    }

    /** Badge and status filter share the same installation window. */
    private renderRecentInstallBadge(parent: HTMLElement, installedAt?: number): void {
        parent.querySelector(".manager-plugin-card__recent-install")?.remove();
        const days = this.getRecentInstallDays();
        if (!this.isRecentlyInstalled(installedAt)) return;
        const badge = parent.createSpan({ cls: "manager-plugin-card__recent-install" });
        setIcon(badge.createSpan({ cls: "manager-plugin-card__recent-install-icon" }), "clock-4");
        badge.createSpan({ text: this.manager.translator.t("管理器_最近安装") });
        badge.setAttribute("title", this.manager.translator.t("管理器_最近安装_提示", { days }));
    }

    private readRecentInstallTimestamp(pluginId: string): number | undefined {
        return this.pluginDateMetaById.get(pluginId)?.installedAt;
    }

    private createDelayBadge(seconds: number): HTMLElement {
        const badge = createSpan({ cls: 'manager-item__name-delay' });
        setIcon(badge.createSpan('manager-item__delay-icon'), 'timer');
        badge.createSpan({ text: seconds + 's' });
        return badge;
    }

    private isManagedPluginEnabled(pluginId: string): boolean {
        const session = this.manager.overview.pluginState(pluginId);
        if (session) return session.enabled;
        if (this.settings.DELAY) {
            return Boolean(this.settings.Plugins.find((plugin) => plugin.id === pluginId)?.enabled);
        }
        return this.isPluginEnabledForDisplay(pluginId);
    }

    private getSelectedManagerPlugins(): ManagerPlugin[] {
        return this.settings.Plugins.filter((plugin) => this.bulkSelectedPluginIds.has(plugin.id));
    }

    private getSelectableDisplayedPluginIds(): string[] {
        return this.displayPlugins
            .map((plugin) => plugin.id)
            .filter((id) => id !== this.manager.manifest.id);
    }

    private getBulkSelectedCount(): number {
        return this.getSelectedManagerPlugins().length;
    }

    private cleanupBulkSelection() {
        const validIds = new Set(this.settings.Plugins.map((plugin) => plugin.id));
        for (const id of Array.from(this.bulkSelectedPluginIds)) {
            if (!validIds.has(id) || id === this.manager.manifest.id) this.bulkSelectedPluginIds.delete(id);
        }
    }

    private setBulkEditMode(value: boolean) {
        if (value && !toolEnabled(this.settings, 'bulkEdit')) return;
        if (value && this.activePage !== "plugins") return;
        this.bulkEditMode = value;
        if (value) this.editorMode = false;
        if (!value) this.bulkSelectedPluginIds.clear();
        this.applyEditingStyle();
        this.renderContent();
        if (Platform.isMobile) this.showHeadMobile();
    }

    private async setEditorMode(value: boolean) {
        if (value && !toolEnabled(this.settings, 'layoutEditor')) return;
        if (value && this.activePage !== "plugins") return;
        if (this.editorMode === value) {
            this.applyEditingStyle();
            this.syncPageChrome();
            return;
        }
        this.editorMode = value;
        if (value && this.bulkEditMode) {
            this.bulkEditMode = false;
            this.bulkSelectedPluginIds.clear();
        }
        this.applyEditingStyle();
        if (!value) {
            await this.refreshFilterOptions(true);
        } else {
            this.renderContent();
        }
        if (Platform.isMobile) this.showHeadMobile();
    }

    private toggleBulkPluginSelection(pluginId: string, selected: boolean) {
        if (pluginId === this.manager.manifest.id) return;
        if (selected) this.bulkSelectedPluginIds.add(pluginId);
        else this.bulkSelectedPluginIds.delete(pluginId);
        this.refreshPluginCard(pluginId);
    }

    private selectDisplayedPlugins() {
        this.bulkSelectedPluginIds = new Set(this.getSelectableDisplayedPluginIds());
        this.refreshBulkSelectionUi();
    }

    private clearBulkSelection() {
        this.bulkSelectedPluginIds.clear();
        this.refreshBulkSelectionUi();
    }

    private createBulkActionButton(container: HTMLElement, icon: string, label: string, onClick: (event: MouseEvent) => void, disabled = false) {
        const button = container.createEl("button", { cls: "manager-bulk-bar__button" });
        button.type = "button";
        button.disabled = disabled;
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
        const iconEl = button.createSpan({ cls: "manager-bulk-bar__button-icon" });
        iconEl.setAttribute("aria-hidden", "true");
        setIcon(iconEl, icon);
        button.createSpan({ cls: "manager-bulk-bar__button-label", text: label });
        button.addEventListener("click", onClick);
        this.bindLongPressTooltip(button, label);
        return button;
    }

    private showBulkGroupMenu(event: MouseEvent) {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const menu = new Menu();
        menu.addItem((item) => item
            .setTitle(t("批量编辑_清除分组"))
            .setIcon("folder-x")
            .onClick(() => { void this.applyBulkGroup(""); }));
        if (this.settings.GROUPS.length > 0) menu.addSeparator();
        for (const group of this.settings.GROUPS) {
            menu.addItem((item) => item
                .setTitle(group.name || group.id)
                .setIcon("folder-tree")
                .onClick(() => { void this.applyBulkGroup(group.id); }));
        }
        menu.showAtMouseEvent(event);
    }

    private showBulkTagMenu(event: MouseEvent, mode: "add" | "remove") {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const menu = new Menu();
        const tags = this.settings.TAGS.filter((tag) => tag.id !== BPM_TAG_ID);
        if (mode === "remove") {
            menu.addItem((item) => item
                .setTitle(t("批量编辑_清除全部标签"))
                .setIcon("tags")
                .onClick(() => { void this.applyBulkClearTags(); }));
            if (tags.length > 0) menu.addSeparator();
        }
        for (const tag of tags) {
            menu.addItem((item) => item
                .setTitle(tag.name || tag.id)
                .setIcon(mode === "add" ? "tag" : "tag-x")
                .onClick(() => {
                    if (mode === "add") void this.applyBulkAddTag(tag.id);
                    else void this.applyBulkRemoveTag(tag.id);
                }));
        }
        menu.showAtMouseEvent(event);
    }

    private showBulkDelayMenu(event: MouseEvent) {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const menu = new Menu();
        menu.addItem((item) => item
            .setTitle(t("通用_无延迟_文本"))
            .setIcon("timer-off")
            .onClick(() => { void this.applyBulkDelay(""); }));
        if (this.settings.DELAYS.length > 0) menu.addSeparator();
        for (const delay of this.settings.DELAYS) {
            menu.addItem((item) => item
                .setTitle(`${delay.name || delay.id} (${delay.time}s)`)
                .setIcon("timer")
                .onClick(() => { void this.applyBulkDelay(delay.id); }));
        }
        menu.showAtMouseEvent(event);
    }

    private showBulkMoreMenu(event: MouseEvent) {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const menu = new Menu();
        menu.addItem((item) => item
            .setTitle(t("批量编辑_全选当前列表"))
            .setIcon("list-checks")
            .onClick(() => this.selectDisplayedPlugins()));
        menu.addItem((item) => item
            .setTitle(t("批量编辑_清空选择"))
            .setIcon("x")
            .setDisabled(this.bulkSelectedPluginIds.size === 0)
            .onClick(() => this.clearBulkSelection()));
        menu.showAtMouseEvent(event);
    }

    private renderBulkBar(container: HTMLElement) {
        if (!this.bulkEditMode) return;
        this.cleanupBulkSelection();
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const selectedCount = this.getBulkSelectedCount();
        const displayedCount = this.getSelectableDisplayedPluginIds().length;
        const disabled = selectedCount === 0;
        const bar = container.createDiv("manager-bulk-bar");
        const summary = bar.createDiv("manager-bulk-bar__summary");
        const summaryIcon = summary.createSpan({ cls: "manager-bulk-bar__summary-icon" });
        setIcon(summaryIcon, "square-check-big");
        const text = summary.createDiv("manager-bulk-bar__summary-text");
        text.createSpan({ cls: "manager-bulk-bar__title", text: t("批量编辑_标题") });
        text.createSpan({ cls: "manager-bulk-bar__count", text: t("批量编辑_已选择数量", { count: selectedCount, total: displayedCount }) });

        const actions = bar.createDiv("manager-bulk-bar__actions");
        this.createBulkActionButton(actions, "list-checks", t("批量编辑_全选当前列表"), () => this.selectDisplayedPlugins(), displayedCount === 0);
        this.createBulkActionButton(actions, "power", t("通用_启用_文本"), () => { void this.applyBulkEnabled(true); }, disabled);
        this.createBulkActionButton(actions, "power-off", t("通用_禁用_文本"), () => { void this.applyBulkEnabled(false); }, disabled);
        this.createBulkActionButton(actions, "folder-tree", t("批量编辑_设置分组"), (event) => this.showBulkGroupMenu(event), disabled);
        this.createBulkActionButton(actions, "tag", t("批量编辑_添加标签"), (event) => this.showBulkTagMenu(event, "add"), disabled);
        this.createBulkActionButton(actions, "tag-x", t("批量编辑_移除标签"), (event) => this.showBulkTagMenu(event, "remove"), disabled);
        if (this.settings.DELAY) this.createBulkActionButton(actions, "timer", t("批量编辑_设置延迟"), (event) => this.showBulkDelayMenu(event), disabled);
        this.createBulkActionButton(actions, "more-horizontal", t("管理器_更多操作_描述"), (event) => this.showBulkMoreMenu(event));
        this.createBulkActionButton(actions, "x", t("通用_完成_文本"), () => this.setBulkEditMode(false));
    }

    private renderEditorBar(container: HTMLElement) {
        if (!this.editorMode) return;
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const canEditLayout = this.shouldRenderPluginLayoutSeparators();
        const bar = container.createDiv("manager-bulk-bar manager-editor-bar");
        const summary = bar.createDiv("manager-bulk-bar__summary");
        const summaryIcon = summary.createSpan({ cls: "manager-bulk-bar__summary-icon" });
        setIcon(summaryIcon, "pen-line");
        const text = summary.createDiv("manager-bulk-bar__summary-text");
        text.createSpan({ cls: "manager-bulk-bar__title", text: t("管理器_编辑模式_标题") });

        const actions = bar.createDiv("manager-bulk-bar__actions");
        if (canEditLayout) {
            this.createBulkActionButton(actions, "separator-horizontal", t("管理器_布局_添加分割线"), () => { void this.addPluginLayoutSeparator(); });
            this.createBulkActionButton(actions, "rotate-ccw", t("管理器_布局_按名称重置"), async () => {
                if (!(await confirmWithModal(this.app, this.manager, t("管理器_布局_重置确认")))) return;
                await this.resetPluginLayout();
            });
        }
        this.createBulkActionButton(actions, "x", t("通用_完成编辑_文本"), () => { void this.setEditorMode(false); });
    }

    private updateBulkBar() {
        if (!this.bulkBarHostEl || !this.bulkBarHostEl.isConnected) return;
        this.bulkBarHostEl.empty();
        this.renderBulkBar(this.bulkBarHostEl);
    }

    private refreshBulkSelectionUi() {
        this.pageEl.querySelectorAll<HTMLElement>(".manager-plugin-card[data-plugin-id]").forEach((card) => {
            const pluginId = card.getAttribute("data-plugin-id") || "";
            const selected = this.bulkSelectedPluginIds.has(pluginId);
            card.toggleClass("is-bulk-selected", selected);
            const checkbox = card.querySelector<HTMLInputElement>(".manager-plugin-card__bulk-select input[type='checkbox']");
            if (checkbox) checkbox.checked = selected;
        });
        this.updateBulkBar();
    }

    private syncPluginEmptyState() {
        const existing = this.pageEl.querySelector<HTMLElement>(".manager-plugin-page__empty");
        const hasCards = Boolean(this.pageEl.querySelector(".manager-plugin-card[data-plugin-id]"));
        if (hasCards) {
            existing?.remove();
            return;
        }
        if (existing) return;
        const empty = this.pageEl.createDiv("bpm-empty-state manager-plugin-page__empty");
        empty.setAttribute("role", "status");
        const icon = empty.createDiv("bpm-empty-state__icon");
        setIcon(icon, "search-x");
        empty.createDiv({ cls: "bpm-empty-state__title", text: this.manager.translator.t("管理器_暂无匹配插件") });
        empty.createDiv({ cls: "bpm-empty-state__text", text: this.manager.translator.t("管理器_暂无匹配插件_说明") });
    }

    private async applyBulkGroup(groupId: string) {
        const plugins = this.getSelectedManagerPlugins();
        plugins.forEach((plugin) => { plugin.group = groupId; });
        await this.finishBulkMetadataEdit("批量编辑_已更新分组", plugins.length);
    }

    private async applyBulkAddTag(tagId: string) {
        const plugins = this.getSelectedManagerPlugins();
        plugins.forEach((plugin) => {
            if (!plugin.tags.includes(tagId)) plugin.tags.push(tagId);
        });
        await this.finishBulkMetadataEdit("批量编辑_已添加标签", plugins.length);
    }

    private async applyBulkRemoveTag(tagId: string) {
        const plugins = this.getSelectedManagerPlugins();
        plugins.forEach((plugin) => {
            plugin.tags = plugin.tags.filter((id) => id !== tagId);
        });
        await this.finishBulkMetadataEdit("批量编辑_已移除标签", plugins.length);
    }

    private async applyBulkClearTags() {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const plugins = this.getSelectedManagerPlugins();
        if (plugins.length === 0) return;
        if (!(await confirmWithModal(this.app, this.manager, t("批量编辑_清除全部标签确认", { count: plugins.length })))) return;
        const protectedTagIds = new Set([BPM_TAG_ID, BPM_IGNORE_TAG, EONDR_PLUGIN_TAG_ID]);
        plugins.forEach((plugin) => {
            plugin.tags = plugin.tags.filter((id) => protectedTagIds.has(id));
            this.manager.applySpecialPluginTags(plugin);
        });
        await this.finishBulkMetadataEdit("批量编辑_已移除标签", plugins.length);
    }

    private async applyBulkDelay(delayId: string) {
        const plugins = this.getSelectedManagerPlugins().filter((plugin) => !plugin.tags.includes(BPM_IGNORE_TAG));
        if (plugins.length === 0) {
            new Notice(this.manager.translator.t("批量编辑_无可操作插件"));
            return;
        }
        for (const plugin of plugins) await this.manager.overview.setPluginState(plugin.id, { delay: delayId });
        await this.finishBulkMetadataEdit("批量编辑_已更新延迟", plugins.length);
    }

    private async finishBulkMetadataEdit(messageKey: string, count: number) {
        if (count === 0) return;
        await this.manager.saveSettings();
        Commands(this.app, this.manager);
        await this.refreshFilterOptions(true);
        new Notice(this.manager.translator.t(messageKey, { count }));
    }

    private async applyBulkEnabled(targetEnabled: boolean) {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const selectedPlugins = this.getSelectedManagerPlugins();
        const plugins = selectedPlugins.filter((plugin) => plugin.id !== this.manager.manifest.id && !plugin.tags.includes(BPM_IGNORE_TAG));
        if (plugins.length === 0) {
            new Notice(t("批量编辑_无可操作插件"));
            return;
        }
        if (!(await confirmBulkStatusChange(this.app, this.manager, {
            targetEnabled,
            selectedCount: selectedPlugins.length,
            actionableCount: plugins.length,
            skippedCount: Math.max(0, selectedPlugins.length - plugins.length),
            pluginNames: plugins.map((plugin) => plugin.name || plugin.id),
        }))) return;
        const progress = this.showInlineProgress(t("管理器_应用更改中_提示"));
        let processed = 0;
        for (const plugin of plugins) {
            const foreign = Boolean(this.manager.devices?.isProjectingForeign('plugins'));
            const isEnabled = foreign ? Boolean(plugin.enabled) : this.isManagedPluginEnabled(plugin.id);
            if (isEnabled !== targetEnabled) {
                await this.manager.overview.setPluginState(plugin.id, { enabled: targetEnabled });
                this.singleStartedPluginIds.delete(plugin.id);
            }
            processed++;
            progress.update(processed, plugins.length, plugin.id);
        }
        progress.hide();
        await this.manager.saveSettings();
        Commands(this.app, this.manager);
        // 批量启停后可能出现新 ribbon 图标，统一登记一次
        this.manager.applyRibbonSettings();
        await this.reloadShowData();
        new Notice(t("批量编辑_已更新状态", { count: plugins.length }));
    }

    private showInlineProgress(text: string, subText?: string) {
        const baseText = subText ? `${text} ${subText}` : text;
        const notice = new Notice(baseText, 0);
        return {
            update: (processed: number, total = 1, current?: string) => {
                notice.setMessage(`${text} ${Math.min(processed, total)}/${total}${current ? ` · ${current}` : ""}`);
            },
            hide: () => notice.hide()
        };
    }


    // 编辑模式
    editorMode = false;
    // 测试模式
    developerMode = false;

    searchEl!: SearchComponent;
    footEl!: HTMLDivElement;
    modalContainer?: HTMLElement;
    private desktopActionWrapper?: HTMLElement;
    private desktopFilterWrapper?: HTMLElement;
    private taskCenterView?: TaskCenterView;
    private bulkEditButtonEl?: HTMLButtonElement;
    private editorButtonEl?: HTMLButtonElement;
    private pluginTabEl?: HTMLButtonElement;
    private themeTabEl?: HTMLButtonElement;
    private installTabEl?: HTMLButtonElement;
    private sourcesTabEl?: HTMLButtonElement;
    private transferTabEl?: HTMLButtonElement;
    private vaultsTabEl?: HTMLButtonElement;
    private deviceTabEl?: HTMLButtonElement;
    private devicePanel?: DevicePanel;
    private deviceScopeBars = new Map<ScopePage, DeviceScopeBar>();
    private deviceScopeHostInline?: HTMLElement;
    private ribbonTabEl?: HTMLButtonElement;
    private troubleshootTabEl?: HTMLButtonElement;
    private ribbonPage?: RibbonModal;
    private troubleshootPanel?: TroubleshootPanel;
    private transferBuildOptions: ManagerTransferBuildOptions = { ...DEFAULT_TRANSFER_BUILD_OPTIONS };
    private transferImportOptions: ManagerTransferImportOptions = { ...DEFAULT_TRANSFER_IMPORT_OPTIONS };
    private transferPackage?: ManagerTransferPackage;
    private transferPreview?: ManagerTransferPreview;
    private transferImportResult?: ManagerTransferImportResult;
    private transferFileName = "";
    private transferBusy = false;
    private transferSelectionInitialized = false;
    private transferSelectedPluginIds = new Set<string>();
    private transferSelectedThemeNames = new Set<string>();
    private transferSelectedPluginConfigIds = new Set<string>();
    private hiddenDraggedItemEl: HTMLElement | null = null;
    private hiddenGhostEl: HTMLElement | null = null;
    private hiddenPlaceholderEl: HTMLElement | null = null;
    private hiddenDragStartIndex = -1;
    private hiddenDragOffsetX = 0;
    private hiddenDragOffsetY = 0;
    private hiddenActivePointerId: number | null = null;
    private handleHiddenLayoutDragEndEvent = (event: PointerEvent) => { void this.handleHiddenLayoutDragEnd(event); };
    private vaultTargetPath = "";
    private vaultLinkPlugins = true;
    private vaultLinkThemes = true;
    private vaultBackupExisting = false;
    private vaultExpandedId = "";

    constructor(app: App, manager: Manager) {
        super(app);
        this.appSetting = (this.app as ObsidianAppWithInternals).setting;
        this.appPlugins = (this.app as ObsidianAppWithInternals).plugins;
        this.manager = manager;
        this.settings = manager.settings;
        this.basePath = normalizePath(`${this.app.vault.configDir}`);
        // 首次启动运行下 避免有新加入的插件
        manager.synchronizePlugins(
            Object.values(this.appPlugins.manifests).filter(
                (pm: PluginManifest) => pm.id !== manager.manifest.id
            )
        );

        // this.manager.registerEvent(
        // 	this.app.workspace.on("file-menu", (menu, file) => {
        // 		const addIconMenuItem = (item: MenuItem) => {
        // 			item.setTitle("增");
        // 			item.setIcon("hashtag");
        // 			item.onClick(async () => {
        // 				console.log(file);
        // 			});
        // 		};
        // 		menu.addItem(addIconMenuItem);
        // 		const addIconMenuItem1 = (item: MenuItem) => {
        // 			item.setTitle("删");
        // 			item.setIcon("hashtag");
        // 		};
        // 		menu.addItem(addIconMenuItem1);
        // 		const addIconMenuItem2 = (item: MenuItem) => {
        // 			item.setTitle("改");
        // 			item.setIcon("hashtag");
        // 		};
        // 		menu.addItem(addIconMenuItem2);
        // 	})
        // );
    }

    async getActivePlugins() {
        const originPlugins = this.appPlugins.plugins || {};
        console.log(await this.processPlugins(originPlugins));
        return await this.processPlugins(originPlugins);
    }

    async processPlugins(originPlugins: Record<string, AppPluginInstanceLike>) {
        const plugins: Record<string, AppPluginInstanceLike> = {};
        for (const name in originPlugins) {
            try {
                const source = originPlugins[name];
                const manifest = source.manifest;
                if (!manifest) continue;
                const plugin: AppPluginInstanceLike = { ...source, manifest: { ...manifest } };
                plugin.manifest!.pluginUrl = `https://obsidian.md/plugins?id=${plugin.manifest!.id}`;
                plugin.manifest!.author2 = plugin.manifest!.author?.replace(/<.*?@.*?\\..*?>/g, "").trim(); // remove email address
                plugin.manifest!.installLink = `obsidian://BPM-install?id=${plugin.manifest!.id}&enable=true`;
                plugins[name] = plugin;
            } catch (e) {
                console.error(name, e);
                console.log(originPlugins[name]);
                console.log(originPlugins[name].manifest);
                console.log(typeof originPlugins[name].manifest);
            }
        }
        return plugins;
    }

    public async showHead() {
        this.migratePersistedFilterValues();
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const modalEl = this.contentEl.parentElement;
        if (!modalEl) return;
        this.modalContainer = modalEl;
        this.overviewSortSelect?.close();
        // 保留原生关闭行为，仅移动布局；Retain native closing behavior while relocating the control.
        if (Platform.isMobile) {
            this.nativeMobileCloseEl = modalEl.querySelector<HTMLElement>(':scope > .modal-header-button') ?? this.nativeMobileCloseEl;
        }
        modalEl.addClass("manager-container");
        modalEl.addClass("manager-container--main");
        if (Platform.isMobile) modalEl.addClass("manager-container--mobile");
        // 靠上
        if (!this.settings.CENTER && !Platform.isMobile) modalEl.addClass("manager-container__top");
        if (this.editorMode) modalEl.addClass("manager-container--editing");

        modalEl.getElementsByClassName("modal-close-button")[0]?.remove();
        this.titleEl.empty();
        this.titleEl.parentElement?.addClass("manager-container__native-header");
        this.contentEl.empty();
        this.contentEl.addClass("manager-modal-shell-host");
        this.contentEl.removeClass("manager-item-container");

        const shell = this.contentEl.createDiv("manager-modal-shell");
        const chromeEl = shell.createDiv("manager-modal-chrome");
        this.modalChromeEl = chromeEl;
        this.modalPageEl = shell.createDiv("manager-modal-page manager-item-container");

        if (Platform.isMobile) {
            this.observeMobileContentGutter(this.modalPageEl, chromeEl);
            this.showHeadMobile();
            return;
        }

        chromeEl.empty();

        const titleBar = chromeEl.createDiv("manager-header");
        const identity = titleBar.createDiv("manager-header__identity");
        const mark = identity.createDiv("manager-header__mark");
        mark.setAttribute("aria-hidden", "true");
        const titleGroup = identity.createDiv("manager-header__title-group");
        titleGroup.createDiv({ cls: "manager-header__eyebrow", text: "Better Manager" });
        titleGroup.createDiv({ cls: "manager-header__title" });
        this.syncHeaderIdentity();
        this.footEl = createDiv("manager-food manager-header__stats");
        this.updateStats();

        // [操作行]
        const actionWrapper = chromeEl.createDiv("manager-section manager-section--actions");
        this.desktopActionWrapper = actionWrapper;
        const actionContent = actionWrapper.createDiv("manager-section__content");
        actionContent.addClass("manager-section__content--actions");
        /*
            let timer: number | undefined;
            const show = () => { new Notice(text, 1500); };
            btn.buttonEl.addEventListener("touchstart", () => {
                timer = window.setTimeout(show, 500);
            });
            const clear = () => { if (timer) window.clearTimeout(timer); timer = undefined; };
            btn.buttonEl.addEventListener("touchend", clear);
            btn.buttonEl.addEventListener("touchcancel", clear);
        */
        const toolbar = actionContent.createDiv("manager-toolbar");
        this.applyToolbarLabelClasses(toolbar);
        const tabs = toolbar.createDiv("manager-toolbar__tabs");
        tabs.setAttribute("role", "tablist");
        tabs.setAttribute("data-slot", "tabs-list");
        const createTab = (page: ManagerPage, label: string, icon: string, tooltip?: string) => {
            const tab = tabs.createEl("button", { cls: "manager-toolbar__tab" });
            tab.type = "button";
            tab.setAttribute("role", "tab");
            tab.setAttribute("data-slot", "tabs-trigger");
            tab.setAttribute("aria-label", label);
            tab.dataset.label = label;
            if (tooltip) {
                tab.setAttribute("title", tooltip);
                this.bindLongPressTooltip(tab, tooltip);
            }
            tab.dataset.page = page;
            const iconEl = tab.createSpan({ cls: "manager-toolbar__tab-icon" });
            iconEl.setAttribute("aria-hidden", "true");
            setIcon(iconEl, icon);
            tab.createSpan({ cls: "manager-toolbar__tab-label", text: label });
            // 标签隐藏时，长按功能项临时显示标签（触屏）。
            let pressTimer: number | undefined;
            let longPressed = false;
            let previewTimer: number | undefined;
            const clearPress = () => {
                if (pressTimer !== undefined) { window.clearTimeout(pressTimer); pressTimer = undefined; }
            };
            tab.addEventListener("pointerdown", (event) => {
                if (event.pointerType === "mouse") return;
                longPressed = false;
                clearPress();
                pressTimer = window.setTimeout(() => {
                    longPressed = true;
                    tab.addClass("manager-toolbar__tab--label-preview");
                    if (previewTimer !== undefined) window.clearTimeout(previewTimer);
                    previewTimer = window.setTimeout(() => tab.removeClass("manager-toolbar__tab--label-preview"), 1500);
                }, 450);
            });
            ["pointerup", "pointerleave", "pointercancel"].forEach((name) =>
                tab.addEventListener(name, clearPress));
            tab.addEventListener("click", (event) => {
                if (longPressed) {
                    longPressed = false;
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                this.setDesktopPage(page);
            });
            return tab;
        };
        const pageTabs = new Map(this.getPageNavigationItems().map(item =>
            [item.page, createTab(item.page, item.label, item.icon, item.tooltip)]));
        this.pluginTabEl = pageTabs.get('plugins');
        this.themeTabEl = pageTabs.get('themes');
        this.deviceTabEl = pageTabs.get('devices');
        this.installTabEl = pageTabs.get('install');
        this.sourcesTabEl = undefined;
        this.transferTabEl = pageTabs.get('transfer');
        this.vaultsTabEl = pageTabs.get('vaults');
        this.ribbonTabEl = pageTabs.get('ribbon');
        this.troubleshootTabEl = pageTabs.get('troubleshoot');

        this.renderGlobalTools(toolbar.createDiv('manager-global-tools'));
        this.createPageTools();
        tabs.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(tab => {
            tab.toggleClass('manager-feature-disabled', !this.isPageEnabled(tab.dataset.page as ManagerPage));
        });

        // [过滤行]
        const filterWrapper = chromeEl.createDiv("manager-section manager-section--filters");
        this.desktopFilterWrapper = filterWrapper;
        const filterContent = filterWrapper.createDiv("manager-section__content");
        filterContent.addClass("manager-section__content--filters");

        const searchBar = new Setting(filterContent).setClass("manager-bar__search").setName("");
        this.searchBarEl = searchBar.settingEl;
        this.syncPageChrome();
        const searchLine = searchBar.controlEl.createDiv("manager-search-line");
        const filterControlGroup = searchBar.controlEl.createDiv("manager-filter-control-group");
        const createFilterField = (label: string, icon: string, variant: "select" | "search" | "compound" = "select") =>
            this.createFilterField(variant === "search" ? searchLine : filterControlGroup, label, icon, variant);
        const createFilterSelectField = (label: string, icon: string, variant: "select" | "search" | "compound" = "select") =>
            this.createFilterSelectField(variant === "search" ? searchLine : filterControlGroup, label, icon, variant);
        // [搜索行] 搜索框
        const searchField = createFilterField(t("通用_搜索_文本"), "search", "search");
        this.searchEl = new SearchComponent(searchField);
        this.searchEl.inputEl.setAttribute("aria-label", t("筛选_搜索插件_标签"));
        if (this.settings.PERSISTENCE && typeof this.settings.FILTER_SEARCH === "string") {
            this.searchText = this.settings.FILTER_SEARCH;
            // 避免 setValue 触发额外渲染：先设置 input 值，再在 onChange 里统一处理
            this.searchEl.inputEl.value = this.searchText;
        }
        this.searchEl.onChange((value: string) => {
            this.handleSearchChange(value);
        });
        searchBar.controlEl.appendChild(filterControlGroup);

        // 桌面端插件页：设备预设选择器放在搜索框右侧，搜索框相应收窄。
        this.deviceScopeHostInline = searchLine.createDiv("manager-device-scope manager-device-scope--inline");
        this.renderDeviceScope(this.deviceScopeHostInline, 'plugins', true);

        this.renderOverviewSort(filterControlGroup);

        // 过滤器控件由桌面和移动端共用，容器只决定各自的布局。
        const statusControl = createFilterSelectField(t("通用_状态_文本"), "list-filter", "compound");
        const groupControl = createFilterSelectField(t("通用_分组_文本"), "folder-tree", "compound");
        const tagControl = createFilterSelectField(t("通用_标签_文本"), "tags", "compound");
        const delayControl = this.settings.DELAY ? createFilterSelectField(t("通用_延迟_文本"), "timer", "compound") : undefined;
        this.renderPluginFilterControls({ status: statusControl, group: groupControl, tag: tagControl, delay: delayControl }, () => undefined);
    }

    /** 各端复用 BPM 排序控件；Use the shared BPM menu on every form factor. */
    private renderOverviewSort(parent: HTMLElement): void {
        this.overviewSortSelect?.close();
        this.overviewSortSelect = new ScopeSelect(parent, this.manager.translator.t('通用_排序_文本'), 'arrow-up-down',
            this.getPluginOverviewSort(), this.getPluginOverviewSortOptions().map(([value, label]) => ({ value, label })),
            value => { void this.setPluginOverviewSort(value); });
        this.overviewSortSelect.field.addClass('manager-filter-field--sort');
    }

    /** 固定全局入口：设置与原生联系方式菜单；Fixed settings and native contact menu. */
    /** 顶栏功能项标签显示模式；Apply the label visibility classes. */
    private applyToolbarLabelClasses(toolbar: HTMLElement): void {
        toolbar.removeClass("manager-toolbar--labels-always", "manager-toolbar--labels-active",
            "manager-toolbar--labels-hidden", "manager-toolbar--hover-labels");
        const mode = this.settings.TOOLBAR_LABEL_MODE;
        toolbar.addClass(`manager-toolbar--labels-${mode === "always" || mode === "hidden" ? mode : "active"}`);
        if (this.settings.TOOLBAR_HOVER_LABELS !== false) toolbar.addClass("manager-toolbar--hover-labels");
    }

    public syncToolbarLabelMode(): void {
        this.modalEl?.querySelectorAll<HTMLElement>(".manager-toolbar")
            .forEach((el) => this.applyToolbarLabelClasses(el));
    }

    private renderGlobalTools(parent: HTMLElement): void {
        const t = (key: string) => this.manager.translator.t(key);
        this.taskCenterView?.destroy();
        this.taskCenterView = undefined;
        const createIconTool = (icon: string, label: string, onClick: (event: MouseEvent) => void) => {
            const el = parent.createDiv({ cls: 'clickable-icon extra-setting-button manager-global-tool' });
            el.setAttribute('tabindex', '0');
            el.setAttribute('role', 'button');
            el.setAttribute('aria-label', label);
            setIcon(el, icon);
            this.bindLongPressTooltip(el, label);
            el.addEventListener('click', (event) => onClick(event));
            el.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                el.click();
            });
            return el;
        };
        createIconTool('settings', t('管理器_插件设置_描述'), () => this.openSettingsTab(this.manager.manifest.id));
        const more = createIconTool('more-vertical', t('管理器_更多操作_描述'), (event) => {
            const menu = new Menu();
            menu.addItem(item => item.setTitle(t('任务_标题')).setIcon('cloud-download')
                .onClick(() => { this.taskCenterView?.show(); }));
            menu.addSeparator();
            menu.addItem(item => {
                item.setTitle(t('管理器_联系方式')).setIcon('message-circle');
                // Obsidian's native submenu supplies the arrow, placement and touch/keyboard handling.
                const contacts = (item as MenuItem & { setSubmenu(): Menu }).setSubmenu();
                contacts.addItem(item => item.setTitle(t('管理器_视频教程_描述')).setIcon('book-open')
                .onClick(() => { window.open('https://www.bilibili.com/video/BV1WyrkYMEce/'); }));
                contacts.addItem(item => item.setTitle(t('管理器_GITHUB_描述')).setIcon('github')
                .onClick(() => { window.open('https://github.com/eondrcode/obsidian-manager'); }));
                contacts.addItem(item => item.setTitle(SUPPORT_QQ_GROUP_TOOLTIP).setIcon('message-circle')
                .onClick(() => this.openSupportQQGroup()));
            });
            menu.showAtMouseEvent(event);
        });
        more.setAttribute('aria-haspopup', 'menu');
        more.addClass('manager-global-more');
        this.taskCenterView = new TaskCenterView(this.manager, parent, more);
        const close = createIconTool('x', t('通用_关闭窗口'), () => this.close());
        close.addClass('manager-modal-close');
    }

    private createPageTools(): void {
        const t = (key: string) => this.manager.translator.t(key);
        const tools = createDiv('manager-toolbar__tools manager-page-tools');
        this.pageToolsEl = tools;
        const actionBar = new Setting(tools).setClass("manager-bar__action").setName("");
        const markTool = (btn: ButtonComponent, scope: ToolScope, order?: number) => {
            btn.buttonEl.addClass("manager-tool");
            btn.buttonEl.dataset.scope = scope;
            btn.buttonEl.addClass(`manager-tool--${scope}`);
            if (order !== undefined) btn.buttonEl.setCssProps({ "--manager-tool-order": `${order}` });
        };

        const bulkEditButton = new ButtonComponent(actionBar.controlEl);
        markTool(bulkEditButton, "plugin", 20);
        bulkEditButton.setIcon(this.bulkEditMode ? "square-check-big" : "list-plus");
        bulkEditButton.setTooltip(t("批量编辑_入口"));
        bulkEditButton.buttonEl.setAttribute("aria-label", t("批量编辑_入口"));
        bulkEditButton.buttonEl.classList.toggle("is-active", this.bulkEditMode);
        this.bulkEditButtonEl = bulkEditButton.buttonEl;
        this.bindLongPressTooltip(bulkEditButton.buttonEl, t("批量编辑_入口"));
        bulkEditButton.onClick(() => {
            this.setBulkEditMode(!this.bulkEditMode);
        });
        const mobileOverflowActions: Array<{ button: ButtonComponent; label: string; icon: string }> = [];

        // [操作行] 检查更新
        const updateButton = new ButtonComponent(actionBar.controlEl);
        markTool(updateButton, "plugin", 10);
        this.preparePluginUpdateButton(updateButton);

        // [操作行] 重载插件
        const reloadButton = new ButtonComponent(actionBar.controlEl);
        markTool(reloadButton, "plugin", 40);
        reloadButton.setIcon("refresh-ccw");
        reloadButton.setTooltip(this.manager.translator.t("管理器_重载插件_描述"));
        this.bindLongPressTooltip(reloadButton.buttonEl, this.manager.translator.t("管理器_重载插件_描述"));
        reloadButton.onClick(async () => {
            if (this.reloadingManifests) return;
            this.reloadingManifests = true;
            reloadButton.setDisabled(true);
            const notice = new Notice(this.manager.translator.t("管理器_重载插件_开始提示"), 0);
            // 让 UI 先渲染提示再进行重操作
            await new Promise((r) => window.setTimeout(r, 50));
            try {
                await this.appPlugins.loadManifests();
                this.invalidatePluginCaches();
                // 同步新发现的插件到 BPM 管理列表
                this.manager.synchronizePlugins(
                    Object.values(this.appPlugins.manifests).filter(
                        (pm: PluginManifest) => pm.id !== this.manager.manifest.id
                    )
                );
                await this.reloadShowData();
            } catch (e) {
                console.error("[BPM] reload manifests failed", e);
                new Notice(this.manager.translator.t("管理器_重载插件_失败提示"), 4000);
            } finally {
                notice.hide();
                reloadButton.setDisabled(false);
                this.reloadingManifests = false;
            }
        });

        // [操作行] 编辑模式
        const editorButton = new ButtonComponent(actionBar.controlEl);
        markTool(editorButton, "plugin", 30);
        if (this.editorMode) {
            editorButton.setIcon("pen-off");
        } else {
            editorButton.setIcon("pen");
        }
        editorButton.setTooltip(this.manager.translator.t("管理器_编辑模式_描述"));
        editorButton.buttonEl.classList.toggle("is-active", this.editorMode);
        this.editorButtonEl = editorButton.buttonEl;
        this.bindLongPressTooltip(editorButton.buttonEl, this.manager.translator.t("管理器_编辑模式_描述"));
        editorButton.onClick(() => {
            void this.setEditorMode(!this.editorMode);
        });

        if (this.isRibbonManagerEnabled()) {
            const ribbonResetButton = new ButtonComponent(actionBar.controlEl);
            markTool(ribbonResetButton, "ribbon", 10);
            ribbonResetButton.setIcon("rotate-ccw");
            ribbonResetButton.setTooltip(t("Ribbon_重置_提示"));
            ribbonResetButton.buttonEl.setAttribute("aria-label", t("Ribbon_重置_提示"));
            this.bindLongPressTooltip(ribbonResetButton.buttonEl, t("Ribbon_重置_提示"));
            ribbonResetButton.onClick(async () => {
                if (!(await confirmWithModal(this.app, this.manager, t("Ribbon_重置_确认")))) return;
                if (!this.isRibbonManagerEnabled()) return;
                if (!this.ribbonPage) this.ribbonPage = new RibbonModal(this.app, this.manager);
                this.manager.ribbonModal = this.ribbonPage;
                await this.ribbonPage.syncRibbonItems();
                await this.ribbonPage.resetRibbonLayout();
            });
        }

        const addSeparatorButton = new ButtonComponent(actionBar.controlEl);
        markTool(addSeparatorButton, "layout", 60);
        addSeparatorButton.setIcon("separator-horizontal");
        addSeparatorButton.setTooltip(t("管理器_布局_添加分割线"));
        addSeparatorButton.buttonEl.setAttribute("aria-label", t("管理器_布局_添加分割线"));
        this.bindLongPressTooltip(addSeparatorButton.buttonEl, t("管理器_布局_添加分割线"));
        addSeparatorButton.onClick(async () => {
            await this.addPluginLayoutSeparator();
        });

        const hiddenResetButton = new ButtonComponent(actionBar.controlEl);
        markTool(hiddenResetButton, "layout", 61);
        hiddenResetButton.setIcon("rotate-ccw");
        hiddenResetButton.setTooltip(t("管理器_布局_按名称重置"));
        hiddenResetButton.buttonEl.setAttribute("aria-label", t("管理器_布局_按名称重置"));
        this.bindLongPressTooltip(hiddenResetButton.buttonEl, t("管理器_布局_按名称重置"));
        hiddenResetButton.onClick(async () => {
            if (!(await confirmWithModal(this.app, this.manager, t("管理器_布局_重置确认")))) return;
            await this.resetPluginLayout();
        });

        const hiddenPluginsButton = new ButtonComponent(actionBar.controlEl);
        markTool(hiddenPluginsButton, 'plugin', 55);
        hiddenPluginsButton.setIcon('eye-off').setTooltip(t('菜单_隐藏插件_标题'));
        hiddenPluginsButton.buttonEl.setAttribute('aria-label', t('菜单_隐藏插件_标题'));
        hiddenPluginsButton.onClick(() => {
            const plugins = Object.values(this.appPlugins.manifests).filter(plugin => plugin.id !== this.manager.manifest.id)
                .sort((a, b) => a.name.localeCompare(b.name));
            new HideModal(this.app, this.manager, this, plugins).open();
        });

        // 独立插件源目录 / Independent plugin catalog sources.
        const catalogButton = new ButtonComponent(actionBar.controlEl);
        markTool(catalogButton, "plugin", 65);
        catalogButton.setIcon("compass");
        catalogButton.setTooltip(t("目录_标题"));
        catalogButton.buttonEl.setAttribute("aria-label", t("目录_标题"));
        catalogButton.onClick(() => this.openCatalog());

        // [操作行] 插件市场
        const marketButton = new ButtonComponent(actionBar.controlEl);
        markTool(marketButton, "plugin", 70);
        marketButton.setIcon("store");
        marketButton.setTooltip(this.manager.translator.t("管理器_插件市场_描述"));
        this.bindLongPressTooltip(marketButton.buttonEl, this.manager.translator.t("管理器_插件市场_描述"));
        marketButton.onClick(() => {
            void this.openPluginMarket();
        });

        // [操作行] 外观市场
        const appearanceMarketButton = new ButtonComponent(actionBar.controlEl);
        markTool(appearanceMarketButton, "theme", 70);
        appearanceMarketButton.setIcon("store");
        appearanceMarketButton.setTooltip(this.manager.translator.t("管理器_外观市场_描述"));
        this.bindLongPressTooltip(appearanceMarketButton.buttonEl, this.manager.translator.t("管理器_外观市场_描述"));
        appearanceMarketButton.onClick(() => {
            void this.openAppearanceMarket();
        });

        // [操作行] 保存当前外观为方案
        const saveAppearanceProfileButton = new ButtonComponent(actionBar.controlEl);
        markTool(saveAppearanceProfileButton, "theme", 60);
        saveAppearanceProfileButton.buttonEl.addClass("manager-tool--appearance-profile");
        saveAppearanceProfileButton.setIcon("plus");
        saveAppearanceProfileButton.setTooltip(this.manager.translator.t("外观总览_方案_保存当前"));
        this.bindLongPressTooltip(saveAppearanceProfileButton.buttonEl, this.manager.translator.t("外观总览_方案_保存当前"));
        saveAppearanceProfileButton.onClick(async () => {
            const [themes, snippets] = await Promise.all([
                collectInstalledThemes(this.manager, undefined, false, true),
                this.collectCssSnippets(),
            ]);
            this.openAppearanceProfileModal(this.createCurrentAppearanceProfileDraft(snippets), themes, snippets);
        });

        // [测试行] 刷新插件
        if (this.developerMode) {
            const testButton = new ButtonComponent(actionBar.controlEl);
            markTool(testButton, "plugin", 90);
            testButton.setIcon("refresh-ccw");
            testButton.setTooltip(t("开发_刷新插件_提示"));
            testButton.onClick(async () => {
                this.close();
                await this.appPlugins.disablePlugin(this.manager.manifest.id);
                await this.appPlugins.enablePlugin(this.manager.manifest.id);
            });
            mobileOverflowActions.push({ button: testButton, label: t('开发_刷新插件_提示'), icon: 'refresh-ccw' });
        }

        // [测试行] 测试插件
        if (this.developerMode) {
            const testButton = new ButtonComponent(actionBar.controlEl);
            markTool(testButton, "plugin", 91);
            testButton.setIcon("test-tube");
            testButton.setTooltip(t("开发_测试插件_提示"));
            testButton.onClick(async () => {
                // 获取当前页面所有的插件ID 然后将其转换为列表
            });
            mobileOverflowActions.push({ button: testButton, label: t('开发_测试插件_提示'), icon: 'test-tube' });
        }

        [bulkEditButton, editorButton, reloadButton].forEach(button => button.buttonEl.addClass('manager-tool--mobile-primary'));
        mobileOverflowActions.push(
            { button: updateButton, label: t('管理器_检查更新_描述'), icon: 'rss' },
            { button: hiddenResetButton, label: t('管理器_布局_按名称重置'), icon: 'rotate-ccw' },
            { button: hiddenPluginsButton, label: t('菜单_隐藏插件_标题'), icon: 'eye-off' },
            { button: catalogButton, label: t('目录_标题'), icon: 'compass' },
            { button: marketButton, label: t('管理器_插件市场_描述'), icon: 'store' },
            { button: addSeparatorButton, label: t('管理器_布局_添加分割线'), icon: 'separator-horizontal' });
        mobileOverflowActions.forEach(action => action.button.buttonEl.addClass('manager-tool--mobile-overflow'));
        const more = new ButtonComponent(actionBar.controlEl);
        markTool(more, 'plugin', 100);
        more.buttonEl.addClass('manager-tool--mobile-more');
        more.setIcon('more-vertical').setTooltip(t('管理器_更多操作_描述'));
        more.buttonEl.setAttribute('aria-label', t('管理器_更多操作_描述'));
        more.onClick(event => {
            const menu = new Menu();
            for (const action of mobileOverflowActions) {
                const button = action.button.buttonEl;
                if (button.hasClass('manager-feature-disabled') || !isToolInPage(button.dataset.scope ?? '', this.activePage, this.editorMode)) continue;
                menu.addItem(item => item.setTitle(action.label).setIcon(action.icon).setDisabled(button.disabled).onClick(() => button.click()));
            }
            menu.showAtMouseEvent(event);
        });

        const toolFeatures: Array<[ButtonComponent, ToolId]> = [
            [updateButton, 'updates'], [bulkEditButton, 'bulkEdit'], [editorButton, 'layoutEditor'],
            [addSeparatorButton, 'layoutEditor'], [hiddenResetButton, 'layoutEditor'], [reloadButton, 'reload'],
            [catalogButton, 'catalog'], [marketButton, 'pluginMarket'], [appearanceMarketButton, 'appearanceMarket'],
            [saveAppearanceProfileButton, 'appearanceProfiles'],
        ];
        for (const [button, feature] of toolFeatures) {
            button.buttonEl.dataset.feature = feature;
            button.buttonEl.toggleClass('manager-feature-disabled', !toolEnabled(this.settings, feature));
        }
        this.syncToolVisibility();
    }

    /** 数据决定显隐，不依赖工具所在容器；Scope determines visibility independently of placement. */
    private syncToolVisibility(): void {
        this.pageToolsEl?.querySelectorAll<HTMLElement>('.manager-tool').forEach(button => {
            const inPage = isToolInPage(button.dataset.scope ?? '', this.activePage, this.editorMode);
            const inView = !button.hasClass('manager-tool--appearance-profile') || this.appearanceView === 'profiles';
            button.toggleClass('manager-tool-hidden', !inPage || !inView);
        });
    }

    private mountOverviewBar(): void {
        const bar = this.pageEl.querySelector<HTMLElement>('.manager-overview-heading');
        if (!bar) return;
        bar.querySelector('.manager-food')?.remove();
        bar.querySelector('.manager-page-tools')?.remove();
        if (this.footEl) bar.appendChild(this.footEl);
        if (this.pageToolsEl) bar.appendChild(this.pageToolsEl);
        this.syncToolVisibility();
        this.observeOverviewToolbar(bar);
    }

    private observeOverviewToolbar(row: HTMLElement): void {
        this.overviewToolbarLayout?.destroy();
        this.overviewToolbarLayout = undefined;
        if (this.activePage !== 'plugins') return;
        this.overviewToolbarLayout = new ResponsiveToolbar(row,
            () => [this.footEl, this.pageToolsEl].filter((el): el is HTMLElement => Boolean(el)));
    }

    /** 当前栏目即切换入口；A labeled current-page trigger replaces the mixed mobile menu. */
    private renderMobilePageSwitch(parent: HTMLElement): HTMLButtonElement {
        const items = this.getPageNavigationItems();
        const currentPage = this.activePage === 'sources' ? 'install' : this.activePage;
        const current = items.find(item => item.page === currentPage);
        const label = current?.label ?? this.manager.translator.t('通用_管理器_文本');
        const button = parent.createEl('button', { cls: 'manager-mobile-page-switch', attr: {
            type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
            'aria-label': `${this.manager.translator.t('管理器_切换功能')}: ${label}`,
        } });
        const icon = button.createSpan('manager-mobile-page-switch__icon manager-plugin-card__icon');
        icon.setAttribute('aria-hidden', 'true');
        setIcon(icon, current?.icon ?? 'blocks');
        button.createSpan({ cls: 'manager-mobile-page-switch__label', text: label });
        setIcon(button.createSpan('manager-mobile-page-switch__chevron'), 'chevron-down');
        button.disabled = items.length === 0;
        button.addEventListener('click', () => {
            const menu = new Menu();
            for (const item of items) {
                menu.addItem(option => option.setTitle(item.label).setIcon(item.icon).setChecked(item.page === currentPage)
                    .onClick(() => {
                        if (item.page === currentPage) return;
                        this.setDesktopPage(item.page);
                    }));
            }
            button.setAttribute('aria-expanded', 'true');
            menu.onHide(() => button.setAttribute('aria-expanded', 'false'));
            const rect = button.getBoundingClientRect();
            menu.showAtPosition({ x: rect.left, y: rect.bottom }, button.ownerDocument);
        });
        return button;
    }

    /** 按真实可用宽度完整显示或隐藏名称；Fit the complete label between the fixed global tools. */
    private observeMobilePageSwitch(row: HTMLElement, button: HTMLButtonElement, actions: HTMLElement): void {
        this.mobileHeaderObserver?.disconnect();
        const label = button.querySelector<HTMLElement>('.manager-mobile-page-switch__label');
        const icon = button.querySelector<HTMLElement>('.manager-mobile-page-switch__icon');
        const chevron = button.querySelector<HTMLElement>('.manager-mobile-page-switch__chevron');
        if (!label || !icon || !chevron) return;
        const fit = () => {
            const style = getComputedStyle(button);
            const number = (value: string) => Number.parseFloat(value) || 0;
            const available = row.clientWidth - actions.getBoundingClientRect().width - number(getComputedStyle(row).columnGap);
            const required = label.getBoundingClientRect().width + icon.getBoundingClientRect().width + chevron.getBoundingClientRect().width
                + number(style.columnGap) * 2 + number(style.paddingLeft) + number(style.paddingRight)
                + number(style.borderLeftWidth) + number(style.borderRightWidth);
            button.toggleClass('is-label-hidden', required > available + 0.5);
        };
        this.mobileHeaderObserver = new ResizeObserver(fit);
        this.mobileHeaderObserver.observe(row);
        this.mobileHeaderObserver.observe(actions);
        this.mobileHeaderObserver.observe(label);
        fit();
    }

    /** 顶部跟随实际滚动条占宽，菜单仍可溢出；Align chrome without clipping dropdown menus. */
    private observeMobileContentGutter(page: HTMLElement, chrome: HTMLElement): void {
        this.mobileContentObserver?.disconnect();
        this.mobileContentObserver = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) return;
            const style = getComputedStyle(page);
            const inset = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
                .reduce((sum, value) => sum + (Number.parseFloat(value) || 0), 0);
            const gutter = Math.max(0, page.getBoundingClientRect().width - entry.contentRect.width - inset);
            const value = `${Math.round(gutter * 100) / 100}px`;
            if (chrome.style.getPropertyValue('--bpm-mobile-scrollbar-gutter') !== value) {
                chrome.setCssProps({ '--bpm-mobile-scrollbar-gutter': value });
            }
        });
        this.mobileContentObserver.observe(page);
    }

    private showHeadMobile() {
        const t = (k: string) => this.manager.translator.t(k);
        this.migratePersistedFilterValues();
        const chromeEl = this.modalChromeEl ?? this.titleEl;
        this.mobileHeaderObserver?.disconnect();
        this.overviewSortSelect?.close();
        chromeEl.empty();

        const header = chromeEl.createDiv("bpm-mobile-header");
        header.dataset.page = this.activePage === 'sources' ? 'install' : this.activePage;
        const topRow = header.createDiv("bpm-mobile-header__top");

        const pageSwitch = topRow.createDiv('bpm-mobile-header__identity');
        const pageSwitchButton = this.renderMobilePageSwitch(pageSwitch);
        this.footEl = createDiv("manager-food bpm-mobile-header__stats");
        this.updateStats();

        const topActions = topRow.createDiv("bpm-mobile-header__actions");

        this.renderGlobalTools(topActions.createDiv('manager-global-tools manager-global-tools--mobile'));
        this.observeMobilePageSwitch(topRow, pageSwitchButton, topActions);
        this.createPageTools();

        this.mountOverviewBar();
        if (this.activePage !== "plugins") return;

        const searchWrap = header.createDiv("bpm-mobile-header__search");
        this.searchEl = new SearchComponent(searchWrap);
        if (this.settings.PERSISTENCE && typeof this.settings.FILTER_SEARCH === "string") {
            this.searchText = this.settings.FILTER_SEARCH;
        }
        this.searchEl.setValue(this.searchText);
        this.searchEl.onChange((value: string) => {
            this.handleSearchChange(value);
        });

        const filterHeader = header.createDiv("bpm-mobile-header__filters-toggle");
        const filterIcon = filterHeader.createSpan({ cls: "bpm-mobile-header__filters-icon" });
        setIcon(filterIcon, "filter");
        filterHeader.createSpan({ text: t("通用_过滤排序_文本"), cls: "bpm-mobile-header__filters-label" });
        const arrow = filterHeader.createSpan({ cls: "bpm-mobile-header__filters-arrow" });
        setIcon(arrow, this.mobileFiltersCollapsed ? "chevron-down" : "chevron-up");
        filterHeader.toggleClass("is-open", !this.mobileFiltersCollapsed);
        filterHeader.addEventListener("click", () => {
            this.mobileFiltersCollapsed = !this.mobileFiltersCollapsed;
            filterPanel.toggleClass("is-collapsed", this.mobileFiltersCollapsed);
            filterHeader.toggleClass("is-open", !this.mobileFiltersCollapsed);
            setIcon(arrow, this.mobileFiltersCollapsed ? "chevron-down" : "chevron-up");
        });

        // 激活筛选标签区域
        const activeFiltersContainer = header.createDiv("bpm-active-filters");
        const updateActiveFilters = () => {
            activeFiltersContainer.empty();
            const currentStatuses = this.getStatusFilterValues();
            const currentGroups = this.getGroupFilterValues();
            const currentTags = this.getTagFilterValues();
            const currentDelays = this.getDelayFilterValues();

            const addChip = (label: string, operator: FilterOperator, onRemove: () => void) => {
                const chip = activeFiltersContainer.createDiv("bpm-active-filter-chip");
                chip.setText(this.formatFilterChipLabel(label, operator));
                const closeIcon = chip.createSpan("bpm-active-filter-chip__close");
                setIcon(closeIcon, "x");
                chip.addEventListener("click", () => {
                    onRemove();
                    this.showHeadMobile();
                    void this.reloadShowData();
                });
            };

            // 状态筛选标签
            const filterLabels = this.getStatusFilterOptions();
            for (const status of currentStatuses) {
                addChip(filterLabels[status] || status, this.getStatusFilterOperator(), () => {
                    this.setStatusFilterValues(this.getStatusFilterValues().filter((value) => value !== status));
                });
            }

            // 分组筛选标签
            for (const group of currentGroups) {
                const groupItem = this.settings.GROUPS.find(g => g.id === group);
                if (groupItem) {
                    addChip(groupItem.name, this.getGroupFilterOperator(), () => {
                        this.setGroupFilterValues(this.getGroupFilterValues().filter((value) => value !== group));
                    });
                }
            }

            // 标签筛选标签
            for (const tag of currentTags) {
                const tagItem = this.settings.TAGS.find(t => t.id === tag);
                if (tagItem) {
                    addChip(tagItem.name, this.getTagFilterOperator(), () => {
                        this.setTagFilterValues(this.getTagFilterValues().filter((value) => value !== tag));
                    });
                }
            }

            // 延迟筛选标签
            for (const delay of currentDelays) {
                const delayItem = this.settings.DELAYS.find(d => d.id === delay);
                if (delayItem) {
                    addChip(delayItem.name, this.getDelayFilterOperator(), () => {
                        this.setDelayFilterValues(this.getDelayFilterValues().filter((value) => value !== delay));
                    });
                }
            }

            // 如果没有激活的筛选，隐藏容器
            if (activeFiltersContainer.childElementCount === 0) {
                activeFiltersContainer.addClass("manager-display-none");
            } else {
                activeFiltersContainer.removeClass("manager-display-none");
            }
        };
        updateActiveFilters();

        const filterPanel = header.createDiv(`bpm-mobile-header__filters${this.mobileFiltersCollapsed ? " is-collapsed" : ""}`);
        // 移动端复用桌面端的字段式过滤器：图标 + 标签 + 复合多选控件。
        const filterFields = filterPanel.createDiv("bpm-mobile-filter-fields");
        this.renderOverviewSort(filterFields);
        filterFields.toggleClass("has-delay-filter", this.settings.DELAY);

        const statusControl = this.createFilterField(filterFields, t("通用_状态_文本"), "list-filter", "compound");
        const groupControl = this.createFilterField(filterFields, t("通用_分组_文本"), "folder-tree", "compound");
        const tagControl = this.createFilterField(filterFields, t("通用_标签_文本"), "tags", "compound");
        const delayControl = this.settings.DELAY ? this.createFilterField(filterFields, t("通用_延迟_文本"), "timer", "compound") : undefined;
        this.renderPluginFilterControls({ status: statusControl, group: groupControl, tag: tagControl, delay: delayControl }, () => this.showHeadMobile());

        // 平板：设备选择、统计与工具固定顶栏，列表滚动时不会带走操作按钮。
        if (Platform.isTablet) {
            this.mobileScopeHost = header.createDiv("bpm-mobile-header__scope");
            this.mobileOverviewHost = header.createDiv("bpm-mobile-header__overview");
        }
    }

    /** 移动端底部操作栏 */
    private showMobileFooter() {
        const t = (k: string) => this.manager.translator.t(k);

        // 移除已存在的底部栏
        const existingFooter = this.modalEl.querySelector(".bpm-mobile-footer");
        if (existingFooter) existingFooter.remove();

        const footer = activeDocument.createElement("div");
        footer.addClass("bpm-mobile-footer");

        // 创建底部按钮的辅助函数
        const createFooterBtn = (icon: string, label: string, onClick: () => void) => {
            const btn = activeDocument.createElement("button");
            btn.type = "button";
            btn.addClass("bpm-mobile-footer__btn");
            btn.setAttribute("aria-label", label);
            setIcon(btn, icon);
            const labelEl = activeDocument.createElement("span");
            labelEl.addClass("bpm-mobile-footer__btn-label");
            labelEl.setText(label);
            btn.appendChild(labelEl);
            btn.addEventListener("click", onClick);
            this.bindLongPressTooltip(btn, label);
            return btn;
        };

        const bulkBtn = createFooterBtn(this.bulkEditMode ? "square-check-big" : "list-plus", t("批量编辑_入口"), () => {
            this.setBulkEditMode(!this.bulkEditMode);
        });
        bulkBtn.toggleClass("is-active", this.bulkEditMode);
        footer.appendChild(bulkBtn);

        // 检查更新按钮
        const updateBtn = createFooterBtn("rss", t("管理器_检查更新_描述"), () => {
            void this.runPluginUpdateCheck(updateBtn);
        });
        updateBtn.addClass("manager-update-trigger");
        footer.appendChild(updateBtn);

        // 设置按钮
        const settingsBtn = createFooterBtn("settings", t("管理器_插件设置_描述"), () => {
            this.openSettingsTab(this.manager.manifest.id);
        });
        footer.appendChild(settingsBtn);

        // 更多按钮
        const moreBtn = createFooterBtn("more-horizontal", t("管理器_更多操作_描述"), () => { });
        moreBtn.addEventListener("click", (ev) => {
            const menu = new Menu();
            menu.addItem((item) => item.setTitle(t("管理器_重载插件_描述")).setIcon("refresh-ccw").onClick(async () => {
                await this.appPlugins.loadManifests();
                this.invalidatePluginCaches();
                await this.reloadShowData();
            }));
            menu.addItem((item) => item.setTitle(t("菜单_隐藏插件_标题")).setIcon("eye-off").onClick(async () => {
                const all = Object.values(this.appPlugins.manifests);
                const plugins: PluginManifest[] = all.filter((pm) => pm.id !== this.manager.manifest.id);
                plugins.sort((item1, item2) => item1.name.localeCompare(item2.name));
                new HideModal(this.app, this.manager, this, plugins).open();
            }));
            if (this.activePage === "plugins" && this.editorMode && this.shouldRenderPluginLayoutSeparators()) {
                menu.addItem((item) => item.setTitle(t("管理器_布局_添加分割线")).setIcon("separator-horizontal").onClick(async () => {
                    await this.addPluginLayoutSeparator();
                }));
                menu.addItem((item) => item.setTitle(t("管理器_布局_按名称重置")).setIcon("rotate-ccw").onClick(async () => {
                    if (!(await confirmWithModal(this.app, this.manager, t("管理器_布局_重置确认")))) return;
                    await this.resetPluginLayout();
                }));
            }
            menu.addSeparator();
            menu.addItem((item) => item.setTitle(t("管理器_GITHUB_描述")).setIcon("github").onClick(() => {
                window.open("https://github.com/eondrcode/obsidian-manager");
            }));
            menu.addItem((item) => item.setTitle(t("管理器_视频教程_描述")).setIcon("book-open").onClick(() => {
                window.open("https://www.bilibili.com/video/BV1WyrkYMEce/");
            }));
            this.addSupportQQGroupMenuItem(menu);
            menu.showAtMouseEvent(ev);
        });
        footer.appendChild(moreBtn);

        this.modalEl.appendChild(footer);
    }

    /** 标题、统计和当前页操作同属栏目；Page identity, counts and actions share one header. */
    private renderOverviewHeading(): void {
        // 平板：统计与工具固定在顶栏，列表滚动时操作按钮始终可见。
        if (Platform.isTablet && this.activePage === 'plugins' && this.mobileOverviewHost) {
            this.mountOverviewInline(this.mobileOverviewHost);
            return;
        }
        // 桌面端插件总览：统计与工具并入上方过滤块，避免多出一条独立横栏。
        if (!Platform.isMobileApp && this.activePage === 'plugins' && this.desktopFilterWrapper) {
            this.mountOverviewInline(this.desktopFilterWrapper);
            return;
        }
        const header = this.pageEl.createDiv('manager-overview-heading');
        header.dataset.page = this.activePage;
        this.mountOverviewBar();
    }

    /** 把统计与工具挂进指定容器的末行（桌面过滤块 / 平板顶栏）。 */
    private mountOverviewInline(target?: HTMLElement): void {
        const wrapper = target ?? this.desktopFilterWrapper;
        if (!wrapper) return;
        wrapper.addClass('manager-section--overview-inline');
        let row = wrapper.querySelector<HTMLElement>('.manager-overview-inline');
        if (!row) {
            row = wrapper.createDiv('manager-overview-heading manager-overview-inline');
            row.dataset.page = this.activePage;
        }
        row.dataset.page = this.activePage;
        if (this.footEl && this.footEl.parentElement !== row) row.appendChild(this.footEl);
        if (this.pageToolsEl && this.pageToolsEl.parentElement !== row) row.appendChild(this.pageToolsEl);
        this.syncToolVisibility();
        this.observeOverviewToolbar(row);
    }

    public async showData(renderGeneration = this.renderGeneration) {
        this.syncPluginOverviewLayoutClass();
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const page: ManagerPage = "plugins";
        if (!this.isRenderCurrent(renderGeneration, page)) return;
        this.enterScopePage('plugins');
        if (Platform.isTablet && this.mobileScopeHost) {
            // 平板：设备选择放进固定顶栏，和设备/统计/操作同处一块，不随列表滚动。
            this.mobileScopeHost.empty();
            this.renderDeviceScope(this.mobileScopeHost, 'plugins');
        } else if (Platform.isMobile || !this.deviceScopeHostInline) {
            this.renderDeviceScope(this.pageEl.createDiv("manager-plugin-scope"), 'plugins');
        } else {
            this.renderDeviceScope(this.deviceScopeHostInline, 'plugins', true);
        }
        this.renderOverviewHeading();
        if (this.settings.DEBUG) console.log("[BPM] render showData manifests size:", Object.keys(this.appPlugins.manifests).length);
        const uniquePlugins = this.getUniquePluginManifests();
        const manifestById = new Map(uniquePlugins.map((plugin) => [plugin.id, plugin]));
        const pluginSettingsById = new Map(this.manager.settings.Plugins.map((plugin) => [plugin.id, plugin]));
        const dateMetaById = await this.getPluginDateMetaMap(uniquePlugins);
        this.pluginDateMetaById = dateMetaById;
        if (!this.isRenderCurrent(renderGeneration, page)) return;
        const layoutItems = this.getSortedPluginLayoutItems(this.getPluginLayout(uniquePlugins), manifestById, pluginSettingsById, dateMetaById);
        const groupSettingsById = new Map(this.settings.GROUPS.map((group) => [group.id, group]));
        const tagSettingsById = new Map(this.settings.TAGS.map((tag) => [tag.id, tag]));
        const delaySettingsById = new Map(this.settings.DELAYS.map((delay) => [delay.id, delay]));
        const hiddenPluginIds = new Set(this.settings.HIDES || []);
        const lowerSearchText = this.searchText.trim().toLowerCase();
        const statusFilter = this.getStatusFilterValues();
        const statusOperator = this.getStatusFilterOperator();
        const groupFilter = this.getGroupFilterValues();
        const groupOperator = this.getGroupFilterOperator();
        const tagFilter = this.getTagFilterValues();
        const tagOperator = this.getTagFilterOperator();
        const delayFilter = this.getDelayFilterValues();
        const delayOperator = this.getDelayFilterOperator();
        const getBasePath = (this.app.vault.adapter as VaultAdapterWithBasePath).getBasePath?.();
        const basePath = getBasePath ? normalizePath(getBasePath) : "";
        const cfgDir = this.app.vault.configDir;
        const showSeparators = this.shouldRenderPluginLayoutSeparators();
        const canEditLayout = this.editorMode && showSeparators;
        if (this.settings.DEBUG) console.log("[BPM] render showData uniquePlugins:", uniquePlugins.map(p => p.id).join(","));

        if (this.settings.DEBUG) console.log("[BPM] render showData before loop, children:", this.pageEl.children.length);
        this.displayPlugins = [];
        const modeBarHost = (this.bulkEditMode || this.editorMode) ? this.pageEl.createDiv("manager-bulk-bar-host") : null;
        const bulkBarHost = this.bulkEditMode ? modeBarHost : null;
        const editBarHost = this.editorMode ? modeBarHost : null;
        this.bulkBarHostEl = bulkBarHost ?? undefined;
        this.pluginCardControllers.clear();
        const renderedIds = new Set<string>();
        let renderedCount = 0;
        let renderedInBatch = 0;
        for (const [layoutIndex, layoutItem] of layoutItems.entries()) {
            if (!this.isRenderCurrent(renderGeneration, page)) return;
            if (renderedInBatch >= this.renderBatchSize) {
                renderedInBatch = 0;
                await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
                if (!this.isRenderCurrent(renderGeneration, page)) return;
            }
            if (layoutItem.type === "separator") {
                if (canEditLayout) {
                    this.renderPluginLayoutSeparatorEditor(layoutItem, layoutIndex, layoutItems.length);
                    renderedInBatch++;
                } else if (showSeparators) {
                    this.renderPluginLayoutSeparator(layoutItem.title || this.manager.translator.t("管理器_布局_分割线"));
                    renderedInBatch++;
                }
                continue;
            }
            const plugin = manifestById.get(layoutItem.id);
            if (!plugin) continue;
            if (renderedIds.has(plugin.id)) continue;
            renderedIds.add(plugin.id);
            const ManagerPlugin = pluginSettingsById.get(plugin.id);
            if (!ManagerPlugin) continue;
            const isSelf = plugin.id === this.manager.manifest.id;
            const isEnabled = this.isPluginEnabledForDisplay(plugin.id, ManagerPlugin);
            const currentUpdateInfo = this.manager.updateStatus?.[plugin.id] as PluginUpdateViewStatus | undefined;
            const updateProblem = this.getPluginUpdateProblem(currentUpdateInfo);
            if (!this.matchesStatusFilter(ManagerPlugin, plugin, isEnabled, statusFilter, statusOperator, hiddenPluginIds)) continue;
            if (!this.matchesSingleValueFilter(ManagerPlugin.group, groupFilter, groupOperator)) continue;
            if (!this.matchesTagFilter(ManagerPlugin.tags, tagFilter, tagOperator)) continue;
            if (!this.matchesSingleValueFilter(ManagerPlugin.delay, delayFilter, delayOperator)) continue;
            if (lowerSearchText !== "" && !this.getPluginSearchText(ManagerPlugin, plugin).includes(lowerSearchText)) continue;
            if (!this.editorMode && !isSelf && hiddenPluginIds.has(plugin.id) && !statusFilter.includes("hidden")) continue;
            const rawDir = plugin.dir || `plugins/${plugin.id}`;
            const isAbsolute = new RegExp("^(?:[a-zA-Z]:[\\\\/]|[\\\\/])").test(rawDir);
            let pluginDir: string;
            if (isAbsolute) {
                pluginDir = normalizePath(rawDir);
            } else if (rawDir.startsWith(cfgDir) || rawDir.startsWith(".") || rawDir.startsWith("/")) {
                pluginDir = normalizePath(`${basePath}/${rawDir}`);
            } else {
                pluginDir = normalizePath(`${basePath}/${cfgDir}/${rawDir}`);
            }
            if (this.settings.DEBUG) console.log("[BPM] render item", plugin.id, "children before add:", this.pageEl.children.length);

            const itemEl = new Setting(this.pageEl);
            renderedInBatch++;
            itemEl.settingEl.setAttr("data-plugin-id", plugin.id);
            itemEl.setClass("manager-item");
            itemEl.settingEl.addClass("manager-plugin-card");
            itemEl.settingEl.toggleClass("is-enabled", isEnabled);
            itemEl.settingEl.toggleClass("is-disabled", !isEnabled);
            itemEl.settingEl.toggleClass("is-self", isSelf);
            itemEl.settingEl.toggleClass("has-update", Boolean(currentUpdateInfo?.hasUpdate));
            itemEl.settingEl.toggleClass("has-update-problem", Boolean(updateProblem));
            itemEl.settingEl.toggleClass("is-bpm-ignored", ManagerPlugin.tags.includes(BPM_IGNORE_TAG));
            itemEl.settingEl.toggleClass("is-hidden-layout", hiddenPluginIds.has(plugin.id));
            itemEl.settingEl.toggleClass("is-bulk-selected", this.bulkSelectedPluginIds.has(plugin.id));
            itemEl.nameEl.addClass("manager-item__name-container");
            itemEl.nameEl.addClass("manager-plugin-card__header");
            itemEl.descEl.addClass("manager-item__description-container");
            itemEl.descEl.addClass("manager-plugin-card__body");
            itemEl.controlEl.addClass("manager-item__controls");
            itemEl.controlEl.addClass("manager-plugin-card__actions");
            itemEl.controlEl.setAttribute("aria-label", this.manager.translator.t("管理器_插件操作_标签", { name: ManagerPlugin.name }));
            if (canEditLayout) {
                itemEl.settingEl.addClass("manager-layout-editable-card");
                itemEl.settingEl.addClass("manager-plugin-card--layout-editing");
                this.bindPluginLayoutDragHandle(itemEl.settingEl, layoutIndex, ManagerPlugin.name || plugin.name || plugin.id);
            }
            if (this.bulkEditMode) {
                const selection = itemEl.settingEl.createDiv("manager-plugin-card__bulk-select");
                const checkbox = selection.createEl("input", { type: "checkbox" });
                checkbox.checked = this.bulkSelectedPluginIds.has(plugin.id);
                checkbox.disabled = isSelf;
                checkbox.setAttribute("aria-label", t("批量编辑_选择插件", { name: ManagerPlugin.name || plugin.name || plugin.id }));
                checkbox.addEventListener("click", (event) => event.stopPropagation());
                checkbox.addEventListener("change", () => {
                    this.toggleBulkPluginSelection(plugin.id, checkbox.checked);
                });
                itemEl.settingEl.addEventListener("click", (event) => {
                    const target = event.target;
                    if (target instanceof HTMLElement && target.closest(".manager-plugin-card__actions, .manager-plugin-card__bulk-select, .manager-tag, .clickable-icon, button, input, select, textarea, a")) return;
                    this.toggleBulkPluginSelection(plugin.id, !this.bulkSelectedPluginIds.has(plugin.id));
                });
            }

            // [右键操作]
            itemEl.settingEl.addEventListener("contextmenu", (event) => {
                if (this.bulkEditMode) return;
                event.preventDefault(); // 阻止默认的右键菜单
                const currentIsEnabled = this.isPluginEnabledForDisplay(plugin.id, ManagerPlugin);
                const currentIsBpmIgnored = ManagerPlugin.tags?.includes(BPM_IGNORE_TAG);
                const menu = new Menu();
                let hasContextMenuItems = false;
                const addContextSeparator = () => {
                    if (hasContextMenuItems) menu.addSeparator();
                };
                // 第一组：插件信息类
                if (this.actionInMore("checkUpdate")) {
                    menu.addItem((item) =>
                        item.setTitle(this.manager.translator.t("菜单_检查更新_标题"))
                            .setIcon("rss")
                            .onClick(async () => {
                                await this.runSinglePluginUpdateCheck(plugin.id);
                            })
                    );
                    hasContextMenuItems = true;
                }
                if (this.isMainPageActionInMenu("downloadUpdate") && currentUpdateInfo?.hasUpdate && currentUpdateInfo.remoteVersion && !this.getPluginUpdateProblem(currentUpdateInfo)) {
                    menu.addItem((item) =>
                        item.setTitle(this.manager.translator.t("管理器_下载更新_描述"))
                            .setIcon("download")
                            .onClick(() => {
                                this.openPluginUpdateModal(plugin.id, currentUpdateInfo);
                            })
                    );
                    hasContextMenuItems = true;
                }
                // 第二组：插件管理类
                const hasIgnoredEnableMenuItem = Boolean(currentIsBpmIgnored && this.isMainPageActionInMenu("enableIgnored"));
                const hasManageMenuItems = (!this.settings.DELAY && (this.isMainPageActionInMenu("singleStart") || this.isMainPageActionInMenu("restart"))) || hasIgnoredEnableMenuItem || this.actionInMore("hide");
                if (hasManageMenuItems) addContextSeparator();
                // [菜单] 单次启动
                if (!this.settings.DELAY && this.isMainPageActionInMenu("singleStart")) menu.addItem((item) =>
                    item.setTitle(this.manager.translator.t("菜单_单次启动_描述"))
                        .setIcon("repeat-1")
                        .setDisabled(isSelf || currentIsEnabled)
                        .onClick(async () => {
                            await this.singleStartPlugin(plugin);
                        })
                );
                // [菜单] 重启插件
                if (!this.settings.DELAY && this.isMainPageActionInMenu("restart")) menu.addItem((item) =>
                    item.setTitle(this.manager.translator.t("菜单_重启插件_描述"))
                        .setIcon("refresh-ccw")
                        .setDisabled(isSelf || !currentIsEnabled)
                        .onClick(async () => {
                            await this.restartPlugin(plugin);
                        })
                );
                if (hasIgnoredEnableMenuItem) menu.addItem((item) =>
                    item.setTitle(this.manager.translator.t("菜单_启用BPM忽略插件_标题"))
                        .setIcon("shield-check")
                        .setDisabled(isSelf)
                        .onClick(async () => {
                            await this.enableBpmIgnoredPlugin(plugin, ManagerPlugin);
                        })
                );
                // [菜单] 隐藏插件
                if (this.actionInMore("hide")) menu.addItem((item) =>
                    item.setTitle(this.manager.translator.t("菜单_隐藏插件_标题"))
                        .setIcon("eye-off")
                        .setDisabled(isSelf)
                        .onClick(() => {
                            if (isSelf) return;
                            this.togglePluginHidden(plugin.id);
                        })
                );
                if (hasManageMenuItems) hasContextMenuItems = true;
                // [菜单] 分享插件
                // menu.addItem((item) =>
                //     item.setTitle("分享插件_标题")
                //         .setIcon("share-2")
                //         .onClick(() => {
                //             const plugins: PluginManifest[] = Object.values(this.appPlugins.manifests);
                //             plugins.sort((item1, item2) => { return item1.name.localeCompare(item2.name); });
                //         })
                // );

                const hasOpenMenuItems = this.isMainPageActionInMenu("openSettings") || this.actionInMore("openDir") || this.actionInMore("openRepo") || this.actionInMore("clearConfig") || this.actionInMore("delete");
                if (hasOpenMenuItems) addContextSeparator();
                if (this.isMainPageActionInMenu("openSettings")) {
                    menu.addItem((item) =>
                        item.setTitle(this.manager.translator.t("管理器_打开设置_描述"))
                            .setIcon("settings")
                            .setDisabled(!currentIsEnabled)
                            .onClick(() => {
                                this.openSettingsTab(plugin.id);
                            })
                    );
                }
                if (this.actionInMore("openDir")) {
                    menu.addItem((item) =>
                        item.setTitle(this.manager.translator.t("管理器_打开目录_描述"))
                            .setIcon("folder-open")
                            .onClick(() => {
                                managerOpen(pluginDir, this.manager);
                            })
                    );
                }
                if (this.actionInMore("openRepo")) {
                    menu.addItem((item) =>
                        item.setTitle(this.manager.translator.t("管理器_打开仓库_标题"))
                            .setIcon("github")
                            .onClick(async () => {
                                await this.openPluginRepo(plugin.id);
                            })
                    );
                }
                if (this.actionInMore("clearConfig")) {
                    menu.addItem((item) =>
                        item.setTitle(this.manager.translator.t("管理器_清空配置_描述"))
                            .setIcon("file-cog")
                            .setDisabled(isSelf)
                            .onClick(async () => {
                                await this.clearPluginConfig(plugin, isSelf);
                            })
                    );
                }
                if (this.actionInMore("delete")) {
                    menu.addItem((item) =>
                        item.setTitle(this.manager.translator.t("管理器_删除插件_描述"))
                            .setIcon("trash")
                            .setDisabled(isSelf)
                            .onClick(async () => {
                                await this.uninstallPluginWithConfirm(plugin, isSelf);
                            })
                    );
                }
                if (hasOpenMenuItems) hasContextMenuItems = true;

                // 第三组：插件设置类
                const hasConfigMenuItems = this.actionInMore("note") || this.actionInMore("hotkeys") || this.actionInMore("copyId");
                if (hasConfigMenuItems) addContextSeparator();
                // [菜单] 插件笔记
                if (this.actionInMore("note")) menu.addItem((item) =>
                    item.setTitle(this.manager.translator.t("菜单_笔记_标题")).setIcon("notebook-pen").onClick(() => { new NoteModal(this.app, this.manager, ManagerPlugin, this).open(); })
                );
                // [菜单] 快捷键
                if (this.actionInMore("hotkeys")) menu.addItem((item) =>
                    item.setTitle(this.manager.translator.t("菜单_快捷键_标题")).setIcon("circle-plus").onClick(async () => {
                        await this.openPluginHotkeys(plugin.id);
                    })
                );
                // [菜单] 复制ID
                if (this.actionInMore("copyId")) menu.addItem((item) =>
                    item.setTitle(this.manager.translator.t("菜单_复制ID_标题"))
                        .setIcon("copy")
                        .onClick(() => {
                            this.copyPluginId(plugin.id);
                        })
                );
                if (hasConfigMenuItems) hasContextMenuItems = true;
                // 第三组：测试类
                // menu.addSeparator(); // 分隔符

                // menu.addItem((item) =>
                //     item.setTitle("打开市场")
                //         .setIcon("store")
                //         .onClick(async () => {
                //             // await this.app.setting.open();
                //             // await this.app.setting.openTabById("community-plugins");
                //             // // 可选：自动聚焦搜索框
                //             // const tab = await this.app.setting.activeTab;
                //             // tab.searchComponent.inputEl.focus();

                //             await this.appSetting.open();
                //             await this.appSetting.openTabById("community-plugins");
                //             console.log(this.appSetting);
                //             setTimeout(async () => {
                //                 const tab = await this.appSetting.activeTab;
                //                 const button = tab.containerEl.querySelector('button.mod-cta');
                //                 if (button) (button as HTMLElement).click();

                //             });
                //         })
                // );


                // menu.addSeparator();
                // menu.addItem((item) =>
                //     item.setTitle("分组")
                //         .setIcon("group")
                //         .onClick(async () => {
                //         })
                // );
                // menu.addItem((item) =>
                //     item.setTitle("标签")
                //         .setIcon("tags")
                //         .setDisabled(isEnabled)
                //         .onClick(async () => {
                //         })
                // );
                menu.showAtPosition({ x: event.clientX, y: event.clientY });
            });

            // [淡化插件]
            if (this.settings.FADE_OUT_DISABLED_PLUGINS && !isEnabled) itemEl.settingEl.addClass("inactive");

            // [批量操作]
            this.displayPlugins.push(plugin);
            renderedCount++;

            // [目录样式]
            if (!this.editorMode && !this.bulkEditMode) {
                switch (this.settings.ITEM_STYLE) {
                    case "alwaysExpand": itemEl.descEl.addClass("manager-display-block"); break;
                    case "neverExpand": itemEl.descEl.addClass("manager-display-none"); break;
                    case "hoverExpand":
                        itemEl.descEl.addClass("manager-display-none");
                        itemEl.settingEl.addEventListener(
                            "mouseenter",
                            () => {
                                itemEl.descEl.removeClass("manager-display-none");
                                itemEl.descEl.addClass("manager-display-block");
                            }
                        );
                        itemEl.settingEl.addEventListener(
                            "mouseleave",
                            () => {
                                itemEl.descEl.removeClass("manager-display-block");
                                itemEl.descEl.addClass("manager-display-none");
                            }
                        );
                        break;
                    case "clickExpand":
                        itemEl.descEl.addClass("manager-display-none");
                        itemEl.settingEl.addEventListener(
                            "click",
                            function (event) {
                                const excludedButtons = Array.from(
                                    itemEl.controlEl.querySelectorAll("div")
                                );
                                if (event.target instanceof HTMLDivElement && excludedButtons.includes(event.target)) {
                                    event.stopPropagation();
                                    return;
                                }
                                if (
                                    itemEl.descEl.hasClass("manager-display-none")
                                ) {
                                    itemEl.descEl.removeClass("manager-display-none");
                                    itemEl.descEl.addClass("manager-display-block");
                                } else {
                                    itemEl.descEl.removeClass("manager-display-block");
                                    itemEl.descEl.addClass("manager-display-none");
                                }
                            }
                        );
                        break;
                }
            }

            const cardIcon = createSpan({ cls: "manager-plugin-card__icon" });
            cardIcon.setAttribute("aria-hidden", "true");
            this.manager.pluginIcons.render(cardIcon, plugin.id, isEnabled);
            itemEl.nameEl.appendChild(cardIcon);
            // 图标旁的双行标题，名称与运行元信息分开；Two text rows beside the plugin icon.
            const headingText = itemEl.nameEl.createDiv('manager-plugin-card__heading-text');
            const titleRow = headingText.createDiv('manager-plugin-card__title-row');
            const metadataRow = headingText.createDiv('manager-plugin-card__metadata-row');

            // [默认] 分组
            if (ManagerPlugin.group !== "") {
                const group = createSpan({ cls: "manager-item__name-group", });
                titleRow.appendChild(group);
                const item = groupSettingsById.get(ManagerPlugin.group);
                if (item) {
                    const tag = this.manager.createTag(item.name, item.color, this.settings.GROUP_STYLE);
                    tag.addClass("manager-item__group-chip");
                    tag.setAttribute("role", "button");
                    tag.setAttribute("tabindex", "0");
                    tag.setAttribute("aria-label", this.manager.translator.t("分组编辑_打开切换", { name: ManagerPlugin.name || plugin.name || plugin.id }));
                    const openGroupModal = (event?: Event) => {
                        event?.preventDefault();
                        event?.stopPropagation();
                        new GroupModal(this.app, this.manager, this, ManagerPlugin).open();
                    };
                    tag.onclick = openGroupModal;
                    tag.addEventListener("keydown", (event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        openGroupModal(event);
                    });
                    group.appendChild(tag);
                }
            }
            // [编辑] 分组
            if (ManagerPlugin.group === "" && this.editorMode) {
                const group = createSpan({ cls: "manager-item__name-group", });
                if (this.editorMode) titleRow.appendChild(group);
                const tag = this.manager.createTag("+", "", "");
                if (this.editorMode) tag.onclick = () => { new GroupModal(this.app, this.manager, this, ManagerPlugin).open(); };
                if (this.editorMode) group.appendChild(tag);
            }

            // [默认] 名称
            const title = createSpan({ text: ManagerPlugin.name, title: plugin.name, cls: "manager-item__name-title", });
            // [编辑] 名称
            if (this.editorMode) {
                title.setAttribute("contenteditable", "true");
                title.addEventListener("input", () => {
                    void (async () => {
                    if (title.textContent) {
                        ManagerPlugin.name = title.textContent;
                        await this.manager.savePluginAndExport(plugin.id);
                        Commands(this.app, this.manager);
                    }
                    })();
                });
            }
            titleRow.appendChild(title);

            const statusChip = createSpan({
                text: isSelf
                    ? this.manager.translator.t("管理器_状态_管理器")
                    : (isEnabled ? this.manager.translator.t("管理器_状态_启用中") : this.manager.translator.t("管理器_状态_已禁用")),
                cls: `manager-plugin-card__state ${isSelf ? "is-self" : (isEnabled ? "is-enabled" : "is-disabled")}`,
            });
            metadataRow.appendChild(statusChip);
            this.renderRecentInstallBadge(metadataRow, dateMetaById.get(plugin.id)?.installedAt);

            // [默认] 版本
            const versionWrap = createDiv({ cls: "manager-item__versions" });
            const version = createSpan({ text: `[${plugin.version}]`, cls: ["manager-item__name-version"], });
            versionWrap.appendChild(version);
            if (!this.editorMode) {
                versionWrap.addClass("manager-item__versions--clickable");
                versionWrap.addEventListener("click", () => {
                    void this.openPluginVersionList(plugin.id, this.manager.updateStatus?.[plugin.id] as PluginUpdateViewStatus | undefined);
                });
            }
            const updateInfo = currentUpdateInfo;
            if (updateInfo && updateProblem) {
                this.appendPluginUpdateProblem(versionWrap, updateInfo);
            } else if (updateInfo?.hasUpdate && updateInfo.remoteVersion) {
                const arrow = createSpan({ text: "→", cls: ["manager-item__name-remote-arrow"] });
                versionWrap.appendChild(arrow);
                const remote = createSpan({ text: `${updateInfo.remoteVersion}`, cls: ["manager-item__name-remote"] });
                versionWrap.appendChild(remote);
                if (!this.editorMode) {
                    this.addPluginDownloadButton(itemEl.controlEl, plugin.id, updateInfo);
                }
            }
            titleRow.appendChild(versionWrap);
            this.renderDesktopOnlyBadge(titleRow, plugin, versionWrap);

            // [默认] 笔记图标
            if (ManagerPlugin.note?.length > 0) {
                const note = createSpan();
                note.addClass("manager-plugin-card__note");
                note.addEventListener("click", () => { new NoteModal(this.app, this.manager, ManagerPlugin, this).open(); });
                titleRow.appendChild(note);
                setIcon(note, "notebook-pen");
            }

            // [默认] 延迟
            if (this.settings.DELAY && !this.editorMode && !isSelf && ManagerPlugin.delay !== "") {
                const d = delaySettingsById.get(ManagerPlugin.delay);
                if (d) {
                    const delay = this.createDelayBadge(d.time);
                    metadataRow.prepend(delay);
                }
            }
            this.renderPluginReleaseBadge(titleRow, plugin.version);
            // [默认] 描述 / 笔记视图
            const hasDescription = ManagerPlugin.desc.trim().length > 0;
            const noteText = ManagerPlugin.note?.trim() || "";
            const hasNote = noteText.length > 0;
            const storedView = this.settings.PLUGIN_CARD_VIEW?.[plugin.id];
            let defaultView: "description" | "note" = hasNote && storedView !== "description" ? "note" : "description";
            let cardView: "description" | "note" = defaultView;
            const desc = createDiv({ text: ManagerPlugin.desc, title: plugin.description, cls: ["manager-item__name-desc"], });
            desc.addClass("manager-plugin-card__desc");

            // [编辑] 描述
            if (this.editorMode) {
                desc.setAttribute("contenteditable", "true");
                desc.addEventListener("input", () => {
                    void (async () => {
                    if (desc.textContent) {
                        ManagerPlugin.desc = desc.textContent;
                        await this.manager.savePluginAndExport(plugin.id);
                    }
                    })();
                });
            }

            let viewBar: HTMLElement | null = null;
            let viewToggle: HTMLButtonElement | null = null;
            let viewToggleIcon: HTMLElement | null = null;
            let viewDefault: HTMLButtonElement | null = null;
            let viewDefaultIcon: HTMLElement | null = null;

            const contentEl = itemEl.descEl.createDiv("manager-plugin-card__content");
            if (!this.editorMode && hasNote) {
                contentEl.addClass("manager-plugin-card__content--inline-switch");
                viewBar = contentEl.createDiv("manager-plugin-card__view-bar");
                viewToggle = viewBar.createEl("button", { cls: "manager-plugin-card__view-toggle", attr: { type: "button" } });
                viewToggleIcon = viewToggle.createSpan("manager-plugin-card__view-toggle-icon");
                viewDefault = viewBar.createEl("button", { cls: "manager-plugin-card__view-default", attr: { type: "button" } });
                viewDefaultIcon = viewDefault.createSpan("manager-plugin-card__view-default-icon");
            }
            contentEl.appendChild(desc);
            const noteView = !this.editorMode && hasNote
                ? contentEl.createDiv({ cls: "manager-plugin-card__note-view", text: noteText })
                : null;

            const syncCardView = () => {
                contentEl.toggleClass("is-note", cardView === "note");
                contentEl.toggleClass("is-description", cardView === "description");
                desc.toggleClass("manager-plugin-card__desc--hidden", cardView === "note");
                noteView?.toggleClass("manager-plugin-card__note-view--hidden", cardView !== "note");
                if (viewToggle && viewToggleIcon) {
                    setIcon(viewToggleIcon, "refresh-cw");
                    const tooltip = t(cardView === "note" ? "卡片视图_切换到描述" : "卡片视图_切换到笔记");
                    viewToggle.setAttribute("aria-label", tooltip);
                    viewToggle.title = tooltip;
                }
                if (viewDefault && viewDefaultIcon) {
                    const isDefault = cardView === defaultView;
                    setIcon(viewDefaultIcon, isDefault ? "circle-dot" : "circle");
                    viewDefault.toggleClass("is-default", isDefault);
                    viewDefault.setAttribute("aria-pressed", `${isDefault}`);
                    viewDefault.setAttribute("aria-label", t("卡片视图_设为默认"));
                    viewDefault.title = t("卡片视图_设为默认");
                }
            };

            viewToggle?.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                cardView = cardView === "note" ? "description" : "note";
                syncCardView();
            });
            viewDefault?.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                defaultView = cardView;
                const next = { ...(this.settings.PLUGIN_CARD_VIEW || {}) };
                next[plugin.id] = cardView;
                this.settings.PLUGIN_CARD_VIEW = next;
                syncCardView();
                void this.manager.saveSettings().catch(error => this.manager.devices.report(error));
            });
            syncCardView();

            const dateMeta = dateMetaById.get(plugin.id);
            const dateMetaItems: Array<{ icon: string; label: string; value?: string }> = [
                { icon: "calendar-plus", label: t("排序_安装日期_标签"), value: this.formatSourceDate(dateMeta?.installedAt) },
                { icon: "calendar-clock", label: t("排序_更新日期_标签"), value: this.formatSourceDate(dateMeta?.updatedAt) },
            ].filter((item) => Boolean(item.value));
            const hasDateMeta = dateMetaItems.length > 0;
            let dateMetaEl: HTMLElement | null = null;
            if (hasDateMeta) {
                dateMetaEl = createDiv({ cls: "manager-plugin-card__date-meta" });
                for (const item of dateMetaItems) {
                    const metaItem = dateMetaEl.createSpan({ cls: "manager-plugin-card__date-meta-item" });
                    const icon = metaItem.createSpan({ cls: "manager-plugin-card__date-meta-icon" });
                    setIcon(icon, item.icon);
                    metaItem.createSpan({ text: `${item.label} ${item.value}` });
                }
                itemEl.descEl.appendChild(dateMetaEl);
            }

            // [默认] 标签组
            const tags = createDiv();
            tags.addClass("manager-plugin-card__tags");
            itemEl.descEl.appendChild(tags);
            let visibleTagCount = 0;
            ManagerPlugin.tags.map((id: string) => {
                const item = tagSettingsById.get(id);
                if (item) {
                    if ((item.id === BPM_TAG_ID || item.id === BPM_IGNORE_TAG) && this.settings.HIDE_BPM_TAG) {
                        // skip render
                    } else {
                        const tag = this.manager.createTag(item.name, item.color, this.settings.TAG_STYLE);
                        if (this.editorMode && item.id !== BPM_TAG_ID) tag.onclick = () => { new TagsModal(this.app, this.manager, this, ManagerPlugin).open(); };
                        tags.appendChild(tag);
                        visibleTagCount++;
                    }
                }
            });

            // [编辑] 标签组
            if (this.editorMode) {
                const tag = this.manager.createTag("+", "", "");
                tag.onclick = () => { new TagsModal(this.app, this.manager, this, ManagerPlugin).open(); };
                tags.appendChild(tag);
            }

            const hasVisibleTags = this.editorMode || visibleTagCount > 0;
            const hasExpandedDetails = this.editorMode || hasDescription || hasNote || hasVisibleTags || hasDateMeta;
            itemEl.settingEl.toggleClass("has-description", hasDescription);
            itemEl.settingEl.toggleClass("has-visible-tags", hasVisibleTags);
            itemEl.settingEl.toggleClass("has-date-meta", hasDateMeta);
            itemEl.descEl.toggleClass("manager-plugin-card__body--empty", !hasExpandedDetails);

            if (!this.editorMode) {
                const isMobile = Platform.isMobile;

                let openPluginSetting: ExtraButtonComponent | null = null;
                let openPluginSettingEl: HTMLElement | undefined;
                let singleStartButton: ExtraButtonComponent | null = null;
                let restartButton: ExtraButtonComponent | null = null;
                let enableIgnoredButton: ExtraButtonComponent | null = null;


                if (isMobile && [
                    "checkUpdate",
                    "downloadUpdate",
                    "singleStart",
                    "restart",
                    ...(ManagerPlugin.tags?.includes(BPM_IGNORE_TAG) ? ["enableIgnored"] : []),
                    "hide",
                    "note",
                    "hotkeys",
                    "copyId",
                    "openRepo",
                    "openSettings",
                    "openDir",
                    "delete",
                ].some((id) => this.actionInMore(id as MainPageActionId))) {
                    const moreButton = new ExtraButtonComponent(itemEl.controlEl);
                    moreButton.setIcon("more-vertical");
                    moreButton.setTooltip(this.manager.translator.t("管理器_更多操作_描述"));
                    const moreEl = getExtraButtonElement(moreButton);
                    this.bindLongPressTooltip(moreEl, this.manager.translator.t("管理器_更多操作_描述"));
                    moreEl?.addEventListener("click", (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const currentIsEnabled = this.isPluginEnabledForDisplay(plugin.id, ManagerPlugin);
                        const currentIsBpmIgnored = ManagerPlugin.tags?.includes(BPM_IGNORE_TAG);
                        const menu = new Menu();
                        let hasPreviousGroup = false;
                        let hasCurrentGroup = false;
                        if (this.actionInMore("checkUpdate")) {
                            menu.addItem((item) => item
                                .setTitle(this.manager.translator.t("菜单_检查更新_标题"))
                                .setIcon("rss")
                                .onClick(async () => {
                                    await this.runSinglePluginUpdateCheck(plugin.id);
                                }));
                            hasCurrentGroup = true;
                        }
                        const currentUpdateInfo = this.manager.updateStatus?.[plugin.id] as PluginUpdateViewStatus | undefined;
                        if (this.isMainPageActionInMenu("downloadUpdate") && currentUpdateInfo?.hasUpdate && currentUpdateInfo.remoteVersion && !this.getPluginUpdateProblem(currentUpdateInfo)) {
                            menu.addItem((item) => item
                                .setTitle(this.manager.translator.t("管理器_下载更新_描述"))
                                .setIcon("download")
                                .onClick(() => {
                                    this.openPluginUpdateModal(plugin.id, currentUpdateInfo);
                                }));
                            hasCurrentGroup = true;
                        }
                        hasPreviousGroup = hasCurrentGroup;
                        hasCurrentGroup = false;

                        if (!this.settings.DELAY && this.isMainPageActionInMenu("singleStart")) {
                            if (hasPreviousGroup && !hasCurrentGroup) menu.addSeparator();
                            menu.addItem((item) => item
                                .setTitle(this.manager.translator.t("菜单_单次启动_描述"))
                                .setIcon("repeat-1")
                                .setDisabled(isSelf || currentIsEnabled)
                                .onClick(async () => {
                                    await this.singleStartPlugin(plugin);
                                }));
                            hasCurrentGroup = true;
                        }
                        if (!this.settings.DELAY && this.isMainPageActionInMenu("restart")) {
                            if (hasPreviousGroup && !hasCurrentGroup) menu.addSeparator();
                            menu.addItem((item) => item
                                .setTitle(this.manager.translator.t("菜单_重启插件_描述"))
                                .setIcon("refresh-ccw")
                                .setDisabled(isSelf || !currentIsEnabled)
                                .onClick(async () => {
                                    await this.restartPlugin(plugin);
                                }));
                            hasCurrentGroup = true;
                        }
                        if (currentIsBpmIgnored && this.isMainPageActionInMenu("enableIgnored")) {
                            if (hasPreviousGroup && !hasCurrentGroup) menu.addSeparator();
                            menu.addItem((item) => item
                                .setTitle(this.manager.translator.t("菜单_启用BPM忽略插件_标题"))
                                .setIcon("shield-check")
                                .setDisabled(isSelf)
                                .onClick(async () => {
                                    await this.enableBpmIgnoredPlugin(plugin, ManagerPlugin);
                                }));
                            hasCurrentGroup = true;
                        }
                        if (this.actionInMore("hide")) {
                            if (hasPreviousGroup && !hasCurrentGroup) menu.addSeparator();
                            menu.addItem((item) => item
                                .setTitle(this.manager.translator.t("菜单_隐藏插件_标题"))
                                .setIcon("eye-off")
                                .setDisabled(isSelf)
                                .onClick(() => {
                                    if (isSelf) return;
                                    this.togglePluginHidden(plugin.id);
                                }));
                            hasCurrentGroup = true;
                        }
                        hasPreviousGroup = hasPreviousGroup || hasCurrentGroup;
                        hasCurrentGroup = false;

                        if (this.isMainPageActionInMenu("openSettings")) {
                            if (hasPreviousGroup && !hasCurrentGroup) menu.addSeparator();
                            menu.addItem((item) => item
                                .setTitle(this.manager.translator.t("管理器_打开设置_描述"))
                                .setIcon("settings")
                                .setDisabled(!currentIsEnabled)
                                .onClick(() => {
                                    this.openSettingsTab(plugin.id);
                                }));
                            hasCurrentGroup = true;
                        }
                        if (this.actionInMore("openDir")) {
                            if (hasPreviousGroup && !hasCurrentGroup) menu.addSeparator();
                            menu.addItem((item) => item
                                .setTitle(this.manager.translator.t("管理器_打开目录_描述"))
                                .setIcon("folder-open")
                                .onClick(() => {
                                    managerOpen(pluginDir, this.manager);
                                }));
                            hasCurrentGroup = true;
                        }
                        if (this.actionInMore("openRepo")) {
                            if (hasPreviousGroup && !hasCurrentGroup) menu.addSeparator();
                            menu.addItem((item) => item
                                .setTitle(this.manager.translator.t("管理器_打开仓库_标题"))
                                .setIcon("github")
                                .onClick(async () => {
                                    await this.openPluginRepo(plugin.id);
                                }));
                            hasCurrentGroup = true;
                        }
                        if (this.actionInMore("clearConfig")) {
                            if (hasPreviousGroup && !hasCurrentGroup) menu.addSeparator();
                            menu.addItem((item) => item
                                .setTitle(this.manager.translator.t("管理器_清空配置_描述"))
                                .setIcon("file-cog")
                                .setDisabled(isSelf)
                                .onClick(async () => {
                                    await this.clearPluginConfig(plugin, isSelf);
                                }));
                            hasCurrentGroup = true;
                        }
                        if (this.actionInMore("delete")) {
                            if (hasPreviousGroup && !hasCurrentGroup) menu.addSeparator();
                            menu.addItem((item) => item
                                .setTitle(this.manager.translator.t("管理器_删除插件_描述"))
                                .setIcon("trash")
                                .setDisabled(isSelf)
                                .onClick(async () => {
                                    await this.uninstallPluginWithConfirm(plugin, isSelf);
                                }));
                            hasCurrentGroup = true;
                        }
                        hasPreviousGroup = hasPreviousGroup || hasCurrentGroup;
                        hasCurrentGroup = false;

                        if (this.actionInMore("note")) {
                            if (hasPreviousGroup && !hasCurrentGroup) menu.addSeparator();
                            menu.addItem((item) => item
                                .setTitle(this.manager.translator.t("菜单_笔记_标题"))
                                .setIcon("notebook-pen")
                                .onClick(() => { new NoteModal(this.app, this.manager, ManagerPlugin, this).open(); }));
                            hasCurrentGroup = true;
                        }
                        if (this.actionInMore("hotkeys")) {
                            if (hasPreviousGroup && !hasCurrentGroup) menu.addSeparator();
                            menu.addItem((item) => item
                                .setTitle(this.manager.translator.t("菜单_快捷键_标题"))
                                .setIcon("circle-plus")
                                .onClick(async () => {
                                    await this.openPluginHotkeys(plugin.id);
                                }));
                            hasCurrentGroup = true;
                        }
                        if (this.actionInMore("copyId")) {
                            if (hasPreviousGroup && !hasCurrentGroup) menu.addSeparator();
                            menu.addItem((item) => item
                                .setTitle(this.manager.translator.t("菜单_复制ID_标题"))
                                .setIcon("copy")
                                .onClick(() => {
                                    this.copyPluginId(plugin.id);
                                }));
                        }
                        menu.showAtMouseEvent(event);
                    });
                }

                const checkUpdateButton = this.createConfiguredItemAction(itemEl.controlEl, "checkUpdate");
                if (checkUpdateButton) {
                    checkUpdateButton.setIcon("rss");
                    checkUpdateButton.setTooltip(this.manager.translator.t("菜单_检查更新_标题"));
                    checkUpdateButton.onClick(async () => {
                        await this.runSinglePluginUpdateCheck(plugin.id);
                    });
                }

                if (!this.settings.DELAY) {
                    singleStartButton = this.createConfiguredItemAction(itemEl.controlEl, "singleStart");
                    if (singleStartButton) {
                        singleStartButton.setIcon("repeat-1");
                        singleStartButton.setTooltip(this.manager.translator.t("菜单_单次启动_描述"));
                        singleStartButton.setDisabled(isSelf || isEnabled);
                        singleStartButton.onClick(async () => {
                            await this.singleStartPlugin(plugin);
                        });
                    }

                    restartButton = this.createConfiguredItemAction(itemEl.controlEl, "restart");
                    if (restartButton) {
                        restartButton.setIcon("refresh-ccw");
                        restartButton.setTooltip(this.manager.translator.t("菜单_重启插件_描述"));
                        restartButton.setDisabled(isSelf || !isEnabled);
                        restartButton.onClick(async () => {
                            await this.restartPlugin(plugin);
                        });
                    }
                }

                const hideButton = this.createConfiguredItemAction(itemEl.controlEl, "hide");
                if (hideButton) {
                    hideButton.setIcon("eye-off");
                    hideButton.setTooltip(this.manager.translator.t("菜单_隐藏插件_标题"));
                    hideButton.setDisabled(isSelf);
                    hideButton.onClick(() => {
                        if (isSelf) return;
                        this.togglePluginHidden(plugin.id);
                    });
                }

                const noteButton = this.createConfiguredItemAction(itemEl.controlEl, "note");
                if (noteButton) {
                    noteButton.setIcon("notebook-pen");
                    noteButton.setTooltip(this.manager.translator.t("菜单_笔记_标题"));
                    noteButton.onClick(() => { new NoteModal(this.app, this.manager, ManagerPlugin, this).open(); });
                }

                const hotkeysButton = this.createConfiguredItemAction(itemEl.controlEl, "hotkeys");
                if (hotkeysButton) {
                    hotkeysButton.setIcon("circle-plus");
                    hotkeysButton.setTooltip(this.manager.translator.t("菜单_快捷键_标题"));
                    hotkeysButton.onClick(async () => {
                        await this.openPluginHotkeys(plugin.id);
                    });
                }

                const copyIdButton = this.createConfiguredItemAction(itemEl.controlEl, "copyId");
                if (copyIdButton) {
                    copyIdButton.setIcon("copy");
                    copyIdButton.setTooltip(this.manager.translator.t("菜单_复制ID_标题"));
                    copyIdButton.onClick(() => {
                        this.copyPluginId(plugin.id);
                    });
                }

                if (ManagerPlugin.tags?.includes(BPM_IGNORE_TAG)) {
                    enableIgnoredButton = this.createConfiguredItemAction(itemEl.controlEl, "enableIgnored");
                    if (enableIgnoredButton) {
                        enableIgnoredButton.setIcon("shield-check");
                        enableIgnoredButton.setTooltip(this.manager.translator.t("菜单_启用BPM忽略插件_标题"));
                        enableIgnoredButton.setDisabled(isSelf);
                        enableIgnoredButton.onClick(async () => {
                            await this.enableBpmIgnoredPlugin(plugin, ManagerPlugin);
                        });
                    }
                }

                const openRepoButton = this.createConfiguredItemAction(itemEl.controlEl, "openRepo");
                if (openRepoButton) {
                    openRepoButton.setIcon("github");
                    const knownRepo = this.manager.settings.REPO_MAP?.[plugin.id] || null;
                    const repoState = this.resolvePluginRepoAction(plugin.id, knownRepo);
                    openRepoButton.setTooltip(knownRepo ? repoState.tooltip : this.manager.translator.t("管理器_打开仓库_标题"));
                    openRepoButton.setDisabled(false);
                    openRepoButton.onClick(async () => {
                        await this.openPluginRepo(plugin.id, knownRepo);
                    });
                }

                // [按钮] 打开设置
                openPluginSetting = this.createConfiguredItemAction(itemEl.controlEl, "openSettings");
                if (openPluginSetting) {
                    openPluginSetting.setIcon("settings");
                    openPluginSetting.setTooltip(this.manager.translator.t("管理器_打开设置_描述"));
                    openPluginSetting.onClick(() => {
                        if (this.blockForeignScopeAction(this.manager.translator.t("管理器_打开设置_描述"))) return;
                        openPluginSetting?.setDisabled(true);
                        void (async () => {
                            try {
                                await this.appSetting.open();
                                await this.appSetting.openTabById(plugin.id);
                            } finally {
                                openPluginSetting?.setDisabled(false);
                            }
                        })();
                    });
                    openPluginSettingEl = getExtraButtonElement(openPluginSetting);
                    if (!isEnabled) {
                        openPluginSetting.setDisabled(true);
                        openPluginSettingEl?.addClass("manager-display-none");
                    }
                }

                // [按钮] 打开目录
                const openPluginDirButton = this.createConfiguredItemAction(itemEl.controlEl, "openDir");
                if (openPluginDirButton) {
                    openPluginDirButton.setIcon("folder-open");
                    openPluginDirButton.setTooltip(this.manager.translator.t("管理器_打开目录_描述"));
                    openPluginDirButton.onClick(() => {
                        openPluginDirButton.setDisabled(true);
                        managerOpen(pluginDir, this.manager);
                        openPluginDirButton.setDisabled(false);
                    });
                }

                // [按钮] 加入/移出命令面板（按插件单独注册 toggle-<plugin>）
                if (!isSelf && !ManagerPlugin.tags?.includes(BPM_IGNORE_TAG)) {
                    const commandButton = new ExtraButtonComponent(itemEl.controlEl);
                    commandButton.setIcon("command");
                    const commandIds = () => Array.isArray(this.manager.settings.COMMAND_TOGGLE_PLUGINS)
                        ? this.manager.settings.COMMAND_TOGGLE_PLUGINS : [];
                    const syncCommandButton = () => {
                        const active = commandIds().includes(plugin.id);
                        commandButton.extraSettingsEl.addClass("manager-plugin-command-toggle");
                        commandButton.extraSettingsEl.toggleClass("is-active", active);
                        commandButton.extraSettingsEl.setAttribute("aria-pressed", `${active}`);
                        commandButton.setTooltip(this.manager.translator.t(active ? "菜单_移出命令面板_标题" : "菜单_加入命令面板_标题"));
                    };
                    syncCommandButton();
                    commandButton.onClick(async () => {
                        if (this.blockForeignScopeAction(this.manager.translator.t("菜单_加入命令面板_标题"))) return;
                        const active = commandIds().includes(plugin.id);
                        const next = active
                            ? commandIds().filter((id) => id !== plugin.id)
                            : [...commandIds(), plugin.id];
                        const previous = commandIds();
                        this.manager.settings.COMMAND_TOGGLE_PLUGINS = next;
                        try {
                            await this.manager.saveSettings();
                            Commands(this.app, this.manager);
                            syncCommandButton();
                            new Notice(this.manager.translator.t(active ? "命令_已移出面板" : "命令_已加入面板", {
                                name: ManagerPlugin.name || plugin.name || plugin.id,
                            }));
                        } catch (error) {
                            this.manager.settings.COMMAND_TOGGLE_PLUGINS = previous;
                            this.manager.devices.report(error);
                        }
                    });
                }

                // [按钮] 清空配置
                const clearConfigButton = this.createConfiguredItemAction(itemEl.controlEl, "clearConfig");
                if (clearConfigButton) {
                    clearConfigButton.setIcon("file-cog");
                    clearConfigButton.setTooltip(this.manager.translator.t("管理器_清空配置_描述"));
                    clearConfigButton.setDisabled(isSelf);
                    clearConfigButton.onClick(async () => {
                        await this.clearPluginConfig(plugin, isSelf);
                    });
                }

                // [按钮] 删除插件
                const deletePluginButton = this.createConfiguredItemAction(itemEl.controlEl, "delete");
                if (deletePluginButton) {
                    deletePluginButton.setIcon("trash");
                    deletePluginButton.setTooltip(this.manager.translator.t("管理器_删除插件_描述"));
                    if (isSelf) deletePluginButton.setDisabled(true);
                    deletePluginButton.onClick(async () => {
                        await this.uninstallPluginWithConfirm(plugin, isSelf);
                    });
                }

                // [按钮] 桌面端次要操作统一收进更多菜单
                if (!Platform.isMobile) this.renderDesktopPluginMore(itemEl.controlEl, plugin, ManagerPlugin, pluginDir, isSelf);

                // [按钮] 切换状态
                const toggleSwitch = new ToggleComponent(itemEl.controlEl);
                const stateToggle = toggleSwitch;
                stateToggle.setTooltip(this.manager.translator.t("管理器_切换状态_描述"));
                stateToggle.setValue(isEnabled);

                // 检查 BPM 忽略标签
                const managerPluginForToggle = ManagerPlugin;
                const isBpmIgnored = managerPluginForToggle.tags?.includes(BPM_IGNORE_TAG);

                if (isSelf) {
                    stateToggle.setValue(true);
                    stateToggle.setDisabled(true);
                    stateToggle.setTooltip(this.manager.translator.t("管理器_自身不可禁用_提示"));
                } else {
                    let isRestoring = false;
                    const syncToggleValue = (value: boolean) => {
                        isRestoring = true;
                        stateToggle.setValue(value);
                        isRestoring = false;
                    };
                    if (isBpmIgnored) stateToggle.setTooltip(this.manager.translator.t("提示_BPM忽略_描述"));
                    stateToggle.onChange(async () => {
                        if (isRestoring) return;
                        const targetEnabled = stateToggle.getValue();
                        if (isBpmIgnored) {
                            new Notice(this.manager.translator.t("提示_BPM忽略_操作拦截"));
                            isRestoring = true;
                            stateToggle.setValue(!targetEnabled);
                            isRestoring = false;
                            return;
                        }
                        const statusFilter = this.getStatusFilterValues();
                        const statusOperator = this.getStatusFilterOperator();
                        const removeByFilter = !this.matchesStatusFilter(ManagerPlugin, plugin, targetEnabled, statusFilter, statusOperator, hiddenPluginIds);
                        const updateCardUI = () => {
                            itemEl.settingEl.toggleClass("is-enabled", targetEnabled);
                            itemEl.settingEl.toggleClass("is-disabled", !targetEnabled);
                            statusChip.setText(targetEnabled ? this.manager.translator.t("管理器_状态_启用中") : this.manager.translator.t("管理器_状态_已禁用"));
                            statusChip.removeClass(targetEnabled ? "is-disabled" : "is-enabled");
                            statusChip.addClass(targetEnabled ? "is-enabled" : "is-disabled");
                            this.manager.pluginIcons.render(cardIcon, plugin.id, targetEnabled);
                            if (this.settings.FADE_OUT_DISABLED_PLUGINS) {
                                itemEl.settingEl.toggleClass("inactive", !targetEnabled);
                            }
                            // 同步“打开设置”按钮（启用后出现，禁用后隐藏）
                            if (openPluginSetting) {
                                openPluginSetting.setDisabled(!targetEnabled);
                                openPluginSettingEl?.classList.toggle("manager-display-none", !targetEnabled);
                            }
                            // 按需从当前视图移除，避免全量重绘
                            if (removeByFilter) {
                                itemEl.settingEl.detach();
                            }
                            // 更新底部统计
                            this.updateStats();
                        };
                        try {
                            await this.manager.overview.setPluginState(plugin.id, { enabled: targetEnabled });
                        } catch (error) {
                            isRestoring = true;
                            stateToggle.setValue(!targetEnabled);
                            isRestoring = false;
                            this.manager.devices.report(error);
                            return;
                        }
                        this.singleStartedPluginIds.delete(plugin.id);
                        Commands(this.app, this.manager);
                        updateCardUI();
                        this.refreshPluginCard(plugin.id);
                    });
                    this.pluginCardControllers.set(plugin.id, {
                        cardEl: itemEl.settingEl,
                        statusChip,
                        cardIcon,
                        toggleSwitch,
                        syncToggleValue,
                        openPluginSetting,
                        openPluginSettingEl,
                        singleStartButton,
                        restartButton,
                        enableIgnoredButton,
                    });
                }
                if (isSelf) {
                    this.pluginCardControllers.set(plugin.id, {
                        cardEl: itemEl.settingEl,
                        statusChip,
                        cardIcon,
                        toggleSwitch,
                        syncToggleValue: (value: boolean) => {
                            toggleSwitch?.setValue(value);
                        },
                        openPluginSetting,
                        openPluginSettingEl,
                        singleStartButton,
                        restartButton,
                        enableIgnoredButton,
                    });
                }
            }
            // 编辑模式下的操作按钮和延迟下拉选单 - 移到 if (!this.editorMode) 块外面
            if (this.editorMode) {
                if (canEditLayout) {
                    const order = itemEl.controlEl.createDiv("manager-plugin-card__layout-order");
                    this.createPluginLayoutOrderButton(order, "arrow-up", this.manager.translator.t("通用_上移_文本"), layoutIndex === 0, async () => this.movePluginLayoutItem(layoutIndex, -1));
                    this.createPluginLayoutOrderButton(order, "arrow-down", this.manager.translator.t("通用_下移_文本"), layoutIndex === layoutItems.length - 1, async () => this.movePluginLayoutItem(layoutIndex, 1));
                }
                const hiddenControl = itemEl.controlEl.createDiv("manager-plugin-card__layout-control");
                hiddenControl.createSpan({ cls: "manager-plugin-card__layout-control-label", text: this.manager.translator.t("管理器_布局_隐藏于管理页") });
                const hiddenToggle = new ToggleComponent(hiddenControl);
                hiddenToggle.setValue(hiddenPluginIds.has(plugin.id));
                hiddenToggle.setDisabled(isSelf);
                hiddenToggle.toggleEl.setAttribute("aria-label", this.manager.translator.t("管理器_布局_隐藏于管理页_标签", { name: ManagerPlugin.name }));
                hiddenToggle.onChange((value) => {
                    this.setPluginHidden(plugin.id, value);
                });
                // [按钮] 还原内容
                const reloadButton = new ExtraButtonComponent(itemEl.controlEl);
                reloadButton.setIcon("refresh-ccw");
                reloadButton.setTooltip(this.manager.translator.t("管理器_还原内容_描述"));
                reloadButton.onClick(async () => {
                    if (!ManagerPlugin) return; // Fix TS2532
                    ManagerPlugin.name = plugin.name;
                    ManagerPlugin.desc = plugin.description;
                    ManagerPlugin.group = "";
                    await this.manager.overview.setPluginState(plugin.id, { delay: '' });
                    ManagerPlugin.tags = [];
                    this.manager.applySpecialPluginTags(ManagerPlugin);
                    await this.manager.savePluginAndExport(plugin.id);
                    this.refreshPluginCard(plugin.id, { allowReload: true });
                });
                // [编辑] 延迟
                if (this.settings.DELAY) {
                    const delays: Array<[string, string]> = [
                        ["", this.manager.translator.t("通用_无延迟_文本")],
                        ...this.settings.DELAYS.map((item): [string, string] => [item.id, item.name]),
                    ];
                    const delaysEl = new DropdownComponent(itemEl.controlEl);
                    this.addOrderedOptions(delaysEl, delays);
                    delaysEl.setValue(ManagerPlugin?.delay || "");

                    const pSettings = this.settings.Plugins.find(p => p.id === plugin.id);
                    const isIgnored = pSettings?.tags?.includes(BPM_IGNORE_TAG);

                    let isRestoring = false;
                    delaysEl.onChange(async (val) => {
                        if (!ManagerPlugin) return; // Fix lint
                        if (isRestoring) return;

                        if (isIgnored) {
                            new Notice(this.manager.translator.t("提示_BPM忽略_操作拦截"));
                            isRestoring = true;
                            delaysEl.setValue(ManagerPlugin.delay || "");
                            isRestoring = false;
                            return;
                        }
                        await this.manager.overview.setPluginState(plugin.id, { delay: val });
                        this.refreshPluginCard(plugin.id, { allowReload: true });
                    });

                }
            }
            // [底部行] 日期与标签在左，操作按钮在右
            if (!this.editorMode) {
                const footerEl = itemEl.settingEl.createDiv("manager-plugin-card__footer");
                const metaEl = footerEl.createDiv("manager-plugin-card__footer-meta");
                if (dateMetaEl) metaEl.appendChild(dateMetaEl);
                if (hasVisibleTags) metaEl.appendChild(tags);
                footerEl.appendChild(itemEl.controlEl);
            }

            if (this.settings.DEBUG) {
                const cards = Array.from(this.pageEl.querySelectorAll(".manager-item"));
                console.log("[BPM] render showData after loop, cards:", cards.length, "ids:", cards.map(el => el.getAttribute("data-plugin-id")).filter(Boolean).join(","));
            }
        }
        if (bulkBarHost) this.renderBulkBar(bulkBarHost);
        if (editBarHost) this.renderEditorBar(editBarHost);
        if (renderedCount === 0) {
            const empty = this.pageEl.createDiv("bpm-empty-state manager-plugin-page__empty");
            empty.setAttribute("role", "status");
            const icon = empty.createDiv("bpm-empty-state__icon");
            setIcon(icon, "search-x");
            empty.createDiv({ cls: "bpm-empty-state__title", text: t("管理器_暂无匹配插件") });
            empty.createDiv({ cls: "bpm-empty-state__text", text: t("管理器_暂无匹配插件_说明") });
        }
        // 计算页尾
        this.updateStats();
    }

    private getCounts() {
        let totalCount = 0;
        let enabledCount = 0;
        let disabledCount = 0;
        if (this.settings.DELAY) {
            const plugins = this.settings.Plugins;
            totalCount = plugins.length;
            plugins.forEach((plugin) => {
                if (plugin.enabled) enabledCount++;
                else disabledCount++;
            });
        } else {
            const plugins = this.getUniquePluginManifests()
                .filter((plugin) => plugin.id !== this.manager.manifest.id);
            totalCount = plugins.length;
            plugins.forEach((plugin) => {
                if (this.isPluginEnabledForDisplay(plugin.id)) enabledCount++;
                else disabledCount++;
            });
        }
        return { totalCount, enabledCount, disabledCount };
    }

    private getHiddenCount(): number {
        const hiddenIds = new Set(this.settings.HIDES || []);
        hiddenIds.delete(this.manager.manifest.id);
        if (hiddenIds.size === 0) return 0;
        return this.getUniquePluginManifests().reduce((count, plugin) => count + (hiddenIds.has(plugin.id) ? 1 : 0), 0);
    }

    private isPluginHidden(pluginId: string): boolean {
        if (pluginId === this.manager.manifest.id) return false;
        return (this.settings.HIDES || []).includes(pluginId);
    }

    private updateStats() {
        if (!this.footEl) return;
        this.overviewStatsSelect?.close();
        this.overviewStatsSelect = undefined;
        const { totalCount, enabledCount, disabledCount } = this.getCounts();
        const totalLabel = this.manager.translator.t("通用_总计_文本");
        const enabledLabel = this.manager.translator.t("通用_启用_文本");
        const disabledLabel = this.manager.translator.t("通用_禁用_文本");
        const hiddenLabel = this.manager.translator.t("管理器_状态_已隐藏");
        const hiddenCount = this.getHiddenCount();
        const updateStatuses = this.manager.updateStatus || {};
        const checkedCount = Object.keys(updateStatuses).length;
        const updateCount = this.getPluginUpdateCount(updateStatuses);
        const activeStatusFilters = this.getStatusFilterValues();

        this.footEl.empty();
        const statItems: Array<{ cls: string; icon: string; label: string; value: number; filter: StatusFilterValue }> = [
            { cls: "bpm-stat-chip--total", icon: "layout-grid", label: totalLabel, value: totalCount, filter: "all" },
            { cls: "bpm-stat-chip--enabled", icon: "circle-check", label: enabledLabel, value: enabledCount, filter: "enabled" },
            { cls: "bpm-stat-chip--disabled", icon: "circle-minus", label: disabledLabel, value: disabledCount, filter: "disabled" },
            { cls: "bpm-stat-chip--hidden", icon: "eye-off", label: hiddenLabel, value: hiddenCount, filter: "hidden" },
        ];
        if (checkedCount > 0) {
            statItems.push({
                cls: "bpm-stat-chip--updates",
                icon: updateCount > 0 ? "download" : "check-check",
                label: this.manager.translator.t("通用_可更新_文本"),
                value: updateCount,
                filter: "has-update",
            });
        }
        if (this.activePage === 'plugins') {
            const selected = this.getStatusFilterOperator() === 'contains' && activeStatusFilters.length <= 1
                ? activeStatusFilters[0] ?? 'all' : '';
            this.overviewStatsSelect = ScopeSelect.compact(this.footEl, this.manager.translator.t('通用_状态_文本'), selected,
                statItems.map(item => ({ value: item.filter, label: `${item.label} ${item.value}`, icon: item.icon })), value => {
                    const item = statItems.find(item => item.filter === value);
                    if (item) this.setStatusFilterFromStats(item.filter);
                }, 'list-filter');
            this.overviewStatsSelect.field.addClass('manager-overview-stats-menu');
        }
        statItems.forEach((item) => {
            const chip = this.footEl.createSpan({ cls: `bpm-stat-chip ${item.cls}` });
            chip.addClass("bpm-stat-chip--interactive");
            const isActive = (item.filter === "all" ? activeStatusFilters.length === 0 : activeStatusFilters.includes(item.filter)) && this.getStatusFilterOperator() === "contains";
            chip.toggleClass("is-active", isActive);
            chip.setAttribute("role", "button");
            chip.setAttribute("tabindex", "0");
            chip.setAttribute("aria-label", `${item.label} ${item.value}`);
            chip.setAttribute("aria-pressed", `${isActive}`);
            const icon = chip.createSpan({ cls: "bpm-stat-chip__icon" });
            setIcon(icon, item.icon);
            chip.createSpan({ cls: "bpm-stat-chip__label", text: item.label });
            chip.createSpan({ cls: "bpm-stat-chip__value", text: `${item.value}` });
            const activate = () => this.setStatusFilterFromStats(item.filter);
            chip.addEventListener("click", activate);
            chip.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                activate();
            });
        });
    }

    private syncHeaderIdentity(): void {
        const header = this.modalChromeEl?.querySelector('.manager-header__identity');
        if (!header) return;
        const page = this.activePage === 'sources' ? 'install' : this.activePage;
        const current = this.getPageNavigationItems().find(item => item.page === page);
        const mark = header.querySelector<HTMLElement>('.manager-header__mark');
        const title = header.querySelector<HTMLElement>('.manager-header__title');
        const icon = current?.icon ?? 'blocks';
        if (mark && mark.dataset.icon !== icon) {
            mark.empty();
            setIcon(mark, icon);
            mark.dataset.icon = icon;
        }
        const label = current?.label ?? this.manager.translator.t('通用_管理器_文本');
        if (title && title.textContent !== label) title.setText(label);
    }

    /** Rebuild mobile chrome only when its page changes, preserving active inputs on ordinary refreshes. */
    private syncMobilePageChrome(): void {
        if (!Platform.isMobile) return;
        const header = this.modalChromeEl?.querySelector<HTMLElement>('.bpm-mobile-header');
        const page = this.activePage === 'sources' ? 'install' : this.activePage;
        if (header && header.dataset.page !== page) this.showHeadMobile();
    }

    private syncPageChrome() {
        this.ensureAllowedActivePage();
        this.syncHeaderIdentity();
        this.syncToolVisibility();
        const isPlugins = this.activePage === "plugins";
        const isThemes = this.activePage === "themes";
        const isInstall = this.activePage === "install";
        const isSources = this.activePage === "sources";
        const isInstallWorkspace = isInstall || isSources;
        const isTransfer = this.activePage === "transfer";
        const isVaults = this.activePage === "vaults";
        const isRibbon = this.activePage === "ribbon";
        const isTroubleshoot = this.activePage === "troubleshoot";
        if (!isPlugins && (this.bulkEditMode || this.editorMode)) {
            this.bulkEditMode = false;
            this.editorMode = false;
            this.bulkSelectedPluginIds.clear();
            this.modalContainer?.removeClass("manager-container--editing");
            this.modalContainer?.removeClass("manager-container--bulk-editing");
        }
        const syncTabState = (tabEl: HTMLButtonElement | undefined, active: boolean) => {
            tabEl?.classList.toggle("is-active", active);
            tabEl?.setAttribute("aria-selected", `${active}`);
            tabEl?.setAttribute("data-state", active ? "active" : "inactive");
        };
        this.installMode = isInstallWorkspace;
        syncTabState(this.pluginTabEl, isPlugins);
        syncTabState(this.deviceTabEl, this.activePage === "devices");
        syncTabState(this.themeTabEl, isThemes);
        syncTabState(this.installTabEl, isInstallWorkspace);
        syncTabState(this.sourcesTabEl, isSources);
        syncTabState(this.transferTabEl, isTransfer);
        syncTabState(this.vaultsTabEl, isVaults);
        syncTabState(this.ribbonTabEl, isRibbon);
        syncTabState(this.troubleshootTabEl, isTroubleshoot);
        this.desktopActionWrapper?.classList.toggle('has-page-tools', isPlugins || isThemes || isRibbon);
        this.desktopActionWrapper?.classList.toggle("is-plugin-page", isPlugins);
        this.desktopActionWrapper?.classList.toggle("is-theme-page", isThemes);
        this.desktopActionWrapper?.classList.toggle("is-appearance-profiles-page", isThemes && this.appearanceView === "profiles");
        this.pageToolsEl?.querySelector(".manager-tool--appearance-profile")?.classList.toggle("manager-display-none", this.appearanceView !== "profiles");
        this.desktopActionWrapper?.classList.toggle("is-install-page", isInstall);
        this.desktopActionWrapper?.classList.toggle("is-sources-page", isSources);
        this.desktopActionWrapper?.classList.toggle("is-transfer-page", isTransfer);
        this.desktopActionWrapper?.classList.toggle("is-vaults-page", isVaults);
        this.desktopActionWrapper?.classList.toggle("is-ribbon-page", isRibbon);
        this.desktopActionWrapper?.classList.toggle("is-troubleshoot-page", isTroubleshoot);
        this.desktopActionWrapper?.classList.remove("is-layout-editing");
        this.desktopActionWrapper?.classList.toggle("is-bulk-editing", isPlugins && this.bulkEditMode);
        this.bulkEditButtonEl?.classList.toggle("is-active", this.bulkEditMode);
        this.editorButtonEl?.classList.toggle("is-active", isPlugins && this.editorMode);
        if (this.desktopFilterWrapper) {
            this.desktopFilterWrapper.classList.toggle("manager-display-none", !isPlugins);
        }
        if (this.searchBarEl) {
            if (isPlugins || isThemes) {
                this.searchBarEl.removeClass("manager-display-none");
            } else {
                this.searchBarEl.addClass("manager-display-none");
            }
        }
        this.syncMobilePageChrome();
    }

    private setDesktopPage(page: ManagerPage) {
        page = this.normalizeManagerPage(page);
        if (this.activePage === page) {
            this.syncPageChrome();
            return;
        }
        this.activePage = page;
        if (page !== "plugins" && (this.bulkEditMode || this.editorMode)) {
            if (this.bulkEditMode) {
                this.bulkEditMode = false;
                this.bulkSelectedPluginIds.clear();
            }
            this.editorMode = false;
            this.applyEditingStyle();
        }
        this.syncPageChrome();
        this.renderContent();
    }

    public count(): string {
        const { totalCount, enabledCount, disabledCount } = this.getCounts();
        const totalLabel = this.manager.translator.t("通用_总计_文本");
        const enabledLabel = this.manager.translator.t("通用_启用_文本");
        const disabledLabel = this.manager.translator.t("通用_禁用_文本");
        const hiddenLabel = this.manager.translator.t("管理器_状态_已隐藏");
        const hiddenCount = this.getHiddenCount();

        return `${totalLabel}: ${totalCount} · ${enabledLabel}: ${enabledCount} · ${disabledLabel}: ${disabledCount} · ${hiddenLabel}: ${hiddenCount}`;
    }

    private getUniquePluginManifests(): PluginManifest[] {
        const manifestMap = this.appPlugins.manifests;
        if (this.pluginManifestCache?.source === manifestMap) return this.pluginManifestCache.plugins;
        const uniqMap = new Map<string, PluginManifest>();
        Object.values(manifestMap).forEach((mf: PluginManifest) => {
            uniqMap.set(mf.id, mf);
        });
        const plugins = Array.from(uniqMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        this.pluginManifestCache = { source: manifestMap, plugins };
        return plugins;
    }

    private invalidatePluginCaches() {
        this.pluginManifestCache = undefined;
        this.searchIndex.clear();
    }

    private getPluginSearchText(plugin: ManagerPlugin, manifest: PluginManifest): string {
        const key = `${plugin.name}\n${plugin.desc}\n${manifest.author || ""}`;
        const cached = this.searchIndex.get(plugin.id);
        if (cached?.key === key) return cached.text;
        const text = key.toLowerCase();
        this.searchIndex.set(plugin.id, { key, text });
        return text;
    }

    private toTimestamp(value?: number | string | null): number | undefined {
        if (!value) return undefined;
        const time = typeof value === "number" ? value : new Date(value).getTime();
        return Number.isFinite(time) && time > 0 ? time : undefined;
    }

    private pickFirstTimestamp(values: Array<number | string | undefined | null>): number | undefined {
        for (const value of values) {
            const time = this.toTimestamp(value);
            if (time) return time;
        }
        return undefined;
    }

    private pickLatestTimestamp(values: Array<number | string | undefined | null>): number | undefined {
        const times = values
            .map((value) => this.toTimestamp(value))
            .filter((value): value is number => Boolean(value));
        return times.length > 0 ? Math.max(...times) : undefined;
    }

    private getPluginSourceById(): Map<string, BetaSource> {
        const sources = new Map<string, BetaSource>();
        for (const source of this.getBetaSources()) {
            if (source.type !== "plugin") continue;
            const pluginId = this.getPluginIdByRepo(source.repo) || source.id;
            if (pluginId && !sources.has(pluginId)) sources.set(pluginId, source);
        }
        return sources;
    }

    private async statPath(path: string): Promise<{ ctime?: number; mtime?: number } | null> {
        try {
            return await this.app.vault.adapter.stat(path);
        } catch {
            return null;
        }
    }

    private async readPluginDateMeta(plugin: PluginManifest, sourceById: Map<string, BetaSource>): Promise<PluginDateMeta> {
        const folder = normalizePath(`${this.app.vault.configDir}/plugins/${plugin.id}`);
        const [folderStat, manifestStat, mainStat, stylesStat] = await Promise.all([
            this.statPath(folder),
            this.statPath(normalizePath(`${folder}/manifest.json`)),
            this.statPath(normalizePath(`${folder}/main.js`)),
            this.statPath(normalizePath(`${folder}/styles.css`)),
        ]);
        const source = sourceById.get(plugin.id);
        return {
            installedAt: this.pickFirstTimestamp([folderStat?.ctime, source?.installedAt, manifestStat?.ctime, folderStat?.mtime]),
            updatedAt: this.pickLatestTimestamp([
                manifestStat?.mtime,
                mainStat?.mtime,
                stylesStat?.mtime,
                source?.installedReleasePublishedAt,
                folderStat?.mtime,
            ]),
        };
    }

    private async getPluginDateMetaMap(plugins: PluginManifest[]): Promise<Map<string, PluginDateMeta>> {
        const sourceById = this.getPluginSourceById();
        const entries = await Promise.all(plugins.map(async (plugin): Promise<[string, PluginDateMeta]> => [
            plugin.id,
            await this.readPluginDateMeta(plugin, sourceById),
        ]));
        return new Map(entries);
    }

    private comparePluginsByName(a: PluginManifest, b: PluginManifest, pluginSettingsById: Map<string, ManagerPlugin>, direction: "asc" | "desc" = "asc"): number {
        const nameA = pluginSettingsById.get(a.id)?.name || a.name || a.id;
        const nameB = pluginSettingsById.get(b.id)?.name || b.name || b.id;
        const result = nameA.localeCompare(nameB, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
        return direction === "asc" ? result : -result;
    }

    private comparePluginsByDate(
        a: PluginManifest,
        b: PluginManifest,
        pluginSettingsById: Map<string, ManagerPlugin>,
        dateMetaById: Map<string, PluginDateMeta>,
        field: keyof PluginDateMeta,
        direction: "asc" | "desc"
    ): number {
        const valueA = dateMetaById.get(a.id)?.[field] || 0;
        const valueB = dateMetaById.get(b.id)?.[field] || 0;
        if (valueA && !valueB) return -1;
        if (!valueA && valueB) return 1;
        if (valueA !== valueB) return direction === "asc" ? valueA - valueB : valueB - valueA;
        return this.comparePluginsByName(a, b, pluginSettingsById);
    }

    private getSortedPluginLayoutItems(
        layoutItems: PluginLayoutItem[],
        manifestById: Map<string, PluginManifest>,
        pluginSettingsById: Map<string, ManagerPlugin>,
        dateMetaById: Map<string, PluginDateMeta>
    ): PluginLayoutItem[] {
        const sort = this.getPluginOverviewSort();
        if (sort === "layout") return layoutItems;

        const plugins = layoutItems
            .filter((item) => item.type === "plugin")
            .map((item) => manifestById.get(item.id))
            .filter((plugin): plugin is PluginManifest => Boolean(plugin));

        plugins.sort((a, b) => {
            switch (sort) {
                case "name-desc":
                    return this.comparePluginsByName(a, b, pluginSettingsById, "desc");
                case "installed-desc":
                    return this.comparePluginsByDate(a, b, pluginSettingsById, dateMetaById, "installedAt", "desc");
                case "installed-asc":
                    return this.comparePluginsByDate(a, b, pluginSettingsById, dateMetaById, "installedAt", "asc");
                case "updated-desc":
                    return this.comparePluginsByDate(a, b, pluginSettingsById, dateMetaById, "updatedAt", "desc");
                case "updated-asc":
                    return this.comparePluginsByDate(a, b, pluginSettingsById, dateMetaById, "updatedAt", "asc");
                default:
                    return this.comparePluginsByName(a, b, pluginSettingsById, "asc");
            }
        });

        return plugins.map((plugin) => ({ id: plugin.id, type: "plugin" }));
    }

    private getPluginLayout(manifests: PluginManifest[] = this.getUniquePluginManifests()): PluginLayoutItem[] {
        if (!Array.isArray(this.manager.settings.PLUGIN_LAYOUT)) this.manager.settings.PLUGIN_LAYOUT = [];

        const manifestIds = new Set(manifests.map((plugin) => plugin.id));
        const seenPluginIds = new Set<string>();
        const normalized: PluginLayoutItem[] = [];

        for (const item of this.manager.settings.PLUGIN_LAYOUT) {
            if (!item || !item.id) continue;
            if (item.type === "separator") {
                normalized.push({
                    id: item.id,
                    type: "separator",
                    title: item.title || this.manager.translator.t("管理器_布局_分割线"),
                });
                continue;
            }
            if (item.type === "plugin" && manifestIds.has(item.id) && !seenPluginIds.has(item.id)) {
                normalized.push({ id: item.id, type: "plugin" });
                seenPluginIds.add(item.id);
            }
        }

        for (const plugin of manifests) {
            if (seenPluginIds.has(plugin.id)) continue;
            normalized.push({ id: plugin.id, type: "plugin" });
            seenPluginIds.add(plugin.id);
        }

        const changed = JSON.stringify(this.manager.settings.PLUGIN_LAYOUT) !== JSON.stringify(normalized);
        this.manager.settings.PLUGIN_LAYOUT = normalized;
        if (changed) void this.manager.saveSettings();
        return this.manager.settings.PLUGIN_LAYOUT;
    }

    private getOrderedPluginManifests(manifests: PluginManifest[] = this.getUniquePluginManifests()): PluginManifest[] {
        const manifestById = new Map(manifests.map((plugin) => [plugin.id, plugin]));
        return this.getPluginLayout(manifests)
            .filter((item) => item.type === "plugin")
            .map((item) => manifestById.get(item.id))
            .filter((plugin): plugin is PluginManifest => Boolean(plugin));
    }

    private shouldRenderPluginLayoutSeparators(): boolean {
        return this.getPluginOverviewSort() === "layout"
            && !this.hasActiveStatusFilter()
            && this.getGroupFilterValues().length === 0
            && this.getTagFilterValues().length === 0
            && this.getDelayFilterValues().length === 0
            && !this.searchText;
    }

    private renderPluginLayoutSeparator(title: string) {
        const separator = this.pageEl.createDiv("manager-plugin-separator");
        const lineStart = separator.createSpan({ cls: "manager-plugin-separator__line" });
        lineStart.setAttribute("aria-hidden", "true");
        const label = separator.createSpan({ cls: "manager-plugin-separator__label", text: title || this.manager.translator.t("管理器_布局_分割线") });
        label.setAttribute("role", "separator");
        const lineEnd = separator.createSpan({ cls: "manager-plugin-separator__line" });
        lineEnd.setAttribute("aria-hidden", "true");
    }

    private createPluginLayoutOrderButton(
        container: HTMLElement,
        icon: string,
        label: string,
        disabled: boolean,
        onClick: () => Promise<void>
    ) {
        const btn = new ButtonComponent(container);
        btn.setIcon(icon);
        btn.setTooltip(label);
        btn.setDisabled(disabled);
        btn.onClick(async () => {
            await onClick();
        });
        return btn;
    }

    private bindPluginLayoutDragHandle(card: HTMLElement, index: number, label: string) {
        card.setAttr("data-layout-index", `${index}`);
        const handle = card.createDiv("manager-hidden-card__drag manager-plugin-card__layout-drag");
        handle.setAttr("role", "button");
        handle.setAttr("aria-label", this.manager.translator.t("管理器_布局_拖动排序_标签", { label }));
        handle.setAttr("tabindex", "0");
        setIcon(handle, "grip-vertical");
        card.prepend(handle);
        handle.addEventListener("pointerdown", (event) => this.startHiddenLayoutDrag(card, index, event));
        handle.addEventListener("dragstart", (event) => event.preventDefault());
        return handle;
    }

    private renderPluginLayoutSeparatorEditor(layoutItem: PluginLayoutItem, index: number, layoutLength: number) {
        const t = (k: string) => this.manager.translator.t(k);
        const card = this.pageEl.createDiv("manager-hidden-card manager-hidden-separator-card manager-layout-editable-card manager-plugin-separator-editor");
        card.setAttr("data-layout-id", layoutItem.id);
        this.bindPluginLayoutDragHandle(card, index, layoutItem.title || t("管理器_布局_分割线"));

        const main = card.createDiv("manager-hidden-card__main");
        const iconWrap = main.createDiv("manager-hidden-card__icon");
        setIcon(iconWrap, "separator-horizontal");

        const textWrap = main.createDiv("manager-hidden-card__text");
        const titleRow = textWrap.createDiv("manager-hidden-card__title-row");
        titleRow.createSpan({ cls: "manager-hidden-card__name", text: t("管理器_布局_分割线") });
        titleRow.createSpan({ text: t("管理器_布局_布局标记"), cls: "manager-hidden-item__state is-separator" });
        const titleInputWrap = textWrap.createDiv("manager-hidden-separator-card__input");
        const titleInput = new TextComponent(titleInputWrap);
        titleInput.setValue(layoutItem.title || t("管理器_布局_分割线"));
        titleInput.setPlaceholder(t("管理器_布局_分割线标题"));
        titleInput.inputEl.setAttribute("aria-label", t("管理器_布局_分割线标题"));
        titleInput.onChange(async (value) => {
            await this.updatePluginLayoutSeparator(layoutItem.id, value);
        });

        const actions = card.createDiv("manager-hidden-card__actions");
        const order = actions.createDiv("manager-hidden-card__order");
        this.createPluginLayoutOrderButton(order, "arrow-up", t("通用_上移_文本"), index === 0, async () => this.movePluginLayoutItem(index, -1));
        this.createPluginLayoutOrderButton(order, "arrow-down", t("通用_下移_文本"), index === layoutLength - 1, async () => this.movePluginLayoutItem(index, 1));
        this.createPluginLayoutOrderButton(order, "trash-2", t("管理器_布局_删除分割线"), false, async () => this.removePluginLayoutSeparator(layoutItem.id));
    }

    private async movePluginLayoutItem(index: number, delta: number) {
        const layout = this.getPluginLayout();
        const target = index + delta;
        if (target < 0 || target >= layout.length) return;
        const [item] = layout.splice(index, 1);
        layout.splice(target, 0, item);
        this.manager.settings.PLUGIN_LAYOUT = layout;
        await this.manager.saveSettings();
        await this.reloadShowData();
    }

    private async movePluginLayoutItemTo(oldIndex: number, newIndex: number) {
        const layout = this.getPluginLayout();
        if (oldIndex < 0 || oldIndex >= layout.length) return;
        const target = Math.max(0, Math.min(newIndex, layout.length - 1));
        if (target === oldIndex) return;
        const [item] = layout.splice(oldIndex, 1);
        layout.splice(target, 0, item);
        this.manager.settings.PLUGIN_LAYOUT = layout;
        await this.manager.saveSettings();
        await this.reloadShowData();
    }

    private startHiddenLayoutDrag(itemEl: HTMLElement, index: number, event: PointerEvent) {
        if (event.button !== 0 && event.pointerType === "mouse") return;
        const target = event.currentTarget as HTMLElement;
        target.setPointerCapture?.(event.pointerId);

        const rect = itemEl.getBoundingClientRect();
        this.hiddenDraggedItemEl = itemEl;
        this.hiddenDragStartIndex = index;
        this.hiddenDragOffsetX = event.clientX - rect.left;
        this.hiddenDragOffsetY = event.clientY - rect.top;
        this.hiddenActivePointerId = event.pointerId;

        this.hiddenGhostEl = itemEl.cloneNode(true) as HTMLElement;
        this.hiddenGhostEl.addClass("drag-ghost");
        this.hiddenGhostEl.addClass("manager-hidden-drag-ghost");
        activeDocument.body.appendChild(this.hiddenGhostEl);
        this.hiddenGhostEl.setCssStyles({
            width: `${rect.width}px`,
            height: `${rect.height}px`,
        });
        this.updateHiddenLayoutGhost(event);

        this.hiddenPlaceholderEl = activeDocument.createElement("div");
        this.hiddenPlaceholderEl.className = "drag-gap-placeholder manager-hidden-drag-placeholder";
        this.hiddenPlaceholderEl.setCssStyles({ height: `${rect.height}px` });
        itemEl.parentNode?.insertBefore(this.hiddenPlaceholderEl, itemEl);
        itemEl.addClass("dragging");

        activeDocument.addEventListener("pointermove", this.handleHiddenLayoutDragMove, { passive: false });
        activeDocument.addEventListener("pointerup", this.handleHiddenLayoutDragEndEvent);
        activeDocument.addEventListener("pointercancel", this.handleHiddenLayoutDragEndEvent);
    }

    private handleHiddenLayoutDragMove = (event: PointerEvent) => {
        if (!this.hiddenGhostEl || !this.hiddenPlaceholderEl || !this.hiddenDraggedItemEl) return;
        if (event.pointerId !== this.hiddenActivePointerId) return;
        event.preventDefault();
        this.updateHiddenLayoutGhost(event);

        const listContainer = this.hiddenPlaceholderEl.parentElement;
        if (!listContainer) return;
        const items = Array.from(listContainer.querySelectorAll<HTMLElement>(".manager-layout-editable-card[data-layout-index], .manager-hidden-card[data-layout-index]"))
            .filter((item) => item !== this.hiddenDraggedItemEl && !item.classList.contains("dragging"));

        let dropTarget: HTMLElement | null = null;
        for (const item of items) {
            const rect = item.getBoundingClientRect();
            if (event.clientY < rect.top + rect.height / 2) {
                dropTarget = item;
                break;
            }
        }

        if (dropTarget) {
            listContainer.insertBefore(this.hiddenPlaceholderEl, dropTarget);
        } else {
            listContainer.appendChild(this.hiddenPlaceholderEl);
        }
    };

    private updateHiddenLayoutGhost(event: PointerEvent) {
        if (!this.hiddenGhostEl) return;
        this.hiddenGhostEl.setCssStyles({
            left: `${event.clientX - this.hiddenDragOffsetX}px`,
            top: `${event.clientY - this.hiddenDragOffsetY}px`,
        });
    }

    private handleHiddenLayoutDragEnd = async (event: PointerEvent) => {
        if (event.pointerId !== this.hiddenActivePointerId) return;
        if (!this.hiddenDraggedItemEl || !this.hiddenPlaceholderEl) return;

        const listContainer = this.hiddenPlaceholderEl.parentElement;
        let newIndex = 0;
        if (listContainer) {
            for (const child of Array.from(listContainer.children)) {
                if (child === this.hiddenPlaceholderEl) break;
                if (child.matches(".manager-layout-editable-card[data-layout-index]:not(.dragging), .manager-hidden-card[data-layout-index]:not(.dragging)")) newIndex++;
            }
        }

        this.hiddenPlaceholderEl.remove();
        this.hiddenPlaceholderEl = null;
        this.hiddenGhostEl?.remove();
        this.hiddenGhostEl = null;
        this.hiddenDraggedItemEl.removeClass("dragging");

        const oldIndex = this.hiddenDragStartIndex;
        this.hiddenDraggedItemEl = null;
        this.hiddenDragStartIndex = -1;
        this.hiddenActivePointerId = null;
        activeDocument.removeEventListener("pointermove", this.handleHiddenLayoutDragMove);
        activeDocument.removeEventListener("pointerup", this.handleHiddenLayoutDragEndEvent);
        activeDocument.removeEventListener("pointercancel", this.handleHiddenLayoutDragEndEvent);

        await this.movePluginLayoutItemTo(oldIndex, newIndex);
    };

    private async addPluginLayoutSeparator() {
        const layout = this.getPluginLayout();
        layout.push({
            id: `separator-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: "separator",
            title: this.manager.translator.t("管理器_布局_分割线"),
        });
        this.manager.settings.PLUGIN_LAYOUT = layout;
        await this.manager.saveSettings();
        await this.reloadShowData();
    }

    private async resetPluginLayout() {
        this.manager.settings.PLUGIN_LAYOUT = this.getUniquePluginManifests().map((plugin) => ({
            id: plugin.id,
            type: "plugin",
        }));
        await this.manager.saveSettings();
        await this.reloadShowData();
    }

    private async updatePluginLayoutSeparator(itemId: string, title: string) {
        const item = this.getPluginLayout().find((layoutItem) => layoutItem.id === itemId && layoutItem.type === "separator");
        if (!item) return;
        item.title = title.trim() || this.manager.translator.t("管理器_布局_分割线");
        await this.manager.saveSettings();
    }

    private async removePluginLayoutSeparator(itemId: string) {
        this.manager.settings.PLUGIN_LAYOUT = this.getPluginLayout().filter((item) => item.id !== itemId);
        await this.manager.saveSettings();
        await this.reloadShowData();
    }

    private getBetaSources(): BetaSource[] {
        if (!Array.isArray(this.manager.settings.BETA_SOURCES)) this.manager.settings.BETA_SOURCES = [];
        return this.manager.settings.BETA_SOURCES;
    }

    private getSourceConfigKey(source: BetaSource): string {
        return `${source.type}:${sanitizeRepo(source.repo || source.id).toLowerCase()}`;
    }

    private getPluginIdByRepo(repo: string): string | null {
        const normalized = sanitizeRepo(repo);
        const entry = Object.entries(this.manager.settings.REPO_MAP || {})
            .find(([, value]) => sanitizeRepo(value) === normalized);
        return entry?.[0] ?? null;
    }

    private getSourcePackageFolder(source: BetaSource): string {
        if (source.type === "plugin") {
            const pluginId = this.getPluginIdByRepo(source.repo) || source.id;
            return pluginId ? normalizePath(`${this.app.vault.configDir}/plugins/${pluginId}`) : "";
        }
        return normalizePath(`${this.app.vault.configDir}/themes/${source.id}`);
    }

    private async readSourcePackageCreatedAt(source: BetaSource): Promise<number | undefined> {
        const folder = this.getSourcePackageFolder(source);
        if (!folder) return undefined;
        try {
            const stat = await this.app.vault.adapter.stat(folder);
            if (!stat) return undefined;
            return stat.ctime || stat.mtime || undefined;
        } catch {
            return undefined;
        }
    }

    private async refreshSourcePackageCreatedAt(source: BetaSource): Promise<void> {
        const installedAt = await this.readSourcePackageCreatedAt(source);
        source.installedAt = installedAt;
    }

    private async refreshSourcesPackageCreatedAt(sources = this.getBetaSources()): Promise<boolean> {
        let changed = false;
        await Promise.all(sources.map(async (source) => {
            const installedAt = await this.readSourcePackageCreatedAt(source);
            if (source.installedAt !== installedAt) {
                source.installedAt = installedAt;
                changed = true;
            }
        }));
        return changed;
    }

    private formatSourceDate(value?: number | string): string {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return date.toLocaleDateString();
    }

    private formatVersionWithDate(version: string, date?: number | string): string {
        const dateText = this.formatSourceDate(date);
        return dateText ? `${version} · ${dateText}` : version;
    }

    private normalizeSourceUpdateDelayDays(value: unknown): number | undefined {
        const days = Math.floor(Number(value));
        return Number.isFinite(days) && days > 0 ? days : undefined;
    }

    private getSourceLocalVersion(source: BetaSource): string {
        if (source.type === "plugin") {
            const pluginId = this.getPluginIdByRepo(source.repo) || source.id;
            return (this.appPlugins.manifests[pluginId] as PluginManifest | undefined)?.version || source.localVersion || "";
        }
        return source.localVersion || "";
    }

    private sourceHasUpdate(source: BetaSource): boolean {
        source.localVersion = this.getSourceLocalVersion(source) || source.localVersion || "";
        return sourceHasConfiguredUpdate(source);
    }

    private getSourceStats(sources = this.getBetaSources()) {
        return {
            total: sources.length,
            plugins: sources.filter((source) => source.type === "plugin").length,
            themes: sources.filter((source) => source.type === "theme").length,
            auto: sources.filter((source) => source.autoUpdate).length,
            updates: sources.filter((source) => this.sourceHasUpdate(source)).length,
        };
    }

    private getInstallHistory(): InstallHistoryItem[] {
        if (!Array.isArray(this.manager.settings.INSTALL_HISTORY)) this.manager.settings.INSTALL_HISTORY = [];
        return this.manager.settings.INSTALL_HISTORY;
    }

    private getInstallHistoryOptions(limit = 24): InstallHistoryItem[] {
        const options: InstallHistoryItem[] = [];
        const seen = new Set<string>();
        const add = (item: InstallHistoryItem) => {
            const repo = sanitizeRepo(item.repo || "");
            if (!repo || !this.isValidInstallRepo(repo)) return;
            const type = item.type === "theme" ? "theme" : "plugin";
            const key = `${type}:${repo.toLowerCase()}`;
            if (seen.has(key)) return;
            seen.add(key);
            options.push({
                ...item,
                repo,
                type,
                version: item.version?.trim() || undefined,
            });
        };

        [...this.getInstallHistory()]
            .sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0))
            .forEach(add);

        [...this.getBetaSources()]
            .sort((a, b) => (b.lastChecked || 0) - (a.lastChecked || 0))
            .forEach((source) => add({
                repo: source.repo,
                type: source.type,
                version: source.mode === "frozen" ? source.frozenVersion : undefined,
                trackSource: true,
                usedAt: source.lastChecked,
            }));

        return options.slice(0, limit);
    }

    private rememberInstallHistory(repo: string, type: "plugin" | "theme", version?: string, trackSource?: boolean) {
        const normalizedRepo = sanitizeRepo(repo);
        if (!this.isValidInstallRepo(normalizedRepo)) return;
        const next: InstallHistoryItem = {
            repo: normalizedRepo,
            type,
            version: version?.trim() || undefined,
            trackSource,
            usedAt: Date.now(),
        };
        this.manager.settings.INSTALL_HISTORY = [
            next,
            ...this.getInstallHistory().filter((item) =>
                !(sanitizeRepo(item.repo || "").toLowerCase() === normalizedRepo.toLowerCase() && item.type === type)
            ),
        ].slice(0, 12);
    }

    private upsertBetaSource(source: BetaSource) {
        const sources = this.getBetaSources();
        const repo = sanitizeRepo(source.repo);
        const existing = sources.find((item) => item.type === source.type && sanitizeRepo(item.repo) === repo);
        const next: BetaSource = {
            ...existing,
            ...source,
            repo,
            enabled: source.enabled ?? true,
            autoUpdate: source.autoUpdate ?? false,
            mode: source.mode || "latest",
            updateCheckMode: source.updateCheckMode || "release",
            compatibilityMode: source.compatibilityMode || "compatible",
            updateDelayDays: this.normalizeSourceUpdateDelayDays(source.updateDelayDays),
        };
        if (existing) {
            Object.assign(existing, next);
        } else {
            sources.push(next);
        }
    }

    private async checkBetaSource(source: BetaSource): Promise<BetaSource> {
        try {
            const versions = await fetchReleaseVersions(this.manager, source.repo, { includeManifest: source.type === "plugin" });
            const localVersion = this.getSourceLocalVersion(source);
            const releaseCheck = syncSourceReleaseCheck(source, versions, localVersion);
            await this.refreshSourcePackageCreatedAt(source);
            source.lastChecked = Date.now();
            source.error = "";
            if (source.mode === "frozen" && !source.frozenVersion) source.frozenVersion = releaseCheck.target?.tag;
        } catch (error) {
            source.error = (error as Error)?.message || String(error);
            source.lastChecked = Date.now();
        }
        await this.manager.saveSettings();
        return source;
    }

    private async updateBetaSource(source: BetaSource, reinstall = false): Promise<boolean> {
        await this.checkBetaSource(source);
        const targetVersion = source.mode === "frozen"
            ? source.frozenVersion || source.latestReleaseTag || source.latestVersion || ""
            : source.latestReleaseTag || source.latestVersion || "";
        const targetPublishedAt = source.latestReleasePublishedAt || source.latestPublishedAt;
        if (!targetVersion && !reinstall) {
            new Notice(this.manager.translator.t("来源_未获取可安装版本_提示"));
            return false;
        }
        if (!reinstall && this.getSourceLocalVersion(source) && !this.sourceHasUpdate(source)) return false;
        const ok = source.type === "plugin"
            ? await installPluginFromGithub(this.manager, source.repo, targetVersion, true)
            : await installThemeFromGithub(this.manager, source.repo, targetVersion);
        if (!ok) return false;

        if (source.type === "plugin") {
            const pluginId = this.getPluginIdByRepo(source.repo) || source.id;
            if (pluginId) source.id = pluginId;
            const localVersion = pluginId
                ? ((this.appPlugins.manifests[pluginId] as PluginManifest | undefined)?.version || targetVersion)
                : targetVersion;
            markSourceInstalledRelease(source, targetVersion, targetPublishedAt, localVersion);
        } else {
            markSourceInstalledRelease(source, targetVersion, targetPublishedAt, targetVersion);
        }
        await this.refreshSourcePackageCreatedAt(source);
        source.error = "";
        await this.manager.saveSettings();
        return true;
    }

    private getCustomCss(): CustomCssLike | undefined {
        return (this.app as unknown as { customCss?: CustomCssLike }).customCss;
    }

    private getActiveThemeName(): string {
        const customCss = this.getCustomCss();
        return customCss?.theme || customCss?.getTheme?.() || "";
    }

    private setActiveThemeName(themeName: string) {
        this.getCustomCss()?.setTheme?.(themeName);
    }

    /** 外观页当前是否在编辑其他设备的作用域。 */
    private isForeignThemes(): boolean {
        return Boolean(this.manager.devices?.isProjectingForeign('themes'));
    }
    private getScopedThemeName(): string {
        if (this.isForeignThemes()) return this.manager.devices.scopeAppearance('themes').theme;
        return this.getActiveThemeName();
    }
    private async getScopedEnabledSnippetIds(): Promise<Set<string>> {
        if (!this.isForeignThemes()) return this.getEnabledSnippetIds();
        const appearance = this.manager.devices.scopeAppearance('themes');
        return new Set(Object.entries(appearance.snippets).filter(([, enabled]) => enabled).map(([id]) => id));
    }
    /** 主题切换按作用域分流：外域只记录，本机立即应用。 */
    private async applyThemeToScope(themeName: string): Promise<void> {
        await this.manager.devices.writeAppearance('themes', { theme: themeName });
    }
    private async toggleSnippetForScope(snippetId: string, enabled: boolean): Promise<void> {
        await this.manager.devices.writeAppearance('themes', { snippets: { [snippetId]: enabled } });
    }

    private getThemeFolderPath(themeName: string): string {
        const getBasePath = (this.app.vault.adapter as VaultAdapterWithBasePath).getBasePath?.();
        const basePath = getBasePath ? normalizePath(getBasePath) : "";
        const relativePath = normalizePath(`${this.app.vault.configDir}/themes/${themeName}`);
        return basePath ? normalizePath(`${basePath}/${relativePath}`) : relativePath;
    }

    private getSnippetFolderPath(): string {
        const getBasePath = (this.app.vault.adapter as VaultAdapterWithBasePath).getBasePath?.();
        const basePath = getBasePath ? normalizePath(getBasePath) : "";
        const relativePath = normalizePath(`${this.app.vault.configDir}/snippets`);
        return basePath ? normalizePath(`${basePath}/${relativePath}`) : relativePath;
    }

    private getAppearanceConfigPath(): string {
        return normalizePath(`${this.app.vault.configDir}/appearance.json`);
    }

    private async readAppearanceJson(): Promise<AppearanceJson> {
        const adapter = this.app.vault.adapter;
        const path = this.getAppearanceConfigPath();
        try {
            if (!(await adapter.exists(path))) return {};
            return JSON.parse(await adapter.read(path)) as AppearanceJson;
        } catch {
            return {};
        }
    }

    private getCustomCssEnabledSnippetIds(): Set<string> | null {
        const enabledSnippets = this.getCustomCss()?.enabledSnippets;
        if (enabledSnippets instanceof Set) return new Set(enabledSnippets);
        if (Array.isArray(enabledSnippets)) return new Set(enabledSnippets);
        return null;
    }

    private async getEnabledSnippetIds(): Promise<Set<string>> {
        const fromCustomCss = this.getCustomCssEnabledSnippetIds();
        if (fromCustomCss) return fromCustomCss;
        const appearance = await this.readAppearanceJson();
        return new Set(Array.isArray(appearance.enabledCssSnippets) ? appearance.enabledCssSnippets : []);
    }

    private async collectCssSnippets(): Promise<CssSnippetItem[]> {
        const adapter = this.app.vault.adapter;
        const snippetsDir = normalizePath(`${this.app.vault.configDir}/snippets`);
        const enabledIds = await this.getEnabledSnippetIds();
        try {
            if (!(await adapter.exists(snippetsDir))) return [];
            const listed = await adapter.list(snippetsDir) as { files?: string[]; folders?: string[] };
            const snippets = (listed.files || [])
                .filter((file) => file.toLowerCase().endsWith(".css"))
                .map((file) => {
                    const fileName = file.split("/").pop() || file;
                    const id = fileName.replace(/\.css$/i, "");
                    return {
                        id,
                        name: id,
                        path: normalizePath(file),
                        enabled: enabledIds.has(id),
                    };
                })
                .sort((a, b) => a.name.localeCompare(b.name));
            // 外域按存储的片段开关展示；Live state stays untouched.
            if (this.isForeignThemes()) {
                const appearance = this.manager.devices.scopeAppearance('themes');
                snippets.forEach((snippet) => { snippet.enabled = appearance.snippets[snippet.id] === true; });
            }
            return snippets;
        } catch {
            return [];
        }
    }

    private async setCssSnippetEnabled(snippetId: string, enabled: boolean): Promise<void> {
        const customCss = this.getCustomCss();
        if (customCss?.setCssEnabledStatus) {
            customCss.setCssEnabledStatus(snippetId, enabled);
            return;
        }

        const adapter = this.app.vault.adapter;
        const path = this.getAppearanceConfigPath();
        const appearance = await this.readAppearanceJson();
        const enabledIds = new Set(Array.isArray(appearance.enabledCssSnippets) ? appearance.enabledCssSnippets : []);
        if (enabled) enabledIds.add(snippetId);
        else enabledIds.delete(snippetId);
        appearance.enabledCssSnippets = [...enabledIds].sort((a, b) => a.localeCompare(b));
        await adapter.write(path, JSON.stringify(appearance, null, 2));
        await customCss?.loadSnippets?.();
        (this.app.workspace as unknown as { trigger?: (name: string) => void }).trigger?.("css-change");
    }

    private normalizeSnippetIds(ids: string[]): string[] {
        return [...new Set((ids || []).map((id) => id.trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
    }

    private getAppearanceProfiles(): AppearanceProfile[] {
        if (!Array.isArray(this.manager.settings.APPEARANCE_PROFILES)) {
            this.manager.settings.APPEARANCE_PROFILES = [];
        }
        return this.manager.settings.APPEARANCE_PROFILES;
    }

    private createAppearanceProfileId(): string {
        return `appearance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    private createCurrentAppearanceProfileDraft(snippets: CssSnippetItem[]): AppearanceProfileDraft {
        const activeTheme = this.getScopedThemeName();
        return {
            id: "",
            name: activeTheme ? `${activeTheme} ${this.manager.translator.t("外观总览_方案_默认名称")}` : this.manager.translator.t("外观总览_方案_默认名称"),
            theme: activeTheme,
            enableSnippets: snippets.filter((snippet) => snippet.enabled).map((snippet) => snippet.id),
            disableSnippets: [],
            mode: "merge",
            autoApplyOnTheme: Boolean(activeTheme),
        };
    }

    private async saveAppearanceProfile(profile: AppearanceProfileDraft): Promise<void> {
        const profiles = this.getAppearanceProfiles();
        const now = Date.now();
        const enableSnippets = this.normalizeSnippetIds(profile.enableSnippets || []);
        const normalized: AppearanceProfile = {
            id: profile.id || this.createAppearanceProfileId(),
            name: profile.name.trim(),
            theme: profile.theme || "",
            enableSnippets,
            disableSnippets: this.normalizeSnippetIds(profile.disableSnippets || [])
                .filter((id) => !enableSnippets.includes(id)),
            mode: profile.mode || "merge",
            autoApplyOnTheme: Boolean(profile.autoApplyOnTheme && profile.theme),
            createdAt: profile.createdAt || now,
            updatedAt: now,
        };
        const index = profiles.findIndex((item) => item.id === normalized.id);
        if (index >= 0) profiles[index] = normalized;
        else profiles.push(normalized);
        profiles.sort((a, b) => a.name.localeCompare(b.name));
        await this.manager.saveSettings();
        await this.reloadShowData();
    }

    private async deleteAppearanceProfile(profileId: string): Promise<void> {
        this.manager.settings.APPEARANCE_PROFILES = this.getAppearanceProfiles().filter((profile) => profile.id !== profileId);
        await this.manager.saveSettings();
        await this.reloadShowData();
    }

    private getAutoAppearanceProfileForTheme(themeName: string): AppearanceProfile | undefined {
        if (!themeName) return undefined;
        return this.getAppearanceProfiles().find((profile) => profile.autoApplyOnTheme && profile.theme === themeName);
    }

    private openAppearanceProfileModal(profile: AppearanceProfileDraft, themes: ManagerTransferTheme[], snippets: CssSnippetItem[]) {
        new AppearanceProfileModal(this.app, this.manager, profile, themes, snippets, async (nextProfile) => {
            await this.saveAppearanceProfile(nextProfile);
        }).open();
    }

    private async writeEnabledSnippetIds(enabledIds: Set<string>): Promise<void> {
        const sortedIds = [...enabledIds].sort((a, b) => a.localeCompare(b));
        const adapter = this.app.vault.adapter;
        const path = this.getAppearanceConfigPath();
        const appearance = await this.readAppearanceJson();
        appearance.enabledCssSnippets = sortedIds;
        await adapter.write(path, JSON.stringify(appearance, null, 2));

        const customCss = this.getCustomCss();
        const customCssEnabledSnippets = customCss?.enabledSnippets;
        if (customCssEnabledSnippets instanceof Set) {
            customCssEnabledSnippets.clear();
            sortedIds.forEach((id) => customCssEnabledSnippets.add(id));
        } else if (customCss && Array.isArray(customCssEnabledSnippets)) {
            customCss.enabledSnippets = sortedIds;
        }
        await customCss?.loadSnippets?.();
        (this.app.workspace as unknown as { trigger?: (name: string) => void }).trigger?.("css-change");
    }

    private async applyAppearanceProfile(profile: AppearanceProfile, options: { quiet?: boolean } = {}): Promise<void> {
        if (profile.theme) await this.applyThemeToScope(profile.theme);
        const currentEnabled = await this.getScopedEnabledSnippetIds();
        const nextEnabled = profile.mode === "exact" ? new Set<string>() : new Set(currentEnabled);
        this.normalizeSnippetIds(profile.enableSnippets || []).forEach((id) => nextEnabled.add(id));
        this.normalizeSnippetIds(profile.disableSnippets || []).forEach((id) => nextEnabled.delete(id));

        const patch: Record<string, boolean> = {};
        for (const id of currentEnabled) patch[id] = nextEnabled.has(id);
        for (const id of nextEnabled) patch[id] = true;
        await this.manager.devices.writeAppearance('themes', { snippets: patch });
        if (!options.quiet) new Notice(this.manager.translator.t("外观总览_方案_已应用", { name: profile.name }));
        await this.reloadShowData();
    }

    private async activateThemeWithBoundProfile(themeName: string): Promise<void> {
        const boundProfile = toolEnabled(this.settings, 'appearanceProfiles') ? this.getAutoAppearanceProfileForTheme(themeName) : undefined;
        if (boundProfile) {
            await this.applyAppearanceProfile(boundProfile);
            return;
        }
        await this.applyThemeToScope(themeName);
        new Notice(this.manager.translator.t("外观总览_提示_主题已切换", { name: themeName }));
        await this.reloadShowData();
    }

    private renderAppearanceStats(themes: ManagerTransferTheme[], snippets: CssSnippetItem[]) {
        if (!this.footEl) return;
        const activeTheme = this.getScopedThemeName();
        const trackedCount = themes.filter((theme) => Boolean(theme.repo || theme.source)).length;
        const enabledSnippetCount = snippets.filter((snippet) => snippet.enabled).length;
        this.footEl.empty();
        const t = (key: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(key, vars);
        [
            { cls: "bpm-stat-chip--total", icon: "palette", label: t("外观总览_统计_主题"), value: themes.length },
            { cls: "bpm-stat-chip--enabled", icon: "badge-check", label: t("外观总览_统计_片段启用"), value: enabledSnippetCount },
            { cls: "bpm-stat-chip--updates", icon: "radio-tower", label: t("外观总览_统计_已追踪"), value: trackedCount },
            { cls: "bpm-stat-chip--hidden", icon: "monitor", label: t("外观总览_统计_当前"), value: activeTheme || t("外观总览_默认主题") },
        ].forEach((item) => {
            const chip = this.footEl.createSpan({ cls: `bpm-stat-chip ${item.cls}` });
            chip.setAttribute("aria-label", `${item.label} ${item.value}`);
            const icon = chip.createSpan({ cls: "bpm-stat-chip__icon" });
            setIcon(icon, item.icon);
            chip.createSpan({ cls: "bpm-stat-chip__label", text: item.label });
            chip.createSpan({ cls: "bpm-stat-chip__value", text: `${item.value}` });
        });
    }

    private async showThemeOverview(renderGeneration = this.renderGeneration) {
        const page: ManagerPage = "themes";
        if (!this.isRenderCurrent(renderGeneration, page)) return;
        this.enterScopePage('themes');
        const t = (key: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(key, vars);
        this.pageEl.empty();
        this.pageEl.addClass("manager-theme-overview");

        const [themes, snippets] = await Promise.all([
            collectInstalledThemes(this.manager, undefined, false, true),
            this.collectCssSnippets(),
        ]);
        if (!this.isRenderCurrent(renderGeneration, page)) return;
        const scopedTheme = this.getScopedThemeName();
        if (this.manager.devices?.isProjectingForeign('themes')) {
            themes.forEach((theme) => { theme.active = theme.name === scopedTheme; });
        }
        if (!toolEnabled(this.settings, 'appearanceProfiles') && this.appearanceView === 'profiles') this.appearanceView = 'themes';
        const profiles = toolEnabled(this.settings, 'appearanceProfiles') ? this.getAppearanceProfiles() : [];
        this.renderOverviewHeading();
        this.renderAppearanceStats(themes, snippets);

        const lowerSearchText = this.searchText.trim().toLowerCase();
        const visibleProfiles = lowerSearchText
            ? profiles.filter((profile) => [
                profile.name,
                profile.theme || "",
                profile.mode,
                ...(profile.enableSnippets || []),
                ...(profile.disableSnippets || []),
            ].join("\n").toLowerCase().includes(lowerSearchText))
            : profiles;
        const visibleThemes = lowerSearchText
            ? themes.filter((theme) => [
                theme.name,
                theme.version || "",
                theme.author || "",
                theme.repo || "",
                theme.source?.latestVersion || "",
                theme.source?.localVersion || "",
            ].join("\n").toLowerCase().includes(lowerSearchText))
            : themes;
        const visibleSnippets = lowerSearchText
            ? snippets.filter((snippet) => [
                snippet.name,
                snippet.id,
                snippet.path,
                snippet.enabled ? t("外观总览_状态_已启用") : t("外观总览_状态_已禁用"),
            ].join("\n").toLowerCase().includes(lowerSearchText))
            : snippets;

        const workspace = this.pageEl.createDiv("manager-repo-page manager-appearance-workspace");
        this.renderDeviceScope(workspace, 'themes');
        const toolbar = workspace.createDiv("manager-repo-page__toolbar manager-appearance-toolbar");
        const tabs = toolbar.createDiv("manager-repo-page__switcher manager-appearance-tabs");
        tabs.setAttribute("role", "tablist");
        tabs.setAttribute("data-slot", "tabs-list");
        const createAppearanceTab = (view: AppearanceView, icon: string, label: string, count: number) => {
            const button = tabs.createEl("button", { cls: "manager-repo-page__switch manager-appearance-tab" });
            const selected = this.appearanceView === view;
            button.type = "button";
            button.setAttribute("role", "tab");
            button.setAttribute("data-slot", "tabs-trigger");
            button.toggleClass("is-active", selected);
            button.setAttribute("aria-pressed", `${selected}`);
            button.setAttribute("aria-selected", `${selected}`);
            button.setAttribute("data-state", selected ? "active" : "inactive");
            const iconEl = button.createSpan({ cls: "manager-repo-page__switch-icon" });
            setIcon(iconEl, icon);
            button.createSpan({ cls: "manager-repo-page__switch-label", text: label });
            button.createSpan({ cls: "manager-repo-page__switch-count", text: `${count}` });
            button.addEventListener("click", () => {
                if (this.appearanceView === view) return;
                this.appearanceView = view;
                this.syncPageChrome();
                this.renderContent();
            });
        };
        if (toolEnabled(this.settings, 'appearanceProfiles')) createAppearanceTab("profiles", "layers-3", t("外观总览_分区_外观方案"), visibleProfiles.length);
        createAppearanceTab("themes", "palette", t("外观总览_分区_主题"), visibleThemes.length);
        createAppearanceTab("snippets", "file-code-2", t("外观总览_分区_CSS片段"), visibleSnippets.length);
        const body = workspace.createDiv("manager-repo-page__body manager-appearance-body");

        if (this.appearanceView === "profiles") {
        const profileSection = body.createDiv("manager-appearance-section manager-appearance-section--profiles");
        const profileList = profileSection.createDiv("manager-appearance-section__list");
        if (visibleProfiles.length === 0) {
            const empty = profileList.createDiv("manager-appearance-inline-empty");
            empty.createSpan({ text: lowerSearchText ? t("外观总览_方案_无匹配") : t("外观总览_方案_空") });
        }
        for (const profile of visibleProfiles) {
            if (!this.isRenderCurrent(renderGeneration, page)) return;
            const itemEl = new Setting(profileList);
            itemEl.setClass("manager-item");
            itemEl.settingEl.addClass("manager-theme-card");
            itemEl.settingEl.addClass("manager-appearance-profile-card");
            itemEl.settingEl.toggleClass("is-active-theme", Boolean(profile.theme && profile.theme === this.getActiveThemeName()));
            itemEl.nameEl.addClass("manager-item__name-container");
            itemEl.nameEl.addClass("manager-theme-card__header");
            itemEl.descEl.addClass("manager-item__description-container");
            itemEl.descEl.addClass("manager-theme-card__body");
            itemEl.controlEl.addClass("manager-item__controls");
            itemEl.controlEl.addClass("manager-theme-card__actions");

            const titleRow = itemEl.nameEl.createDiv("manager-theme-card__title-row");
            const iconWrap = titleRow.createSpan({ cls: "manager-theme-card__icon" });
            setIcon(iconWrap, "layers-3");
            titleRow.createSpan({ cls: "manager-theme-card__name", text: profile.name, title: profile.name });
            if (profile.theme) titleRow.createSpan({ cls: "manager-theme-card__chip is-source", text: profile.theme });
            titleRow.createSpan({ cls: "manager-theme-card__chip", text: t(profile.mode === "exact" ? "外观总览_方案_精确模式" : "外观总览_方案_合并模式") });
            if (profile.autoApplyOnTheme) titleRow.createSpan({ cls: "manager-theme-card__chip is-active", text: t("外观总览_方案_自动应用短") });

            const meta = itemEl.descEl.createDiv("manager-theme-card__meta");
            const addMeta = (iconName: string, label: string, value: string) => {
                const row = meta.createDiv("manager-theme-card__meta-row");
                const rowIcon = row.createSpan({ cls: "manager-theme-card__meta-icon" });
                setIcon(rowIcon, iconName);
                row.createSpan({ cls: "manager-theme-card__meta-label", text: label });
                row.createSpan({ cls: "manager-theme-card__meta-value", text: value, title: value });
            };
            addMeta("badge-check", t("外观总览_方案_启用片段数"), `${profile.enableSnippets.length}`);
            addMeta("circle-minus", t("外观总览_方案_禁用片段数"), `${profile.disableSnippets.length}`);

            const applyBtn = new ButtonComponent(itemEl.controlEl);
            applyBtn.setIcon("wand-sparkles");
            applyBtn.setTooltip(t("外观总览_方案_应用"));
            applyBtn.onClick(async () => {
                await this.applyAppearanceProfile(profile);
            });

            const editBtn = new ButtonComponent(itemEl.controlEl);
            editBtn.setIcon("pencil");
            editBtn.setTooltip(t("外观总览_方案_编辑"));
            editBtn.onClick(() => {
                this.openAppearanceProfileModal(profile, themes, snippets);
            });

            const deleteBtn = new ButtonComponent(itemEl.controlEl);
            deleteBtn.setIcon("trash-2");
            deleteBtn.setTooltip(t("外观总览_方案_删除"));
            deleteBtn.onClick(async () => {
                if (!(await confirmWithModal(this.app, this.manager, t("外观总览_方案_删除确认", { name: profile.name })))) return;
                await this.deleteAppearanceProfile(profile.id);
            });
        }
        }

        if (this.appearanceView === "themes") {
        const themeSection = body.createDiv("manager-appearance-section manager-appearance-section--themes");
        const themeList = themeSection.createDiv("manager-appearance-section__list");
        if (visibleThemes.length === 0) {
            const empty = themeList.createDiv("manager-appearance-inline-empty");
            empty.createSpan({ text: lowerSearchText ? t("外观总览_空_无匹配主题") : t("外观总览_空_无主题") });
            if (!lowerSearchText) {
                const installBtn = new ButtonComponent(empty);
                installBtn.setIcon("download");
                installBtn.setButtonText(t("外观总览_操作_安装主题"));
                installBtn.onClick(() => {
                    this.installType = "theme";
                    this.activePage = "install";
                    this.syncPageChrome();
                    this.renderContent();
                });
            }
        }
        for (const theme of visibleThemes) {
            if (!this.isRenderCurrent(renderGeneration, page)) return;
            const boundProfile = this.getAutoAppearanceProfileForTheme(theme.name);
            const itemEl = new Setting(themeList);
            itemEl.setClass("manager-item");
            itemEl.settingEl.addClass("manager-theme-card");
            itemEl.settingEl.toggleClass("is-active-theme", theme.active);
            itemEl.nameEl.addClass("manager-item__name-container");
            itemEl.nameEl.addClass("manager-theme-card__header");
            itemEl.descEl.addClass("manager-item__description-container");
            itemEl.descEl.addClass("manager-theme-card__body");
            itemEl.controlEl.addClass("manager-item__controls");
            itemEl.controlEl.addClass("manager-theme-card__actions");
            itemEl.controlEl.setAttribute("aria-label", t("外观总览_操作_主题区域", { name: theme.name }));

            const titleRow = itemEl.nameEl.createDiv("manager-theme-card__title-row");
            const iconWrap = titleRow.createSpan({ cls: "manager-theme-card__icon" });
            setIcon(iconWrap, theme.active ? "badge-check" : "palette");
            titleRow.createSpan({ cls: "manager-theme-card__name", text: theme.name, title: theme.name });
            if (theme.active) titleRow.createSpan({ cls: "manager-theme-card__chip is-active", text: t("外观总览_状态_当前") });
            if (theme.version) titleRow.createSpan({ cls: "manager-theme-card__chip", text: `v${theme.version}` });
            if (theme.repo || theme.source) titleRow.createSpan({ cls: "manager-theme-card__chip is-source", text: t("外观总览_状态_已追踪") });
            if (boundProfile) titleRow.createSpan({ cls: "manager-theme-card__chip is-active", text: t("外观总览_方案_已绑定") });

            const meta = itemEl.descEl.createDiv("manager-theme-card__meta");
            const addMeta = (iconName: string, label: string, value: string) => {
                if (!value) return;
                const row = meta.createDiv("manager-theme-card__meta-row");
                const rowIcon = row.createSpan({ cls: "manager-theme-card__meta-icon" });
                setIcon(rowIcon, iconName);
                row.createSpan({ cls: "manager-theme-card__meta-label", text: label });
                row.createSpan({ cls: "manager-theme-card__meta-value", text: value, title: value });
            };
            addMeta("user", t("外观总览_字段_作者"), theme.author || "");
            addMeta("tag", t("外观总览_字段_版本"), theme.version || "");
            addMeta("github", t("外观总览_字段_仓库"), theme.repo || "");
            if (theme.source) {
                addMeta("clock", t("外观总览_字段_安装时间"), this.formatSourceDate(theme.source.installedAt));
                addMeta("radio-tower", t("外观总览_字段_最新"), theme.source.latestReleaseTag || theme.source.latestVersion || "");
            }

            const activateBtn = new ButtonComponent(itemEl.controlEl);
            activateBtn.setIcon(theme.active ? "badge-check" : "paintbrush");
            activateBtn.setTooltip(boundProfile ? t("外观总览_方案_应用绑定", { name: boundProfile.name }) : (theme.active ? t("外观总览_操作_当前主题") : t("外观总览_操作_使用主题")));
            activateBtn.setDisabled(theme.active);
            activateBtn.onClick(async () => {
                await this.activateThemeWithBoundProfile(theme.name);
            });

            if (boundProfile && theme.active) {
                const applyBoundBtn = new ButtonComponent(itemEl.controlEl);
                applyBoundBtn.setIcon("wand-sparkles");
                applyBoundBtn.setTooltip(t("外观总览_方案_应用绑定", { name: boundProfile.name }));
                applyBoundBtn.onClick(async () => {
                    await this.applyAppearanceProfile(boundProfile);
                });
            }

            const openDirBtn = new ButtonComponent(itemEl.controlEl);
            openDirBtn.setIcon("folder-open");
            openDirBtn.setTooltip(t("外观总览_操作_打开主题目录"));
            openDirBtn.onClick(() => {
                managerOpen(this.getThemeFolderPath(theme.name), this.manager);
            });

            if (theme.repo) {
                const githubBtn = new ButtonComponent(itemEl.controlEl);
                githubBtn.setIcon("github");
                githubBtn.setTooltip(t("外观总览_操作_打开GitHub"));
                githubBtn.onClick(() => {
                    window.open(`https://github.com/${theme.repo}`);
                });
            }
        }
        }

        if (this.appearanceView === "snippets") {
        const snippetSection = body.createDiv("manager-appearance-section manager-appearance-section--snippets");
        const snippetList = snippetSection.createDiv("manager-appearance-section__list");
        if (visibleSnippets.length === 0) {
            const empty = snippetList.createDiv("manager-appearance-inline-empty");
            empty.createSpan({ text: lowerSearchText ? t("外观总览_空_无匹配片段") : t("外观总览_空_无CSS片段") });
            if (!lowerSearchText) {
                const openBtn = new ButtonComponent(empty);
                openBtn.setIcon("folder-open");
                openBtn.setButtonText(t("外观总览_操作_打开片段目录"));
                openBtn.onClick(() => {
                    managerOpen(this.getSnippetFolderPath(), this.manager);
                });
            }
        }

        for (const snippet of visibleSnippets) {
            if (!this.isRenderCurrent(renderGeneration, page)) return;
            const itemEl = new Setting(snippetList);
            itemEl.setClass("manager-item");
            itemEl.settingEl.addClass("manager-theme-card");
            itemEl.settingEl.addClass("manager-css-snippet-card");
            itemEl.settingEl.toggleClass("is-active-theme", snippet.enabled);
            itemEl.nameEl.addClass("manager-item__name-container");
            itemEl.nameEl.addClass("manager-theme-card__header");
            itemEl.descEl.addClass("manager-item__description-container");
            itemEl.descEl.addClass("manager-theme-card__body");
            itemEl.controlEl.addClass("manager-item__controls");
            itemEl.controlEl.addClass("manager-theme-card__actions");
            itemEl.controlEl.setAttribute("aria-label", t("外观总览_操作_片段区域", { name: snippet.name }));

            const titleRow = itemEl.nameEl.createDiv("manager-theme-card__title-row");
            const iconWrap = titleRow.createSpan({ cls: "manager-theme-card__icon" });
            setIcon(iconWrap, snippet.enabled ? "badge-check" : "file-code-2");
            titleRow.createSpan({ cls: "manager-theme-card__name", text: snippet.name, title: snippet.name });
            const statusChip = titleRow.createSpan({
                cls: `manager-theme-card__chip ${snippet.enabled ? "is-active" : ""}`,
                text: snippet.enabled ? t("外观总览_状态_已启用") : t("外观总览_状态_已禁用"),
            });

            const meta = itemEl.descEl.createDiv("manager-theme-card__meta");
            const row = meta.createDiv("manager-theme-card__meta-row manager-theme-card__meta-row--wide");
            const rowIcon = row.createSpan({ cls: "manager-theme-card__meta-icon" });
            setIcon(rowIcon, "file");
            row.createSpan({ cls: "manager-theme-card__meta-label", text: t("外观总览_字段_文件") });
            row.createSpan({ cls: "manager-theme-card__meta-value", text: `${snippet.id}.css`, title: snippet.path });

            const toggle = new ToggleComponent(itemEl.controlEl);
            toggle.setTooltip(snippet.enabled ? t("外观总览_操作_禁用片段") : t("外观总览_操作_启用片段"));
            toggle.setValue(snippet.enabled);
            const syncSnippetCardState = (enabled: boolean) => {
                snippet.enabled = enabled;
                itemEl.settingEl.toggleClass("is-active-theme", enabled);
                statusChip.toggleClass("is-active", enabled);
                statusChip.setText(enabled ? t("外观总览_状态_已启用") : t("外观总览_状态_已禁用"));
                setIcon(iconWrap, enabled ? "badge-check" : "file-code-2");
                toggle.setTooltip(enabled ? t("外观总览_操作_禁用片段") : t("外观总览_操作_启用片段"));
                this.renderAppearanceStats(themes, snippets);
            };
            toggle.onChange(async (enabled) => {
                const previousEnabled = snippet.enabled;
                toggle.setDisabled(true);
                try {
                    await this.toggleSnippetForScope(snippet.id, enabled);
                    syncSnippetCardState(enabled);
                    new Notice(t(enabled ? "外观总览_提示_片段已启用" : "外观总览_提示_片段已禁用", { name: snippet.name }));
                } catch (error) {
                    toggle.setValue(previousEnabled);
                    syncSnippetCardState(previousEnabled);
                    throw error;
                } finally {
                    toggle.setDisabled(false);
                }
            });

            const openDirBtn = new ButtonComponent(itemEl.controlEl);
            openDirBtn.setIcon("folder-open");
            openDirBtn.setTooltip(t("外观总览_操作_打开片段目录"));
            openDirBtn.onClick(() => {
                managerOpen(this.getSnippetFolderPath(), this.manager);
            });
        }
        }
    }

    private showHiddenPanel() {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        this.pageEl.empty();
        this.displayPlugins = [];
        let renderedCount = 0;
        const page = this.pageEl.createDiv("manager-hidden-page");
        const manifests = this.getUniquePluginManifests();
        const manifestById = new Map(manifests.map((plugin) => [plugin.id, plugin]));
        const managerPluginById = new Map(this.manager.settings.Plugins.map((plugin) => [plugin.id, plugin]));
        const hiddenPluginIds = new Set(this.settings.HIDES || []);
        const layout = this.getPluginLayout(manifests);

        const createOrderButton = (
            container: HTMLElement,
            icon: string,
            label: string,
            disabled: boolean,
            onClick: () => Promise<void>
        ) => {
            const btn = new ButtonComponent(container);
            btn.setIcon(icon);
            btn.setTooltip(label);
            btn.setDisabled(disabled);
            btn.onClick(async () => {
                await onClick();
            });
            return btn;
        };
        const bindDragHandle = (card: HTMLElement, index: number, label: string) => {
            card.setAttr("data-layout-index", `${index}`);
            const handle = card.createDiv("manager-hidden-card__drag");
            handle.setAttr("role", "button");
            handle.setAttr("aria-label", t("管理器_布局_拖动排序_标签", { label }));
            handle.setAttr("tabindex", "0");
            setIcon(handle, "grip-vertical");
            handle.addEventListener("pointerdown", (event) => this.startHiddenLayoutDrag(card, index, event));
            handle.addEventListener("dragstart", (event) => event.preventDefault());
            return handle;
        };

        for (const [index, layoutItem] of layout.entries()) {
            if (layoutItem.type === "separator") {
                const card = page.createDiv("manager-hidden-card manager-hidden-separator-card");
                card.addClass("manager-layout-editable-card");
                card.setAttr("data-layout-id", layoutItem.id);
                bindDragHandle(card, index, layoutItem.title || t("管理器_布局_分割线"));

                const main = card.createDiv("manager-hidden-card__main");
                const iconWrap = main.createDiv("manager-hidden-card__icon");
                setIcon(iconWrap, "separator-horizontal");

                const textWrap = main.createDiv("manager-hidden-card__text");
                const titleRow = textWrap.createDiv("manager-hidden-card__title-row");
                titleRow.createSpan({ cls: "manager-hidden-card__name", text: t("管理器_布局_分割线") });
                titleRow.createSpan({ text: t("管理器_布局_布局标记"), cls: "manager-hidden-item__state is-separator" });
                const titleInputWrap = textWrap.createDiv("manager-hidden-separator-card__input");
                const titleInput = new TextComponent(titleInputWrap);
                titleInput.setValue(layoutItem.title || t("管理器_布局_分割线"));
                titleInput.setPlaceholder(t("管理器_布局_分割线标题"));
                titleInput.inputEl.setAttribute("aria-label", t("管理器_布局_分割线标题"));
                titleInput.onChange(async (value) => {
                    await this.updatePluginLayoutSeparator(layoutItem.id, value);
                });

                const actions = card.createDiv("manager-hidden-card__actions");
                const order = actions.createDiv("manager-hidden-card__order");
                createOrderButton(order, "arrow-up", t("通用_上移_文本"), index === 0, async () => this.movePluginLayoutItem(index, -1));
                createOrderButton(order, "arrow-down", t("通用_下移_文本"), index === layout.length - 1, async () => this.movePluginLayoutItem(index, 1));
                createOrderButton(order, "trash-2", t("管理器_布局_删除分割线"), false, async () => this.removePluginLayoutSeparator(layoutItem.id));
                renderedCount++;
                continue;
            }

            const plugin = manifestById.get(layoutItem.id);
            if (!plugin) continue;
            const managerPlugin = managerPluginById.get(plugin.id);
            if (!managerPlugin) continue;
            const isSelf = plugin.id === this.manager.manifest.id;
            const isEnabled = this.isPluginEnabledForDisplay(plugin.id, managerPlugin);
            const isHidden = hiddenPluginIds.has(plugin.id);

            const card = page.createDiv("manager-hidden-card");
            card.setAttr("data-plugin-id", plugin.id);
            card.addClass("manager-layout-editable-card");
            bindDragHandle(card, index, managerPlugin.name);
            card.toggleClass("is-hidden", isHidden);
            if (this.settings.FADE_OUT_DISABLED_PLUGINS && !isEnabled) card.addClass("inactive");

            const main = card.createDiv("manager-hidden-card__main");
            const iconWrap = main.createDiv("manager-hidden-card__icon");
            setIcon(iconWrap, isHidden ? "eye-off" : "eye");

            const textWrap = main.createDiv("manager-hidden-card__text");
            const titleRow = textWrap.createDiv("manager-hidden-card__title-row");
            titleRow.createSpan({
                text: managerPlugin.name,
                title: plugin.name,
                cls: "manager-hidden-card__name",
            });
            titleRow.createSpan({
                text: isHidden ? t("管理器_状态_已隐藏") : t("管理器_状态_显示中"),
                cls: `manager-hidden-item__state ${isHidden ? "is-hidden" : "is-visible"}`,
            });
            textWrap.createDiv({
                text: plugin.id,
                cls: "manager-hidden-card__id",
            });

            const actions = card.createDiv("manager-hidden-card__actions");
            const order = actions.createDiv("manager-hidden-card__order");
            createOrderButton(order, "arrow-up", t("通用_上移_文本"), index === 0, async () => this.movePluginLayoutItem(index, -1));
            createOrderButton(order, "arrow-down", t("通用_下移_文本"), index === layout.length - 1, async () => this.movePluginLayoutItem(index, 1));

            const control = actions.createDiv("manager-hidden-card__control");
            control.createSpan({ cls: "manager-hidden-card__control-label", text: t("管理器_布局_隐藏于管理页") });
            const hiddenToggle = new ToggleComponent(control);
            hiddenToggle.setValue(isHidden);
            hiddenToggle.setDisabled(isSelf);
            hiddenToggle.toggleEl.setAttribute("aria-label", t("管理器_布局_隐藏于管理页_标签", { name: managerPlugin.name }));
            hiddenToggle.onChange((value) => {
                if (isSelf) return;
                if (value) {
                    if (!this.settings.HIDES.includes(plugin.id)) this.settings.HIDES.push(plugin.id);
                } else {
                    this.settings.HIDES = this.settings.HIDES.filter(id => id !== plugin.id);
                }
                void this.manager.saveSettings();
                void this.reloadShowData();
            });

            this.displayPlugins.push(plugin);
            renderedCount++;
        }

        if (renderedCount === 0) {
            const empty = page.createDiv("bpm-empty-state manager-hidden-page__empty");
            const icon = empty.createDiv();
            setIcon(icon, "eye-off");
            empty.createDiv({ cls: "bpm-empty-state__text", text: t("管理器_暂无匹配插件") });
        }
    }

    private showSourcesPanel(containerEl: HTMLElement = this.pageEl) {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        if (containerEl === this.pageEl) containerEl.empty();

        const page = containerEl.createDiv("manager-source-page");
        const sources = this.getBetaSources();
        void this.refreshSourcesPackageCreatedAt(sources).then(async (changed) => {
            if (!changed || this.activePage !== "sources") return;
            await this.manager.saveSettings();
            this.renderContent();
        });

        if (sources.length === 0) {
            const empty = page.createDiv("bpm-empty-state manager-source-page__empty");
            const icon = empty.createDiv();
            setIcon(icon, "radio-tower");
            empty.createDiv({ cls: "bpm-empty-state__text", text: t("来源_暂无订阅_提示") });
            const actionWrap = empty.createDiv("manager-source-page__empty-action");
            const addBtn = new ButtonComponent(actionWrap);
            addBtn.setIcon("download");
            addBtn.setButtonText(t("来源_安装仓库_按钮"));
            addBtn.onClick(() => {
                this.activePage = "install";
                this.syncPageChrome();
                this.renderContent();
            });
            return;
        }

        const toolbar = page.createDiv("manager-source-page__toolbar manager-source-page__toolbar--actions");
        const actions = toolbar.createDiv("manager-source-page__actions");
        const checkAllBtn = new ButtonComponent(actions);
        checkAllBtn.setIcon("refresh-cw");
        checkAllBtn.setButtonText(t("来源_全部检查_按钮"));
        checkAllBtn.onClick(async () => {
            checkAllBtn.setDisabled(true);
            checkAllBtn.setButtonText(t("来源_检查中_按钮"));
            for (const source of sources) {
                await this.checkBetaSource(source);
            }
            this.renderContent();
        });

        const updateTargets = sources.filter((source) => this.sourceHasUpdate(source));
        const updateAllBtn = new ButtonComponent(actions);
        updateAllBtn.setIcon("download");
        updateAllBtn.setButtonText(t("来源_更新可更新_按钮"));
        updateAllBtn.setDisabled(updateTargets.length === 0);
        updateAllBtn.onClick(async () => {
            updateAllBtn.setDisabled(true);
            updateAllBtn.setButtonText(t("来源_更新中_按钮"));
            for (const source of updateTargets) {
                await this.updateBetaSource(source);
            }
            this.renderContent();
        });

        const list = page.createDiv("manager-source-page__list");
        const sortedSources = [...sources].sort((a, b) => a.repo.localeCompare(b.repo));
        for (const source of sortedSources) {
            const notInstalledText = t("来源_未安装");
            const notCheckedText = t("来源_未检查");
            const localVersion = this.getSourceLocalVersion(source) || notInstalledText;
            const installedReleaseTag = source.installedReleaseTag || (localVersion === notInstalledText ? "" : localVersion);
            const latestVersion = source.latestReleaseTag || source.latestVersion || notCheckedText;
            const localVersionText = localVersion === notInstalledText
                ? localVersion
                : this.formatVersionWithDate(installedReleaseTag || localVersion, source.installedReleasePublishedAt || source.installedAt);
            const latestVersionText = source.latestReleaseTag || source.latestVersion
                ? this.formatVersionWithDate(source.latestReleaseTag || source.latestVersion || "", source.latestReleasePublishedAt || source.latestPublishedAt)
                : latestVersion;
            const hasUpdate = this.sourceHasUpdate(source);
            const sourceKey = this.getSourceConfigKey(source);
            const isConfigExpanded = this.expandedSourceConfigKeys.has(sourceKey);
            const configRegionId = `manager-source-config-${sourceKey.replace(/[^a-z0-9_-]+/gi, "-")}`;

            const card = list.createDiv("manager-source-card");
            card.setAttribute("data-source-repo", source.repo);
            card.toggleClass("has-update", hasUpdate);
            card.toggleClass("has-error", Boolean(source.error));
            card.toggleClass("is-config-expanded", isConfigExpanded);
            card.toggleClass("is-config-collapsed", !isConfigExpanded);

            const cardMain = card.createDiv("manager-source-card__main");
            const cardHeader = cardMain.createDiv("manager-source-card__header");
            const titleBlock = cardHeader.createDiv("manager-source-card__title-block");
            const repoLine = titleBlock.createDiv("manager-source-card__repo-line");
            const repoIcon = repoLine.createSpan({ cls: "manager-source-card__repo-icon" });
            setIcon(repoIcon, "github");
            repoLine.createSpan({
                text: source.repo,
                cls: "manager-source-card__repo",
                title: `https://github.com/${source.repo}`,
            });

            const headerActions = cardHeader.createDiv("manager-source-card__header-actions");
            const chips = headerActions.createDiv("manager-source-card__chips");
            chips.appendChild(createSpan({
                text: source.type === "plugin" ? t("来源_类型_插件") : t("来源_类型_主题"),
                cls: "manager-source-item__chip",
            }));
            chips.appendChild(createSpan({
                text: source.mode === "frozen" ? t("来源_模式_固定版本") : t("来源_模式_跟随最新"),
                cls: `manager-source-item__chip ${source.mode === "frozen" ? "is-frozen" : "is-latest"}`,
            }));
            chips.appendChild(createSpan({
                text: source.updateCheckMode === "version" ? t("来源_检测方式_版本号") : t("来源_检测方式_发布顺序"),
                cls: `manager-source-item__chip ${source.updateCheckMode === "version" ? "is-latest" : "is-frozen"}`,
            }));
            chips.appendChild(createSpan({
                text: source.compatibilityMode === "all" ? t("兼容性_显示全部") : t("兼容性_仅兼容"),
                cls: `manager-source-item__chip ${source.compatibilityMode === "all" ? "is-frozen" : "is-latest"}`,
            }));
            if (source.autoUpdate) {
                chips.appendChild(createSpan({ text: t("来源_自动更新"), cls: "manager-source-item__chip is-auto" }));
            }
            if (source.includePrerelease) {
                chips.appendChild(createSpan({ text: t("安装_发布类型_预发布"), cls: "manager-source-item__chip is-frozen" }));
            }
            if (hasUpdate) {
                chips.appendChild(createSpan({ text: t("来源_有更新"), cls: "manager-source-item__chip is-update" }));
            }
            if (source.deferredPublicationDate) {
                chips.appendChild(createSpan({ text: t("更新_发布日期不可用_暂缓"), cls: "manager-source-item__chip" }));
            }

            const configToggleLabel = `${isConfigExpanded ? t("Ribbon_隐藏") : t("Ribbon_显示")} ${t("导入导出_配置短标签")}`;
            const configToggle = headerActions.createEl("button", { cls: "manager-source-card__config-toggle" });
            configToggle.setAttribute("type", "button");
            configToggle.setAttribute("aria-expanded", String(isConfigExpanded));
            configToggle.setAttribute("aria-controls", configRegionId);
            configToggle.setAttribute("aria-label", configToggleLabel);
            configToggle.setAttribute("title", configToggleLabel);
            const configToggleIcon = configToggle.createSpan("manager-source-card__config-toggle-icon");
            setIcon(configToggleIcon, isConfigExpanded ? "chevron-up" : "chevron-down");
            configToggle.addEventListener("click", () => {
                if (isConfigExpanded) {
                    this.expandedSourceConfigKeys.delete(sourceKey);
                } else {
                    this.expandedSourceConfigKeys.add(sourceKey);
                }
                this.renderContent();
            });

            const checkedText = source.lastChecked ? new Date(source.lastChecked).toLocaleString() : notCheckedText;
            const metaGrid = cardMain.createDiv("manager-source-card__meta-grid");
            const createMeta = (label: string, value: string, iconName: string, extraCls?: string) => {
                const meta = metaGrid.createDiv(`manager-source-card__meta${extraCls ? ` ${extraCls}` : ""}`);
                const iconEl = meta.createSpan({ cls: "manager-source-card__meta-icon" });
                setIcon(iconEl, iconName);
                meta.createSpan({ cls: "manager-source-card__meta-label", text: label });
                meta.createSpan({ cls: "manager-source-card__meta-value", text: value, title: value });
            };
            createMeta(t("来源_当前"), localVersionText, "hard-drive", localVersion === notInstalledText ? "is-muted" : undefined);
            createMeta(t("来源_最新"), latestVersionText, "tag", hasUpdate ? "is-update" : undefined);
            createMeta(t("来源_检查"), checkedText, "clock");
            if (source.error) {
                const errorEl = cardMain.createDiv("manager-source-card__error");
                const errorIcon = errorEl.createSpan({ cls: "manager-source-card__error-icon" });
                setIcon(errorIcon, "triangle-alert");
                errorEl.createSpan({ text: source.error });
            }

            const controls = card.createDiv("manager-source-card__controls");
            controls.id = configRegionId;
            controls.setAttribute("role", "region");
            controls.setAttribute("aria-label", configToggleLabel);
            controls.toggleAttribute("hidden", !isConfigExpanded);
            const strategyPanel = controls.createDiv("manager-source-card__control-panel manager-source-card__control-panel--strategy");
            const updatePanel = controls.createDiv("manager-source-card__control-panel manager-source-card__control-panel--update");
            const strategyGroup = strategyPanel.createDiv("manager-source-card__control-group manager-source-card__control-group--strategy");
            strategyGroup.createSpan({ cls: "manager-source-card__control-label", text: t("来源_版本策略") });
            const strategyWrap = strategyGroup.createDiv("manager-source-item__strategy");
            const modeDropdown = new DropdownComponent(strategyWrap);
            modeDropdown.addOptions({ latest: t("来源_模式_跟随最新"), frozen: t("来源_模式_固定版本") });
            modeDropdown.setValue(source.mode || "latest");
            modeDropdown.onChange(async (value) => {
                if (value !== "latest" && value !== "frozen") return;
                source.mode = value;
                if (value === "frozen" && !source.frozenVersion) source.frozenVersion = source.latestVersion || localVersion;
                await this.manager.saveSettings();
                this.renderContent();
            });
            modeDropdown.selectEl.addClass("manager-source-item__mode");
            modeDropdown.selectEl.setAttribute("aria-label", t("来源_版本策略"));

            const updateCheckDropdown = new DropdownComponent(strategyWrap);
            updateCheckDropdown.addOptions({
                release: t("来源_检测方式_发布顺序"),
                version: t("来源_检测方式_版本号"),
            });
            updateCheckDropdown.setValue(source.updateCheckMode || "release");
            updateCheckDropdown.onChange(async (value) => {
                if (value !== "release" && value !== "version") return;
                source.updateCheckMode = value;
                await this.manager.saveSettings();
                this.renderContent();
            });
            updateCheckDropdown.selectEl.addClass("manager-source-item__mode");
            updateCheckDropdown.selectEl.addClass("manager-source-item__check-mode");
            updateCheckDropdown.selectEl.setAttribute("aria-label", t("来源_检测方式"));

            if (source.type === "plugin") {
                const compatibilityGroup = strategyPanel.createDiv("manager-source-card__control-group manager-source-card__control-group--compatibility");
                compatibilityGroup.createSpan({ cls: "manager-source-card__control-label", text: t("兼容性_策略") });
                const compatibilityDropdown = new DropdownComponent(compatibilityGroup);
                compatibilityDropdown.addOptions({
                    compatible: t("兼容性_仅兼容"),
                    all: t("兼容性_显示全部"),
                });
                compatibilityDropdown.setValue(source.compatibilityMode || "compatible");
                compatibilityDropdown.onChange(async (value) => {
                    source.compatibilityMode = value === "all" ? "all" : "compatible";
                    await this.checkBetaSource(source);
                    this.renderContent();
                });
                compatibilityDropdown.selectEl.addClass("manager-source-item__mode");
                compatibilityDropdown.selectEl.setAttribute("aria-label", t("兼容性_策略"));
            }

            const delayWrap = strategyWrap.createDiv("manager-source-item__delay");
            delayWrap.createSpan({ cls: "manager-source-item__delay-label", text: t("来源_更新延迟_标签") });
            const delayInput = new TextComponent(delayWrap);
            delayInput.setPlaceholder("0");
            delayInput.setValue(source.updateDelayDays ? String(source.updateDelayDays) : "");
            delayInput.inputEl.addClass("manager-source-item__delay-input");
            delayInput.inputEl.setAttribute("type", "number");
            delayInput.inputEl.setAttribute("min", "0");
            delayInput.inputEl.setAttribute("step", "1");
            delayInput.inputEl.setAttribute("aria-label", t("来源_更新延迟_标签"));
            delayInput.inputEl.setAttribute("title", t("来源_更新延迟_说明"));
            delayInput.onChange(async (value) => {
                source.updateDelayDays = this.normalizeSourceUpdateDelayDays(value);
                await this.manager.saveSettings();
            });
            delayInput.inputEl.addEventListener("blur", () => {
                void this.checkBetaSource(source).then(() => {
                    if (this.activePage === "sources") this.renderContent();
                });
            });

            if (source.mode === "frozen") {
                const frozenInput = new TextComponent(strategyWrap);
                frozenInput.setPlaceholder("tag");
                frozenInput.setValue(source.frozenVersion || "");
                frozenInput.inputEl.addClass("manager-source-item__version");
                frozenInput.inputEl.setAttribute("aria-label", t("来源_固定Tag_标签"));
                frozenInput.onChange(async (value) => {
                    source.frozenVersion = value.trim();
                    await this.manager.saveSettings();
                });
            }

            const updateToggleGrid = updatePanel.createDiv("manager-source-card__toggle-grid");
            const autoGroup = updateToggleGrid.createDiv("manager-source-card__control-group manager-source-card__control-group--auto");
            autoGroup.createSpan({ cls: "manager-source-card__control-label", text: t("来源_更新") });
            const autoWrap = autoGroup.createDiv("manager-source-item__toggle");
            autoWrap.createSpan({ cls: "manager-source-item__toggle-label", text: t("来源_自动") });
            const autoToggle = new ToggleComponent(autoWrap);
            autoToggle.setValue(Boolean(source.autoUpdate));
            autoToggle.toggleEl.setAttribute("aria-label", t("来源_自动更新"));
            autoToggle.onChange(async (value) => {
                source.autoUpdate = value;
                await this.manager.saveSettings();
                this.renderContent();
            });

            const prereleaseGroup = updateToggleGrid.createDiv("manager-source-card__control-group manager-source-card__control-group--pre");
            prereleaseGroup.createSpan({ cls: "manager-source-card__control-label", text: t("安装_发布类型_预发布") });
            const prereleaseWrap = prereleaseGroup.createDiv("manager-source-item__toggle");
            prereleaseWrap.createSpan({ cls: "manager-source-item__toggle-label", text: t("来源_最新") });
            const prereleaseToggle = new ToggleComponent(prereleaseWrap);
            prereleaseToggle.setValue(Boolean(source.includePrerelease));
            prereleaseToggle.toggleEl.setAttribute("aria-label", t("安装_发布类型_预发布"));
            prereleaseToggle.onChange(async (value) => {
                source.includePrerelease = value;
                await this.manager.saveSettings();
                await this.checkBetaSource(source);
                this.renderContent();
            });

            const actionGroup = updatePanel.createDiv("manager-source-card__actions");
            const prepareActionButton = (btn: ButtonComponent, label: string) => {
                btn.setTooltip(label);
                btn.buttonEl.setAttribute("aria-label", label);
            };

            const checkBtn = new ButtonComponent(actionGroup);
            checkBtn.setIcon("refresh-cw");
            prepareActionButton(checkBtn, t("来源_检查更新_按钮"));
            checkBtn.onClick(async () => {
                checkBtn.setDisabled(true);
                await this.checkBetaSource(source);
                checkBtn.setDisabled(false);
                this.renderContent();
            });

            const updateBtn = new ButtonComponent(actionGroup);
            updateBtn.setIcon("download");
            prepareActionButton(updateBtn, t("来源_更新_按钮"));
            updateBtn.setDisabled(localVersion === notInstalledText
                ? !source.latestReleaseTag && !source.latestVersion
                : !hasUpdate);
            updateBtn.onClick(async () => {
                updateBtn.setDisabled(true);
                await this.updateBetaSource(source);
                updateBtn.setDisabled(false);
                this.renderContent();
            });

            const reinstallBtn = new ButtonComponent(actionGroup);
            reinstallBtn.setIcon("rotate-ccw");
            prepareActionButton(reinstallBtn, t("来源_重装_按钮"));
            reinstallBtn.onClick(async () => {
                reinstallBtn.setDisabled(true);
                await this.updateBetaSource(source, true);
                reinstallBtn.setDisabled(false);
                this.renderContent();
            });

            const githubBtn = new ButtonComponent(actionGroup);
            githubBtn.setIcon("github");
            prepareActionButton(githubBtn, t("来源_打开GitHub_按钮"));
            githubBtn.onClick(() => {
                window.open(`https://github.com/${source.repo}`);
            });

            const removeBtn = new ButtonComponent(actionGroup);
            removeBtn.setIcon("trash-2");
            prepareActionButton(removeBtn, t("来源_停止跟踪_按钮"));
            removeBtn.onClick(async () => {
                if (!(await confirmWithModal(this.app, this.manager, t("来源_停止跟踪_确认")))) return;
                this.manager.settings.BETA_SOURCES = this.getBetaSources().filter((item) => item !== source);
                await this.manager.saveSettings();
                this.renderContent();
            });
        }
    }

    private getNormalizedInstallRepo(): string {
        return sanitizeRepo(this.installRepo);
    }

    private isValidInstallRepo(repo: string): boolean {
        return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
    }

    private requireInstallRepo(): string | null {
        const repo = this.getNormalizedInstallRepo();
        if (!this.isValidInstallRepo(repo)) return null;
        this.installRepo = repo;
        return repo;
    }

    private clearInstallToolbarMenus(): void {
        this.installToolbarLayout?.destroy();
        this.installToolbarLayout = undefined;
        this.installToolbarMenus.forEach(menu => menu.close());
        this.installToolbarMenus = [];
    }

    private renderInstallToolbar(toolbar: HTMLElement): void {
        this.clearInstallToolbarMenus();
        const t = (key: string) => this.manager.translator.t(key);
        const stats = this.getSourceStats();
        const rows = [
            { label: t("来源_统计_来源"), value: stats.total, icon: "radio-tower" },
            { label: t("来源_统计_插件"), value: stats.plugins, icon: "blocks" },
            { label: t("来源_统计_主题"), value: stats.themes, icon: "palette" },
            { label: t("来源_统计_自动"), value: stats.auto, icon: "refresh-cw" },
            { label: t("来源_统计_可更新"), value: stats.updates, icon: "download" },
        ];
        const navigation = ScopeSelect.compact(toolbar, t('来源_工作区'), this.activePage,
            [{ value: 'install', label: t('来源_安装仓库_按钮'), icon: 'download' },
                { value: 'sources', label: `${t('来源_订阅_标题')} ${stats.total}`, icon: 'radio-tower' }],
            value => this.setDesktopPage(value === 'sources' ? 'sources' : 'install'));
        navigation.field.addClass('manager-repo-page__navigation-menu');
        const summary = ScopeSelect.summary(toolbar, t('来源_统计_标题'),
            rows.map(row => ({ value: `${row.value}`, label: row.label, icon: row.icon })));
        summary.field.addClass('manager-repo-page__summary-menu');
        this.installToolbarMenus.push(navigation, summary);
        const switcher = toolbar.createDiv("manager-repo-page__switcher");
        switcher.setAttribute("role", "tablist");
        switcher.setAttribute("data-slot", "tabs-list");
        const createWorkspaceButton = (page: "install" | "sources", icon: string, label: string, count?: number) => {
            const button = switcher.createEl("button", { cls: "manager-repo-page__switch" });
            const selected = this.activePage === page;
            button.type = "button";
            button.setAttribute("role", "tab");
            button.setAttribute("data-slot", "tabs-trigger");
            button.toggleClass("is-active", selected);
            button.setAttribute("aria-pressed", `${selected}`);
            button.setAttribute("aria-selected", `${selected}`);
            button.setAttribute("data-state", selected ? "active" : "inactive");
            const iconEl = button.createSpan({ cls: "manager-repo-page__switch-icon" });
            setIcon(iconEl, icon);
            button.createSpan({ cls: "manager-repo-page__switch-label", text: label });
            if (typeof count === "number") button.createSpan({ cls: "manager-repo-page__switch-count", text: `${count}` });
            button.addEventListener("click", () => {
                if (this.activePage === page) return;
                this.activePage = page;
                this.syncPageChrome();
                this.renderContent();
            });
        };
        createWorkspaceButton("install", "download", t("来源_安装仓库_按钮"));
        createWorkspaceButton("sources", "radio-tower", t("来源_订阅_标题"), stats.total);

        const toolbarStats = toolbar.createDiv("manager-repo-page__stats");
        rows.forEach((item) => {
            const chip = toolbarStats.createSpan({ cls: "manager-repo-page__stat" });
            chip.setAttribute("aria-label", `${item.label} ${item.value}`);
            const chipIcon = chip.createSpan({ cls: "manager-repo-page__stat-icon" });
            setIcon(chipIcon, item.icon);
            chip.createSpan({ cls: "manager-repo-page__stat-label", text: item.label });
            chip.createSpan({ cls: "manager-repo-page__stat-value", text: `${item.value}` });
        });
        this.installToolbarLayout = new ResponsiveToolbar(toolbar, () => [switcher, toolbarStats]);
    }

    // 安装面板
    private showInstallPanel() {
        this.pageEl.empty();
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const repo = this.getNormalizedInstallRepo();
        const repoIsValid = this.isValidInstallRepo(repo);
        const typeLabel = this.installType === "plugin"
            ? t("管理器_安装_类型_插件")
            : t("管理器_安装_类型_主题");
        const versionLabel = this.installVersion || t("管理器_安装_版本_默认最新");
        const workspace = this.pageEl.createDiv("manager-repo-page");
        const toolbar = workspace.createDiv("manager-repo-page__toolbar");
        this.renderInstallToolbar(toolbar);

        const body = workspace.createDiv("manager-repo-page__body");
        if (this.activePage === "sources") {
            this.showSourcesPanel(body);
            return;
        }

        const panel = body.createDiv("manager-install");

        const typeSetting = new Setting(panel)
            .setName(t("管理器_安装_类型_标题"))
            .setDesc(t("管理器_安装_类型_描述"));
        typeSetting.settingEl.addClass("manager-install__setting");
        typeSetting.controlEl.addClass("manager-install__type-control");
        const typeSegment = typeSetting.controlEl.createDiv("manager-install__segmented");
        typeSegment.setAttribute("role", "tablist");
        typeSegment.setAttribute("data-slot", "tabs-list");
        const createTypeButton = (type: "plugin" | "theme", icon: string, label: string) => {
            const button = typeSegment.createEl("button", { cls: "manager-install__segment" });
            button.type = "button";
            button.setAttribute("role", "tab");
            button.setAttribute("data-slot", "tabs-trigger");
            button.toggleClass("is-active", this.installType === type);
            button.setAttribute("aria-pressed", `${this.installType === type}`);
            button.setAttribute("aria-selected", `${this.installType === type}`);
            button.setAttribute("data-state", this.installType === type ? "active" : "inactive");
            const iconEl = button.createSpan({ cls: "manager-install__segment-icon" });
            setIcon(iconEl, icon);
            button.createSpan({ text: label });
            button.addEventListener("click", () => {
                if (this.installType === type) return;
                this.installType = type;
                this.renderContent();
            });
        };
        createTypeButton("plugin", "blocks", t("管理器_安装_类型_插件"));
        createTypeButton("theme", "palette", t("管理器_安装_类型_主题"));

        let fetchButton: ButtonComponent | undefined;
        let installButton: ButtonComponent | undefined;
        let versionInputEl: HTMLInputElement | undefined;
        let versionSelectEl: HTMLSelectElement | undefined;
        const resetVersionControls = () => {
            if (versionSelectEl) {
                versionSelectEl.empty();
                const option = activeDocument.createElement("option");
                option.value = "";
                option.text = t("管理器_安装_版本_默认最新");
                versionSelectEl.appendChild(option);
                versionSelectEl.value = "";
            }
            if (versionInputEl) versionInputEl.value = "";
        };
        const releaseEls: {
            title?: HTMLElement;
            meta?: HTMLElement;
            body?: HTMLElement;
        } = {};
        const formatReleaseDate = (value?: string) => {
            if (!value) return "";
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return "";
            return date.toLocaleDateString();
        };
        const getReleaseOptionLabel = (release: ReleaseVersion) => [
            release.version,
            release.isGithubLatest ? t("兼容性_GitHubLatest") : "",
            release.minAppVersion ? t("兼容性_需要版本", { version: release.minAppVersion }) : "",
            release.minAppVersion ? t(releaseIsCompatible(release) ? "兼容性_兼容" : "兼容性_不兼容") : "",
            formatReleaseDate(release.publishedAt),
            release.prerelease ? t("安装_发布类型_预发布") : "",
        ].filter(Boolean).join(" · ");
        const getSelectedRelease = () => {
            if (this.installVersions.length === 0) return null;
            const selected = this.installVersion.trim();
            if (selected) return this.installVersions.find((item) => item.version === selected) ?? null;
            if (this.installType === "plugin") {
                const updateOptions = this.manager.getPluginUpdateCheckOptions();
                const target = pickSourceTargetRelease({
                    id: this.getNormalizedInstallRepo(),
                    repo: this.getNormalizedInstallRepo(),
                    type: "plugin",
                    mode: "latest",
                    includePrerelease: false,
                    updateCheckMode: "release",
                    compatibilityMode: updateOptions.compatibilityMode,
                    autoUpdate: false,
                    enabled: true,
                }, this.installVersions);
                if (target) return this.installVersions.find((item) => item.version === target.tag) ?? null;
            }
            return this.installVersions.find((item) => !item.prerelease) || this.installVersions[0];
        };
        const updateReleaseInfo = () => {
            if (!releaseEls.title || !releaseEls.meta || !releaseEls.body) return;
            const release = getSelectedRelease();
            releaseEls.title.empty();
            releaseEls.meta.empty();
            releaseEls.body.empty();
            if (!release) {
                releaseEls.title.setText(t("安装_版本更新信息_标题"));
                releaseEls.body.setText(t("安装_版本更新信息_空提示"));
                releaseEls.body.addClass("is-empty");
                return;
            }
            releaseEls.body.removeClass("is-empty");
            releaseEls.title.setText(release.name || release.version);
            const metaParts = [
                release.version,
                release.isGithubLatest ? t("兼容性_GitHubLatest") : "",
                release.minAppVersion ? t("兼容性_需要版本", { version: release.minAppVersion }) : "",
                release.minAppVersion ? t(releaseIsCompatible(release) ? "兼容性_兼容" : "兼容性_不兼容") : "",
                release.prerelease ? t("安装_发布类型_预发布") : t("安装_发布类型_正式版"),
                formatReleaseDate(release.publishedAt),
            ].filter(Boolean);
            releaseEls.meta.setText(metaParts.join(" · "));
            releaseEls.body.setText((release.body || "").trim() || t("安装_暂无更新说明"));
        };
        const fetchVersions = async () => {
            const validRepo = this.requireInstallRepo();
            if (!validRepo) {
                new Notice(t("管理器_安装_仓库为空提示"));
                return;
            }
            fetchButton?.setDisabled(true);
            fetchButton?.setButtonText(t("管理器_安装_版本_获取中"));
            try {
                this.installVersions = await fetchReleaseVersions(this.manager, validRepo, { includeManifest: this.installType === "plugin" });
                this.installVersion = "";
                if (this.installVersions.length === 0) new Notice(t("管理器_安装_版本_空提示"));
            } catch (e) {
                console.error(e);
                new Notice(t("管理器_安装_版本_失败提示"));
            } finally {
                this.renderContent();
            }
        };

        const repoSetting = new Setting(panel)
            .setName(t("管理器_安装_仓库_标题"))
            .setDesc(t("管理器_安装_仓库_描述"));
        repoSetting.settingEl.addClass("manager-install__setting");
        repoSetting.controlEl.addClass("manager-install__repo-control");
        repoSetting.addText((text) => {
            text.setPlaceholder(t("管理器_安装_仓库_占位"));
            text.setValue(this.installRepo);
            text.inputEl.addClass("manager-install__repo-input");
            text.inputEl.setAttribute("spellcheck", "false");
            text.onChange((value) => {
                const nextRepo = sanitizeRepo(value);
                if (nextRepo !== this.getNormalizedInstallRepo()) {
                    this.installVersions = [];
                    this.installVersion = "";
                    resetVersionControls();
                }
                this.installRepo = value;
                installButton?.setDisabled(!this.isValidInstallRepo(nextRepo));
            });
            text.inputEl.addEventListener("blur", () => {
                const nextRepo = this.getNormalizedInstallRepo();
                this.installRepo = nextRepo;
                text.setValue(nextRepo);
                installButton?.setDisabled(!this.isValidInstallRepo(nextRepo));
            });
            text.inputEl.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void fetchVersions();
            });
        });

        const historyItems = this.getInstallHistoryOptions();
        if (historyItems.length > 0) {
            const historyPanel = panel.createDiv("manager-install__history");
            const historyHead = historyPanel.createDiv("manager-install__history-head");
            const historyTitle = historyHead.createDiv("manager-install__history-title");
            const historyIcon = historyTitle.createSpan({ cls: "manager-install__history-title-icon" });
            setIcon(historyIcon, "history");
            historyTitle.createSpan({ text: t("安装_历史_标题") });
            historyTitle.createSpan({ cls: "manager-install__history-count", text: `${historyItems.length}` });
            if (this.getInstallHistory().length > 0) {
                const clearHistoryBtn = historyHead.createEl("button", { cls: "manager-install__history-clear" });
                clearHistoryBtn.type = "button";
                clearHistoryBtn.setAttribute("aria-label", t("安装_历史_清空"));
                clearHistoryBtn.setAttribute("title", t("安装_历史_清空"));
                const clearIcon = clearHistoryBtn.createSpan();
                setIcon(clearIcon, "x");
                clearHistoryBtn.addEventListener("click", () => {
                    void (async () => {
                        if (!(await confirmWithModal(this.app, this.manager, t("安装_历史_清空_确认")))) return;
                        this.manager.settings.INSTALL_HISTORY = [];
                        await this.manager.saveSettings();
                        this.renderContent();
                    })();
                });
            }

            const historyList = historyPanel.createDiv("manager-install__history-list");
            historyList.setAttribute("tabindex", "0");
            historyList.setAttribute("aria-label", t("安装_历史_标题"));
            historyItems.forEach((item) => {
                const historyBtn = historyList.createEl("button", { cls: "manager-install__history-item" });
                historyBtn.type = "button";
                historyBtn.setAttribute("aria-label", t("安装_历史_选择_标签", { repo: item.repo }));
                historyBtn.setAttribute("title", item.repo);
                const itemIcon = historyBtn.createSpan({ cls: "manager-install__history-item-icon" });
                setIcon(itemIcon, item.type === "plugin" ? "blocks" : "palette");
                const textWrap = historyBtn.createSpan({ cls: "manager-install__history-item-text" });
                textWrap.createSpan({ cls: "manager-install__history-item-repo", text: item.repo });
                historyBtn.addEventListener("click", () => {
                    this.installRepo = item.repo;
                    this.installType = item.type;
                    this.installVersion = item.version || "";
                    this.installVersions = [];
                    this.installTrackSource = item.trackSource ?? true;
                    this.renderContent();
                });
            });
        }

        const versionSetting = new Setting(panel)
            .setName(t("管理器_安装_版本_标题"))
            .setDesc(t("管理器_安装_版本_描述"));
        versionSetting.settingEl.addClass("manager-install__setting");
        versionSetting.controlEl.addClass("manager-install__version-control");
        versionSetting.addDropdown((dd) => {
            versionSelectEl = dd.selectEl;
            dd.addOption("", t("管理器_安装_版本_默认最新"));
            this.installVersions.forEach((v) => {
                dd.addOption(v.version, getReleaseOptionLabel(v));
            });
            dd.setValue(this.installVersion);
            dd.onChange((v) => {
                this.installVersion = v;
                if (versionInputEl) versionInputEl.value = v;
                void updateReleaseInfo();
            });
            dd.selectEl.addClass("manager-install__version-select");
        });
        versionSetting.addText((text) => {
            versionInputEl = text.inputEl;
            text.setPlaceholder("tag");
            text.setValue(this.installVersion);
            text.inputEl.addClass("manager-install__version-input");
            text.inputEl.setAttribute("spellcheck", "false");
            text.onChange((value) => {
                this.installVersion = value.trim();
                updateReleaseInfo();
            });
            text.inputEl.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void fetchVersions();
            });
        });
        versionSetting.addButton((btn) => {
            fetchButton = btn;
            btn.setButtonText(t("管理器_安装_版本_获取按钮"));
            btn.onClick(() => { void fetchVersions(); });
        });

        const releaseInfo = panel.createDiv("manager-install__release");
        const releaseInfoHead = releaseInfo.createDiv("manager-install__release-head");
        const releaseInfoIcon = releaseInfoHead.createSpan({ cls: "manager-install__release-icon" });
        setIcon(releaseInfoIcon, "newspaper");
        const releaseInfoText = releaseInfoHead.createDiv("manager-install__release-text");
        releaseEls.title = releaseInfoText.createDiv("manager-install__release-title");
        releaseEls.meta = releaseInfoText.createDiv("manager-install__release-meta");
        releaseEls.body = releaseInfo.createDiv("manager-install__release-body");
        updateReleaseInfo();

        const trackSetting = new Setting(panel)
            .setName(t("来源_跟踪来源_标题"))
            .setDesc(t("来源_跟踪来源_描述"));
        trackSetting.settingEl.addClass("manager-install__setting");
        trackSetting.addToggle((toggle) => {
            toggle.setValue(this.installTrackSource);
            toggle.onChange((value) => {
                this.installTrackSource = value;
            });
        });

        const action = new Setting(panel)
            .setName(t("管理器_安装_操作_标题"))
            .setDesc(`${repoIsValid ? repo : t("管理器_安装_仓库_占位")} · ${typeLabel} · ${versionLabel}`);
        action.settingEl.addClass("manager-install__setting");
        action.settingEl.addClass("manager-install__action");
        action.addButton((btn) => {
            installButton = btn;
            btn.setButtonText(t("管理器_安装_操作_按钮"));
            btn.setCta();
            btn.setDisabled(!repoIsValid);
            btn.onClick(async () => {
                const validRepo = this.requireInstallRepo();
                if (!validRepo) { new Notice(t("管理器_安装_仓库为空提示")); return; }
                btn.setDisabled(true);
                btn.setButtonText(t("管理器_安装_操作_安装中"));
                const ok = this.installType === "plugin"
                    ? await installPluginFromGithub(this.manager, validRepo, this.installVersion)
                    : await installThemeFromGithub(this.manager, validRepo, this.installVersion);
                btn.setDisabled(false);
                if (ok) {
                    this.rememberInstallHistory(validRepo, this.installType, this.installVersion, this.installTrackSource);
                    if (this.installTrackSource) {
                        const pluginId = this.installType === "plugin" ? this.getPluginIdByRepo(validRepo) : validRepo;
                        let selectedRelease = getSelectedRelease();
                        if (!selectedRelease) {
                            try {
                                const updateOptions = this.manager.getPluginUpdateCheckOptions();
                                const versions = await fetchReleaseVersions(this.manager, validRepo, { includeManifest: this.installType === "plugin" });
                                selectedRelease = this.installVersion
                                    ? versions.find((item) => item.version === this.installVersion) ?? null
                                    : this.installType === "plugin"
                                        ? versions.find((item) => item.version === pickSourceTargetRelease({
                                            id: pluginId || validRepo,
                                            repo: validRepo,
                                            type: "plugin",
                                            mode: "latest",
                                            includePrerelease: false,
                                            updateCheckMode: "release",
                                            compatibilityMode: updateOptions.compatibilityMode,
                                            autoUpdate: false,
                                            enabled: true,
                                        }, versions)?.tag) || versions.find((item) => !item.prerelease) || versions[0] || null
                                        : versions.find((item) => !item.prerelease) || versions[0] || null;
                            } catch {
                                selectedRelease = null;
                            }
                        }
                        const installedReleaseTag = this.installVersion || selectedRelease?.version || undefined;
                        const installedReleasePublishedAt = selectedRelease?.publishedAt;
                        const localVersion = this.installType === "plugin" && pluginId
                            ? ((this.appPlugins.manifests[pluginId] as PluginManifest | undefined)?.version || installedReleaseTag)
                            : installedReleaseTag;
                        const nextSource: BetaSource = {
                            id: pluginId || validRepo,
                            repo: validRepo,
                            type: this.installType,
                            mode: this.installVersion ? "frozen" : "latest",
                            frozenVersion: this.installVersion || undefined,
                            includePrerelease: Boolean(selectedRelease?.prerelease),
                            updateCheckMode: "release",
                            compatibilityMode: this.manager.getPluginUpdateCheckOptions().compatibilityMode,
                            autoUpdate: false,
                            enabled: true,
                            localVersion,
                            latestVersion: installedReleaseTag,
                            latestPublishedAt: installedReleasePublishedAt,
                            installedReleaseTag,
                            installedReleasePublishedAt,
                            latestReleaseTag: installedReleaseTag,
                            latestReleasePublishedAt: installedReleasePublishedAt,
                            lastChecked: Date.now(),
                        };
                        nextSource.installedAt = await this.readSourcePackageCreatedAt(nextSource);
                        this.upsertBetaSource(nextSource);
                    }
                    await this.manager.saveSettings();
                    this.activePage = this.installTrackSource ? "sources" : "plugins";
                    this.syncPageChrome();
                    this.renderContent();
                } else {
                    btn.setButtonText(t("管理器_安装_操作_按钮"));
                }
            });
        });
    }

    private async showRibbonPanel(renderGeneration = this.renderGeneration) {
        if (!this.isRibbonManagerEnabled()) {
            this.activePage = "plugins";
            this.installMode = false;
            this.syncPageChrome();
            this.pageEl.empty();
            await this.showData(renderGeneration);
            return;
        }
        this.enterScopePage('ribbon');
        this.pageEl.empty();
        if (!this.ribbonPage) this.ribbonPage = new RibbonModal(this.app, this.manager);
        this.manager.ribbonModal = this.ribbonPage;
        // Ribbon 页顶部是 Ribbon 过滤栏，设备选择放在过滤栏与分组之间。
        this.ribbonPage.setExternalFilterBar(true);
        const overview = this.pageEl.createDiv("manager-overview-heading");
        overview.dataset.page = "ribbon";
        this.ribbonPage.mountFilterBar(overview);
        const scopeHost = this.pageEl.createDiv("manager-ribbon-scope");
        this.renderDeviceScope(scopeHost, 'ribbon');
        const page = this.pageEl.createDiv("manager-ribbon-page ribbon-manager-modal");
        page.createDiv({
            cls: "manager-ribbon-page__loading",
            text: this.manager.translator.t("Ribbon_标题"),
        });
        await this.ribbonPage.syncRibbonItems();
        if (!this.isRenderCurrent(renderGeneration, "ribbon")) return;
        this.ribbonPage.display(page, false);
    }

    private showTroubleshootPanel() {
        this.pageEl.empty();
        if (!this.troubleshootPanel) {
            this.troubleshootPanel = new TroubleshootPanel(this.app, this.manager, () => this.updateStats());
        }
        this.troubleshootPanel.display(this.pageEl);
    }

    private renderTransferCardHeader(card: HTMLElement, icon: string, title: string, desc: string) {
        const header = card.createDiv("manager-transfer-card__header");
        const iconWrap = header.createDiv("manager-transfer-card__icon");
        setIcon(iconWrap, icon);
        const textWrap = header.createDiv("manager-transfer-card__title-group");
        textWrap.createDiv({ cls: "manager-transfer-card__title", text: title });
        textWrap.createDiv({ cls: "manager-transfer-card__desc", text: desc });
    }

    private renderTransferExportHeader(card: HTMLElement) {
        const t = (k: string) => this.manager.translator.t(k);
        const header = card.createDiv("manager-transfer-card__header manager-transfer-card__header--split");
        const main = header.createDiv("manager-transfer-card__header-main");
        const iconWrap = main.createDiv("manager-transfer-card__icon");
        setIcon(iconWrap, "package-open");
        const textWrap = main.createDiv("manager-transfer-card__title-group");
        textWrap.createDiv({ cls: "manager-transfer-card__title", text: t("导入导出_导出标题") });
        textWrap.createDiv({ cls: "manager-transfer-card__desc", text: t("导入导出_导出说明") });

        const downloadBtn = new ButtonComponent(header);
        downloadBtn.setIcon("download");
        downloadBtn.setButtonText(t("导入导出_下载JSON"));
        downloadBtn.setCta();
        downloadBtn.setDisabled(this.transferBusy);
        downloadBtn.onClick(() => { void this.exportTransferPackage("download"); });
    }

    private renderTransferDownloadHeader(card: HTMLElement) {
        const t = (k: string) => this.manager.translator.t(k);
        const header = card.createDiv("manager-transfer-card__header manager-transfer-card__header--split");
        const main = header.createDiv("manager-transfer-card__header-main");
        const iconWrap = main.createDiv("manager-transfer-card__icon");
        setIcon(iconWrap, "download");
        const textWrap = main.createDiv("manager-transfer-card__title-group");
        textWrap.createDiv({ cls: "manager-transfer-card__title", text: t("导入导出_下载清单标题") });
        textWrap.createDiv({ cls: "manager-transfer-card__desc", text: t("导入导出_下载清单说明") });

        const total = this.transferPackage
            ? (this.transferPackage.data.plugins || []).length + (this.transferPackage.data.themes || []).length
            : 0;
        const downloadAllBtn = new ButtonComponent(header);
        downloadAllBtn.setIcon("download");
        downloadAllBtn.setButtonText(t("导入导出_一键下载"));
        downloadAllBtn.setCta();
        downloadAllBtn.setDisabled(this.transferBusy || total === 0);
        downloadAllBtn.onClick(() => { void this.downloadAllTransferItems(); });
    }

    private renderTransferMetric(container: HTMLElement, icon: string, label: string, value: string | number, tone?: string, summaryKey?: string): HTMLElement {
        const metric = container.createDiv(`manager-transfer-metric${tone ? ` ${tone}` : ""}`);
        const iconEl = metric.createSpan({ cls: "manager-transfer-metric__icon" });
        setIcon(iconEl, icon);
        const text = metric.createSpan({ cls: "manager-transfer-metric__text" });
        text.createSpan({ cls: "manager-transfer-metric__label", text: label });
        const valueEl = text.createSpan({ cls: "manager-transfer-metric__value", text: `${value}` });
        if (summaryKey) valueEl.setAttribute("data-transfer-summary-value", summaryKey);
        return metric;
    }

    private renderTransferBuildToggle(container: HTMLElement, key: "plugins" | "themes" | "pluginConfigs" | "taxonomy" | "layout" | "sources" | "workspaceSettings", icon: string, label: string, desc: string) {
        const option = container.createDiv("manager-transfer-option");
        const text = option.createDiv("manager-transfer-option__text");
        const title = text.createDiv("manager-transfer-option__title");
        const iconEl = title.createSpan({ cls: "manager-transfer-option__icon" });
        setIcon(iconEl, icon);
        title.createSpan({ text: label });
        text.createDiv({ cls: "manager-transfer-option__desc", text: desc });
        const control = option.createDiv("manager-transfer-option__control");
        const toggle = new ToggleComponent(control);
        toggle.setValue(Boolean(this.transferBuildOptions[key]));
        toggle.toggleEl.setAttribute("aria-label", label);
        toggle.onChange((value) => {
            this.transferBuildOptions[key] = value;
        });
    }

    private renderTransferImportToggle(container: HTMLElement, key: keyof Omit<ManagerTransferImportOptions, "installVersionStrategy" | "selectedPluginConfigIds">, icon: string, label: string, desc: string) {
        const option = container.createDiv("manager-transfer-option");
        const text = option.createDiv("manager-transfer-option__text");
        const title = text.createDiv("manager-transfer-option__title");
        const iconEl = title.createSpan({ cls: "manager-transfer-option__icon" });
        setIcon(iconEl, icon);
        title.createSpan({ text: label });
        text.createDiv({ cls: "manager-transfer-option__desc", text: desc });
        const control = option.createDiv("manager-transfer-option__control");
        const toggle = new ToggleComponent(control);
        toggle.setValue(Boolean(this.transferImportOptions[key]));
        toggle.toggleEl.setAttribute("aria-label", label);
        toggle.onChange((value) => {
            this.transferImportOptions[key] = value;
        });
    }

    private getTransferPluginItems(): PluginManifest[] {
        return Object.values(this.appPlugins.manifests || {})
            .filter((plugin) => plugin.id !== this.manager.manifest.id)
            .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    }

    private async getTransferPluginConfigItems(
        plugins: PluginManifest[]
    ): Promise<Array<{ id: string; name: string; meta: string }>> {
        const adapter = this.app.vault.adapter;
        const items: Array<{ id: string; name: string; meta: string }> = [];
        for (const plugin of plugins) {
            const path = normalizePath(`${this.app.vault.configDir}/plugins/${plugin.id}/data.json`);
            try {
                if (!(await adapter.exists(path))) continue;
                items.push({
                    id: plugin.id,
                    name: plugin.name || plugin.id,
                    meta: `${plugin.id} · data.json`,
                });
            } catch {
                // A single unreadable plugin folder should not block the export page.
            }
        }
        return items.sort((a, b) => a.name.localeCompare(b.name));
    }

    private async getTransferThemeItems(): Promise<ManagerTransferTheme[]> {
        return collectInstalledThemes(this.manager, undefined, false);
    }

    private ensureTransferSelections(
        plugins: PluginManifest[],
        themes: ManagerTransferTheme[],
        pluginConfigs: Array<{ id: string }>
    ) {
        const pluginIds = new Set(plugins.map((plugin) => plugin.id));
        const themeNames = new Set(themes.map((theme) => theme.name));
        const pluginConfigIds = new Set(pluginConfigs.map((config) => config.id));

        if (!this.transferSelectionInitialized) {
            this.transferSelectedPluginIds = new Set(pluginIds);
            this.transferSelectedThemeNames = new Set(themeNames);
            this.transferSelectedPluginConfigIds = new Set();
            this.transferSelectionInitialized = true;
            return;
        }

        this.transferSelectedPluginIds = new Set([...this.transferSelectedPluginIds].filter((id) => pluginIds.has(id)));
        this.transferSelectedThemeNames = new Set([...this.transferSelectedThemeNames].filter((name) => themeNames.has(name)));
        this.transferSelectedPluginConfigIds = new Set([...this.transferSelectedPluginConfigIds].filter((id) => pluginConfigIds.has(id)));
    }

    private createSelectedTransferBuildOptions(): ManagerTransferBuildOptions {
        const selectedPluginIds = [...this.transferSelectedPluginIds];
        const selectedThemeNames = [...this.transferSelectedThemeNames];
        const selectedPluginConfigIds = [...this.transferSelectedPluginConfigIds];
        return {
            ...DEFAULT_TRANSFER_BUILD_OPTIONS,
            plugins: selectedPluginIds.length > 0,
            themes: selectedThemeNames.length > 0,
            pluginConfigs: selectedPluginConfigIds.length > 0,
            taxonomy: false,
            layout: false,
            sources: false,
            workspaceSettings: false,
            selectedPluginIds,
            selectedThemeNames,
            selectedPluginConfigIds,
        };
    }

    private updateTransferSelectionSummary() {
        const setValue = (key: string, value: number) => {
            const el = this.pageEl.querySelector<HTMLElement>(`[data-transfer-summary-value="${key}"]`);
            if (el) el.setText(`${value}`);
        };
        setValue("selected-plugins", this.transferSelectedPluginIds.size);
        setValue("selected-themes", this.transferSelectedThemeNames.size);
        setValue("selected-configs", this.transferSelectedPluginConfigIds.size);
    }

    private renderTransferSelectionList(
        container: HTMLElement,
        title: string,
        icon: string,
        emptyText: string,
        items: Array<{ id: string; name: string; meta: string; icon: string; type: string; selected: boolean; configAvailable?: boolean; configSelected?: boolean; configLabel?: string }>,
        onChange: (id: string, selected: boolean) => void,
        onSelectAll: (selected: boolean) => void,
        onConfigChange?: (id: string, selected: boolean) => void,
        onConfigSelectAll?: (selected: boolean) => void
    ) {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const panel = container.createDiv("manager-transfer-list");
        const header = panel.createDiv("manager-transfer-list__header");
        const titleWrap = header.createDiv("manager-transfer-list__title");
        const titleIcon = titleWrap.createSpan({ cls: "manager-transfer-list__icon" });
        setIcon(titleIcon, icon);
        titleWrap.createSpan({ text: title });
        const actions = header.createDiv("manager-transfer-list__actions");
        const totalCount = items.length + items.filter((item) => item.configAvailable).length;
        const getSelectedCount = () => items.filter((item) => item.selected).length
            + items.filter((item) => item.configAvailable && item.configSelected).length;
        const countEl = actions.createSpan({
            cls: "manager-transfer-list__count",
            text: t("导入导出_已选数量", { selected: getSelectedCount(), total: totalCount }),
        });
        const updateSelectionChrome = () => {
            const selectedCount = getSelectedCount();
            const allSelected = totalCount > 0 && selectedCount === totalCount;
            countEl.setText(t("导入导出_已选数量", { selected: selectedCount, total: totalCount }));
            toggleAll.setText(allSelected ? t("导入导出_取消全选") : t("导入导出_全选"));
            this.updateTransferSelectionSummary();
        };
        const toggleAll = actions.createEl("button", {
            cls: "manager-transfer-list__toggle-all",
            text: totalCount > 0 && getSelectedCount() === totalCount ? t("导入导出_取消全选") : t("导入导出_全选"),
        });
        toggleAll.type = "button";
        toggleAll.disabled = this.transferBusy || items.length === 0;

        const body = panel.createDiv("manager-transfer-list__body");
        toggleAll.addEventListener("click", () => {
            const nextSelected = !(totalCount > 0 && getSelectedCount() === totalCount);
            onSelectAll(nextSelected);
            onConfigSelectAll?.(nextSelected);
            items.forEach((item) => {
                item.selected = nextSelected;
                if (item.configAvailable) item.configSelected = nextSelected;
            });
            body.querySelectorAll<HTMLInputElement>(".manager-transfer-list__checkbox, .manager-transfer-list__config-checkbox")
                .forEach((input) => {
                    input.checked = nextSelected;
                });
            updateSelectionChrome();
        });
        if (items.length === 0) {
            body.createDiv({ cls: "manager-transfer-list__empty", text: emptyText });
            return;
        }

        items.forEach((item) => {
            const row = body.createDiv("manager-transfer-list__item");
            const primary = row.createEl("label", { cls: "manager-transfer-list__primary" });
            const checkbox = primary.createEl("input", { type: "checkbox", cls: "manager-transfer-list__checkbox" });
            checkbox.checked = item.selected;
            checkbox.disabled = this.transferBusy;
            checkbox.addEventListener("change", () => {
                item.selected = checkbox.checked;
                onChange(item.id, checkbox.checked);
                updateSelectionChrome();
            });

            const itemIcon = primary.createSpan({ cls: "manager-transfer-list__item-icon" });
            setIcon(itemIcon, item.icon);
            const text = primary.createSpan({ cls: "manager-transfer-list__text" });
            text.createSpan({ cls: "manager-transfer-list__name", text: item.name });
            text.createSpan({ cls: "manager-transfer-list__meta", text: `${item.type} · ${item.meta}` });

            if (item.configAvailable && onConfigChange) {
                const config = row.createEl("label", { cls: "manager-transfer-list__config" });
                const configCheckbox = config.createEl("input", { type: "checkbox", cls: "manager-transfer-list__config-checkbox" });
                configCheckbox.checked = Boolean(item.configSelected);
                configCheckbox.disabled = this.transferBusy;
                const configIcon = config.createSpan({ cls: "manager-transfer-list__config-icon" });
                setIcon(configIcon, "file-cog");
                config.createSpan({ cls: "manager-transfer-list__config-text", text: item.configLabel || t("导入导出_配置短标签") });
                configCheckbox.addEventListener("change", () => {
                    item.configSelected = configCheckbox.checked;
                    onConfigChange(item.id, configCheckbox.checked);
                    updateSelectionChrome();
                });
            }
        });
    }

    private createTransferFilename(): string {
        const pad = (value: number) => `${value}`.padStart(2, "0");
        const d = new Date();
        const stamp = [
            d.getFullYear(),
            pad(d.getMonth() + 1),
            pad(d.getDate()),
            "-",
            pad(d.getHours()),
            pad(d.getMinutes()),
            pad(d.getSeconds()),
        ].join("");
        return `obsidian-plugin-pack-${stamp}.json`;
    }

    private downloadTextFile(filename: string, text: string) {
        const blob = new Blob([text], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = activeDocument.createElement("a");
        link.href = url;
        link.download = filename;
        activeDocument.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    private async writeTransferPackageToVault(filename: string, text: string): Promise<string> {
        const adapter = this.app.vault.adapter;
        const folder = "Obsidian-Plugin-Exports";
        if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
        const path = normalizePath(`${folder}/${filename}`);
        await adapter.write(path, text);
        return path;
    }

    private async exportTransferPackage(mode: "download" | "vault") {
        if (this.transferBusy) return;
        const selectedOptions = this.createSelectedTransferBuildOptions();
        if (
            (selectedOptions.selectedPluginIds || []).length
            + (selectedOptions.selectedThemeNames || []).length
            + (selectedOptions.selectedPluginConfigIds || []).length === 0
        ) {
            new Notice(this.manager.translator.t("导入导出_未选择导出项"));
            return;
        }
        this.transferBusy = true;
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const progress = this.showInlineProgress(t("导入导出_生成中"), t("导入导出_生成准备"));
        try {
            const transferPackage = await buildManagerTransferPackage(this.manager, selectedOptions, (processed, total, current) => {
                progress.update(processed, total, current);
            });
            const filename = this.createTransferFilename();
            const text = JSON.stringify(transferPackage, null, 2);
            if (mode === "download") {
                this.downloadTextFile(filename, text);
                new Notice(t("导入导出_已下载", { name: filename }));
            } else {
                const path = await this.writeTransferPackageToVault(filename, text);
                new Notice(t("导入导出_已保存", { path }));
            }
        } catch (error) {
            console.error("[BPM] export transfer package failed", error);
            new Notice(t("导入导出_导出失败"));
        } finally {
            progress.hide();
            this.transferBusy = false;
            this.renderContent();
        }
    }

    private async loadTransferFile(file: File) {
        const t = (k: string) => this.manager.translator.t(k);
        try {
            const raw = await file.text();
            const transferPackage = parseManagerTransferPackage(raw);
            this.transferPackage = transferPackage;
            this.transferPreview = await createManagerTransferPreview(this.manager, transferPackage);
            this.transferImportResult = undefined;
            this.transferFileName = file.name;
            this.renderContent();
        } catch (error) {
            console.error("[BPM] import transfer package parse failed", error);
            new Notice(t("导入导出_文件无效"));
        }
    }

    private normalizeTransferRepo(input?: string): string {
        const repo = sanitizeRepo(input || "");
        if (!repo || repo.includes(":")) return "";
        return repo.includes("/") ? repo : "";
    }

    private async resolveTransferPluginRepo(plugin: ManagerTransferPackage["data"]["plugins"][number]): Promise<string> {
        const repo = this.normalizeTransferRepo(plugin.repo || plugin.downloadUrl);
        if (repo && repo.includes("/")) return repo;
        try {
            return this.normalizeTransferRepo(await this.manager.repoResolver.resolveRepo(plugin.id) || "");
        } catch {
            return "";
        }
    }

    private resolveTransferThemeRepo(theme: ManagerTransferTheme): string {
        return this.normalizeTransferRepo(theme.repo || theme.downloadUrl);
    }

    private isTransferPluginSameLocalVersion(plugin: ManagerTransferPackage["data"]["plugins"][number]): boolean {
        const localVersion = (this.appPlugins.manifests?.[plugin.id] as PluginManifest | undefined)?.version?.trim();
        const packageVersion = plugin.version?.trim();
        return Boolean(localVersion && packageVersion && localVersion === packageVersion);
    }

    private createEmptyTransferResult(): ManagerTransferImportResult {
        return {
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
    }

    private async downloadTransferPlugin(plugin: ManagerTransferPackage["data"]["plugins"][number], result: ManagerTransferImportResult) {
        const repo = await this.resolveTransferPluginRepo(plugin);
        if (!repo) {
            result.failedPlugins.push({
                id: plugin.id,
                name: plugin.name || plugin.id,
                reason: this.manager.translator.t("导入导出_缺少下载来源"),
            });
            return;
        }

        const wasInstalled = Boolean(this.appPlugins.manifests?.[plugin.id]);
        const ok = await installPluginFromGithub(this.manager, repo, undefined, false);
        await this.appPlugins.loadManifests();
        this.invalidatePluginCaches();
        if (ok && this.appPlugins.manifests?.[plugin.id]) {
            if (wasInstalled) {
                result.updatedPlugins++;
            } else {
                result.installedPlugins++;
            }
            return;
        }

        result.failedPlugins.push({
            id: plugin.id,
            name: plugin.name || plugin.id,
            reason: this.manager.translator.t("导入导出_下载失败"),
        });
    }

    private async downloadTransferTheme(theme: ManagerTransferTheme, result: ManagerTransferImportResult) {
        const repo = this.resolveTransferThemeRepo(theme);
        if (!repo) {
            result.failedThemes.push({
                id: theme.name,
                name: theme.name,
                reason: this.manager.translator.t("导入导出_缺少下载来源"),
            });
            return;
        }

        const installedBefore = await collectInstalledThemes(this.manager, undefined, false);
        const wasInstalled = installedBefore.some((item) => item.name === theme.name);
        const ok = await installThemeFromGithub(this.manager, repo);
        if (ok) {
            if (wasInstalled) {
                result.updatedThemes++;
            } else {
                result.installedThemes++;
            }
            return;
        }

        result.failedThemes.push({
            id: theme.name,
            name: theme.name,
            reason: this.manager.translator.t("导入导出_下载失败"),
        });
    }

    private async downloadSingleTransferItem(kind: "plugin" | "theme", index: number) {
        if (!this.transferPackage || this.transferBusy) return;
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const result = this.createEmptyTransferResult();
        this.transferBusy = true;
        const itemName = kind === "plugin"
            ? this.transferPackage.data.plugins[index]?.name || this.transferPackage.data.plugins[index]?.id
            : this.transferPackage.data.themes[index]?.name;
        const progress = this.showInlineProgress(t("导入导出_下载中"), itemName);
        progress.update(0, 1, itemName);
        try {
            if (kind === "plugin") {
                const plugin = this.transferPackage.data.plugins[index];
                if (plugin) await this.downloadTransferPlugin(plugin, result);
            } else {
                const theme = this.transferPackage.data.themes[index];
                if (theme) await this.downloadTransferTheme(theme, result);
            }
            progress.update(1, 1, itemName);
            this.transferImportResult = result;
            this.transferPreview = await createManagerTransferPreview(this.manager, this.transferPackage);
            this.updateStats();
            new Notice(t(result.failedPlugins.length + result.failedThemes.length > 0 ? "导入导出_下载失败" : "导入导出_下载完成"));
        } catch (error) {
            console.error("[BPM] transfer item download failed", error);
            new Notice(t("导入导出_下载失败"));
        } finally {
            progress.hide();
            this.transferBusy = false;
            this.renderContent();
        }
    }

    private async downloadAllTransferItems() {
        if (!this.transferPackage || this.transferBusy) return;
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const plugins = this.transferPackage.data.plugins || [];
        const themes = this.transferPackage.data.themes || [];
        const total = plugins.length + themes.length;
        if (total === 0) return;

        const result = this.createEmptyTransferResult();
        this.transferBusy = true;
        const progress = this.showInlineProgress(t("导入导出_下载中"), this.transferFileName);
        let processed = 0;
        try {
            for (const plugin of plugins) {
                progress.update(processed, total, plugin.name || plugin.id);
                if (this.isTransferPluginSameLocalVersion(plugin)) {
                    result.skippedPlugins++;
                } else {
                    await this.downloadTransferPlugin(plugin, result);
                }
                processed++;
            }
            for (const theme of themes) {
                progress.update(processed, total, theme.name);
                await this.downloadTransferTheme(theme, result);
                processed++;
            }
            progress.update(processed, total);
            this.transferImportResult = result;
            this.transferPreview = await createManagerTransferPreview(this.manager, this.transferPackage);
            this.updateStats();
            new Notice(t(result.failedPlugins.length + result.failedThemes.length > 0 ? "导入导出_下载部分失败" : "导入导出_下载完成"));
        } catch (error) {
            console.error("[BPM] transfer batch download failed", error);
            new Notice(t("导入导出_下载失败"));
        } finally {
            progress.hide();
            this.transferBusy = false;
            this.renderContent();
        }
    }

    private renderTransferDownloadGroup(
        container: HTMLElement,
        title: string,
        icon: string,
        emptyText: string,
        items: Array<{ name: string; meta: string; icon: string; type: string; canDownload: boolean; onDownload: () => void; actionText?: string; statusText?: string; secondaryText?: string; canSecondary?: boolean; onSecondary?: () => void }>
    ) {
        const t = (k: string) => this.manager.translator.t(k);
        const panel = container.createDiv("manager-transfer-list manager-transfer-download-list");
        const header = panel.createDiv("manager-transfer-list__header");
        const titleWrap = header.createDiv("manager-transfer-list__title");
        const titleIcon = titleWrap.createSpan({ cls: "manager-transfer-list__icon" });
        setIcon(titleIcon, icon);
        titleWrap.createSpan({ text: title });
        header.createSpan({ cls: "manager-transfer-list__count", text: `${items.length}` });

        const body = panel.createDiv("manager-transfer-list__body");
        if (items.length === 0) {
            body.createDiv({ cls: "manager-transfer-list__empty", text: emptyText });
            return;
        }

        items.forEach((item) => {
            const row = body.createDiv("manager-transfer-download__item");
            const itemIcon = row.createSpan({ cls: "manager-transfer-list__item-icon" });
            setIcon(itemIcon, item.icon);
            const text = row.createSpan({ cls: "manager-transfer-list__text" });
            text.createSpan({ cls: "manager-transfer-list__name", text: item.name });
            text.createSpan({ cls: "manager-transfer-list__meta", text: `${item.type} · ${item.meta}` });
            const actions = row.createSpan({ cls: "manager-transfer-download__actions" });
            if (item.statusText) {
                actions.createSpan({ cls: "manager-transfer-download__status", text: item.statusText });
            } else {
                const button = actions.createEl("button", { cls: "manager-transfer-download__button", text: item.actionText || t("导入导出_下载按钮") });
                button.type = "button";
                button.disabled = this.transferBusy || !item.canDownload;
                button.addEventListener("click", () => {
                    item.onDownload();
                });
            }
            if (item.onSecondary) {
                const secondary = actions.createEl("button", { cls: "manager-transfer-download__button manager-transfer-download__button--secondary", text: item.secondaryText || t("导入导出_配置短标签") });
                secondary.type = "button";
                secondary.disabled = this.transferBusy || !item.canSecondary;
                secondary.addEventListener("click", () => {
                    item.onSecondary?.();
                });
            }
        });
    }

    private renderTransferImportDownloadList(container: HTMLElement) {
        if (!this.transferPackage) return;
        const t = (k: string) => this.manager.translator.t(k);
        const wrap = container.createDiv("manager-transfer-selection-grid manager-transfer-download-grid");
        const configs = this.transferPackage.data.pluginConfigs || [];
        const configByPluginId = new Map(configs.map((config) => [config.id, config]));
        const pluginIds = new Set((this.transferPackage.data.plugins || []).map((plugin) => plugin.id));
        const pluginItems = (this.transferPackage.data.plugins || []).map((plugin, index) => {
            const sameLocalVersion = this.isTransferPluginSameLocalVersion(plugin);
            return {
                name: plugin.name || plugin.id,
                meta: `${plugin.id}${plugin.version ? ` · v${plugin.version}` : ""}`,
                icon: "blocks",
                type: t("导入导出_类型_插件"),
                canDownload: !sameLocalVersion && Boolean(plugin.id || plugin.repo || plugin.downloadUrl),
                onDownload: () => { void this.downloadSingleTransferItem("plugin", index); },
                statusText: sameLocalVersion ? t("导入导出_已是当前版本") : undefined,
                secondaryText: configByPluginId.has(plugin.id) ? t("导入导出_配置短标签") : undefined,
                canSecondary: configByPluginId.has(plugin.id),
                onSecondary: configByPluginId.has(plugin.id) ? () => { void this.importTransferPluginConfigs([plugin.id]); } : undefined,
            };
        });
        const themeItems = (this.transferPackage.data.themes || []).map((theme, index) => ({
                name: theme.name,
                meta: `${theme.version ? `v${theme.version}` : t("导入导出_主题无版本")}${theme.active ? ` · ${t("导入导出_当前主题")}` : ""}`,
                icon: "palette",
                type: t("导入导出_类型_主题"),
                canDownload: Boolean(this.resolveTransferThemeRepo(theme)),
                onDownload: () => { void this.downloadSingleTransferItem("theme", index); },
        }));
        const configOnlyItems = configs
            .filter((config) => !pluginIds.has(config.id))
            .map((config) => ({
                name: config.name || config.id,
                meta: `${config.id} · ${config.path}`,
                icon: "file-cog",
                type: t("导入导出_类型_配置"),
                canDownload: true,
                actionText: t("导入导出_导入配置"),
                onDownload: () => { void this.importTransferPluginConfigs([config.id]); },
            }));
        this.renderTransferDownloadGroup(
            wrap,
            t("导入导出_下载列表"),
            "download",
            t("导入导出_无下载项"),
            [...pluginItems, ...themeItems, ...configOnlyItems]
        );
    }

    private renderTransferResult(container: HTMLElement) {
        if (!this.transferImportResult) return;
        const t = (k: string) => this.manager.translator.t(k);
        const result = this.transferImportResult;
        const card = container.createDiv("manager-transfer-result");
        const title = card.createDiv("manager-transfer-result__title");
        const icon = title.createSpan({ cls: "manager-transfer-result__icon" });
        setIcon(icon, "check-check");
        title.createSpan({ text: t("导入导出_导入结果") });
        const metrics = card.createDiv("manager-transfer-result__metrics");
        this.renderTransferMetric(metrics, "download", t("导入导出_结果_已安装插件"), result.installedPlugins);
        this.renderTransferMetric(metrics, "blocks", t("导入导出_结果_已更新插件"), result.updatedPlugins);
        this.renderTransferMetric(metrics, "file-cog", t("导入导出_结果_配置文件"), result.appliedPluginConfigs);
        this.renderTransferMetric(metrics, "palette", t("导入导出_结果_已安装主题"), result.installedThemes);
        this.renderTransferMetric(metrics, "radio-tower", t("导入导出_结果_来源"), result.sourcesMerged ? t("通用_完成_文本") : t("通用_跳过_文本"));
        const failures = [...result.failedPlugins, ...result.failedThemes, ...result.failedPluginConfigs];
        if (failures.length > 0) {
            const list = card.createDiv("manager-transfer-result__failures");
            failures.slice(0, 8).forEach((failure) => {
                const item = list.createDiv("manager-transfer-result__failure");
                item.createSpan({ cls: "manager-transfer-result__failure-name", text: failure.name || failure.id });
                item.createSpan({ cls: "manager-transfer-result__failure-reason", text: failure.reason });
            });
        }
    }

    private renderTransferVersionStrategy(container: HTMLElement) {
        const t = (k: string) => this.manager.translator.t(k);
        const row = container.createDiv("manager-transfer-strategy");
        row.createDiv({ cls: "manager-transfer-strategy__label", text: t("导入导出_版本策略") });
        const controls = row.createDiv("manager-transfer-strategy__controls");
        controls.setAttribute("role", "tablist");
        controls.setAttribute("data-slot", "tabs-list");
        const createButton = (strategy: "latest" | "package", icon: string, label: string) => {
            const button = controls.createEl("button", { cls: "manager-transfer-segment" });
            const selected = this.transferImportOptions.installVersionStrategy === strategy;
            button.type = "button";
            button.setAttribute("role", "tab");
            button.setAttribute("data-slot", "tabs-trigger");
            button.toggleClass("is-active", selected);
            button.setAttribute("aria-pressed", `${selected}`);
            button.setAttribute("aria-selected", `${selected}`);
            button.setAttribute("data-state", selected ? "active" : "inactive");
            const iconEl = button.createSpan({ cls: "manager-transfer-segment__icon" });
            setIcon(iconEl, icon);
            button.createSpan({ text: label });
            button.addEventListener("click", () => {
                this.transferImportOptions.installVersionStrategy = strategy;
                this.renderContent();
            });
        };
        createButton("latest", "sparkles", t("导入导出_版本策略_最新"));
        createButton("package", "package-check", t("导入导出_版本策略_配置包"));
    }

    private async runTransferImport() {
        if (!this.transferPackage || this.transferBusy) return;
        this.transferBusy = true;
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const progress = this.showInlineProgress(t("导入导出_导入中"), this.transferFileName);
        try {
            const result = await applyManagerTransferPackage(this.manager, this.transferPackage, this.transferImportOptions, (processed, total, current) => {
                progress.update(processed, total, current);
            });
            this.transferImportResult = result;
            this.transferPreview = await createManagerTransferPreview(this.manager, this.transferPackage);
            this.updateStats();
            new Notice(t("导入导出_导入完成"));
        } catch (error) {
            console.error("[BPM] import transfer package failed", error);
            new Notice(t("导入导出_导入失败"));
        } finally {
            progress.hide();
            this.transferBusy = false;
            this.renderContent();
        }
    }

    private async importTransferPluginConfigs(configIds: string[]) {
        if (!this.transferPackage || this.transferBusy) return;
        const selectedPluginConfigIds = [...new Set(configIds)];
        if (selectedPluginConfigIds.length === 0) {
            new Notice(this.manager.translator.t("导入导出_未选择配置文件"));
            return;
        }

        this.transferBusy = true;
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const progress = this.showInlineProgress(t("导入导出_导入配置中"), this.transferFileName);
        const configOnlyPackage: ManagerTransferPackage = {
            ...this.transferPackage,
            data: {
                ...this.transferPackage.data,
                plugins: [],
                themes: [],
            },
        };

        try {
            const result = await applyManagerTransferPackage(this.manager, configOnlyPackage, {
                ...DEFAULT_TRANSFER_IMPORT_OPTIONS,
                applyPluginConfigs: true,
                selectedPluginConfigIds,
            }, (processed, total, current) => {
                progress.update(processed, total, current);
            });
            this.transferImportResult = result;
            this.transferPreview = await createManagerTransferPreview(this.manager, this.transferPackage);
            this.updateStats();
            new Notice(t("导入导出_导入配置完成", { count: result.appliedPluginConfigs }));
        } catch (error) {
            console.error("[BPM] import transfer plugin configs failed", error);
            new Notice(t("导入导出_导入失败"));
        } finally {
            progress.hide();
            this.transferBusy = false;
            this.renderContent();
        }
    }

    private async showTransferPanel(renderGeneration = this.renderGeneration) {
        this.pageEl.empty();
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const page = this.pageEl.createDiv("manager-transfer");
        const plugins = this.getTransferPluginItems();
        const themes = await this.getTransferThemeItems();
        const pluginConfigs = await this.getTransferPluginConfigItems(plugins);
        if (!this.isRenderCurrent(renderGeneration, "transfer")) return;
        this.ensureTransferSelections(plugins, themes, pluginConfigs);

        const importCard = page.createDiv("manager-transfer-card manager-transfer-import-card");
        this.renderTransferCardHeader(importCard, "archive-restore", t("导入导出_导入标题"), t("导入导出_导入说明"));
        const fileInput = importCard.createEl("input", { type: "file", cls: "manager-transfer-file-input" });
        fileInput.accept = ".json,application/json";
        fileInput.addEventListener("change", () => {
            const file = fileInput.files?.[0];
            if (file) void this.loadTransferFile(file);
            fileInput.value = "";
        });
        const dropzone = importCard.createDiv("manager-transfer-dropzone manager-transfer-dropzone--compact");
        dropzone.setAttribute("role", "button");
        dropzone.setAttribute("tabindex", "0");
        dropzone.setAttribute("aria-label", t("导入导出_选择文件"));
        const dropIcon = dropzone.createDiv("manager-transfer-dropzone__icon");
        setIcon(dropIcon, "file-up");
        dropzone.createDiv({ cls: "manager-transfer-dropzone__title", text: t("导入导出_选择文件") });
        dropzone.createDiv({ cls: "manager-transfer-dropzone__desc", text: t("导入导出_选择文件说明") });
        dropzone.addEventListener("click", () => fileInput.click());
        dropzone.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            fileInput.click();
        });
        dropzone.addEventListener("dragover", (event) => {
            event.preventDefault();
            dropzone.addClass("is-dragover");
        });
        dropzone.addEventListener("dragleave", () => dropzone.removeClass("is-dragover"));
        dropzone.addEventListener("drop", (event) => {
            event.preventDefault();
            dropzone.removeClass("is-dragover");
            const file = event.dataTransfer?.files?.[0];
            if (file) void this.loadTransferFile(file);
        });

        const summary = page.createDiv("manager-transfer-summary");
        this.renderTransferMetric(summary, "blocks", t("导入导出_本机插件"), Math.max(0, Object.keys(this.appPlugins.manifests || {}).length - 1));
        this.renderTransferMetric(summary, "palette", t("导入导出_本机主题"), themes.length);
        this.renderTransferMetric(summary, "file-cog", t("导入导出_本机配置"), pluginConfigs.length);
        this.renderTransferMetric(summary, "check-check", t("导入导出_已选插件"), this.transferSelectedPluginIds.size, undefined, "selected-plugins");
        this.renderTransferMetric(summary, "badge-check", t("导入导出_已选主题"), this.transferSelectedThemeNames.size, undefined, "selected-themes");
        this.renderTransferMetric(summary, "file-check-2", t("导入导出_已选配置"), this.transferSelectedPluginConfigIds.size, undefined, "selected-configs");

        const grid = page.createDiv("manager-transfer-workspace");

        const exportCard = grid.createDiv("manager-transfer-card");
        this.renderTransferExportHeader(exportCard);
        const selectionGrid = exportCard.createDiv("manager-transfer-selection-grid");
        const pluginSelectionItems = plugins.map((plugin) => ({
            id: plugin.id,
            name: plugin.name || plugin.id,
            meta: `${plugin.id}${plugin.version ? ` · v${plugin.version}` : ""}`,
            icon: "blocks",
            type: t("导入导出_类型_插件"),
            selected: this.transferSelectedPluginIds.has(plugin.id),
            configAvailable: pluginConfigs.some((config) => config.id === plugin.id),
            configSelected: this.transferSelectedPluginConfigIds.has(plugin.id),
            configLabel: t("导入导出_配置短标签"),
        }));
        const themeSelectionItems = themes.map((theme) => ({
            id: theme.name,
            name: theme.name,
            meta: `${theme.version ? `v${theme.version}` : t("导入导出_主题无版本")}${theme.active ? ` · ${t("导入导出_当前主题")}` : ""}`,
            icon: "palette",
            type: t("导入导出_类型_主题"),
            selected: this.transferSelectedThemeNames.has(theme.name),
        }));
        this.renderTransferSelectionList(
            selectionGrid,
            t("导入导出_导出列表"),
            "package-open",
            t("导入导出_无导出项"),
            [...pluginSelectionItems, ...themeSelectionItems],
            (id, selected) => {
                if (plugins.some((plugin) => plugin.id === id)) {
                    if (selected) {
                        this.transferSelectedPluginIds.add(id);
                    } else {
                        this.transferSelectedPluginIds.delete(id);
                    }
                } else {
                    if (selected) {
                        this.transferSelectedThemeNames.add(id);
                    } else {
                        this.transferSelectedThemeNames.delete(id);
                    }
                }
            },
            (selected) => {
                this.transferSelectedPluginIds = selected ? new Set(plugins.map((plugin) => plugin.id)) : new Set();
                this.transferSelectedThemeNames = selected ? new Set(themes.map((theme) => theme.name)) : new Set();
            },
            (id, selected) => {
                if (selected) {
                    this.transferSelectedPluginConfigIds.add(id);
                } else {
                    this.transferSelectedPluginConfigIds.delete(id);
                }
            },
            (selected) => {
                this.transferSelectedPluginConfigIds = selected ? new Set(pluginConfigs.map((config) => config.id)) : new Set();
            }
        );

        const packageCard = grid.createDiv("manager-transfer-card manager-transfer-package-card");
        this.renderTransferDownloadHeader(packageCard);
        if (this.transferPackage) {
            this.renderTransferImportDownloadList(packageCard);
        } else {
            const emptyWrap = packageCard.createDiv("manager-transfer-selection-grid manager-transfer-download-grid");
            this.renderTransferDownloadGroup(
                emptyWrap,
                t("导入导出_下载列表"),
                "download",
                t("导入导出_未载入插件包"),
                []
            );
        }

        this.renderTransferResult(page);
    }

    private getVaultRoleLabel(role: SharedVaultRole): string {
        const t = (k: string) => this.manager.translator.t(k);
        switch (role) {
            case "main": return t("共享库_角色_主库");
            case "linked": return t("共享库_角色_软链接库");
            case "mixed": return t("共享库_角色_部分链接");
            case "missing": return t("共享库_角色_路径失效");
            default: return t("共享库_角色_本地库");
        }
    }

    private getVaultFolderLabel(status: SharedVaultFolderStatus): string {
        const t = (k: string) => this.manager.translator.t(k);
        if (!status.exists) return t("共享库_状态_不存在");
        if (status.isSymlink) return t("共享库_状态_已链接");
        return t("共享库_状态_本地文件夹");
    }

    private renderVaultMetric(container: HTMLElement, iconName: string, label: string, value: string | number) {
        const item = container.createDiv("manager-vault-metric");
        const icon = item.createSpan({ cls: "manager-vault-metric__icon" });
        setIcon(icon, iconName);
        const text = item.createDiv("manager-vault-metric__text");
        text.createSpan({ cls: "manager-vault-metric__label", text: label });
        text.createSpan({ cls: "manager-vault-metric__value", text: `${value}` });
    }

    private renderVaultFolderPill(container: HTMLElement, status: SharedVaultFolderStatus) {
        const kindLabel = status.kind === "plugins"
            ? this.manager.translator.t("共享库_文件夹_插件")
            : this.manager.translator.t("共享库_文件夹_主题");
        const pill = container.createSpan({ cls: "manager-vault-folder-pill" });
        pill.toggleClass("is-linked", status.isSymlink);
        pill.toggleClass("is-missing", !status.exists);
        const icon = pill.createSpan({ cls: "manager-vault-folder-pill__icon" });
        setIcon(icon, status.kind === "plugins" ? "blocks" : "palette");
        pill.createSpan({ cls: "manager-vault-folder-pill__label", text: kindLabel });
        pill.createSpan({ cls: "manager-vault-folder-pill__state", text: this.getVaultFolderLabel(status) });
        pill.createSpan({ cls: "manager-vault-folder-pill__count", text: `${status.itemCount}` });
    }

    private renderVaultEmpty(container: HTMLElement, iconName: string, title: string, desc: string) {
        const empty = container.createDiv("manager-vault-empty");
        const icon = empty.createDiv("manager-vault-empty__icon");
        setIcon(icon, iconName);
        empty.createDiv({ cls: "manager-vault-empty__title", text: title });
        empty.createDiv({ cls: "manager-vault-empty__desc", text: desc });
    }

    private renderVaultWarning(container: HTMLElement, text: string) {
        const warning = container.createDiv("manager-vault-warning");
        const icon = warning.createSpan({ cls: "manager-vault-warning__icon" });
        setIcon(icon, "triangle-alert");
        warning.createSpan({ cls: "manager-vault-warning__text", text });
    }

    private createVaultActionButton(
        container: HTMLElement,
        iconName: string,
        tooltip: string,
        onClick: () => void | Promise<void>,
        disabled = false
    ) {
        const button = new ButtonComponent(container);
        button.setIcon(iconName);
        button.setTooltip(tooltip);
        button.buttonEl.addClass("manager-vault-action");
        button.buttonEl.setAttribute("aria-label", tooltip);
        button.setDisabled(disabled);
        button.onClick(() => {
            void onClick();
        });
        return button;
    }

    private async runVaultOperation(action: () => Promise<void>, successMessage: string) {
        try {
            await action();
            new Notice(successMessage);
            await this.reloadShowData();
        } catch (error) {
            console.error("[BPM] shared vault operation failed", error);
            new Notice((error as Error)?.message || this.manager.translator.t("通用_失败_文本"));
        }
    }

    private async handleCreateSharedVaultLinks() {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const targetPath = this.vaultTargetPath.trim();
        const kinds: SharedFolderKind[] = [];
        if (this.vaultLinkPlugins) kinds.push("plugins");
        if (this.vaultLinkThemes) kinds.push("themes");
        if (!targetPath) {
            new Notice(t("共享库_提示_请输入目标库"));
            return;
        }
        if (kinds.length === 0) {
            new Notice(t("共享库_提示_至少选择文件夹"));
            return;
        }
        if (this.vaultBackupExisting && !(await confirmWithModal(this.app, this.manager, t("共享库_确认_备份后链接")))) return;

        await this.runVaultOperation(async () => {
            const results = await createSharedVaultLinks(this.manager, targetPath, kinds, this.vaultBackupExisting);
            this.vaultTargetPath = normalizeSharedVaultInputPath(targetPath);
            if (results.some((result) => result.backupPath)) {
                new Notice(t("共享库_提示_已备份原文件夹"));
            }
        }, t("共享库_提示_创建链接成功"));
    }

    private renderVaultToggleOption(
        container: HTMLElement,
        iconName: string,
        title: string,
        desc: string,
        value: boolean,
        onChange: (value: boolean) => void
    ) {
        const option = container.createDiv("manager-vault-option");
        const icon = option.createSpan({ cls: "manager-vault-option__icon" });
        setIcon(icon, iconName);
        const text = option.createDiv("manager-vault-option__text");
        text.createDiv({ cls: "manager-vault-option__title", text: title });
        text.createDiv({ cls: "manager-vault-option__desc", text: desc });
        const control = option.createDiv("manager-vault-option__control");
        new ToggleComponent(control)
            .setValue(value)
            .onChange(onChange);
    }

    private renderVaultSetupCard(page: HTMLElement, snapshotVaultCount: number, currentVault?: SharedVaultStatus) {
        const t = (k: string) => this.manager.translator.t(k);
        const card = page.createDiv("manager-vault-card manager-vault-setup");
        const header = card.createDiv("manager-vault-card__header");
        const icon = header.createDiv("manager-vault-card__icon");
        setIcon(icon, "folder-sync");
        const title = header.createDiv("manager-vault-card__title-group");
        title.createDiv({ cls: "manager-vault-card__title", text: t("共享库_链接设置_标题") });
        title.createDiv({ cls: "manager-vault-card__desc", text: t("共享库_链接设置_说明") });

        const form = card.createDiv("manager-vault-form");
        const pathField = form.createDiv("manager-vault-path-field");
        const pathText = pathField.createDiv("manager-vault-path-field__text");
        pathText.createDiv({ cls: "manager-vault-path-field__label", text: t("共享库_目标库路径_标题") });
        pathText.createDiv({ cls: "manager-vault-path-field__desc", text: t("共享库_目标库路径_说明") });
        const pathControl = pathField.createDiv("manager-vault-path-field__control");
        const input = new TextComponent(pathControl);
        input.setPlaceholder(t("共享库_目标库路径_占位"));
        input.setValue(this.vaultTargetPath);
        input.onChange((value) => {
            this.vaultTargetPath = value;
        });

        const options = form.createDiv("manager-vault-options");
        this.renderVaultToggleOption(
            options,
            "blocks",
            t("共享库_链接插件_标题"),
            t("共享库_链接插件_说明"),
            this.vaultLinkPlugins,
            (value) => {
                this.vaultLinkPlugins = value;
            }
        );
        this.renderVaultToggleOption(
            options,
            "palette",
            t("共享库_链接主题_标题"),
            t("共享库_链接主题_说明"),
            this.vaultLinkThemes,
            (value) => {
                this.vaultLinkThemes = value;
            }
        );
        this.renderVaultToggleOption(
            options,
            "archive",
            t("共享库_备份已有_标题"),
            t("共享库_备份已有_说明"),
            this.vaultBackupExisting,
            (value) => {
                this.vaultBackupExisting = value;
            }
        );

        const actions = card.createDiv("manager-vault-form__actions");
        const setMainButton = new ButtonComponent(actions);
        setMainButton.setIcon("crown");
        setMainButton.setButtonText(t("共享库_设为主库_按钮"));
        const canSetCurrentAsMain = !currentVault || currentVault.role === "main" || currentVault.role === "local";
        setMainButton.setDisabled(!canSetCurrentAsMain);
        setMainButton.onClick(() => {
            void this.runVaultOperation(async () => {
                await setCurrentVaultAsSharedMain(this.manager);
            }, t("共享库_提示_已设为主库"));
        });

        const linkButton = new ButtonComponent(actions);
        linkButton.setIcon("link");
        linkButton.setButtonText(t("共享库_创建链接_按钮"));
        linkButton.setCta();
        linkButton.onClick(() => {
            void this.handleCreateSharedVaultLinks();
        });

        if (snapshotVaultCount === 0) {
            this.renderVaultWarning(card, t("共享库_提示_未发现库"));
        }
        if (!canSetCurrentAsMain) {
            this.renderVaultWarning(card, t("共享库_提示_当前库不能设为主库"));
        }
    }

    private renderVaultList(container: HTMLElement, vaults: SharedVaultStatus[]) {
        const t = (k: string) => this.manager.translator.t(k);
        const list = container.createDiv("manager-vault-list");
        for (const vault of vaults) {
            const selected = vault.id === this.vaultExpandedId;
            const card = list.createDiv("manager-vault-item");
            card.toggleClass("is-current", vault.isCurrent);
            card.toggleClass("is-selected", selected);
            card.toggleClass("is-missing", !vault.exists);

            const main = card.createDiv("manager-vault-item__main");
            const icon = main.createDiv("manager-vault-item__icon");
            setIcon(icon, vault.role === "main" ? "crown" : vault.role === "linked" ? "link" : "folder");
            const text = main.createDiv("manager-vault-item__text");
            const titleRow = text.createDiv("manager-vault-item__title-row");
            titleRow.createSpan({ cls: "manager-vault-item__name", text: vault.name });
            if (vault.isCurrent) titleRow.createSpan({ cls: "manager-vault-item__badge", text: t("共享库_当前库") });
            titleRow.createSpan({ cls: `manager-vault-item__role is-${vault.role}`, text: this.getVaultRoleLabel(vault.role) });
            text.createDiv({ cls: "manager-vault-item__path", text: vault.path });
            const folderRow = text.createDiv("manager-vault-item__folders");
            this.renderVaultFolderPill(folderRow, vault.plugins);
            this.renderVaultFolderPill(folderRow, vault.themes);

            const actions = card.createDiv("manager-vault-item__actions");
            this.createVaultActionButton(actions, selected ? "check" : "sliders-horizontal", t("共享库_操作_管理"), () => {
                this.vaultExpandedId = vault.id;
                this.renderContent();
            }, selected);
            this.createVaultActionButton(actions, "folder-open", t("共享库_操作_打开目录"), () => {
                managerOpen(vault.path, this.manager);
            }, !vault.exists);
            this.createVaultActionButton(actions, "unlink", t("共享库_操作_解除插件链接"), async () => {
                if (!(await confirmWithModal(this.app, this.manager, t("共享库_确认_解除链接")))) return;
                await this.runVaultOperation(async () => {
                    await unlinkSharedVaultFolder(this.manager, vault.path, "plugins");
                }, t("共享库_提示_解除链接成功"));
            }, !vault.plugins.isSymlink || vault.isCurrent);
            this.createVaultActionButton(actions, "palette", t("共享库_操作_解除主题链接"), async () => {
                if (!(await confirmWithModal(this.app, this.manager, t("共享库_确认_解除链接")))) return;
                await this.runVaultOperation(async () => {
                    await unlinkSharedVaultFolder(this.manager, vault.path, "themes");
                }, t("共享库_提示_解除链接成功"));
            }, !vault.themes.isSymlink);
            this.createVaultActionButton(actions, "trash-2", t("共享库_操作_移出列表"), async () => {
                await this.runVaultOperation(async () => {
                    await forgetSharedVault(this.manager, vault.path);
                }, t("共享库_提示_已移出列表"));
            }, vault.isCurrent || vault.role === "main");
        }
    }

    private renderVaultPluginManager(container: HTMLElement, vault: SharedVaultStatus, plugins: SharedPluginCatalogItem[]) {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const card = container.createDiv("manager-vault-panel");
        const header = card.createDiv("manager-vault-panel__header");
        const title = header.createDiv("manager-vault-panel__title");
        const icon = title.createSpan({ cls: "manager-vault-panel__icon" });
        setIcon(icon, "blocks");
        title.createSpan({ text: t("共享库_插件管理_标题") });
        header.createSpan({ cls: "manager-vault-panel__count", text: `${vault.enabledPluginIds.length}/${plugins.length}` });

        const canManagePlugins = vault.exists && (vault.role === "main" || vault.plugins.isSymlink);
        if (!canManagePlugins) {
            this.renderVaultEmpty(card, "link", t("共享库_插件管理_未链接标题"), t("共享库_插件管理_未链接说明"));
            return;
        }
        if (plugins.length === 0) {
            this.renderVaultEmpty(card, "package-x", t("共享库_插件管理_空标题"), t("共享库_插件管理_空说明"));
            return;
        }

        if (this.settings.DELAY) {
            this.renderVaultWarning(card, t("共享库_延迟模式_提示"));
        }

        const enabledSet = new Set(vault.enabledPluginIds);
        const list = card.createDiv("manager-vault-plugin-list");
        for (const plugin of plugins) {
            const isSelf = vault.isCurrent && plugin.id === this.manager.manifest.id;
            const enabled = isSelf ? true : enabledSet.has(plugin.id);
            const item = list.createDiv("manager-vault-plugin");
            item.toggleClass("is-enabled", enabled);
            const itemIcon = item.createDiv("manager-vault-plugin__icon");
            setIcon(itemIcon, enabled ? "check-circle-2" : "circle");
            const text = item.createDiv("manager-vault-plugin__text");
            text.createDiv({ cls: "manager-vault-plugin__name", text: plugin.name || plugin.id });
            text.createDiv({
                cls: "manager-vault-plugin__meta",
                text: `${plugin.id}${plugin.version ? ` · v${plugin.version}` : ""}`,
            });
            const control = item.createDiv("manager-vault-plugin__control");
            const toggle = new ToggleComponent(control);
            toggle.setValue(enabled);
            toggle.setDisabled(isSelf);
            toggle.onChange(async (value) => {
                toggle.setDisabled(true);
                await this.runVaultOperation(async () => {
                    await setSharedVaultPluginEnabled(this.manager, vault.path, plugin.id, value);
                }, t("共享库_提示_插件状态已更新", { name: plugin.name || plugin.id }));
            });
        }
    }

    private renderVaultThemeManager(container: HTMLElement, vault: SharedVaultStatus, themes: SharedThemeCatalogItem[]) {
        const t = (k: string) => this.manager.translator.t(k);
        const card = container.createDiv("manager-vault-panel");
        const header = card.createDiv("manager-vault-panel__header");
        const title = header.createDiv("manager-vault-panel__title");
        const icon = title.createSpan({ cls: "manager-vault-panel__icon" });
        setIcon(icon, "palette");
        title.createSpan({ text: t("共享库_主题管理_标题") });
        header.createSpan({ cls: "manager-vault-panel__count", text: `${themes.length}` });

        const canManageThemes = vault.exists && (vault.role === "main" || vault.themes.isSymlink);
        if (!canManageThemes) {
            this.renderVaultEmpty(card, "link", t("共享库_主题管理_未链接标题"), t("共享库_主题管理_未链接说明"));
            return;
        }

        const row = card.createDiv("manager-vault-theme-row");
        const text = row.createDiv("manager-vault-theme-row__text");
        text.createDiv({ cls: "manager-vault-theme-row__label", text: t("共享库_当前主题_标题") });
        text.createDiv({ cls: "manager-vault-theme-row__desc", text: vault.activeTheme || t("共享库_默认主题") });
        const control = row.createDiv("manager-vault-theme-row__control");
        const dropdown = new DropdownComponent(control);
        dropdown.addOption("", t("共享库_默认主题"));
        const hasActiveTheme = !vault.activeTheme || themes.some((theme) => theme.name === vault.activeTheme);
        if (!hasActiveTheme) dropdown.addOption(vault.activeTheme, vault.activeTheme);
        for (const theme of themes) {
            dropdown.addOption(theme.name, `${theme.name}${theme.version ? ` · v${theme.version}` : ""}`);
        }
        dropdown.setValue(vault.activeTheme);
        dropdown.onChange(async (value) => {
            await this.runVaultOperation(async () => {
                await setSharedVaultTheme(this.manager, vault.path, value);
            }, t("共享库_提示_主题已更新"));
        });
    }

    private renderVaultSelector(container: HTMLElement, vaults: SharedVaultStatus[], selectedVault: SharedVaultStatus) {
        const t = (k: string) => this.manager.translator.t(k);
        const selector = container.createDiv("manager-vault-selector");
        const label = selector.createDiv("manager-vault-selector__label");
        const icon = label.createSpan({ cls: "manager-vault-selector__icon" });
        setIcon(icon, "folder-cog");
        const text = label.createDiv("manager-vault-selector__text");
        text.createDiv({ cls: "manager-vault-selector__title", text: t("共享库_管理库_标题") });
        text.createDiv({ cls: "manager-vault-selector__desc", text: t("共享库_管理库_说明") });
        const control = selector.createDiv("manager-vault-selector__control");
        const dropdown = new DropdownComponent(control);
        for (const vault of vaults) {
            const suffix = [
                this.getVaultRoleLabel(vault.role),
                vault.isCurrent ? t("共享库_当前库") : "",
            ].filter(Boolean).join(" · ");
            dropdown.addOption(vault.id, `${vault.name}${suffix ? ` · ${suffix}` : ""}`);
        }
        dropdown.setValue(selectedVault.id);
        dropdown.onChange((value) => {
            this.vaultExpandedId = value;
            this.renderContent();
        });
    }

    private renderVaultDetail(container: HTMLElement, vault: SharedVaultStatus, vaults: SharedVaultStatus[], plugins: SharedPluginCatalogItem[], themes: SharedThemeCatalogItem[]) {
        const t = (k: string) => this.manager.translator.t(k);
        const detail = container.createDiv("manager-vault-detail");
        this.renderVaultSelector(detail, vaults, vault);
        const header = detail.createDiv("manager-vault-detail__header");
        const title = header.createDiv("manager-vault-detail__title");
        const icon = title.createSpan({ cls: "manager-vault-detail__icon" });
        setIcon(icon, vault.role === "main" ? "crown" : "folder-cog");
        title.createSpan({ text: vault.name });
        header.createSpan({ cls: `manager-vault-detail__role is-${vault.role}`, text: this.getVaultRoleLabel(vault.role) });
        detail.createDiv({ cls: "manager-vault-detail__path", text: vault.path });

        if (!vault.exists) {
            this.renderVaultEmpty(detail, "folder-x", t("共享库_详情_路径失效标题"), t("共享库_详情_路径失效说明"));
            return;
        }

        const panels = detail.createDiv("manager-vault-detail__panels");
        this.renderVaultPluginManager(panels, vault, plugins);
        this.renderVaultThemeManager(panels, vault, themes);
    }

    private async showVaultSharePanel(renderGeneration = this.renderGeneration) {
        if (!SHARED_VAULTS_ENABLED) {
            this.activePage = "plugins";
            this.installMode = false;
            this.syncPageChrome();
            this.pageEl.empty();
            await this.showData(renderGeneration);
            return;
        }

        this.pageEl.empty();
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const page = this.pageEl.createDiv("manager-vault-share");

        if (Platform.isMobileApp || !isSharedVaultFsAvailable()) {
            this.renderVaultEmpty(page, "monitor-x", t("共享库_桌面端限定_标题"), t("共享库_桌面端限定_说明"));
            return;
        }

        const [snapshot, plugins, themes] = await Promise.all([
            getSharedVaultSnapshot(this.manager),
            readSharedPluginCatalog(this.manager),
            readSharedThemeCatalog(this.manager),
        ]);
        if (!this.isRenderCurrent(renderGeneration, "vaults")) return;

        const currentVault = snapshot.vaults.find((vault) => vault.isCurrent) || snapshot.vaults[0];
        if (!this.vaultExpandedId || !snapshot.vaults.some((vault) => vault.id === this.vaultExpandedId)) {
            this.vaultExpandedId = currentVault?.id || "";
        }
        const selectedVault = snapshot.vaults.find((vault) => vault.id === this.vaultExpandedId) || currentVault;

        const summary = page.createDiv("manager-vault-summary");
        this.renderVaultMetric(summary, "crown", t("共享库_统计_主库"), snapshot.mainVaultPath ? snapshot.mainVaultPath : t("共享库_未设置"));
        this.renderVaultMetric(summary, "folder-kanban", t("共享库_统计_纳管库"), snapshot.vaults.length);
        this.renderVaultMetric(summary, "blocks", t("共享库_统计_共享插件"), plugins.length);
        this.renderVaultMetric(summary, "palette", t("共享库_统计_共享主题"), themes.length);

        if (snapshot.error) {
            this.renderVaultWarning(page, snapshot.error);
        }

        this.renderVaultSetupCard(page, snapshot.vaults.length, currentVault);

        const workspace = page.createDiv("manager-vault-workspace");
        const vaultListCard = workspace.createDiv("manager-vault-card");
        const listHeader = vaultListCard.createDiv("manager-vault-card__header");
        const listIcon = listHeader.createDiv("manager-vault-card__icon");
        setIcon(listIcon, "folder-kanban");
        const listTitle = listHeader.createDiv("manager-vault-card__title-group");
        listTitle.createDiv({ cls: "manager-vault-card__title", text: t("共享库_库列表_标题") });
        listTitle.createDiv({ cls: "manager-vault-card__desc", text: t("共享库_库列表_说明") });
        this.renderVaultList(vaultListCard, snapshot.vaults);

        if (selectedVault) {
            this.renderVaultDetail(workspace, selectedVault, snapshot.vaults, plugins, themes);
        }
    }

    public refreshDevicePanelIfOpen(): void {
        if (this.activePage === "devices" && this.devicePanel && this.pageEl?.isConnected) {
            this.devicePanel.render(this.pageEl);
        }
    }

    private showDevicePanel(): void {
        if (!this.devicePanel) this.devicePanel = new DevicePanel(this.manager);
        this.devicePanel.render(this.pageEl);
    }

    /** 五栏共用的设备作用域选择器；Shared scope selector for the five scoped pages. */
    private renderDeviceScope(container: HTMLElement, page: ScopePage, inline = false): void {
        let bar = this.deviceScopeBars.get(page);
        if (!bar) {
            bar = new DeviceScopeBar(this.manager, () => this.renderContent());
            this.deviceScopeBars.set(page, bar);
        }
        bar.render(container, page, inline);
    }

    private enterScopePage(page: ScopePage): void {
        this.manager.devices?.noteActivePage(page);
        this.manager.devices?.ensureProjection(page);
    }

    private renderContent() {
        this.overviewToolbarLayout?.destroy();
        this.overviewToolbarLayout = undefined;
        this.clearInstallToolbarMenus();
        this.ribbonPage?.closeGroupMenus();
        this.ensureAllowedActivePage();
        this.syncPageChrome();
        if (this.getAvailableDesktopPages().length === 0) {
            this.pageEl.empty();
            this.pageEl.createEl('p', { cls: 'setting-item-description', text: this.manager.translator.t('功能开关_空') });
            return;
        }
        this.manager.devices?.noteActivePage(this.activePage);
        if (this.activePage !== "devices") this.devicePanel?.destroy();
        const renderGeneration = this.nextRenderGeneration();
        this.pageEl.empty();
        this.clearPluginOverviewLayoutClass();
        if (this.activePage === "devices") {
            this.showDevicePanel();
        } else if (this.activePage === "ribbon") {
            void this.showRibbonPanel(renderGeneration);
        } else if (this.activePage === "themes") {
            void this.showThemeOverview(renderGeneration);
        } else if (this.activePage === "troubleshoot") {
            this.showTroubleshootPanel();
        } else if (this.activePage === "transfer") {
            void this.showTransferPanel(renderGeneration);
        } else if (this.activePage === "vaults") {
            void this.showVaultSharePanel(renderGeneration);
        } else if (this.activePage === "install" || this.activePage === "sources" || this.installMode) {
            this.showInstallPanel();
        } else {
            void this.showData(renderGeneration);
        }
    }

    private bindLongPressTooltip(el: HTMLElement | undefined, text?: string) {
        if (!el || !text) return;
        let timer: number | undefined;
        const show = () => { new Notice(text, 1500); };
        const clear = () => { if (timer) window.clearTimeout(timer); timer = undefined; };
        el.addEventListener("touchstart", () => {
            timer = window.setTimeout(show, 500);
        });
        el.addEventListener("touchend", clear);
        el.addEventListener("touchcancel", clear);
        el.addEventListener("touchmove", clear, { passive: true });
    }

    public async reloadShowData() {
        this.overviewToolbarLayout?.destroy();
        this.overviewToolbarLayout = undefined;
        this.clearInstallToolbarMenus();
        this.ensureAllowedActivePage();
        if (this.settings.DEBUG) console.log("[BPM] reloadShowData start, children before empty:", this.pageEl.children.length);
        this.clearScheduledSearchRender();
        if (this.getAvailableDesktopPages().length === 0) { this.renderContent(); return; }
        const renderGeneration = this.nextRenderGeneration();
        const modalElement: HTMLElement = this.pageEl;
        const scrollTop = modalElement.scrollTop;
        modalElement.empty();
        this.clearPluginOverviewLayoutClass();
        if (this.activePage === "devices") {
            this.showDevicePanel();
            modalElement.scrollTo(0, scrollTop);
        } else if (this.activePage === "ribbon") {
            await this.showRibbonPanel(renderGeneration);
            if (!this.isRenderCurrent(renderGeneration, "ribbon")) return;
            modalElement.scrollTo(0, scrollTop);
        } else if (this.activePage === "themes") {
            await this.showThemeOverview(renderGeneration);
            if (!this.isRenderCurrent(renderGeneration, "themes")) return;
            modalElement.scrollTo(0, scrollTop);
        } else if (this.activePage === "troubleshoot") {
            this.showTroubleshootPanel();
            modalElement.scrollTo(0, scrollTop);
        } else if (this.activePage === "transfer") {
            await this.showTransferPanel(renderGeneration);
            if (!this.isRenderCurrent(renderGeneration, "transfer")) return;
            modalElement.scrollTo(0, scrollTop);
        } else if (this.activePage === "vaults") {
            await this.showVaultSharePanel(renderGeneration);
            if (!this.isRenderCurrent(renderGeneration, "vaults")) return;
            modalElement.scrollTo(0, scrollTop);
        } else if (this.activePage === "install" || this.activePage === "sources" || this.installMode) {
            this.showInstallPanel();
            modalElement.scrollTo(0, scrollTop);
        } else {
            await this.showData(renderGeneration);
            if (!this.isRenderCurrent(renderGeneration, "plugins")) return;
            modalElement.scrollTo(0, scrollTop);
        }
        if (this.settings.DEBUG) console.log("[BPM] reloadShowData end, children after render:", this.pageEl.children.length);
    }

    private async refreshFilterOptions(preserveScroll = false) {
        const scrollTop = preserveScroll ? this.pageEl.scrollTop : 0;
        // 重新计算并刷新分组/标签/延迟下拉的计数
        if (this.groupMultiSelect) {
            const groups = this.getGroupFilterOptions(this.manager.translator.t("筛选_全部_描述"));
            this.groupMultiSelect.refreshOptions(groups, this.getGroupFilterValues());
        }
        if (this.tagMultiSelect) {
            const tags = this.getTagFilterOptions(this.manager.translator.t("筛选_全部_描述"));
            this.tagMultiSelect.refreshOptions(tags, this.getTagFilterValues());
        }
        if (this.settings.DELAY && this.delayMultiSelect) {
            const delays = this.getDelayFilterOptions(this.manager.translator.t("筛选_全部_描述"));
            this.delayMultiSelect.refreshOptions(delays, this.getDelayFilterValues());
        }
        await this.reloadShowData();
        if (preserveScroll) this.pageEl.scrollTo({ top: scrollTop });
    }

    public async refreshRibbonFeatureAvailability() {
        this.ensureAllowedActivePage();
        await this.showHead();
        this.renderContent();
    }

    public async refreshStyleSettings() {
        if (this.modalContainer && !Platform.isMobile) {
            this.modalContainer.toggleClass("manager-container__top", !this.settings.CENTER);
        }
        this.syncToolbarLabelMode();
        await this.reloadShowData();
    }

    public onOpen() {
        this.manager.beginSettingsEditing(this);
        this.scrollbars?.destroy();
        this.scrollbars = new FloatingScrollbars(this.modalEl);
        void this.openAsync();
    }

    private async openAsync() {
        await this.showHead();
        await this.showData();
        // 移动端不自动聚焦搜索框：会弹出软键盘挡住半个管理器。
        if (!Platform.isMobile) this.searchEl.inputEl.focus();
        this.applyEditingStyle();
        // [功能] ctrl+f聚焦
        activeDocument.addEventListener("keydown", (event) => {
            if (event.ctrlKey && event.key.toLowerCase() === "f") {
                if (this.searchEl.inputEl) {
                    this.searchEl.inputEl.focus();
                }
            }
        });
    }

    public onClose() {
        this.clearInstallToolbarMenus();
        this.overviewToolbarLayout?.destroy();
        this.overviewToolbarLayout = undefined;
        this.overviewStatsSelect?.close();
        this.overviewStatsSelect = undefined;
        this.scrollbars?.destroy();
        this.scrollbars = undefined;
        this.taskCenterView?.destroy();
        this.taskCenterView = undefined;
        this.devicePanel?.destroy();
        this.ribbonPage?.closeGroupMenus();
        this.mobileHeaderObserver?.disconnect();
        this.mobileHeaderObserver = undefined;
        this.overviewSortSelect?.close();
        this.mobileContentObserver?.disconnect();
        this.mobileContentObserver = undefined;
        this.deviceScopeBars.forEach(bar => bar.close());
        this.catalogModal?.close();
        this.catalogModal = undefined;
        this.clearScheduledSearchWork();
        // 关闭时结束外域投影，避免预览中的其他预设值留在内存里。
        void this.manager.devices.flushProjection().then(() => this.manager.endSettingsEditing(this))
            .catch(error => this.manager.devices.report(error));
        if (this.settings.PERSISTENCE && this.settings.FILTER_SEARCH !== this.searchText) {
            this.settings.FILTER_SEARCH = this.searchText;
            void this.manager.saveSettings();
        }
        this.contentEl.empty();
        this.modalChromeEl = undefined;
        this.modalPageEl = undefined;
        if (this.manager.ribbonModal === this.ribbonPage) this.manager.ribbonModal = null;
        if (this.modalContainer) this.modalContainer.removeClass("manager-container--editing");
        if (this.modalContainer) this.modalContainer.removeClass("manager-container--bulk-editing"); 
    }

    private applyEditingStyle() {
        if (!this.modalContainer) return;
        if (this.editorMode) {
            this.modalContainer.addClass("manager-container--editing");  
        } else {
            this.modalContainer.removeClass("manager-container--editing"); 
        }
        if (this.bulkEditMode) {
            this.modalContainer.addClass("manager-container--bulk-editing"); 
        } else {
            this.modalContainer.removeClass("manager-container--bulk-editing"); 
        }
        if (this.desktopActionWrapper) this.syncPageChrome();
    }
}
