import { createActionHandler } from '../ui/action-handler';
import { App, ExtraButtonComponent, Modal, Notice, setIcon, Setting } from 'obsidian';
import { ManagerSettings } from '../settings/data';
import Manager from 'main';
import type { ManagerModal } from './manager-modal';
import { ManagerPlugin, BPM_IGNORE_TAG, EONDR_PLUGIN_TAG_ID } from 'src/data/types';
import Commands from 'src/command';
import { BPM_TAG_ID } from 'src/repo-resolver';
import { getExtraButtonElement } from 'src/obsidian-internals';

export class TagsModal extends Modal {
    private readonly action = createActionHandler(error => {
        if (this.manager.settings.DEBUG) console.error('[BPM] Modal action failed', error);
        new Notice(`${this.manager.translator.t('安装_错误_通用')} ${error instanceof Error ? error.message : ''}`);
    });
    settings: ManagerSettings;
    manager: Manager;
    managerModal: ManagerModal;
    managerPlugin: ManagerPlugin;
    selected: string;
    add: boolean;
    private defaultTagColor = '';

    constructor(app: App, manager: Manager, managerModal: ManagerModal, managerPlugin: ManagerPlugin) {
        super(app);
        this.settings = manager.settings;
        this.manager = manager;
        this.managerModal = managerModal;
        this.managerPlugin = managerPlugin;
        this.selected = '';
        this.add = false;
    }

    private getExtraButtonEl(button: ExtraButtonComponent): HTMLElement | undefined {
        return getExtraButtonElement(button);
    }

    private prepareIconButton(button: ExtraButtonComponent, label: string, className?: string) {
        button.setTooltip(label);
        const buttonEl = this.getExtraButtonEl(button);
        buttonEl?.setAttribute('aria-label', label);
        if (className) buttonEl?.addClass(className);
    }

    private getTagUsageCount(tagId: string): number {
        return this.settings.Plugins.reduce((count, plugin) => count + (plugin.tags?.includes(tagId) ? 1 : 0), 0);
    }

    private isPresetTag(tagId: string): boolean {
        return tagId === BPM_TAG_ID || tagId === BPM_IGNORE_TAG || tagId === EONDR_PLUGIN_TAG_ID;
    }

    private async showHead() {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        const modalEl = this.contentEl.parentElement;
        if (!modalEl) return;
        modalEl.addClass('manager-editor__container');
        modalEl.addClass('manager-tag-editor');
        modalEl.addClass('manager-taxonomy-editor');
        modalEl.addClass('manager-taxonomy-editor--tag');
        modalEl.getElementsByClassName('modal-close-button')[0]?.remove();
        this.titleEl.parentElement?.addClass('manager-container__header');
        this.contentEl.addClass('manager-item-container');
        this.contentEl.addClass('manager-tag-editor__body');
        // [标题行]
        const titleBar = new Setting(this.titleEl).setClass('manager-bar__title');
        titleBar.settingEl.addClass('manager-tag-editor__titlebar');
        titleBar.nameEl.empty();
        titleBar.descEl.empty();
        const titleWrap = titleBar.nameEl.createDiv('manager-tag-editor__title');
        const titleIcon = titleWrap.createSpan({ cls: 'manager-tag-editor__title-icon' });
        setIcon(titleIcon, 'tags');
        const titleText = titleWrap.createDiv('manager-tag-editor__title-text');
        titleText.createDiv({ cls: 'manager-tag-editor__eyebrow', text: t('标签编辑_标题') });
        titleText.createDiv({ cls: 'manager-tag-editor__plugin-name', text: this.managerPlugin.name || this.managerPlugin.id });
        titleBar.descEl.setText(t('标签编辑_说明'));
        // [标题行] 关闭按钮
        const closeButton = new ExtraButtonComponent(titleBar.controlEl)
        closeButton.setIcon('x')
        this.prepareIconButton(closeButton, t('通用_关闭_文本'));
        closeButton.onClick(() => this.close());
    }

