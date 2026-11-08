import { App, ButtonComponent, Modal, Notice, Platform, Setting, setIcon } from "obsidian";
import type Manager from "main";

export type ConfirmModalOptions = {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    /** 主要操作使用警示色；默认开启，统一确认弹窗的视觉。 */
    tone?: "warning" | "default";
    /** 可选复选项，例如“同时删除旧缓存”。 */
    checkboxLabel?: string;
    checkboxDefault?: boolean;
};
export interface ConfirmResult { confirmed: boolean; checked: boolean; }

class ManagerConfirmModal extends Modal {
    private readonly manager: Manager;
    private readonly options: ConfirmModalOptions;
    private readonly resolve: (result: ConfirmResult) => void;
    private resolved = false;
    private checked: boolean;

    constructor(app: App, manager: Manager, options: ConfirmModalOptions, resolve: (result: ConfirmResult) => void) {
        super(app);
        this.manager = manager;
        this.options = options;
        this.resolve = resolve;
        this.checked = options.checkboxDefault === true;
    }

    onOpen() {
        const { contentEl } = this;
        const t = (key: string) => this.manager.translator.t(key);
        const modalEl = contentEl.parentElement;
        modalEl?.addClass("manager-confirm-modal");
        this.titleEl.empty();
        this.titleEl.hide();

        contentEl.empty();
        contentEl.addClass("manager-confirm-modal__content");
        const messageRow = contentEl.createDiv("manager-confirm-modal__message");
        const iconEl = messageRow.createSpan("manager-confirm-modal__icon");
        setIcon(iconEl, "help-circle");
        messageRow.createSpan({ cls: "manager-confirm-modal__text", text: this.options.message });

        if (this.options.checkboxLabel) {
            new Setting(contentEl)
                .setName(this.options.checkboxLabel)
                .addToggle(toggle => toggle.setValue(this.checked).onChange(value => { this.checked = value; }));
        }

        const actions = contentEl.createDiv("manager-confirm-modal__actions");
        new ButtonComponent(actions)
            .setButtonText(this.options.cancelText || t("通用_取消_文本"))
            .onClick(() => this.finish(false));
        const confirm = new ButtonComponent(actions)
            .setButtonText(this.options.confirmText || t("通用_确认_文本"))
            .onClick(() => this.finish(true));
        if (this.options.tone === "default") confirm.setCta();
        else confirm.buttonEl.addClass('mod-warning');
        confirm.buttonEl.focus();
    }

    onClose() {
        this.contentEl.empty();
        this.finish(false);
    }

    private finish(confirmed: boolean) {
        if (this.resolved) return;
        this.resolved = true;
        this.resolve({ confirmed, checked: confirmed && this.checked });
        this.close();
    }
}

export const confirmWithModal = (app: App, manager: Manager, options: ConfirmModalOptions | string): Promise<boolean> => {
    const modalOptions = typeof options === "string" ? { message: options } : options;
    return new Promise((resolve) => {
        new ManagerConfirmModal(app, manager, modalOptions, result => resolve(result.confirmed)).open();
    });
};

/** 带复选项的确认框；Confirmation with an optional checkbox (e.g. delete the old cache). */
export const confirmWithCheckbox = (app: App, manager: Manager, options: ConfirmModalOptions & { checkboxLabel: string }): Promise<ConfirmResult> => {
    return new Promise((resolve) => {
        new ManagerConfirmModal(app, manager, options, resolve).open();
    });
};

export const managerOpen = (dir: string, manager: Manager) => {
    if (Platform.isMobileApp) {
        new Notice(manager.translator.t("通用_移动端不支持打开文件夹_提示"));
        return;
    }

    // Electron 只在桌面操作时加载 / Mobile never evaluates the desktop dependency.
    void import('electron').then(({ shell }) => shell.openPath(dir))
        .then((error) => {
            new Notice(manager.translator.t(error ? "通用_失败_文本" : "通用_成功_文本"));
        })
        .catch((error) => {
            if (manager.settings.DEBUG) console.error("打开目录失败", error);
            new Notice(manager.translator.t("通用_失败_文本"));
        });
};
