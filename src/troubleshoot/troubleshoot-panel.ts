import { App, ButtonComponent, Notice, setIcon } from "obsidian";
import Manager from "main";
import { TroubleshootAlgorithm } from "./troubleshoot-algorithm";
import { INITIAL_TROUBLESHOOT_STATE, TroubleshootState, cloneState } from "./troubleshoot-state";
import { TroubleshootResultModal } from "./troubleshoot-result";

type RenderCallback = () => void;

export class TroubleshootPanel {
    private app: App;
    private manager: Manager;
    private algorithm: TroubleshootAlgorithm;
    private containerEl: HTMLElement | null = null;
    private state: TroubleshootState = cloneState(INITIAL_TROUBLESHOOT_STATE);
    private lastDescription = "";
    private onStateChange?: RenderCallback;
    private t: (key: string) => string;

    constructor(app: App, manager: Manager, onStateChange?: RenderCallback) {
        this.app = app;
        this.manager = manager;
        this.algorithm = new TroubleshootAlgorithm(app, manager);
        this.onStateChange = onStateChange;
        this.t = (key: string) => manager.translator.t(key);
    }

    display(containerEl: HTMLElement) {
        this.containerEl = containerEl;
        this.loadState();
        this.render();
    }

    private loadState() {
        const savedState = this.manager.settings.TROUBLESHOOT_STATE;
        if (savedState && (savedState.status === "running" || savedState.status === "completed")) {
            this.state = savedState;
        } else {
            this.state = cloneState(INITIAL_TROUBLESHOOT_STATE); 
        }
    }

    private async saveState() {
        this.manager.settings.TROUBLESHOOT_STATE = this.state;
        await this.manager.saveSettings();
    }

    private async clearState() {
        this.state = cloneState(INITIAL_TROUBLESHOOT_STATE);
        this.manager.settings.TROUBLESHOOT_STATE = this.state; 
        await this.manager.saveSettings();
    }

    private render() {
        if (!this.containerEl) return;
        this.containerEl.empty();

        const page = this.containerEl.createDiv("manager-troubleshoot-page manager-troubleshoot");
        this.renderHero(page);

        if (this.state.status === "running") {
            this.renderRunning(page);
        } else if (this.state.status === "completed" && this.state.result) {
            this.renderResult(page);
        } else {
            this.renderOverview(page);
        }
    }

    private renderHero(page: HTMLElement) {
        const header = page.createDiv("manager-troubleshoot__header");
        const titleGroup = header.createDiv("manager-troubleshoot__title-group");
        const icon = titleGroup.createSpan({ cls: "manager-troubleshoot__title-icon" });
        setIcon(icon, "search-check");
        const text = titleGroup.createDiv();
        text.createEl("h3", { text: this.t("排查_Tab_标题"), cls: "manager-troubleshoot__title" });
        text.createDiv({ text: this.t("排查_Tab_说明"), cls: "manager-troubleshoot__subtitle" });

        const status = this.getStatusText();
        const statusChip = header.createDiv({ cls: `manager-troubleshoot__status is-${this.state.status}` });
        const statusIcon = statusChip.createSpan();
        setIcon(statusIcon, this.state.status === "running" ? "activity" : this.state.status === "completed" ? "check-check" : "circle");
        statusChip.createSpan({ text: status });
    }

