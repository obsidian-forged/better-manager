import { featureEnabled } from './features';
import type ShareMyPlugin from "main";
import { Notice, ObsidianProtocolData, debounce, requestUrl } from "obsidian";
import { resolveGithubUrl } from "./github-url";
import { parseInstallManifest } from './catalog/install-manifest';
import { record } from './catalog/catalog';
import { assertHttpSuccess, errorMessage } from './network/http-error';

// 导出一个全局的 communityPlugins 变量，可在其他模块中使用
export type CommunityPluginInfo = {
    id: string;
    name?: string;
    repo?: string;
    [key: string]: string | undefined;
};

export const communityPlugins: Record<string, CommunityPluginInfo> = {};

/**
 * 插件安装器类，负责处理插件的安装和解析安装参数等操作
 */


export default class Agreement {
    // 引用 ShareMyPlugin 实例，方便访问主插件的属性和方法
    plugin: ShareMyPlugin;
    // 存储社区插件信息的对象，键为插件 ID，值为插件详细信息
    communityPlugins: Record<string, CommunityPluginInfo> = {};
    // 标记是否已经加载了社区插件列表
    loaded = false;
    // 防抖函数，用于定时刷新社区插件列表，每小时执行一次
    debounceFetch = debounce(() => {
        void this.fetchCommunityPlugins().catch(error => {
            if (this.plugin.settings.DEBUG) console.error('[BPM] Refreshing the community registry failed', error);
            new Notice(errorMessage(error));
        });
    }, 1000 * 60 * 60);

    /**
     * 从远程获取社区插件列表，并将其转换为以插件 ID 为键的对象
     */
    async fetchCommunityPlugins() {
        // 从指定的 URL 获取社区插件列表的 JSON 数据
        const url = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";
        const res = await requestUrl({ url: resolveGithubUrl(this.plugin, url), throw: false });
        assertHttpSuccess(res);
        const pluginList: unknown = res.json;
        if (!Array.isArray(pluginList)) throw new Error('Invalid community plugin registry');
        // 创建一个空对象，用于存储以插件 ID 为键的插件信息
        const keyedPluginList: Record<string, CommunityPluginInfo> = {};
        // 遍历插件列表，将每个插件的信息存储到 keyedPluginList 中
        for (const candidate of pluginList) {
            const item: unknown = candidate;
            if (!record(item) || typeof item.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(item.id)
                || ['constructor', '__proto__', 'prototype'].includes(item.id)) continue;
            const plugin: CommunityPluginInfo = { id: item.id };
            for (const [key, value] of Object.entries(item)) if (typeof value === 'string') plugin[key] = value;
            keyedPluginList[plugin.id] = plugin;
        }
        // 将处理后的插件列表赋值给 communityPlugins 属性
        this.communityPlugins = keyedPluginList;
        // 标记社区插件列表已加载
        this.loaded = true;
    }

    /**
     * 构造函数，初始化插件安装器
     * @param SMPL - ShareMyPlugin 实例
     */
    constructor(SMPL: ShareMyPlugin) {
        // 保存 ShareMyPlugin 实例
        this.plugin = SMPL;
        this.plugin.register(() => this.debounceFetch.cancel());
        // The protocol handlers fetch the registry on demand. Constructing a handler
        // must not start a network request during plugin initialization.
    }

    /**
     * 获取指定的插件
     * @param id - 要获取的插件的 ID
     */
    public async pluginGithub(id: string) {
        // 如果社区插件列表未加载，则先加载
        if (!this.loaded) {
            await this.fetchCommunityPlugins();
        }
        // 从社区插件列表中查找对应插件的 repo 信息
        const pluginInfo = this.communityPlugins[id];

        if (!pluginInfo) {
            new Notice(this.plugin.translator.t("协议_未知插件ID_提示", { id }));
            return null;
        }
        window.open(`https://github.com/${pluginInfo.repo}`);
    }

