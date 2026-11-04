interface NativeLocalState {
    loadLocalStorage(key: string): unknown;
    saveLocalStorage(key: string, value: unknown): void;
}

export interface BrowserStateStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

interface LocalStateOwner {
    app: { vault: { getName(): string; configDir: string; adapter?: unknown } };
    manifest: { id: string };
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const nativeLocalState = (value: unknown): value is NativeLocalState => record(value)
    && typeof value.loadLocalStorage === 'function' && typeof value.saveLocalStorage === 'function';

/** 本机身份与恢复锚点共用存储，兼容尚未公开本地状态 API 的旧版 / One local-only store for all supported app versions. */
export class LocalStateStore {
    private prefix?: string;
    constructor(private readonly owner: LocalStateOwner,
        private readonly browserStorage: () => BrowserStateStorage = () => window.localStorage) {}

    private key(key: string): string {
        if (this.prefix === undefined) {
            const vault = this.owner.app.vault;
            const adapter: unknown = vault.adapter;
            // 只生成本地资源地址；同名但位于不同路径的库也须隔离 / No resource is requested here.
            const resource: unknown = record(adapter) && typeof adapter.getResourcePath === 'function'
                ? Reflect.apply(adapter.getResourcePath, adapter, ['']) : undefined;
            const identity = typeof resource === 'string' && resource ? resource : vault.getName();
            this.prefix = `bpm:${encodeURIComponent(identity)}:${encodeURIComponent(vault.configDir)}:${encodeURIComponent(this.owner.manifest.id)}:`;
        }
        return `${this.prefix}${encodeURIComponent(key)}`;
    }

    loadLocalStorage(key: string): unknown {
        const app: unknown = this.owner.app;
        if (nativeLocalState(app)) return app.loadLocalStorage(key);
        const text = this.browserStorage().getItem(this.key(key));
        const value: unknown = text === null ? null : JSON.parse(text);
        return value;
    }

    saveLocalStorage(key: string, value: unknown): void {
        const app: unknown = this.owner.app;
        if (nativeLocalState(app)) { app.saveLocalStorage(key, value); return; }
        const storage = this.browserStorage(), scopedKey = this.key(key);
        if (value === undefined) { storage.removeItem(scopedKey); return; }
        const text = JSON.stringify(value);
        if (text === undefined) throw new Error('The local state value cannot be serialized');
        storage.setItem(scopedKey, text);
    }
}
