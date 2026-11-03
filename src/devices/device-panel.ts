import { ButtonComponent, Menu, Notice, Platform, Setting, setIcon } from 'obsidian';
import type Manager from '../main';
import { confirmWithModal } from '../utils';
import { allPresets, detectDeviceType, DEVICE_TYPES, DeviceType, isDeviceType } from './device-presets';

const ICONS: Record<DeviceType, string> = { computer: 'monitor', tablet: 'tablet', phone: 'smartphone' };

/**
 * 设备管理：本机类型、命名预设与设备清单。单设备配置已取消。
 * Device type, named presets and the device list; per-device configuration is gone.
 */
export class DevicePanel {
    private selected: DeviceType;
    private root!: HTMLElement;
    private busy = false;

    constructor(private readonly manager: Manager) { this.selected = manager.devices.type; }
    private t(key: string, vars?: Record<string, string | number>): string { return this.manager.translator.t(key, vars); }

    /** 卡头统一为「图标 + 标题 + 描述」，右侧可放图标+文字操作。 */
    private renderCardHeader(card: HTMLElement, icon: string, title: string, desc?: string,
        action?: { label: string; icon: string; onClick: () => void; tooltip?: string }): void {
        const header = card.createDiv('manager-vault-card__header');
        const iconEl = header.createDiv('manager-vault-card__icon');
        setIcon(iconEl, icon);
        const group = header.createDiv('manager-vault-card__title-group');
        group.createDiv({ cls: 'manager-vault-card__title', text: title });
        if (desc) group.createDiv({ cls: 'manager-vault-card__desc', text: desc });
        if (!action) return;
        const button = new ButtonComponent(header).setIcon(action.icon).setButtonText(action.label);
        button.buttonEl.addClass('manager-vault-card__action');
        if (action.tooltip) button.setTooltip(action.tooltip);
        button.onClick(action.onClick);
    }

    render(container: HTMLElement): void {
        this.root = container;
        container.empty();
        const page = container.createDiv('manager-vault-share');
        const settings = page.createDiv('manager-vault-card');
        this.renderCardHeader(settings, 'monitor-smartphone', this.t('设备_标题'), this.t('设备_说明'));
        new Setting(settings).setName(this.t('设备_启用')).setDesc(this.t('设备_启用说明'))
            .addToggle(toggle => toggle.setValue(this.manager.devices.data.enabled).onChange(value => {
                void this.action(async () => { await this.manager.devices.setEnabled(value); });
            }));

        const detected = detectDeviceType(Platform);
        new Setting(settings).setName(this.t('设备_当前类型'))
            .setDesc(`${this.manager.devices.label(this.manager.devices.type)} · ${this.t('设备_识别类型', { type: this.manager.devices.label(detected) })}`)
            .addDropdown(dropdown => {
                DEVICE_TYPES.forEach(type => dropdown.addOption(type, this.manager.devices.label(type)));
                dropdown.setValue(this.manager.devices.type).onChange(value => {
                    if (isDeviceType(value)) void this.action(async () => {
                        await this.manager.devices.assign(this.manager.devices.id, value);
                        this.selected = value;
                    });
                });
            })
            .addExtraButton(button => button.setIcon('scan-search').setTooltip(this.t('设备_重新检测'))
                .onClick(() => {
                    void this.action(async () => {
                        await this.manager.devices.assign(this.manager.devices.id, detected);
                        this.selected = detected;
                    });
                }));

        const tabs = page.createDiv('manager-repo-page__switcher');
        tabs.setAttribute('role', 'tablist');
        for (const type of DEVICE_TYPES) {
            const selected = type === this.selected;
            const button = tabs.createEl('button', { cls: 'manager-repo-page__switch', attr: {
                type: 'button', role: 'tab', 'aria-selected': `${selected}`, 'data-state': selected ? 'active' : 'inactive',
            } });
            button.toggleClass('is-active', selected);
            setIcon(button.createSpan('manager-repo-page__switch-icon'), ICONS[type]);
            button.createSpan({ text: this.manager.devices.label(type), cls: 'manager-repo-page__switch-label' });
            button.createSpan({ text: `${this.manager.devices.presetsFor(type).length}`,
                cls: 'manager-repo-page__switch-count' });
            button.addEventListener('click', () => {
                if (selected) return;
                this.selected = type;
                this.render(this.root);
            });
        }
        this.renderPresets(page);
        this.renderDevices(page);
        // 设备记录由 DeviceManager 的文件变更事件合并；面板只被动重绘，不再轮询。
    }

    public destroy(): void {
        this.root?.empty();
    }

    private async action(task: () => Promise<void>): Promise<void> {
        if (this.busy || this.manager.devices.busy) {
            new Notice(this.t('设备_忙碌'));
            return;
        }
        this.busy = true;
        const endAction = this.manager.configProtection?.beginUserAction();
        try {
            await task();
        } catch (error) { this.manager.devices.report(error); }
        finally {
            endAction?.();
            this.busy = false;
            if (this.root.isConnected) this.render(this.root);
        }
    }

