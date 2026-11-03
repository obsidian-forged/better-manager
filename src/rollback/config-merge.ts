const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeKey = (key: string): boolean => !['__proto__', 'prototype', 'constructor'].includes(key);
const fieldPath = (path: string, key: string): string => /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
export interface ConfigMerge { value: unknown; removed: string[]; restored: string[]; preservableObjects: string[] }

function arraySample(samples: unknown[], entry: unknown, path: string): unknown {
    let candidates = samples.filter(item => Array.isArray(item) === Array.isArray(entry) && typeof item === typeof entry && (item === null) === (entry === null));
    if (object(entry)) {
        for (const key of ['type', 'kind']) if (typeof entry[key] === 'string') candidates = candidates.filter(item => object(item) && item[key] === entry[key]);
        if (typeof entry.id === 'string' || typeof entry.id === 'number') {
            const exact = candidates.find(item => object(item) && item.id === entry.id);
            if (exact !== undefined) return exact;
        }
        const shapes = new Set(candidates.map(item => object(item) ? JSON.stringify(Object.keys(item).sort()) : ''));
        if (shapes.size > 1) throw new Error(`Cannot infer the older array structure at ${path}`);
    }
    if (!candidates.length) throw new Error(`Cannot infer the older array structure at ${path}`);
    return candidates[0];
}

/** Use the older observed shape while retaining current values; this is not an author's schema. */
export function mergeConfigStructure(previous: unknown, current: unknown, preservePaths: readonly string[] = []): ConfigMerge {
    const removed: string[] = [], restored: string[] = [], preservableObjects: string[] = [];
    const preserved = new Set(preservePaths);
    let nodes = 0;
    const merge = (template: unknown, value: unknown, path: string, depth: number): unknown => {
        if (depth > 64 || ++nodes > 100000) throw new Error('Configuration structure is too complex');
        if (preserved.has(path) && value !== undefined) { preservableObjects.push(path); return value; }
        if (value === undefined) { restored.push(path); return template; }
        if (template === null) return value;
        if (Array.isArray(template) && Array.isArray(value)) {
            if (!template.length) return value;
            return value.map((entry, index) => {
                const sample = arraySample(template, entry, `${path}[${index}]`);
                return merge(sample, entry, `${path}[${index}]`, depth + 1);
            });
        }
        if (object(template) && object(value)) {
            // Empty objects can be user-defined dictionaries; their keys reveal no historical schema.
            if (!Object.keys(template).length) return value;
            if (path !== '$' && Object.keys(value).some(key => safeKey(key) && !Object.prototype.hasOwnProperty.call(template, key))) preservableObjects.push(path);
            for (const key of Object.keys(value)) if (!safeKey(key) || !Object.prototype.hasOwnProperty.call(template, key)) removed.push(fieldPath(path, key));
            return Object.fromEntries(Object.entries(template).filter(([key]) => safeKey(key))
                .map(([key, entry]) => [key, merge(entry, Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined, fieldPath(path, key), depth + 1)]));
        }
        if (Array.isArray(template) !== Array.isArray(value) || typeof template !== typeof value || value === null) { restored.push(path); return template; }
        return value;
    };
    return { value: merge(previous, current, '$', 0), removed, restored, preservableObjects };
}
