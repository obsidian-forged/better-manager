import { FEATURE_IDS, TOOL_IDS, featureEnabled, toolAvailable, toolEnabled } from '../../features';
import BaseSetting from "../base-setting";
import { ButtonComponent, DropdownComponent, Setting, ToggleComponent, TextComponent, setIcon } from "obsidian";
import Commands from "src/command";
import { githubProxyEnabled } from "src/github-url";
// import { GROUP_STYLE, ITEM_STYLE, TAG_STYLE } from "src/data/data";

export default class ManagerBasis extends BaseSetting {

    main(): void {
        const heading = (key: string) => {
            new Setting(this.containerEl)
                .setHeading()
                .setName(this.manager.translator.t(key));
        };

        // 功能开关使用独立的换行控件，不继承导航顶栏的单行尺寸；Wrap personalization controls independently of navigation.
        heading('功能开关_个性化');
        const t0 = (key: string) => this.manager.translator.t(key);
        const FEATURE_ICONS: Record<string, string> = {
            plugins: 'blocks', themes: 'palette', devices: 'monitor-smartphone', ribbon: 'grip-vertical',
            install: 'download', transfer: 'archive-restore', troubleshoot: 'search-check',
        };
        const TOOL_ICONS: Record<string, string> = {
            updates: 'rss', bulkEdit: 'list-plus', layoutEditor: 'pen', reload: 'refresh-ccw',
            catalog: 'compass', pluginMarket: 'store', appearanceMarket: 'store', appearanceProfiles: 'plus',
        };
        const personalizeEl = this.containerEl.createDiv('manager-personalize');
        const featureBar = personalizeEl.createDiv('manager-personalize__features');
        featureBar.setAttribute('role', 'group');
        featureBar.setAttribute('aria-label', t0('功能开关_模块'));
        for (const id of FEATURE_IDS) {
            const button = featureBar.createEl('button', { cls: 'manager-personalize__feature' });
            button.type = 'button';
            button.setAttribute('aria-pressed', `${featureEnabled(this.settings, id)}`);
            button.toggleClass('is-active', featureEnabled(this.settings, id));
            setIcon(button.createSpan('manager-personalize__icon'), FEATURE_ICONS[id] || 'blocks');
            button.createSpan({ cls: 'manager-personalize__label', text: t0('功能开关_' + id) });
            button.addEventListener('click', () => {
                const next = !featureEnabled(this.settings, id);
                void (async () => {
                    this.settings.FEATURES = { ...this.settings.FEATURES, [id]: next };
                    if (id === 'devices' && !next && this.manager.devices.data.enabled) await this.manager.devices.setEnabled(false);
                    if (id === 'plugins' && !next && this.settings.DELAY) {
                        this.settings.DELAY = false;
                        this.manager.delayWaitNotice?.stop();
                        await this.manager.disableDelaysForAllPlugins();
                    }
                    await this.manager.saveSettings();
                    if (id === 'ribbon') await this.manager.refreshRibbonManagerFeature();
                    Commands(this.app, this.manager);
                    this.manager.managerModal?.close();
                    this.settingTab.basisDisplay();
                })().catch(error => this.manager.devices.report(error));
            });
        }

        const toolsWrap = personalizeEl.createDiv('manager-personalize__tools');
        const toolsSetting = new Setting(toolsWrap).setClass('manager-personalize__actions').setName('');
        for (const id of TOOL_IDS.filter(toolAvailable)) {
            const button = toolsSetting.controlEl.createEl('button', { cls: 'manager-personalize__tool' });
            button.type = 'button';
            button.setAttribute('aria-label', t0('功能开关_' + id));
            button.toggleClass('is-active', toolEnabled(this.settings, id));
            button.setAttribute('aria-pressed', `${toolEnabled(this.settings, id)}`);
            setIcon(button, TOOL_ICONS[id] || 'puzzle');
            button.addEventListener('click', () => {
                const next = !toolEnabled(this.settings, id);
                this.settings.TOOLS = { ...this.settings.TOOLS, [id]: next };
                button.toggleClass('is-active', next);
                button.setAttribute('aria-pressed', `${next}`);
                void this.manager.saveSettings().catch(error => this.manager.devices.report(error));
                this.manager.managerModal?.close();
            });
        }

        heading("设置_基础设置_分组_常规");

        const languageBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_语言_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_语言_描述"));
        const languageDropdown = new DropdownComponent(languageBar.controlEl);
        languageDropdown.addOptions(this.manager.translator.language);
        languageDropdown.setValue(this.settings.LANGUAGE);
        languageDropdown.onChange(async (value) => {
            this.settings.LANGUAGE = value;
            void this.manager.saveSettings();
            // 非 en/zh-cn 的语言表是懒加载的，必须先物化再重绘，
            // 否则这一轮重绘会全部命中英文回退
            await this.manager.translator.ensureLanguage(value);
            this.settingTab.basisDisplay();
            Commands(this.app, this.manager);
            this.settingTab.renderSettings();
            this.render();
        });

        const persistenceBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_筛选持久化_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_筛选持久化_描述"));
        const persistenceToggle = new ToggleComponent(persistenceBar.controlEl);
        persistenceToggle.setValue(this.settings.PERSISTENCE);
        persistenceToggle.onChange((value) => {
            const managerModal = this.manager.managerModal;
            if (value) {
                managerModal?.persistCurrentFilters();
            }
            this.settings.PERSISTENCE = value;
            if (!value && managerModal) {
                managerModal.usePersistedFiltersAsSessionFilters();
            }
            void this.manager.saveSettings();
        });

        const recentInstallBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_最近安装_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_最近安装_描述"));
        recentInstallBar.addText(text => {
            const days = Number.isFinite(this.settings.RECENT_INSTALL_DAYS) && this.settings.RECENT_INSTALL_DAYS >= 0
                ? Math.floor(this.settings.RECENT_INSTALL_DAYS)
                : 7;
            text.setValue(String(days))
                .setPlaceholder("7")
                .onChange(value => {
                    const parsed = Number.parseInt(value, 10);
                    this.settings.RECENT_INSTALL_DAYS = Number.isFinite(parsed) && parsed >= 0 ? parsed : 7;
                    void this.manager.saveSettings();
                    void this.manager.managerModal?.reloadShowData();
                });
            text.inputEl.type = "number";
            text.inputEl.min = "0";
            text.inputEl.step = "1";
        });

        heading("设置_基础设置_分组_启动接管");

        const DelayBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_延时启动_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_延时启动_描述"));
        const DelayToggle = new ToggleComponent(DelayBar.controlEl);
        DelayToggle.setValue(this.settings.DELAY);
        DelayToggle.setDisabled(!featureEnabled(this.settings, 'plugins'));
        DelayToggle.onChange((value) => {
            this.settings.DELAY = value;
            void this.manager.saveSettings();
            if (value) {
                void this.manager.enableDelaysForAllPlugins();
            } else {
                this.manager.delayWaitNotice?.stop();
                void this.manager.disableDelaysForAllPlugins();
            }
            this.settingTab.renderSettings();
            this.render();
        });

        const waitMessageBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_等待提示_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_等待提示_描述"));
        const waitMessageToggle = new ToggleComponent(waitMessageBar.controlEl);
        waitMessageToggle.setValue(this.settings.DELAY_WAIT_MESSAGE);
        waitMessageToggle.setDisabled(!this.settings.DELAY);
        waitMessageToggle.onChange((value) => {
            this.settings.DELAY_WAIT_MESSAGE = value;
            if (!value) this.manager.delayWaitNotice?.stop();
            void this.manager.saveSettings();
            this.settingTab.basisDisplay();
        });

        const waitMessageTextBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_等待提示信息_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_等待提示信息_描述"));
        waitMessageTextBar.addText(text => text
            .setPlaceholder(this.manager.translator.t("延迟_等待_名称"))
            .setValue(this.settings.DELAY_WAIT_MESSAGE_TEXT || "")
            .setDisabled(!this.settings.DELAY || !this.settings.DELAY_WAIT_MESSAGE)
            .onChange(value => {
                this.settings.DELAY_WAIT_MESSAGE_TEXT = value;
                void this.manager.saveSettings();
            }));

        const waitMessageExtraBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_等待提示额外_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_等待提示额外_描述"));
        waitMessageExtraBar.addText(text => {
            text.setValue(`${this.settings.DELAY_WAIT_MESSAGE_EXTRA_SECONDS || 0}`)
                .setDisabled(!this.settings.DELAY || !this.settings.DELAY_WAIT_MESSAGE)
                .onChange(value => {
                    const parsed = Number.parseInt(value, 10);
                    this.settings.DELAY_WAIT_MESSAGE_EXTRA_SECONDS = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
                    void this.manager.saveSettings();
                });
            text.inputEl.type = "number";
            text.inputEl.min = "0";
            text.inputEl.step = "1";
        });

        const autoTakeoverBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_自动接管_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_自动接管_描述"));
        const autoTakeoverToggle = new ToggleComponent(autoTakeoverBar.controlEl);
        autoTakeoverToggle.setValue(this.settings.AUTO_TAKEOVER);
        autoTakeoverToggle.setDisabled(!this.settings.DELAY);
        autoTakeoverToggle.onChange((value) => {
            if (!this.settings.DELAY) return;
            this.settings.AUTO_TAKEOVER = value;
            void this.manager.saveSettings();
        });

        heading("设置_基础设置_分组_更新来源");

        const startupCheckBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_启动检查更新_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_启动检查更新_描述"));
        const startupCheckToggle = new ToggleComponent(startupCheckBar.controlEl);
        startupCheckToggle.setValue(this.settings.STARTUP_CHECK_UPDATES);
        startupCheckToggle.onChange((value) => {
            this.settings.STARTUP_CHECK_UPDATES = value;
            void this.manager.saveSettings();
        });

        const sourceStartupCheckBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_来源启动检查更新_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_来源启动检查更新_描述"));
        const sourceStartupCheckToggle = new ToggleComponent(sourceStartupCheckBar.controlEl);
        sourceStartupCheckToggle.setValue(this.settings.SOURCE_STARTUP_CHECK_UPDATES);
        sourceStartupCheckToggle.onChange((value) => {
            this.settings.SOURCE_STARTUP_CHECK_UPDATES = value;
            void this.manager.saveSettings();
        });

        const sourceAutoUpdateBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_来源自动更新_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_来源自动更新_描述"));
        const sourceAutoUpdateToggle = new ToggleComponent(sourceAutoUpdateBar.controlEl);
        sourceAutoUpdateToggle.setValue(this.settings.SOURCE_AUTO_UPDATE);
        sourceAutoUpdateToggle.onChange((value) => {
            this.settings.SOURCE_AUTO_UPDATE = value;
            void this.manager.saveSettings();
        });

        const officialSourceBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_官方插件源_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_官方插件源_描述"));
        const officialSource = new DropdownComponent(officialSourceBar.controlEl);
        officialSource.addOptions({
            stats: this.manager.translator.t("设置_基础设置_官方插件源_统计"),
            github: this.manager.translator.t("设置_基础设置_官方插件源_接口"),
        });
        officialSource.setValue(this.settings.PLUGIN_UPDATE_OFFICIAL_SOURCE === "github" ? "github" : "stats");
        officialSource.onChange((value) => {
            this.settings.PLUGIN_UPDATE_OFFICIAL_SOURCE = value === "github" ? "github" : "stats";
            void this.manager.saveSettings();
        });

        const unofficialSourceBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_非官方插件源_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_非官方插件源_描述"));
        const unofficialSource = new DropdownComponent(unofficialSourceBar.controlEl);
        unofficialSource.addOptions({
            atom: this.manager.translator.t("设置_基础设置_非官方插件源_自动"),
            github: this.manager.translator.t("设置_基础设置_非官方插件源_接口"),
        });
        unofficialSource.setValue(this.settings.PLUGIN_UPDATE_UNOFFICIAL_SOURCE === "github" ? "github" : "atom");
        unofficialSource.onChange((value) => {
            this.settings.PLUGIN_UPDATE_UNOFFICIAL_SOURCE = value === "github" ? "github" : "atom";
            void this.manager.saveSettings();
        });

        let tokenBar: Setting | null = null;
        const githubProxyBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_GITHUB_PROXY_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_GITHUB_PROXY_描述"));
        const githubProxyInput = new TextComponent(githubProxyBar.controlEl);
        githubProxyInput.setPlaceholder(this.manager.translator.t("设置_基础设置_GITHUB_PROXY_占位符"));
        githubProxyInput.setValue(this.settings.GITHUB_PROXY || "");
        githubProxyInput.onChange((value) => {
            const wasProxyEnabled = githubProxyEnabled(this.manager);
            this.settings.GITHUB_PROXY = value.trim();
            void this.manager.saveSettings();
            const isProxyEnabled = githubProxyEnabled(this.manager);
            if (isProxyEnabled) {
                tokenBar?.settingEl.remove();
                tokenBar = null;
            } else if (wasProxyEnabled) {
                this.render();
            }
        });
        githubProxyInput.inputEl.addEventListener("blur", () => this.render());

        // Token 紧邻更新来源，避免和调试开关混在一起后难以找到。 / Keep the token next to update sources so it is discoverable.
        if (!githubProxyEnabled(this.manager)) {
            tokenBar = new Setting(this.containerEl)
                .setName(this.manager.translator.t("设置_基础设置_GITHUB_TOKEN_标题"))
                .setDesc(`${this.manager.translator.t("设置_基础设置_GITHUB_TOKEN_描述")} (${this.manager.translator.t("设置_基础设置_GITHUB_TOKEN_权限")})`);
            tokenBar.settingEl.addClass("manager-secret-token-setting");
            const tokenStatus = tokenBar.descEl.createDiv({
                cls: "manager-secret-token-setting__status",
                text: this.getGithubTokenStatusText(),
            });
            const tokenInput = new TextComponent(tokenBar.controlEl);
            tokenInput.inputEl.type = "password";
            tokenInput.inputEl.autocomplete = "off";
            tokenInput.setPlaceholder(this.manager.hasGithubToken() ? "********" : "ghp_xxx");

            let clearTokenButton: ButtonComponent | null = null;
            const saveTokenButton = new ButtonComponent(tokenBar.controlEl);
            saveTokenButton.setButtonText(this.manager.translator.t("设置_基础设置_GITHUB_TOKEN_保存"));
            saveTokenButton.setCta();
            saveTokenButton.onClick(async () => {
                const token = tokenInput.getValue().trim();
                if (!token) return;
                await this.manager.setGithubToken(token);
                tokenInput.setValue("");
                tokenInput.setPlaceholder("********");
                tokenStatus.setText(this.getGithubTokenStatusText());
                clearTokenButton?.setDisabled(false);
            });

            clearTokenButton = new ButtonComponent(tokenBar.controlEl);
            clearTokenButton.setButtonText(this.manager.translator.t("设置_基础设置_GITHUB_TOKEN_清除"));
            clearTokenButton.setDisabled(!this.manager.hasGithubToken());
            clearTokenButton.onClick(async () => {
                await this.manager.clearGithubToken();
                tokenInput.setValue("");
                tokenInput.setPlaceholder("ghp_xxx");
                tokenStatus.setText(this.getGithubTokenStatusText());
                clearTokenButton?.setDisabled(true);
            });

            void this.manager.getGithubToken().then(() => {
                tokenInput.setPlaceholder(this.manager.hasGithubToken() ? "********" : "ghp_xxx");
                tokenStatus.setText(this.getGithubTokenStatusText());
                clearTokenButton?.setDisabled(!this.manager.hasGithubToken());
            });
        }

        heading("设置_基础设置_分组_界面展示");

        const hideBpmTagBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_隐藏BPM标签_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_隐藏BPM标签_描述"));
        const hideBpmTagToggle = new ToggleComponent(hideBpmTagBar.controlEl);
        hideBpmTagToggle.setValue(this.settings.HIDE_BPM_TAG);
        hideBpmTagToggle.onChange((value) => {
            this.settings.HIDE_BPM_TAG = value;
            void this.manager.saveSettings();
            void this.manager.managerModal?.reloadShowData();
        });

        const ribbonManagerBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_边栏编排_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_边栏编排_描述"));
        const ribbonManagerToggle = new ToggleComponent(ribbonManagerBar.controlEl);
        ribbonManagerToggle.setValue(this.settings.RIBBON_MANAGER_ENABLED !== false);
        ribbonManagerToggle.onChange(async (value) => {
            this.settings.RIBBON_MANAGER_ENABLED = value;
            await this.manager.saveSettings();
            await this.manager.refreshRibbonManagerFeature();
        });

        heading("设置_基础设置_分组_命令");

        const CommandItemBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_单独命令_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_单独命令_描述"));
        const CommandItemToggle = new ToggleComponent(CommandItemBar.controlEl);
        CommandItemToggle.setValue(this.settings.COMMAND_ITEM);
        CommandItemToggle.onChange((value) => {
            this.settings.COMMAND_ITEM = value;
            void this.manager.saveSettings();
            Commands(this.app, this.manager);
        });

        const CommandGroupBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_分组命令_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_分组命令_描述"));
        const CommandGroupToggle = new ToggleComponent(CommandGroupBar.controlEl);
        CommandGroupToggle.setValue(this.settings.COMMAND_GROUP);
        CommandGroupToggle.onChange((value) => {
            this.settings.COMMAND_GROUP = value;
            void this.manager.saveSettings();
            Commands(this.app, this.manager);
        });

        const CommandTagBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("command_setting_tag_title"))
            .setDesc(this.manager.translator.t("command_setting_tag_desc"));
        const CommandTagToggle = new ToggleComponent(CommandTagBar.controlEl);
        CommandTagToggle.setValue(this.settings.COMMAND_TAG);
        CommandTagToggle.onChange((value) => {
            this.settings.COMMAND_TAG = value;
            void this.manager.saveSettings();
            Commands(this.app, this.manager);
        });

