import { App } from "obsidian";
import Manager from "../main";
import { RibbonItem } from "../data/types";
import { RibbonNativeItem, WorkspaceWithRibbon } from "../obsidian-internals";

/**
 * 一个内存 ribbon 项的解析结果：设置层与 Obsidian 内存项之间的唯一桥接
 * Resolution of one in-memory ribbon item: the single bridge between settings and native items.
 */
export interface RibbonResolution {
    item: RibbonNativeItem;
    /** 同一插件内的出现序号（从 1 开始） */
    sequence: number;
    /** 命中的已保存条目；为空说明这是 BPM 尚未登记的新图标 */
    setting?: RibbonItem;
    /** 命中的条目其 name / ribbonIdMap 与当前内存项不一致，需要回写标识字段 */
    identityDrifted: boolean;
    /** 是否通过「孤儿认领」命中（仅供排查） */
    adopted: boolean;
}

/** 解析过程中的单项上下文 */
interface ItemContext {
    item: RibbonNativeItem;
    pluginId: string;
    sequence: number;
}

/**
 * Ribbon 身份匹配的唯一实现
 * 纯内存计算：输入 Obsidian 的 leftRibbon.items 与 BPM 的 RIBBON_SETTINGS，
 * 不读写任何 DOM 属性（显隐与顺序由 Obsidian 原生状态承载）
 *
 * The single implementation of ribbon identity matching.
 * Pure in-memory: takes leftRibbon.items plus RIBBON_SETTINGS and never touches DOM attributes
 * (visibility and order live in Obsidian's native state).
 */
export class SystemRibbonManager {
    private app: App;
    private manager: Manager;

    constructor(app: App, manager: Manager) {
        this.app = app;
        this.manager = manager;
    }

    // ==================== 身份解析与匹配（唯一实现，禁止在调用方重复） ====================

    /**
     * 取出 ribbon 项 id 中的插件 id 前缀（与语言、标题无关）
     * @param itemId 内存项 id，形如 "nutstore-sync:开始同步"
     */
    public static pluginIdOf(itemId?: string | null): string {
        if (!itemId) return "";
        const index = itemId.indexOf(":");
        return index === -1 ? itemId : itemId.slice(0, index);
    }

    /**
     * 由插件 id 与序号生成候选 bpmUniqueId
     * 与历史数据保持一致：首个为裸前缀，其后为「前缀#序号」
     */
    public static candidateId(pluginId: string, sequence: number): string {
        if (!pluginId) return "";
        return sequence <= 1 ? pluginId : `${pluginId}#${sequence}`;
    }

    /**
     * 由 bpmUniqueId 反推插件前缀（格式为「插件id」或「插件id#序号」）
     * 用于判断孤儿条目是否属于同一个插件
     */
    public static pluginPrefixOf(uid?: string | null): string {
        if (!uid) return "";
        const hash = uid.indexOf("#");
        return hash === -1 ? uid : uid.slice(0, hash);
    }

    /**
     * 读取内存中的 ribbon 项（过滤 null/undefined，Obsidian 内部数组可能含空洞）
     */
    private getMemoryItems(): RibbonNativeItem[] {
        const items = (this.app.workspace as WorkspaceWithRibbon).leftRibbon?.items || [];
        return items.filter((item): item is RibbonNativeItem => Boolean(item));
    }

    /**
     * 建立已保存条目的多路索引，供身份匹配复用
     * 索引键：rid(ribbonIdMap 记录的内存项 id) / seq(插件id+序号) / name(名称)
     */
    private buildSavedIndex(saved: RibbonItem[]): Map<string, RibbonItem> {
        const index = new Map<string, RibbonItem>();
        (saved || []).forEach((item) => {
            if (!item) return;

            if (item.bpmUniqueId) {
                // bpmUniqueId 本身即「插件id」或「插件id#序号」，可直接作为序号键使用
                index.set(`seq:${item.bpmUniqueId}`, item);
            }
            if (item.ribbonIdMap) {
                Object.values(item.ribbonIdMap).forEach((id) => {
                    if (id) index.set(`rid:${id}`, item);
                });
            }
            if (item.name) {
                index.set(`name:${item.name}`, item);
            }
        });
        return index;
    }

    /**
     * 建立「插件id|图标名」索引，供图标策略判断唯一性
     * 图标名是插件源码里的常量，比会被本地化的标题稳定得多
     */
    private buildIconIndex(saved: RibbonItem[]): Map<string, RibbonItem[]> {
        const index = new Map<string, RibbonItem[]>();
        (saved || []).forEach((item) => {
            if (!item || !item.icon) return;
            const pluginId = SystemRibbonManager.pluginPrefixOf(item.bpmUniqueId);
            if (!pluginId) return;
            const key = `${pluginId}|${item.icon}`;
            const list = index.get(key);
            if (list) list.push(item);
            else index.set(key, [item]);
        });
        return index;
    }

    /**
     * 名称匹配：单行要求完全相等；多行要求每一行都被包含（沿用既有约定）
     */
    private titleMatchesName(label: string, itemName: string): boolean {
        const lines = itemName.split("\n").map((line) => line.trim()).filter((line) => line !== "");
        if (lines.length <= 1) return label === itemName;
        return lines.every((line) => label.includes(line));
    }

