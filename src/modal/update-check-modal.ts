import {
    App,
    ButtonComponent,
    DropdownComponent,
    Modal,
    setIcon,
    Setting,
    TextComponent,
} from "obsidian";

import Manager from "main";
import type { ObsidianAppWithInternals } from "../obsidian-internals";
import type { PluginUpdateCheckMode, ReleaseCompatibilityMode } from "../settings/data";

export interface PluginUpdateCheckConfig {
    updateCheckMode: PluginUpdateCheckMode;
    compatibilityMode: ReleaseCompatibilityMode;
    updateDelayDays: number;
}

export const normalizePluginUpdateDelayDays = (value: unknown): number => {
    const days = Math.floor(Number(value));
    return Number.isFinite(days) && days > 0 ? days : 0;
};

export const normalizePluginUpdateCheckMode = (value: unknown): PluginUpdateCheckMode =>
    value === "version" ? "version" : "release";

export const normalizeReleaseCompatibilityMode = (value: unknown): ReleaseCompatibilityMode =>
    value === "all" ? "all" : "compatible";

export const openPluginUpdateCheckModal = (
    app: App,
    manager: Manager,
    initial: PluginUpdateCheckConfig
): Promise<PluginUpdateCheckConfig | null> =>
    new Promise((resolve) => {
        new PluginUpdateCheckModal(app, manager, initial, resolve).open();
    });

class PluginUpdateCheckModal extends Modal {
    private config: PluginUpdateCheckConfig;
    private resolved = false;

    constructor(
        app: App,
        private manager: Manager,
        initial: PluginUpdateCheckConfig,
        private resolve: (config: PluginUpdateCheckConfig | null) => void
    ) {
        super(app);
        this.config = {
            updateCheckMode: normalizePluginUpdateCheckMode(initial.updateCheckMode),
            compatibilityMode: normalizeReleaseCompatibilityMode(initial.compatibilityMode),
            updateDelayDays: normalizePluginUpdateDelayDays(initial.updateDelayDays),
        };
    }

    onOpen() {
        const { contentEl } = this;
        const t = (key: string, vars?: Record<string, string | number | boolean | null | undefined>) =>
            this.manager.translator.t(key, vars);

        contentEl.empty();
        contentEl.addClass("manager-update-check-config");
        this.modalEl.addClass("manager-update-check-config__modal");

        const header = contentEl.createDiv("manager-update-check-config__header");
        const icon = header.createSpan({ cls: "manager-update-check-config__icon" });
        setIcon(icon, "rss");
        const titleGroup = header.createDiv("manager-update-check-config__title-group");
        titleGroup.createEl("h2", { cls: "manager-update-check-config__title", text: t("更新检测配置_标题") });
        titleGroup.createDiv({ cls: "manager-update-check-config__desc", text: t("更新检测配置_说明") });

        const body = contentEl.createDiv("manager-update-check-config__body");

        new Setting(body)
            .setName(t("更新检测配置_数据源_标题"))
            .setDesc(t("更新检测配置_数据源_描述"))
            .addButton((button: ButtonComponent) => {
                button.setButtonText(t("更新检测配置_配置数据源"));
                button.onClick(() => {
                    this.close();
                    const setting = (this.app as ObsidianAppWithInternals).setting;
                    void setting.open().then(() => setting.openTabById(this.manager.manifest.id));
                });
            });

        new Setting(body)
            .setName(t("更新检测配置_方式_标题"))
            .setDesc(t("更新检测配置_方式_描述"))
            .addDropdown((dropdown: DropdownComponent) => {
                dropdown.addOptions({
                    release: t("来源_检测方式_发布顺序"),
                    version: t("来源_检测方式_版本号"),
                });
                dropdown.setValue(this.config.updateCheckMode);
                dropdown.selectEl.setAttribute("aria-label", t("更新检测配置_方式_标题"));
                dropdown.onChange((value) => {
                    this.config.updateCheckMode = normalizePluginUpdateCheckMode(value);
                });
            });

        new Setting(body)
            .setName(t("更新检测配置_兼容性_标题"))
            .setDesc(t("更新检测配置_兼容性_描述"))
            .addDropdown((dropdown: DropdownComponent) => {
                dropdown.addOptions({
                    compatible: t("更新检测配置_兼容性_兼容优先"),
                    all: t("更新检测配置_兼容性_显示全部"),
                });
                dropdown.setValue(this.config.compatibilityMode);
                dropdown.selectEl.setAttribute("aria-label", t("更新检测配置_兼容性_标题"));
                dropdown.onChange((value) => {
                    this.config.compatibilityMode = normalizeReleaseCompatibilityMode(value);
                });
            });

        new Setting(body)
            .setName(t("更新检测配置_延迟_标题"))
            .setDesc(t("更新检测配置_延迟_描述"))
            .addText((text: TextComponent) => {
                text.setValue(this.config.updateDelayDays > 0 ? String(this.config.updateDelayDays) : "0");
                text.inputEl.type = "number";
                text.inputEl.min = "0";
                text.inputEl.step = "1";
                text.inputEl.inputMode = "numeric";
                text.inputEl.setAttribute("aria-label", t("更新检测配置_延迟_标题"));
                text.onChange((value) => {
                    this.config.updateDelayDays = normalizePluginUpdateDelayDays(value);
                });
            });

        const footer = new Setting(contentEl);
        footer.settingEl.addClass("manager-update-check-config__footer");
        footer.nameEl.empty();
        footer.descEl.empty();
        footer
            .addButton((button: ButtonComponent) => {
                button.setButtonText(t("更新检测配置_开始按钮"));
                button.setCta();
                button.buttonEl.setAttribute("aria-label", t("更新检测配置_开始按钮"));
                button.onClick(() => this.submit());
            })
            .addButton((button: ButtonComponent) => {
                button.setButtonText(t("通用_取消_文本"));
                button.onClick(() => this.close());
            });
    }

    onClose() {
        this.contentEl.empty();
        if (!this.resolved) {
            this.resolved = true;
            this.resolve(null);
        }
    }

    private submit() {
        if (this.resolved) return;
        this.resolved = true;
        this.config.updateDelayDays = normalizePluginUpdateDelayDays(this.config.updateDelayDays);
        this.config.compatibilityMode = normalizeReleaseCompatibilityMode(this.config.compatibilityMode);
        this.resolve({ ...this.config });
        this.close();
    }
}