    private renderOverview(page: HTMLElement) {
        const enabledPlugins = this.algorithm.getEnabledPlugins();
        const estimatedSteps = enabledPlugins.length > 1
            ? Math.ceil(Math.log2(enabledPlugins.length)) * 2 + 2
            : enabledPlugins.length;

        const summary = page.createDiv("manager-troubleshoot__summary");
        this.renderMetric(summary, "power", this.t("排查_当前启用_文本"), `${enabledPlugins.length}`);
        this.renderMetric(summary, "list-checks", this.t("排查_预计步骤_文本"), enabledPlugins.length > 1 ? `~${estimatedSteps}` : `${estimatedSteps}`);
        this.renderMetric(summary, "shield-alert", this.t("排查_可信度_标签"), this.t("排查_可信度_值"));

        const cards = page.createDiv("manager-troubleshoot__cards");
        this.renderInfoCard(cards, "shield-alert", this.t("排查_结论_标题"), this.t("排查_结论_文本"));
        this.renderInfoCard(cards, "scan-search", this.t("排查_覆盖_标题"), this.t("排查_覆盖_文本"));
        this.renderInfoCard(cards, "triangle-alert", this.t("排查_限制_标题"), this.t("排查_限制_文本"));

        this.renderFlow(page);

        const startPanel = page.createDiv("manager-troubleshoot__start");
        startPanel.createDiv({ cls: "manager-troubleshoot__start-title", text: this.t("排查_开始_按钮") });
        startPanel.createDiv({ cls: "manager-troubleshoot__start-desc", text: this.t("排查_开始会改变状态_提示") });

        const actions = startPanel.createDiv("manager-troubleshoot__actions");
        const startBtn = new ButtonComponent(actions);
        startBtn.setIcon("play");
        startBtn.setButtonText(this.t("排查_开始_按钮"));
        startBtn.setCta();
        startBtn.setDisabled(enabledPlugins.length === 0);
        startBtn.onClick(async () => { 
            await this.startTroubleshoot();
        });

        if (enabledPlugins.length === 0) {
            startPanel.createDiv({ cls: "manager-troubleshoot__notice", text: this.t("排查_无启用插件_提示") });
        }
    }

    private renderFlow(page: HTMLElement) {
        const flow = page.createDiv("manager-troubleshoot__flow");
        flow.createDiv({ cls: "manager-troubleshoot__section-title", text: this.t("排查_流程_标题") });
        const steps = flow.createDiv("manager-troubleshoot__steps");
        [
            ["power-off", this.t("排查_流程_确认")],
            ["split", this.t("排查_流程_定位")],
            ["badge-check", this.t("排查_流程_验证")],
            ["rotate-ccw", this.t("排查_流程_恢复")],
        ].forEach(([iconName, label], index) => {
            const step = steps.createDiv("manager-troubleshoot__step");
            const icon = step.createSpan({ cls: "manager-troubleshoot__step-icon" });
            setIcon(icon, iconName);
            step.createSpan({ cls: "manager-troubleshoot__step-index", text: `${index + 1}` });
            step.createSpan({ cls: "manager-troubleshoot__step-label", text: label });
        });
    }

    private renderRunning(page: HTMLElement) {
        const currentEnabled = this.algorithm.getEnabledPlugins();
        const algo = this.state.algorithmState;
        const remaining = Math.max(1, this.algorithm.estimateRemainingSteps(this.state));
        const total = Math.max(1, this.state.currentStep + remaining);
        const percent = Math.min(98, Math.round((this.state.currentStep / total) * 100));

        const stage = page.createDiv("manager-troubleshoot__stage");
        const stageTop = stage.createDiv("manager-troubleshoot__stage-top");
        stageTop.createDiv({ cls: "manager-troubleshoot__section-title", text: this.getStageText() });
        stageTop.createDiv({ cls: "manager-troubleshoot__step-count", text: `${this.t("排查_步骤_文本")} ${this.state.currentStep}` });

        const progress = stage.createDiv("manager-troubleshoot__progress");
        progress.setAttribute("role", "progressbar");
        progress.setAttribute("aria-valuemin", "0");
        progress.setAttribute("aria-valuemax", "100");
        progress.setAttribute("aria-valuenow", `${percent}`);
        progress.createDiv("manager-troubleshoot__progress-bar").setCssStyles({ width: `${percent}%` });

        const description = this.lastDescription || this.getCurrentTestDescription();
        if (description) {
            stage.createDiv({ cls: "manager-troubleshoot__current-test", text: `${this.t("排查_当前测试")}: ${description}` });
        }

        const matrix = page.createDiv("manager-troubleshoot__matrix");
        this.renderPluginList(matrix, this.t("排查_已启用_文本"), currentEnabled, "power", "is-enabled");
        this.renderPluginList(matrix, this.t("排查_候选插件_文本"), algo?.currentSet || this.state.suspectPool, "target", "is-suspect");

        const feedback = page.createDiv("manager-troubleshoot__feedback");
        feedback.createDiv({ cls: "manager-troubleshoot__section-title", text: this.t("排查_测试提示_文本") });
        const feedbackActions = feedback.createDiv("manager-troubleshoot__actions");

        const existsBtn = new ButtonComponent(feedbackActions);
        existsBtn.setIcon("x-circle");
        existsBtn.setButtonText(this.t("排查_问题还在_按钮"));
        existsBtn.onClick(async () => {
            await this.handleFeedback(true);
        });

        const goneBtn = new ButtonComponent(feedbackActions);
        goneBtn.setIcon("check-circle-2");
        goneBtn.setButtonText(this.t("排查_问题消失_按钮"));
        goneBtn.setCta();
        goneBtn.onClick(async () => {
            await this.handleFeedback(false);
        });

        const utilityActions = page.createDiv("manager-troubleshoot__actions manager-troubleshoot__actions--secondary");
        const restartBtn = new ButtonComponent(utilityActions);
        restartBtn.setIcon("refresh-ccw");
        restartBtn.setButtonText(this.t("排查_重启_按钮"));
        restartBtn.onClick(async () => {
            await this.saveState();
            this.algorithm.restartObsidian();
        });

        const undoBtn = new ButtonComponent(utilityActions);
        undoBtn.setIcon("undo-2");
        undoBtn.setButtonText(this.t("排查_撤销_按钮"));
        undoBtn.setDisabled(this.state.history.length === 0);
        undoBtn.onClick(async () => {
            await this.undo();
        });

        const restoreBtn = new ButtonComponent(utilityActions);
        restoreBtn.setIcon("rotate-ccw");
        restoreBtn.setButtonText(this.t("排查_恢复并退出_按钮"));
        restoreBtn.onClick(async () => {
            await this.restoreAndReset();
        });

        const keepBtn = new ButtonComponent(utilityActions);
        keepBtn.setIcon("pause-circle");
        keepBtn.setButtonText(this.t("排查_保留并结束_按钮"));
        keepBtn.onClick(async () => {
            await this.clearState();
            this.onStateChange?.();
            this.render();
        });
    }