    private async showData() {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        // 预先生成缺省颜色，避免与现有标签颜色过近
        if (!this.defaultTagColor) {
            this.defaultTagColor = this.pickDistinctColor(this.settings.TAGS.map(t => t.color));
        }
        const page = this.contentEl.createDiv('manager-tag-editor__page');
        const assignedCount = this.settings.TAGS.filter((tag) => this.managerPlugin.tags.includes(tag.id)).length;
        const summary = page.createDiv('manager-tag-editor__summary');
        const summaryMain = summary.createDiv('manager-tag-editor__summary-main');
        summaryMain.createDiv({ cls: 'manager-tag-editor__summary-title', text: t('标签编辑_分配标题') });
        summaryMain.createDiv({ cls: 'manager-tag-editor__summary-desc', text: t('标签编辑_分配说明', { id: this.managerPlugin.id, selected: assignedCount, total: this.settings.TAGS.length }) });
        const summaryStats = summary.createDiv('manager-tag-editor__summary-stats');
        const createSummaryStat = (label: string, value: number, icon: string) => {
            const stat = summaryStats.createSpan({ cls: 'manager-tag-editor__summary-stat' });
            const statIcon = stat.createSpan({ cls: 'manager-tag-editor__summary-stat-icon' });
            setIcon(statIcon, icon);
            stat.createSpan({ cls: 'manager-tag-editor__summary-stat-label', text: label });
            stat.createSpan({ cls: 'manager-tag-editor__summary-stat-value', text: `${value}` });
        };
        createSummaryStat(t('通用_全部_文本'), this.settings.TAGS.length, 'tags');
        createSummaryStat(t('通用_已分配_文本'), assignedCount, 'check');

        const list = page.createDiv('manager-tag-editor__list');
        for (const tag of this.settings.TAGS) {
            const assigned = this.managerPlugin.tags.includes(tag.id);
            const usageCount = this.getTagUsageCount(tag.id);
            const isPreset = this.isPresetTag(tag.id);
            const isEditing = this.selected == tag.id;
            const itemEl = new Setting(list)
            itemEl.setClass('manager-editor__item')
            itemEl.settingEl.addClass('manager-tag-editor__item');
            itemEl.settingEl.toggleClass('is-assigned', assigned);
            itemEl.settingEl.toggleClass('is-editing', isEditing); 
            itemEl.settingEl.toggleClass('is-system', isPreset);
            itemEl.nameEl.empty();
            itemEl.descEl.empty();
            itemEl.controlEl.addClass('manager-tag-editor__item-actions');

            const previewLine = itemEl.nameEl.createDiv('manager-tag-editor__preview-line');
            const tagEl = this.manager.createTag(tag.name || tag.id, tag.color, this.settings.TAG_STYLE);
            tagEl.addClass('manager-tag-editor__chip');
            const chipSlot = previewLine.createSpan({ cls: 'manager-tag-editor__chip-slot' });
            chipSlot.appendChild(tagEl);
            previewLine.createSpan({ cls: 'manager-tag-editor__id', text: tag.id });
            if (isPreset) previewLine.createSpan({ cls: 'manager-tag-editor__badge is-system', text: t('通用_系统_文本') });
            if (assigned) previewLine.createSpan({ cls: 'manager-tag-editor__badge is-assigned', text: t('通用_已分配_文本') });

            const meta = itemEl.descEl.createDiv('manager-tag-editor__meta');
            meta.createSpan({ text: t('设置_分类_插件使用数量', { count: usageCount }) });
            if (tag.id === BPM_TAG_ID) meta.createSpan({ text: t('标签编辑_自动管理标签不可手动切换') });

            if (!isEditing) {
                itemEl.addExtraButton((cb) => {
                    cb.setIcon('pencil');
                    this.prepareIconButton(cb, t('通用_编辑项目_标签', { name: tag.name || tag.id }), 'manager-tag-editor__edit-button');
                    cb.onClick(() => {
                        this.selected = tag.id;
                        this.action(async () => { await this.reloadShowData(); })();
                    });
                })
                itemEl.addToggle(toggle => {
                    toggle
                    .setValue(assigned)
                    .setDisabled(tag.id === BPM_TAG_ID) // BPM 标签不可手动移除，但 Ignore 标签可以手动移除? 不，Ignore 标签应该可以自由加减
                    // 这里的 setDisabled 是指能不能给这个插件加上这个标签。BPM_TAG_ID 是系统自动加的，用户不能动。
                    // BPM_IGNORE_TAG 是用户手动加的，所以这里不能 Disable。
                    .onChange(async (isChecked) => {
                        if (isChecked) {
                            // 添加开启的标签
                            if (!this.managerPlugin.tags.includes(tag.id)) {
                                this.managerPlugin.tags.push(tag.id);
                            }
                        } else {
                            // 移除关闭的标签
                            this.managerPlugin.tags = this.managerPlugin.tags.filter(t => t !== tag.id);
                        }
                        await this.manager.savePluginAndExport(this.managerPlugin.id);
                        this.managerModal.refreshPluginCard(this.managerPlugin.id, { allowReload: true });
                        this.action(async () => { await this.reloadShowData(); })();
                    });
                    toggle.toggleEl.addClass('manager-tag-editor__toggle');
                    toggle.toggleEl.setAttribute('aria-label', t(assigned ? '通用_移除项目_标签' : '通用_添加项目_标签', { name: tag.name || tag.id }));
                });
            }
            if (isEditing) {
                itemEl.addColorPicker(cb => cb
                    .setValue(tag.color)
                    .onChange((value) => {
                        tag.color = value;
                        this.action(async () => { await this.manager.saveSettings(); })();
                        this.manager.applyTagStyle(tagEl, value, this.settings.TAG_STYLE);
                    })
                )
                itemEl.addText(text => {
                    text
                    .setValue(tag.name)
                    .onChange((value) => {
                        tag.name = value;
                        tagEl.textContent = value || tag.id;
                        this.action(async () => { await this.manager.saveSettings(); })();
                    });
                    text.inputEl.addClass('manager-editor__item-input');
                    text.inputEl.addClass('manager-tag-editor__name-input');
                    text.inputEl.setAttribute('aria-label', t('标签编辑_标签名称_标签'));
                })
                itemEl.addExtraButton((cb) => {
                    cb.setIcon('trash-2');
                    this.prepareIconButton(cb, isPreset ? t('设置_标签设置_系统标签不可删除') : t('设置_标签设置_删除标签'), 'manager-tag-editor__delete-button');
                    cb.onClick(() => {
                        if (isPreset) {
                            new Notice(this.manager.translator.t('设置_标签设置_通知_预设不可删除'));
                            return;
                        }
                        const hasTestTag = this.settings.Plugins.some(plugin => plugin.tags && plugin.tags.includes(tag.id));
                        if (!hasTestTag) {
                            this.manager.settings.TAGS = this.manager.settings.TAGS.filter(t => t.id !== tag.id);
                            this.action(async () => { await this.manager.saveSettings(); })();
                            this.action(async () => { await this.reloadShowData(); })();
                            Commands(this.app, this.manager);
                            new Notice(this.manager.translator.t('设置_标签设置_通知_三'));
                        } else {
                            new Notice(this.manager.translator.t('设置_标签设置_通知_四'));
                        }
                    });
                })

                itemEl.addExtraButton((cb) => {
                    cb.setIcon('check');
                    this.prepareIconButton(cb, t('通用_完成编辑_文本'), 'manager-tag-editor__save-button');
                    cb.onClick(() => {
                        this.selected = '';
                        this.action(async () => { await this.reloadShowData(); })();
                        this.managerModal.refreshVisiblePluginCards();
                    });
                })
            }
        }
        if (this.add) {
            let color = this.pickDistinctColor(this.settings.TAGS.map(t => t.color));
            const addPanel = page.createDiv('manager-tag-editor__create-panel');
            const preview = addPanel.createDiv('manager-tag-editor__create-preview');
            const previewMain = preview.createDiv('manager-tag-editor__create-preview-main');
            const previewChip = this.manager.createTag(t('通用_名称_文本'), color, this.settings.TAG_STYLE);
            previewChip.addClass('manager-tag-editor__chip');
            previewChip.addClass('manager-tag-editor__create-chip');
            const previewChipSlot = previewMain.createSpan({ cls: 'manager-tag-editor__chip-slot manager-tag-editor__chip-slot--preview' });
            previewChipSlot.appendChild(previewChip);
            const previewText = previewMain.createDiv('manager-tag-editor__create-preview-text');
            previewText.createDiv({ cls: 'manager-tag-editor__create-title', text: t('设置_标签设置_新增标签') });
            const previewId = previewText.createDiv({ cls: 'manager-tag-editor__create-id', text: 'ID' });
            preview.createDiv({ cls: 'manager-tag-editor__create-desc', text: t('设置_分类_新增描述') });

            const form = addPanel.createDiv('manager-tag-editor__create-form');
            const createField = (label: string, className = '') => {
                const field = form.createDiv(`manager-tag-editor__create-field ${className}`);
                field.createDiv({ cls: 'manager-tag-editor__create-label', text: label });
                return field;
            };
            const colorField = createField(t('通用_颜色_文本'), 'manager-tag-editor__create-field--color');
            const colorInput = colorField.createEl('input');
            colorInput.type = 'color';
            colorInput.value = color;
            colorInput.addClass('manager-tag-editor__create-color');
            colorInput.setAttribute('aria-label', t('通用_颜色_文本'));

            const idField = createField(t('通用_ID_文本'));
            const idInput = idField.createEl('input');
            idInput.type = 'text';
            idInput.placeholder = 'Tag-id';
            idInput.spellcheck = false;
            idInput.addClass('manager-editor__item-input');
            idInput.addClass('manager-tag-editor__create-input');
            idInput.setAttribute('aria-label', t('通用_ID_文本'));

            const nameField = createField(t('通用_名称_文本'));
            const nameInput = nameField.createEl('input');
            nameInput.type = 'text';
            nameInput.placeholder = t('通用_名称_文本');
            nameInput.addClass('manager-editor__item-input');
            nameInput.addClass('manager-tag-editor__create-input');
            nameInput.setAttribute('aria-label', t('通用_名称_文本'));

            const updatePreview = () => {
                const nextId = idInput.value.trim();
                const nextName = nameInput.value.trim();
                previewChip.textContent = nextName || nextId || t('通用_名称_文本');
                this.manager.applyTagStyle(previewChip, color, this.settings.TAG_STYLE);
                previewId.setText(nextId || 'ID');
            };
            const submit = () => {
                const nextId = idInput.value.trim();
                const nextName = nameInput.value.trim() || nextId;
                const containsId = this.manager.settings.TAGS.some(tag => tag.id === nextId);
                if (!containsId && nextId !== '' && nextId !== BPM_TAG_ID && nextId !== BPM_IGNORE_TAG) {
                    this.manager.settings.TAGS.push({ id: nextId, name: nextName, color });
                    this.action(async () => { await this.manager.saveSettings(); })();
                    this.add = false;
                    this.action(async () => { await this.reloadShowData(); })();
                    Commands(this.app, this.manager);
                    new Notice(this.manager.translator.t('设置_标签设置_通知_一'));
                } else {
                    new Notice(this.manager.translator.t('设置_标签设置_通知_二'));
                }
            };
            const onEnter = (event: KeyboardEvent) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                submit();
            };
            colorInput.addEventListener('input', () => {
                color = colorInput.value;
                updatePreview();
            });
            idInput.addEventListener('input', () => updatePreview());
            nameInput.addEventListener('input', () => updatePreview());
            idInput.addEventListener('keydown', onEnter);
            nameInput.addEventListener('keydown', onEnter);

            const actions = addPanel.createDiv('manager-tag-editor__create-actions');
            const cancelButton = actions.createEl('button', { cls: 'manager-tag-editor__create-action' });
            cancelButton.type = 'button';
            cancelButton.setAttribute('aria-label', t('通用_取消_文本'));
            setIcon(cancelButton.createSpan({ cls: 'manager-tag-editor__create-action-icon' }), 'x');
            cancelButton.createSpan({ text: t('通用_取消_文本') });
            cancelButton.addEventListener('click', () => {
                this.add = false;
                this.action(async () => { await this.reloadShowData(); })();
            });
            const submitButton = actions.createEl('button', { cls: 'manager-tag-editor__create-action manager-tag-editor__create-action--primary' });
            submitButton.type = 'button';
            submitButton.setAttribute('aria-label', t('标签编辑_创建标签'));
            setIcon(submitButton.createSpan({ cls: 'manager-tag-editor__create-action-icon' }), 'plus');
            submitButton.createSpan({ text: t('标签编辑_创建标签') });
            submitButton.addEventListener('click', submit);
            window.setTimeout(() => idInput.focus(), 0);
        } else {
            // [底部行] 新增
            const foodBar = new Setting(page).setClass('manager-bar__title').setName(this.manager.translator.t('通用_新增_文本'));
            foodBar.settingEl.addClass('manager-tag-editor__add-trigger');
            foodBar.descEl.setText(t('标签编辑_创建全局标签'));
            const addButton = new ExtraButtonComponent(foodBar.controlEl)
            addButton.setIcon('circle-plus')
            this.prepareIconButton(addButton, t('设置_标签设置_新增标签'), 'manager-tag-editor__save-button');
            addButton.onClick(() => {
                this.add = true;
                this.action(async () => { await this.reloadShowData(); })();
            });
        }
    }

    private async reloadShowData() {
        let scrollTop = 0;
        const modalElement: HTMLElement = this.contentEl;
        scrollTop = modalElement.scrollTop;
        modalElement.empty();
        await this.showData();
        modalElement.scrollTo(0, scrollTop);
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

    private pickDistinctColor(existing: string[]): string {
        const palette = ['#FF6B6B', '#4ECDC4', '#FFD166', '#A78BFA', '#48BB78', '#F472B6', '#38BDF8', '#F59E0B', '#22D3EE', '#F97316', '#10B981', '#E11D48', '#6366F1', '#14B8A6'];
        const toRgb = (hex: string) => {
            const clean = hex.replace('#', '');
            const num = parseInt(clean, 16);
            return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
        };
        const dist = (a: string, b: string) => {
            const [ar, ag, ab] = toRgb(a);
            const [br, bg, bb] = toRgb(b);
            return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
        };
        const MIN_DIST = 80;
        for (const c of palette) {
            const min = existing.length ? Math.min(...existing.map((ex) => dist(ex, c))) : Infinity;
            if (min === Infinity || min > MIN_DIST) return c;
        }
        return palette[0];
    }
}
