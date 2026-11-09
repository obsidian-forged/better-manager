import { ButtonComponent, Menu, Modal, Notice, Setting } from 'obsidian';
import type Manager from 'main';
import Commands from '../command';
import { createOrganizationEntry, OrganizationKind } from '../settings/organization';
import { createActionHandler } from './action-handler';
import { renderWorkflowModalHeader } from './workflow-modal';

/** Shared contextual creator; drafts stay inside this dialog until Create is pressed. */
export class OrganizationCreateModal extends Modal {
    private id = '';
    private name = '';
    private color: string;
    private submitting = false;

    constructor(private readonly manager: Manager, private readonly kind: OrganizationKind,
        private readonly onCreated: (id: string) => Promise<void>) {
        super(manager.app);
        const entries = kind === 'group' ? manager.settings.GROUPS : manager.settings.TAGS;
        this.color = manager.generateAutoColor(entries.map(entry => entry.color));
    }

    onOpen(): void {
        const t = (key: string) => this.manager.translator.t(key);
        renderWorkflowModalHeader(this, t(this.kind === 'group' ? '分组编辑_创建分组' : '标签编辑_创建标签'),
            this.kind === 'group' ? 'folder-plus' : 'tag', t('通用_关闭_文本'));
        this.modalEl.addClass('manager-container', 'manager-organization-create');
        new Setting(this.contentEl).setName(t('通用_ID_文本')).setDesc(t('设置_分类_ID说明'))
            .addText(input => input.setPlaceholder('ID').onChange(value => { this.id = value; }));
        new Setting(this.contentEl).setName(t('通用_名称_文本'))
            .addText(input => input.setPlaceholder(t('通用_名称_文本')).onChange(value => { this.name = value; }));
        new Setting(this.contentEl).setClass('manager-workflow-modal__inline').setName(t('通用_颜色_文本'))
            .addColorPicker(input => input.setValue(this.color).onChange(value => { this.color = value; }));
        const actions = new Setting(this.contentEl).setClass('manager-workflow-modal__actions').controlEl;
        const cancel = new ButtonComponent(actions).setButtonText(t('通用_取消_文本')).onClick(() => this.close());
        const submit = new ButtonComponent(actions)
            .setButtonText(t(this.kind === 'group' ? '分组编辑_创建分组' : '标签编辑_创建标签')).setCta();
        const action = createActionHandler(error => {
            if (this.manager.settings.DEBUG) console.error('[BPM] Create organization failed', error);
            new Notice(`${t('安装_错误_通用')} ${error instanceof Error ? error.message : ''}`);
        });
        submit.onClick(action(async () => {
            if (this.submitting) return;
            const entry = createOrganizationEntry(this.manager.settings, this.kind, {
                id: this.id, name: this.name, color: this.color,
            });
            if (!entry) {
                new Notice(t(this.kind === 'group' ? '设置_分组设置_通知_二' : '设置_标签设置_通知_二'));
                return;
            }
            this.submitting = true;
            submit.setDisabled(true);
            cancel.setDisabled(true);
            try {
                await this.manager.saveSettings();
                Commands(this.app, this.manager);
                await this.onCreated(entry.id);
                this.close();
                new Notice(t(this.kind === 'group' ? '设置_分组设置_通知_一' : '设置_标签设置_通知_一'));
            } catch (error) {
                // The definition may already be staged; never offer a second creation of the same ID.
                this.close();
                throw error;
            }
        }));
    }

    onClose(): void { this.contentEl.empty(); }
}

/** Native mobile sheets must finish closing before another modal is opened. */
export function addOrganizationCreateAction(menu: Menu, manager: Manager, kind: OrganizationKind,
    replaceMenu: (open: () => void) => void, onCreated: (id: string) => Promise<void>): void {
    menu.addSeparator();
    menu.addItem(item => item
        .setTitle(manager.translator.t(kind === 'group' ? '分组编辑_创建分组' : '标签编辑_创建标签'))
        .setIcon(kind === 'group' ? 'folder-plus' : 'plus')
        .onClick(() => replaceMenu(() => new OrganizationCreateModal(manager, kind, onCreated).open())));
}
