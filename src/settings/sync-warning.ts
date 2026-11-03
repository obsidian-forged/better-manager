import { ButtonComponent, Modal } from 'obsidian';
import type Manager from '../main';
import { DetectedSync } from './sync-detector';
import { protectionText } from './protection-text';

export class SyncWarningModal extends Modal {
    constructor(private readonly manager: Manager, private readonly services: DetectedSync[]) { super(manager.app); }
    onOpen(): void {
        const t = (key: Parameters<typeof protectionText>[1]) => protectionText(this.manager, key);
        this.titleEl.setText(t('syncTitle'));
        this.contentEl.createEl('p', { text: t('syncDesc') });
        const list = this.contentEl.createEl('ul');
        this.services.forEach(service => list.createEl('li', { text: service.name }));
        this.contentEl.createEl('p', { text: t('syncAdvice') });
        this.contentEl.createEl('p', { text: t('exclude') });
        this.contentEl.createEl('code', { text: `${this.manager.app.vault.configDir}/plugins/${this.manager.manifest.id}/.bpm/` });
        new ButtonComponent(this.contentEl.createDiv('modal-button-container')).setButtonText(t('understood')).setCta().onClick(() => this.close());
    }
    onClose(): void { this.contentEl.empty(); }
}
