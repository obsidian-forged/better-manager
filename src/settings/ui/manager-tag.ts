import { createOrganizationEntry } from '../organization';
import BaseSetting from "../base-setting";
import { Notice, setIcon, Setting } from "obsidian";
import { BPM_TAG_ID } from "src/repo-resolver";
import { BPM_IGNORE_TAG, EONDR_PLUGIN_TAG_ID } from "src/data/types";
import Commands from "src/command";

export default class ManagerTag extends BaseSetting {
    private getTagUsageCount(tagId: string): number {
        return this.settings.Plugins.reduce((count, plugin) => count + (plugin.tags?.includes(tagId) ? 1 : 0), 0);
    }

    private isPresetTag(tagId: string): boolean {
        return tagId === BPM_TAG_ID || tagId === BPM_IGNORE_TAG || tagId === EONDR_PLUGIN_TAG_ID;
    }

    main(): void {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        let id = '';
        let name = '';
        let color = this.manager.generateAutoColor(this.manager.settings.TAGS.map(t => t.color));

        const page = this.containerEl.createDiv('manager-setting-tag__container manager-taxonomy-setting');
        const usedCount = this.manager.settings.TAGS.filter((tag) => this.getTagUsageCount(tag.id) > 0).length;
        const header = page.createDiv('manager-setting-tag__header manager-taxonomy-setting__header');
        const headerMain = header.createDiv('manager-setting-tag__header-main manager-taxonomy-setting__header-main');
        const headerIcon = headerMain.createSpan({ cls: 'manager-setting-tag__header-icon manager-taxonomy-setting__header-icon' });
        setIcon(headerIcon, 'tags');
        const headerText = headerMain.createDiv('manager-setting-tag__header-text manager-taxonomy-setting__header-text');
        headerText.createDiv({ cls: 'manager-setting-tag__title manager-taxonomy-setting__title', text: t('设置_标签设置_标题') });
        headerText.createDiv({ cls: 'manager-setting-tag__desc manager-taxonomy-setting__desc', text: t('设置_标签设置_描述') });
        const stats = header.createDiv('manager-setting-tag__stats manager-taxonomy-setting__stats');
        const createStat = (label: string, value: number, icon: string) => {
            const stat = stats.createSpan({ cls: 'manager-setting-tag__stat manager-taxonomy-setting__stat' });
            const statIcon = stat.createSpan({ cls: 'manager-setting-tag__stat-icon manager-taxonomy-setting__stat-icon' });
            setIcon(statIcon, icon);
            stat.createSpan({ cls: 'manager-setting-tag__stat-label manager-taxonomy-setting__stat-label', text: label });
            stat.createSpan({ cls: 'manager-setting-tag__stat-value manager-taxonomy-setting__stat-value', text: `${value}` });
        };
        createStat(t('通用_全部_文本'), this.manager.settings.TAGS.length, 'tags');
        createStat(t('通用_使用中_文本'), usedCount, 'check');

        const createItem = new Setting(page)
            .setName(t('通用_新增_文本'))
            .setDesc(t('设置_分类_新增描述'));
        createItem.settingEl.addClass('manager-setting-tag__item');
        createItem.settingEl.addClass('manager-setting-tag__item--create');
        createItem.settingEl.addClass('manager-taxonomy-setting__row');
        createItem.settingEl.addClass('manager-taxonomy-setting__row--create');
        createItem.controlEl.addClass('manager-setting-tag__controls');
        createItem.controlEl.addClass('manager-taxonomy-setting__controls');
        createItem.addColorPicker(cb => cb
                .setValue(color)
                .onChange((value) => {
                    color = value;
                })
            )
            .addText((cb) => {
                cb.setPlaceholder('ID')
                    .onChange((value) => {
                        id = value;
                    });
                cb.inputEl.addClass('manager-setting-tag__input');
                cb.inputEl.addClass('manager-taxonomy-setting__input');
            })
            .addText((cb) => {
                cb.setPlaceholder(this.manager.translator.t('通用_名称_文本'))
                    .onChange((value) => {
                        name = value;
                    });
                cb.inputEl.addClass('manager-setting-tag__input');
                cb.inputEl.addClass('manager-taxonomy-setting__input');
            })
            .addExtraButton(cb => cb
                .setIcon('plus')
                .setTooltip(t('设置_标签设置_新增标签'))
                .onClick(() => {
                    const nextId = id.trim();
                    const nextName = name.trim() || nextId;
                    if (color === '') color = this.manager.generateAutoColor(this.manager.settings.TAGS.map(t => t.color));
                    if (createOrganizationEntry(this.manager.settings, 'tag', { id: nextId, name: nextName, color })) {
                        void this.manager.saveSettings();
                        this.settingTab.tagDisplay();
                        Commands(this.app, this.manager);
                        new Notice(this.manager.translator.t('设置_标签设置_通知_一'));
                    } else {
                        new Notice(this.manager.translator.t('设置_标签设置_通知_二'));
                    }
                })
            )
        const list = page.createDiv('manager-setting-tag__list manager-taxonomy-setting__list');
        this.manager.settings.TAGS.forEach((tag, index) => {
            const item = new Setting(list)
            const usageCount = this.getTagUsageCount(tag.id);
            const isPreset = this.isPresetTag(tag.id);
            item.setClass('manager-setting-tag__item')
            item.settingEl.addClass('manager-taxonomy-setting__row');
            item.settingEl.toggleClass('is-system', isPreset);
            item.settingEl.toggleClass('is-used', usageCount > 0);
            item.controlEl.addClass('manager-setting-tag__controls');
            item.controlEl.addClass('manager-taxonomy-setting__controls');
            // item.setName(`${index + 1}. `)
            item.nameEl.empty();
            item.descEl.empty();
            const titleRow = item.nameEl.createDiv('manager-setting-tag__item-title manager-taxonomy-setting__item-title');
            const tagEl = this.manager.createTag(tag.name || tag.id, tag.color, this.settings.TAG_STYLE);
            tagEl.addClass('manager-setting-tag__preview');
            tagEl.addClass('manager-taxonomy-setting__preview');
            titleRow.appendChild(tagEl);
            titleRow.createSpan({ cls: 'manager-setting-tag__id manager-taxonomy-setting__id', text: tag.id });
            if (isPreset) titleRow.createSpan({ cls: 'manager-setting-tag__badge manager-taxonomy-setting__badge is-system', text: t('通用_系统_文本') });
            const meta = item.descEl.createDiv('manager-setting-tag__meta manager-taxonomy-setting__meta');
            meta.createSpan({ text: t('设置_分类_插件使用数量', { count: usageCount }) });
            meta.createSpan({ text: `#${index + 1}` });
            item.addColorPicker(cb => cb
                .setValue(tag.color)
                .onChange((value) => {
                    tag.color = value;
                    void this.manager.saveSettings();
                    this.manager.applyTagStyle(tagEl, value, this.settings.TAG_STYLE);
                })
            );
            item.addText((cb) => {
                cb.setValue(tag.name)
                    .onChange((value) => {
                        tag.name = value;
                        tagEl.textContent = value || tag.id;
                        void this.manager.saveSettings();
                    });
                cb.inputEl.addClass('manager-setting-tag__input');
                cb.inputEl.addClass('manager-taxonomy-setting__input');
            });
            item.addExtraButton(cb => cb
                .setIcon('trash-2')
                .setTooltip(isPreset ? t('设置_标签设置_系统标签不可删除') : usageCount > 0 ? t('设置_分类_仍有插件使用不可删除') : t('设置_标签设置_删除标签'))
                .onClick(() => {
                    if (isPreset) {
                        new Notice(this.manager.translator.t('设置_标签设置_通知_预设不可删除'));
                        return;
                    }
                    const hasTestTag = this.settings.Plugins.some(plugin => plugin.tags && plugin.tags.includes(tag.id));
                    if (!hasTestTag) {
                        this.manager.settings.TAGS = this.manager.settings.TAGS.filter(t => t.id !== tag.id);
                        void this.manager.saveSettings();
                        this.settingTab.tagDisplay();
                        Commands(this.app, this.manager);
                        new Notice(this.manager.translator.t('设置_标签设置_通知_三'));
                    } else {
                        new Notice(this.manager.translator.t('设置_标签设置_通知_四'));
                    }
                })
            );
        });

    }
}
