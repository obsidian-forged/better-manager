export interface DetectedSync { id: string; name: string; kind: 'community' | 'core'; }
const known = [
    ['sync-engine', 'Sync Engine'],
    ['nutstore-sync', 'Nutstore Sync'], ['fast-note-sync', 'Fast Note Sync'], ['obsidian-livesync', 'Self-hosted LiveSync'],
] as const;

/** 仅识别已知支持实时同步的插件；ID 不表示其当前实时模式已启用。
 * Known realtime-capable plugins only; an enabled ID does not confirm the current sync mode. */
export function detectSyncPlugins(enabled: ReadonlySet<string>, officialEnabled: boolean): DetectedSync[] {
    const detected: DetectedSync[] = known.filter(([id]) => enabled.has(id)).map(([id, name]) => ({ id, name, kind: 'community' }));
    if (officialEnabled) detected.push({ id: 'sync', name: 'Obsidian Sync', kind: 'core' });
    return detected;
}
