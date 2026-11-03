import { Notice, setIcon } from 'obsidian';
import type Manager from '../main';
import { ConflictItem } from './conflict-choices';
import { protectionText } from './protection-text';
import type { ConfigConflictChoices } from './conflict-choices';

/** Reuse mounted controls for source previews; never dispatch their change handlers. */
export class ConfigConflictMarkers {
    constructor(private readonly manager: Manager, private readonly root: HTMLElement,
        private readonly previewPlugin: (row: HTMLElement, value: unknown) => void) {}
    apply(): void {
        const session = this.manager.configProtection, choices = session?.conflictChoices;
        const presetId = this.manager.devices?.selectedScope('plugins').presetId;
        this.applyList(choices, presetId);
        this.root.querySelectorAll<HTMLElement>('[data-plugin-id], [data-bpm-preset-id], [data-bpm-setting]').forEach(row => {
            const pluginId = row.getAttribute('data-plugin-id'), preset = row.getAttribute('data-bpm-preset-id');
            const field = row.getAttribute('data-bpm-setting');
            const target: ConflictItem | undefined = pluginId ? { kind: 'plugin', id: pluginId, presetId }
                : preset ? { kind: 'preset', id: preset } : field ? { kind: 'field', id: field } : undefined;
            const side = target ? choices?.itemSide(target) : undefined;
            row.toggleClass('bpm-has-item-conflict', side !== undefined);
            let button = row.querySelector<HTMLButtonElement>('.bpm-item-conflict');
            if (side === undefined || !target || !choices || !session) { button?.remove(); return; }
            const host = row.querySelector<HTMLElement>('.setting-item-control') ?? row;
            if (!button) {
                button = host.createEl('button', { cls: 'bpm-item-conflict', attr: { type: 'button' } });
                button.createSpan('bpm-item-conflict__icon');
                button.createSpan('bpm-item-conflict__label');
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
                button.querySelector('.bpm-item-conflict__label')?.setText(text);
                const icon = button.querySelector<HTMLElement>('.bpm-item-conflict__icon');
                if (icon) setIcon(icon, side === 'incoming' ? 'cloud-download' : 'monitor-smartphone');
                button.setAttribute('aria-label', `${text} · ${protectionText(this.manager, side === 'incoming' ? 'switchLocal' : 'switchRemote')}`);
                button.setAttribute('title', protectionText(this.manager, side === 'incoming' ? 'switchLocal' : 'switchRemote'));
                button.setAttribute('aria-pressed', `${side === 'incoming'}`);
            }
            if (target.kind === 'plugin') this.previewPlugin(row, choices.itemValue(target));
        });
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
        this.root.querySelectorAll('.bpm-has-item-conflict').forEach(item => item.removeClass('bpm-has-item-conflict'));
    }
}
