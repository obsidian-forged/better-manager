import { App, ButtonComponent, DropdownComponent, Modal, Setting } from 'obsidian';
import type Manager from '../main';
import overview from '../assets/release-1.2.0/overview.webp';
import install from '../assets/release-1.2.0/install.webp';
import ribbon from '../assets/release-1.2.0/ribbon.webp';
import transfer from '../assets/release-1.2.0/transfer.webp';
import diagnosis from '../assets/release-1.2.0/diagnosis.webp';

/** 离线截图介绍，按原生弹窗生命周期管理；An offline screenshot tour using the native modal lifecycle. */
export class ReleaseHighlightsModal extends Modal {
    private readonly slides = [
        { image: overview, title: '更新介绍_总览', description: '更新介绍_总览说明' },
        { image: install, title: '更新介绍_安装', description: '更新介绍_安装说明' },
        { image: ribbon, title: '更新介绍_Ribbon', description: '更新介绍_Ribbon说明' },
        { image: transfer, title: '更新介绍_迁移', description: '更新介绍_迁移说明' },
        { image: diagnosis, title: '更新介绍_诊断', description: '更新介绍_诊断说明' },
    ];
    private index = 0;
    private selection?: DropdownComponent;
    private image?: HTMLImageElement;
    private caption?: HTMLElement;
    private counter?: HTMLElement;
    private previous?: ButtonComponent;
    private next?: ButtonComponent;
    private footer?: HTMLElement;

    constructor(app: App, private readonly manager: Manager, private readonly dismissed: () => void) { super(app); }
    private t(key: string): string { return this.manager.translator.t(key); }

    onOpen(): void {
        this.modalEl.addClass('manager-release-highlights');
        this.titleEl.setText(`1.2.0 · ${this.t('更新介绍_标题')}`);
        this.contentEl.createEl('p', { cls: 'manager-release-highlights__intro', text: this.t('更新介绍_简介') });
        const controls = new Setting(this.contentEl).setName(this.t('更新介绍_页面'));
        this.selection = new DropdownComponent(controls.controlEl);
        this.slides.forEach((slide, index) => { this.selection?.addOption(`${index}`, this.t(slide.title)); });
        this.selection.selectEl.setAttribute('aria-label', this.t('更新介绍_页面'));
        this.selection.onChange(value => { this.index = Number(value); this.renderSlide(); });
        const figure = this.contentEl.createEl('figure', { cls: 'manager-release-highlights__figure' });
        this.image = figure.createEl('img', { cls: 'manager-release-highlights__image' });
        this.image.draggable = false;
        this.caption = figure.createEl('figcaption', { cls: 'manager-release-highlights__caption', attr: { 'aria-live': 'polite' } });
        this.footer = this.modalEl.createDiv('manager-release-highlights__footer');
        const navigation = new Setting(this.footer).setName(this.t('更新介绍_浏览'));
        this.counter = navigation.descEl.createSpan({ attr: { 'aria-live': 'polite' } });
        this.previous = new ButtonComponent(navigation.controlEl).setIcon('chevron-left').setButtonText(this.t('更新介绍_上一张'))
            .onClick(() => { this.index--; this.renderSlide(); });
        this.next = new ButtonComponent(navigation.controlEl).setIcon('chevron-right').setButtonText(this.t('更新介绍_下一张'))
            .onClick(() => { this.index++; this.renderSlide(); });
        new ButtonComponent(navigation.controlEl).setButtonText(this.t('更新介绍_开始使用')).setCta().onClick(() => this.close());
        this.renderSlide();
    }

    private renderSlide(): void {
        this.index = Math.min(this.slides.length - 1, Math.max(0, this.index));
        const slide = this.slides[this.index];
        this.selection?.setValue(`${this.index}`);
        if (this.image) { this.image.src = slide.image; this.image.alt = this.t(slide.title); }
        this.caption?.setText(this.t(slide.description));
        this.counter?.setText(`${this.index + 1} / ${this.slides.length}`);
        this.previous?.setDisabled(this.index === 0);
        this.next?.setDisabled(this.index === this.slides.length - 1);
    }

    onClose(): void {
        this.contentEl.empty();
        this.footer?.remove();
        this.footer = undefined;
        this.dismissed();
    }
}
