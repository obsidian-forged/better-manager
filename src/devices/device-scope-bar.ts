import { ButtonComponent, Menu, Modal, Notice, Setting, setIcon } from 'obsidian';
import type Manager from '../main';
import { ScopeSelect } from '../ui/scope-select';
import { featureEnabled } from '../features';
import { DEVICE_TYPES, DeviceScope, ScopePage, scopeKey, DeviceType, PresetConfigParts } from './device-presets';

/**
 * 三栏共用的预设选择器：按设备类型分组列出命名预设，复用管理器筛选栏的自定义下拉。
 * Shared preset selector grouped by device type, built from the manager's own dropdown.
 */
/** 快速应用范围选择：默认全选，可只覆盖 Ribbon 等单个部分。 */
class QuickApplyPartsModal extends Modal {
    private parts: PresetConfigParts;
    private settled = false;

    constructor(app: Manager['app'], private readonly manager: Manager,
        private readonly sourceLabel: string, private readonly targetLabel: string,
        private readonly effect: string, private readonly configured: boolean,
        initial: PresetConfigParts, private readonly resolve: (parts: PresetConfigParts | null) => void) {
        super(app);
        this.parts = { ...initial };
    }

    onOpen(): void {
        const t = (key: string, vars?: Record<string, string | number>) => this.manager.translator.t(key, vars);
        this.titleEl.empty();
        this.titleEl.addClass('quick-apply-parts__title');
        setIcon(this.titleEl.createSpan('quick-apply-parts__title-icon'), 'copy-check');
        this.titleEl.createSpan({ text: t('设备_快速应用_保存配置') });
        this.modalEl.addClass('quick-apply-parts-modal');
        this.contentEl.empty();
        this.contentEl.createEl('p', { cls: 'quick-apply-parts__summary', text: `${this.sourceLabel} → ${this.targetLabel}` });
        this.contentEl.createEl('p', { cls: 'quick-apply-parts__effect', text: this.effect });
        if (this.configured) this.contentEl.createEl('p', { cls: 'mod-warning', text: t('设备_快速应用_覆盖警告') });
        new Setting(this.contentEl).setName(t('设备_快速应用_范围')).setDesc(t('设备_快速应用_范围说明')).setHeading();
        const row = (key: keyof PresetConfigParts, label: string, icon: string) => {
            const setting = new Setting(this.contentEl).setName(label).addToggle(toggle => toggle
                .setValue(this.parts[key])
                .onChange(value => { this.parts = { ...this.parts, [key]: value }; }));
            setting.nameEl.addClass('quick-apply-parts__row-name');
            const iconEl = setting.nameEl.createSpan('quick-apply-parts__row-icon');
            setIcon(iconEl, icon);
            setting.nameEl.prepend(iconEl);
        };
        row('plugins', t('设备_快速应用_范围_插件'), 'blocks');
        row('filters', t('设备_快速应用_范围_筛选'), 'filter');
        row('ribbon', t('设备_快速应用_范围_Ribbon'), 'grip-vertical');
        row('appearance', t('设备_快速应用_范围_外观'), 'palette');
        const footer = this.contentEl.createDiv('modal-button-container');
        new ButtonComponent(footer).setButtonText(t('通用_取消_文本')).onClick(() => this.close());
        new ButtonComponent(footer).setButtonText(t('通用_确认_文本')).setCta().onClick(() => {
            if (!this.parts.plugins && !this.parts.filters && !this.parts.ribbon && !this.parts.appearance) {
                new Notice(t('设备_快速应用_范围_未选'));
                return;
            }
            this.settled = true;
            this.resolve({ ...this.parts });
            this.close();
        });
    }

    onClose(): void {
        if (!this.settled) this.resolve(null);
        this.contentEl.empty();
    }
}

export class DeviceScopeBar {
    private closeMenu: (() => void) | null = null;

    constructor(private readonly manager: Manager, private readonly onChange: () => void) {}

    close(): void { this.closeMenu?.(); this.closeMenu = null; }

