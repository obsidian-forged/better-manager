export interface FileChangeAdapter { onFileChange?: (path: string, ...args: unknown[]) => unknown; }
interface Listener { changed(path: string): void; failed(error: unknown): void; }
interface Hook { original?: FileChangeAdapter['onFileChange']; wrapped: NonNullable<FileChangeAdapter['onFileChange']>; listeners: Set<Listener>; }
const hooks = new WeakMap<FileChangeAdapter, Hook>();
export function hasFileChangeNotifications(adapter: FileChangeAdapter): boolean {
    const hook = hooks.get(adapter);
    return typeof (hook ? hook.original : adapter.onFileChange) === 'function';
}

/** Share the existing adapter notification without replacing another consumer's subscription. */
export function subscribeFileChanges(adapter: FileChangeAdapter, changed: Listener['changed'], failed: Listener['failed']): () => void {
    let hook = hooks.get(adapter);
    if (!hook) {
        const original = adapter.onFileChange, listeners = new Set<Listener>();
        const wrapped = function (this: FileChangeAdapter, path: string, ...args: unknown[]): unknown {
            try { return original?.call(this, path, ...args); }
            finally {
                for (const listener of [...listeners]) {
                    try { listener.changed(path); } catch (error) { listener.failed(error); }
                }
            }
        };
        hook = { original, wrapped, listeners };
        hooks.set(adapter, hook);
        adapter.onFileChange = wrapped;
    }
    const listener = { changed, failed }, installed = hook;
    installed.listeners.add(listener);
    return () => {
        installed.listeners.delete(listener);
        if (installed.listeners.size) return;
        if (adapter.onFileChange === installed.wrapped) {
            if (installed.original) adapter.onFileChange = installed.original;
            else delete adapter.onFileChange;
        }
        if (hooks.get(adapter) === installed) hooks.delete(adapter);
    };
}
