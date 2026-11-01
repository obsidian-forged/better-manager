import { catalogRepo, catalogUrl, record, text } from "./catalog";
import type { CatalogEntry } from "./catalog";

export type TryDecision = "planned" | "keep" | "pass";
export interface TryListItem {
    key: string;
    pluginId: string;
    name: string;
    sourceId: string;
    sourceName: string;
    sourceUrl?: string;
    repositoryUrl?: string;
    repo: string;
    openness: CatalogEntry["openness"];
    addedAt: number;
    decision: TryDecision;
    note: string;
}
export interface TryListIO { read(): Promise<unknown>; write(value: unknown): Promise<void> }

/** 只存意向和用户记录，不伪装为安装/备份状态 / Intentions and user notes are not installation or backup state. */
export class CatalogTryList {
    private items: TryListItem[] = [];
    private loaded?: Promise<void>;
    private queue: Promise<unknown> = Promise.resolve();
    constructor(private io: TryListIO) {}

    public async load(): Promise<void> {
        if (!this.loaded) this.loaded = this.readFile().catch(error => { this.loaded = undefined; throw error; });
        await this.loaded;
    }
    private async readFile(): Promise<void> {
        const value = await this.io.read();
        if (value === undefined || value === null) return;
        if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.items)) throw new Error("Invalid try-list data");
        const seen = new Set<string>();
        const items = value.items.map((raw: unknown): TryListItem => {
            if (!record(raw) || !text(raw.key) || !text(raw.pluginId) || !text(raw.sourceId) || seen.has(text(raw.key))) throw new Error("Invalid try-list identity");
            seen.add(text(raw.key));
            if (!["planned", "keep", "pass"].includes(text(raw.decision))) throw new Error("Invalid try-list decision");
            if (!["open-source", "closed-source", "unknown"].includes(text(raw.openness))) throw new Error("Invalid try-list source availability");
            if (raw.key !== `${text(raw.sourceId)}:${text(raw.pluginId)}`) throw new Error("Invalid try-list source binding");
            const repositoryUrl = text(raw.repositoryUrl) ? catalogUrl(text(raw.repositoryUrl)) : undefined;
            return { key: text(raw.key), pluginId: text(raw.pluginId), name: text(raw.name), sourceId: text(raw.sourceId), sourceName: text(raw.sourceName),
                sourceUrl: text(raw.sourceUrl) ? catalogUrl(text(raw.sourceUrl)) : undefined,
                repositoryUrl,
                // 旧仓库字符串不信任；仅由仓库 URL 派生安装目标 / Derive install targets from validated repository URLs only.
                repo: repositoryUrl && new URL(repositoryUrl).hostname === "github.com" ? catalogRepo(repositoryUrl) : "", openness: raw.openness === "open-source" ? "open-source" : raw.openness === "closed-source" ? "closed-source" : "unknown",
                addedAt: typeof raw.addedAt === "number" && Number.isFinite(raw.addedAt) ? raw.addedAt : 0,
                decision: raw.decision === "keep" ? "keep" : raw.decision === "pass" ? "pass" : "planned", note: text(raw.note) };
        });
        this.items = items;
    }
    public all(): readonly TryListItem[] { return this.items; }
    public has(key: string): boolean { return this.items.some(item => item.key === key); }
    private commit(update: () => TryListItem[]): Promise<void> {
        const task = this.queue.then(async () => {
            const items = update();
            await this.io.write({ schemaVersion: 1, items });
            this.items = items;
        });
        this.queue = task.catch(() => undefined); // 调用方处理原始异常 / The caller handles the original error.
        return task;
    }
    public add(entry: CatalogEntry): Promise<void> {
        return this.commit(() => this.has(entry.key) ? this.items : [...this.items, {
            key: entry.key, pluginId: entry.id, name: entry.name, sourceId: entry.source.id, sourceName: entry.source.name,
            sourceUrl: entry.source.url, repositoryUrl: entry.repositoryUrl, repo: entry.repo, openness: entry.openness,
            addedAt: Date.now(), decision: "planned", note: "",
        }]);
    }
    public update(key: string, patch: { decision?: TryDecision; note?: string }): Promise<void> {
        return this.commit(() => this.items.map(item => item.key === key ? { ...item, ...patch } : item));
    }
    public remove(key: string): Promise<void> { return this.commit(() => this.items.filter(item => item.key !== key)); }
}
