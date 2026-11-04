import Manager from 'src/main';
import { ManagerSettingTab } from '.';
import { ManagerSettings } from './data';
import { App, Notice } from 'obsidian';
import { createActionHandler } from '../ui/action-handler';
import { errorMessage } from '../network/http-error';

export default abstract class BaseSetting {
    protected readonly action = createActionHandler(error => {
        if (this.manager.settings.DEBUG) console.error('[BPM] Settings action failed', error);
        new Notice(errorMessage(error));
    });
	protected settingTab: ManagerSettingTab;
	protected manager: Manager;
	protected settings: ManagerSettings;
	public containerEl: HTMLElement;
	protected app: App;

	constructor(obj: ManagerSettingTab, containerEl: HTMLElement = obj.contentEl) {
		this.settingTab = obj;
		this.manager = obj.manager;
		this.settings = obj.manager.settings;
		this.containerEl = containerEl;
		this.app = obj.app;
	}

	public abstract main(): void;
	public render(): void { this.main() }
	public display(): void { this.render() }
}
