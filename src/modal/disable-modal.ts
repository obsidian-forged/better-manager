import { createActionHandler } from '../ui/action-handler';
import { Notice, App, ExtraButtonComponent, Modal, Setting } from 'obsidian';
import Manager from 'main';

export class DisableModal extends Modal {
    private readonly action = createActionHandler(error => {
        if (this.manager.settings.DEBUG) console.error('[BPM] Modal action failed', error);
        new Notice(`${this.manager.translator.t('安装_错误_通用')} ${error instanceof Error ? error.message : ''}`);
    });
    manager: Manager;

    private deleteCallback: () => void | Promise<void>;

    constructor(app: App, manager: Manager, deleteCallback: () => void | Promise<void>) {
        super(app);
        this.manager = manager;
        this.deleteCallback = deleteCallback;
    }

    private async showHead() {
        const modalEl = this.contentEl.parentElement;
        if (!modalEl) return;
        modalEl.addClass('manager-editor__container');
        modalEl.getElementsByClassName('modal-close-button')[0]?.remove();
        this.titleEl.parentElement?.addClass('manager-container__header');
        this.contentEl.addClass('manager-item-container');

        // [标题行]
        const titleBar = new Setting(this.titleEl)
        titleBar.setClass('manager-delete__title')
        titleBar.setName(this.manager.translator.t('一键_标题'));

        // [标题行] 关闭按钮
        const closeButton = new ExtraButtonComponent(titleBar.controlEl)
        closeButton.setIcon('circle-x')
        closeButton.onClick(() => this.close());
    }

    private async showData() {
        const titleBar = new Setting(this.titleEl)
        titleBar.setName(this.manager.translator.t('一键_提示'));
        const actionBar = new Setting(this.titleEl)
        actionBar.setClass('manager-delete__action')
        actionBar.addButton(cb => cb
            .setCta()
            .setButtonText(this.manager.translator.t('一键_启禁'))
            .onClick(() => {
                this.action(async () => { await this.deleteCallback(); })();
                this.close();
            })
        );
        actionBar.addButton(cb => cb
            .setButtonText(this.manager.translator.t('一键_取消')) 
            .onClick(() => {
                this.close();
            })
        );
    }

    onOpen() {
        this.action(async () => {
            await this.showHead();
            await this.showData();
        })();
    }

    onClose() {
        this.contentEl.empty();
    }
}

