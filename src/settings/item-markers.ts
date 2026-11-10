import { Notice, setIcon } from 'obsidian';
import type Manager from '../main';
import { configItemChangeIndex, configItemChanged } from './conflict-choices';
import type { ConfigConflictChoices, ConflictItem } from './conflict-choices';
import type { ConflictSide } from './conflict-model';
import { protectionText } from './protection-text';

/** Marks manager items in both states: a pending local change, or a conflict with a source choice.
 * 管理器条目在“未保存”和“冲突”两种状态下都显示标记；冲突标记可切换本机/远端来源。 */
export class ConfigItemMarkers {
    constructor(private readonly manager: Manager, private readonly root: HTMLElement,
        private readonly previewPlugin: (row: HTMLElement, value: unknown) => void) {}

    apply(): void {
        const session = this.manager.configProtection, choices = session?.conflictChoices;
        const presetId = this.manager.devices?.selectedScope('plugins').presetId;
        this.applyList(choices, presetId);
        // 冲突标记优先；只有没有冲突时才把本机未保存差异标到条目上。
        // Conflict marks win; pending marks appear only when no conflict is being resolved.
        const pending = Boolean(session && !choices && session.protection.hasPendingChanges);
        const index = pending && session
            ? configItemChangeIndex(session.currentValue(), session.protection.current.value)
            : undefined;
        this.root.querySelectorAll<HTMLElement>('[data-plugin-id], [data-bpm-preset-id], [data-bpm-setting]').forEach(row => {
            const pluginId = row.getAttribute('data-plugin-id'), preset = row.getAttribute('data-bpm-preset-id');
            const field = row.getAttribute('data-bpm-setting');
            const target: ConflictItem | undefined = pluginId ? { kind: 'plugin', id: pluginId, presetId }
                : preset ? { kind: 'preset', id: preset } : field ? { kind: 'field', id: field } : undefined;
            const side = target ? choices?.itemSide(target) : undefined;
            const changed = Boolean(index && target && configItemChanged(index, target)) && side === undefined;
            row.toggleClass('bpm-has-item-conflict', side !== undefined);
            row.toggleClass('bpm-has-item-pending', changed);
            const host = row.querySelector<HTMLElement>('.setting-item-control') ?? row;
            this.applyConflict(row, host, target, side, choices, session);
            this.applyPending(host, changed);
        });
    }