    private renderPresets(page: HTMLElement): void {
        const devices = this.manager.devices;
        const card = page.createDiv('manager-vault-card');
        const unconfigured = !devices.presetsFor(this.selected).some(preset => preset.configured);
        this.renderCardHeader(card, ICONS[this.selected], this.t('设备_预设', { type: devices.label(this.selected) }),
            unconfigured ? `${this.t('设备_预设说明')} ${this.t('设备_未配置提示')}` : this.t('设备_预设说明'),
            { label: this.t('设备_新建预设'), icon: 'plus', tooltip: this.t('设备_新建预设'), onClick: () => {
                void this.action(async () => { await devices.createPreset(this.selected); });
            } });

        for (const preset of devices.presetsFor(this.selected)) {
            const bound = preset.id === devices.boundPresetId;
            const isDefault = preset.id === devices.defaultPreset(this.selected).id;
            let name = preset.name;
            const row = new Setting(card).setName(preset.name)
                .setDesc([bound ? this.t('设备_已绑定') : this.t('设备_未绑定'), isDefault ? this.t('设备_默认预设') : ''].filter(Boolean).join(' · '));
            row.settingEl.setAttribute('data-bpm-preset-id', preset.id);
            row.addButton(button => button.setButtonText(this.t(isDefault ? '设备_默认预设' : '设备_设为默认'))
                .setDisabled(isDefault).onClick(() => { void this.action(() => devices.setDefaultPreset(preset.id)); }));
            row.addText(text => text.setValue(name).setPlaceholder(this.t('通用_名称_文本')).onChange(value => { name = value; }));
            row.addExtraButton(button => button.setIcon('save').setTooltip(this.t('设备_保存名称')).onClick(() => {
                void this.action(() => devices.renamePreset(preset.id, name));
            }));
            row.addExtraButton(button => button.setIcon(bound ? 'check' : 'pin').setTooltip(bound ? this.t('设备_已绑定') : this.t('设备_绑定本机'))
                .setDisabled(bound)
                .onClick(() => {
                    if (bound) return;
                    void this.action(async () => {
                        if (this.selected !== devices.type) {
                            const confirmed = await confirmWithModal(this.manager.app, this.manager,
                                this.t('设备_绑定换类型确认', { type: devices.label(this.selected) }));
                            if (!confirmed) return;
                        }
                        await devices.bindPreset(preset.id);
                    });
                }));
            row.addExtraButton(button => button.setIcon('copy').setTooltip(this.t('设备_复制预设')).onClick(() => {
                void this.action(async () => { await devices.duplicatePreset(preset.id); });
            }));
            const sources = allPresets(devices.data.presets).filter(entry => entry.preset.id !== preset.id);
            row.addExtraButton(button => {
                button.setIcon('git-merge').setTooltip(this.t('设备_复用配置'));
                button.extraSettingsEl.addEventListener('click', (event: MouseEvent) => {
                    const menu = new Menu();
                    if (!sources.length) {
                        menu.addItem(item => item.setTitle(this.t('设备_无可复用')).setDisabled(true));
                    }
                    for (const source of sources) {
                        menu.addItem(item => item
                            .setTitle(`${source.preset.name} · ${devices.label(source.type)}`)
                            .setIcon('copy')
                            .onClick(() => {
                                void this.action(async () => {
                                    const confirmed = await confirmWithModal(this.manager.app, this.manager,
                                        this.t('设备_复用确认', { source: source.preset.name, target: preset.name }));
                                    if (!confirmed) return;
                                    await devices.copyConfig(preset.id, source.preset.id);
                                });
                            }));
                    }
                    menu.showAtMouseEvent(event);
                });
            });
            row.addExtraButton(button => button.setIcon('trash-2').setTooltip(this.t('设备_删除预设')).onClick(() => {
                void this.action(async () => {
                    if (await confirmWithModal(this.manager.app, this.manager, this.t('设备_删除预设确认', { name: preset.name }))) {
                        await devices.deletePreset(preset.id);
                    }
                });
            }));
        }
    }

    private renderDevices(page: HTMLElement): void {
        const card = page.createDiv('manager-vault-card');
        this.renderCardHeader(card, 'list', this.t('设备_列表'));
        const devices = this.manager.devices.data.devices.filter(device => device.type === this.selected);
        if (!devices.length) card.createEl('p', { cls: 'setting-item-description', text: this.t('设备_暂无') });
        for (const device of devices) {
            const current = device.id === this.manager.devices.id;
            let name = device.name;
            const row = new Setting(card).setName(current ? `${device.name} · ${this.t('设备_本机')}` : device.name)
                .setDesc(`${this.t('设备_系统平台')}: ${this.t(`设备_平台_${device.platform || 'unknown'}`)} · ${this.t('设备_最近上线')}: ${device.lastSeen ? new Date(device.lastSeen).toLocaleString() : '—'}`);
            row.addText(text => text.setValue(name).setPlaceholder(this.t('通用_名称_文本')).onChange(value => { name = value; }));
            row.addExtraButton(button => button.setIcon('save').setTooltip(this.t('设备_保存名称')).onClick(() => {
                void this.action(() => this.manager.devices.rename(device.id, name));
            }));
            if (!current) row.addExtraButton(button => button.setIcon('trash-2').setTooltip(this.t('设备_移除')).onClick(() => {
                void this.action(async () => {
                    if (await confirmWithModal(this.manager.app, this.manager, this.t('设备_移除确认', { name: device.name }))) {
                        await this.manager.devices.remove(device.id);
                    }
                });
            }));
        }
    }
}
