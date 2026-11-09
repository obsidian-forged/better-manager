import type { DigestText } from './config-revision';

export interface PrivateCacheReader {
    read(path: string): Promise<string>;
    stat(path: string): Promise<{ type: string } | null>;
    list(path: string): Promise<{ files: string[]; folders: string[] }>;
}
export interface PrivateCacheWrites {
    write(path: string, text: string, action: () => Promise<void>): Promise<void>;
    remove(path: string, action: () => Promise<void>): Promise<void>;
    altered(path: string): void;
}

/** Observe private recovery files without writing an index, changing mtimes or trusting a sync echo. */
export class PrivateCacheWatch implements PrivateCacheWrites {
    private readonly expected = new Map<string, string | null>();
    private readonly writing = new Map<string, Promise<void>>();
    private readonly pending = new Set<string>();
    private inspection: Promise<void> = Promise.resolve();
    private scheduled = false;
    private closed = false;
    private changed = false;
    get modified(): boolean { return this.changed; }

    constructor(readonly root: string, private readonly reader: PrivateCacheReader, private readonly hash: DigestText,
        private readonly notify: () => void, private readonly failed: (error: unknown) => void) {}

    private includes(path: string): boolean { return path === this.root || path.startsWith(`${this.root}/`); }
    /** Existing snapshots also need an in-memory baseline: a metadata-only notification
     * must not be mistaken for an unknown external file. Never persist this index. */
    async prime(): Promise<void> {
        const folders = [this.root], visited = new Set<string>();
        while (folders.length && !this.closed) {
            const directory = folders.pop();
            if (!directory || visited.has(directory) || !this.includes(directory)) continue;
            visited.add(directory);
            if (!(await this.reader.stat(directory))) continue;
            const entries = await this.reader.list(directory);
            for (const path of entries.files) {
                if (!this.includes(path) || this.expected.has(path)) continue;
                try {
                    const digest = await this.hash(await this.reader.read(path));
                    if (!this.closed && !this.expected.has(path)) this.expected.set(path, digest);
                }
                catch (error) { if (await this.reader.stat(path)) throw error; }
            }
            folders.push(...entries.folders);
        }
    }
    altered(path: string): void {
        if (!this.includes(path) || this.closed || this.changed) return;
        this.changed = true;
        this.pending.clear();
        this.notify();
    }
    private async mutate(path: string, expected: string | null, action: () => Promise<void>): Promise<void> {
        if (!this.includes(path) || this.closed || this.changed) { await action(); return; }
        const hadPrevious = this.expected.has(path), previous = this.expected.get(path);
        this.expected.set(path, expected);
        let settle: () => void = () => undefined;
        const pending = new Promise<void>(resolve => { settle = resolve; });
        this.writing.set(path, pending);
        try { await action(); }
        catch (error) {
            if (hadPrevious) this.expected.set(path, previous ?? null); else this.expected.delete(path);
            throw error;
        } finally {
            if (this.writing.get(path) === pending) this.writing.delete(path);
            settle();
        }
    }
    async write(path: string, text: string, action: () => Promise<void>): Promise<void> {
        if (!this.includes(path) || this.closed || this.changed) { await action(); return; }
        await this.mutate(path, await this.hash(text), action);
    }
    async remove(path: string, action: () => Promise<void>): Promise<void> { await this.mutate(path, null, action); }
    observe(path: string): void {
        if (!this.includes(path) || this.closed || this.changed) return;
        this.pending.add(path);
        if (this.scheduled) return;
        this.scheduled = true;
        this.inspection = this.inspection.then(async () => {
            try {
                while (this.pending.size && !this.closed && !this.changed) {
                    const paths = [...this.pending]; this.pending.clear();
                    for (const entry of paths) await this.inspect(entry);
                }
            } finally { this.scheduled = false; }
        }).catch(error => { this.pending.clear(); this.failed(error); });
    }
    private async inspect(path: string): Promise<void> {
        await this.writing.get(path);
        if (this.closed || this.changed) return;
        const known = this.expected.has(path), expected = this.expected.get(path);
        const info = await this.reader.stat(path);
        if (info?.type === 'folder') return;
        let actual: string | null = null;
        if (info) {
            try { actual = await this.hash(await this.reader.read(path)); }
            catch (error) { if (await this.reader.stat(path)) throw error; }
        }
        if (this.writing.has(path) || this.expected.has(path) !== known || this.expected.get(path) !== expected) {
            this.pending.add(path); return;
        }
        if (!known || expected !== actual) this.altered(path);
    }
    async settled(): Promise<void> { await this.inspection; }
    destroy(): void { this.closed = true; this.pending.clear(); this.expected.clear(); }
}