    private renderResult(page: HTMLElement) {
        if (!this.state.result) return;
        const result = page.createDiv("manager-troubleshoot__result");
        result.createDiv({ cls: "manager-troubleshoot__section-title", text: this.t("排查_完成_标题") });

        const isSingle = !this.state.result.plugin2;
        const resultText = isSingle
            ? this.t("报告_发现问题插件")
            : this.t("排查_发现冲突_文本");
        result.createDiv({ cls: "manager-troubleshoot__result-kind", text: resultText });

        const pair = result.createDiv("manager-troubleshoot__result-pair");
        this.renderResultPlugin(pair, this.state.result.plugin1);
        if (!isSingle) {
            const link = pair.createSpan({ cls: "manager-troubleshoot__result-link" });
            setIcon(link, "link");
            this.renderResultPlugin(pair, this.state.result.plugin2);
        }

        const actions = result.createDiv("manager-troubleshoot__actions");
        const openBtn = new ButtonComponent(actions);
        openBtn.setIcon("file-text");
        openBtn.setButtonText(this.t("排查_打开结果_按钮"));
        openBtn.setCta();
        openBtn.onClick(() => {
            new TroubleshootResultModal(this.app, this.manager, this.state).open();
        });

        const restoreBtn = new ButtonComponent(actions);
        restoreBtn.setIcon("rotate-ccw");
        restoreBtn.setButtonText(this.t("排查_恢复原始_按钮"));
        restoreBtn.onClick(async () => {
            await this.restoreAndReset();
        });

        const restartBtn = new ButtonComponent(actions);
        restartBtn.setIcon("refresh-cw");
        restartBtn.setButtonText(this.t("排查_重新开始_按钮"));
        restartBtn.onClick(async () => {
            await this.clearState();
            this.render();
        });
    }

    private renderResultPlugin(container: HTMLElement, pluginId: string) {
        const manifests = this.algorithm.getAllManifests();
        const plugin = manifests[pluginId];
        const item = container.createDiv("manager-troubleshoot__result-plugin");
        const icon = item.createSpan({ cls: "manager-troubleshoot__result-icon" });
        setIcon(icon, "blocks");
        item.createSpan({ cls: "manager-troubleshoot__result-name", text: plugin?.name || pluginId });
        item.createSpan({ cls: "manager-troubleshoot__result-version", text: plugin?.version ? `v${plugin.version}` : pluginId });
    }

    private renderMetric(container: HTMLElement, iconName: string, label: string, value: string) {
        const metric = container.createDiv("manager-troubleshoot__metric");
        const icon = metric.createSpan({ cls: "manager-troubleshoot__metric-icon" });
        setIcon(icon, iconName);
        metric.createSpan({ cls: "manager-troubleshoot__metric-label", text: label });
        metric.createSpan({ cls: "manager-troubleshoot__metric-value", text: value });
    }

