import { ConfigRecord } from './config-revision';
import { configurationContent, ConflictSection, ConflictSide, conflictSections, resolveConfiguration } from './conflict-model';
import { settingsFingerprint } from './session-store';

export interface ConflictItem { kind: 'plugin' | 'preset' | 'field'; id: string; presetId?: string; }
interface ItemBinding { section: string; presetId?: string; pluginId?: string; field?: string; }
const record = (value: unknown): value is ConfigRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (a: unknown, b: unknown): boolean => settingsFingerprint(a) === settingsFingerprint(b);
const pluginFields = ['enabled', 'delay', 'group', 'tags', 'note'];
const pluginList = (value: ConfigRecord): ConfigRecord[] => Array.isArray(value.Plugins) ? value.Plugins.filter(record) : [];
function findPreset(value: ConfigRecord, id: string): { type: string; value: ConfigRecord } | undefined {
    const data = value.DEVICE_MANAGEMENT;
    if (!record(data) || !record(data.presets)) return;
    for (const type of ['computer', 'tablet', 'phone']) {
        const raw = data.presets[type], list = Array.isArray(raw) ? raw : record(raw) ? [raw] : [];
        const found = list.find((item: unknown): item is ConfigRecord => record(item) && item.id === id);
        if (found) return { type, value: found };
    }
}
function presetPlugin(value: ConfigRecord, presetId: string, id: string): unknown {
    const preset = findPreset(value, presetId)?.value;
    return preset && record(preset.plugins) ? preset.plugins[id] : undefined;
}
function userPlugin(value: ConfigRecord, id: string): ConfigRecord | undefined {
    const plugin = pluginList(value).find(item => item.id === id);
    return plugin ? Object.fromEntries(pluginFields.filter(key => key in plugin).map(key => [key, plugin[key]])) : undefined;
}
const keyOf = (binding: ItemBinding): string => settingsFingerprint(binding);

/** One shared selection draft for the floating buttons and the controls beside individual items. */
export class ConfigConflictChoices {
    private readonly choices = new Map<string, ConflictSide>();
    private readonly overrides = new Map<string, { binding: ItemBinding; side: ConflictSide }>();
    private readonly bindings = new Map<string, ItemBinding[]>();
    private localFiles: Record<string, string | null> = {};
    private incomingFiles: Record<string, string | null> = {};
    private cached?: { value: ConfigRecord; files: Record<string, string | null> };
    private filesReady = false;
    readonly local: ConfigRecord;
    readonly incoming: ConfigRecord;
    sections: ConflictSection[];
    get ready(): boolean { return this.filesReady; }