    private applyConflict(row: HTMLElement, host: HTMLElement, target: ConflictItem | undefined,
        side: ConflictSide | 'mixed' | undefined, choices: ConfigConflictChoices | undefined,
        session: Manager['configProtection']): void {
        let button = row.querySelector<HTMLButtonElement>('.bpm-item-source');
        if (side === undefined || !target || !choices || !session) { button?.remove(); return; }
        if (!button) {
            button = host.createEl('button', { cls: 'bpm-item-conflict bpm-item-source', attr: { type: 'button' } });
            button.createSpan('bpm-item-conflict__icon');
            let start: { x: number; y: number } | undefined, moved = false;
            button.addEventListener('pointerdown', event => { start = { x: event.clientX, y: event.clientY }; moved = false; });
            button.addEventListener('pointermove', event => { if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) moved = true; });
            button.addEventListener('pointercancel', () => { moved = true; });
            button.addEventListener('click', event => {
                event.stopPropagation();
                if (moved) { moved = false; return; }
                void session.toggleConflictItem(target).catch(error => {
                    if (this.manager.settings.DEBUG) console.error('[BPM] Changing conflict source failed', error);
                    new Notice(protectionText(this.manager, 'error'));
                });
            });
            const toggle = host.querySelector('.checkbox-container');
            if (toggle?.parentElement === host) host.insertBefore(button, toggle);
        } else if (button.parentElement !== host) host.appendChild(button);
        if (button.dataset.source !== side) {
            button.dataset.source = side;
            const text = protectionText(this.manager, side === 'incoming' ? 'shortRemote' : side === 'mixed' ? 'mixed' : 'shortLocal');
            button.querySelector('.bpm-item-conflict__label')?.remove();
            const icon = button.querySelector<HTMLElement>('.bpm-item-conflict__icon');
            if (icon) setIcon(icon, side === 'incoming' ? 'cloud-download' : 'monitor-smartphone');
            button.setAttribute('aria-label', `${text} · ${protectionText(this.manager, side === 'incoming' ? 'switchLocal' : 'switchRemote')}`);
            // 圆形图标只留图标，完整标签放在浮动气泡里。The bubble carries the label for the icon-only mark.
            button.setAttribute('title', text);
            button.setAttribute('aria-pressed', `${side === 'incoming'}`);
        }
        if (target.kind === 'plugin') this.previewPlugin(row, choices.itemValue(target));
    }

    /** 未保存标记只表示“此条目与上次保存不同”，保存动作仍走顶栏/页内保存按钮。
     * The pending mark only says the item differs from the last save; saving still uses the Save controls. */
    private applyPending(host: HTMLElement, active: boolean): void {
        let marker = host.querySelector<HTMLElement>('.bpm-item-pending');
        if (!active) { marker?.remove(); return; }
        if (!marker) {
            marker = host.createSpan({ cls: 'bpm-item-conflict bpm-item-pending', attr: { role: 'note' } });
            marker.createSpan('bpm-item-conflict__icon');
            const toggle = host.querySelector('.checkbox-container');
            if (toggle?.parentElement === host) host.insertBefore(marker, toggle);
        } else if (marker.parentElement !== host) host.appendChild(marker);
        marker.querySelector('.bpm-item-conflict__label')?.remove();
        const icon = marker.querySelector<HTMLElement>('.bpm-item-conflict__icon');
        if (icon && icon.dataset.icon !== 'pencil-line') {
            setIcon(icon, 'pencil-line');
            icon.dataset.icon = 'pencil-line';
        }
        // 图标本身不写文字；悬浮气泡显示标签，读屏标签保留完整说明。
        // The icon stays unlabelled; the tooltip carries the label while the accessible name explains it.
        marker.setAttribute('title', protectionText(this.manager, 'unsavedItem'));
        marker.setAttribute('aria-label', protectionText(this.manager, 'unsavedItemTooltip'));
    }

    private applyList(choices: ConfigConflictChoices | undefined, presetId?: string): void {
        const bar = this.root.querySelector<HTMLElement>('.manager-overview-heading');
        if (!bar) return;
        const ids = Object.keys(this.manager.appPlugins.manifests);
        const side = choices?.listSide(ids, presetId);
        let button = bar.querySelector<HTMLButtonElement>(':scope > .bpm-list-source');
        if (side === undefined) { button?.remove(); return; }
        if (!button) {
            button = bar.createEl('button', { cls: 'bpm-item-conflict bpm-list-source', attr: { type: 'button' } });
            button.createSpan('bpm-item-conflict__icon');
            button.createSpan('bpm-item-conflict__label');
            let start: { x: number; y: number } | undefined, moved = false;
            button.addEventListener('pointerdown', event => { start = { x: event.clientX, y: event.clientY }; moved = false; });
            button.addEventListener('pointermove', event => { if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) moved = true; });
            button.addEventListener('pointercancel', () => { moved = true; });
            button.addEventListener('click', event => {
                event.stopPropagation();
                if (moved) { moved = false; return; }
                void this.manager.configProtection?.toggleConflictList(Object.keys(this.manager.appPlugins.manifests),
                    this.manager.devices.selectedScope('plugins').presetId).catch(error => {
                    if (this.manager.settings.DEBUG) console.error('[BPM] Changing list source failed', error);
                    new Notice(protectionText(this.manager, 'error'));
                });
            });
        }
        if (button.dataset.source === side) return;
        button.dataset.source = side;
        const label = protectionText(this.manager, side === 'incoming' ? 'shortRemote' : side === 'mixed' ? 'mixed' : 'shortLocal');
        button.querySelector('.bpm-item-conflict__label')?.setText(label);
        const icon = button.querySelector<HTMLElement>('.bpm-item-conflict__icon');
        if (icon) setIcon(icon, side === 'incoming' ? 'cloud-download' : 'monitor-smartphone');
        button.setAttribute('aria-label', `${protectionText(this.manager, 'listSource')} · ${label}`);
        button.setAttribute('title', protectionText(this.manager, side === 'incoming' ? 'switchListLocal' : 'switchListRemote'));
    }

    destroy(): void {
        this.root.querySelectorAll('.bpm-item-conflict').forEach(item => item.remove());
        this.root.querySelectorAll('.bpm-has-item-conflict, .bpm-has-item-pending').forEach(item => {
            item.removeClass('bpm-has-item-conflict');
            item.removeClass('bpm-has-item-pending');
        });
    }
}
