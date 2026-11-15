import { ButtonComponent, Modal, Notice, Setting } from 'obsidian';
import type Manager from '../main';
import { ConfigBundleReview, ConfigDiskChanged, IncompleteConfigBundle } from './config-files';
import { protectionText, ProtectionMessage } from './protection-text';
import { renderWorkflowModalHeader } from '../ui/workflow-modal';

/** An explicit file decision; inspecting or dismissing this dialog never publishes a file. */
export class ConfigBundleModal extends Modal {
    private review?: ConfigBundleReview;
    private busy = false;
    private opened = false;
    private error = '';
    private generation = 0;

    constructor(private readonly manager: Manager, private readonly closed: () => void) { super(manager.app); }
    private t(key: ProtectionMessage): string { return protectionText(this.manager, key); }
    onOpen(): void {
        this.opened = true;
        this.modalEl.addClass('manager-container', 'manager-bundle-modal');
        renderWorkflowModalHeader(this, this.t('bundleTitle'), 'files', this.manager.translator.t('通用_关闭_文本'));
        this.check();
    }
    private errorText(error: unknown): string {
        if (error instanceof ConfigDiskChanged) return this.t('bundleChanged');
        if (error instanceof IncompleteConfigBundle) return this.t('bundleMainMissing');
        return error instanceof Error ? error.message : this.t('error');
    }
    private check(): void {
        if (this.busy) return;
        // 保护会话可能已结束；不能让 busy 卡在 true 使所有按钮永久禁用。
        const files = this.manager.configProtection?.files;
        if (!files) { this.busy = false; this.error = this.t('error'); this.render(); return; }
        const generation = ++this.generation;
        this.busy = true; this.error = ''; this.review = undefined; this.render();
        void files.reviewIncompleteBundle().then(review => {
            if (!this.opened || generation !== this.generation) return;
            this.review = review;
        }).catch((error: unknown) => {
            if (this.manager.settings.DEBUG) console.error('[BPM] Inspecting configuration files failed', error);
            if (this.opened && generation === this.generation) this.error = this.errorText(error);
        }).finally(() => {
            if (!this.opened || generation !== this.generation) return;
            this.busy = false; this.render();
        });
    }
    private summary(text: string | null | undefined): string {
        if (text === undefined) return this.t('bundleNoBackup');
        if (text === null) return this.t('absent');
        try {
            const value: unknown = JSON.parse(text);
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                const row = value as Record<string, unknown>;
                const parts = [typeof row.name === 'string' ? row.name : '',
                    typeof row.type === 'string' && ['computer', 'tablet', 'phone'].includes(row.type)
                        ? this.t(row.type as 'computer' | 'tablet' | 'phone') : ''].filter(Boolean);
                if (parts.length) return parts.join(' · ');
            }
        } catch { /* CSS stays a labelled file instead of exposing its raw content. */ }
        return this.t('icons');
    }
    private render(): void {
        this.contentEl.empty();
        // 列表单独滚动，操作按钮固定在底部，避免文件较多时按钮被挤出可视区域。
        // Scroll the file list separately and pin the actions so they are always reachable.
        const body = this.contentEl.createDiv('manager-bundle-modal__body');
        body.createEl('p', { cls: 'setting-item-description', text: this.t('bundleDescription') });
        if (this.error) body.createEl('p', { cls: 'setting-item-description', text: this.error });
        if (this.review) {
            const list = body.createDiv('manager-workflow-modal__list');
            for (const issue of this.review.issues) {
                // 仅图标生成块差异由插件自动合并，不列为用户需要选择的文件。
                if (issue.generated) continue;
                const card = list.createDiv('manager-source-card manager-workflow-modal__card');
                new Setting(card).setClass('manager-workflow-modal__card-heading')
                    .setName(issue.path === 'data/icons.css' ? this.t('icons') : this.summary(issue.current ?? issue.saved))
                    .setDesc(issue.current === null ? this.t('bundleMissing') : this.t('bundleDifferent'));
                if (issue.current !== null) new Setting(card).setName(this.t('bundleCurrentLabel')).setDesc(this.summary(issue.current));
                // 没有已保存副本时不显示“已保存版本”空行，只用一句说明可选择的方向。
                if (issue.saved === undefined) card.createEl('p', { cls: 'setting-item-description', text: this.t('bundleNoBackup') });
                else new Setting(card).setName(this.t('bundleSavedLabel')).setDesc(this.summary(issue.saved));
                const details = card.createEl('details');
                details.createEl('summary', { text: this.t('file') });
                details.createEl('code', { text: issue.path });
            }
        } else if (!this.busy && !this.error) body.createEl('p', { text: this.t('bundleReady') });
        const actionSetting = new Setting(this.contentEl).setClass('manager-workflow-modal__actions');
        actionSetting.settingEl.addClass('manager-bundle-modal__actions');
        const actions = actionSetting.controlEl;
        new ButtonComponent(actions).setIcon('refresh-ccw').setButtonText(this.t('bundleCheck'))
            .setDisabled(this.busy).onClick(() => this.check());
        if (this.review) {
            // 只有所有文件都有可验证副本时才提供“恢复”，避免出现永远点不动的按钮。
            if (this.review.issues.every(issue => issue.generated || issue.saved !== undefined)) {
                new ButtonComponent(actions).setButtonText(this.t('bundleSaved'))
                    .setDisabled(this.busy).onClick(() => this.save('saved'));
            }
            new ButtonComponent(actions).setButtonText(this.t('bundleCurrent')).setCta()
                .setDisabled(this.busy).onClick(() => this.save('current'));
        } else if (!this.error) new ButtonComponent(actions).setButtonText(this.t('bundleSave')).setCta()
            .setDisabled(this.busy).onClick(() => this.save());
    }
    private save(source?: 'current' | 'saved'): void {
        if (this.busy) return;
        const review = this.review;
        this.busy = true; this.render();
        void (async () => {
            if (review && source) await this.manager.configProtection?.resolveIncompleteBundle(review.id, source);
            if (await this.manager.savePendingSettings() || this.manager.configProtection?.protection.paused) this.close();
        })().catch((error: unknown) => {
            if (this.manager.settings.DEBUG) console.error('[BPM] Resolving configuration files failed', error);
            if (error instanceof ConfigDiskChanged) this.review = undefined;
            this.error = this.errorText(error);
            new Notice(this.error);
        }).finally(() => { this.busy = false; if (this.opened) this.render(); });
    }
    onClose(): void { this.opened = false; this.generation++; this.closed(); this.contentEl.empty(); }
}
