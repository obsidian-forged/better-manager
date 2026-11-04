import { setIcon } from 'obsidian';
import type Manager from '../main';
import { protectionText } from '../settings/protection-text';

/** Shared notification slot; configuration choices take priority over recovery folder advice. */
export class SyncNoticeView {
    private readonly notice: HTMLElement;
    constructor(private readonly manager: Manager, parent: HTMLElement, private readonly resolve: () => void) {
        this.notice = parent.createDiv({ cls: 'manager-sync-notice', attr: { role: 'status', 'aria-live': 'polite' } });
        this.notice.addEventListener('click', () => this.resolve());
        this.notice.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault(); event.stopPropagation(); this.resolve();
        });
        this.refresh();
    }
    refresh(): void {
        const conflict = Boolean(this.manager.configProtection?.protection.paused);
        const privateCache = Boolean(this.manager.configProtection?.privateCacheModified);
        const active = conflict || privateCache;
        this.notice.toggleClass('is-active', active);
        this.notice.empty();
        this.notice.setAttribute('role', active ? 'button' : 'status');
        if (!active) { this.notice.removeAttribute('tabindex'); this.notice.removeAttribute('aria-label'); return; }
        this.notice.setAttribute('tabindex', '0');
        const label = protectionText(this.manager, conflict ? 'resolve' : 'privateCacheShort');
        this.notice.setAttribute('aria-label', label);
        setIcon(this.notice.createSpan('manager-sync-notice__icon'), conflict ? 'triangle-alert' : 'cloud-alert');
        this.notice.createSpan({ cls: 'manager-sync-notice__text', text: label });
    }
    destroy(): void { this.notice.remove(); }
}
