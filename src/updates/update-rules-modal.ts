import { renderWorkflowModalHeader } from '../ui/workflow-modal';
import { App, ButtonComponent, Modal, Notice, SearchComponent, Setting } from 'obsidian';
import type Manager from '../main';

/** 所有更新规则可检查、单独清除；Rules remain visible even after a plugin is removed. */
export class UpdateRulesModal extends Modal {
    private body!: HTMLElement;
    private query = '';
    private page = 0;
    private saving = false;
    constructor(app: App, private readonly manager: Manager, private readonly pluginId?: string, private readonly changed?: () => void) { super(app); }
    private t(key: string, vars?: Record<string, string | number>): string { return this.manager.translator.t(key, vars); }
    onOpen(): void {
        renderWorkflowModalHeader(this, this.t('更新规则_标题'), 'list-filter', this.t('通用_关闭_文本'));
        this.modalEl.addClass('manager-container', 'manager-update-rules', 'manager-workflow-modal');
        this.contentEl.createEl('p', { cls: 'setting-item-description', text: this.t('更新规则_说明') });
        if (!this.pluginId) new SearchComponent(this.contentEl.createDiv('manager-workflow-modal__search')).setPlaceholder(this.t('更新规则_搜索')).onChange(value => { this.query = value; this.page = 0; this.render(); });
        this.body = this.contentEl.createDiv('manager-workflow-modal__list');
        this.render();
    }
    private run(action: () => Promise<void>): void {
        if (this.saving) return;
        this.saving = true;
        void action().catch(error => {
            if (this.manager.settings.DEBUG) console.error('[BPM] Update preferences failed', error);
            new Notice(`${this.t('安装_错误_通用')} ${error instanceof Error ? error.message : ''}`);
        }).finally(() => { this.saving = false; if (this.body.isConnected) this.render(); });
    }
    private render(): void {
        this.body.empty();
        const manifests = this.manager.appPlugins.manifests;
        const ids = this.pluginId ? [this.pluginId] : [...new Set([...Object.keys(manifests), ...Object.keys(this.manager.settings.PLUGIN_UPDATE_RULES || {})])]
            .filter(id => id !== this.manager.manifest.id && `${id} ${manifests[id]?.name || ''}`.toLowerCase().includes(this.query.toLowerCase()))
            .sort((a, b) => (manifests[a]?.name || a).localeCompare(manifests[b]?.name || b));
        if (!this.pluginId) {
            const pages = Math.max(1, Math.ceil(ids.length / 20));
            this.page = Math.min(this.page, pages - 1);
            const navigation = new Setting(this.body).setClass('manager-workflow-modal__pagination').setName(this.t('目录_数量', { count: ids.length, page: this.page + 1, pages }));
            new ButtonComponent(navigation.controlEl).setButtonText(this.t('目录_上一页')).setDisabled(this.page === 0).onClick(() => { this.page--; this.render(); });
            new ButtonComponent(navigation.controlEl).setButtonText(this.t('目录_下一页')).setDisabled(this.page === pages - 1).onClick(() => { this.page++; this.render(); });
        }
        for (const id of ids.slice(this.pluginId ? 0 : this.page * 20, this.pluginId ? 1 : (this.page + 1) * 20)) {
            const section = this.body.createDiv('manager-source-card manager-workflow-modal__card');
            const rule = this.manager.updates.rule(id);
            const header = new Setting(section).setClass('manager-workflow-modal__card-heading').setName(manifests[id]?.name || id).setDesc(id);
            header.addButton(button => button.setIcon('rotate-ccw').setTooltip(this.t('更新规则_清除全部')).setDisabled(this.saving)
                .onClick(() => this.run(() => this.manager.updates.setRule(id, {}))));
            new Setting(section).setClass('manager-workflow-modal__inline').setName(this.t('更新规则_排除')).setTooltip(this.t('更新规则_排除说明')).addToggle(toggle => toggle.setValue(Boolean(rule.excluded))
                .setDisabled(this.saving).onChange(value => this.run(() => this.manager.updates.setRule(id, { ...this.manager.updates.rule(id), excluded: value }))));
            new Setting(section).setClass('manager-workflow-modal__inline').setName(this.t('更新规则_静音')).setTooltip(this.t('更新规则_静音说明')).addDropdown(dropdown => {
                dropdown.addOption('0', this.t('更新规则_不静音'));
                for (const days of [1, 7, 30]) dropdown.addOption(`${days}`, this.t('更新规则_静音天数', { days }));
                const muted = (rule.muteUntil || 0) > Date.now();
                if (muted) dropdown.addOption('current', this.t('更新规则_静音到', { date: new Date(rule.muteUntil || 0).toLocaleString() }));
                dropdown.setValue(muted ? 'current' : '0').setDisabled(this.saving).onChange(value => {
                    if (value === 'current') return;
                    this.run(() => this.manager.updates.setRule(id, { ...this.manager.updates.rule(id), muteUntil: Number(value) ? Date.now() + Number(value) * 86400000 : undefined }));
                });
            });
            for (const skipped of rule.skipped || []) new Setting(section).setName(skipped.tag).setDesc(`${skipped.source}${skipped.manifestVersion ? ` · manifest ${skipped.manifestVersion}` : ''}`)
                .addButton(button => button.setButtonText(this.t('更新规则_清除此版本')).setDisabled(this.saving).onClick(() => this.run(() => {
                    const latest = this.manager.updates.rule(id);
                    return this.manager.updates.setRule(id, { ...latest, skipped: latest.skipped?.filter(item => !(item.source === skipped.source && item.tag === skipped.tag)) });
                })));
        }
    }
    onClose(): void { this.contentEl.empty(); this.changed?.(); }
}
