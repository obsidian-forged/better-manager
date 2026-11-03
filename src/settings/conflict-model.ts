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
function presets(value: ConfigRecord, type: string): ConfigRecord[] {
    const management = value.DEVICE_MANAGEMENT;
    const source = record(management) && record(management.presets) ? management.presets[type] : undefined;
    return (Array.isArray(source) ? source : record(source) ? [source] : []).filter(record);
}
function withoutPresets(value: ConfigRecord): ConfigRecord {
    const copy = clone(value);
    if (record(copy.DEVICE_MANAGEMENT)) delete copy.DEVICE_MANAGEMENT.presets;
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
    for (const type of types) {
        const left = presets(local, type), right = presets(incoming, type);
        for (const id of new Set([...left, ...right].flatMap(item => typeof item.id === 'string' ? [item.id] : []))) {
            const a = left.find(item => item.id === id), b = right.find(item => item.id === id);
            if (same(a, b)) continue;
            sections.push({ id: `preset:${type}:${id}`, kind: 'preset', type, presetId: id, local: a, incoming: b,
                differences: configurationDifferences(a, b) });
        }
    }
    const a = withoutPresets(local), b = withoutPresets(incoming);
    if (!same(a, b)) sections.push({ id: 'settings', kind: 'settings', local: a, incoming: b,
        differences: configurationDifferences(a, b) });
    for (const path of new Set([...Object.keys(localFiles), ...Object.keys(incomingFiles)])) {
        const left = localFiles[path] ?? null, right = incomingFiles[path] ?? null;
        if (left === right) continue;
        const parse = (text: string | null): unknown => {
            if (text === null || !path.endsWith('.json')) return text;
            try { const parsed: unknown = JSON.parse(text); return parsed; }
            catch { return text; } // Malformed files remain selectable; display uses a safe summary.
        };
        sections.push({ id: `file:${path}`, kind: 'file', local: left, incoming: right,
            differences: path.endsWith('.json') ? configurationDifferences(parse(left), parse(right)) : [] });
    }
    return sections;
}

export function resolveConfiguration(local: ConfigRecord, incoming: ConfigRecord, sections: ConflictSection[],
    choices: ReadonlyMap<string, ConflictSide>, localFiles: Record<string, string | null>, incomingFiles: Record<string, string | null>):
    { value: ConfigRecord; files: Record<string, string | null> } {
    if (sections.some(section => !choices.has(section.id))) throw new Error('Choose a version for every changed configuration section');
    const value = clone(choices.get('settings') === 'incoming' ? incoming : local);
    const management = record(value.DEVICE_MANAGEMENT) ? value.DEVICE_MANAGEMENT : undefined;
    if (management) {
        const all: ConfigRecord = {};
        for (const type of types) {
            const left = presets(local, type), right = presets(incoming, type);
            all[type] = [...new Set([...left, ...right].flatMap(item => typeof item.id === 'string' ? [item.id] : []))].flatMap(id => {
                const source = choices.get(`preset:${type}:${id}`) === 'incoming' ? right : left;
                const preset = source.find(item => item.id === id);
                return preset ? [clone(preset)] : [];
            });
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
