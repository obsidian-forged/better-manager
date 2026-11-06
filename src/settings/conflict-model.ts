import { ConfigRecord } from './config-revision';
import { settingsFingerprint } from './session-store';

export type ConflictSide = 'local' | 'incoming';
export interface ConfigDifference { path: string[]; local: unknown; incoming: unknown; }
export interface ConflictSection {
    id: string;
    kind: 'preset' | 'settings' | 'file';
    type?: string;
    presetId?: string;
    local: unknown;
    incoming: unknown;
    differences: ConfigDifference[];
}
const record = (value: unknown): value is ConfigRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (left: unknown, right: unknown): boolean => settingsFingerprint(left) === settingsFingerprint(right);
const types = ['computer', 'tablet', 'phone'];
const pluginMetadata = new Set(['version', 'localVersion', 'latestVersion', 'latestManifestVersion', 'latestPublishedAt',
    'latestReleaseTag', 'latestReleasePublishedAt', 'latestReleaseIsGithubLatest', 'installedAt', 'lastChecked', 'error']);
export const CONFIG_STATE_KEYS = ['MIGRATION_VERSION', 'LANGUAGE_INITIALIZED', 'RELEASE_HIGHLIGHTS_PENDING'] as const;
const settingsMetadata = new Set<string>(['_bpmRevision', ...CONFIG_STATE_KEYS]);

/** Only known bookkeeping fields are non-editable; similarly named user/source fields remain significant. */
export function configurationContent(value: unknown, path: string[] = []): unknown {
    if (Array.isArray(value)) return value.map((item, index) => configurationContent(item, [...path, `${index}`]));
    if (!record(value)) return value;
    const identified = typeof value.id === 'string';
    const plugin = identified && path.length === 2 && path[0] === 'Plugins' && /^\d+$/.test(path[1]);
    const preset = identified && path[0] === 'DEVICE_MANAGEMENT' && path[1] === 'presets' && types.includes(path[2])
        && (path.length === 3 || path.length === 4 && /^\d+$/.test(path[3]));
    const device = identified && path.length === 3 && path[0] === 'DEVICE_MANAGEMENT' && path[1] === 'devices' && /^\d+$/.test(path[2]);
    const content = Object.fromEntries(Object.entries(value).filter(([key]) => !(path.length === 0 && settingsMetadata.has(key)
        || plugin && pluginMetadata.has(key) || preset && key === 'updatedAt'
        || device && ['lastSeen', 'updatedAt'].includes(key)))
        .map(([key, item]) => [key, configurationContent(item, [...path, key])]));
    return preset && path.length === 3 ? [content] : content;
}

/** JSON whitespace/key order and device heartbeat metadata never create a selectable file conflict. */
export function configurationFileDifferences(path: string, local: string | null, incoming: string | null): ConfigDifference[] {
    if (local === incoming) return [];
    if (local === null || incoming === null || !path.endsWith('.json')) return configurationDifferences(local, incoming);
    const parse = (text: string): { value: unknown } | undefined => {
        let parsed: unknown;
        try { parsed = JSON.parse(text); }
        catch { return; } // Invalid JSON stays byte-sensitive instead of matching a valid JSON string.
        if (record(parsed) && /^data\/devices\/[^/]+\.json$/.test(path)) {
            parsed = Object.fromEntries(Object.entries(parsed).filter(([key]) => !['_bpmRevision', 'lastSeen', 'updatedAt'].includes(key)));
        }
        return { value: parsed };
    };
    const left = parse(local), right = parse(incoming);
    return left && right ? configurationDifferences(left.value, right.value) : configurationDifferences(local, incoming);
}
function presets(value: ConfigRecord, type: string): ConfigRecord[] {
    const management = value.DEVICE_MANAGEMENT;
    const source = record(management) && record(management.presets) ? management.presets[type] : undefined;
    return (Array.isArray(source) ? source : record(source) ? [source] : []).filter(record);
}
function splittablePresets(value: ConfigRecord, type: string): boolean {
    const management = value.DEVICE_MANAGEMENT;
    const source = record(management) && record(management.presets) ? management.presets[type] : undefined;
    if (source === undefined) return true;
    const items: unknown[] = Array.isArray(source) ? source : [source];
    return items.every(item => record(item) && typeof item.id === 'string')
        && new Set(items.map(item => record(item) ? item.id : undefined)).size === items.length;
}
function withoutPresets(value: ConfigRecord, other: ConfigRecord): ConfigRecord {
    const copy = clone(value);
    if (record(copy.DEVICE_MANAGEMENT) && record(copy.DEVICE_MANAGEMENT.presets)) for (const type of types) {
        if (splittablePresets(copy, type) && splittablePresets(other, type)) {
            const own = presets(copy, type), theirs = presets(other, type);
            const otherIds = new Set(theirs.map(item => item.id));
            const common = own.filter(item => otherIds.has(item.id)).map(item => ({ id: item.id }));
            if (common.length) copy.DEVICE_MANAGEMENT.presets[type] = common;
            else if (own.length || theirs.length) delete copy.DEVICE_MANAGEMENT.presets[type];
        }
    }
    return copy;
}