    constructor(readonly id: string, local: ConfigRecord, incoming: ConfigRecord) {
        this.local = clone(local); this.incoming = clone(incoming);
        this.sections = conflictSections(this.local, this.incoming, {}, {});
        for (const section of this.sections) this.choices.set(section.id, 'local');
    }
    setFiles(local: Record<string, string | null>, incoming: Record<string, string | null>): void {
        this.localFiles = { ...local }; this.incomingFiles = { ...incoming };
        this.sections = conflictSections(this.local, this.incoming, local, incoming);
        for (const section of this.sections) if (!this.choices.has(section.id)) this.choices.set(section.id, 'local');
        this.filesReady = true; this.cached = undefined;
    }
    sectionSide(id: string): ConflictSide | 'mixed' {
        const side = this.choices.get(id) ?? 'local';
        return [...this.overrides.values()].some(item => item.binding.section === id && item.side !== side) ? 'mixed' : side;
    }
    /** All-source actions include files and discard every finer-grained exception. */
    selectAll(side: ConflictSide): void {
        if (!this.filesReady) throw new Error('The configuration copies are not ready');
        this.choices.clear();
        for (const section of this.sections) this.choices.set(section.id, side);
        // Preserve the complete source's ordering/unknown structure even when every visible
        // difference belongs to a preset and there is no separate settings section.
        this.choices.set('settings', side);
        this.overrides.clear();
        this.cached = undefined;
    }
    allSide(): ConflictSide | 'mixed' | undefined {
        if (!this.filesReady || !this.sections.length) return undefined;
        const sides = new Set(this.sections.map(section => this.sectionSide(section.id)));
        return sides.size > 1 || sides.has('mixed') ? 'mixed' : sides.values().next().value;
    }
    selectSection(id: string, side: ConflictSide): void {
        if (!this.sections.some(item => item.id === id)) throw new Error('The configuration section is no longer available');
        this.choices.set(id, side);
        for (const [key, item] of this.overrides) if (item.binding.section === id) this.overrides.delete(key);
        this.cached = undefined;
    }
    private itemBindings(target: ConflictItem): ItemBinding[] {
        const key = settingsFingerprint(target), cached = this.bindings.get(key);
        if (cached) return cached;
        const found: ItemBinding[] = [];
        if (target.kind === 'preset') {
            const section = this.sections.find(item => item.kind === 'preset' && item.presetId === target.id);
            if (section) found.push({ section: section.id });
        } else if (target.kind === 'field') {
            const left = configurationContent(this.local), right = configurationContent(this.incoming);
            if (this.sections.some(section => section.id === 'settings') && record(left) && record(right)
                && !same(left[target.id], right[target.id])) found.push({ section: 'settings', field: target.id });
        } else {
            if (target.presetId && !same(presetPlugin(this.local, target.presetId, target.id), presetPlugin(this.incoming, target.presetId, target.id))) {
                const preset = findPreset(this.local, target.presetId) ?? findPreset(this.incoming, target.presetId);
                const section = preset ? `preset:${preset.type}:${target.presetId}` : undefined;
                if (section && this.sections.some(item => item.id === section)) found.push({ section, presetId: target.presetId, pluginId: target.id });
            }
            if (!same(userPlugin(this.local, target.id), userPlugin(this.incoming, target.id))) found.push({ section: 'settings', pluginId: target.id });
        }
        this.bindings.set(key, found);
        return found;
    }
    itemSide(target: ConflictItem): ConflictSide | 'mixed' | undefined {
        const bindings = this.itemBindings(target);
        const sides = new Set(bindings.map(binding => this.overrides.get(keyOf(binding))?.side ?? this.choices.get(binding.section) ?? 'local'));
        return sides.size > 1 ? 'mixed' : sides.values().next().value;
    }
    toggleItem(target: ConflictItem): void {
        const side = this.itemSide(target) === 'incoming' ? 'local' : 'incoming';
        const bindings = this.itemBindings(target);
        if (!bindings.length) throw new Error('This item has no configuration conflict');
        if (target.kind === 'preset') { this.selectSection(bindings[0].section, side); return; }
        for (const binding of bindings) this.overrides.set(keyOf(binding), { binding, side });
        this.cached = undefined;
    }
    listSide(ids: readonly string[], presetId?: string): ConflictSide | 'mixed' | undefined {
        const sides = new Set(ids.map(id => this.itemSide({ kind: 'plugin', id, presetId })).filter(side => side !== undefined));
        return sides.size > 1 || sides.has('mixed') ? 'mixed' : sides.values().next().value;
    }
    toggleList(ids: readonly string[], presetId?: string): void {
        const side = this.listSide(ids, presetId) === 'incoming' ? 'local' : 'incoming';
        for (const id of ids) for (const binding of this.itemBindings({ kind: 'plugin', id, presetId })) {
            this.overrides.set(keyOf(binding), { binding, side });
        }
        this.cached = undefined;
    }
    private resolved(): { value: ConfigRecord; files: Record<string, string | null> } {
        if (this.cached) return this.cached;
        const result = resolveConfiguration(this.local, this.incoming, this.sections, this.choices, this.localFiles, this.incomingFiles);
        for (const { binding, side } of this.overrides.values()) {
            const source = side === 'incoming' ? this.incoming : this.local;
            if (binding.field) {
                if (binding.field in source) result.value[binding.field] = clone(source[binding.field]);
                else delete result.value[binding.field];
            } else if (binding.pluginId && binding.presetId) {
                const target = findPreset(result.value, binding.presetId)?.value;
                if (!target || !record(target.plugins)) continue;
                const state = presetPlugin(source, binding.presetId, binding.pluginId);
                if (state === undefined) delete target.plugins[binding.pluginId];
                else Object.defineProperty(target.plugins, binding.pluginId, { value: clone(state), enumerable: true, writable: true, configurable: true });
            } else if (binding.pluginId) {
                const list = pluginList(result.value), index = list.findIndex(item => item.id === binding.pluginId);
                const from = pluginList(source).find(item => item.id === binding.pluginId);
                if (!from) { if (index >= 0) list.splice(index, 1); }
                else if (index < 0) list.push(clone(from));
                else for (const field of pluginFields) {
                    if (field in from) list[index][field] = clone(from[field]);
                    else delete list[index][field];
                }
                result.value.Plugins = list;
            }
        }
        this.cached = result;
        return result;
    }
    itemValue(target: ConflictItem): unknown {
        const value = this.resolved().value;
        if (target.kind === 'preset') return findPreset(value, target.id)?.value;
        if (target.kind === 'field') return value[target.id];
        const plugin = pluginList(value).find(item => item.id === target.id);
        const state = target.presetId ? presetPlugin(value, target.presetId, target.id) : undefined;
        return clone({ ...(plugin ?? {}), ...(record(state) ? state : {}) });
    }
    result(): { value: ConfigRecord; files: Record<string, string | null> } {
        if (!this.filesReady) throw new Error('The configuration copies are not ready');
        return clone(this.resolved());
    }
}
