import { featureEnabled } from './features';
import {
    App,
    Command,
    Notice,
    PluginManifest,
    SuggestModal,
    normalizePath,
    setIcon,
} from "obsidian";
import Manager from "./main";
import { describeHeapDelta, readHeapMB, RECLAIM_NOTICE_THRESHOLD_MB, RECLAIM_SETTLE_MS } from "./memory-reclaim";
// 类型引用编译期擦除；真正 new ManagerModal 时走下方动态 import，
// 让主面板代码推迟到用户真正打开时才求值（V8 懒解析函数体）
import type { ManagerModal } from "./modal/manager-modal";
// Conflict diagnostics are initialized only when explicitly opened.
import { BPM_IGNORE_TAG, ManagerPlugin } from "./data/types";
import { managerOpen } from "./utils";
import { ObsidianAppWithInternals, VaultAdapterWithBasePath } from "./obsidian-internals";
import { PluginCommandProfile, PluginCommandState } from "./settings/data";

type CommandManagerLike = {
    commands?: Record<string, Command>;
    removeCommand?: (id: string) => void;
};

type PluginActionId =
    | "toggle"
    | "enable"
    | "disable"
    | "single-start"
    | "restart"
    | "open-settings"
    | "open-dir"
    | "open-repo"
    | "copy-id";

type PluginAction = {
    id: PluginActionId;
    label: string;
    icon: string;
    disabled?: boolean;
};

const commandServices = new WeakMap<Manager, ManagerCommandService>();

class ManagerCommandService {
    private readonly app: App;
    private readonly manager: Manager;
    private staticCommandIds = new Set<string>();
    private staticLanguage = ""; 
    private dynamicCommandIds = new Set<string>();
    private running = new Set<string>();

    constructor(app: App, manager: Manager) {
        this.app = app;
        this.manager = manager;
    }

    refresh() {
        this.refreshStaticCommands();
        this.refreshDynamicCommands();
    }

    openPluginControl() {
        new PluginControlModal(this.app, this).open();
    }

    openProfileNameModal() {
        new ProfileNameModal(this.app, this).open();
    }

    getTranslator() {
        return this.manager.translator;
    }

    getPluginManifests(): PluginManifest[] {
        return Object.values(this.manager.appPlugins.manifests || {})
            .filter((plugin) => plugin.id !== this.manager.manifest.id)
            .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    }

    getManagerPlugin(pluginId: string): ManagerPlugin | undefined {
        return this.manager.settings.Plugins.find((plugin) => plugin.id === pluginId);
    }

    isPluginEnabled(pluginId: string): boolean {
        const managerPlugin = this.getManagerPlugin(pluginId);
        if (this.manager.settings.DELAY && managerPlugin && !managerPlugin.tags.includes(BPM_IGNORE_TAG)) {
            return managerPlugin.enabled;
        }
        return this.manager.appPlugins.enabledPlugins.has(pluginId);
    }

    isActionablePlugin(pluginId: string): boolean {
        if (pluginId === this.manager.manifest.id) return false;
        if (!this.manager.appPlugins.manifests[pluginId]) return false;
        const managerPlugin = this.getManagerPlugin(pluginId);
        return !managerPlugin?.tags?.includes(BPM_IGNORE_TAG);
    }

    getPluginActions(pluginId: string): PluginAction[] {
        const enabled = this.isPluginEnabled(pluginId);
        const isActionable = this.isActionablePlugin(pluginId);
        return [
            {
                id: "toggle",
                label: enabled
                    ? this.t("command_action_disable")
                    : this.t("command_action_enable"),
                icon: enabled ? "power-off" : "power",
                disabled: !isActionable,
            },
            { id: "enable", label: this.t("command_action_enable"), icon: "power", disabled: !isActionable || enabled },
            { id: "disable", label: this.t("command_action_disable"), icon: "power-off", disabled: !isActionable || !enabled },
            {
                id: "single-start",
                label: this.t("command_action_single_start"),
                icon: "repeat-1",
                disabled: this.manager.settings.DELAY || !isActionable || enabled,
            },
            {
                id: "restart",
                label: this.t("command_action_restart"),
                icon: "refresh-ccw",
                disabled: this.manager.settings.DELAY || !isActionable || !enabled,
            },
            { id: "open-settings", label: this.t("command_action_open_settings"), icon: "settings", disabled: !enabled },
            { id: "open-dir", label: this.t("command_action_open_dir"), icon: "folder-open" },
            { id: "open-repo", label: this.t("command_action_open_repo"), icon: "github" },
            { id: "copy-id", label: this.t("command_action_copy_id"), icon: "copy" },
        ];
    }

