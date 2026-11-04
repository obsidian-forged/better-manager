import { createActionHandler } from '../ui/action-handler';
import { Notice,
    App,
    DropdownComponent,
    Modal,
    PluginManifest,
    SearchComponent,
    Setting,
    ToggleComponent,
    setIcon,
} from "obsidian";

import { ManagerSettings, TagFilterOperator } from "../settings/data";

import Manager from "main";
import type { ManagerModal } from "./manager-modal";
import { ObsidianAppWithInternals } from "src/obsidian-internals";

export class HideModal extends Modal {
    private readonly action = createActionHandler(error => {
        if (this.manager.settings.DEBUG) console.error('[BPM] Modal action failed', error);
        new Notice(`${this.manager.translator.t('安装_错误_通用')} ${error instanceof Error ? error.message : ''}`);
    });
    manager: Manager;
    managerModal: ManagerModal;
    settings: ManagerSettings;
    // this.app.plugins
    appPlugins;
    // this.app.settings
    appSetting;
    // [本地][变量] 导出插件列表
    plugins: PluginManifest[] = [];

    // 搜索内容
    searchText = "";
    // 搜索结果
    searchEl!: SearchComponent;
    delay = "";
    tag = "";
    tagOperator: TagFilterOperator = "contains";
    group = "";
    groupOperator: TagFilterOperator = "contains";
    delayOperator: TagFilterOperator = "contains";
    filter = "all";

    private addOrderedOptions(dropdown: DropdownComponent, options: Array<[string, string]>) {
        for (const [value, text] of options) {
            dropdown.addOption(value, text);
        }
    }

    private matchesSingleValueFilter(value: string, filterValue: string, operator: TagFilterOperator): boolean {
        if (!filterValue) return true;
        const matched = value === filterValue;
        return operator === "contains" ? matched : !matched;
    }

    private matchesTagFilter(pluginTags: string[] = [], tagId: string, operator: TagFilterOperator): boolean {
        if (!tagId) return true;
        const hasTag = pluginTags.includes(tagId);
        return operator === "contains" ? hasTag : !hasTag;
    }

    constructor(app: App, manager: Manager, managerModal: ManagerModal, plugins: PluginManifest[]) {
        super(app);
        const appWithInternals = this.app as ObsidianAppWithInternals;
        this.appSetting = appWithInternals.setting;
        this.appPlugins = appWithInternals.plugins;
        this.manager = manager;
        this.managerModal = managerModal;
        this.settings = manager.settings;
        this.plugins = plugins;
    }

