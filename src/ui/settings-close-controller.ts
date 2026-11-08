interface SettingsCloseHost {
    settings: { MANUAL_CONFIG_SAVE: boolean };
    readonly hasUnsavedSettings: boolean;
    readonly isSavingSettings: boolean;
    savePendingSettings(): Promise<boolean>;
    discardPendingSettings(): Promise<void>;
}

interface SettingsCloseActions {
    isOpen(): boolean;
    prepareDraft(): Promise<void>;
    confirmSave(): Promise<boolean>;
    saving(): void;
    close(allowAutomaticSave: boolean): void;
}

/** 关闭确认复用保存入口，明确“不保存”才丢弃草稿；Closing never silently publishes a manual draft. */
export class SettingsCloseController {
    private pending = false;
    constructor(private readonly host: SettingsCloseHost, private readonly actions: SettingsCloseActions) {}

    async request(): Promise<void> {
        if (this.pending || !this.actions.isOpen()) return;
        this.pending = true;
        try {
            const manual = this.host.settings.MANUAL_CONFIG_SAVE !== false;
            if (manual && this.host.isSavingSettings) { this.actions.saving(); return; }
            await this.actions.prepareDraft();
            if (!this.actions.isOpen()) return;
            const hadUnsaved = manual && this.host.hasUnsavedSettings;
            let save = false;
            if (hadUnsaved) {
                save = await this.actions.confirmSave();
                if (!this.actions.isOpen()) return;
                if (save && (!await this.host.savePendingSettings() || this.host.hasUnsavedSettings)) return;
            }
            if (manual && hadUnsaved && !save) {
                await this.host.discardPendingSettings();
                if (this.host.hasUnsavedSettings) return;
            }
            if (this.actions.isOpen()) this.actions.close(!manual);
        } finally { this.pending = false; }
    }
}
