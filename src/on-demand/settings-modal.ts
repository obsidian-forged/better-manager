import { App, ButtonComponent, DropdownComponent, Modal, Setting, ToggleComponent } from 'obsidian';
import { ondemandText } from './text';

export type Entry = { id: string; name: string; configured: boolean; authorized: boolean; running: boolean; commands: number };
export type EntryOptions = { ribbon: boolean; views: boolean; menus: boolean };
export interface OnDemandSettingsHost {
    app: App;
    language(): string;
    plugins(): Entry[];
    options(): EntryOptions;
    configure(id: string, onDemand: boolean): Promise<void>;
    setOptions(patch: Partial<EntryOptions>): Promise<void>;
    loadNow(id: string): Promise<void>;
    begin(editor: object): void;
    end(editor: object): void;
    failed(error: unknown): void;
}
type Row = { setting: Setting; select: DropdownComponent; load: ButtonComponent; busy: boolean };

export class OnDemandSettingsModal extends Modal {
    private readonly rows = new Map<string, Row>();
    private opened = false;
    private query = '';
    private empty?: HTMLElement;
    constructor(private readonly host: OnDemandSettingsHost) { super(host.app); }
    private text(key: Parameters<typeof ondemandText>[1], vars?: Record<string, string | number>): string {
        return ondemandText(this.host.language(), key, vars);
    }
    onOpen(): void {
        this.opened = true;
        this.host.begin(this);
        this.setTitle(this.text('title'));
        this.contentEl.empty();
        this.contentEl.createEl('p', { text: this.text('scope') });
        this.contentEl.createEl('p', { text: this.text('introduction') });
        for (const key of ['ribbon', 'views', 'menus'] as const) {
            new Setting(this.contentEl).setName(this.text(key)).setDesc(this.text(`${key}Description`))
                .addToggle(toggle => {
                    toggle.setValue(this.host.options()[key]);
                    toggle.toggleEl.setAttribute('aria-label', this.text(key));
                    toggle.onChange(value => {
                        this.runOption(toggle, key, value);
                    });
                });
        }
        new Setting(this.contentEl).setName(this.text('search')).addSearch(search => {
            search.setPlaceholder(this.text('search'));
            search.inputEl.setAttribute('aria-label', this.text('search'));
            search.onChange(value => { this.query = value.trim().toLocaleLowerCase(); this.filter(); });
        });
        for (const plugin of this.host.plugins()) {
            const setting = new Setting(this.contentEl).setName(plugin.name);
            let select!: DropdownComponent;
            let load!: ButtonComponent;
            setting.addDropdown(component => {
                select = component;
                select.addOption('normal', this.text('normal')).addOption('demand', this.text('demand'));
                select.selectEl.setAttribute('aria-label', this.text('mode', { name: plugin.name }));
                select.onChange(value => { this.runRow(plugin.id, () => this.host.configure(plugin.id, value === 'demand')); });
            }).addButton(component => {
                load = component;
                load.setButtonText(this.text('load'));
                load.buttonEl.setAttribute('aria-label', this.text('loadLabel', { name: plugin.name }));
                load.onClick(() => { this.runRow(plugin.id, () => this.host.loadNow(plugin.id)); });
            });
            this.rows.set(plugin.id, { setting, select, load, busy: false });
            this.refreshRow(plugin);
        }
        this.empty = this.contentEl.createEl('p', { text: this.text('empty') });
        this.filter();
    }
    private refreshRow(plugin: Entry): void {
        const row = this.rows.get(plugin.id);
        if (!row) return;
        const state = this.text(!plugin.authorized ? 'unauthorized'
            : !plugin.configured ? 'normalState' : plugin.running ? 'running' : 'sleeping');
        row.setting.setDesc(plugin.configured ? this.text('status', { state, count: plugin.commands }) : state);
        row.select.setValue(plugin.configured ? 'demand' : 'normal').setDisabled(row.busy);
        row.load.setDisabled(row.busy || !plugin.configured || !plugin.authorized || plugin.running);
    }
    private filter(): void {
        let visible = 0;
        for (const plugin of this.host.plugins()) {
            const matches = `${plugin.name} ${plugin.id}`.toLocaleLowerCase().includes(this.query);
            this.rows.get(plugin.id)?.setting.settingEl.toggle(matches);
            if (matches) visible++;
        }
        this.empty?.toggle(visible === 0);
    }
    private runRow(id: string, action: () => Promise<void>): void {
        const row = this.rows.get(id);
        if (!row || row.busy) return;
        row.busy = true;
        row.select.setDisabled(true);
        row.load.setDisabled(true);
        // 原位更新保留滚动与焦点；Update in place to preserve scrolling and focus.
        void this.perform(action).finally(() => {
            row.busy = false;
            if (this.opened) {
                const plugin = this.host.plugins().find(entry => entry.id === id);
                if (plugin) this.refreshRow(plugin);
            }
        });
    }
    private runOption(toggle: ToggleComponent, key: keyof EntryOptions, value: boolean): void {
        toggle.setDisabled(true);
        void this.perform(() => this.host.setOptions({ [key]: value })).finally(() => {
            if (this.opened) toggle.setValue(this.host.options()[key]).setDisabled(false);
        });
    }
    private async perform(action: () => Promise<void>): Promise<void> {
        try { await action(); }
        catch (error) { this.host.failed(error); }
    }
    onClose(): void {
        this.opened = false;
        this.host.end(this);
        this.rows.clear();
        this.contentEl.empty();
    }
}