    /**
     * 安装指定的插件
     * @param id - 要安装的插件的 ID
     * @param version - 要安装的插件的版本，默认为空字符串，表示不检查版本
     * @param enable - 安装后是否启用插件，默认为 false
     * @param github - 插件的 GitHub 仓库地址，默认为空字符串
     */
    public async pluginInstall(id: string, version = "", enable = false, github = "") {
        // 如果社区插件列表未加载，则先加载 否则，触发防抖函数，定时刷新社区插件列表
        if (!this.loaded) await this.fetchCommunityPlugins(); else this.debounceFetch();

        // 获取 Obsidian 应用的插件注册表
        const pluginRegistry = this.plugin.appPlugins;

        // 标记是否需要安装插件
        let installFlag = false;
        // 获取插件的仓库地址，如果提供了 github 参数，则使用该参数，否则从社区插件列表中获取
        const repo = github !== "" ? github : this.communityPlugins[id]?.repo;
        // 如果找不到插件的仓库地址，显示提示信息并返回
        if (!repo) {
            new Notice(this.plugin.translator.t("协议_未知插件ID_提示", { id }));
            return;
        }

        // 检查插件是否已经安装
        if (pluginRegistry.manifests[id]) {
            // 插件已安装，显示提示信息
            new Notice(this.plugin.translator.t("协议_插件已安装_提示", { name: pluginRegistry.manifests[id].name }));
            // 如果指定了版本且与已安装的版本不同，则标记为需要安装
            if (version !== "" && version !== pluginRegistry.manifests[id]?.version) installFlag = true;
        } else {
            // 插件未安装，标记为需要安装
            installFlag = true;
        }

        // 如果需要安装插件
        if (installFlag) {
            // 从 GitHub 仓库获取插件的 manifest.json 文件
            const manifestUrl = `https://raw.githubusercontent.com/${repo}/HEAD/manifest.json`;
            const manifestRes = await requestUrl({ url: resolveGithubUrl(this.plugin, manifestUrl), throw: false });
            assertHttpSuccess(manifestRes);
            const payload: unknown = manifestRes.json;
            const parsed = parseInstallManifest(payload, id);
            const manifest = record(payload) ? { ...payload, ...parsed } : { ...parsed };
            // 如果版本为 "latest" 或空字符串，则使用 manifest 中的版本
            if (version.toLowerCase() === "latest" || version === "") version = parsed.version;
            // 调用插件注册表的 installPlugin 方法安装插件
            await pluginRegistry.installPlugin(repo, version, manifest);
        }

        // 根据 enable 参数决定是否启用或禁用插件
        if (enable) {
            // 启用插件
            await pluginRegistry.loadPlugin(id);
            await pluginRegistry.enablePluginAndSave(id);
        } else {
            // 禁用插件
            await pluginRegistry.disablePlugin(id);
        }

        // 新装的插件可能带来新 ribbon 图标，登记一次
        this.plugin.applyRibbonSettings();
    }

    /**
     * 解析安装参数并调用 installPlugin 方法安装插件
     * @param params - 包含插件安装参数的对象
     */
    public async parsePluginInstall(params: ObsidianProtocolData) {
        if (!featureEnabled(this.plugin.settings, 'install')) return;
        // 解析参数，设置默认值
        const args = {
            id: params.id,
            version: params?.version ?? "",
            enable: typeof params.enable === 'string' && ["", "true", "1"].includes(params.enable.toLowerCase()),
            github: params.github ?? "",
        };
        // 调用 installPlugin 方法安装插件
        await this.pluginInstall(args.id, args.version, args.enable, args.github);
    }

    /**
     * 解析包含插件信息的字符串或对象，获取插件的相关信息
     * @param input - 包含插件信息的字符串或对象
     * @return - 返回解析后的插件信息对象，如果解析失败则返回 null
     */
    public async parsePluginGithub(params: ObsidianProtocolData) {
        if (!featureEnabled(this.plugin.settings, 'install')) return;
        // 解析参数，设置默认值
        const args = { id: params.id };
        await this.pluginGithub(args.id);
    }
}