    async runPluginAction(pluginId: string, actionId: PluginActionId) {
        const manifest = this.manager.appPlugins.manifests[pluginId];
        if (!manifest) {
            new Notice(this.t("command_notice_missing_plugin", { id: pluginId }));
            return;
        }

        switch (actionId) {
            case "toggle":
                await this.togglePlugin(pluginId);
                break;
            case "enable":
                await this.setPluginEnabled(pluginId, true);
                break;
            case "disable":
                await this.setPluginEnabled(pluginId, false);
                break;
            case "single-start":
                await this.singleStartPlugin(pluginId);
                break;
            case "restart":
                await this.restartPlugin(pluginId);
                break;
            case "open-settings":
                await this.openPluginSettings(pluginId);
                break;
            case "open-dir":
                this.openPluginDir(manifest);
                break;
            case "open-repo":
                await this.openPluginRepo(pluginId);
                break;
            case "copy-id":
                this.copyPluginId(pluginId);
                break;
        }
    }

    async togglePlugin(pluginId: string) {
        await this.setPluginEnabled(pluginId, !this.isPluginEnabled(pluginId));
    }

    async setPluginEnabled(pluginId: string, targetEnabled: boolean) {
        if (!this.isActionablePlugin(pluginId)) {
            new Notice(this.t("command_notice_not_actionable"));
            return;
        }
        await this.runLocked(`plugin:${pluginId}`, async () => {
            this.capturePreviousState(this.t("command_snapshot_plugin", { name: this.getPluginName(pluginId) }));
            const changed = await this.setPluginEnabledInternal(pluginId, targetEnabled);
            await this.manager.saveSettings();
            if (changed) {
                this.refreshAfterStatusChange([pluginId]);
                new Notice(targetEnabled
                    ? this.t("command_notice_plugin_enabled", { name: this.getPluginName(pluginId) })
                    : this.t("command_notice_plugin_disabled", { name: this.getPluginName(pluginId) }));
            }
        });
    }

    async applyGroup(groupId: string, targetEnabled: boolean) {
        const group = this.manager.settings.GROUPS.find((item) => item.id === groupId);
        const label = group?.name || groupId;
        const plugins = this.getActionableManagerPlugins((plugin) => plugin.group === groupId);
        await this.applyPluginsEnabled(plugins, targetEnabled, this.t("command_snapshot_group", { name: label }));
    }

    async applyTag(tagId: string, targetEnabled: boolean) {
        const tag = this.manager.settings.TAGS.find((item) => item.id === tagId);
        const label = tag?.name || tagId;
        const plugins = this.getActionableManagerPlugins((plugin) => plugin.tags.includes(tagId));
        await this.applyPluginsEnabled(plugins, targetEnabled, this.t("command_snapshot_tag", { name: label }));
    }

    async saveCurrentProfile(name: string) {
        const profileName = name.trim();
        if (!profileName) {
            new Notice(this.t("command_notice_profile_name_required"));
            return;
        }

        const now = Date.now();
        const existing = this.manager.settings.COMMAND_PROFILES.find((profile) => profile.name === profileName);
        const profile: PluginCommandProfile = existing || {
            id: `${this.slugify(profileName)}-${now}`,
            name: profileName,
            pluginStates: {},
            createdAt: now,
        };
        profile.name = profileName;
        profile.pluginStates = this.captureCurrentState();
        profile.updatedAt = now;

        if (!existing) this.manager.settings.COMMAND_PROFILES.push(profile);
        await this.manager.saveSettings();
        this.refresh();
        new Notice(this.t("command_notice_profile_saved", { name: profile.name }));
    }

    async applyProfile(profileId: string) {
        const profile = this.manager.settings.COMMAND_PROFILES.find((item) => item.id === profileId);
        if (!profile) {
            new Notice(this.t("command_notice_profile_missing"));
            return;
        }
        await this.applyPluginStateMap(profile.pluginStates, this.t("command_snapshot_profile", { name: profile.name }));
    }