        const CommandProfileBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("command_setting_profile_title"))
            .setDesc(this.manager.translator.t("command_setting_profile_desc"));
        const CommandProfileToggle = new ToggleComponent(CommandProfileBar.controlEl);
        CommandProfileToggle.setValue(this.settings.COMMAND_PROFILE);
        CommandProfileToggle.onChange((value) => {
            this.settings.COMMAND_PROFILE = value;
            void this.manager.saveSettings();
            Commands(this.app, this.manager);
        });

        heading("设置_基础设置_分组_开发网络");

        const debugBar = new Setting(this.containerEl)
            .setName(this.manager.translator.t("设置_基础设置_调试模式_标题"))
            .setDesc(this.manager.translator.t("设置_基础设置_调试模式_描述"));
        const debugToggle = new ToggleComponent(debugBar.controlEl);
        debugToggle.setValue(this.settings.DEBUG);
        debugToggle.onChange((value) => {
            this.settings.DEBUG = value;
            void this.manager.saveSettings();
        });

    }

    private getGithubTokenStatusText(): string {
        if (!this.manager.hasGithubToken()) return this.manager.translator.t("设置_基础设置_GITHUB_TOKEN_状态_未设置");
        return this.manager.supportsSecretStorage()
            ? this.manager.translator.t("设置_基础设置_GITHUB_TOKEN_状态_安全存储")
            : this.manager.translator.t("设置_基础设置_GITHUB_TOKEN_状态_兼容存储");
    }
}