    public async showHead() {
        const t = (key: string) => this.manager.translator.t(key);
        const modalEl = this.contentEl.parentElement;
        if (!modalEl) return;
        modalEl.addClass("manager-container");
        modalEl.addClass("manager-hide-modal");
        // 靠上
        if (!this.settings.CENTER) modalEl.addClass("manager-container__top");
        modalEl.getElementsByClassName("modal-close-button")[0]?.remove();
        this.titleEl.parentElement?.addClass("manager-container__header");

        // 标题 + 关闭
        this.titleEl.empty();
        this.titleEl.addClass("hide-modal__title");
        const titleMain = this.titleEl.createDiv("hide-modal__title-main");
        const titleIcon = titleMain.createSpan("hide-modal__title-icon");
        setIcon(titleIcon, "eye-off");
        titleMain.createSpan({ cls: "hide-modal__title-text", text: t("菜单_隐藏插件_标题") });
        const closeButton = this.titleEl.createEl("button", { cls: "manager-modal-close hide-modal__close" });
        closeButton.type = "button";
        closeButton.setAttribute("aria-label", t("通用_关闭窗口"));
        setIcon(closeButton, "x");
        closeButton.addEventListener("click", () => this.close());

        this.contentEl.addClass("manager-item-container");
        // 过滤区放在 contentEl 之外，重绘列表时不会丢失
        const chromeEl = modalEl.createDiv("hide-modal__chrome");
        modalEl.insertBefore(chromeEl, this.contentEl);
        const filtersEl = chromeEl.createDiv("hide-modal__filters");
        const addField = (label: string) => {
            const field = filtersEl.createDiv("hide-modal__field");
            field.createSpan({ cls: "hide-modal__label", text: label });
            return field.createDiv("hide-modal__control");
        };

        const filterOptions = {
            "all": t("筛选_全部_描述"),
            "enabled": t("筛选_仅启用_描述"),
            "disabled": t("筛选_仅禁用_描述"),
            "grouped": t("筛选_已分组_描述"),
            "ungrouped": t("筛选_未分组_描述"),
            "tagged": t("筛选_有标签_描述"),
            "untagged": t("筛选_无标签_描述"),
            "noted": t("筛选_有笔记_描述"),
        };
        const filterDropdown = new DropdownComponent(addField(t("通用_状态_文本")));
        filterDropdown.addOptions(filterOptions);
        filterDropdown.setValue(this.filter);
        filterDropdown.onChange((value) => { this.filter = value; this.action(async () => { await this.reloadShowData(); })(); });

        const operatorOptions = {
            "contains": t("筛选_操作符_包含"),
            "not-contains": t("筛选_操作符_排除"),
        };
        const groupCounts = this.settings.Plugins.reduce((acc: { [key: string]: number }, plugin) => { const groupId = plugin.group || ""; acc[groupId] = (acc[groupId] || 0) + 1; return acc; }, { "": 0 });
        const groups: Array<[string, string]> = [
            ["", t("通用_无分组_文本")],
            ...this.settings.GROUPS.map((item): [string, string] => [item.id, `${item.name} [${groupCounts[item.id] || 0}]`]),
        ];
        const groupControl = addField(t("通用_分组_文本"));
        const groupOperatorDropdown = new DropdownComponent(groupControl);
        groupOperatorDropdown.addOptions(operatorOptions);
        groupOperatorDropdown.setValue(this.groupOperator);
        groupOperatorDropdown.selectEl.setAttribute("aria-label", t("筛选_分组取反_标签"));
        groupOperatorDropdown.onChange((value) => {
            this.groupOperator = value === "not-contains" ? "not-contains" : "contains";
            this.action(async () => { await this.reloadShowData(); })();
        });
        const groupsDropdown = new DropdownComponent(groupControl);
        this.addOrderedOptions(groupsDropdown, groups);
        groupsDropdown.setValue(this.group);
        groupsDropdown.onChange((value) => { this.group = value; this.action(async () => { await this.reloadShowData(); })(); });

        const tagCounts: { [key: string]: number } = this.settings.Plugins.reduce((acc, plugin) => { plugin.tags.forEach((tag) => { acc[tag] = (acc[tag] || 0) + 1; }); return acc; }, {} as { [key: string]: number });
        const tags: Array<[string, string]> = [
            ["", t("通用_无标签_文本")],
            ...this.settings.TAGS.map((item): [string, string] => [item.id, `${item.name} [${tagCounts[item.id] || 0}]`]),
        ];
        const tagControl = addField(t("通用_标签_文本"));
        const tagOperatorDropdown = new DropdownComponent(tagControl);
        tagOperatorDropdown.addOptions(operatorOptions);
        tagOperatorDropdown.setValue(this.tagOperator);
        tagOperatorDropdown.selectEl.setAttribute("aria-label", t("筛选_标签取反_标签"));
        tagOperatorDropdown.onChange((value) => {
            this.tagOperator = value === "not-contains" ? "not-contains" : "contains";
            this.action(async () => { await this.reloadShowData(); })();
        });
        const tagsDropdown = new DropdownComponent(tagControl);
        this.addOrderedOptions(tagsDropdown, tags);
        tagsDropdown.setValue(this.tag);
        tagsDropdown.onChange((value) => { this.tag = value; this.action(async () => { await this.reloadShowData(); })(); });

        if (this.settings.DELAY) {
            const delayCounts = this.settings.Plugins.reduce((acc: { [key: string]: number }, plugin) => { const delay = plugin.delay || ""; acc[delay] = (acc[delay] || 0) + 1; return acc; }, { "": 0 });
            const delays: Array<[string, string]> = [
                ["", t("通用_无延迟_文本")],
                ...this.settings.DELAYS.map((item): [string, string] => [item.id, `${item.name} (${delayCounts[item.id] || 0})`]),
            ];
            const delayControl = addField(t("通用_延迟_文本"));
            const delayOperatorDropdown = new DropdownComponent(delayControl);
            delayOperatorDropdown.addOptions(operatorOptions);
            delayOperatorDropdown.setValue(this.delayOperator);
            delayOperatorDropdown.selectEl.setAttribute("aria-label", t("筛选_延迟取反_标签"));
            delayOperatorDropdown.onChange((value) => {
                this.delayOperator = value === "not-contains" ? "not-contains" : "contains";
                this.action(async () => { await this.reloadShowData(); })();
            });
            const delaysDropdown = new DropdownComponent(delayControl);
            this.addOrderedOptions(delaysDropdown, delays);
            delaysDropdown.setValue(this.delay || "");
            delaysDropdown.onChange((value) => { this.delay = value; this.action(async () => { await this.reloadShowData(); })(); });
        }

        const searchWrap = chromeEl.createDiv("hide-modal__search");
        this.searchEl = new SearchComponent(searchWrap);
        this.searchEl.inputEl.setAttribute("aria-label", t("通用_搜索_文本"));
        this.searchEl.onChange((value: string) => { this.searchText = value; this.action(async () => { await this.reloadShowData(); })(); });
    }