    async restorePreviousState() {
        const snapshot = this.manager.settings.COMMAND_LAST_STATE;
        if (!snapshot) {
            new Notice(this.t("command_notice_no_snapshot"));
            return;
        }
        await this.applyPluginStateMap(snapshot.pluginStates, this.t("command_snapshot_restore"), true);
    }

    private refreshStaticCommands() {
        const language = (this.manager.settings.LANGUAGE || "") + JSON.stringify(this.manager.settings.FEATURES);
        if (this.staticCommandIds.size > 0 && this.staticLanguage === language) return;
        this.removeStaticCommands();
        this.staticLanguage = language;
        this.registerStaticCommands();
    }

    private registerStaticCommands() {
        this.addStaticCommand({
            id: "manager-view",
            name: this.manager.translator.t("命令_管理面板_描述"),
            callback: async () => {
                await this.manager.openManagerModal();
            },
        });

        this.addStaticCommand({
            id: "control-plugin",
            name: this.t("command_control_plugin"),
            callback: () => this.openPluginControl(),
        });

        this.addStaticCommand({
            id: "save-command-profile",
            name: this.t("command_save_profile"),
            callback: () => this.openProfileNameModal(),
        });

        this.addStaticCommand({
            id: "restore-previous-command-state",
            name: this.t("command_restore_previous_state"),
            checkCallback: (checking) => {
                const canRestore = Boolean(this.manager.settings.COMMAND_LAST_STATE);
                if (checking) return canRestore;
                if (canRestore) void this.restorePreviousState();
                return canRestore;
            },
        });

        this.addStaticCommand({
            id: "troubleshoot-conflicts",
            name: this.manager.translator.t("排查_按钮_描述"),
            callback: async () => {
                const { TroubleshootModal } = await import("./troubleshoot/troubleshoot-modal.js");
                new TroubleshootModal(this.app, this.manager).open();
            },
        });

        // 手动兜底：把 RIBBON_SETTINGS 重新推入 Obsidian 原生侧边栏状态
        this.addStaticCommand({
            id: "apply-ribbon-settings",
            name: this.t("command_apply_ribbon_settings"),
            checkCallback: (checking) => {
                const ready = this.manager.isRibbonManagerEnabled();
                if (checking) return ready;
                if (ready) this.manager.applyRibbonSettings({ notify: true });
                return ready;
            },
        });
    }

    private refreshDynamicCommands() {
        this.removeDynamicCommands();
        if (!featureEnabled(this.manager.settings, 'plugins')) return;
        this.registerSelectedPluginToggleCommands();
        if (this.manager.settings.COMMAND_ITEM) this.registerPluginCommands();
        if (this.manager.settings.COMMAND_GROUP) this.registerGroupCommands();
        if (this.manager.settings.COMMAND_TAG) this.registerTagCommands();
        if (this.manager.settings.COMMAND_PROFILE) this.registerProfileCommands();
    }

    private selectedTogglePluginIds(): Set<string> {
        const ids = Array.isArray(this.manager.settings.COMMAND_TOGGLE_PLUGINS)
            ? this.manager.settings.COMMAND_TOGGLE_PLUGINS : [];
        return new Set(ids.filter((id): id is string => typeof id === 'string' && Boolean(id)));
    }

    private registerSelectedPluginToggleCommands() {
        const selected = this.selectedTogglePluginIds();
        if (!selected.size) return;
        this.getPluginManifests().forEach((plugin) => {
            if (!selected.has(plugin.id) || !this.isActionablePlugin(plugin.id)) return;
            const name = plugin.name || plugin.id;
            this.addDynamicCommand({
                id: `toggle-${plugin.id}`,
                name: this.isPluginEnabled(plugin.id)
                    ? this.t('命令_插件开关_关闭', { name })
                    : this.t('命令_插件开关_开启', { name }),
                callback: () => { void this.togglePlugin(plugin.id); },
            });
        });
    }

