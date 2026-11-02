import {
    App,
    Modal,
    Setting,
    setIcon,
    TextAreaComponent,
} from "obsidian";
import { ManagerSettings } from "../settings/data";
import Manager from "main";
import { ManagerPlugin } from "src/data/types";
import type { ManagerModal } from "./manager-modal";

export class NoteModal extends Modal {
    settings: ManagerSettings;
    manager: Manager;
    managerPlugin: ManagerPlugin;
    managerModal: ManagerModal;
    private textArea?: TextAreaComponent;
    private saveStatusEl?: HTMLElement;
    private charCountEl?: HTMLElement;
    private saveTimer?: number;
    private saveRevision = 0;
    private isSaving = false;
    private saveQueued = false;

    constructor(app: App, manager: Manager, managerPlugin: ManagerPlugin, managerModal: ManagerModal) {
        super(app);
        this.settings = manager.settings;
        this.manager = manager;
        this.managerPlugin = managerPlugin;
        this.managerModal = managerModal;
    }

    private t(key: string, vars?: Record<string, string | number | boolean | null | undefined>) {
        return this.manager.translator.t(key, vars);
    }

    private getGroupName(): string {
        const groupId = this.managerPlugin.group;
        if (!groupId) return this.t("通用_无分组_文本");
        return this.settings.GROUPS.find((group) => group.id === groupId)?.name || groupId;
    }

    private countChars(value: string): number {
        return Array.from(value || "").length;
    }

    private setSaveState(state: "dirty" | "saving" | "saved" | "error") {
        if (!this.saveStatusEl) return;
        const statusText = {
            dirty: this.t("笔记编辑_状态_编辑中"),
            saving: this.t("笔记编辑_状态_保存中"),
            saved: this.t("笔记编辑_状态_已保存"),
            error: this.t("笔记编辑_状态_保存失败"),
        }[state];
        const statusIcon = {
            dirty: "circle-ellipsis",
            saving: "loader",
            saved: "check",
            error: "circle-alert",
        }[state];
        this.saveStatusEl.empty();
        this.saveStatusEl.removeClass("is-dirty", "is-saving", "is-saved", "is-error");
        this.saveStatusEl.addClass(`is-${state}`);
        const iconEl = this.saveStatusEl.createSpan("manager-note__status-icon");
        setIcon(iconEl, statusIcon);
        this.saveStatusEl.createSpan({ text: statusText });
    }

    private updateCharCount(value: string) {
        this.charCountEl?.setText(this.t("笔记编辑_字符数", { count: this.countChars(value) }));
    }

