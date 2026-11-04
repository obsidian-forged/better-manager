import { ButtonComponent, Notice, setIcon } from 'obsidian';
import type Manager from '../main';
import { ConflictSection } from './conflict-model';
import { protectionText, ProtectionMessage } from './protection-text';

/** A separate region: updating a conflict never rebuilds the manager page or steals input focus. */
export class ConfigConflictView {
    private id = '';
    private generation = 0;
    private syncChoices: Array<() => void> = [];
    private confirm?: ButtonComponent;
    private minimized = false;
    constructor(private readonly manager: Manager, readonly host: HTMLElement) { host.addClass('bpm-config-conflict'); }
    private t(key: ProtectionMessage): string { return protectionText(this.manager, key); }
    async refresh(): Promise<void> {
        const protection = this.manager.configProtection;
        const conflict = protection?.protection.conflict;
        this.host.hidden = !conflict || this.minimized;
        if (!conflict || !protection) { this.id = ''; this.host.empty(); return; }
        // Repeated external events preserve the choices, scroll position and focus.
        if (this.id === conflict.id) {
            this.refreshPrivateWarning();
            this.syncChoices.forEach(sync => sync());
            this.confirm?.setDisabled(!protection.protection.paused);
            return;
        }
        const generation = ++this.generation;
        const choices = await protection.prepareConflictChoices();
        if (generation !== this.generation || !this.host.isConnected) return;
        if (!choices || choices.id !== conflict.id) { void this.refresh(); return; }
        const sections = choices.sections;
        this.id = conflict.id;
        this.minimized = false;
        this.host.hidden = false;
        this.syncChoices = [];
        this.host.empty();
        const heading = this.host.createDiv('bpm-config-conflict__heading');
        setIcon(heading.createSpan(), 'triangle-alert');
        heading.createSpan({ text: this.t('title') });
        heading.setAttribute('title', this.t('paused'));
        const minimize = new ButtonComponent(heading).setIcon('chevron-up').setTooltip(this.t('collapse'));
        minimize.onClick(() => { this.minimized = true; this.host.hidden = true; });
        this.refreshPrivateWarning();
        this.host.setAttribute('aria-label', this.t('title'));
        const content = this.host.createDiv('bpm-config-conflict__content');
        if (conflict.reason === 'stale-replayed') content.createEl('p', { text: this.t('stale'), cls: 'mod-warning' });
        const footer = this.host.createDiv('bpm-config-conflict__footer');
        const status = footer.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
        const confirm = new ButtonComponent(footer).setButtonText(this.t('apply')).setCta();
        this.confirm = confirm;
        confirm.setDisabled(!protection.protection.paused);
        for (const section of sections) this.renderSection(content, section);
        confirm.onClick(() => {
            confirm.setDisabled(true);
            void protection.confirmConflictChoices().then(() => {
                status.setText(this.t('pending'));
                this.host.addClass('is-resolved');
            }).catch(error => {
                confirm.setDisabled(false);
                this.report(error);
            });
        });
        content.scrollTop = 0;
    }
    private refreshPrivateWarning(): void {
        const heading = this.host.querySelector<HTMLElement>('.bpm-config-conflict__heading');
        if (!heading) return;
        const existing = heading.querySelector('.bpm-private-cache-warning');
        if (!this.manager.configProtection?.privateCacheModified) { existing?.remove(); return; }
        if (existing) return;
        const warning = new ButtonComponent(heading).setButtonText(this.t('privateCacheShort')).setIcon('folder')
            .setTooltip(this.t('privateCacheChanged')).onClick(() => this.manager.showPrivateCacheWarning());
        warning.buttonEl.addClass('bpm-config-conflict__choice', 'bpm-private-cache-warning', 'mod-warning');
    }
    private renderSection(content: HTMLElement, section: ConflictSection): void {
        const row = content.createDiv('bpm-config-conflict__section');
        const named = (value: unknown): value is { name: string } => value !== null && typeof value === 'object'
            && typeof Reflect.get(value, 'name') === 'string';
        const nameOf = (value: unknown): string => named(value) ? value.name : '';
        const title = section.kind === 'preset'
            ? `${this.t(section.type === 'computer' || section.type === 'tablet' ? section.type : 'phone')} · ${nameOf(section.local) || nameOf(section.incoming) || section.presetId || ''}`
            : section.kind === 'settings' ? this.t('others') : section.id.endsWith('icons.css') ? this.t('icons') : this.t('device');
        row.createDiv({ cls: 'bpm-config-conflict__section-title', text: title });
        const versions = row.createDiv('bpm-config-conflict__choices');
        for (const side of ['local', 'incoming'] as const) {
            const button = new ButtonComponent(versions).setButtonText(this.t(side)).onClick(() => {
                void this.manager.configProtection?.selectConflictSection(section.id, side).catch(error => this.report(error));
            });
            const icon = button.buttonEl.createSpan();
            setIcon(icon, side === 'local' ? 'monitor-smartphone' : 'cloud-download');
            button.buttonEl.prepend(icon);
            button.buttonEl.addClass('bpm-config-conflict__choice', `bpm-config-conflict__choice--${side}`);
            if (section[side] === undefined || section[side] === null) button.setTooltip(this.t('absent'));
            const sync = () => {
                const active = this.manager.configProtection?.conflictChoices?.sectionSide(section.id) === side;
                button.buttonEl.setAttribute('aria-pressed', `${active}`);
                button.buttonEl.toggleClass('is-selected', active);
            };
            this.syncChoices.push(sync);
            sync();
        }
    }
    focus(): void { this.minimized = false; this.host.hidden = false; this.host.setAttribute('tabindex', '-1'); this.host.focus({ preventScroll: true }); }
    destroy(): void { this.generation++; this.host.remove(); }
    private report(error: unknown): void {
        if (this.manager.settings.DEBUG) console.error('[BPM] Configuration conflict', error);
        new Notice(this.t('error'));
    }
}
