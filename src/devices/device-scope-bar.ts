import { Menu, Notice, setIcon } from 'obsidian';
import type Manager from '../main';
import { ScopeSelect } from '../ui/scope-select';
import { featureEnabled } from '../features';
import { DEVICE_TYPES, DeviceScope, ScopePage, scopeKey, DeviceType } from './device-presets';

/**
 * 三栏共用的预设选择器：按设备类型分组列出命名预设，复用管理器筛选栏的自定义下拉。
 * Shared preset selector grouped by device type, built from the manager's own dropdown.
 */
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

    private openQuickApplyPresetMenu(event: MouseEvent, page: ScopePage, type: DeviceType): void {
        const devices = this.manager.devices;
        const t = (key: string, vars?: Record<string, string | number>) => this.manager.translator.t(key, vars);
        const presetMenu = new Menu();
        for (const preset of devices.presetsFor(type)) {
            presetMenu.addItem(item => item.setTitle(preset.name).setIcon('settings-2').onClick(() => {
                const sourceMenu = new Menu();
                sourceMenu.addItem(source => source.setTitle(t('设备_快速应用_当前窗口')).setIcon('panels-top-left').onClick(() => {
                    void devices.quickApply(preset.id, page, 'window').then(() => new Notice(t('设备_快速应用完成', { target: preset.name })))
                        .catch(error => devices.report(error));
                }));
                sourceMenu.addItem(source => source.setTitle(t('设备_快速应用_当前作用域')).setIcon('copy').onClick(() => {
                    void devices.quickApply(preset.id, page, 'scope').then(() => new Notice(t('设备_快速应用完成', { target: preset.name })))
                        .catch(error => devices.report(error));
                }));
                sourceMenu.showAtMouseEvent(event);
            }));
        }
        presetMenu.showAtMouseEvent(event);
    }
}

export type DeviceScopePage = ScopePage;
export type { DeviceScope };
