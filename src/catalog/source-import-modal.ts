import { FloatingScrollbars } from '../ui/floating-scrollbars';
import { App, ButtonComponent, Modal, Platform, Setting, TextAreaComponent, TextComponent, setIcon } from "obsidian";
import type Manager from "main";
import { CatalogService, MAX_SOURCE_BYTES, parseCatalog } from "./catalog";

type ImportMode = "url" | "paste" | "file";
interface SourcePreview {
    value: unknown;
    name: string;
    url?: string;
    catalog: ReturnType<typeof parseCatalog>;
}

/** 导入草稿与校验结果独立于已保存来源 / Drafts and previews stay separate from persisted sources. */
export class CatalogSourceImportModal extends Modal {
    private scrollbars?: FloatingScrollbars;
    private mode: ImportMode = "paste";
    private jsonDraft = "";
    private urlDraft = "";
    private file?: File;
    private preview?: SourcePreview;
    private closed = false;
    private busy = false;
    private status!: HTMLElement;
    private previewEl!: HTMLElement;
    private importButton!: ButtonComponent;
    private controls: (ButtonComponent | TextAreaComponent | TextComponent)[] = [];
    private fileInput?: HTMLInputElement;

    constructor(app: App, private manager: Manager, private service: CatalogService, private imported: () => void) { super(app); }
    private t(key: string, vars?: Record<string, string | number>): string { return this.manager.translator.t(key, vars); }

    public onOpen(): void {
        this.scrollbars?.destroy();
        this.scrollbars = new FloatingScrollbars(this.modalEl);
        this.closed = false;
        this.modalEl.addClass("manager-container", "manager-note__container", "manager-catalog-import");
        this.modalEl.toggleClass("manager-container--mobile", Platform.isMobileApp);
        this.titleEl.setText(this.t("目录_添加源"));
        this.contentEl.addClass("manager-note__body", "manager-item-container");
        this.render();
    }

    private button(parent: HTMLElement, label: string, icon: string, click: () => void): ButtonComponent {
        const button = new ButtonComponent(parent).setIcon(icon).setTooltip(label).onClick(click);
        button.buttonEl.createSpan({ text: label });
        button.buttonEl.setAttribute("aria-label", label);
        this.controls.push(button);
        return button;
    }

    private invalidate(): void {
        this.preview = undefined;
        this.previewEl.empty();
        this.status.setText(this.t("目录_等待校验"));
        this.status.setAttribute("role", "status");
        this.importButton.setDisabled(true);
    }

    private render(): void {
        this.contentEl.empty();
        this.controls = [];
        this.fileInput = undefined;
        const page = this.contentEl.createDiv("manager-note__page");
        const header = new Setting(page).setName(this.t("目录_导入方式")).setDesc(this.t("目录_导入预览说明")).setHeading();
        this.button(header.controlEl, this.t("目录_校验"), "scan-text", () => { void this.validate(); });
        this.importButton = this.button(header.controlEl, this.t("目录_导入"), "download", () => { void this.commit(); }).setCta();
        this.importButton.setDisabled(!this.preview);
        const modes = page.createDiv("manager-repo-page__switcher");
        modes.setAttribute("role", "group");
        modes.setAttribute("aria-label", this.t("目录_导入方式"));
        for (const [mode, key, icon] of [["url", "目录_URL", "link"], ["paste", "目录_粘贴", "braces"], ["file", "目录_文件", "file-json"]] as const) {
            const button = this.button(modes, this.t(key), icon, () => {
                this.mode = mode;
                this.preview = undefined;
                this.render();
            });
            button.buttonEl.addClass("manager-repo-page__switch");
            button.buttonEl.toggleClass("is-active", mode === this.mode);
            button.buttonEl.setAttribute("aria-pressed", `${mode === this.mode}`);
        }
        if (this.mode === "url") {
            new Setting(page).setName(this.t("目录_URL")).setDesc(this.t("目录_URL说明")).addText(input => {
                input.setPlaceholder("https://example.org/catalog.json").setValue(this.urlDraft).onChange(value => { this.urlDraft = value; this.invalidate(); });
                input.inputEl.type = "url";
                input.inputEl.setAttribute("aria-label", this.t("目录_URL"));
                this.controls.push(input);
            });
        } else if (this.mode === "paste") this.renderEditor(page);
        else this.renderFile(page);
        const format = page.createEl("details", { cls: "manager-transfer-card" });
        format.createEl("summary", { text: this.t("目录_格式说明") });
        format.createEl("p", { cls: "setting-item-description", text: this.t("目录_格式提示") });
        this.status = page.createDiv({ cls: "setting-item-description", attr: { role: "status", "aria-live": "polite" } });
        this.previewEl = page.createDiv("manager-catalog-import__preview");
        if (this.preview) this.renderPreview();
        else this.status.setText(this.t("目录_等待校验"));
    }

