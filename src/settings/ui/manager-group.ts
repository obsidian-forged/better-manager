import BaseSetting from "../base-setting";
import { Notice, setIcon, Setting } from "obsidian";
import Commands from "src/command";

export default class ManagerGroup extends BaseSetting {
    private getGroupUsageCount(groupId: string): number {
        return this.settings.Plugins.reduce((count, plugin) => count + (plugin.group === groupId ? 1 : 0), 0);
    }

    main(): void {
        const t = (k: string, vars?: Record<string, string | number | boolean | null | undefined>) => this.manager.translator.t(k, vars);
        let id = '';
        let name = '';
        let color = this.manager.generateAutoColor(this.manager.settings.GROUPS.map(g => g.color));

        const page = this.containerEl.createDiv('manager-setting-group__container manager-taxonomy-setting');
        const usedCount = this.manager.settings.GROUPS.filter((group) => this.getGroupUsageCount(group.id) > 0).length;
        const header = page.createDiv('manager-taxonomy-setting__header');
        const headerMain = header.createDiv('manager-taxonomy-setting__header-main');
        const headerIcon = headerMain.createSpan({ cls: 'manager-taxonomy-setting__header-icon' });
        setIcon(headerIcon, 'folders');
        const headerText = headerMain.createDiv('manager-taxonomy-setting__header-text');
        headerText.createDiv({ cls: 'manager-taxonomy-setting__title', text: t('设置_分组设置_标题') });
        headerText.createDiv({ cls: 'manager-taxonomy-setting__desc', text: t('设置_分组设置_描述') });
        const stats = header.createDiv('manager-taxonomy-setting__stats');
        const createStat = (label: string, value: number, icon: string) => {
            const stat = stats.createSpan({ cls: 'manager-taxonomy-setting__stat' });
            const statIcon = stat.createSpan({ cls: 'manager-taxonomy-setting__stat-icon' });
            setIcon(statIcon, icon);
            stat.createSpan({ cls: 'manager-taxonomy-setting__stat-label', text: label });
            stat.createSpan({ cls: 'manager-taxonomy-setting__stat-value', text: `${value}` });
        };
        createStat(t('通用_全部_文本'), this.manager.settings.GROUPS.length, 'folders');
        createStat(t('通用_使用中_文本'), usedCount, 'check');

        const createItem = new Setting(page)
            .setName(t('通用_新增_文本'))
            .setDesc(t('设置_分类_新增描述'));
        createItem.settingEl.addClass('manager-setting-group__item');
        createItem.settingEl.addClass('manager-taxonomy-setting__row');
        createItem.settingEl.addClass('manager-taxonomy-setting__row--create');
        createItem.controlEl.addClass('manager-taxonomy-setting__controls');
        createItem.addColorPicker(cb => cb
                .setValue(color)
                .onChange((value) => {
                    color = value;
                })
            )
            .addText(cb => cb
                .setPlaceholder('ID')
                .onChange((value) => {
                    id = value;
                })
                .inputEl.addClass('manager-taxonomy-setting__input')
            )
            .addText(cb => cb
                .setPlaceholder(this.manager.translator.t('通用_名称_文本'))
                .onChange((value) => {
                    name = value;
                })
                .inputEl.addClass('manager-taxonomy-setting__input')
            )
            .addExtraButton(cb => cb
                .setIcon('plus')
                .setTooltip(t('设置_分组设置_新增分组'))
                .onClick(() => {
                    const nextId = id.trim();
                    const nextName = name.trim() || nextId;
                    const containsId = this.manager.settings.GROUPS.some(tag => tag.id === nextId);
                    if (!containsId && nextId !== '') {
                        if (color === '') color = this.manager.generateAutoColor(this.manager.settings.GROUPS.map(g => g.color));
                        this.manager.settings.GROUPS.push({ id: nextId, name: nextName, color });
                        void this.manager.saveSettings();
                        this.settingTab.groupDisplay();
                        Commands(this.app, this.manager);
                        new Notice(this.manager.translator.t('设置_分组设置_通知_一'));
                    } else {
                        new Notice(this.manager.translator.t('设置_分组设置_通知_二'));
                    }
                })
            )

        const list = page.createDiv('manager-taxonomy-setting__list');
        this.manager.settings.GROUPS.forEach((group, index) => {
            const item = new Setting(list)
            const usageCount = this.getGroupUsageCount(group.id);
            item.settingEl.addClass('manager-setting-group__item')
            item.settingEl.addClass('manager-taxonomy-setting__row');
            item.settingEl.toggleClass('is-used', usageCount > 0);
            item.controlEl.addClass('manager-taxonomy-setting__controls');
            // item.setName(`${index + 1}. `)
            item.nameEl.empty();
            item.descEl.empty();
            const titleRow = item.nameEl.createDiv('manager-taxonomy-setting__item-title');
            const tagEl = this.manager.createTag(group.name || group.id, group.color, this.settings.GROUP_STYLE);
            tagEl.addClass('manager-taxonomy-setting__preview');
            titleRow.appendChild(tagEl);
            titleRow.createSpan({ cls: 'manager-taxonomy-setting__id', text: group.id });
            const meta = item.descEl.createDiv('manager-taxonomy-setting__meta');
            meta.createSpan({ text: t('设置_分类_插件使用数量', { count: usageCount }) });
            meta.createSpan({ text: `#${index + 1}` });
            item.addColorPicker(cb => cb
                .setValue(group.color)
                .onChange((value) => {
                    group.color = value;
                    void this.manager.saveSettings();
                    this.manager.applyTagStyle(tagEl, value, this.settings.GROUP_STYLE);
                })
            )
            item.addText(cb => cb
                .setValue(group.name)
                .onChange((value) => {
                    group.name = value;
                    tagEl.textContent = value || group.id;
                    void this.manager.saveSettings();
                })
                .inputEl.addClass('manager-taxonomy-setting__input')
            )
            item.addExtraButton(cb => cb
                .setIcon('trash-2')
                .setTooltip(usageCount > 0 ? t('设置_分类_仍有插件使用不可删除') : t('设置_分组设置_删除分组'))
                .onClick(() => {
                    const hasTestGroup = this.settings.Plugins.some(plugin => plugin.group === group.id);
                    if (!hasTestGroup) {
                        this.manager.settings.GROUPS = this.manager.settings.GROUPS.filter(t => t.id !== group.id);
                        void this.manager.saveSettings();
                        this.settingTab.groupDisplay();
                        Commands(this.app, this.manager);
                        new Notice(this.manager.translator.t('设置_分组设置_通知_三'));
                    } else {
                        new Notice(this.manager.translator.t('设置_分组设置_通知_四'));
                    }
                })
            )
        });
    }
}
