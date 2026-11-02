import { getIcon, setIcon } from "obsidian";
import type Manager from "main";
import type { BackgroundTaskSnapshot } from "../tasks/task-center";

/**
 * 管理器顶栏的后台任务入口 / Background task entry in the manager toolbar.
 *
 * 图标语义：在线下载与耗时进度任务。点击后把列表放进 body 上的浮动容器，
 * 避免被管理器的滚动容器裁切；进行中的任务没有移除按钮。
 */
const pickIcon = (...names: string[]): string => {
    const available = typeof getIcon === "function";
    return names.find(name => available && getIcon(name) !== null) ?? names[names.length - 1];
};

const TASK_ICON = pickIcon("cloud-download", "download-cloud", "download");
const SPINNER_ICON = pickIcon("loader", "loader-circle", "refresh-cw");
const DONE_ICON = pickIcon("check", "circle-check");
const ERROR_ICON = pickIcon("alert-triangle", "circle-alert");

let panelSequence = 0;

export class TaskCenterView {
    private readonly doc: Document;
    private readonly win: Window | null;
    private readonly button: HTMLElement;
    private readonly externalAnchor: boolean;
    private readonly dot: HTMLElement;
    private readonly panel: HTMLElement;
    private readonly listEl: HTMLElement;
    private readonly emptyEl: HTMLElement;
    private readonly countEl: HTMLElement;
    private readonly unsubscribe: () => void;
    private open = false;
    private destroyed = false;

    constructor(private manager: Manager, host: HTMLElement, anchor?: HTMLElement) {
        this.doc = host.ownerDocument;
        this.win = this.doc.defaultView;
        this.externalAnchor = !!anchor;
        this.button = anchor ?? host.createDiv("manager-setting__tasks").createEl("button", {
            cls: "manager-setting__tasks-button manager-global-tool",
            attr: { type: "button", "aria-haspopup": "true", "aria-expanded": "false" },
        });
        if (!anchor) setIcon(this.button, TASK_ICON);
        this.dot = this.button.createSpan("manager-setting__tasks-dot");

        const panelId = `bpm-task-panel-${++panelSequence}`;
        this.button.setAttribute("aria-controls", panelId);

        this.panel = this.doc.body.createDiv("manager-setting__task-panel is-hidden");
        this.panel.id = panelId;
        this.panel.setAttribute("role", "region");
        this.panel.setAttribute("aria-label", this.t("任务_标题"));
        const head = this.panel.createDiv("manager-setting__task-panel-head");
        head.createSpan({ cls: "manager-setting__task-panel-title", text: this.t("任务_标题") });
        this.countEl = head.createSpan("manager-setting__task-panel-count");
        this.listEl = this.panel.createDiv("manager-setting__task-list");
        this.emptyEl = this.listEl.createDiv({ cls: "manager-setting__task-empty", text: this.t("任务_空") });

        if (!anchor) this.button.addEventListener("click", this.onButtonClick);
        this.unsubscribe = this.manager.tasks.subscribe(this.onTasksChanged);
        this.onTasksChanged();
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.setOpen(false);
        this.unsubscribe();
        this.button.removeEventListener("click", this.onButtonClick);
        this.panel.remove();
        this.dot.remove();
        this.button.removeClass('has-running');
        if (!this.externalAnchor) this.button.parentElement?.remove();
    }

    public show(): void { if (!this.destroyed) this.setOpen(true); }

    private t(key: string, vars?: Record<string, string | number>): string {
        return this.manager.translator.t(key, vars);
    }

    private readonly onButtonClick = (): void => {
        this.setOpen(!this.open);
    };

    private readonly onTasksChanged = (): void => {
        if (this.destroyed) return;
        const running = this.manager.tasks.runningCount();
        this.button.toggleClass("has-running", running > 0);
        if (!this.externalAnchor) this.button.setAttribute("aria-label", running > 0 ? `${this.t("任务_标题")} · ${running}` : this.t("任务_标题"));
        if (this.open) {
            this.renderList();
            this.positionPanel();
        }
    };