    private scheduleSave() {
        this.saveRevision++;
        this.setSaveState("dirty");
        if (this.saveTimer) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = undefined;
            void this.persistNote();
        }, 500);
    }

    private async persistNote() {
        if (this.isSaving) {
            this.saveQueued = true;
            return;
        }

        const revision = this.saveRevision;
        this.isSaving = true;
        this.setSaveState("saving");
        try {
            await this.manager.savePluginAndExport(this.managerPlugin.id);
            this.managerModal.refreshPluginCard(this.managerPlugin.id, { allowReload: true });
            if (this.saveRevision === revision && !this.saveQueued) {
                this.setSaveState("saved");
            }
        } catch (error) {
            console.error("[BPM] failed to save plugin note", error);
            this.setSaveState("error");
        } finally {
            this.isSaving = false;
            if (this.saveQueued || this.saveRevision !== revision) {
                this.saveQueued = false;
                void this.persistNote();
            }
        }
    }

    private async flushPendingSave() {
        if (!this.saveTimer) return;
        window.clearTimeout(this.saveTimer);
        this.saveTimer = undefined;
        await this.persistNote();
    }

    private async showHead() {
        const modalEl = this.contentEl.parentElement;
        if (!modalEl) return;
        modalEl.addClass("manager-note__container");
        this.titleEl.empty();
        this.titleEl.parentElement?.addClass("manager-container__header");
        this.contentEl.addClass("manager-item-container");
        this.contentEl.addClass("manager-note__body");

        const titleBar = new Setting(this.titleEl).setClass("manager-bar__title");
        titleBar.settingEl.addClass("manager-note__titlebar");
        titleBar.nameEl.empty();
        titleBar.descEl.empty();

        const titleWrap = titleBar.nameEl.createDiv("manager-note__title");
        const titleIcon = titleWrap.createSpan("manager-note__title-icon");
        setIcon(titleIcon, "notebook-pen");
        const titleText = titleWrap.createDiv("manager-note__title-text");
        titleText.createDiv({ cls: "manager-note__eyebrow", text: this.t("笔记编辑_标题") });
        titleText.createDiv({ cls: "manager-note__plugin-name", text: this.managerPlugin.name || this.managerPlugin.id });
        titleBar.descEl.setText(this.t("笔记编辑_说明"));

    }

    private async showData() {
        const page = this.contentEl.createDiv("manager-note__page");
        const summary = page.createDiv("manager-note__summary");
        const summaryMain = summary.createDiv("manager-note__summary-main");
        const summaryIcon = summaryMain.createSpan("manager-note__summary-icon");
        setIcon(summaryIcon, "info");
        const summaryText = summaryMain.createDiv("manager-note__summary-text");
        summaryText.createDiv({ cls: "manager-note__summary-title", text: this.t("笔记编辑_插件信息") });
        summaryText.createDiv({ cls: "manager-note__summary-desc", text: this.managerPlugin.id });

        const summaryStats = summary.createDiv("manager-note__summary-stats");
        this.createStatChip(summaryStats, "power", this.managerPlugin.enabled ? this.t("通用_启用_文本") : this.t("通用_禁用_文本"));
        this.createStatChip(summaryStats, "folder", this.getGroupName());
        this.createStatChip(summaryStats, "tags", this.t("笔记编辑_标签数", { count: this.managerPlugin.tags.length }));
        this.charCountEl = this.createStatChip(summaryStats, "pilcrow", "");
        this.updateCharCount(this.managerPlugin.note);

        const editor = page.createDiv("manager-note__editor");
        const editorHead = editor.createDiv("manager-note__editor-head");
        const editorTitle = editorHead.createDiv("manager-note__editor-title");
        const editorIcon = editorTitle.createSpan("manager-note__editor-icon");
        setIcon(editorIcon, "file-pen-line");
        editorTitle.createSpan({ text: this.t("笔记编辑_编辑区") });
        this.saveStatusEl = editorHead.createDiv("manager-note__status");
        this.saveStatusEl.setAttribute("aria-live", "polite");
        this.setSaveState("saved");

        const textArea = new TextAreaComponent(editor);
        this.textArea = textArea;
        textArea.setValue(this.managerPlugin.note);
        textArea.setPlaceholder(this.t("笔记编辑_占位符"));
        textArea.inputEl.addClass("manager-note__textarea");
        textArea.inputEl.setAttribute("aria-label", this.t("笔记编辑_编辑区"));
        textArea.onChange((newValue) => {
            this.managerPlugin.note = newValue;
            this.updateCharCount(newValue);
            this.scheduleSave();
        });

        const footer = editor.createDiv("manager-note__footer");
        footer.createSpan({ cls: "manager-note__footer-text", text: this.t("笔记编辑_自动保存提示") });
    }

    private createStatChip(container: HTMLElement, icon: string, text: string): HTMLElement {
        const chip = container.createSpan("manager-note__stat");
        const iconEl = chip.createSpan("manager-note__stat-icon");
        setIcon(iconEl, icon);
        return chip.createSpan({ cls: "manager-note__stat-text", text });
    }

    private async reloadShowData() {
        const modalElement: HTMLElement = this.contentEl;
        const scrollTop = modalElement.scrollTop;
        modalElement.empty();
        await this.showData();
        modalElement.scrollTo(0, scrollTop);
    }

    onOpen() {
        void (async () => {
            await this.showHead();
            await this.showData();
            this.textArea?.inputEl.focus();
        })();
    }

    onClose() {
        void this.flushPendingSave();
        if (this.saveTimer) window.clearTimeout(this.saveTimer);
        this.contentEl.empty();
    }
}