    render(container: HTMLElement, page: ScopePage, inline = false): void {
        this.close();
        const devices = this.manager.devices;
        const t = (key: string, vars?: Record<string, string | number>) => this.manager.translator.t(key, vars);
        const enabled = devices.data.enabled;
        const scope = devices.selectedScope(page);
        const host = inline ? container : container.createDiv('manager-device-scope');
        if (inline) { container.empty(); container.addClass('manager-device-scope', 'manager-device-scope--inline'); }
        host.addClass('manager-overview-controls');
        const selects: ScopeSelect[] = [];
        if (featureEnabled(this.manager.settings, 'devices')) {
            const options = DEVICE_TYPES.flatMap(type => devices.presetsFor(type).map(preset => ({
                value: scopeKey(preset.id), label: preset.name + (preset.id === devices.boundPresetId ? ' (' + t('设备_本机') + ')' : ''), group: devices.label(type),
            })));
            const select = new ScopeSelect(host, t('设备_作用域短'), 'monitor-smartphone', scope.key, options, value => {
                void devices.selectScope(page, value).then(() => this.onChange()).catch(error => devices.report(error));
            }, !enabled, enabled ? (devices.isLiveScope(scope) ? t('设备_本机') : t('设备_仅保存')) : t('设备_未启用_短'));
            select.field.addClass('manager-overview-controls__device');
            selects.push(select);
            const quickApply = select.control.createEl('button', { cls: 'manager-device-scope__quick-apply', attr: {
                type: 'button', 'aria-label': t('设备_快速应用'), title: t('设备_快速应用'),
            } });
            setIcon(quickApply, 'copy-check');
            quickApply.disabled = !enabled;
            quickApply.addEventListener('click', event => { event.stopPropagation(); this.openQuickApplyMenu(event, page); });
        }
        if (page === 'plugins' || page === 'themes') {
            const overviewPage = page;
            const select = new ScopeSelect(host, t('生效方式_标题'), 'timer', this.manager.overview.mode(page), [
                { value: 'session', label: t('生效方式_会话') },
                { value: 'persistent', label: t('生效方式_持久') },
            ], value => {
                if (value !== 'session' && value !== 'persistent') return;
                this.manager.overview.setMode(overviewPage, value);
                this.onChange();
            });
            select.field.addClass('manager-overview-controls__mode');
            select.field.setAttribute('title', t('生效方式_说明'));
            selects.push(select);
        }
        this.closeMenu = () => selects.forEach(select => select.close());
    }

    /** 先选目标类型、再选预设、最后选取当前窗口或选中预设为来源。 */
    private openQuickApplyMenu(event: MouseEvent, page: ScopePage): void {
        const devices = this.manager.devices;
        const typeMenu = new Menu();
        for (const type of DEVICE_TYPES) {
            typeMenu.addItem(item => item.setTitle(devices.label(type)).setIcon(type === 'computer' ? 'monitor' : type === 'tablet' ? 'tablet' : 'smartphone')
                .onClick(() => this.openQuickApplyPresetMenu(event, page, type)));
        }
        typeMenu.showAtMouseEvent(event);
    }

    /** 默认只勾选当前栏目正在编辑的部分。 */
    private defaultParts(page: ScopePage): PresetConfigParts {
        if (page === 'plugins') return { plugins: true, filters: true, ribbon: false, appearance: false };
        if (page === 'themes') return { plugins: false, filters: false, ribbon: false, appearance: true };
        return { plugins: false, filters: false, ribbon: true, appearance: false };
    }

    private openQuickApplyPresetMenu(event: MouseEvent, page: ScopePage, type: DeviceType): void {
        const devices = this.manager.devices;
        const t = (key: string, vars?: Record<string, string | number>) => this.manager.translator.t(key, vars);
        const selectedScope = devices.selectedScope(page);
        const targetLabel = (name: string) => t('设备_快速应用_目标预设', { name });
        const apply = async (presetId: string, presetName: string) => {
            const sourceLabel = `${t('设备_快速应用_当前窗口')}（${t('设备_快速应用_当前窗口说明')}）`;
            const effect = devices.data.enabled && presetId === devices.boundPresetId
                ? t('设备_快速应用_立即生效')
                : t('设备_快速应用_稍后生效');
            const configured = Boolean(devices.presetById(presetId)?.preset.configured);
            const parts = await new Promise<PresetConfigParts | null>(resolve => {
                const modal = new QuickApplyPartsModal(
                    this.manager.app, this.manager, sourceLabel, targetLabel(presetName), effect, configured,
                    this.defaultParts(page), resolve);
                modal.open();
            });
            if (!parts) return;
            await devices.quickApply(presetId, page, 'window', parts);
            new Notice(t('设备_快速应用完成', { target: targetLabel(presetName) }));
        };
        const presetMenu = new Menu();
        for (const preset of devices.presetsFor(type)) {
            if (preset.id === selectedScope.presetId) {
                presetMenu.addItem(item => item.setTitle(`${targetLabel(preset.name)} · ${t('设备_快速应用_目标相同')}`).setIcon('settings-2').setDisabled(true));
                continue;
            }
            presetMenu.addItem(item => item.setTitle(targetLabel(preset.name)).setIcon('settings-2').onClick(() => {
                void apply(preset.id, preset.name).catch(error => devices.report(error));
            }));
        }
        presetMenu.showAtMouseEvent(event);
    }
}

export type DeviceScopePage = ScopePage;
export type { DeviceScope };