    private renderList(): void {
        const tasks = this.manager.tasks.snapshots();
        const running = tasks.filter(task => task.status === "running").length;
        this.countEl.setText(running > 0 ? this.t("任务_进行中数量", { count: running }) : "");
        this.emptyEl.toggleClass("is-hidden", tasks.length > 0);
        this.listEl.querySelectorAll(".manager-setting__task").forEach(row => row.remove());
        for (const task of tasks) this.renderTask(task);
    }

    private renderTask(task: BackgroundTaskSnapshot): void {
        const row = this.listEl.createDiv("manager-setting__task");
        row.toggleClass("is-running", task.status === "running");
        row.toggleClass("is-done", task.status === "done");
        row.toggleClass("is-error", task.status === "error");

        const icon = row.createSpan("manager-setting__task-icon");
        setIcon(icon, task.status === "running" ? SPINNER_ICON : task.status === "done" ? DONE_ICON : ERROR_ICON);

        const body = row.createDiv("manager-setting__task-body");
        const titleRow = body.createDiv("manager-setting__task-title-row");
        titleRow.createSpan({ cls: "manager-setting__task-title", text: task.title });
        const percent = Math.round(task.progress * 100);
        titleRow.createSpan({ cls: "manager-setting__task-percent", text: `${percent}%` });

        const bar = body.createDiv("manager-setting__task-bar");
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-label", task.title);
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", "100");
        bar.setAttribute("aria-valuenow", `${percent}`);
        bar.createDiv("manager-setting__task-fill").setCssStyles({ width: `${percent}%` });

        // 只有结束的任务可以移除；进行中不提供叉号 / Dismiss only after the task settles.
        if (task.status === "running") return;
        const dismiss = row.createEl("button", {
            cls: "manager-setting__task-dismiss",
            attr: { type: "button", "aria-label": this.t("任务_移除") },
        });
        setIcon(dismiss, "x");
        dismiss.addEventListener("click", () => {
            this.manager.tasks.dismiss(task.id);
        });
    }

    private setOpen(open: boolean): void {
        if (this.open === open) return;
        this.open = open;
        this.button.toggleClass("is-open", open);
        this.button.setAttribute("aria-expanded", `${open}`);
        this.panel.toggleClass("is-hidden", !open);
        if (open) {
            this.renderList();
            this.positionPanel();
            this.doc.addEventListener("pointerdown", this.onDocumentPointerDown, true);
            this.doc.addEventListener("keydown", this.onKeyDown);
            this.doc.addEventListener("scroll", this.onDocumentScroll, true);
            this.win?.addEventListener("resize", this.onWindowResize);
        } else {
            this.doc.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
            this.doc.removeEventListener("keydown", this.onKeyDown);
            this.doc.removeEventListener("scroll", this.onDocumentScroll, true);
            this.win?.removeEventListener("resize", this.onWindowResize);
        }
    }

    private positionPanel(): void {
        if (!this.open || !this.button.isConnected) return;
        const rect = this.button.getBoundingClientRect();
        const panelRect = this.panel.getBoundingClientRect();
        const margin = 8;
        const viewportWidth = this.win?.innerWidth ?? this.doc.documentElement.clientWidth;
        const viewportHeight = this.win?.innerHeight ?? this.doc.documentElement.clientHeight;
        const width = panelRect.width || 320;
        const height = panelRect.height;
        const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
        let top = rect.bottom + 6;
        if (height && top + height > viewportHeight - margin) {
            const above = rect.top - height - 6;
            top = above >= margin ? above : Math.max(margin, viewportHeight - height - margin);
        }
        this.panel.setCssStyles({ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
    }

    private readonly onDocumentPointerDown = (event: PointerEvent): void => {
        const target = event.target as Node | null;
        if (target && (this.panel.contains(target) || this.button.contains(target))) return;
        this.setOpen(false);
    };

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== "Escape") return;
        this.setOpen(false);
        this.button.focus();
    };

    private readonly onDocumentScroll = (event: Event): void => {
        const target = event.target as Node | null;
        if (target && this.panel.contains(target)) return;
        if (!this.button.isConnected) {
            this.destroy();
            return;
        }
        this.positionPanel();
    };

    private readonly onWindowResize = (): void => {
        if (!this.button.isConnected) {
            this.destroy();
            return;
        }
        this.positionPanel();
    };
}
