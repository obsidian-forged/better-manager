import { App, ExtraButtonComponent, Modal, Notice, setIcon, Setting } from "obsidian";
import Manager from "main";
import { ReleaseVersion, fetchReleaseVersions } from "src/github-install";
import { getExtraButtonElement } from "src/obsidian-internals";
import { pickSourceTargetRelease, releaseIsCompatible } from "src/source-release";

export class UpdateModal extends Modal {
    private manager: Manager;
    private pluginId: string;
    private versions: ReleaseVersion[];
    private defaultVersion?: string | null;
    private repo?: string;
    private selectedVersion = "";
    private downloadButton?: HTMLButtonElement;
    private versionListEl?: HTMLElement;

    constructor(app: App, manager: Manager, pluginId: string, versions: ReleaseVersion[], defaultVersion?: string | null, repo?: string) {
        super(app);
        this.manager = manager;
        this.pluginId = pluginId;
        this.versions = versions;
        this.defaultVersion = defaultVersion;
        this.repo = repo;
    }

    async onOpen() {
        const { contentEl } = this;
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const manifest = this.manager.appPlugins.manifests?.[this.pluginId];
        contentEl.empty();
        this.selectedVersion = this.defaultVersion || manifest?.version || (this.versions[0]?.version ?? "");

        const modalEl = contentEl.parentElement;
        modalEl?.addClass("manager-editor__container");
        modalEl?.addClass("manager-version-picker");
        modalEl?.getElementsByClassName("modal-close-button")[0]?.remove();
        this.titleEl.parentElement?.addClass("manager-container__header");
        contentEl.addClass("manager-item-container");
        contentEl.addClass("manager-version-picker__body");

        const titleBar = new Setting(this.titleEl).setClass("manager-bar__title");
        titleBar.settingEl.addClass("manager-version-picker__titlebar");
        titleBar.nameEl.empty();
        titleBar.descEl.empty();
        const titleWrap = titleBar.nameEl.createDiv("manager-version-picker__title");
        const titleIcon = titleWrap.createSpan({ cls: "manager-version-picker__title-icon" });
        setIcon(titleIcon, "package-open");
        const titleText = titleWrap.createDiv("manager-version-picker__title-text");
        titleText.createDiv({ cls: "manager-version-picker__eyebrow", text: t("管理器_选择版本_标题") });
        titleText.createDiv({ cls: "manager-version-picker__plugin-name", text: manifest?.name || this.pluginId });
        titleBar.descEl.setText(t("管理器_选择版本_说明"));
        const closeButton = new ExtraButtonComponent(titleBar.controlEl);
        closeButton.setIcon("x");
        closeButton.setTooltip(t("通用_取消_文本"));
        const closeEl = getExtraButtonElement(closeButton);
        closeEl?.setAttribute("aria-label", t("通用_取消_文本"));
        closeButton.onClick(() => this.close());

        const page = contentEl.createDiv("manager-version-picker__page");
        const summary = page.createDiv("manager-version-picker__summary");
        const summaryMain = summary.createDiv("manager-version-picker__summary-main");
        summaryMain.createDiv({ cls: "manager-version-picker__summary-title", text: t("管理器_选择版本_列表标题") });
        summaryMain.createDiv({
            cls: "manager-version-picker__summary-desc",
            text: t("管理器_选择版本_当前版本", { version: manifest?.version || "-" }),
        });
        const summaryStats = summary.createDiv("manager-version-picker__summary-stats");
        const countStat = summaryStats.createSpan({ cls: "manager-version-picker__summary-stat" });
        setIcon(countStat.createSpan({ cls: "manager-version-picker__summary-stat-icon" }), "tags");
        countStat.createSpan({ text: `${this.versions.length}` });

        this.versionListEl = page.createDiv("manager-version-picker__list");

        let versionList = [...this.versions];
        if (versionList.length === 0 && this.repo) {
            const loading = this.versionListEl.createDiv("manager-version-picker__empty");
            loading.setText(t("管理器_选择版本_获取中"));
            try {
                versionList = await fetchReleaseVersions(this.manager, this.repo, { includeManifest: true });
            } catch (e) {
                console.error("fetch versions in modal failed", e);
                new Notice(t("管理器_选择版本_获取失败提示"), 4000);
            } finally {
                loading.remove();
            }
            this.versions = versionList;
        }

        const hasDefaultVersion = Boolean(this.defaultVersion && versionList.some((release) => release.version === this.defaultVersion));
        const hasLocalVersion = Boolean(manifest?.version && versionList.some((release) => release.version === manifest.version));
        const updateOptions = this.manager.getPluginUpdateCheckOptions();
        const target = this.repo ? pickSourceTargetRelease({
            id: this.pluginId,
            repo: this.repo,
            type: "plugin",
            mode: "latest",
            includePrerelease: false,
            updateCheckMode: updateOptions.updateCheckMode,
            compatibilityMode: updateOptions.compatibilityMode,
            updateDelayDays: updateOptions.updateDelayDays || undefined,
            autoUpdate: false,
            enabled: true,
        }, versionList) : null;
        this.selectedVersion = hasDefaultVersion
            ? this.defaultVersion!
            : target?.tag || (hasLocalVersion ? manifest.version : (versionList[0]?.version ?? ""));
        summaryStats.empty();
        const releaseCount = summaryStats.createSpan({ cls: "manager-version-picker__summary-stat" });
        setIcon(releaseCount.createSpan({ cls: "manager-version-picker__summary-stat-icon" }), "tags");
        releaseCount.createSpan({ text: t("管理器_选择版本_版本数量", { count: versionList.length }) });
        const currentStat = summaryStats.createSpan({ cls: "manager-version-picker__summary-stat" });
        setIcon(currentStat.createSpan({ cls: "manager-version-picker__summary-stat-icon" }), "badge-check");
        currentStat.createSpan({ text: this.selectedVersion || t("管理器_安装_版本_默认最新") });

        if (versionList.length > 0 && this.versionListEl) {
            this.renderVersionList(versionList, manifest?.version || "");
        } else {
            const info = this.versionListEl?.createDiv("manager-version-picker__empty") ?? page.createDiv("manager-version-picker__empty");
            info.setText(t("管理器_选择版本_无版本提示"));
        }

        const footer = new Setting(page);
        footer.settingEl.addClass("manager-version-picker__footer");
        footer.nameEl.empty();
        footer.descEl.empty();
        footer
            .addButton((btn) => {
                btn.setButtonText(t("管理器_选择版本_切换按钮"));
                btn.setCta();
                this.downloadButton = btn.buttonEl;
                btn.setDisabled(!this.selectedVersion);
                btn.onClick(async () => {
                    btn.setDisabled(true);
                    try {
                        const ok = await this.manager.downloadUpdate(this.pluginId, this.selectedVersion);
                        if (ok) {
                            new Notice(t("管理器_选择版本_成功提示"), 3000);
                            this.close();
                        }
                    } finally {
                        btn.setDisabled(false);
                    }
                });
            })
            .addButton((btn) => {
                btn.setButtonText(t("通用_取消_文本"));
                btn.onClick(() => this.close());
            });
    }

