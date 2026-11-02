/** 首次外部变化立即提醒，连续写入合并提醒；Warn immediately and coalesce repeated updates. */
export class SyncUpdateGuard {
    private lastNotice = -Infinity;

    constructor(private readonly clock: () => number = Date.now) {}

    observe(changed: boolean): boolean {
        const now = this.clock();
        if (!changed) return false;
        if (now >= this.lastNotice && now - this.lastNotice < 60_000) return false;
        this.lastNotice = now;
        return true;
    }
}
