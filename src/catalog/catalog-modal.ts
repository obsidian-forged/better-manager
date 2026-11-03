import { FloatingScrollbars } from '../ui/floating-scrollbars';
import { App, ButtonComponent, Modal, Platform, SearchComponent, Setting, setIcon } from "obsidian";
import { createBpmFilterField } from "../ui/filter-field";
import { ScopeSelect } from "../ui/scope-select";
import type Manager from "main";
import { CatalogEntry, CatalogService, compareCatalogVersions, RepositoryDetails, VersionDownloads } from "./catalog";
import { CatalogSourceImportModal } from "./source-import-modal";
import { renderDownloadChart } from "./download-chart";
import { getCatalogService, getCatalogTryList, getRepositoryDocument } from "./obsidian-io";
import { CATALOG_SCENARIOS, discoveryOrder, lowExposure, matchesScenario, relevance } from "./discovery";
import { CatalogTryList, TryDecision } from "./try-list";
import { RepositoryDocument } from './repository-document';
import { renderRepositoryDocument } from './document-renderer';
import { UpdateModal } from '../modal/update-modal';
import { fetchReleaseVersions, installPluginFromGithub, ReleaseVersion } from '../github-install';
import { catalogActivity, matchesStoreFilters } from './store-filters';
import { catalogVersions, installCatalogRelease } from './catalog-installer';
import { readInstalledRelease, sourceIdentity } from '../updates/update-policy';
import { toolEnabled } from '../features';

type CatalogTab = "discover" | "browse" | "try-list" | "sources";

/** 原生控件承载导入与浏览，不在滚动卡片上绑定点击 / Native controls avoid whole-card touch activation. */
export class CatalogModal extends Modal {
    private scrollbars?: FloatingScrollbars;
    private service: CatalogService;
    private tryList: CatalogTryList;
    private tab: CatalogTab = "discover";
    private scenario = "";
    private seed = `${new Date().toISOString().slice(0, 10)}:0`;
    private importModal?: CatalogSourceImportModal;
    private returnScroll = 0;
    private tryListReady = false;
    private noteDrafts = new Map<string, string>();
    private status!: HTMLElement;
    private list!: HTMLElement;
    private detail!: HTMLElement;
    private page = 0;
    private query = "";
    private sourceId = "";
    private sort = "discover";
    private installed = "all";
    private openness = "all";
    private minimumDownloads = '0';
    private recentDays = '0';
    private generation = 0;
    private closed = false;
    private busy = false;
    private selected?: CatalogEntry;
    private repository?: RepositoryDetails;
    private document?: RepositoryDocument;
    private versionModal?: UpdateModal;
    private actionButtons: HTMLButtonElement[] = [];
    private readonly pageSize = 24;
    private filterSelects: ScopeSelect[] = [];

    constructor(app: App, private manager: Manager, private install: (repo: string) => void) {
        super(app);
        this.service = getCatalogService(manager);
        this.tryList = getCatalogTryList(manager);
    }

    private t(key: string, vars?: Record<string, string | number>): string { return this.manager.translator.t(key, vars); }
    private unknown(): string { return this.t("目录_未知"); }
    private formatDate(value?: string | number): string {
        return value === undefined ? this.unknown() : new Date(value).toLocaleString();
    }
    private number(value?: number): string { return value === undefined ? this.unknown() : value.toLocaleString(); }
    private failure(error: unknown): void {
        if (this.closed) return;
        this.status.setText(this.t("目录_失败", { message: error instanceof Error ? error.message : "Unknown error" }));
        this.status.setAttribute("role", "alert");
        if (this.manager.settings.DEBUG) console.error("[BPM] Catalog operation failed", error);
    }

    public onOpen(): void {
        if (!toolEnabled(this.manager.settings, 'catalog')) { this.close(); return; }
        this.scrollbars?.destroy();
        this.scrollbars = new FloatingScrollbars(this.modalEl);
        this.closed = false;
        this.modalEl.addClass("manager-container");
        this.modalEl.toggleClass("manager-container--mobile", Platform.isMobile);
        this.titleEl.setText(this.t("目录_标题"));
        this.status = this.contentEl.createDiv();
        this.status.setAttribute("role", "status");
        this.status.setAttribute("aria-live", "polite");
        this.status.setText(this.t("目录_加载"));
        void this.initialize();
    }

    private async initialize(): Promise<void> {
        try { await this.service.load(); }
        catch (error) { this.failure(error); }
        try { await this.tryList.load(); this.tryListReady = true; }
        catch (error) { this.failure(error); }
        if (!this.closed && this.status.getAttribute('role') !== 'alert' && !this.service.getSources().length) {
            try { await this.refreshSource('official'); } catch (error) { this.failure(error); }
        }
        if (!this.closed && this.status.getAttribute("role") !== "alert") this.status.setText("");
        if (!this.closed) this.render();
    }

