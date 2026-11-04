import { settingsFingerprint } from './session-store';

interface ConfigReader {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
}
export interface ConfigWatchClock {
    now(): number;
    later(callback: () => void, milliseconds: number): number;
    cancel(handle: number): void;
}
const clock: ConfigWatchClock = {
    now: () => window.performance?.now() ?? Date.now(),
    later: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
    cancel: handle => window.clearTimeout(handle),
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Compare settings content, without counting JSON formatting, revision markers or device heartbeats. */
export function sharedConfigFingerprint(path: string, text: string | null): string {
    if (text === null) return 'missing';
    if (!path.endsWith('.json')) return `text:${text}`;
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { return `invalid-json:${text}`; }
    if (record(parsed)) {
        parsed = { ...parsed };
        if (record(parsed)) {
            delete parsed._bpmRevision;
            if (/\/data\/devices\/[^/]+\.json$/.test(path)) delete parsed.lastSeen;
        }
    }
    return `json:${settingsFingerprint(parsed)}`;
}

/** Read-only, per-file warning detection. It never adopts settings, pauses saves or repairs files. */
export class SharedConfigWatch {
    private readonly observed = new Map<string, string>();
    private readonly writing = new Map<string, Promise<void>>();
    private readonly changes = new Map<string, number[]>();
    private readonly timers = new Map<string, number>();
    private inspection: Promise<void> = Promise.resolve();
    private nextNotice = 0;
    private closed = false;

    constructor(readonly root: string, private readonly reader: ConfigReader,
        private readonly enabled: () => boolean, private readonly notify: (path: string) => void,
        private readonly failed: (error: unknown) => void, private readonly time: ConfigWatchClock = clock) {}

    includes(path: string): boolean {
        return path === `${this.root}/data.json` || path === `${this.root}/data/icons.css`
            || path.startsWith(`${this.root}/data/devices/`) && /^[^/]+\.json$/.test(path.slice(`${this.root}/data/devices/`.length));
    }
    private async fingerprint(path: string): Promise<string> {
        let text: string | null = null;
        if (await this.reader.exists(path)) {
            try { text = await this.reader.read(path); }
            catch (error) { if (await this.reader.exists(path)) throw error; }
        }
        return sharedConfigFingerprint(path, text);
    }
    async prime(paths: readonly string[]): Promise<void> {
        for (const path of paths) {
            if (this.closed) return;
            if (this.includes(path)) this.observed.set(path, await this.fingerprint(path));
        }
    }
    /** Local writes are registered before disk I/O; delayed adapter echoes remain harmless. */
    private async mutate(path: string, fingerprint: string, action: () => Promise<void>): Promise<void> {
        if (!this.includes(path) || this.closed) { await action(); return; }
        const previous = this.observed.get(path);
        this.observed.set(path, fingerprint);
        this.changes.delete(path);
        let settle: () => void = () => undefined;
        const pending = new Promise<void>(resolve => { settle = resolve; });
        this.writing.set(path, pending);
        try { await action(); }
        catch (error) {
            if (previous === undefined) this.observed.delete(path); else this.observed.set(path, previous);
            throw error;
        } finally {
            if (this.writing.get(path) === pending) this.writing.delete(path);
            settle();
        }
    }
    async write(path: string, text: string, action: () => Promise<void>): Promise<void> {
        if (!this.includes(path) || this.closed) { await action(); return; }
        await this.mutate(path, sharedConfigFingerprint(path, text), action);
    }
    async remove(path: string, action: () => Promise<void>): Promise<void> {
        await this.mutate(path, sharedConfigFingerprint(path, null), action);
    }
    observe(path: string): void {
        if (!this.includes(path) || this.closed) return;
        if (this.timers.has(path)) return;
        // Bound each coalescing window from its first event. A continuous stream must not
        // postpone inspection indefinitely as a trailing debounce would.
        this.timers.set(path, this.time.later(() => {
            this.timers.delete(path);
            this.inspection = this.inspection.then(() => this.inspect(path)).catch(error => { if (!this.closed) this.failed(error); });
        }, 250));
    }
    private async inspect(path: string): Promise<void> {
        await this.writing.get(path);
        if (this.closed) return;
        const previous = this.observed.get(path), actual = await this.fingerprint(path);
        if (this.closed) return;
        if (this.writing.has(path) || this.observed.get(path) !== previous) { this.observe(path); return; }
        this.observed.set(path, actual);
        // If startup priming failed, the first readable state is only a baseline.
        if (previous === undefined) return;
        if (!this.enabled()) { this.changes.delete(path); return; }
        if (actual === previous) return;
        const now = this.time.now();
        const recent = (this.changes.get(path) ?? []).filter(at => at <= now && now - at <= 3_000);
        recent.push(now);
        this.changes.set(path, recent.slice(-3));
        if (recent.length < 3 || now < this.nextNotice) return;
        this.nextNotice = now + 60_000;
        this.changes.clear();
        this.notify(path);
    }
    async settled(): Promise<void> { await this.inspection; }
    destroy(): void {
        this.closed = true;
        for (const timer of this.timers.values()) this.time.cancel(timer);
        this.timers.clear(); this.changes.clear(); this.observed.clear();
    }
}
