export interface PluginBuildIO {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    write(path: string, text: string): Promise<unknown>;
    remove(path: string): Promise<unknown>;
}

const active = new WeakMap<PluginBuildIO, Set<string>>();

export async function withPluginBuildLock<T>(io: PluginBuildIO, directory: string, action: () => Promise<T>): Promise<T> {
    let paths = active.get(io);
    if (!paths) { paths = new Set(); active.set(io, paths); }
    if (paths.has(directory)) throw new Error('Another installation is already running for this plugin');
    paths.add(directory);
    try { return await action(); } finally { paths.delete(directory); }
}

export type StoredBuildFiles = Record<'manifest.json' | 'main.js' | 'styles.css', string | null> & { 'data.json'?: string | null };

/** Installs replace build files only; an approved restore may also supply data.json. */
export async function replacePluginBuild(io: PluginBuildIO, directory: string, files: StoredBuildFiles,
    beforeWrite: () => Promise<void>, afterWrite: () => Promise<void>, restoreRuntime: () => Promise<void>, stopFailedRuntime?: () => Promise<void>, rollbackOnlyNames: readonly string[] = []): Promise<void> {
    await withPluginBuildLock(io, directory, async () => {
        const snapshot = await Promise.all(Object.keys(files).map(async name => {
            const path = `${directory}/${name}`;
            return { name, path, previous: await io.exists(path) ? await io.read(path) : null };
        }));
        const write = async (path: string, value: string | null): Promise<void> => {
            if (value === null) { if (await io.exists(path)) await io.remove(path); }
            else await io.write(path, value);
        };
        const rollbackOnly: { path: string; previous: string | null }[] = [];
        let writesStarted = false;
        try {
            await beforeWrite();
            for (const name of rollbackOnlyNames) {
                if (!['data.json'].includes(name) || Object.prototype.hasOwnProperty.call(files, name)) continue;
                const path = `${directory}/${name}`;
                rollbackOnly.push({ path, previous: await io.exists(path) ? await io.read(path) : null });
            }
            writesStarted = true;
            const outcomes = await Promise.allSettled(snapshot.map(item => {
                const value = files[item.name as keyof typeof files] ?? null;
                return value === item.previous ? Promise.resolve() : write(item.path, value);
            }));
            const failed = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
            if (failed) throw failed.reason;
            await afterWrite();
        } catch (error) {
            let stopError: unknown;
            if (writesStarted) { try { await stopFailedRuntime?.(); } catch (failure) { stopError = failure; } }
            const restored = writesStarted ? await Promise.allSettled([...snapshot, ...rollbackOnly].map(item => write(item.path, item.previous))) : [];
            const failures = restored.filter(result => result.status === 'rejected').length;
            let runtimeError: unknown;
            try { await restoreRuntime(); } catch (failure) { runtimeError = failure; }
            const reason = error instanceof Error ? error.message : 'Build replacement failed';
            throw new Error(`${reason}${failures ? `; ${failures} files could not be restored` : ''}${stopError ? '; failed plugin could not be stopped' : ''}${runtimeError ? `; runtime restore failed: ${runtimeError instanceof Error ? runtimeError.message : 'unknown error'}` : ''}`);
        }
    });
}