    private renderEditor(parent: HTMLElement): void {
        const editor = parent.createDiv("manager-note__editor");
        const header = editor.createDiv("manager-note__editor-head");
        const title = header.createDiv("manager-note__editor-title");
        setIcon(title.createSpan("manager-note__editor-icon"), "braces");
        title.createSpan({ text: this.t("目录_JSON编辑") });
        const actions = header.createDiv("manager-source-page__actions");
        const input = new TextAreaComponent(editor).setValue(this.jsonDraft).setPlaceholder(this.t("目录_JSON占位"));
        input.inputEl.addClass("manager-note__textarea");
        input.inputEl.setAttribute("aria-label", this.t("目录_JSON编辑"));
        input.inputEl.spellcheck = false;
        this.controls.push(input);
        this.button(actions, this.t("目录_格式化"), "align-left", () => {
            void this.run(async () => {
                this.assertSize(this.jsonDraft);
                const value: unknown = JSON.parse(this.jsonDraft);
                this.jsonDraft = JSON.stringify(value, null, 2);
                input.setValue(this.jsonDraft);
                this.invalidate();
            });
        });
        // 只在空草稿中填入示例，避免覆盖用户输入 / Insert examples only into empty drafts.
        const example = this.button(actions, this.t("目录_填入示例"), "file-plus", () => {
            if (this.jsonDraft.trim()) return;
            this.jsonDraft = JSON.stringify({ schemaVersion: 1, name: this.t("目录_示例源"), plugins: [{
                id: "example-plugin", name: "Example plugin", author: "Example author", version: "1.0.0",
                description: this.t("目录_示例说明"), openness: "unknown", tags: ["Writing"], features: ["Offline"],
            }] }, null, 2);
            input.setValue(this.jsonDraft);
            this.invalidate();
            example.setDisabled(true);
        }).setDisabled(Boolean(this.jsonDraft.trim()));
        input.onChange(value => { this.jsonDraft = value; example.setDisabled(Boolean(value.trim())); this.invalidate(); });
    }

    private renderFile(parent: HTMLElement): void {
        const card = parent.createDiv("manager-source-card");
        const row = new Setting(card).setName(this.t("目录_文件")).setDesc(this.file?.name || this.t("目录_文件说明"));
        const input = card.createEl("input", { type: "file", attr: { accept: ".json,application/json", "aria-label": this.t("目录_文件") } });
        input.addClass("manager-catalog-import__file-input");
        this.fileInput = input;
        this.button(row.controlEl, this.t("目录_选择文件"), "folder-open", () => input.click());
        input.addEventListener("change", () => {
            this.file = input.files?.[0];
            row.setDesc(this.file?.name || this.t("目录_文件说明"));
            this.invalidate();
            if (this.file) void this.validate();
        });
    }

    private assertSize(value: string): void {
        if (new TextEncoder().encode(value).byteLength > MAX_SOURCE_BYTES) throw new Error(this.t("目录_文件过大"));
    }

