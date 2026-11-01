import { getIcon, requestUrl, setIcon } from 'obsidian';
import type Manager from '../main';
import { pluginStorage } from '../storage/plugin-storage';

type IconRecord = { name: string; svg: string; color?: string };
const START = '/* BPM generated icons: start */';
const END = '/* BPM generated icons: end */';
const colors: Record<string, string> = {
    red: '#fb464c', orange: '#e9973f', yellow: '#ffde3b', green: '#44cf6e',
    cyan: '#53dfdd', blue: '#027aff', pink: '#fa99cd', black: '#262626', purple: '#8b5cf6',
};
function object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}
export function lucideName(value: string): string | undefined {
    const name = value.replace(/^lucide-/, '');
    return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) && name.length <= 80 ? name : undefined;
}
export function iconColor(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    return colors[value] ?? (/^#[0-9a-f]{6}$/i.test(value) ? value : undefined);
}

/** Shared icon renderer; only a missing named Lucide glyph needs a network request. */
export class PluginIcons {
    private records = new Map<string, IconRecord>();
    private pending = new Map<string, Promise<string | undefined>>();
    private failed = new Set<string>();
    /** 社区目录的 Lucide 图标名（null 表示查过但没有）/ Community icon names, null = looked up. */
    private communityNames = new Map<string, string | null>();
    private communityPending = new Map<string, Promise<string | null>>();
    private communityQueue: Promise<unknown> = Promise.resolve();
    private communityKey?: string;
    private communityKeyLoading?: Promise<string | undefined>;
    private communityKeyFailed = false;
    private source = '';
    private loaded?: Promise<void>;
    private writes: Promise<void> = Promise.resolve();
    private disposed = false;
    private writable = true;
    constructor(private readonly manager: Manager) {}

    private report(error: unknown): void {
        if (this.manager.settings?.DEBUG) console.error('[BPM icons]', error);
    }

    private load(): Promise<void> {
        if (!this.loaded) this.loaded = pluginStorage(this.manager).read('data', 'icons.css').then(text => {
            this.source = text ?? '';
            const block = this.source.split(START)[1]?.split(END)[0] ?? '';
            for (const match of block.matchAll(/\/\* icon:([^*]+) \*\//g)) {
                try {
                    const row: unknown = JSON.parse(decodeURIComponent(match[1]));
                    const record = object(row);
                    if (record && typeof record.id === 'string' && typeof record.name === 'string' && typeof record.svg === 'string') {
                        this.records.set(record.id, { name: record.name, svg: record.svg, color: iconColor(record.color) });
                    }
                } catch (error) { this.report(error); }
            }
        }).catch(error => { this.writable = false; this.report(error); });
        return this.loaded;
    }

    private candidates(id: string): { names: string[]; color?: string } {
        const manifest = object(this.manager.appPlugins.manifests[id]);
        const names: string[] = [];
        for (const value of [manifest?.lucide_icon_name, manifest?.icon]) if (typeof value === 'string') names.push(value);
        const workspace = object(this.manager.app.workspace);
        const ribbon = object(workspace?.leftRibbon);
        const items = ribbon?.items;
        if (Array.isArray(items)) for (const entry of items) {
            const item = object(entry);
            if (typeof item?.id === 'string' && item.id.startsWith(`${id}:`) && typeof item.icon === 'string') names.push(item.icon);
        }
        const commands = object(object(this.manager.app)?.commands);
        const entries = object(commands?.commands);
        if (entries) for (const [key, entry] of Object.entries(entries)) {
            const command = object(entry);
            if (key.startsWith(`${id}:`) && typeof command?.icon === 'string') names.push(command.icon);
        }
        if (getIcon(id)) names.unshift(id);
        const saved = this.records.get(id);
        if (saved) names.push(saved.name);
        return { names: [...new Set(names)], color: iconColor(manifest?.icon_color) ?? saved?.color };
    }

    /** Only Lucide geometry is accepted; no scripts, links, styles or embedded images. */
    private parse(text: string, doc: Document): SVGSVGElement | undefined {
        if (text.length > 100_000 || /<!DOCTYPE|<!ENTITY/i.test(text)) return undefined;
        const parser = new (doc.defaultView?.DOMParser ?? DOMParser)();
        const root = parser.parseFromString(text, 'image/svg+xml').documentElement;
        if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') return undefined;
        const tags = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect']);
        const attrs = new Set(['xmlns', 'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'fill-rule', 'clip-rule', 'opacity', 'transform', 'class']);
        const children = Array.from(root.querySelectorAll('*'));
        if (children.length > 1000) return undefined;
        for (const element of [root, ...children]) {
            if (!tags.has(element.localName)) return undefined;
            for (const attr of Array.from(element.attributes)) {
                if (!attrs.has(attr.name) || /url\s*\(|[<>]/i.test(attr.value)) return undefined;
            }
            element.removeAttribute('class');
        }
        const imported = doc.importNode(root, true);
        return imported instanceof (doc.defaultView?.SVGSVGElement ?? SVGSVGElement) ? imported : undefined;
    }

    private download(name: string, doc: Document): Promise<string | undefined> {
        const key = lucideName(name);
        if (!key || this.failed.has(key)) return Promise.resolve(undefined);
        const existing = this.pending.get(key);
        if (existing) return existing;
        const task = requestUrl({ url: `https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/${key}.svg`, throw: false }).then(response => {
            if (this.disposed || response.status !== 200) throw new Error(`Lucide icon unavailable: ${key}`);
            const svg = this.parse(response.text, doc);
            if (!svg) throw new Error(`Invalid Lucide SVG: ${key}`);
            return svg.outerHTML;
        }).catch(error => { this.failed.add(key); this.report(error); return undefined; });
        this.pending.set(key, task);
        return task;
    }

    /**
     * 社区目录的图标名来自站点搜索索引的 lucide_icon_name 字段。
     * 公开页面里的 apiKey 只用于该搜索接口；取不到时直接走默认图标。
     */
    private communityApiKey(): Promise<string | undefined> {
        if (this.communityKey || this.communityKeyFailed) return Promise.resolve(this.communityKey);
        if (!this.communityKeyLoading) {
            this.communityKeyLoading = requestUrl({ url: 'https://community.obsidian.md/plugins?q=', throw: false })
                .then(response => {
                    if (response.status !== 200) return undefined;
                    const match = response.text.match(/\\?"apiKey\\?":\\?"([^"\\]+)\\?"/);
                    if (!match) { this.communityKeyFailed = true; return undefined; }
                    this.communityKey = match[1];
                    return this.communityKey;
                })
                .catch(error => { this.communityKeyFailed = true; this.report(error); return undefined; });
        }
        return this.communityKeyLoading;
    }

    private async fetchCommunityName(id: string): Promise<string | null> {
        if (this.disposed) return null;
        const key = await this.communityApiKey();
        if (!key || this.disposed) return null;
        const manifest = object(this.manager.appPlugins.manifests[id]);
        const name = typeof manifest?.name === 'string' ? manifest.name : '';
        if (!name) return null;
        const params = new URLSearchParams({ q: name, query_by: 'name,authors,short_desc', per_page: '10' });
        const response = await requestUrl({
            url: `https://community.obsidian.md/api/search/collections/entries/documents/search?${params}`,
            headers: { 'X-TYPESENSE-API-KEY': key, Accept: 'application/json' },
            throw: false,
        });
        if (response.status !== 200 || this.disposed) return null;
        const payload = object(response.json);
        const hits = payload?.hits;
        if (!Array.isArray(hits)) return null;
        for (const hit of hits) {
            const document = object(object(hit)?.document);
            if (!document || document.slug !== id) continue;
            const icon = document.lucide_icon_name;
            return typeof icon === 'string' ? lucideName(icon) ?? null : null;
        }
        return null;
    }

    /** 串行查询，避免一次渲染几十张卡片时并发打社区接口 / Serialize lookups. */
    private communityName(id: string): Promise<string | null> {
        if (this.communityNames.has(id)) return Promise.resolve(this.communityNames.get(id) ?? null);
        const pending = this.communityPending.get(id);
        if (pending) return pending;
        const work = this.communityQueue
            .then(() => this.fetchCommunityName(id))
            .then(name => { this.communityNames.set(id, name); return name; })
            .catch(error => { this.report(error); this.communityNames.set(id, null); return null; })
            .finally(() => { this.communityPending.delete(id); });
        this.communityPending.set(id, work);
        this.communityQueue = work.catch(() => undefined);
        return work;
    }

    private persist(id: string, record: IconRecord): void {
        if (JSON.stringify(this.records.get(id)) === JSON.stringify(record) || this.disposed || !this.writable) return;
        this.records.set(id, record);
        this.writes = this.writes.then(async () => {
            const rules = [...this.records].sort(([a], [b]) => a.localeCompare(b)).map(([pluginId, icon]) => {
                const selector = `[data-bpm-icon="${encodeURIComponent(pluginId)}"]`;
                return `/* icon:${encodeURIComponent(JSON.stringify({ id: pluginId, ...icon }))} */\n${selector} { --bpm-plugin-icon-svg: url("data:image/svg+xml,${encodeURIComponent(icon.svg)}");${icon.color ? ` --bpm-plugin-icon-color: ${icon.color};` : ''} }`;
            }).join('\n');
            const generated = `${START}\n${rules}\n${END}`;
            const start = this.source.indexOf(START), end = this.source.indexOf(END);
            const next = start >= 0 && end >= start ? this.source.slice(0, start) + generated + this.source.slice(end + END.length) : `${this.source}\n${generated}\n`;
            await pluginStorage(this.manager).write('data', 'icons.css', next);
            this.source = next;
        }).catch(error => { this.report(error); });
    }

    render(element: HTMLElement, id: string, enabled: boolean): void {
        element.empty();
        setIcon(element, enabled ? 'plug-zap' : 'plug');
        element.dataset.bpmIcon = encodeURIComponent(id);
        const token = {};
        this.targets.set(element, token);
        void this.renderResolved(element, id, token).catch(error => { this.report(error); });
    }
    private targets = new WeakMap<HTMLElement, object>();

    private async renderResolved(element: HTMLElement, id: string, token: object): Promise<void> {
        await this.load();
        if (this.disposed || this.targets.get(element) !== token) return;
        const doc = element.ownerDocument;
        const { names, color } = this.candidates(id);
        let svg: SVGSVGElement | undefined;
        let name = '';
        for (const candidate of names) {
            svg = getIcon(candidate) ?? getIcon(lucideName(candidate) ?? candidate) ?? undefined;
            if (svg) { name = candidate; break; }
        }
        if (!svg) {
            const saved = this.records.get(id);
            if (saved) { svg = this.parse(saved.svg, doc); name = saved.name; }
        }
        // 本地条目只有名称、Lucide 里又没有时，再问社区目录分配的是哪颗图标。
        if (!svg && names.length) {
            name = names[0];
            const text = await this.download(name, doc);
            if (text) svg = this.parse(text, doc);
        }
        if (!svg) {
            const communityName = await this.communityName(id);
            if (communityName && !this.disposed && this.targets.get(element) === token) {
                name = communityName;
                svg = getIcon(communityName) ?? getIcon(lucideName(communityName) ?? communityName) ?? undefined;
                if (!svg) {
                    const text = await this.download(communityName, doc);
                    if (text) svg = this.parse(text, doc);
                }
            }
        }
        if (!svg || this.disposed || this.targets.get(element) !== token) return;
        element.empty();
        element.appendChild(doc.importNode(svg, true));
        const glyphColor = color ?? Array.from(svg.querySelectorAll('[stroke], [fill]')).map(node => iconColor(node.getAttribute('stroke')) ?? iconColor(node.getAttribute('fill'))).find(value => value && !/^#(?:ffffff|000000)$/i.test(value));
        // 颜色直接写进卡片变量；不注入 <style>，符合运行时 CSS 约束。
        element.setCssProps({ '--bpm-plugin-icon-color': glyphColor ?? 'initial' });
        this.persist(id, { name, svg: svg.outerHTML, color: glyphColor });
    }

    dispose(): void {
        this.disposed = true;
    }
}
