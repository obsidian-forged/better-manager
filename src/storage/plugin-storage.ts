import { normalizePath } from 'obsidian';
import type Manager from '../main';

export type StorageArea = 'data' | 'cache';
const stores = new WeakMap<Manager, PluginStorage>();

/** 用户数据与可重建缓存分开；Keep durable user data separate from disposable caches. */
export class PluginStorage {
    constructor(private readonly manager: Manager) {}

    get root(): string { return normalizePath(`${this.manager.app.vault.configDir}/plugins/${this.manager.manifest.id}`); }

    path(area: StorageArea, name: string): string {
        if (!name || name.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\') || [...part].some(char => char.charCodeAt(0) < 32))) {
            throw new Error('Invalid plugin storage path');
        }
        return normalizePath(`${this.root}/${area}/${name}`);
    }

    /** 启动时即建好 data/ 与 cache/，让用户数据目录可见 / Materialize both user data areas early. */
    async ensureAreas(): Promise<void> {
        const adapter = this.manager.app.vault.adapter;
        for (const area of ['data', 'cache'] as const) {
            const path = normalizePath(`${this.root}/${area}`);
            if (await adapter.exists(path)) continue;
            try { await adapter.mkdir(path); }
            catch (error) { if (!(await adapter.exists(path))) throw error; }
        }
    }

    async ensureParent(area: StorageArea, name: string): Promise<void> {
        const path = this.path(area, name);
        const adapter = this.manager.app.vault.adapter;
        const parts = path.slice(this.root.length + 1).split('/');
        parts.pop();
        let current = this.root;
        for (const part of parts) {
            current += `/${part}`;
            if (await adapter.exists(current)) continue;
            try { await adapter.mkdir(current); }
            catch (error) { if (!(await adapter.exists(current))) throw error; }
        }
    }

    async write(area: StorageArea, name: string, text: string): Promise<void> {
        const path = this.path(area, name);
        const adapter = this.manager.app.vault.adapter;
        if (await adapter.exists(path) && await adapter.read(path) === text) return;
        await this.ensureParent(area, name);
        await adapter.write(path, text);
    }

    /** 先校验复制结果再移除旧恢复文件；普通历史数据保留旧副本，兼容尚未升级的设备。 */
    async read(area: StorageArea, name: string, legacy: string[] = [], move = false): Promise<string | undefined> {
        const path = this.path(area, name);
        const adapter = this.manager.app.vault.adapter;
        if (await adapter.exists(path)) return adapter.read(path);
        for (const old of legacy) {
            if (!(await adapter.exists(old))) continue;
            const text = await adapter.read(old);
            try {
                await this.write(area, name, text);
                if (await adapter.read(path) !== text) throw new Error('Plugin data migration verification failed');
            } catch (error) {
                if (await adapter.exists(path)) await adapter.remove(path);
                throw error;
            }
            if (move) await adapter.remove(old);
            return text;
        }
        return undefined;
    }

    async remove(area: StorageArea, name: string, legacy: string[] = []): Promise<void> {
        const adapter = this.manager.app.vault.adapter;
        for (const path of [this.path(area, name), ...legacy]) if (await adapter.exists(path)) await adapter.remove(path);
    }
}

export function pluginStorage(manager: Manager): PluginStorage {
    let store = stores.get(manager);
    if (!store) { store = new PluginStorage(manager); stores.set(manager, store); }
    return store;
}
