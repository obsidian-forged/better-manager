import type Manager from '../main';
import { LocalStateStore } from '../storage/local-state';

export const SYNC_ADVISORY_SUPPRESSION_KEY = 'bpm-sync-advisories-suppressed-v1';
/** Device-local advisory preference; never gate save errors or resolution actions. */
export function areSyncAdvisoriesSuppressed(manager: Manager): boolean {
    try { return new LocalStateStore(manager).loadLocalStorage(SYNC_ADVISORY_SUPPRESSION_KEY) === true; }
    catch (error) { if (manager.settings.DEBUG) console.error('[BPM] Read sync advisory preference', error); return false; }
}
export function setSyncAdvisoriesSuppressed(manager: Manager, suppressed: boolean): void {
    new LocalStateStore(manager).saveLocalStorage(SYNC_ADVISORY_SUPPRESSION_KEY, suppressed);
}
