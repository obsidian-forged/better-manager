import { App, ExtraButtonComponent, PluginManifest, Workspace } from "obsidian";

export type TranslationVars = Record<string, string | number | boolean | null | undefined>;

export type ExtraButtonComponentWithEl = ExtraButtonComponent & {
    extraSettingsEl?: HTMLElement;
    buttonEl?: HTMLElement;
};

export function getExtraButtonElement(button: ExtraButtonComponent): HTMLElement | undefined {
    const component = button as ExtraButtonComponentWithEl;
    return component.extraSettingsEl || component.buttonEl;
}

export type AppPluginInstanceLike = {
    manifest?: PluginManifest & {
        pluginUrl?: string;
        author2?: string;
        installLink?: string;
    };
    /**
     * Obsidian 原生的加载标记：true = onload 已跑完。
     * 实测每个 Plugin 实例都有该字段，是判定「延时启动是否真的起来了」的依据。
     */
    _loaded?: boolean;
    [key: string]: unknown;
};

export type ObsidianPluginRegistry = {
    manifests: Record<string, PluginManifest>;
    enabledPlugins: Set<string>;
    plugins?: Record<string, AppPluginInstanceLike>;
    installPlugin: (repo: string, version: string, manifest: PluginManifest | Record<string, unknown>) => Promise<void>;
    uninstallPlugin: (id: string) => Promise<void>;
    loadManifests: () => Promise<void>;
    loadPlugin: (id: string) => Promise<void>;
    /**
     * 实测返回 boolean：true = 本次真正启动，false = 已在运行或 manifest 缺失。
     * 旧签名写成 Promise<void> 会把这个结果丢掉，让「启动成功」无法判定。
     */
    enablePlugin: (id: string) => Promise<boolean | void>;
    disablePlugin: (id: string) => Promise<void>;
    enablePluginAndSave: (id: string) => Promise<void>;
    disablePluginAndSave: (id: string) => Promise<void>;
};

export type SettingTabLike = {
    searchComponent?: { inputEl: HTMLInputElement };
    updateHotkeyVisibility?: () => void;
    containerEl?: HTMLElement;
};

export type ActiveTabLike = SettingTabLike & {
    searchComponent: { inputEl: HTMLInputElement };
    updateHotkeyVisibility: () => void;
};

export type AppSettingsLike = {
    activeTab?: ActiveTabLike;
    open: () => Promise<void>;
    openTabById: (id: string) => Promise<void>;
};

/** 核心插件实例的最小视图：Sync 未登录时 userId 为 -1 且 key/host 为空。 */
export type CorePluginInstanceLike = {
    userId?: unknown;
    key?: unknown;
    host?: unknown;
    vaultId?: unknown;
};

export type ObsidianCorePluginRegistry = {
    getPluginById?: (id: string) => { enabled?: boolean; instance?: CorePluginInstanceLike } | undefined;
};

export type ObsidianAppWithInternals = App & {
    plugins: ObsidianPluginRegistry;
    setting: AppSettingsLike;
    internalPlugins?: ObsidianCorePluginRegistry;
    i18n?: {
        locale?: string;
        lang?: string;
        language?: string;
    };
};

/** Obsidian 内部 ribbon 项（leftRibbon.items 的元素） */
export type RibbonNativeItem = {
    /** 形如 "nutstore-sync:开始同步"（随语言与标题变化） */
    id?: string;
    title?: string;
    name?: string;
    ariaLabel?: string;
    /** 图标名（插件源码常量，比标题稳定） */
    icon?: string;
    /** 显隐由 Obsidian 原生状态承载：true 表示已隐藏 */
    hidden?: boolean;
    /** 插件被禁用后 buttonEl 会被删除，但条目本身保留（hidden 与位置随之存活） */
    buttonEl?: HTMLElement;
    callback?: (...args: unknown[]) => unknown;
};

/** Obsidian 内部左ribbon（app.workspace.leftRibbon） */
export type LeftRibbonLike = {
    items?: Array<RibbonNativeItem | null | undefined>;
    containerEl?: HTMLElement;
    ribbonItemsEl?: HTMLElement;
    /** 按 items 的 hidden 重绘并重排 DOM；true 时顺带持久化到 workspace 配置 */
    onChange?: (persist?: boolean) => void;
    /** 序列化为 workspace 配置中的 left-ribbon 段（键顺序即显示顺序） */
    serialize?: () => { hiddenItems?: Record<string, boolean> };
    /**
     * 图标注册的唯一入口：插件 addRibbonIcon 最终走到这里
     * 新条目在这里创建（hidden 默认为 false），是设置必须重新复述的时刻
     */
    addRibbonItemButton?: (id: string, icon: string, title: string, callback: (...args: unknown[]) => unknown) => HTMLElement;
};

export type WorkspaceWithRibbon = Workspace & {
    leftRibbon?: LeftRibbonLike;
};

export type VaultAdapterWithBasePath = {
    getBasePath?: () => string;
};

export type WindowWithMoment = Window & {
    moment?: {
        locale?: () => string;
    };
};
