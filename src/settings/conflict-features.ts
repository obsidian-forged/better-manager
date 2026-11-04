import type { ConfigConflictChoices } from './conflict-choices';
import type { ConfigRecord } from './config-revision';
import { configurationDifferences } from './conflict-model';
import { settingsFingerprint } from './session-store';

export type ConflictFeaturePage = 'plugins' | 'themes' | 'devices' | 'install' | 'transfer' | 'ribbon' | 'troubleshoot' | 'settings';
const record = (value: unknown): value is ConfigRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const metadata = new Set(['_bpmRevision', 'updatedAt', 'createdAt', 'lastSeen', 'lastSeenAt', 'installedAt', 'lastChecked',
    'version', 'localVersion', 'latestVersion', 'latestManifestVersion', 'latestPublishedAt', 'latestReleaseTag',
    'latestReleasePublishedAt', 'latestReleaseIsGithubLatest', 'error', 'MIGRATION_VERSION', 'LANGUAGE_INITIALIZED', 'RELEASE_HIGHLIGHTS_PENDING']);
function userContent(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(userContent);
    if (!record(value)) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !metadata.has(key)).map(([key, item]) => [key, userContent(item)]));
}
const same = (a: unknown, b: unknown): boolean => settingsFingerprint(userContent(a)) === settingsFingerprint(userContent(b));
function changes(local: unknown, incoming: unknown): string[][] {
    return configurationDifferences(userContent(local), userContent(incoming)).map(item => item.path);
}
function settingsPage(key: string): ConflictFeaturePage {
    if (/^RIBBON_/.test(key)) return 'ribbon';
    if (/^(APPEARANCE_|THEME_|CSS_)/.test(key)) return 'themes';
    if (/^(BETA_|INSTALL_|REPO_|BPM_INSTALLED$|PLUGIN_INSTALLATIONS$|PLUGIN_SOURCE_UNBOUND$)/.test(key)) return 'install';
    if (/^(TRANSFER_|SHARED_|VAULT_)/.test(key)) return 'transfer';
    if (/^(TROUBLESHOOT_|CONFLICT_SCAN)/.test(key)) return 'troubleshoot';
    if (/^(FILTER_|PLUGIN_|COMMAND_)/.test(key) || ['Plugins', 'GROUPS', 'TAGS', 'DELAYS', 'DELAY', 'SEARCH', 'LAYOUT', 'HIDDEN_PLUGINS'].includes(key)) return 'plugins';
    if (key === 'DEVICE_MANAGEMENT') return 'devices';
    return 'settings';
}

/** Mark affected feature entries, never infer a winner or expose configuration values. */
export function conflictFeaturePages(choices: ConfigConflictChoices): ReadonlySet<ConflictFeaturePage> {
    const pages = new Set<ConflictFeaturePage>();
    for (const section of choices.sections) {
        if (section.kind === 'file') {
            if (section.id.endsWith('.json') && section.differences.length > 0
                && section.differences.every(item => same(item.local, item.incoming) || item.path.some(key => metadata.has(key)))) continue;
            if (section.id.endsWith('icons.css')) pages.add('plugins');
            else if (section.id.includes('data/devices/')) pages.add('devices');
            else pages.add('settings');
            continue;
        }
        if (same(section.local, section.incoming)) continue;
        if (section.kind === 'preset') {
            for (const path of changes(section.local, section.incoming)) {
                const key = path[0];
                if (key === 'plugins' || key === 'filters') pages.add('plugins');
                else if (key === 'appearance') pages.add('themes');
                else if (key?.startsWith('ribbon')) pages.add('ribbon');
                else pages.add('devices');
            }
        } else {
            for (const path of changes(section.local, section.incoming)) pages.add(settingsPage(path[0] ?? ''));
        }
    }
    return pages;
}
