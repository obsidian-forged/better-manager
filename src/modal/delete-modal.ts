import { App, ButtonComponent, ExtraButtonComponent, Modal, Notice, Setting, setIcon } from "obsidian";
import { ManagerSettings } from "../settings/data";
import Manager from "main";
import { getExtraButtonElement } from "src/obsidian-internals";

type DeleteTarget = {
    id?: string;
    name?: string;
};

export class DeleteModal extends Modal {
    settings: ManagerSettings;
    manager: Manager;

    private deleteCallback: () => void | Promise<void>;
    private target: DeleteTarget;
    private isDeleting = false;
    private confirmButton?: ButtonComponent;
    private cancelButton?: ButtonComponent;

    constructor(app: App, manager: Manager, deleteCallback: () => void | Promise<void>, target: DeleteTarget = {}) {
        super(app);
        this.manager = manager;
        this.settings = manager.settings;
        this.deleteCallback = deleteCallback;
        this.target = target;
    }

    private t(key: string, vars?: Record<string, string | number | boolean | null | undefined>) {
        return this.manager.translator.t(key, vars);
    }

    private getExtraButtonEl(button: ExtraButtonComponent): HTMLElement | undefined {
        return getExtraButtonElement(button);
    }

    private prepareIconButton(button: ExtraButtonComponent, label: string, className?: string) {
        button.setTooltip(label);
        const buttonEl = this.getExtraButtonEl(button);
        buttonEl?.setAttribute("aria-label", label);
        if (className) buttonEl?.addClass(className);
    }

    private setBusy(busy: boolean) {
        this.isDeleting = busy;
        this.confirmButton?.setDisabled(busy);
        this.cancelButton?.setDisabled(busy);
        this.confirmButton?.setIcon(busy ? "loader" : "trash-2");
        this.confirmButton?.setButtonText(busy ? this.t("卸载_执行中") : this.t("卸载_卸载"));
        this.confirmButton?.buttonEl.toggleClass("is-loading", busy);
        this.confirmButton?.buttonEl.setAttribute("aria-busy", `${busy}`);
    }

    private async runDelete() {
        if (this.isDeleting) return;
        this.setBusy(true);
        try {
            await this.deleteCallback();
            this.close();
        } catch (error) {
            if (this.manager.settings.DEBUG) console.error("[BPM] uninstall plugin failed", error);
            new Notice(`${this.t('安装_错误_通用')} ${error instanceof Error ? error.message : ''}`);
            this.setBusy(false);
        }
    }

    private showHead(): void {
        const modalEl = this.contentEl.parentElement;
        if (!modalEl) return;
        modalEl.addClass("manager-delete__container");
        modalEl.getElementsByClassName("modal-close-button")[0]?.remove();
        this.titleEl.empty();
        this.titleEl.parentElement?.addClass("manager-container__header");
        this.contentEl.addClass("manager-item-container");
        this.contentEl.addClass("manager-delete__body");

        const titleBar = new Setting(this.titleEl).setClass("manager-delete__titlebar");
        titleBar.nameEl.empty();
        titleBar.descEl.empty();

        const titleWrap = titleBar.nameEl.createDiv("manager-delete__title");
        const titleIcon = titleWrap.createSpan("manager-delete__title-icon");
        setIcon(titleIcon, "trash-2");
        const titleText = titleWrap.createDiv("manager-delete__title-text");
        titleText.createDiv({ cls: "manager-delete__eyebrow", text: this.t("卸载_危险操作") });
        titleText.createDiv({ cls: "manager-delete__heading", text: this.t("卸载_标题") });
        titleBar.descEl.setText(this.t("卸载_说明"));

        const closeButton = new ExtraButtonComponent(titleBar.controlEl);
        closeButton.setIcon("x");
        this.prepareIconButton(closeButton, this.t("通用_关闭_文本"), "manager-delete__close-button");
        closeButton.onClick(() => this.close());
    }

    private showData(): void {
        const pluginName = this.target.name || this.target.id || this.t("卸载_未知插件");
        const pluginId = this.target.id || "";
        const page = this.contentEl.createDiv("manager-delete__page");

        const warning = page.createDiv("manager-delete__warning");
        const warningIcon = warning.createSpan("manager-delete__warning-icon");
        setIcon(warningIcon, "triangle-alert");
        const warningText = warning.createDiv("manager-delete__warning-text");
        warningText.createDiv({ cls: "manager-delete__warning-title", text: this.t("卸载_确认标题") });
        warningText.createDiv({ cls: "manager-delete__warning-desc", text: this.t("卸载_提示") });

        const targetCard = page.createDiv("manager-delete__target");
        const targetIcon = targetCard.createSpan("manager-delete__target-icon");
        setIcon(targetIcon, "package-x");
        const targetText = targetCard.createDiv("manager-delete__target-text");
        targetText.createDiv({ cls: "manager-delete__target-label", text: this.t("卸载_目标插件") });
        targetText.createDiv({ cls: "manager-delete__target-name", text: pluginName });
        if (pluginId) targetText.createDiv({ cls: "manager-delete__target-id", text: pluginId });

        const impact = page.createDiv("manager-delete__impact");
        const impactItems = [
            this.t("卸载_影响_文件夹"),
            this.t("卸载_影响_需重新安装"),
        ];
        impactItems.forEach((text) => {
            const item = impact.createDiv("manager-delete__impact-item");
            const icon = item.createSpan("manager-delete__impact-icon");
            setIcon(icon, "dot");
            item.createSpan({ text });
        });

        const actionBar = new Setting(page).setClass("manager-delete__action");
        actionBar.settingEl.addClass("manager-delete__actions");
        actionBar.nameEl.empty();
        actionBar.descEl.empty();
        actionBar.addButton((button) => {
            this.cancelButton = button;
            button
                .setButtonText(this.t("卸载_取消"))
                .setTooltip(this.t("卸载_取消"))
                .setClass("manager-delete__cancel-button")
                .onClick(() => this.close());
            button.buttonEl.setAttribute("aria-label", this.t("卸载_取消"));
        });
        actionBar.addButton((button) => {
            this.confirmButton = button;
            button
                .setIcon("trash-2")
                .setButtonText(this.t("卸载_卸载"))
                .setTooltip(this.t("卸载_卸载确认", { name: pluginName }))
                .setClass("manager-delete__confirm-button")
                .onClick(() => void this.runDelete());
            button.buttonEl.setAttribute("aria-label", this.t("卸载_卸载确认", { name: pluginName }));
        });
    }

    onOpen(): void {
        this.showHead();
        this.showData();
        this.cancelButton?.buttonEl.focus();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