    private registerPluginCommands() {
        const selected = this.selectedTogglePluginIds();
        this.getPluginManifests()
            .filter((plugin) => !selected.has(plugin.id))
            .filter((plugin) => this.isActionablePlugin(plugin.id))
            .forEach((plugin) => {
                const enabled = this.isPluginEnabled(plugin.id);
                this.addDynamicCommand({
                    id: `manager-${plugin.id}`,
                    name: `${enabled ? this.manager.translator.t("命令行_禁用_文本") : this.manager.translator.t("命令行_启用_文本")} ${plugin.name || plugin.id}`,
                    callback: () => { void this.togglePlugin(plugin.id); },
                });
            });
    }

    private registerGroupCommands() {
        this.manager.settings.GROUPS.forEach((group) => {
            const name = group.name || group.id;
            this.addDynamicCommand({
                id: `manager-${group.id}-enabled`,
                name: `${this.manager.translator.t("命令行_一键启用_文本")} ${name} ${this.manager.translator.t("命令行_分组_文本")}`,
                callback: () => { void this.applyGroup(group.id, true); },
            });
            this.addDynamicCommand({
                id: `manager-${group.id}-disable`,
                name: `${this.manager.translator.t("命令行_一键禁用_文本")} ${name} ${this.manager.translator.t("命令行_分组_文本")}`,
                callback: () => { void this.applyGroup(group.id, false); },
            });
        });
    }

    private registerTagCommands() {
        this.manager.settings.TAGS
            .filter((tag) => tag.id !== BPM_IGNORE_TAG)
            .forEach((tag) => {
                const name = tag.name || tag.id;
                const commandId = this.safeCommandPart(tag.id);
                this.addDynamicCommand({
                    id: `manager-tag-${commandId}-enabled`,
                    name: `${this.t("command_enable_tag")} ${name}`,
                    callback: () => { void this.applyTag(tag.id, true); },
                });
                this.addDynamicCommand({
                    id: `manager-tag-${commandId}-disable`,
                    name: `${this.t("command_disable_tag")} ${name}`,
                    callback: () => { void this.applyTag(tag.id, false); },
                });
            });
    }

    private registerProfileCommands() {
        this.manager.settings.COMMAND_PROFILES.forEach((profile) => {
            this.addDynamicCommand({
                id: `manager-profile-${this.safeCommandPart(profile.id)}-apply`,
                name: `${this.t("command_apply_profile")} ${profile.name}`,
                callback: () => { void this.applyProfile(profile.id); },
            });
        });
    }

    private addDynamicCommand(command: Command) {
        const registered = this.manager.addCommand(command);
        this.dynamicCommandIds.add(registered.id);
        this.dynamicCommandIds.add(this.fullCommandId(command.id));
    }

    private addStaticCommand(command: Command) {
        if (command.id === 'troubleshoot-conflicts' && !featureEnabled(this.manager.settings, 'troubleshoot')) return;
        if (['control-plugin', 'save-command-profile', 'restore-previous-command-state'].includes(command.id)
            && !featureEnabled(this.manager.settings, 'plugins')) return;
        const registered = this.manager.addCommand(command);
        this.staticCommandIds.add(registered.id);
        this.staticCommandIds.add(this.fullCommandId(command.id));
    }

    private removeStaticCommands() {
        this.removeCommands(this.staticCommandIds);
    }

    private removeDynamicCommands() {
        this.removeCommands(this.dynamicCommandIds);
    }

    private removeCommands(commandIds: Set<string>) {
        const commandManager = (this.app as unknown as { commands?: CommandManagerLike }).commands;
        commandIds.forEach((id) => {
            try {
                commandManager?.removeCommand?.(id);
            } catch {
                // ignore unsupported internal command manager variants
            }
            if (commandManager?.commands) delete commandManager.commands[id];
        });
        commandIds.clear();
    }

    private async applyPluginsEnabled(plugins: ManagerPlugin[], targetEnabled: boolean, label: string) {
        if (plugins.length === 0) {
            new Notice(this.t("command_notice_no_actionable_plugins"));
            return;
        }
        const states: PluginCommandState = {};
        plugins.forEach((plugin) => { states[plugin.id] = targetEnabled; });
        await this.applyPluginStateMap(states, label);
    }