    private async run(action: () => Promise<void>, preserveSelection = false): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        this.status.setAttribute("role", "status");
        this.status.setText(this.t("目录_加载"));
        this.actionButtons.forEach(button => { button.disabled = true; });
        try {
            await action();
            if (!this.closed) {
                if (!preserveSelection) {
                    this.selected = undefined;
                    this.repository = undefined;
                    this.generation++;
                }
                this.status.setText("");
            }
        } catch (error) { this.failure(error); }
        finally {
            this.busy = false;
            if (!this.closed) this.render();
        }
    }

    private action(container: HTMLElement, label: string, action: () => Promise<void>): ButtonComponent {
        const button = new ButtonComponent(container).setButtonText(label).onClick(() => { void this.run(action); });
        button.setDisabled(this.busy);
        this.actionButtons.push(button.buttonEl);
        return button;
    }

    /** 目录刷新属于在线下载，登记到设置页任务中心 / Track catalog refresh as an online task. */
    private async refreshSource(id: string): Promise<void> {
        const name = this.service.getSources().find(source => source.id === id)?.name
            || (id === "official" ? this.t("目录_官方") : id);
        const task = this.manager.tasks.start({ title: this.t("任务_下载目录", { name }), progress: 0.04 });
        try {
            await this.service.refresh(id, progress => task.update({ progress: 0.04 + progress * 0.96 }));
            task.done();
        } catch (error) {
            task.fail();
            throw error;
        }
    }

    private render(): void {
        this.filterSelects.forEach(select => select.close());
        this.filterSelects = [];
        const message = this.status.textContent || "";
        const role = this.status.getAttribute("role") || "status";
        this.contentEl.empty();
        this.actionButtons = [];
        const workspace = this.contentEl.createDiv("manager-repo-page");
        const hero = workspace.createDiv("manager-repo-page__header");
        const titleBlock = hero.createDiv("manager-repo-page__title-block");
        setIcon(titleBlock.createSpan({ cls: "manager-repo-page__icon" }), "compass");
        const title = titleBlock.createDiv("manager-repo-page__title-text");
        title.createDiv({ cls: "manager-repo-page__title", text: this.t("目录_发现标题") });
        title.createDiv({ cls: "manager-repo-page__desc", text: this.t("目录_发现说明") });
        const stats = hero.createDiv("manager-repo-page__stats");
        for (const [key, value] of [["目录_全部插件", this.service.entries().length], ["目录_来源", this.service.getSources().length], ["目录_待试", this.tryList.all().filter(item => item.decision === "planned").length]] as const) {
            const chip = stats.createSpan({ cls: "manager-repo-page__stat" });
            chip.createSpan({ text: this.t(key) });
            chip.createSpan({ cls: "manager-repo-page__stat-value", text: value.toLocaleString() });
        }
        const navigation = workspace.createDiv("manager-repo-page__switcher");
        navigation.setAttribute("role", "tablist");
        navigation.setAttribute("aria-label", this.t("目录_标题"));
        const tabs: [CatalogTab, string, string][] = [["discover", "目录_发现", "compass"], ["browse", "目录_全部插件", "blocks"], ["try-list", "目录_试用清单", "clipboard-list"], ["sources", "目录_来源", "radio-tower"]];
        const buttons: HTMLButtonElement[] = [];
        for (const [tab, key, icon] of tabs) {
            const button = navigation.createEl("button", { cls: "manager-repo-page__switch", attr: { type: "button", role: "tab", id: `bpm-catalog-tab-${tab}`, "aria-controls": "bpm-catalog-panel", "aria-selected": `${this.tab === tab}` } });
            button.toggleClass("is-active", this.tab === tab);
            button.tabIndex = this.tab === tab ? 0 : -1;
            setIcon(button.createSpan({ cls: "manager-repo-page__switch-icon" }), icon);
            button.createSpan({ cls: "manager-repo-page__switch-label", text: this.t(key) });
            button.addEventListener("click", () => this.switchTab(tab));
            buttons.push(button);
        }
        navigation.addEventListener("keydown", event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            if (!(event.target instanceof HTMLButtonElement)) return;
            const index = buttons.indexOf(event.target);
            if (index < 0) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
            this.switchTab(tabs[next][0]);
            this.contentEl.querySelector<HTMLButtonElement>(`#bpm-catalog-tab-${tabs[next][0]}`)?.focus();
        });
        this.status = workspace.createDiv({ text: message });
        this.status.setAttribute("role", role);
        this.status.setAttribute("aria-live", "polite");
        const panel = workspace.createDiv("manager-repo-page__body");
        panel.id = "bpm-catalog-panel";
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", `bpm-catalog-tab-${this.tab}`);
        if (this.tab === "sources") { this.renderSources(panel); return; }
        if (this.selected) {
            new ButtonComponent(panel).setButtonText(this.t("目录_返回列表")).onClick(() => {
                this.selected = undefined;
                this.repository = undefined;
                this.generation++;
                this.render();
                this.contentEl.scrollTop = this.returnScroll;
            });
            this.detail = panel.createDiv("manager-source-page");
            this.renderDetail(this.selected);
            return;
        }
        if (this.tab === "try-list") { this.renderTryList(panel); return; }
        this.renderFilters(panel);
        this.list = panel.createDiv("manager-source-page__list");
        this.renderList();
    }

    private switchTab(tab: CatalogTab): void {
        this.tab = tab;
        this.selected = undefined;
        this.repository = undefined;
        this.generation++;
        this.page = 0;
        this.render();
    }

    private renderSources(container: HTMLElement): void {
        const header = this.sectionHeader(container, this.t("目录_来源"), this.t("目录_说明"));
        const sources = container.createDiv("manager-source-page");
        new ButtonComponent(header).setButtonText(this.t("目录_添加源")).setCta().setDisabled(this.busy).onClick(() => {
            this.importModal?.close();
            this.importModal = new CatalogSourceImportModal(this.app, this.manager, this.service, () => { if (!this.closed) this.render(); });
            this.importModal.open();
        });
        this.action(header, this.t("目录_官方"), () => this.refreshSource("official"));
        if (!this.service.getSources().length) sources.createDiv({ cls: "bpm-empty-state", text: this.t("目录_暂无来源") });
        for (const source of this.service.getSources()) {
            const card = sources.createDiv("manager-source-card");
            const actions = this.sectionHeader(card, source.name, this.t("目录_预览数量", { count: source.plugins.length }));
            if (source.url) this.action(actions, this.t("目录_刷新"), () => this.refreshSource(source.id));
            this.action(actions, this.t("目录_删除"), async () => {
                await this.service.remove(source.id);
                if (this.sourceId === source.id) this.sourceId = "";
            });
            const tags = card.createDiv("manager-plugin-card__tags");
            for (const key of [source.official ? "目录_官方源" : "目录_独立源", source.url ? "目录_远程源" : "目录_本地源"]) {
                tags.createSpan({ cls: "manager-tag manager-theme-card__chip", text: this.t(key) });
            }
            card.createDiv({ cls: "manager-plugin-card__desc", text: source.url || this.t("目录_本地说明") });
            card.createDiv({ cls: "setting-item-description", text: `${this.t("目录_获取时间")}: ${this.formatDate(source.fetchedAt)}` });
            if (source.warning) card.createDiv({ cls: "mod-warning", text: source.warning });
        }
    }

    private renderFilters(container: HTMLElement): void {
        const section = container.createDiv("manager-section manager-section--filters manager-catalog-filters");
        const content = section.createDiv("manager-section__content manager-section__content--filters");
        const bar = new Setting(content).setClass("manager-bar__search").setName("");
        const searchLine = bar.controlEl.createDiv("manager-search-line");
        const search = new SearchComponent(createBpmFilterField(searchLine, this.t("通用_搜索_文本"), "search", "search"))
            .setPlaceholder(this.t("目录_搜索")).setValue(this.query);
        search.inputEl.setAttribute("aria-label", this.t("目录_搜索"));
        search.onChange(value => { this.query = value; this.page = 0; this.renderList(); });
        const filters = bar.controlEl.createDiv("manager-filter-control-group");
        const sort = new ScopeSelect(filters, this.t("目录_排序"), "arrow-up-down", this.sort,
            [["discover", "目录_探索排序"], ["downloads", "目录_下载量"], ["name", "目录_名称"], ["updated", "目录_维护"]]
                .map(([value, key]) => ({ value, label: this.t(key) })),
            value => { this.sort = value; this.page = 0; this.renderList(); });
        sort.field.addClass("manager-filter-field--sort");
        this.filterSelects.push(sort,
            new ScopeSelect(filters, this.t("目录_来源"), "radio-tower", this.sourceId,
                [{ value: "", label: this.t("目录_全部来源") }, ...this.service.getSources().map(source => ({ value: source.id, label: source.name }))],
                value => { this.sourceId = value; this.page = 0; this.renderList(); }),
            new ScopeSelect(filters, this.t("通用_状态_文本"), "list-filter", this.installed,
                [["all", "目录_全部"], ["installed", "目录_已安装"], ["missing", "目录_未安装"]].map(([value, key]) => ({ value, label: this.t(key) })),
                value => { this.installed = value; this.page = 0; this.renderList(); }),
            new ScopeSelect(filters, this.t("目录_开闭源简写"), "code", this.openness,
                [["all", "目录_全部"], ["open-source", "目录_开源"], ["closed-source", "目录_闭源"], ["unknown", "目录_未知"]]
                    .map(([value, key]) => ({ value, label: this.t(key) })),
                value => { this.openness = value; this.page = 0; this.renderList(); }),
            new ScopeSelect(filters, this.t('目录_最低下载量'), 'download', this.minimumDownloads,
                [0, 100, 1000, 10000].map(value => ({ value: `${value}`, label: value ? `≥ ${value.toLocaleString()}` : this.t('目录_全部') })),
                value => { this.minimumDownloads = value; this.page = 0; this.renderList(); }),
            new ScopeSelect(filters, this.t('目录_近期维护'), 'calendar-clock', this.recentDays,
                [0, 30, 180, 365].map(value => ({ value: `${value}`, label: value ? this.t('目录_天内', { days: value }) : this.t('目录_全部') })),
                value => { this.recentDays = value; this.page = 0; this.renderList(); }));
        bar.settingEl.createDiv({ cls: 'setting-item-description', text: this.t('目录_维护筛选说明') });
    }

    private renderList(): void {
        this.actionButtons = this.actionButtons.filter(button => button.isConnected);
        this.list.empty();
        const entries = this.service.entries().filter(entry => {
            const installed = Boolean(this.manager.appPlugins.manifests[entry.id]);
            return (!this.sourceId || entry.source.id === this.sourceId)
                && (this.openness === "all" || entry.openness === this.openness)
                && matchesScenario(entry, this.scenario)
                && matchesStoreFilters(entry, Number(this.minimumDownloads), Number(this.recentDays))
                && (this.installed === "all" || (this.installed === "installed" ? installed : !installed))
                && relevance(entry, this.query) >= 0;
        });
        if (this.tab === "discover" && !this.query.trim() && this.sort === "discover") { this.renderDiscover(entries); return; }
        const ordered = this.sort === "discover" && !this.query.trim() ? discoveryOrder(entries, this.seed) : entries.sort((a, b) => {
            const number = this.sort === "downloads" ? (b.stats?.downloads ?? -1) - (a.stats?.downloads ?? -1)
                : this.sort === "updated" ? (catalogActivity(b) ?? -1) - (catalogActivity(a) ?? -1)
                : this.sort === "discover" ? relevance(b, this.query) - relevance(a, this.query) : 0;
            return number || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
        });
        const pages = Math.max(1, Math.ceil(entries.length / this.pageSize));
        this.page = Math.min(this.page, pages - 1);
        const navigation = new Setting(this.list).setName(this.t("目录_数量", { count: entries.length, page: this.page + 1, pages }));
        new ButtonComponent(navigation.controlEl).setButtonText(this.t("目录_上一页")).setDisabled(this.page === 0)
            .onClick(() => { this.page--; this.renderList(); });
        new ButtonComponent(navigation.controlEl).setButtonText(this.t("目录_下一页")).setDisabled(this.page >= pages - 1)
            .onClick(() => { this.page++; this.renderList(); });
        if (!entries.length) this.emptyState(this.list);
        const grid = this.list.createDiv("manager-transfer-grid");
        for (const entry of ordered.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize)) this.card(grid, entry);
    }

    private emptyState(container: HTMLElement): void {
        const empty = container.createDiv("bpm-empty-state");
        setIcon(empty.createSpan(), "compass");
        empty.createEl("p", { text: this.t("目录_空") });
        new ButtonComponent(empty).setButtonText(this.t("目录_管理插件源")).onClick(() => this.switchTab("sources"));
        if (this.scenario) new ButtonComponent(empty).setButtonText(this.t("目录_清除场景")).onClick(() => { this.scenario = ""; this.renderList(); });
    }

    private renderDiscover(entries: CatalogEntry[]): void {
        const scenarios = this.list.createDiv("manager-source-card");
        const controls = this.sectionHeader(scenarios, this.t("目录_按场景发现"), this.t("目录_场景说明"));
        const choices = scenarios.createDiv("manager-plugin-card__tags");
        choices.setAttribute("role", "group");
        choices.setAttribute("aria-label", this.t("目录_适用场景"));
        const all = new ButtonComponent(choices).setButtonText(this.t("目录_全部")).onClick(() => { this.scenario = ""; this.renderList(); });
        all.buttonEl.setAttribute("aria-pressed", `${!this.scenario}`);
        all.buttonEl.toggleClass("mod-cta", !this.scenario);
        for (const scenario of CATALOG_SCENARIOS) {
            const button = new ButtonComponent(choices).setButtonText(this.t(scenario.key))
                .onClick(() => { this.scenario = this.scenario === scenario.id ? "" : scenario.id; this.renderList(); });
            button.buttonEl.setAttribute("aria-pressed", `${this.scenario === scenario.id}`);
            button.buttonEl.toggleClass("mod-cta", this.scenario === scenario.id);
        }
        new ButtonComponent(controls).setButtonText(this.t("目录_换一批")).onClick(() => {
            this.seed = `${Date.now()}`;
            this.renderList();
        });
        new ButtonComponent(controls).setButtonText(this.t("目录_查看全部")).onClick(() => this.switchTab("browse"));
        const candidates = entries.filter(entry => this.installed === "installed" || !this.manager.appPlugins.manifests[entry.id]);
        const used = new Set<string>();
        const grid = this.list.createDiv("manager-transfer-grid");
        const lane = (title: string, explanation: string, pool: CatalogEntry[]) => {
            const chosen = discoveryOrder(pool.filter(entry => !used.has(entry.key)), this.seed).slice(0, 4);
            if (!chosen.length) return;
            for (const entry of chosen) { used.add(entry.key); this.card(grid, entry, { label: this.t(title), explanation: this.t(explanation) }); }
        };
        lane("目录_小众工具", "目录_小众说明", lowExposure(candidates));
        lane("目录_容易上手", "目录_上手说明", candidates.filter(entry => entry.quickStart.length > 0));
        lane("目录_继续探索", "目录_探索说明", candidates);
        if (!used.size) this.emptyState(this.list);
    }

    private showEntry(entry: CatalogEntry): void {
        this.returnScroll = this.contentEl.scrollTop;
        this.generation++;
        this.selected = entry;
        this.repository = undefined;
        this.document = undefined;
        this.render();
        this.contentEl.scrollTop = 0;
    }

    private card(container: HTMLElement, entry: CatalogEntry, discovery?: { label: string; explanation: string }): void {
        const card = container.createDiv("manager-source-card manager-catalog-card");
        card.setAttribute("data-plugin-key", entry.key);
        const main = card.createDiv("manager-source-card__main");
        const header = main.createDiv("manager-source-card__header");
        const title = header.createDiv("manager-source-card__title-block");
        const name = title.createDiv("manager-source-card__repo-line");
        setIcon(name.createSpan({ cls: "manager-source-card__repo-icon" }), "blocks");
        const identity = name.createDiv("manager-catalog-card__identity");
        identity.createSpan({ cls: "manager-source-card__repo manager-catalog-card__name", text: entry.name, attr: { title: entry.name } });
        const metadata = [entry.author || entry.publisher, entry.version].filter(Boolean).join(" · ");
        identity.createSpan({ cls: "manager-catalog-card__meta", text: metadata, attr: { title: metadata } });
        const downloads = main.createDiv("manager-plugin-card__date-meta");
        const downloadCount = this.number(entry.stats?.downloads);
        const metric = downloads.createSpan({ cls: "manager-plugin-card__date-meta-item", attr: {
            "aria-label": `${this.t("目录_下载量")}: ${downloadCount}`, title: `${this.t("目录_下载量")}: ${downloadCount}`,
        } });
        const downloadIcon = metric.createSpan({ cls: "manager-plugin-card__date-meta-icon", attr: { "aria-hidden": "true" } });
        setIcon(downloadIcon, "cloud-download");
        metric.createSpan({ text: downloadCount });
        main.createDiv({ cls: "manager-plugin-card__desc", text: entry.description || this.t("目录_缺少描述") });
        if (entry.useCases.length) main.createDiv({ cls: "manager-plugin-card__desc", text: `${this.t("目录_适用场景")}: ${entry.useCases.slice(0, 2).join(" · ")}` });
        if (entry.quickStart.length) main.createDiv({ cls: "setting-item-description", text: this.t("目录_提供步骤", { count: entry.quickStart.length }) });
        const installed = this.manager.appPlugins.manifests[entry.id];
        if (installed) main.createDiv({ cls: "setting-item-description", text: `${this.t("目录_已安装")} · ${installed.version}` });
        // 底部标签区，分类依据与源声明保留在提示中 / Bottom tags retain category provenance in tooltips.
        const badges = card.createDiv("manager-plugin-card__tags manager-catalog-card__tags");
        const provenance = badges.createSpan({ cls: "manager-tag manager-theme-card__chip is-source", text: `${this.t("目录_来源")}: ${entry.source.name}` });
        provenance.setAttribute("title", entry.source.url || entry.source.name);
        badges.createSpan({ cls: "manager-tag manager-theme-card__chip", text: this.opennessLabel(entry), attr: { title: this.t("目录_开闭源说明") } });
        for (const scenario of CATALOG_SCENARIOS.filter(scenario => matchesScenario(entry, scenario.id)).slice(0, 2)) {
            badges.createSpan({ cls: "manager-tag manager-theme-card__chip", text: this.t(scenario.key), attr: { title: this.t("目录_场景说明") } });
        }
        for (const label of [...new Set([...(entry.isDesktopOnly === true ? [this.t("目录_桌面")] : []), ...entry.tags.slice(0, 3), ...entry.features.slice(0, 3)])]) {
            badges.createSpan({ cls: "manager-tag manager-theme-card__chip", text: label });
        }
        if (discovery) badges.createSpan({ cls: "manager-tag manager-theme-card__chip", text: discovery.label, attr: { title: discovery.explanation } });
        const actions = header.createDiv("manager-source-page__actions manager-catalog-card__actions");
        const detail = new ButtonComponent(actions).setIcon("info").setTooltip(this.t("目录_详情")).onClick(() => this.showEntry(entry));
        detail.buttonEl.setAttribute("aria-label", this.t("目录_详情"));
        this.tryButton(actions, entry);
        this.installButton(actions, entry);
    }

    private installButton(container: HTMLElement, entry: CatalogEntry, showLabel = false): void {
        const available = Boolean(entry.repo || entry.releases.some(release => release.manifest && release.main));
        const label = this.t(available ? (this.manager.appPlugins.manifests[entry.id] ? '目录_管理版本' : '目录_选择安装版本') : '目录_安装不支持');
        const button = new ButtonComponent(container).setIcon("download").setTooltip(label)
            .setDisabled(this.busy || !available);
        if (showLabel) button.setButtonText(label);
        button.buttonEl.setAttribute("aria-label", label);
        button.onClick(() => this.openVersions(entry));
        this.actionButtons.push(button.buttonEl);
    }

    private openVersions(entry: CatalogEntry): void {
        const independent = entry.releases.some(release => release.manifest && release.main);
        if (!independent && !entry.repo) return;
        const origin = independent ? { kind: 'catalog' as const, key: entry.key, sourceId: entry.source.id, pluginId: entry.id, url: entry.source.url }
            : { kind: 'github' as const, repo: entry.repo };
        const identity = sourceIdentity(origin);
        const installed = Boolean(this.manager.appPlugins.manifests[entry.id]);
        const stored = readInstalledRelease(this.manager.settings.PLUGIN_INSTALLATIONS?.[entry.id]);
        const sameSource = stored ? sourceIdentity(stored.source) === identity
            : !independent && this.manager.settings.REPO_MAP[entry.id]?.toLowerCase() === entry.repo.toLowerCase();
        const originalBinding = JSON.stringify(stored?.source);
        const guard = () => {
            this.manager.updates.assertAllowed(entry.id, identity, selectedVersion);
            if (JSON.stringify(readInstalledRelease(this.manager.settings.PLUGIN_INSTALLATIONS?.[entry.id])?.source) !== originalBinding) throw new Error(this.t('批量更新_清单变化'));
            const current = this.service.entries().find(item => item.key === entry.key);
            if (!current || current.source.url !== entry.source.url) throw new Error(this.t('目录_来源冲突'));
        };
        let versions: ReleaseVersion[] = [];
        let selectedVersion = '';
        this.versionModal?.close();
        this.versionModal = new UpdateModal(this.app, this.manager, entry.id, [], undefined, independent ? undefined : entry.repo, async version => {
            selectedVersion = version;
            guard();
            const release = entry.releases.find(release => release.version === version);
            const manifestVersion = versions.find(release => release.version === version)?.manifestVersion;
            const ok = independent && release ? await installCatalogRelease(this.manager, entry, release, { guard, expectedManifestVersion: manifestVersion })
                : await installPluginFromGithub(this.manager, entry.repo, version, !installed, entry.id, { guard, expectedManifestVersion: manifestVersion });
            if (ok && !this.closed) this.render();
            return ok;
        }, { sourceIdentity: identity, displayName: entry.name, sourceConfirmation: installed && !sameSource ? this.t('目录_替换来源说明', { source: entry.source.name }) : undefined,
            loadVersions: async () => { versions = independent ? await catalogVersions(this.manager, entry) : await fetchReleaseVersions(this.manager, entry.repo, { includeManifest: true }); return versions; } });
        this.versionModal.open();
    }

    private tryButton(container: HTMLElement, entry: CatalogEntry): void {
        const exists = this.tryList.has(entry.key);
        const label = this.t(exists ? "目录_已加入待试" : "目录_加入待试");
        const button = new ButtonComponent(container).setIcon(exists ? "bookmark-check" : "bookmark-plus").setTooltip(label);
        button.buttonEl.setAttribute("aria-label", label);
        button.buttonEl.setAttribute("aria-pressed", `${exists}`);
        button.setDisabled(exists || this.busy || !this.tryListReady);
        button.onClick(() => { void this.run(() => this.tryList.add(entry), true); });
        this.actionButtons.push(button.buttonEl);
    }

    private renderTryList(container: HTMLElement): void {
        const header = this.sectionHeader(container, this.t("目录_试用清单"), this.t("目录_清单说明"));
        const explanation = container.createDiv("manager-source-card");
        explanation.createDiv({ cls: "manager-plugin-card__desc", text: this.t("目录_试用边界") });
        new ButtonComponent(header).setButtonText(this.t("目录_安全试用未接入")).setDisabled(true).setTooltip(this.t("目录_试用边界"));
        if (!this.tryListReady) { container.createEl("p", { cls: "mod-warning", text: this.t("目录_清单不可用") }); return; }
        if (!this.tryList.all().length) {
            container.createEl("p", { text: this.t("目录_清单为空") });
            new ButtonComponent(header).setButtonText(this.t("目录_去发现")).onClick(() => this.switchTab("discover"));
        }
        const entries = new Map(this.service.entries().map(entry => [entry.key, entry]));
        for (const item of this.tryList.all()) {
            const card = container.createDiv("manager-source-card");
            const entry = entries.get(item.key);
            const actions = this.sectionHeader(card, item.name, `${item.sourceName} · ${this.formatDate(item.addedAt)}`);
            new Setting(card).setName(this.t("目录_体验决定")).addDropdown(dropdown => dropdown
                .addOption("planned", this.t("目录_待试")).addOption("keep", this.t("目录_记录保留")).addOption("pass", this.t("目录_记录跳过"))
                .setValue(item.decision).onChange(value => {
                    if (value !== "planned" && value !== "keep" && value !== "pass") return;
                    const decision: TryDecision = value;
                    void this.run(() => this.tryList.update(item.key, { decision }));
                }));
            const note = card.createEl("textarea");
            note.rows = 3;
            note.value = this.noteDrafts.get(item.key) ?? item.note;
            note.setAttribute("aria-label", `${item.name} · ${this.t("目录_体验笔记")}`);
            note.placeholder = this.t("目录_笔记占位");
            note.addEventListener("input", () => { this.noteDrafts.set(item.key, note.value); });
            this.action(actions, this.t("目录_保存笔记"), async () => {
                await this.tryList.update(item.key, { note: this.noteDrafts.get(item.key) ?? item.note });
                this.noteDrafts.delete(item.key);
            });
            if (entry) new ButtonComponent(actions).setButtonText(this.t("目录_详情")).onClick(() => this.showEntry(entry));
            else { card.createEl("p", { text: this.t("目录_源已移除") }); this.link(card, this.t("目录_仓库"), item.repositoryUrl); }
            this.action(actions, this.t("目录_移出清单"), async () => { await this.tryList.remove(item.key); this.noteDrafts.delete(item.key); });
        }
    }

    private field(container: HTMLElement, key: string, value?: string): void {
        new Setting(container).setName(this.t(key)).setDesc(value || this.unknown());
    }
    /** 共用标题操作行，保持按钮与标题同行 / Shared heading actions keep controls beside the title. */
    private sectionHeader(container: HTMLElement, title: string, description?: string): HTMLElement {
        const row = new Setting(container).setName(title).setHeading();
        if (description) row.setDesc(description);
        return row.controlEl;
    }
    private opennessLabel(entry: CatalogEntry): string {
        return entry.openness === "open-source" ? this.t("目录_开源") : entry.openness === "closed-source" ? this.t("目录_闭源") : this.unknown();
    }
    private link(container: HTMLElement, label: string, url?: string): void {
        if (!url) return;
        container.createEl("a", { text: label, href: url, attr: { target: "_blank", rel: "noopener noreferrer" } });
        container.createEl("br");
    }

    private renderDetail(entry: CatalogEntry): void {
        this.detail.empty();
        this.actionButtons = this.actionButtons.filter(button => button.isConnected);
        const overview = this.detail.createDiv("manager-source-card");
        const primary = this.sectionHeader(overview, entry.name, `${entry.author || entry.publisher || this.unknown()} · ${entry.source.name}`);
        overview.createEl("p", { text: entry.description || this.t("目录_缺少描述") });
        if (entry.useCases.length) {
            const cases = overview.createEl("ul", { attr: { "aria-label": this.t("目录_适用场景") } });
            for (const useCase of entry.useCases) cases.createEl("li", { text: useCase });
        }
        this.tryButton(primary, entry);
        this.installButton(primary, entry, true);
        const installed = this.manager.appPlugins.manifests[entry.id];
        if (this.manager.history.available && installed && entry.id !== this.manager.manifest.id) new ButtonComponent(primary).setButtonText(this.t('回退_标题'))
            .onClick(() => { void this.manager.openPluginHistory(entry.id); });
        this.field(overview, installed ? '目录_已安装版本' : '目录_未安装', installed?.version || this.t('目录_未安装'));
        this.renderStarterMaterial(entry);
        const facts = this.detail.createEl("details", { cls: "manager-source-card" });
        facts.createEl("summary", { text: this.t("目录_来源与兼容性") });
        this.renderFacts(entry, facts);
        const installation = this.detail.createDiv("manager-source-card");
        const installationActions = this.sectionHeader(installation, this.t("目录_安装"), this.t("目录_历史版本提示"));
        if (entry.repo) {
            new ButtonComponent(installationActions).setButtonText(this.t("目录_手动安装")).onClick(() => { this.close(); this.install(entry.repo); });
            const load = new ButtonComponent(installationActions).setButtonText(this.t("目录_获取仓库"));
            load.onClick(() => {
                load.setDisabled(true);
                const generation = ++this.generation;
                void this.service.repository(entry.repo).then(details => {
                    if (this.closed || generation !== this.generation) return;
                    this.repository = details;
                    this.renderDetail(entry);
                }).catch(error => { if (!this.closed && generation === this.generation) this.failure(error); })
                    .finally(() => { if (!this.closed && generation === this.generation) load.setDisabled(false); });
            });
        }
        this.renderReadme(entry);
        this.renderStatistics(entry);
        this.renderReleaseHistory(entry);
    }

    private renderReadme(entry: CatalogEntry): void {
        const section = this.detail.createDiv('manager-source-card');
        const actions = this.sectionHeader(section, 'README', this.t('目录_文档说明'));
        if (!entry.repo) { section.createEl('p', { text: this.t('目录_文档不可用') }); return; }
        this.link(section, this.t('目录_问题链接'), `https://github.com/${entry.repo}/issues`);
        if (this.document) renderRepositoryDocument(section.createDiv(), this.document);
        else {
            const load = new ButtonComponent(actions).setButtonText(this.t('目录_加载文档'));
            const feedback = section.createDiv({ attr: { role: 'status' } });
            load.onClick(() => {
                load.setDisabled(true);
                feedback.setText(this.t('目录_加载'));
                const generation = this.generation;
                void getRepositoryDocument(this.manager, entry.repo).then(document => {
                    if (this.closed || generation !== this.generation || this.selected?.key !== entry.key) return;
                    this.document = document;
                    this.renderDetail(entry);
                }).catch(error => {
                    if (!this.closed && generation === this.generation && feedback.isConnected) {
                        feedback.setText(this.t('目录_失败', { message: error instanceof Error ? error.message : this.unknown() }));
                        load.setDisabled(false);
                    }
                });
            });
        }
    }

    private renderStarterMaterial(entry: CatalogEntry): void {
        const material = this.detail.createDiv("manager-source-card");
        new Setting(material).setName(this.t("目录_上手体验")).setHeading();
        if (entry.quickStart.length) {
            const steps = material.createEl("ol");
            for (const step of entry.quickStart) steps.createEl("li", { text: step });
        } else material.createEl("p", { cls: "setting-item-description", text: this.t("目录_暂无上手材料") });
        this.link(material, this.t("目录_观看演示"), entry.demoUrl);
        for (const screenshot of entry.screenshots) {
            const figure = material.createEl("figure", { cls: "markdown-rendered" });
            const load = new ButtonComponent(figure).setButtonText(screenshot.caption || this.t("目录_加载截图"));
            const feedback = figure.createEl("span", { attr: { role: "status" } });
            if (screenshot.caption) figure.createEl("figcaption", { text: screenshot.caption });
            load.setTooltip(this.t("目录_截图说明"));
            load.onClick(() => {
                load.setDisabled(true);
                feedback.setText("");
                const image = figure.createEl("img", { attr: { alt: screenshot.caption || entry.name, loading: "lazy", referrerpolicy: "no-referrer" } });
                image.addEventListener("error", () => {
                    image.remove();
                    feedback.setText(this.t("目录_截图失败"));
                    load.setDisabled(false);
                }, { once: true });
                image.src = screenshot.url;
            });
        }
    }

    private renderReleaseHistory(entry: CatalogEntry): void {
        const repository = this.repository;
        if (!repository?.releases.length) return;
        const history = this.detail.createEl('details', { cls: 'manager-source-card' });
        history.createEl('summary', { text: this.t('目录_GitHub发布记录') });
        const actions = this.sectionHeader(history.createDiv(), this.t('目录_发布记录'));
        this.installButton(actions, entry, true);
        for (const release of repository.releases) {
            const item = history.createEl('details');
            item.createEl('summary', { text: `${release.tag} · ${this.formatDate(release.publishedAt)}${release.prerelease ? ` · ${this.t('目录_预发布')}` : ''}` });
            const pageUrl = `https://github.com/${entry.repo}/releases/tag/${encodeURIComponent(release.tag)}`;
            this.link(item, this.t('目录_仓库'), pageUrl);
            if (release.notes) item.addEventListener('toggle', () => {
                if (!item.open || item.dataset.rendered) return;
                item.dataset.rendered = 'true';
                renderRepositoryDocument(item.createDiv(), { markdown: release.notes || '', pageUrl,
                    imageUrl: `https://raw.githubusercontent.com/${entry.repo}/HEAD/README.md`, fetchedAt: repository.fetchedAt });
            });
        }
    }

    private renderFacts(entry: CatalogEntry, facts: HTMLElement): void {
        this.field(facts, "目录_来源", `${entry.source.name} · ${this.formatDate(entry.source.fetchedAt)}`);
        this.field(facts, "目录_导入地址", entry.source.url || entry.source.name);
        this.field(facts, "目录_发布者", entry.publisher || entry.author);
        this.field(facts, "目录_开闭源", this.opennessLabel(entry));
        facts.createEl("p", { text: this.t("目录_开闭源说明") });
        this.field(facts, "目录_仓库", entry.repositoryUrl);
        this.field(facts, "目录_版本", entry.version);
        this.field(facts, "目录_最低版本", entry.minAppVersion);
        this.field(facts, "目录_桌面", entry.isDesktopOnly === undefined ? undefined : this.t(entry.isDesktopOnly ? "目录_是" : "目录_否"));
        this.field(facts, "目录_许可证", entry.license);
        this.field(facts, "目录_维护", entry.lastMaintainedAt ? this.formatDate(entry.lastMaintainedAt) : undefined);
        this.link(facts, this.t("目录_仓库"), entry.repositoryUrl);
        this.link(facts, this.t("目录_主页"), entry.homepage);
        this.link(facts, this.t("目录_原始来源"), entry.originUrl);
        if (this.service.entries().some(item => item.id === entry.id && item.key !== entry.key)) {
            facts.createEl("p", { cls: "mod-warning", text: this.t("目录_同ID") });
        }
        if (entry.source.warning) facts.createEl("p", { cls: "mod-warning", text: entry.source.warning });
        if (!entry.source.official) facts.createEl("p", { text: this.t("目录_独立说明") });
    }

    private renderStatistics(entry: CatalogEntry): void {
        const statistics = this.detail.createEl("details", { cls: "manager-source-card" });
        const repository = this.repository;
        statistics.createEl("summary", { text: this.t("目录_统计与维护") });
        if (repository?.archived) this.detail.createEl('p', { cls: 'mod-warning', text: this.t('目录_已归档提示') });
        if (repository?.pushedAt && Date.now() - Date.parse(repository.pushedAt) > 365 * 86400000) {
            this.detail.createEl('p', { cls: 'setting-item-description', text: this.t('目录_维护提示') });
        }
        // 统计折叠呈现；打开时才构建图表和数据表 / Build charts and tables only when the user opens statistics.
        statistics.addEventListener("toggle", () => {
            if (!statistics.open || statistics.dataset.rendered) return;
            statistics.dataset.rendered = "true";
            this.populateStatistics(entry, statistics, repository);
        });
        if (entry.releases.length) {
            const history = this.detail.createEl("details", { cls: "manager-source-card" });
            history.createEl("summary", { text: this.t("目录_发布记录") });
            for (const release of entry.releases) {
                const item = history.createEl("details");
                item.createEl("summary", { text: `${release.version} · ${this.formatDate(release.publishedAt)}${release.prerelease ? ` · ${this.t("目录_预发布")}` : ""}` });
                if (release.notes) item.createEl("p", { text: release.notes });
                this.link(item, "manifest.json", release.manifest);
                this.link(item, "main.js", release.main);
                this.link(item, "styles.css", release.styles);
            }
        }
    }

    private populateStatistics(entry: CatalogEntry, container: HTMLElement, repository?: RepositoryDetails): void {
        this.field(container, "目录_下载量", this.number(entry.stats?.downloads));
        this.field(container, "目录_统计更新", entry.stats?.updated ? this.formatDate(entry.stats.updated) : undefined);
        if (repository) {
            this.field(container, "Stars", this.number(repository.stars));
            this.field(container, "Forks", this.number(repository.forks));
            this.field(container, "目录_问题", this.number(repository.openIssuesAndPullRequests));
            this.field(container, "目录_仓库推送", this.formatDate(repository.pushedAt));
            this.field(container, "目录_最近发布", this.formatDate(repository.latestPublishedAt));
            this.field(container, "目录_创建", this.formatDate(repository.createdAt));
            this.field(container, "目录_许可证", repository.license);
            this.field(container, "目录_归档", repository.archived === undefined ? undefined : this.t(repository.archived ? "目录_是" : "目录_否"));
            this.field(container, "目录_获取时间", this.formatDate(repository.fetchedAt));
            if (repository.topics.length) container.createEl("p", { text: repository.topics.join(", ") });
            for (const warning of repository.warnings) container.createEl("p", { cls: "mod-warning", text: warning });
            if (repository.releasesTruncated) container.createEl("p", { cls: "mod-warning", text: this.t("目录_截断") });
        }
        const sourcePoints = entry.stats?.versions.length ? entry.stats.versions : entry.releases.flatMap(release => release.downloads === undefined ? [] : [{ version: release.version, downloads: release.downloads }]);
        const githubPoints = repository?.releases.flatMap(release => release.downloads === undefined ? [] : [{ version: release.tag, downloads: release.downloads }]) || [];
        this.chart(container, sourcePoints, this.t(entry.source.official ? "目录_官方统计" : "目录_来源统计"));
        // 分开展示不同统计口径，绝不相加 / Keep provider metrics separate, never add them together.
        if (repository && githubPoints.length) this.chart(container, githubPoints, this.t("目录_GitHub统计"));
    }

    private chart(container: HTMLElement, input: VersionDownloads[], provider: string): void {
        new Setting(container).setName(this.t("目录_图表")).setDesc(provider).setHeading();
        if (!input.length) { container.createEl("p", { text: this.unknown() }); return; }
        const points = [...input].sort((a, b) => compareCatalogVersions(a.version, b.version));
        container.createEl("p", { text: this.t("目录_图表说明") });
        renderDownloadChart(container, points, `${this.t("目录_图表")} · ${provider}`);
        const details = container.createEl("details");
        details.createEl("summary", { text: this.t("目录_表格") });
        // 文本表格让键盘与触屏用户同样可以读取每个点 / Tables expose every value without hover or gestures.
        const table = details.createEl("table");
        const header = table.createEl("thead").createEl("tr");
        header.createEl("th", { text: this.t("目录_版本"), attr: { scope: "col" } });
        header.createEl("th", { text: this.t("目录_下载量"), attr: { scope: "col" } });
        const body = table.createEl("tbody");
        for (const point of points) {
            const row = body.createEl("tr");
            row.createEl("td", { text: point.version });
            row.createEl("td", { text: point.downloads.toLocaleString() });
        }
    }

    public onClose(): void {
        this.scrollbars?.destroy();
        this.scrollbars = undefined;
        this.closed = true;
        this.generation++;
        this.importModal?.close();
        this.versionModal?.close();
        this.filterSelects.forEach(select => select.close());
        this.filterSelects = [];
        this.contentEl.empty();
    }
}
