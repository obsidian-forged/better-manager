import Manager from 'src/main';
import { ManagerSettingTab } from '.';
import { ManagerSettings } from './data';
import { App } from 'obsidian';

export default abstract class BaseSetting {
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
