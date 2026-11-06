import type { ConfigConflictChoices } from './conflict-choices';

export type ConflictFeaturePage = 'plugins' | 'themes' | 'devices' | 'install' | 'transfer' | 'ribbon' | 'troubleshoot' | 'settings';
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
            if (section.id.endsWith('icons.css')) pages.add('plugins');
            else if (section.id.includes('data/devices/')) pages.add('devices');
            else pages.add('settings');
            continue;
        }
        if (section.kind === 'preset') {
            for (const { path } of section.differences) {
                const key = path[0];
                if (key === 'plugins' || key === 'filters') pages.add('plugins');
                else if (key === 'appearance') pages.add('themes');
                else if (key?.startsWith('ribbon')) pages.add('ribbon');
                else pages.add('devices');
            }
        } else {
            for (const { path } of section.differences) pages.add(settingsPage(path[0] ?? ''));
        }
    }
    return pages;
}
