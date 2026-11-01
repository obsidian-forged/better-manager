import type { CatalogEntry } from "./catalog";

export const CATALOG_SCENARIOS = [
    { id: "writing", icon: "pencil", key: "目录_场景写作", pattern: /writ|edit|markdown|写作|编辑|排版/i },
    { id: "knowledge", icon: "search", key: "目录_场景知识", pattern: /search|link|graph|knowledge|检索|搜索|双链|知识/i },
    { id: "planning", icon: "calendar", key: "目录_场景计划", pattern: /task|calendar|plan|habit|todo|任务|日历|计划|习惯/i },
    { id: "data", icon: "table", key: "目录_场景数据", pattern: /data|table|query|chart|数据|表格|查询|图表/i },
    { id: "files", icon: "folder", key: "目录_场景文件", pattern: /file|folder|attach|sync|文件|附件|同步/i },
    { id: "appearance", icon: "palette", key: "目录_场景外观", pattern: /theme|style|layout|appearance|主题|样式|布局|外观/i },
] as const;

export function matchesScenario(entry: CatalogEntry, scenario: string): boolean {
    if (!scenario) return true;
    const definition = CATALOG_SCENARIOS.find(item => item.id === scenario);
    return definition ? definition.pattern.test([entry.name, entry.description, ...entry.tags, ...entry.useCases].join(" ")) : true;
}

/** 只按文本相关度排序，不引入下载量权重 / Relevance never incorporates popularity. */
export function relevance(entry: CatalogEntry, query: string): number {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return 0;
    const fields = [
        [entry.name, 60], [entry.id, 40], [entry.useCases.join(" "), 30], [entry.tags.join(" "), 25],
        [entry.description, 15], [entry.author, 10], [entry.repositoryUrl || "", 5],
    ] as const;
    let total = 0;
    for (const term of terms) {
        let score = 0;
        for (const [field, weight] of fields) {
            const normalized = field.toLocaleLowerCase();
            if (normalized.includes(term)) score += normalized === term ? weight * 2 : weight;
        }
        if (!score) return -1;
        total += score;
    }
    return total;
}

function hash(value: string): number {
    let result = 2166136261;
    for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
    return result >>> 0;
}

/** 各源轮流出场，小源不会被官方大目录挤掉 / Round-robin exposure keeps small independent catalogs visible. */
export function discoveryOrder(entries: CatalogEntry[], seed: string): CatalogEntry[] {
    const groups = new Map<string, CatalogEntry[]>();
    for (const entry of entries) {
        const group = groups.get(entry.source.id) || [];
        group.push(entry);
        groups.set(entry.source.id, group);
    }
    for (const group of groups.values()) group.sort((a, b) => hash(`${seed}:${a.key}`) - hash(`${seed}:${b.key}`) || a.key.localeCompare(b.key));
    const sources = [...groups.keys()].sort((a, b) => hash(`${seed}:${a}`) - hash(`${seed}:${b}`) || a.localeCompare(b));
    const result: CatalogEntry[] = [];
    for (let index = 0; result.length < entries.length; index++) {
        for (const source of sources) {
            const entry = groups.get(source)?.[index];
            if (entry) result.push(entry);
        }
    }
    return result;
}

/** 冷门通道只描述下载分布，不宣称质量 / Low-exposure selection does not imply a quality rating. */
export function lowExposure(entries: CatalogEntry[]): CatalogEntry[] {
    const counts = entries.flatMap(entry => entry.stats?.downloads === undefined ? [] : [entry.stats.downloads]).sort((a, b) => a - b);
    const median = counts.length ? counts[Math.floor((counts.length - 1) / 2)] : 0;
    return entries.filter(entry => entry.stats?.downloads === undefined || entry.stats.downloads <= median);
}