/** Keep every differing value, including deletion and unfamiliar fields; never choose silently. */
export function configurationDifferences(local: unknown, incoming: unknown, path: string[] = []): ConfigDifference[] {
    if (same(local, incoming)) return [];
    if (record(local) && record(incoming)) return [...new Set([...Object.keys(local), ...Object.keys(incoming)])]
        .flatMap(key => configurationDifferences(local[key], incoming[key], [...path, key]));
    return [{ path, local, incoming }];
}
export function conflictSections(local: ConfigRecord, incoming: ConfigRecord,
    localFiles: Record<string, string | null>, incomingFiles: Record<string, string | null>): ConflictSection[] {
    const sections: ConflictSection[] = [];
    const effectiveLocal = configurationContent(local), effectiveIncoming = configurationContent(incoming);
    if (!record(effectiveLocal) || !record(effectiveIncoming)) throw new Error('Invalid configuration comparison');
    for (const type of types) {
        if (!splittablePresets(local, type) || !splittablePresets(incoming, type)) continue;
        const left = presets(local, type), right = presets(incoming, type);
        const effectiveLeft = presets(effectiveLocal, type), effectiveRight = presets(effectiveIncoming, type);
        for (const id of new Set([...left, ...right].flatMap(item => typeof item.id === 'string' ? [item.id] : []))) {
            const a = left.find(item => item.id === id), b = right.find(item => item.id === id);
            const differences = configurationDifferences(effectiveLeft.find(item => item.id === id), effectiveRight.find(item => item.id === id));
            if (!differences.length) continue;
            sections.push({ id: `preset:${type}:${id}`, kind: 'preset', type, presetId: id, local: a, incoming: b,
                differences });
        }
    }
    const a = withoutPresets(local, incoming), b = withoutPresets(incoming, local);
    const differences = configurationDifferences(withoutPresets(effectiveLocal, effectiveIncoming), withoutPresets(effectiveIncoming, effectiveLocal));
    if (differences.length) sections.push({ id: 'settings', kind: 'settings', local: a, incoming: b, differences });
    for (const path of new Set([...Object.keys(localFiles), ...Object.keys(incomingFiles)])) {
        const left = localFiles[path] ?? null, right = incomingFiles[path] ?? null;
        if (left === right) continue;
        const fileDifferences = configurationFileDifferences(path, left, right);
        if (!fileDifferences.length) continue;
        sections.push({ id: `file:${path}`, kind: 'file', local: left, incoming: right,
            differences: path.endsWith('.json') ? fileDifferences : [] });
    }
    return sections;
}

export function resolveConfiguration(local: ConfigRecord, incoming: ConfigRecord, sections: ConflictSection[],
    choices: ReadonlyMap<string, ConflictSide>, localFiles: Record<string, string | null>, incomingFiles: Record<string, string | null>):
    { value: ConfigRecord; files: Record<string, string | null> } {
    if (sections.some(section => !choices.has(section.id))) throw new Error('Choose a version for every changed configuration section');
    const value = clone(choices.get('settings') === 'incoming' ? incoming : local);
    const management = record(value.DEVICE_MANAGEMENT) ? value.DEVICE_MANAGEMENT : undefined;
    if (management && sections.some(section => section.kind === 'preset')) {
        const all: ConfigRecord = record(management.presets) ? clone(management.presets) : {};
        for (const type of types) {
            if (!sections.some(section => section.kind === 'preset' && section.type === type)) continue;
            const left = presets(local, type), right = presets(incoming, type);
            const selected = [...new Set([...presets(value, type), ...left, ...right].flatMap(item => typeof item.id === 'string' ? [item.id] : []))].flatMap(id => {
                const source = choices.get(`preset:${type}:${id}`) === 'incoming' ? right : left;
                const preset = source.find(item => item.id === id);
                return preset ? [clone(preset)] : [];
            });
            all[type] = record(all[type]) && selected.length === 1 ? selected[0] : selected;
        }
        management.presets = all;
        // A default cannot point at a preset explicitly removed by the selection.
        if (record(management.defaultPresets)) for (const type of types) {
            const list = presets(value, type);
            if (!list.some(item => item.id === (record(management.defaultPresets) ? management.defaultPresets[type] : undefined))) {
                management.defaultPresets[type] = list[0]?.id ?? '';
            }
        }
    }
    const files: Record<string, string | null> = {};
    for (const path of new Set([...Object.keys(localFiles), ...Object.keys(incomingFiles)])) {
        files[path] = (choices.get(`file:${path}`) === 'incoming' ? incomingFiles[path] : localFiles[path]) ?? null;
    }
    return { value, files };
}

/** Values for the readable comparison, never JSON dumps or credentials. */
export function conflictValueText(value: unknown, path: string[], word: (key: string) => string): string {
    if (path.some(key => /token|secret|password|credential|authorization|api.?key/i.test(key))) return word(value ? 'set' : 'unset');
    if (value === undefined || value === null) return word('absent');
    if (typeof value === 'boolean') return word(value ? 'on' : 'off');
    if (typeof value === 'number') return Number.isFinite(value) ? `${value}` : word('unset');
    if (typeof value === 'string') return value.length ? value.slice(0, 300) : word('empty');
    if (Array.isArray(value)) return value.length ? value.map(item => conflictValueText(item, path, word)).join(' · ').slice(0, 600) : word('empty');
    if (record(value)) return Object.entries(value).map(([key, item]) => `${key}: ${conflictValueText(item, [...path, key], word)}`).join(' · ').slice(0, 600);
    return word('unset');
}
