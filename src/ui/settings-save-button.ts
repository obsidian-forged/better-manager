import { ButtonComponent } from 'obsidian';
import type Manager from '../main';
import { protectionText } from '../settings/protection-text';

/** Shared explicit-save control; rendering state never rebuilds its surrounding toolbar. */
export class SettingsSaveButton {
    readonly buttonEl: HTMLButtonElement;
    private readonly button: ButtonComponent;
    private icon = '';

    constructor(private readonly manager: Manager, parent: HTMLElement) {
        this.button = new ButtonComponent(parent);
        this.buttonEl = this.button.buttonEl;
        this.buttonEl.addClass('bpm-settings-save');
        this.button.onClick(() => { void this.manager.savePendingSettings(); });
        this.refresh();
    }

    refresh(): void {
        const saving = this.manager.isSavingSettings;
        const dirty = this.manager.hasUnsavedSettings;
        const icon = saving ? 'loader-circle' : 'save';
        if (icon !== this.icon) { this.button.setIcon(icon); this.icon = icon; }
        const label = protectionText(this.manager, saving ? 'saving' : dirty ? 'saveSettings' : 'checkSaveSettings');
        this.button.setDisabled(saving).setTooltip(label);
        this.buttonEl.setAttribute('aria-label', label);
        this.buttonEl.setAttribute('aria-busy', `${saving}`);
        this.buttonEl.toggleClass('has-unsaved-settings', dirty);
        this.buttonEl.toggleClass('is-saving', saving);
    }

    destroy(): void { this.buttonEl.remove(); }
}
