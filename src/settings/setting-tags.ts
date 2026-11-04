import type { Setting } from 'obsidian';

/** Keep tags in the native setting name so both settings search indexes include them. */
export function addSettingTags(setting: Setting, labels: readonly string[]): Setting {
    for (const label of labels) {
        setting.nameEl.createSpan({ text: ' ' });
        setting.nameEl.createSpan({ cls: 'flair', text: label });
    }
    return setting;
}
