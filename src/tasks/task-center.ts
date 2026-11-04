/**
 * 后台任务中心 / Background task center.
 *
 * 只保存内存快照：任务由在线下载、更新检查等长耗时流程创建，
 * 设置页的任务入口订阅这里并显示进度。已完成任务保留到用户手动移除。
 * UI-independent: the settings panel subscribes, nothing here touches DOM.
 */

export type BackgroundTaskStatus = "running" | "done" | "error";

export interface BackgroundTaskSnapshot {
    readonly id: string;
    readonly title: string;
    /** 0–1 的完成比例 / Completion ratio in the 0–1 range. */
    readonly progress: number;
    readonly status: BackgroundTaskStatus;
    readonly startedAt: number;
}

export interface BackgroundTaskUpdate {
    title?: string;
    progress?: number;
}

export interface BackgroundTaskHandle {
    readonly id: string;
    update(update: BackgroundTaskUpdate): void;
    done(): void;
    fail(): void;
}

interface MutableTask {
    id: string;
    title: string;
    progress: number;
    status: BackgroundTaskStatus;
    startedAt: number;
}

const MAX_TASKS = 40;

const clampProgress = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
};

export class BackgroundTaskCenter {
    private tasks: MutableTask[] = [];
    private listeners = new Set<() => void>();
    private nextId = 1;

    constructor(private readonly onListenerError: (error: unknown) => void) {}

    /**
     * 登记一个进行中的任务 / Register a running task.
     * 返回的 handle 在任务结束后忽略后续 update，避免迟到回调把进度改回去。
     */
    public start(init: { title: string; progress?: number }): BackgroundTaskHandle {
        const task: MutableTask = {
            id: `bpm-task-${this.nextId++}`,
            title: init.title,
            progress: clampProgress(init.progress ?? 0),
            status: "running",
            startedAt: Date.now(),
        };
        this.tasks.push(task);
        this.trim();
        this.emit();

        const settle = (status: BackgroundTaskStatus) => {
            if (task.status !== "running") return;
            task.status = status;
            if (status === "done") task.progress = 1;
            this.emit();
        };

        return {
            id: task.id,
            update: (update: BackgroundTaskUpdate) => {
                if (task.status !== "running") return;
                if (typeof update.title === "string" && update.title.trim()) task.title = update.title;
                if (typeof update.progress === "number") task.progress = clampProgress(update.progress);
                this.emit();
            },
            done: () => settle("done"),
            fail: () => settle("error"),
        };
    }

    public snapshots(): BackgroundTaskSnapshot[] {
        return this.tasks.map(task => ({ ...task }));
    }

    public runningCount(): number {
        return this.tasks.reduce((count, task) => count + (task.status === "running" ? 1 : 0), 0);
    }

    /** 进行中的任务不可移除；只有完成或失败后才能移除 / Running tasks stay until they settle. */
    public dismiss(id: string): boolean {
        const index = this.tasks.findIndex(task => task.id === id);
        if (index < 0) return false;
        if (this.tasks[index].status === "running") return false;
        this.tasks.splice(index, 1);
        this.emit();
        return true;
    }

    public subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private emit(): void {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch (error) {
                // UI 订阅者异常不应中断下载流程 / A faulty subscriber must not break downloads.
                this.onListenerError(error);
            }
        }
    }

    /** 超量时优先丢弃最早的已完成任务，进行中的任务永不丢弃 / Drop oldest settled tasks only. */
    private trim(): void {
        while (this.tasks.length > MAX_TASKS) {
            const index = this.tasks.findIndex(task => task.status !== "running");
            if (index < 0) break;
            this.tasks.splice(index, 1);
        }
    }
}
