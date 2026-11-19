import { ButtonComponent, Modal, setIcon } from 'obsidian';
import type Manager from '../main';
import { Notice } from 'obsidian';
import type { ObsidianAppWithInternals } from '../obsidian-internals';
import { DetectedSync } from './sync-detector';
import { protectionText } from './protection-text';
import { setSyncAdvisoriesSuppressed } from './sync-exclusion-state';
import { errorMessage } from '../network/http-error';

export class SyncWarningModal extends Modal {
    constructor(private readonly manager: Manager, private readonly services: DetectedSync[],
        private readonly reason: 'services' | 'private-cache' = 'services') { super(manager.app); }
    onOpen(): void {
        const t = (key: Parameters<typeof protectionText>[1]) => protectionText(this.manager, key);
        const zh = /^zh/i.test(this.manager.settings.LANGUAGE);
        const text = (cn: string, en: string) => zh ? cn : en;
        this.contentEl.addClass('manager-sync-warning');
        this.modalEl.addClass('manager-sync-warning-modal');
        this.titleEl.setText(t(this.reason === 'private-cache' ? 'privateCacheTitle' : 'syncTitle'));
        const body = this.contentEl.createDiv('manager-sync-warning__body');
        body.createEl('p', { text: t(this.reason === 'private-cache' ? 'privateCacheChanged' : 'syncDesc') });
        const path = `${this.app.vault.configDir}/plugins/${this.manager.manifest.id}/.bpm/`;
        const details = body.createEl('details');
        const summary = details.createEl('summary');
        const icon = summary.createSpan({ attr: { 'aria-hidden': 'true' } });
        setIcon(icon, 'chevron-right');
        summary.createSpan({ text: text('排除路径与语法示例', 'Exclusion path and syntax examples') });
        details.createEl('p', { text: text('以下语法不可互换。先确认同步工具支持的格式；只排除私有恢复目录，不排除共享配置。', 'These syntaxes are not interchangeable. Confirm the format your sync tool accepts. Exclude only the private recovery directory, not shared configuration.') });
        let lastStatus = '';
        const footer = this.contentEl.createDiv('manager-sync-warning__footer');
        const status = footer.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
        const report = (message: string) => {
            status.setText(message === lastStatus ? `${message}\u00a0` : message);
            lastStatus = status.textContent ?? '';
        };
        const snippet = (label: string, syntax: string, value: string) => {
            const row = details.createDiv('manager-sync-warning__snippet');
            row.createEl('p', { text: `${label} · ${syntax}` });
            row.createEl('pre').createEl('code', { text: value, cls: `language-${syntax}` });
            new ButtonComponent(row).setIcon('copy').setButtonText(text(`复制 ${syntax === 'text' ? '路径' : syntax}`, `Copy ${syntax === 'text' ? 'path' : syntax}`)).onClick(() => {
                void (async () => {
                    try { await row.win.navigator.clipboard.writeText(value); report(text('已复制', 'Copied')); }
                    catch { report(text('复制失败，请手动选择代码复制。', 'Copy failed. Select and copy the code manually.')); }
                })();
            });
        };
        snippet(text('相对库根目录的字面路径', 'Literal vault-relative path'), 'text', path);
        snippet(text('仅供接受 glob 的字段参考', 'Example for glob fields only'), 'glob', `${path}**`);
        const escapedPath = Array.from(path, character => '. * + ? ^ $ { } ( ) | [ ] \\'.split(' ').includes(character) ? `\\${character}` : character).join('');
        snippet(text('仅供接受正则的字段参考', 'Example for regex fields only'), 'regex', `^${escapedPath}`);
        for (const service of this.services) {
            const row = body.createDiv('manager-sync-warning__provider');
            row.createEl('strong', { text: service.name });
            new ButtonComponent(row).setButtonText(text('打开设置与操作步骤', 'Open settings and steps')).onClick(() => {
                void (async () => {
                    this.close();
                    let opened = false;
                    try {
                        const setting = (this.app as ObsidianAppWithInternals).setting;
                        await setting.open(); await setting.openTabById(service.id);
                        const active: unknown = setting.activeTab;
                        opened = typeof active === 'object' && active !== null && 'id' in active && active.id === service.id;
                    } catch { opened = false; }
                    const guide = new Modal(this.app);
                    this.manager.register(() => guide.close());
                    guide.titleEl.setText(service.name);
                    guide.contentEl.createEl('p', { text: opened ? text('设置已打开。请核对当前页面。', 'Settings opened. Check the selected page.') : text('未能确认设置页面，请手动打开该同步服务的设置。', 'Could not confirm the settings page. Open this sync service’s settings manually.') });
                    guide.contentEl.createEl('p', { text: service.kind === 'core' ? text('Obsidian Sync 不保证支持任意插件子目录排除。请检查当前版本的选择性同步选项；不要把上面的规则粘贴到不支持的字段。', 'Obsidian Sync does not guarantee arbitrary plugin subdirectory exclusions. Review your version’s selective sync options; do not paste rules into unsupported fields.') : text('找到排除或忽略选项，核对字段接受字面路径、glob 还是正则，再选择对应示例。保存后检查该目录不再传输；若没有此选项，请查阅该插件文档。', 'Find exclusion or ignore options. Check whether the field accepts literal paths, globs or regex, then choose the matching example. Save and verify the directory is no longer transferred. If no option exists, consult the plugin documentation.') });
                    guide.contentEl.createEl('pre').createEl('code', { text: path });
                    const guideStatus = guide.contentEl.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
                    const guideActions = guide.contentEl.createDiv('modal-button-container');
                    new ButtonComponent(guideActions).setButtonText(text('已设置，不再提醒', 'Configured, don’t remind again')).onClick(() => {
                        try { setSyncAdvisoriesSuppressed(this.manager, true); this.manager.refreshConfigConflict(); guide.close(); }
                        catch { guideStatus.setText(text('无法保存本机偏好，请重试。', 'Could not save this device preference. Try again.')); }
                    });
                    new ButtonComponent(guideActions).setButtonText(t('understood')).onClick(() => guide.close());
                    guide.open();
                })().catch(error => {
                    if (this.manager.settings.DEBUG) console.error('[BPM] Opening sync settings failed', error);
                    new Notice(`${text('打开设置失败', 'Could not open settings')}: ${errorMessage(error)}`);
                });
            });
        }
        body.createEl('p', { text: text('“不再提醒”只对这台设备生效。以后可从 BPM 设置或命令面板重新打开本说明。', 'This preference applies only to this device. Reopen this guide from BPM settings or the command palette.') });
        const buttons = footer.createDiv('modal-button-container');
        new ButtonComponent(buttons).setButtonText(text('已设置，不再提醒', 'Configured, don’t remind again')).onClick(() => {
            try { setSyncAdvisoriesSuppressed(this.manager, true); this.manager.refreshConfigConflict(); this.close(); }
            catch { report(text('无法保存本机偏好，请重试。', 'Could not save this device preference. Try again.')); }
        });
        new ButtonComponent(buttons).setButtonText(t('understood')).setCta().onClick(() => this.close());
        this.contentEl.querySelectorAll('button').forEach(button => { button.type = 'button'; });
    }
    onClose(): void { this.contentEl.empty(); }
}
