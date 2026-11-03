export interface DetectedSync { id: string; name: string; kind: 'community' | 'core'; }
const known = [
    ['sync-engine', 'Sync Engine'], ['easy-sync', 'EasySync'], ['remotely-save', 'Remotely Save'],
    ['nutstore-sync', 'Nutstore Sync'], ['fast-note-sync', 'Fast Note Sync'], ['obsidian-livesync', 'Self-hosted LiveSync'],
] as const;

/** Exact registered IDs, independent of translated names and plugin loading order. */
export function detectSyncPlugins(enabled: ReadonlySet<string>, officialEnabled: boolean): DetectedSync[] {
    const detected: DetectedSync[] = known.filter(([id]) => enabled.has(id)).map(([id, name]) => ({ id, name, kind: 'community' }));
    if (officialEnabled) detected.push({ id: 'sync', name: 'Obsidian Sync', kind: 'core' });
    return detected;
}
