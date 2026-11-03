import { App, ButtonComponent, Modal, Notice, Setting } from 'obsidian';
import type Manager from '../main';
import type { BatchUpdatePlan, BatchUpdateReport } from './types';
import { UpdateRulesModal } from './update-rules-modal';

/** 预览计划后只执行获准的目标版本 / Review first, then execute only the approved targets. */
export class BatchUpdateModal extends Modal {
    private plan?: BatchUpdatePlan;
    private report?: BatchUpdateReport;
    private running = false;
    private closed = false;
    private progress?: HTMLElement;
    constructor(app: App, private readonly manager: Manager) { super(app); }
    private t(key: string, vars?: Record<string, string | number>): string { return this.manager.translator.t(key, vars); }
    onOpen(): void {
        this.closed = false;
        this.modalEl.addClass('manager-container', 'manager-batch-updates');
        this.titleEl.setText(this.t('批量更新_标题'));
        void this.prepare();
    }
    private async prepare(): Promise<void> {
        this.contentEl.empty();
        this.contentEl.createEl('p', { text: this.t('目录_加载'), attr: { role: 'status' } });
        try { this.plan = await this.manager.updates.prepare(); if (!this.closed) this.render(); }
        catch (error) {
            if (this.closed) return;
            this.contentEl.empty();
            this.contentEl.createEl('p', { text: error instanceof Error ? error.message : this.t('通知_检查更新失败'), attr: { role: 'alert' } });
            new ButtonComponent(this.contentEl).setButtonText(this.t('批量更新_重新预览')).onClick(() => { void this.prepare(); });
        }
    }
    private render(): void {
        this.contentEl.empty();
        if (!this.plan) return;
        this.contentEl.createEl('p', { cls: 'setting-item-description', text: this.t('批量更新_说明') });
        const actions = new Setting(this.contentEl).setName(this.t('批量更新_预览数量', { count: this.plan.rows.filter(row => row.status.hasUpdate).length }));
        new ButtonComponent(actions.controlEl).setButtonText(this.t('更新规则_标题')).setDisabled(this.running).onClick(() => new UpdateRulesModal(this.app, this.manager).open());
        new ButtonComponent(actions.controlEl).setButtonText(this.t('批量更新_重新预览')).setDisabled(this.running).onClick(() => { void this.prepare(); });
        const run = new ButtonComponent(actions.controlEl).setButtonText(this.t('批量更新_执行')).setCta()
            .setDisabled(this.running || Boolean(this.report) || !this.plan.rows.some(row => row.status.hasUpdate));
        run.onClick(() => { void this.execute(); });
        if (this.running) new ButtonComponent(actions.controlEl).setButtonText(this.t('批量更新_停止')).onClick(() => this.manager.updates.cancel());
        this.progress = this.contentEl.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
        if (this.report) {
            const results = this.report.results;
            this.progress.setText(this.t('批量更新_汇总', { updated: results.filter(item => item.outcome === 'updated').length, failed: results.filter(item => item.outcome === 'failed').length, skipped: results.filter(item => item.outcome === 'skipped').length }));
            if (this.report.refreshError) this.contentEl.createEl('p', { text: this.report.refreshError, attr: { role: 'alert' } });
        }
        const ready = this.contentEl.createDiv();
        const skipped = this.contentEl.createEl('details');
        skipped.createEl('summary', { text: this.t('批量更新_跳过项') });
        for (const row of this.plan.rows) {
            const result = this.report?.results.find(item => item.row.pluginId === row.pluginId);
            const section = row.status.hasUpdate ? ready : skipped;
            const target = row.status.target;
            const targetVersion = target?.manifestVersion && target.manifestVersion !== row.status.remoteVersion ? `${row.status.remoteVersion} (${target.manifestVersion})` : row.status.remoteVersion || '—';
            const description = `${row.status.localVersion || '?'} → ${targetVersion} · ${row.status.sourceLabel || row.status.source}`;
            const setting = new Setting(section).setName(row.name).setDesc(description);
            const state = result ? result.outcome === 'updated' ? this.t('批量更新_成功') : result.outcome === 'failed' ? this.t('批量更新_失败') : this.manager.updates.reasonText(result.reason)
                : row.status.hasUpdate ? this.t('批量更新_待执行') : this.manager.updates.reasonText(row.status.reason);
            setting.controlEl.createSpan({ text: state });
            if (result?.error || row.status.error) setting.descEl.createDiv({ text: result?.error || row.status.error });
        }
    }
    private async execute(): Promise<void> {
        if (!this.plan || this.running || this.report) return;
        this.running = true;
        this.render();
        try {
            this.report = await this.manager.updates.run(this.plan, (result, completed, total) => {
                if (!this.closed) this.progress?.setText(this.t('批量更新_进度', { name: result.row.name, completed, total }));
            });
            const report = this.report;
            new Notice(this.t('批量更新_汇总', { updated: report.results.filter(item => item.outcome === 'updated').length, failed: report.results.filter(item => item.outcome === 'failed').length, skipped: report.results.filter(item => item.outcome === 'skipped').length }));
        } catch (error) {
            if (this.manager.settings.DEBUG) console.error('[BPM] Batch update failed', error);
            new Notice(error instanceof Error ? error.message : this.t('安装_错误_通用'));
        } finally { this.running = false; if (!this.closed) this.render(); }
    }
    onClose(): void { this.closed = true; this.contentEl.empty(); }
}
