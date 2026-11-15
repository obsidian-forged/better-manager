import { ButtonComponent, Modal, Setting } from 'obsidian';
import type Manager from '../main';
import { protectionText, ProtectionMessage } from './protection-text';
import { renderWorkflowModalHeader } from '../ui/workflow-modal';

/**
 * data.json 缺失时的处理窗口：重新检查同步状态，或明确选择创建配置文件。
 * 只有用户确认才写文件，避免把同步中的临时缺失当成首次安装。
 *
 * Resolver for a missing data.json: recheck sync, or explicitly create the file.
 * Nothing is written until the user chooses, so a temporarily missing synced file
 * is never mistaken for a first install.
 */
export class LocalSettingsModal extends Modal {
    private busy = false;
    private message = '';
    private opened = false;

    constructor(private readonly manager: Manager, private readonly closed: () => void) { super(manager.app); }

    private t(key: ProtectionMessage): string { return protectionText(this.manager, key); }

    onOpen(): void {
        this.opened = true;
        this.modalEl.addClass('manager-container');
        renderWorkflowModalHeader(this, this.t('localMissingTitle'), 'file-warning', this.manager.translator.t('通用_关闭_文本'));
        this.render();
    }

    private render(): void {
        this.contentEl.empty();
        // 描述按行拆成段落，避免依赖 CSS 保留换行。
        this.t('localMissingDescription').split('\n').filter(line => line.trim()).forEach(line => {
            this.contentEl.createEl('p', { cls: 'setting-item-description', text: line });
        });
        if (this.message) this.contentEl.createEl('p', { cls: 'setting-item-description', text: this.message });
        const actions = new Setting(this.contentEl).setClass('manager-workflow-modal__actions').controlEl;
        new ButtonComponent(actions).setIcon('refresh-ccw').setButtonText(this.t('bundleCheck'))
            .setDisabled(this.busy).onClick(() => { void this.check(); });
        new ButtonComponent(actions).setButtonText(this.t('localMissingCreate')).setCta()
            .setDisabled(this.busy).onClick(() => { void this.create(); });
    }

    private async check(): Promise<void> {
        if (this.busy) return;
        this.busy = true; this.message = ''; this.render();
        try {
            if (await this.manager.refreshMissingLocalSettings()) { this.close(); return; }
            this.message = this.t('localMissingStillMissing');
        } catch (error) {
            if (this.manager.settings.DEBUG) console.error('[BPM] Rechecking the settings file failed', error);
            this.message = error instanceof Error ? error.message : this.t('error');
        } finally { this.busy = false; if (this.opened) this.render(); }
    }

    private async create(): Promise<void> {
        if (this.busy) return;
        this.busy = true; this.message = ''; this.render();
        try {
            if (await this.manager.createLocalSettingsFile()) { this.close(); return; }
            this.message = this.t('localMissingCreateFailed');
        } catch (error) {
            if (this.manager.settings.DEBUG) console.error('[BPM] Creating the settings file failed', error);
            this.message = error instanceof Error ? error.message : this.t('error');
        } finally { this.busy = false; if (this.opened) this.render(); }
    }

    onClose(): void { this.opened = false; this.closed(); this.contentEl.empty(); }
}