    private async applyPluginStateMap(states: PluginCommandState, label: string, restoring = false) {
        const entries = Object.entries(states).filter(([pluginId]) => this.isActionablePlugin(pluginId));
        if (entries.length === 0) {
            new Notice(this.t("command_notice_no_actionable_plugins"));
            return;
        }

        await this.runLocked(`bulk:${label}`, async () => {
            this.capturePreviousState(restoring ? this.t("command_snapshot_before_restore") : label);
            const progress = new Notice(`${this.t("command_notice_applying")} 0/${entries.length}`, 0);
            let changedCount = 0;
            let processed = 0;
            const changedIds: string[] = [];
            try {
                for (const [pluginId, targetEnabled] of entries) {
                    const changed = await this.setPluginEnabledInternal(pluginId, targetEnabled);
                    if (changed) {
                        changedCount++;
                        changedIds.push(pluginId);
                    }
                    processed++;
                    progress.setMessage(`${this.t("command_notice_applying")} ${processed}/${entries.length} · ${pluginId}`);
                }
            } finally {
                progress.hide();
            }
            await this.manager.saveSettings();
            this.refreshAfterStatusChange(changedIds);
            new Notice(this.t("command_notice_bulk_done", { count: changedCount }));
        });
    }

    private async setPluginEnabledInternal(pluginId: string, targetEnabled: boolean): Promise<boolean> {
        const current = this.isPluginEnabled(pluginId);
        const managerPlugin = this.getManagerPlugin(pluginId);
        if (current === targetEnabled) {
            if (managerPlugin) managerPlugin.enabled = targetEnabled;
            return false;
        }

        if (this.manager.settings.DELAY && managerPlugin && !managerPlugin.tags.includes(BPM_IGNORE_TAG)) {
            managerPlugin.enabled = targetEnabled;
            if (targetEnabled) await this.manager.appPlugins.enablePlugin(pluginId);
            else await this.manager.appPlugins.disablePlugin(pluginId);
        } else {
            if (targetEnabled) await this.manager.appPlugins.enablePluginAndSave(pluginId);
            else await this.manager.appPlugins.disablePluginAndSave(pluginId);
            if (managerPlugin) managerPlugin.enabled = targetEnabled;
        }
        return true;
    }

    private async singleStartPlugin(pluginId: string) {
        if (this.manager.settings.DELAY || !this.isActionablePlugin(pluginId) || this.isPluginEnabled(pluginId)) return;
        await this.runLocked(`single:${pluginId}`, async () => {
            this.capturePreviousState(this.t("command_snapshot_single_start", { name: this.getPluginName(pluginId) }));
            new Notice(this.manager.translator.t("管理器_单次启动中_提示"));
            await this.manager.appPlugins.enablePlugin(pluginId);
            this.refreshAfterStatusChange([pluginId]);
        });
    }

    private async restartPlugin(pluginId: string) {
        if (this.manager.settings.DELAY || !this.isActionablePlugin(pluginId) || !this.isPluginEnabled(pluginId)) return;
        await this.runLocked(`restart:${pluginId}`, async () => {
            this.capturePreviousState(this.t("command_snapshot_restart", { name: this.getPluginName(pluginId) }));
            new Notice(this.manager.translator.t("管理器_重启中_提示"));
            const heapBefore = readHeapMB();
            await this.manager.appPlugins.disablePluginAndSave(pluginId);
            await this.manager.appPlugins.enablePluginAndSave(pluginId);
            this.refreshAfterStatusChange([pluginId]);
            void this.reportRestartCost(pluginId, heapBefore);
        });
    }

    /**
     * Reports what a restart cost, once the plugin has had a moment to settle — see the same method
     * on the manager modal, and `memory-reclaim.ts` for why nothing can hand the memory back.
     */
    private async reportRestartCost(pluginId: string, heapBefore: number | null): Promise<void> {
        await new Promise((resolve) => window.setTimeout(resolve, RECLAIM_SETTLE_MS));
        const delta = describeHeapDelta(heapBefore, readHeapMB());
        if (!delta) return;
        if (Math.abs(delta.deltaMB) >= RECLAIM_NOTICE_THRESHOLD_MB) {
            new Notice(`${pluginId}: ${delta.label}`, 5000);
        }
    }

