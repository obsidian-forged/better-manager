/** 仅统计可见 BPM 接收到的外部变化，不统计本机交互；Ignore local rendering and inactive views. */
export class SyncUpdateGuard {
    private changes: number[] = [];
    private lastNotice = -Infinity;

    constructor(private readonly clock: () => number = Date.now) {}

    observe(visible: boolean, changed: boolean): boolean {
        const now = this.clock();
        if (!visible) { this.changes = []; return false; }
        this.changes = this.changes.filter(time => now - time <= 10_000 && time <= now);
        if (!changed) return false;
        this.changes.push(now);
        if (this.changes.length < 3 || now - this.lastNotice < 60_000) return false;
        this.lastNotice = now;
        this.changes = [];
        return true;
    }
}
