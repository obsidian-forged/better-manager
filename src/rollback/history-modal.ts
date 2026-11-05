import { App, ButtonComponent, Modal, Notice, Setting } from 'obsidian';
import type Manager from '../main';
import type { BuildSnapshot, RestorePlan } from './plugin-history';
import { addSettingTags } from '../settings/setting-tags';

export class HistoryModal extends Modal {
    private pluginId: string;
    private busy = false;
    private closed = false;
    private label = '';
    private generation = 0;
    constructor(app: App, private readonly manager: Manager, pluginId?: string) {
        super(app); this.pluginId = pluginId || Object.keys(manager.appPlugins.manifests).find(id => id !== manager.manifest.id) || '';
    }
    private t(key: string, vars?: Record<string, string | number>): string { return this.manager.translator.t(key, vars); }
    onOpen(): void {
        if (!this.manager.history.available) { this.close(); return; }
        this.closed = false;
        this.manager.beginSettingsEditing(this); this.titleEl.setText(this.t('回退_标题')); this.modalEl.addClass('manager-container', 'manager-history'); this.run(() => this.load());
    }
    private run(action: () => Promise<void>): void {
        if (this.busy || this.closed) return;
        this.busy = true;
        this.modalEl.setAttribute('aria-busy', 'true');
        void action().catch(async error => {
            this.report(error);
            if (!this.closed) {
                try { await this.load(); }
                catch (refreshError) { this.report(refreshError); }
            }
        }).finally(() => { this.busy = false; this.modalEl.removeAttribute('aria-busy'); });
    }
    private report(error: unknown): void {
        if (this.manager.settings.DEBUG) console.error('[BPM] Restore points failed', error);
        if (!this.closed) new Notice(error instanceof Error ? error.message : this.t('安装_错误_通用'), 8000);
    }
    private async load(): Promise<void> {
        if (this.closed) return;
        const generation = ++this.generation;
        this.contentEl.empty();
        this.contentEl.createEl('p', { text: this.t('回退_说明'), cls: 'setting-item-description' });
        addSettingTags(new Setting(this.contentEl).setClass('bpm-rollback-opt-in').setName(this.t('回退_开启')), ['Preview']).setDesc(this.t('回退_开启说明')).addToggle(toggle => toggle
            .setValue(this.manager.history.enabled()).onChange(value => this.run(async () => {
                this.manager.settings.PLUGIN_ROLLBACK_ENABLED = value; await this.manager.saveSettings(); await this.load();
            })));
        new Setting(this.contentEl).setName(this.t('回退_插件')).addDropdown(dropdown => {
            for (const manifest of Object.values(this.manager.appPlugins.manifests).filter(manifest => manifest.id !== this.manager.manifest.id)) dropdown.addOption(manifest.id, manifest.name);
            dropdown.setValue(this.pluginId).onChange(value => { if (this.busy) return; this.pluginId = value; this.label = ''; this.run(() => this.load()); });
        });
        if (!this.pluginId) return;
        const controls = new Setting(this.contentEl).setName(this.t('回退_创建')).setDesc(this.t('回退_命名说明'));
        controls.addText(text => text.setPlaceholder(this.t('回退_名称')).setValue(this.label).onChange(value => { this.label = value; }));
        controls.addButton(button => button.setButtonText(this.t('回退_创建')).setDisabled(!this.manager.history.enabled())
            .onClick(() => this.run(async () => { await this.manager.history.create(this.pluginId, this.label); this.label = ''; await this.load(); })));
        const list = this.contentEl.createDiv();
        try {
            const snapshots = await this.manager.history.list(this.pluginId);
            if (this.closed || generation !== this.generation) return;
            if (!snapshots.length) list.createEl('p', { text: this.t('回退_无记录') });
            for (const snapshot of snapshots) this.renderPoint(list, snapshot);
        } catch (error) { if (!this.closed && generation === this.generation) list.createEl('p', { text: error instanceof Error ? error.message : this.t('安装_错误_通用'), attr: { role: 'alert' } }); }
    }
    private renderPoint(parent: HTMLElement, snapshot: BuildSnapshot): void {
        const row = new Setting(parent).setName(`${snapshot.label || this.t(snapshot.automatic ? '回退_自动' : '回退_手动')} · ${snapshot.version}`)
            .setDesc(new Date(snapshot.createdAt).toLocaleString());
        row.addButton(button => button.setButtonText(this.t('回退_预览')).setDisabled(!this.manager.history.enabled())
            .onClick(() => this.run(() => this.preview(snapshot.id))));
        let label = snapshot.label;
        new Setting(parent).setName(this.t('回退_名称')).addText(text => text.setValue(label).onChange(value => { label = value; }))
            .addButton(button => button.setButtonText(this.t('回退_保存')).onClick(() => this.run(async () => {
                await this.manager.history.rename(this.pluginId, snapshot.id, label); await this.load();
            })))
            .addButton(button => button.setButtonText(this.t('回退_删除')).onClick(() => this.run(async () => {
                await this.manager.history.remove(this.pluginId, snapshot.id); await this.load();
            })));
    }
    private async preview(snapshotId: string, merge = false, preservePaths: readonly string[] = []): Promise<void> {
        const generation = ++this.generation;
        const plan = await this.manager.history.prepare(this.pluginId, snapshotId, merge, preservePaths);
        if (this.closed || generation !== this.generation) return;
        this.renderPreview(plan, merge);
    }
    private renderPreview(plan: RestorePlan, merge: boolean): void {
        this.contentEl.empty();
        const current = this.manager.appPlugins.manifests[this.pluginId]?.version || '?';
        new Setting(this.contentEl).setName(`${current} → ${plan.snapshot.version}`).setDesc(plan.snapshot.label || this.t(plan.snapshot.automatic ? '回退_自动' : '回退_手动')).setHeading();
        const binding = plan.snapshot.binding;
        this.contentEl.createEl('p', { text: binding.unresolved ? this.t('回退_来源未知') : this.t('回退_恢复来源', { source: binding.receipt?.source.kind === 'catalog' ? binding.receipt.source.key : binding.repo || '' }), cls: 'setting-item-description' });
        this.contentEl.createEl('p', { text: this.t('回退_配置说明'), cls: 'setting-item-description' });
        new Setting(this.contentEl).setName(this.t('回退_合并配置')).setDesc(this.t('回退_合并说明')).addToggle(toggle => toggle.setValue(merge)
            .onChange(value => this.run(() => this.preview(plan.snapshot.id, value, plan.preservePaths))));
        if (merge) {
            this.contentEl.createEl('p', { text: this.t('回退_差异数量', { removed: plan.removed.length, restored: plan.restored.length }) });
            for (const [title, paths] of [[this.t('回退_移除字段'), plan.removed], [this.t('回退_补回字段'), plan.restored]] as const) {
                const details = this.contentEl.createEl('details'); details.createEl('summary', { text: title });
                const list = details.createEl('ul'); for (const path of paths.slice(0, 200)) list.createEl('li', { text: path });
                if (paths.length > 200) details.createEl('p', { text: this.t('回退_差异更多') });
            }
            const merged = this.contentEl.createEl('details', { cls: 'markdown-rendered' });
            merged.createEl('summary', { text: this.t('回退_配置预览') });
            merged.addEventListener('toggle', () => {
                if (!merged.open || merged.querySelector('pre')) return;
                merged.createEl('pre').createEl('code', { text: (plan.config || '').slice(0, 200000) });
                if ((plan.config?.length || 0) > 200000) merged.createEl('p', { text: this.t('回退_差异更多') });
            });
        }
        if (merge && plan.preservableObjects.length) {
            this.contentEl.createEl('p', { text: this.t('回退_保留对象说明'), cls: 'setting-item-description' });
            for (const path of plan.preservableObjects.slice(0, 200)) new Setting(this.contentEl).setName(path).addToggle(toggle => toggle
                .setValue(plan.preservePaths.includes(path)).onChange(value => this.run(() => this.preview(plan.snapshot.id, true,
                    value ? [...plan.preservePaths, path] : plan.preservePaths.filter(item => item !== path)))));
            if (plan.preservableObjects.length > 200) this.contentEl.createEl('p', { text: this.t('回退_差异更多') });
        }
        let reviewed = !merge || !plan.restored.length && !plan.removed.length;
        let restoreButton: ButtonComponent | undefined;
        if (!reviewed) new Setting(this.contentEl).setName(this.t('回退_确认历史值')).setDesc(this.t('回退_迁移警告'))
            .addToggle(toggle => toggle.setValue(false).onChange(value => { reviewed = value; restoreButton?.setDisabled(!value); }));
        const actions = new Setting(this.contentEl);
        actions.addButton(button => { restoreButton = button; button.setButtonText(this.t('回退_确认')).setCta().setDisabled(!reviewed).onClick(() => this.run(async () => {
            if (!reviewed) return;
            button.setDisabled(true);
            const generation = this.generation;
            const endAction = this.manager.configProtection?.beginUserAction();
            try {
                await this.manager.history.restore(plan, () => !this.closed && generation === this.generation);
                if (!this.closed) { new Notice(this.t('回退_成功')); await this.load(); }
            }
            finally { endAction?.(); button.setDisabled(false); }
        })); });
        new ButtonComponent(actions.controlEl).setButtonText(this.t('通用_取消_文本')).onClick(() => this.run(() => this.load()));
    }
    onClose(): void { this.closed = true; this.generation++; this.manager.endSettingsEditing(this); this.contentEl.empty(); }
}
