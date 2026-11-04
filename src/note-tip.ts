import Manager from "main";
import { ManagerPlugin } from "./data/types";
import { NoteTipSettings, DEFAULT_NOTE_TIP } from "./settings/data";

/**
 * 备注 Tooltip（Note Tip）
 *
 * 悬停左侧 Ribbon 的管理器图标时，弹出一个自定义 tooltip，
 * 按范围列出「已写备注的插件」（自定义名称 + 备注内容），
 * 让用户不进管理器就能快速回忆每个插件的用途。
 *
 * 右键该图标可打开配置面板：开关、显示范围（启用/全部/禁用/分组/标签）、
 * 标题文本、最大显示条数。配置持久化在 settings.NOTE_TIP。
 */

type NoteTipFilter = NoteTipSettings["filter"];

const TOOLTIP_CLS = "bpm-notetip";
const PANEL_CLS = "bpm-notetip-cfg";

export class NoteTipFeature {
    private manager: Manager;
    private ribbonEl: HTMLElement;
    private tooltip: HTMLElement | null = null;
    private panel: HTMLElement | null = null;

    constructor(manager: Manager, ribbonEl: HTMLElement) {
        this.manager = manager;
        this.ribbonEl = ribbonEl;
    }

    /** 在 onload 中调用：绑定悬停 tooltip 与右键配置面板 */
    public start() {
        this.ribbonEl.addClass("bpm-notetip-icon");
        this.manager.registerDomEvent(this.ribbonEl, "mouseenter", () => this.showTooltip());
        this.manager.registerDomEvent(this.ribbonEl, "mouseleave", () => this.hideTooltip());
        this.manager.registerDomEvent(this.ribbonEl, "contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this.togglePanel();
        });
        this.manager.register(() => this.dispose());
        this.applyLabel();
    }

    public dispose() {
        this.hideTooltip();
        this.closePanel();
    }

    /** 启用时隐藏 Obsidian 原生 aria-label tooltip，避免双 tooltip 叠加 */
    private applyLabel() {
        const cfg = this.loadCfg();
        if (cfg.enabled) this.ribbonEl.removeAttribute("aria-label");
        else this.ribbonEl.setAttribute("aria-label", this.manager.translator.t("通用_管理器_文本"));
    }

    private loadCfg(): NoteTipSettings {
        const stored = this.manager.settings.NOTE_TIP;
        return Object.assign({}, DEFAULT_NOTE_TIP, stored);
    }

    private async saveCfg(cfg: NoteTipSettings) {
        this.manager.settings.NOTE_TIP = Object.assign({}, cfg);
        await this.manager.saveSettings();
    }

    /** 按范围过滤出有备注的插件 */
    private collect(cfg: NoteTipSettings): ManagerPlugin[] {
        const has = (p: ManagerPlugin) => !!(p.note && p.note.trim());
        const list = this.manager.settings.Plugins.filter(has);
        switch (cfg.filter) {
            case "enabled": return list.filter(p => p.enabled);
            case "disabled": return list.filter(p => !p.enabled);
            case "group": return list.filter(p => p.group === cfg.groupId);
            case "tag": return list.filter(p => p.tags.includes(cfg.tagId));
            default: return list;
        }
    }

    private showTooltip() {
        const cfg = this.loadCfg();
        if (!cfg.enabled || this.tooltip) return;
        const rows = this.collect(cfg);
        if (!rows.length) return;
        const shown = rows.slice(0, Math.max(1, cfg.max || DEFAULT_NOTE_TIP.max));

        const tip = activeDocument.body.createDiv({ cls: TOOLTIP_CLS });
        tip.createDiv({ cls: `${TOOLTIP_CLS}-title`, text: cfg.title || this.manager.translator.t("备注Tooltip_默认标题") });
        for (const p of shown) {
            const row = tip.createDiv({ cls: `${TOOLTIP_CLS}-row` });
            row.createSpan({ cls: `${TOOLTIP_CLS}-name`, text: p.name || p.id });
            row.createSpan({ cls: `${TOOLTIP_CLS}-note`, text: p.note });
        }
        if (rows.length > shown.length) {
            tip.createDiv({ cls: `${TOOLTIP_CLS}-more`, text: `… +${rows.length - shown.length}` });
        }
        tip.createDiv({ cls: `${TOOLTIP_CLS}-foot`, text: this.manager.translator.t("备注Tooltip_右键提示") });

        // 定位到图标右侧；下边界超出视口时向上收
        const rect = this.ribbonEl.getBoundingClientRect();
        tip.setCssStyles({ left: `${rect.right + 12}px`, top: `${rect.top - 4}px` });
        const tipRect = tip.getBoundingClientRect();
        const overflow = tipRect.bottom - activeWindow.innerHeight + 12;
        if (overflow > 0) tip.setCssStyles({ top: `${rect.top - 4 - overflow}px` });

        this.tooltip = tip;
    }

    private hideTooltip() {
        this.tooltip?.remove();
        this.tooltip = null;
    }

    private togglePanel() {
        if (this.panel) this.closePanel();
        else this.openPanel();
    }

    private openPanel() {
        const t = (k: string) => this.manager.translator.t(k as never);
        const cfg = this.loadCfg();
        const rect = this.ribbonEl.getBoundingClientRect();

        const panel = activeDocument.body.createDiv({ cls: PANEL_CLS });
        panel.setCssStyles({ left: `${rect.right + 12}px`, top: `${rect.top - 4}px` });

        panel.createDiv({ cls: `${PANEL_CLS}-title`, text: t("备注Tooltip_设置标题") });

        // 启用开关
        const enableRow = panel.createDiv({ cls: `${PANEL_CLS}-row` });
        const enableLabel = enableRow.createEl("label", { cls: `${PANEL_CLS}-check` });
        const enableBox = enableLabel.createEl("input", { type: "checkbox" });
        enableBox.checked = cfg.enabled;
        enableLabel.createSpan({ text: t("备注Tooltip_启用") });

        // 显示范围
        panel.createDiv({ cls: `${PANEL_CLS}-label`, text: t("备注Tooltip_显示范围") });
        const filterSel = panel.createEl("select", { cls: `${PANEL_CLS}-input` });
        const filterOptions: [NoteTipFilter, string][] = [
            ["enabled", t("备注Tooltip_范围_仅启用")],
            ["all", t("备注Tooltip_范围_全部")],
            ["disabled", t("备注Tooltip_范围_仅禁用")],
            ["group", t("备注Tooltip_范围_按分组")],
            ["tag", t("备注Tooltip_范围_按标签")],
        ];
        for (const [value, label] of filterOptions) filterSel.createEl("option", { value, text: label });
        filterSel.value = cfg.filter;

        // 分组 / 标签下拉（按范围显示其一）
        const groupSel = panel.createEl("select", { cls: `${PANEL_CLS}-input` });
        for (const g of this.manager.settings.GROUPS) groupSel.createEl("option", { value: g.id, text: g.name });
        groupSel.value = cfg.groupId;
        const tagSel = panel.createEl("select", { cls: `${PANEL_CLS}-input` });
        for (const tag of this.manager.settings.TAGS) tagSel.createEl("option", { value: tag.id, text: tag.name });
        tagSel.value = cfg.tagId;
        const syncScopeSelects = () => {
            groupSel.setCssStyles({ display: filterSel.value === "group" ? "" : "none" });
            tagSel.setCssStyles({ display: filterSel.value === "tag" ? "" : "none" });
        };
        filterSel.addEventListener("change", syncScopeSelects);
        syncScopeSelects();

        // 标题文本
        panel.createDiv({ cls: `${PANEL_CLS}-label`, text: t("备注Tooltip_标题文本") });
        const titleInput = panel.createEl("input", { cls: `${PANEL_CLS}-input`, type: "text" });
        titleInput.value = cfg.title;

        // 最大条数
        panel.createDiv({ cls: `${PANEL_CLS}-label`, text: t("备注Tooltip_最大条数") });
        const maxInput = panel.createEl("input", { cls: `${PANEL_CLS}-input`, type: "number" });
        maxInput.min = "1";
        maxInput.max = "50";
        maxInput.value = String(cfg.max);

        // 按钮
        const btns = panel.createDiv({ cls: `${PANEL_CLS}-btns` });
        const closeBtn = btns.createEl("button", { text: t("通用_关闭_文本") });
        closeBtn.addEventListener("click", () => this.closePanel());
        const saveBtn = btns.createEl("button", { cls: "mod-cta", text: t("通用_保存_文本") });
        saveBtn.addEventListener("click", () => {
            void (async () => {
                await this.saveCfg({
                    enabled: enableBox.checked,
                    filter: filterSel.value as NoteTipFilter,
                    groupId: groupSel.value,
                    tagId: tagSel.value,
                    title: titleInput.value.trim() || this.manager.translator.t("备注Tooltip_默认标题"),
                    max: Math.max(1, Math.min(50, Number(maxInput.value) || DEFAULT_NOTE_TIP.max)),
                });
                this.applyLabel();
                this.closePanel();
            })();
        });

        this.panel = panel;
    }

    private closePanel() {
        this.panel?.remove();
        this.panel = null;
    }
}
