import type { Command } from 'obsidian';

export interface CommandRegistry {
    commands: Record<string, Command>;
    addCommand(command: Command): Command | void;
    removeCommand(id: string): void;
    executeCommandById(id: string): boolean | void;
}

interface Host {
    registry: CommandRegistry;
    loadPlugin(id: string): Promise<void>;
    canLoad(id: string): boolean;
    manifestVersion(id: string): string | undefined;
    readCache(): Promise<unknown>;
    writeCache(value: unknown): Promise<void>;
    failed(id: string, error: unknown): void;
}
interface Metadata { id: string; name: string; icon?: string }
interface Snapshot { version: string; commands: Metadata[] }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export class OnDemandCommands {
    private readonly cache = new Map<string, Snapshot>();
    private readonly wrappers = new Map<string, Command>();
    private readonly armed = new Set<string>();
    private readonly generations = new Map<string, number>();
    private readonly loading = new Map<string, Promise<void>>();
    private writes: Promise<void> = Promise.resolve();
    private disposed = false;

    constructor(private readonly host: Host) {}

    async initialize(): Promise<void> {
        try {
            const raw = await this.host.readCache();
            if (this.disposed || !record(raw) || raw.schema !== 1 || !record(raw.plugins)) return;
            for (const [id, entry] of Object.entries(raw.plugins)) {
                if (!record(entry) || typeof entry.version !== 'string' || !Array.isArray(entry.commands)) continue;
                const commands: Metadata[] = [];
                let valid = true;
                for (const item of entry.commands as unknown[]) {
                    if (!record(item) || typeof item.id !== 'string' || !item.id.startsWith(`${id}:`) || typeof item.name !== 'string' || (item.icon !== undefined && typeof item.icon !== 'string')) { valid = false; break; }
                    commands.push({ id: item.id, name: item.name, ...(typeof item.icon === 'string' ? { icon: item.icon } : {}) });
                }
                if (valid) this.cache.set(id, { version: entry.version, commands });
            }
        } catch (error) { if (!this.disposed) this.host.failed('', error); }
    }

    async capture(id: string): Promise<void> {
        if (this.disposed) return;
        const generation = this.generation(id);
        try {
            const version = this.host.manifestVersion(id);
            if (version === undefined) return;
            const commands = Object.values(this.host.registry.commands)
                .filter(command => command.id.startsWith(`${id}:`) && this.wrappers.get(command.id) !== command)
                .map(command => ({ id: command.id, name: command.name, ...(command.icon ? { icon: command.icon } : {}) }));
            const next = { version, commands };
            // Serialize writes; a failed snapshot never replaces the previous cache. / 串行保存，失败不替换旧快照。
            const write = this.writes.then(async () => {
                if (!this.live(id, generation)) return;
                const plugins: Record<string, Snapshot> = Object.fromEntries(this.cache);
                plugins[id] = next;
                await this.host.writeCache({ schema: 1, plugins });
                if (this.live(id, generation)) this.cache.set(id, next);
            });
            this.writes = write.catch(() => {});
            await write;
        } catch (error) { if (!this.disposed) this.host.failed(id, error); }
    }

    arm(id: string): void {
        if (this.disposed) return;
        this.armed.add(id);
        const snapshot = this.cache.get(id);
        if (!snapshot || snapshot.version !== this.host.manifestVersion(id) || !this.host.canLoad(id)) return;
        for (const metadata of snapshot.commands) {
            if (this.host.registry.commands[metadata.id]) continue;
            const command: Command = { ...metadata, callback: () => { void this.trigger(id, metadata.id); } };
            const added = this.host.registry.addCommand(command);
            this.wrappers.set(metadata.id, added ?? command);
        }
    }

    disarm(id: string): void {
        this.armed.delete(id);
        this.generations.set(id, this.generation(id) + 1);
        this.beforeLoad(id);
    }

    beforeLoad(id: string): void {
        // Identity protects real commands registered after a placeholder. / 身份校验保护后来注册的真实命令。
        for (const [commandId, wrapper] of this.wrappers) {
            if (!commandId.startsWith(`${id}:`)) continue;
            if (this.host.registry.commands[commandId] === wrapper) this.host.registry.removeCommand(commandId);
            this.wrappers.delete(commandId);
        }
    }

    async afterLoad(id: string): Promise<void> { await this.capture(id); }

    /** 已缓存的命令数；Number of commands remembered for a plugin. */
    count(id: string): number {
        const snapshot = this.cache.get(id);
        return snapshot && snapshot.version === this.host.manifestVersion(id) ? snapshot.commands.length : 0;
    }

    /** 缓存是否可用于当前版本；Whether cached metadata matches the installed version. */
    ready(id: string): boolean {
        const snapshot = this.cache.get(id);
        return Boolean(snapshot && snapshot.version === this.host.manifestVersion(id));
    }

    async trigger(id: string, commandId: string): Promise<void> {
        const generation = this.generation(id);
        if (!this.live(id, generation) || !this.armed.has(id) || !commandId.startsWith(`${id}:`)) return;
        try {
            if (!this.host.canLoad(id)) return;
            let pending = this.loading.get(id);
            if (!pending) {
                this.beforeLoad(id);
                pending = Promise.resolve().then(() => this.host.loadPlugin(id));
                this.loading.set(id, pending);
                const current = pending;
                void pending.finally(() => { if (this.loading.get(id) === current) this.loading.delete(id); }).catch(() => {});
            }
            await pending;
            if (!this.live(id, generation) || !this.armed.has(id) || !this.host.canLoad(id)) return;
            const command = this.host.registry.commands[commandId];
            if (!command || this.wrappers.get(commandId) === command || ![command.callback, command.checkCallback, command.editorCallback, command.editorCheckCallback].some(callback => typeof callback === 'function')) throw new Error(`Command unavailable: ${commandId}`);
            if (command.checkCallback && !command.checkCallback(true)) return;
            // Preserve native editor/context precedence. / 保留原生命令的编辑器与上下文优先级。
            if (this.host.registry.executeCommandById(commandId) === false) throw new Error(`Command unavailable: ${commandId}`);
        } catch (error) {
            if (this.live(id, generation)) { this.host.failed(id, error); if (this.armed.has(id)) this.arm(id); }
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const id of this.armed) this.beforeLoad(id);
        this.armed.clear();
    }

    private generation(id: string): number { return this.generations.get(id) ?? 0; }
    private live(id: string, generation: number): boolean { return !this.disposed && this.generation(id) === generation; }
}