    private renderVersionList(versionList: ReleaseVersion[], localVersion: string) {
        if (!this.versionListEl) return;
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        this.versionListEl.empty();
        versionList.forEach((release) => {
            const item = this.versionListEl!.createEl("button", { cls: "manager-version-picker__item" });
            item.type = "button";
            item.toggleClass("is-selected", release.version === this.selectedVersion);
            item.toggleClass("is-current", Boolean(localVersion && release.version === localVersion));
            item.setAttribute("aria-pressed", `${release.version === this.selectedVersion}`);
            item.setAttribute("aria-label", t("管理器_选择版本_选择版本", { version: release.version }));

            const main = item.createDiv("manager-version-picker__item-main");
            const title = main.createDiv("manager-version-picker__item-title");
            title.createSpan({ cls: "manager-version-picker__item-version", text: release.version });
            if (release.version === localVersion) {
                title.createSpan({ cls: "manager-version-picker__badge", text: t("来源_当前") });
            }
            if (release.isGithubLatest) {
                title.createSpan({ cls: "manager-version-picker__badge is-latest", text: t("兼容性_GitHubLatest") });
            }
            title.createSpan({
                cls: `manager-version-picker__badge ${release.prerelease ? "is-prerelease" : "is-stable"}`,
                text: t(release.prerelease ? "安装_发布类型_预发布" : "安装_发布类型_正式版"),
            });
            if (release.minAppVersion) {
                title.createSpan({
                    cls: `manager-version-picker__badge ${releaseIsCompatible(release) ? "is-compatible" : "is-incompatible"}`,
                    text: t(releaseIsCompatible(release) ? "兼容性_兼容" : "兼容性_不兼容"),
                });
            }

            const meta = main.createDiv("manager-version-picker__item-meta");
            if (release.name && release.name !== release.version) meta.createSpan({ text: release.name });
            if (release.minAppVersion) meta.createSpan({ text: t("兼容性_需要版本", { version: release.minAppVersion }) });
            if (release.publishedAt) meta.createSpan({ text: this.formatDate(release.publishedAt) });

            const check = item.createSpan({ cls: "manager-version-picker__item-check" });
            setIcon(check, release.version === this.selectedVersion ? "check" : "circle");

            item.addEventListener("click", () => {
                this.selectedVersion = release.version;
                this.renderVersionList(versionList, localVersion);
                this.downloadButton?.removeAttribute("disabled");
            });
        });
    }

    private formatDate(value: string): string {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleDateString();
    }
}

