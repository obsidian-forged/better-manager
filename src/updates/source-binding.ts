import type Manager from '../main';
import { record } from '../catalog/catalog';
import { readInstalledRelease } from './update-policy';
import type { InstalledRelease } from './types';

/** Explicit provenance also distinguishes an unknown legacy source from automatic discovery. */
export interface SourceBinding { repo?: string; receipt?: InstalledRelease; unresolved: boolean }
const repoName = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(value);

export function readSourceBinding(value: unknown, legacyReceipt?: unknown): SourceBinding {
    if (value !== undefined && (!record(value) || typeof value.unresolved !== 'boolean'
        || value.repo !== undefined && !repoName(value.repo) || value.receipt !== undefined && !readInstalledRelease(value.receipt))) throw new Error('Invalid restore point source binding');
    const receipt = readInstalledRelease(record(value) ? value.receipt : legacyReceipt);
    if (receipt) return { receipt, repo: receipt.source.kind === 'github' ? receipt.source.repo : undefined, unresolved: false };
    if (record(value) && repoName(value.repo) && !value.unresolved) return { repo: value.repo, unresolved: false };
    return { unresolved: true };
}

export function captureSourceBinding(manager: Manager, id: string): SourceBinding {
    const receipt = manager.settings.PLUGIN_INSTALLATIONS?.[id], repo = manager.settings.REPO_MAP?.[id];
    const unresolved = manager.settings.PLUGIN_SOURCE_UNBOUND?.includes(id) === true;
    if (!receipt && !repo && !unresolved) return { unresolved: false };
    return readSourceBinding({ receipt, repo, unresolved });
}

/** Settings and resolver cache move together; the caller owns persistence and rollback. */
export async function applySourceBinding(manager: Manager, id: string, binding: SourceBinding): Promise<void> {
    await manager.repoResolver.setRepoBinding(id, binding.repo || null);
    manager.settings.PLUGIN_INSTALLATIONS ||= {};
    if (binding.receipt) manager.settings.PLUGIN_INSTALLATIONS[id] = binding.receipt;
    else delete manager.settings.PLUGIN_INSTALLATIONS[id];
    manager.settings.PLUGIN_SOURCE_UNBOUND = (manager.settings.PLUGIN_SOURCE_UNBOUND || []).filter(value => value !== id);
    if (binding.unresolved) manager.settings.PLUGIN_SOURCE_UNBOUND.push(id);
}