    private renderInfoCard(container: HTMLElement, iconName: string, title: string, text: string) {
        const card = container.createDiv("manager-troubleshoot__info-card");
        const icon = card.createSpan({ cls: "manager-troubleshoot__info-icon" });
        setIcon(icon, iconName);
        const body = card.createDiv();
        body.createDiv({ cls: "manager-troubleshoot__info-title", text: title });
        body.createDiv({ cls: "manager-troubleshoot__info-text", text });
    }

    private renderPluginList(container: HTMLElement, title: string, pluginIds: string[], iconName: string, className: string) {
        const card = container.createDiv(`manager-troubleshoot__plugin-list ${className}`);
        const header = card.createDiv("manager-troubleshoot__plugin-list-header");
        const icon = header.createSpan({ cls: "manager-troubleshoot__plugin-list-icon" });
        setIcon(icon, iconName);
        header.createSpan({ text: `${title} (${pluginIds.length})` });

        const list = card.createDiv("manager-troubleshoot__plugins");
        if (pluginIds.length === 0) {
            list.createDiv({ cls: "manager-troubleshoot__empty", text: this.t("排查_列表_无") });
            return;
        }
        pluginIds.forEach((id) => {
            const item = list.createDiv("manager-troubleshoot__plugin");
            item.createSpan({ cls: "manager-troubleshoot__plugin-name", text: this.algorithm.getPluginName(id) });
            item.createSpan({ cls: "manager-troubleshoot__plugin-id", text: id });
        });
    }

    private getStatusText(): string {
        if (this.state.status === "running") return this.t("排查_状态_运行中");
        if (this.state.status === "completed") return this.t("排查_状态_已完成");
        return this.t("排查_状态_空闲");
    }

    private getStageText(): string {
        const stage = this.state.algorithmState?.stage;
        switch (stage) {
            case "initial-confirm":
                return this.t("排查_阶段_确认");
            case "bisect-main":
                return this.t("排查_阶段_查找第一");
            case "cross-pair-bisect-a":
            case "cross-pair-bisect-b":
                return this.t("排查_阶段_查找第二");
            case "verify-pair":
            case "verify-single":
                return this.t("排查_阶段_验证");
            default:
                return this.t("排查_状态_空闲");
        }
    }

    private getCurrentTestDescription(): string {
        const enabled = this.algorithm.getEnabledPlugins();
        if (enabled.length === 0) return this.t("排查_描述_禁用全部");
        if (enabled.length === 1) {
            return this.t("排查_描述_验证").replace("{name}", this.algorithm.getPluginName(enabled[0]));
        }
        return `${this.t("排查_已启用_文本")}: ${enabled.length}`;
    }

    private async startTroubleshoot() {
        this.state = this.algorithm.initState();
        this.lastDescription = this.t("排查_描述_禁用全部");
        await this.algorithm.startTroubleshoot(this.state);
        await this.saveState();
        this.onStateChange?.();
        new Notice(this.t("排查_已禁用所有_通知"));
        this.render();
    }

    private async handleFeedback(problemExists: boolean) {
        const result = await this.algorithm.executeNextStep(this.state, problemExists);
        switch (result.type) {
            case "not-plugin-issue":
                new Notice(this.t("排查_非插件问题_通知"));
                await this.restoreAndReset();
                return;
            case "single":
            case "pair":
                await this.saveState();
                this.onStateChange?.();
                this.render();
                return;
            case "error":
                new Notice(result.message);
                await this.restoreAndReset();
                return;
            case "continue":
                if (result.nextAction.action === "test") {
                    this.lastDescription = result.nextAction.description;
                }
                await this.saveState();
                this.onStateChange?.();
                this.render();
                return;
        }
    }

    private async undo() {
        const success = await this.algorithm.undo(this.state);
        if (!success) return;
        await this.saveState();
        this.onStateChange?.();
        new Notice(this.t("排查_已撤销_通知"));
        this.render();
    }

    private async restoreAndReset() {
        await this.algorithm.restoreOriginal(this.state);
        await this.clearState();
        this.onStateChange?.();
        new Notice(this.t("排查_已恢复_通知"));
        this.render();
    }
}