    private async openPluginSettings(pluginId: string) {
        if (!this.isPluginEnabled(pluginId)) {
            new Notice(this.t("command_notice_enable_before_settings"));
            return;
        }
        const appSetting = (this.app as ObsidianAppWithInternals).setting;
        await appSetting.open();
        await appSetting.openTabById(pluginId);
    }

    private openPluginDir(plugin: PluginManifest) {
        const getBasePath = (this.app.vault.adapter as VaultAdapterWithBasePath).getBasePath?.();
        const basePath = getBasePath ? normalizePath(getBasePath) : "";
        const cfgDir = this.app.vault.configDir;
        const rawDir = plugin.dir || `plugins/${plugin.id}`;
        const isAbsolute = new RegExp("^(?:[a-zA-Z]:[\\\\/]|[\\\\/])").test(rawDir);
        let pluginDir: string;
        if (isAbsolute) {
            pluginDir = normalizePath(rawDir);
        } else if (rawDir.startsWith(cfgDir) || rawDir.startsWith(".") || rawDir.startsWith("/")) {
            pluginDir = normalizePath(`${basePath}/${rawDir}`);
        } else {
            pluginDir = normalizePath(`${basePath}/${cfgDir}/${rawDir}`);
        }
        managerOpen(pluginDir, this.manager);
    }

    private async openPluginRepo(pluginId: string) {
        const repo = this.manager.settings.REPO_MAP?.[pluginId] || await this.manager.repoResolver.resolveRepo(pluginId);
        if (repo) {
            window.open(`https://github.com/${repo}`);
            return;
        }
        const isBpmInstall = this.manager.settings.BPM_INSTALLED.includes(pluginId);
        new Notice(isBpmInstall
            ? this.manager.translator.t("管理器_仓库未记录_提示")
            : this.manager.translator.t("管理器_仓库需手动添加_提示"));
    }

    private copyPluginId(pluginId: string) {
        void navigator.clipboard.writeText(pluginId);
        new Notice(this.manager.translator.t("通知_ID已复制"));
    }

    private captureCurrentState(): PluginCommandState {
        const state: PluginCommandState = {};
        this.getPluginManifests()
            .filter((plugin) => this.isActionablePlugin(plugin.id))
            .forEach((plugin) => { state[plugin.id] = this.isPluginEnabled(plugin.id); });
        return state;
    }

    private capturePreviousState(label: string) {
        this.manager.settings.COMMAND_LAST_STATE = {
            pluginStates: this.captureCurrentState(),
            createdAt: Date.now(),
            label,
        };
    }

    private getActionableManagerPlugins(predicate: (plugin: ManagerPlugin) => boolean): ManagerPlugin[] {
        return this.manager.settings.Plugins
            .filter((plugin) => predicate(plugin))
            .filter((plugin) => this.isActionablePlugin(plugin.id));
    }

    private refreshAfterStatusChange(pluginIds: string[]) {
        this.refresh();
        // 插件状态变更的统一收口：登记可能新出现的 ribbon 图标
        // （显隐与顺序由 Obsidian 原生状态自行维持，无需重新打补丁）
        this.manager.applyRibbonSettings();
        try {
            if (pluginIds.length === 0) {
                void this.manager.managerModal?.reloadShowData();
                return;
            }
            pluginIds.forEach((pluginId) => this.manager.managerModal?.refreshPluginCard(pluginId, { allowReload: true }));
        } catch {
            // UI may not be open
        }
    }

    private async runLocked(key: string, task: () => Promise<void>) {
        if (this.running.has(key)) return;
        this.running.add(key);
        try {
            await task();
        } catch (error) {
            console.error("[BPM] command failed", key, error);
            new Notice(this.t("command_notice_failed"));
        } finally {
            this.running.delete(key);
        }
    }

    private getPluginName(pluginId: string): string {
        const manifest = this.manager.appPlugins.manifests[pluginId];
        const managerPlugin = this.getManagerPlugin(pluginId);
        return managerPlugin?.name || manifest?.name || pluginId;
    }

    private fullCommandId(id: string): string {
        return `${this.manager.manifest.id}:${id}`;
    }

    private safeCommandPart(id: string): string {
        return id.replace(/[^a-zA-Z0-9_-]/g, "-");
    }

    private slugify(name: string): string {
        const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        return slug || "profile";
    }

