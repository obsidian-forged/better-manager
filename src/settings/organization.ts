import { BPM_IGNORE_TAG, EONDR_PLUGIN_TAG_ID } from '../data/types';
import { BPM_TAG_ID } from '../repo-resolver';
import type { ManagerSettings } from './data';

export type OrganizationKind = 'group' | 'tag';
export interface OrganizationEntry { id: string; name: string; color: string }

/** Keep validation identical for settings, plugin editors and contextual creation. */
export function createOrganizationEntry(
    settings: Pick<ManagerSettings, 'GROUPS' | 'TAGS'>,
    kind: OrganizationKind,
    draft: OrganizationEntry,
): OrganizationEntry | undefined {
    const id = draft.id.trim();
    const entries = kind === 'group' ? settings.GROUPS : settings.TAGS;
    if (!id || entries.some(entry => entry.id === id)) return;
    if (kind === 'tag' && (id === BPM_TAG_ID || id === BPM_IGNORE_TAG || id === EONDR_PLUGIN_TAG_ID)) return;
    const entry = { id, name: draft.name.trim() || id, color: draft.color };
    entries.push(entry);
    return entry;
}