    private async run(action: () => Promise<void>): Promise<void> {
        if (this.busy || this.closed) return;
        this.busy = true;
        const disabled = this.controls.map(control => control instanceof ButtonComponent ? control.buttonEl.disabled : control.inputEl.disabled);
        this.controls.forEach(control => control.setDisabled(true));
        if (this.fileInput) this.fileInput.disabled = true;
        this.status.setText(this.t("目录_加载"));
        this.status.setAttribute("role", "status");
        try { await action(); }
        catch (error) {
            if (!this.closed) {
                this.status.setText(this.t("目录_失败", { message: error instanceof Error ? error.message : "Unknown error" }));
                this.status.setAttribute("role", "alert");
            }
            if (this.manager.settings.DEBUG) console.error("[BPM] Catalog source import failed", error);
        } finally {
            this.busy = false;
            if (!this.closed) {
                this.controls.forEach((control, index) => control.setDisabled(disabled[index]));
                if (this.fileInput) this.fileInput.disabled = false;
                this.importButton.setDisabled(!this.preview);
            }
        }
    }

    private async validate(): Promise<void> {
        await this.run(async () => {
            this.preview = undefined;
            this.previewEl.empty();
            let result: SourcePreview;
            if (this.mode === "url") {
                const task = this.manager.tasks.start({ title: this.t("任务_下载目录数据"), progress: 0.1 });
                try {
                    result = await this.service.previewUrl(this.urlDraft);
                    task.done();
                } catch (error) {
                    task.fail();
                    throw error;
                }
            } else {
                const file = this.mode === "file" ? this.file : undefined;
                if (this.mode === "file" && !file) throw new Error(this.t("目录_选择文件"));
                if (file && file.size > MAX_SOURCE_BYTES) throw new Error(this.t("目录_文件过大"));
                const raw = file ? await file.text() : this.jsonDraft;
                this.assertSize(raw);
                const value: unknown = JSON.parse(raw);
                const name = file?.name || this.t("目录_粘贴");
                result = { value, name, catalog: parseCatalog(value, name) };
            }
            if (this.closed) return;
            this.preview = result;
            this.status.setText(this.t("目录_校验通过"));
            this.renderPreview();
        });
    }

    private renderPreview(): void {
        if (!this.preview) return;
        this.previewEl.empty();
        const { catalog, url } = this.preview;
        const card = this.previewEl.createDiv("manager-source-card");
        new Setting(card).setName(catalog.name).setDesc(this.t("目录_预览数量", { count: catalog.plugins.length })).setHeading();
        const chips = card.createDiv("manager-plugin-card__tags");
        for (const [value, key] of [["open-source", "目录_开源"], ["closed-source", "目录_闭源"], ["unknown", "目录_未知"]] as const) {
            chips.createSpan({ cls: "manager-tag manager-theme-card__chip", text: `${this.t(key)} ${catalog.plugins.filter(plugin => plugin.openness === value).length}` });
        }
        if (url) card.createDiv({ cls: "setting-item-description", text: url });
        const samples = card.createEl("ul");
        for (const plugin of catalog.plugins.slice(0, 3)) samples.createEl("li", { text: `${plugin.name} · ${plugin.id}` });
        const id = url ? `url:${url}` : `file:${catalog.name}`;
        if (this.service.getSources().some(source => source.id === id)) card.createDiv({ cls: "mod-warning", text: this.t("目录_替换说明") });
    }

    private async commit(): Promise<void> {
        if (!this.preview) return;
        const preview = this.preview;
        await this.run(async () => {
            await this.service.importSource(preview.value, preview.name, preview.url);
            if (!this.closed) { this.imported(); this.close(); }
        });
    }

    public onClose(): void {
        this.scrollbars?.destroy();
        this.scrollbars = undefined;
        this.closed = true;
        this.contentEl.empty();
    }
}