    private t(key: string, vars?: Record<string, string | number | boolean | null | undefined>): string {
        return this.manager.translator.t(key, vars);
    }
}

class PluginControlModal extends SuggestModal<PluginManifest> {
    private readonly service: ManagerCommandService;

    constructor(app: App, service: ManagerCommandService) {
        super(app);
        this.service = service;
        this.setPlaceholder(service.getTranslator().t("command_control_placeholder"));
        this.emptyStateText = service.getTranslator().t("command_control_empty");
    }

    getSuggestions(query: string): PluginManifest[] {
        const lower = query.trim().toLowerCase();
        return this.service.getPluginManifests()
            .filter((plugin) => {
                if (!lower) return true;
                return `${plugin.name} ${plugin.id} ${plugin.description || ""}`.toLowerCase().includes(lower);
            })
            .slice(0, 50);
    }

    renderSuggestion(plugin: PluginManifest, el: HTMLElement) {
        const row = el.createDiv({ cls: "manager-command-suggestion" });
        const icon = row.createSpan({ cls: "manager-command-suggestion__icon" });
        setIcon(icon, this.service.isPluginEnabled(plugin.id) ? "toggle-right" : "toggle-left");
        const text = row.createDiv({ cls: "manager-command-suggestion__text" });
        text.createDiv({ cls: "manager-command-suggestion__title", text: plugin.name || plugin.id });
        text.createDiv({ cls: "manager-command-suggestion__meta", text: plugin.id });
    }

    onChooseSuggestion(plugin: PluginManifest) {
        new PluginActionModal(this.app, this.service, plugin).open();
    }
}

class PluginActionModal extends SuggestModal<PluginAction> {
    private readonly service: ManagerCommandService;
    private readonly plugin: PluginManifest;

    constructor(app: App, service: ManagerCommandService, plugin: PluginManifest) {
        super(app);
        this.service = service;
        this.plugin = plugin;
        this.setPlaceholder(service.getTranslator().t("command_action_placeholder", { name: plugin.name || plugin.id }));
        this.emptyStateText = service.getTranslator().t("command_control_empty");
    }

    getSuggestions(query: string): PluginAction[] {
        const lower = query.trim().toLowerCase();
        return this.service.getPluginActions(this.plugin.id)
            .filter((action) => !lower || action.label.toLowerCase().includes(lower));
    }

    renderSuggestion(action: PluginAction, el: HTMLElement) {
        const row = el.createDiv({ cls: "manager-command-suggestion" });
        const icon = row.createSpan({ cls: "manager-command-suggestion__icon" });
        setIcon(icon, action.icon);
        const text = row.createDiv({ cls: "manager-command-suggestion__text" });
        text.createDiv({ cls: "manager-command-suggestion__title", text: action.label });
        text.createDiv({
            cls: "manager-command-suggestion__meta",
            text: action.disabled
                ? this.service.getTranslator().t("command_action_disabled")
                : this.plugin.id,
        });
        if (action.disabled) row.addClass("is-disabled");
    }

    onChooseSuggestion(action: PluginAction) {
        if (action.disabled) {
            new Notice(this.service.getTranslator().t("command_action_disabled"));
            return;
        }
        void this.service.runPluginAction(this.plugin.id, action.id);
    }
}

class ProfileNameModal extends SuggestModal<string> {
    private readonly service: ManagerCommandService;

    constructor(app: App, service: ManagerCommandService) {
        super(app);
        this.service = service;
        this.setPlaceholder(service.getTranslator().t("command_profile_name_placeholder"));
        this.emptyStateText = service.getTranslator().t("command_profile_name_empty");
    }

    getSuggestions(query: string): string[] {
        const value = query.trim();
        if (!value) return [];
        return [value];
    }

    renderSuggestion(value: string, el: HTMLElement) {
        el.createDiv({ text: this.service.getTranslator().t("command_profile_save_as", { name: value }) });
    }

    onChooseSuggestion(value: string) {
        void this.service.saveCurrentProfile(value);
    }
}

const Commands = (app: App, manager: Manager) => {
    let service = commandServices.get(manager);
    if (!service) {
        service = new ManagerCommandService(app, manager);
        commandServices.set(manager, service);
    }
    service.refresh();
};

export default Commands;