    /**
     * 解析全部内存项与已保存条目的对应关系（设置层唯一入口）
     *
     * 匹配优先级：ribbonIdMap → 插件id+图标名 → 插件id+序号 → 名称 → 孤儿认领
     * 全部未命中时 setting 为空，由调用方决定是否登记为新条目
     *
     * @param saved 已保存的 Ribbon 配置
     * @param items 内存 ribbon 项（顺序即序号依据，省略时取 leftRibbon.items）
     */
    public resolve(saved: RibbonItem[], items?: RibbonNativeItem[]): RibbonResolution[] {
        const list = (saved || []).filter((entry): entry is RibbonItem => Boolean(entry));
        const memoryItems = items || this.getMemoryItems();
        const index = this.buildSavedIndex(list);
        const iconIndex = this.buildIconIndex(list);

        // 1. 先算好每个内存项的插件前缀与序号：序号必须在同一插件内按 items 顺序累加，
        //    「插件id+序号」才与历史分配规则一致
        const counters = new Map<string, number>();
        const contexts: ItemContext[] = memoryItems.map((item) => {
            const pluginId = SystemRibbonManager.pluginIdOf(item.id);
            const sequence = (counters.get(pluginId) || 0) + 1;
            counters.set(pluginId, sequence);
            return { item, pluginId, sequence };
        });

        // 2. 常规匹配，同时收集「已被某个内存项命中」的条目
        const liveUids = new Set<string>();
        const matches = contexts.map((ctx) => {
            const hit = this.matchItem(ctx, list, index, iconIndex);
            if (hit) liveUids.add(hit.bpmUniqueId);
            return hit;
        });

        // 3. 孤儿 = 已保存、但没有任何内存项命中它的条目
        //    最可能的归属是「换了标题或换了内存项 id 的同一个图标」
        const orphans = list.filter((entry) => !liveUids.has(entry.bpmUniqueId));
        const claimed = new Set<string>();

        return contexts.map((ctx, position) => {
            let setting = matches[position];
            let adopted = false;

            if (!setting && orphans.length > 0) {
                setting = this.findAdoptableOrphan(ctx, orphans, claimed);
                adopted = Boolean(setting);
                if (setting) claimed.add(setting.bpmUniqueId);
            }

            const identityDrifted = Boolean(setting) && !this.identityMatches(setting as RibbonItem, ctx.item);
            const resolution: RibbonResolution = {
                item: ctx.item,
                sequence: ctx.sequence,
                setting,
                identityDrifted,
                adopted
            };


            return resolution;
        });
    }

    /**
     * 单个内存项的常规匹配（不含孤儿认领）
     * @param candidates 参与本次匹配的条目集合，默认全部已保存条目
     */
    private matchItem(
        ctx: ItemContext,
        candidates: RibbonItem[],
        index: Map<string, RibbonItem>,
        iconIndex: Map<string, RibbonItem[]>
    ): RibbonItem | undefined {
        const { item, pluginId, sequence } = ctx;
        const pick = (hit?: RibbonItem) => (hit && candidates.indexOf(hit) !== -1 ? hit : undefined);

        // 1. ribbonIdMap：记录过各语言下的内存项 id，跨语言仍可命中，最可靠
        if (item.id) {
            const hit = pick(index.get(`rid:${item.id}`));
            if (hit) return hit;
        }

        // 2. 插件id + 图标名：图标名是插件源码常量，比标题稳定
        //    该「插件+图标」组合必须唯一，避免同插件多图标共用同一图标名时误判
        if (pluginId && item.icon) {
            const sameIcon = (iconIndex.get(`${pluginId}|${item.icon}`) || []).filter(
                (entry) => candidates.indexOf(entry) !== -1
            );
            if (sameIcon.length === 1) return sameIcon[0];
        }

        // 3. 插件id + 序号：与语言、标题都无关
        if (pluginId && sequence) {
            const hit = pick(index.get(`seq:${SystemRibbonManager.candidateId(pluginId, sequence)}`));
            if (hit) return hit;
        }

        // 4. 名称兜底
        if (item.title) {
            const hit = pick(index.get(`name:${item.title}`));
            if (hit) return hit;
            return candidates.find((entry) => entry.name && this.titleMatchesName(item.title as string, entry.name));
        }

        return undefined;
    }

    /**
     * 孤儿认领：为「内存中已无归属」的旧条目找回它的图标
     *
     * 保守规则（任一不满足即放弃，退回新铸身份）：
     * - 孤儿必须与当前项属于同一插件前缀
     * - 孤儿的 ribbonIdMap 记录过当前内存项 id，或孤儿 name 与当前标题完全相等
     * - 候选必须唯一（有歧义说明无法确定归属）
     */
    private findAdoptableOrphan(ctx: ItemContext, orphans: RibbonItem[], claimed: Set<string>): RibbonItem | undefined {
        if (!ctx.pluginId) return undefined;

        const hits = orphans.filter((entry) => {
            if (claimed.has(entry.bpmUniqueId)) return false;
            if (SystemRibbonManager.pluginPrefixOf(entry.bpmUniqueId) !== ctx.pluginId) return false;

            const sameId = Boolean(ctx.item.id) && Object.values(entry.ribbonIdMap || {}).includes(ctx.item.id as string);
            const sameName = Boolean(ctx.item.title) && entry.name === ctx.item.title;
            return sameId || sameName;
        });

        return hits.length === 1 ? hits[0] : undefined;
    }

    /**
     * 条目的标识字段是否与当前内存项一致
     * 只关心「能否再次匹配上」：任一语言键下记录过当前 id，且名称相同
     */
    private identityMatches(entry: RibbonItem, item: RibbonNativeItem): boolean {
        const idRecorded = Boolean(item.id) && Object.values(entry.ribbonIdMap || {}).includes(item.id as string);
        const nameRecorded = Boolean(item.title) && entry.name === item.title;
        return idRecorded && nameRecorded;
    }
}
