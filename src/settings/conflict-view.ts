import { ButtonComponent, Modal, Notice } from 'obsidian';
import type Manager from '../main';
import { ConflictSection, ConflictSide } from './conflict-model';
import { protectionText, ProtectionMessage } from './protection-text';
import { errorMessage } from '../network/http-error';

/** One native dialog owns the conflict editor; background refreshes never open a window. */
export class ConfigConflictModal extends Modal {
    private view?: ConfigConflictView;

    constructor(private readonly manager: Manager, private readonly closed: () => void) {
        super(manager.app);
        this.modalEl.addClass('bpm-config-conflict-modal');
    }

    onOpen(): void {
        this.manager.beginSettingsEditing(this);
        this.titleEl.setText(protectionText(this.manager, 'title'));
        this.view = new ConfigConflictView(this.manager, this.contentEl, () => this.close());
        this.refresh();
    }

    refresh(): void {
        if (!this.manager.configProtection?.protection.conflict) { this.close(); return; }
        void this.view?.refresh().catch(error => {
            if (this.manager.settings.DEBUG) console.error('[BPM] Rendering configuration conflict failed', error);
            new Notice(protectionText(this.manager, 'error'));
        });
    }

    focusContent(): void { this.modalEl.focus({ preventScroll: true }); }

    onClose(): void {
        this.view?.destroy(); this.view = undefined;
        this.contentEl.empty();
        this.closed();
        this.manager.endSettingsEditing(this);
    }
}

/** Updating choices preserves the dialog's focus and scroll, and never rebuilds the manager page. */
class ConfigConflictView {
    private id = '';
    private generation = 0;
    private syncChoices: Array<() => void> = [];
    private confirm?: ButtonComponent;
    private busy = false;
    private controls: ButtonComponent[] = [];
    private status?: HTMLElement;
    constructor(private readonly manager: Manager, readonly host: HTMLElement, private readonly applied: () => void) {
        host.addClass('bpm-config-conflict');
    }
    private t(key: ProtectionMessage): string { return protectionText(this.manager, key); }
    async refresh(): Promise<void> {
        const protection = this.manager.configProtection;
        const conflict = protection?.protection.conflict;
        if (!conflict || !protection) { this.id = ''; this.host.empty(); return; }
        // Repeated external events preserve the choices, scroll position and focus.
        if (this.id === conflict.id) {
            this.refreshPrivateWarning();
            this.syncChoices.forEach(sync => sync());
            this.setBusy(this.busy);
            return;
        }
        const generation = ++this.generation;
        const choices = await protection.prepareConflictChoices();
        if (generation !== this.generation || !this.host.isConnected) return;
        if (!choices || choices.id !== conflict.id) { await this.refresh(); return; }
        const sections = choices.sections;
        this.id = conflict.id;
        this.syncChoices = [];
        this.controls = [];
        this.host.empty();
        const heading = this.host.createDiv('bpm-config-conflict__heading');
        heading.createSpan({ text: this.t('allSettings') });
        const allSources = heading.createDiv('bpm-config-conflict__choices');
        for (const side of ['local', 'incoming'] as const) this.renderSourceButton(allSources, side,
            () => this.manager.configProtection?.conflictChoices?.allSide(),
            () => { void this.apply(side); }, this.t(side === 'local' ? 'applyAllLocal' : 'applyAllRemote'));
        this.refreshPrivateWarning();
        this.host.setAttribute('aria-label', this.t('title'));
        const content = this.host.createDiv('bpm-config-conflict__content');
        if (conflict.reason === 'stale-replayed') content.createEl('p', { text: this.t('stale'), cls: 'mod-warning' });
        const footer = this.host.createDiv('bpm-config-conflict__footer');
        this.status = footer.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
        const confirm = this.labelledButton(footer, this.t('saveSettings'), 'save').setCta();
        this.confirm = confirm;
        for (const section of sections) this.renderSection(content, section);
        confirm.onClick(() => { void this.apply(); });
        this.setBusy(this.busy);
        content.scrollTop = 0;
    }

    private setBusy(busy: boolean): void {
        this.busy = busy;
        const disabled = busy || this.manager.isSavingSettings;
        this.controls.forEach(button => { button.setDisabled(disabled); });
        this.confirm?.setDisabled(disabled);
        this.host.setAttribute('aria-busy', `${busy}`);
    }

    private async apply(side?: ConflictSide): Promise<void> {
        const session = this.manager.configProtection;
        if (this.busy || this.manager.isSavingSettings || !session || !this.id) return;
        const id = this.id;
        this.setBusy(true);
        this.status?.setText(this.t('saving'));
        try {
            if (side) await session.confirmAllConflictChoices(side, id);
            else {
                if (session.protection.conflict?.id !== id) throw new Error('The incoming configuration changed; review the new version');
                await session.confirmConflictChoices(id);
            }
            if (await this.manager.savePendingSettings()) this.applied();
            else {
                await this.refresh();
                this.status?.setText(this.t('notApplied'));
            }
        } catch (error) {
            this.status?.setText(this.t('notApplied'));
            this.report(error);
        } finally { this.setBusy(false); }
    }
    private refreshPrivateWarning(): void {
        const heading = this.host.querySelector<HTMLElement>('.bpm-config-conflict__heading');
        if (!heading) return;
        const existing = heading.querySelector('.bpm-private-cache-warning');
        if (!this.manager.configProtection?.privateCacheModified) { existing?.remove(); return; }
        if (existing) return;
        const warning = this.labelledButton(heading, this.t('privateCacheShort'), 'folder')
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
        for (const side of ['local', 'incoming'] as const) this.renderSourceButton(versions, side,
            () => this.manager.configProtection?.conflictChoices?.sectionSide(section.id), () => {
                void this.manager.configProtection?.selectConflictSection(section.id, side).catch(error => this.report(error));
            }, section[side] === undefined || section[side] === null ? this.t('absent') : undefined);
    }

    private renderSourceButton(parent: HTMLElement, side: ConflictSide,
        selected: () => ConflictSide | 'mixed' | undefined, choose: () => void, tooltip?: string): void {
        const button = this.labelledButton(parent, this.t(side), side === 'local' ? 'monitor-smartphone' : 'cloud-download').onClick(choose);
        button.buttonEl.addClass('bpm-config-conflict__choice', `bpm-config-conflict__choice--${side}`);
        button.setTooltip(tooltip ?? this.t(side));
        const sync = () => {
            const active = selected() === side;
            button.buttonEl.setAttribute('aria-pressed', `${active}`);
            button.buttonEl.toggleClass('is-selected', active);
        };
        this.controls.push(button);
        this.syncChoices.push(sync);
        sync();
    }

    private labelledButton(parent: HTMLElement, label: string, icon: string): ButtonComponent {
        const button = new ButtonComponent(parent).setIcon(icon);
        button.buttonEl.createSpan({ text: label });
        return button;
    }

    destroy(): void { this.generation++; this.host.empty(); }
    private report(error: unknown): void {
        if (this.manager.settings.DEBUG) console.error('[BPM] Configuration conflict', error);
        new Notice(`${this.t('error')}: ${errorMessage(error)}`);
    }
}
