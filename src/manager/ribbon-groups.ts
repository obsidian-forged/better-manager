import { Menu, setIcon } from 'obsidian';
import type Manager from '../main';
import type { RibbonGroup } from '../data/types';
import type { LeftRibbonLike, RibbonNativeItem } from '../obsidian-internals';
import { normalizeRibbonGroups } from '../devices/device-presets';

/** 分组作为一个 RibbonItem 参与排序时的固定前缀。 */
export const RIBBON_GROUP_ITEM_PREFIX = 'bpm-group:';

/** Native Ribbon group lifecycle / 原生 Ribbon 分组图标的生命周期。 */
export class RibbonGroups {
    private buttons = new Map<string, HTMLElement>();
    constructor(private readonly manager: Manager) {}

    sync(ribbon: LeftRibbonLike): void {
        const groups = normalizeRibbonGroups(this.manager.settings.RIBBON_GROUPS);
        const active = new Set(groups.filter(group => group.members.length).map(group => group.id));
        for (const [id, button] of this.buttons) {
            if (active.has(id)) continue;
            const index = ribbon.items?.findIndex(item => item?.buttonEl === button) ?? -1;
            if (index >= 0) ribbon.items?.splice(index, 1);
            button.remove();
            this.buttons.delete(id);
        }
        for (const group of groups) {
            if (!active.has(group.id)) continue;
            // 直接使用用户设定的图标；setIcon 会按 Lucide 名称渲染。
            const icon = group.icon?.trim() || 'folder';
            const existing = this.buttons.get(group.id);
            if (existing) {
                setIcon(existing, icon);
                existing.setAttr('aria-label', group.name);
                continue;
            }
            const button = this.manager.addRibbonIcon(icon, group.name, event => this.open(group.id, event));
            this.buttons.set(group.id, button);
        }
    }

    groupIdForItem(item: RibbonNativeItem): string | undefined {
        for (const [id, button] of this.buttons) if (button === item.buttonEl) return id;
        return undefined;
    }

    isGroupItem(item: RibbonNativeItem): boolean {
        return [...this.buttons.values()].some(button => item.buttonEl === button);
    }

    groupOf(uniqueId: string): RibbonGroup | undefined {
        return this.manager.settings.RIBBON_GROUPS.find(group => group.members.includes(uniqueId));
    }

    private open(id: string, event: MouseEvent): void {
        const group = this.manager.settings.RIBBON_GROUPS.find(entry => entry.id === id);
        const ribbon = (this.manager.app.workspace as typeof this.manager.app.workspace & { leftRibbon?: LeftRibbonLike }).leftRibbon;
        if (!group || !ribbon?.items) return;
        const menu = new Menu();
        // 菜单头部：分组图标 + 分组名，使用原生 label 样式与分隔线。
        const view = event.targetNode?.ownerDocument?.defaultView ?? window;
        const header = view.createFragment();
        const title = header.createSpan({ cls: 'bpm-group-menu-title', text: group.name });
        menu.addItem(item => {
            item.setTitle(header).setIcon(group.icon || 'folder').setIsLabel(true);
            title.closest('.menu-item')?.addClass('bpm-group-menu-label');
        });
        menu.addSeparator();
        const members = group.members.slice().sort((a, b) =>
            (group.memberOrders?.[a] ?? Number.MAX_SAFE_INTEGER) - (group.memberOrders?.[b] ?? Number.MAX_SAFE_INTEGER));
        for (const member of members) {
            const setting = this.manager.settings.RIBBON_SETTINGS.find(item => item.bpmUniqueId === member);
            if (!setting?.visible) continue;
            const native = ribbon.items.find(item => item && !this.isGroupItem(item)
                && (Object.values(setting.ribbonIdMap ?? {}).includes(item.id ?? '')
                    || item.id === setting.bpmUniqueId));
            if (!native?.callback) continue;
            menu.addItem(item => item.setTitle(setting.name).setIcon(setting.icon || 'circle')
                .onClick(() => { native.callback?.(event); }));
        }
        menu.showAtMouseEvent(event);
    }
}