    public async showData() {
        for (const plugin of this.plugins) {
            const ManagerPlugin = this.manager.settings.Plugins.find((mp) => mp.id === plugin.id);
            // 插件是否开启
            const isEnabled = this.settings.DELAY ? ManagerPlugin?.enabled : this.appPlugins.enabledPlugins.has(plugin.id);
            if (ManagerPlugin) {
                // [过滤] 条件
                switch (this.filter) {
                    case "enabled":
                        if (!isEnabled) continue; // 仅显示启用插件
                        break;
                    case "disabled":
                        if (isEnabled) continue; // 仅显示禁用插件
                        break;
                    case "grouped":
                        if (ManagerPlugin.group === "") continue; // 仅显示有分组的插件
                        break;
                    case "ungrouped":
                        if (ManagerPlugin.group !== "") continue; // 仅显示未分组插件
                        break;
                    case "tagged":
                        if (ManagerPlugin.tags.length === 0) continue; // 修正为标签数组长度判断
                        break;
                    case "untagged":
                        if (ManagerPlugin.tags.length > 0) continue;  // 修正为标签数组长度判断
                        break;
                    case "noted":
                        if (!ManagerPlugin.note || ManagerPlugin.note === "") continue; // 新增笔记判断
                        break;
                    default:
                        break; // 其他情况显示所有插件
                }
                // [过滤] 分组 标签 延时
                if (!this.matchesSingleValueFilter(ManagerPlugin.group, this.group, this.groupOperator)) continue;
                if (!this.matchesTagFilter(ManagerPlugin.tags, this.tag, this.tagOperator)) continue;
                if (!this.matchesSingleValueFilter(ManagerPlugin.delay, this.delay, this.delayOperator)) continue;
                // [过滤] 搜索
                if (this.searchText !== "" && ManagerPlugin.name.toLowerCase().indexOf(this.searchText.toLowerCase()) == -1 && ManagerPlugin.desc.toLowerCase().indexOf(this.searchText.toLowerCase()) == -1 && plugin.author.toLowerCase().indexOf(this.searchText.toLowerCase()) == -1) continue;
                // [过滤] 自身
                if (plugin.id === this.manager.manifest.id) continue;

                const itemEl = new Setting(this.contentEl);
                itemEl.setClass("manager-item");
                itemEl.nameEl.addClass("manager-item__name-container");
                itemEl.descEl.addClass("manager-item__description-container");

                // [默认] 分组
                if (ManagerPlugin.group !== "") {
                    const group = createSpan({ cls: "manager-item__name-group", });
                    itemEl.nameEl.appendChild(group);
                    const item = this.settings.GROUPS.find((t) => t.id === ManagerPlugin.group);
                    if (item) { const tag = this.manager.createTag(item.name, item.color, this.settings.GROUP_STYLE); group.appendChild(tag); }
                }

                // [默认] 名称
                const title = createSpan({ text: ManagerPlugin.name, cls: "manager-item__name-title", });
                itemEl.nameEl.appendChild(title);

                // [默认] 版本
                const version = createSpan({ text: `[${plugin.version}]`, cls: ["manager-item__name-version"], });
                itemEl.nameEl.appendChild(version);

                // [默认] 延迟
                if (this.settings.DELAY && ManagerPlugin.delay !== "") {
                    const d = this.settings.DELAYS.find((item) => item.id === ManagerPlugin.delay);
                    if (d) {
                        const delay = createSpan({ text: `${d.time}s`, cls: ["manager-item__name-delay"], });
                        itemEl.nameEl.appendChild(delay);
                    }
                }

                // [默认] 描述
                const desc = createDiv({ text: ManagerPlugin.desc, cls: ["manager-item__name-desc"], });
                itemEl.descEl.appendChild(desc);

                // [默认] 标签组
                const tags = createDiv();
                itemEl.descEl.appendChild(tags);
                ManagerPlugin.tags.map((id: string) => {
                    const item = this.settings.TAGS.find((item) => item.id === id);
                    if (item) { const tag = this.manager.createTag(item.name, item.color, this.settings.TAG_STYLE); tags.appendChild(tag); }
                });

                const hiddenToggle = new ToggleComponent(itemEl.controlEl);
                // 判断当前插件是否在隐藏列表
                const isHidden = this.settings.HIDES.includes(plugin.id);
                hiddenToggle.setValue(isHidden);
                hiddenToggle.onChange((value) => {
                    // 更新隐藏列表
                    if (value) {
                        if (!this.settings.HIDES.includes(plugin.id)) this.settings.HIDES.push(plugin.id);
                    } else {
                        this.settings.HIDES = this.settings.HIDES.filter(id => id !== plugin.id);
                    }
                    this.action(async () => { await this.manager.saveSettings(); })();
                    this.managerModal.refreshPluginCard(plugin.id, { allowReload: true });
                });
            }
        }
    }

    public async reloadShowData() {
        let scrollTop = 0;
        const modalElement: HTMLElement = this.contentEl;
        scrollTop = modalElement.scrollTop;
        modalElement.empty();
        await this.showData();
        modalElement.scrollTo(0, scrollTop);
    }

    public onOpen() {
        this.action(async () => {
            await this.showHead();
            await this.showData();
        })();
    }

    public onClose() {
        this.contentEl.empty();
    }
}
