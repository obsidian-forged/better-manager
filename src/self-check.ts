import { App, ButtonComponent, Modal, Notice, normalizePath, setIcon } from 'obsidian';
import Manager from 'main';
import { BPM_IGNORE_TAG } from './data/types';

type ManifestLike = {
    name?: string;
    description?: string;
};

const getCommunityPluginsPath = (manager: Manager): string =>
    normalizePath(`${manager.app.vault.configDir}/community-plugins.json`);

const uniq = (ids: string[]): string[] => {
    const seen = new Set<string>();
    return ids.filter((id) => {
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
};

const samePluginList = (a: string[], b: string[]): boolean =>
    a.length === b.length && a.every((id, index) => id === b[index]);

const getManifestMap = (manager: Manager): Record<string, ManifestLike | undefined> => {
    return ((manager.app as unknown as {
        plugins?: { manifests?: Record<string, ManifestLike | undefined> };
    }).plugins?.manifests || {});
};

const isBpmIgnoredPlugin = (manager: Manager, pluginId: string): boolean => {
    return Boolean(manager.settings.Plugins.find((plugin) => plugin.id === pluginId)?.tags.includes(BPM_IGNORE_TAG));
};

const getTakeoverCandidates = (manager: Manager, communityPlugins: string[]): string[] => {
    const bpmId = manager.manifest.id;
    return uniq(communityPlugins).filter((id) => id !== bpmId && !isBpmIgnoredPlugin(manager, id));
};

const getObsidianControlledPluginsAfterTakeover = (manager: Manager, communityPlugins: string[]): string[] => {
    const bpmId = manager.manifest.id;
    const ignoredPlugins = uniq(communityPlugins).filter((id) => id !== bpmId && isBpmIgnoredPlugin(manager, id));
    return uniq([bpmId, ...ignoredPlugins]);
};

async function readCommunityPlugins(manager: Manager): Promise<string[]> {
    try {
        const adapter = manager.app.vault.adapter;
        const path = getCommunityPluginsPath(manager);
        if (!(await adapter.exists(path))) return [];

        const parsed: unknown = JSON.parse(await adapter.read(path));
        return Array.isArray(parsed) ? uniq(parsed.filter((id) => typeof id === 'string')) : [];
    } catch (error) {
        if (manager.settings.DEBUG) console.error('[BPM] Failed to read community-plugins.json:', error);
        return [];
    }
}

async function writeCommunityPlugins(
    manager: Manager,
    plugins: string[],
    currentPlugins?: string[]
): Promise<boolean> {
    try {
        const nextPlugins = uniq(plugins);
        const current = currentPlugins ?? await readCommunityPlugins(manager);
        if (samePluginList(current, nextPlugins)) return true;

        const adapter = manager.app.vault.adapter;
        await adapter.write(getCommunityPluginsPath(manager), JSON.stringify(nextPlugins, null, 2));
        return true;
    } catch (error) {
        if (manager.settings.DEBUG) console.error('[BPM] Failed to write community-plugins.json:', error);
        return false;
    }
}

function syncTakeoverPluginRecords(manager: Manager, pluginIds: string[]): boolean {
    const manifests = getManifestMap(manager);
    let changed = false;

    for (const id of uniq(pluginIds).filter((pluginId) => !isBpmIgnoredPlugin(manager, pluginId))) {
        const existing = manager.settings.Plugins.find((plugin) => plugin.id === id);
        if (existing) {
            if (!existing.enabled) {
                existing.enabled = true;
                changed = true;
            }
            continue;
        }

        const manifest = manifests[id];
        if (!manifest) continue;

        manager.settings.Plugins.push({
            id,
            name: manifest.name || id,
            desc: manifest.description || '',
            group: '',
            tags: [],
            enabled: true,
            delay: 'default',
            note: '',
        });
        changed = true;
    }

    return changed;
}

async function execTakeover(
    manager: Manager,
    pluginIds: string[],
    communityPlugins?: string[]
): Promise<boolean> {
    if (!manager.settings.DELAY) return false;

    const currentPlugins = communityPlugins ?? await readCommunityPlugins(manager);
    const nextCommunityPlugins = getObsidianControlledPluginsAfterTakeover(manager, currentPlugins);
    const success = await writeCommunityPlugins(manager, nextCommunityPlugins, currentPlugins);
    if (!success) return false;

    if (syncTakeoverPluginRecords(manager, pluginIds)) {
        await manager.saveSettings();
    }

    return true;
}

export async function performSelfCheck(manager: Manager): Promise<void> {
    if (!manager.settings.DELAY) return;

    const communityPlugins = await readCommunityPlugins(manager);
    const takeoverCandidates = getTakeoverCandidates(manager, communityPlugins);
    if (takeoverCandidates.length === 0) return;

    if (manager.settings.AUTO_TAKEOVER) {
        const success = await execTakeover(manager, takeoverCandidates, communityPlugins);
        new Notice(manager.translator.t(success ? '自检_接管成功_通知' : '自检_接管失败_通知'));
        return;
    }

    if (manager.settings.SELF_CHECK_IGNORED) return;

    new TakeoverModal(manager.app, manager, takeoverCandidates, communityPlugins).open();
}

class TakeoverModal extends Modal {
    private manager: Manager;
    private takeoverCandidates: string[];
    private communityPlugins: string[];
    private t: (key: string) => string;

    constructor(app: App, manager: Manager, takeoverCandidates: string[], communityPlugins: string[]) {
        super(app);
        this.manager = manager;
        this.takeoverCandidates = takeoverCandidates;
        this.communityPlugins = communityPlugins;
        this.t = (key: string) => manager.translator.t(key);
    }

    onOpen() {
        const { contentEl, titleEl } = this;

        const modalEl = contentEl.parentElement;
        modalEl?.addClass('bpm-takeover-modal');
        modalEl?.querySelector('.modal-close-button')?.remove();
        titleEl.parentElement?.addClass('takeover-titlebar');

        titleEl.empty();
        titleEl.addClass('takeover-title');
        const titleMain = titleEl.createDiv('takeover-title__main');
        const titleIcon = titleMain.createSpan({ cls: 'takeover-title__icon' });
        setIcon(titleIcon, 'shield-alert');
        const titleText = titleMain.createDiv('takeover-title__copy');
        titleText.createDiv({ cls: 'takeover-title__eyebrow', text: 'BPM' });
        titleText.createDiv({ cls: 'takeover-title__text', text: this.t('自检_检测到插件_标题') });
        const titleMeta = titleEl.createDiv('takeover-title__meta');
        titleMeta.createSpan({ cls: 'takeover-title__count', text: `${this.takeoverCandidates.length}` });
        const closeButton = titleMeta.createEl('button', {
            cls: 'clickable-icon takeover-title__close',
            attr: { type: 'button', 'aria-label': this.t('自检_忽略_按钮') },
            title: this.t('自检_忽略_按钮'),
        });
        setIcon(closeButton, 'x');
        closeButton.addEventListener('click', () => {
            void this.ignoreWarning();
        });

        const page = contentEl.createDiv('takeover-page');

        const summary = page.createDiv('takeover-summary');
        const summaryIcon = summary.createSpan({ cls: 'takeover-summary__icon' });
        setIcon(summaryIcon, 'route');
        const summaryMain = summary.createDiv('takeover-summary__main');
        summaryMain.createDiv({
            text: this.t('自检_检测到插件_说明'),
            cls: 'takeover-desc',
        });
        const flow = summaryMain.createDiv('takeover-flow');
        this.renderFlowChip(flow, 'file-json-2', 'community-plugins.json');
        const flowArrow = flow.createSpan({ cls: 'takeover-flow__arrow' });
        setIcon(flowArrow, 'arrow-right');
        this.renderFlowChip(flow, 'shield-check', 'BPM');

        const listContainer = page.createDiv('takeover-plugin-list');
        const listHeader = listContainer.createDiv('takeover-plugin-list__header');
        const listTitle = listHeader.createDiv('takeover-plugin-list__title');
        const listIcon = listTitle.createSpan({ cls: 'takeover-plugin-list__icon' });
        setIcon(listIcon, 'blocks');
        listTitle.createEl('h4', { text: this.t('自检_检测到插件_列表') });
        listHeader.createSpan({ cls: 'takeover-plugin-list__count', text: `${this.takeoverCandidates.length}` });
        const pluginList = listContainer.createDiv({
            cls: 'takeover-plugin-list__items',
            attr: { role: 'list' },
        });

        for (const id of this.takeoverCandidates) {
            const name = this.getPluginName(id);
            const item = pluginList.createDiv({
                cls: 'takeover-plugin-item',
                attr: { role: 'listitem' },
            });
            const itemIcon = item.createSpan({ cls: 'takeover-plugin-item__icon' });
            setIcon(itemIcon, 'plug');
            const itemMain = item.createDiv('takeover-plugin-item__main');
            itemMain.createSpan({ cls: 'takeover-plugin-item__name', text: name });
            if (name !== id) {
                itemMain.createSpan({ cls: 'takeover-plugin-item__id', text: id });
            }
        }

        const warning = page.createDiv('takeover-warning');
        const warningIcon = warning.createSpan({ cls: 'takeover-warning__icon' });
        setIcon(warningIcon, 'triangle-alert');
        warning.createDiv({
            text: this.t('自检_警告_文本'),
            cls: 'takeover-warning__text',
        });

        const actionContainer = page.createDiv('takeover-actions');

        const takeoverBtn = new ButtonComponent(actionContainer);
        takeoverBtn.setButtonText(this.t('自检_接管_按钮'));
        takeoverBtn.setIcon('shield-check');
        takeoverBtn.setCta();
        takeoverBtn.buttonEl.addClass('takeover-actions__primary');
        takeoverBtn.buttonEl.setAttribute('aria-label', this.t('自检_接管_按钮'));

        const ignoreBtn = new ButtonComponent(actionContainer);
        ignoreBtn.setButtonText(this.t('自检_忽略_按钮'));
        ignoreBtn.setIcon('clock');
        ignoreBtn.buttonEl.addClass('takeover-actions__secondary');
        ignoreBtn.buttonEl.setAttribute('aria-label', this.t('自检_忽略_按钮'));

        const ignoreForeverBtn = new ButtonComponent(actionContainer);
        ignoreForeverBtn.setButtonText(this.t('自检_不再提示_按钮'));
        ignoreForeverBtn.setIcon('bell-off');
        ignoreForeverBtn.buttonEl.addClass('takeover-actions__secondary');
        ignoreForeverBtn.buttonEl.setAttribute('aria-label', this.t('自检_不再提示_按钮'));

        takeoverBtn.onClick(async () => {
            takeoverBtn.setDisabled(true);
            ignoreBtn.setDisabled(true);
            ignoreForeverBtn.setDisabled(true);
            const success = await this.takeoverPlugins();
            if (!success) {
                takeoverBtn.setDisabled(false);
                ignoreBtn.setDisabled(false);
                ignoreForeverBtn.setDisabled(false);
            }
        });

        ignoreBtn.onClick(async () => {
            await this.ignoreWarning();
        });

        ignoreForeverBtn.onClick(async () => {
            await this.ignoreForever();
        });
    }

    private renderFlowChip(container: HTMLElement, iconName: string, text: string) {
        const chip = container.createSpan({ cls: 'takeover-flow__chip' });
        const icon = chip.createSpan({ cls: 'takeover-flow__chip-icon' });
        setIcon(icon, iconName);
        chip.createSpan({ cls: 'takeover-flow__chip-text', text });
    }

    private getPluginName(id: string): string {
        return getManifestMap(this.manager)[id]?.name || id;
    }

    private async takeoverPlugins(): Promise<boolean> {
        const success = await execTakeover(this.manager, this.takeoverCandidates, this.communityPlugins);

        if (success) {
            new Notice(this.t('自检_接管成功_通知'));
            this.close();
            new Notice(this.t('自检_需要重启_通知'), 5000);
            return true;
        } else {
            new Notice(this.t('自检_接管失败_通知'));
            return false;
        }
    }

    private async ignoreWarning() {
        new Notice(this.t('自检_忽略警告_通知'), 5000);
        this.close();
    }

    private async ignoreForever() {
        this.manager.settings.SELF_CHECK_IGNORED = true;
        await this.manager.saveSettings();
        new Notice(this.t('自检_不再提示确认_通知'));
        this.close();
    }

    onClose() {
        this.contentEl.empty();
    }
}
