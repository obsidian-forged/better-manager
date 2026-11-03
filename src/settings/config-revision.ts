import { settingsFingerprint } from './session-store';

export type ConfigRecord = Record<string, unknown>;
export type DigestText = (text: string) => Promise<string>;
export const CONFIG_REVISION_KEY = '_bpmRevision';
export interface ConfigRevision {
    schema: 1;
    id: string;
    generation: number;
    device: string;
    parents: string[];
    ancestors: string[];
    digest: string;
    files: Record<string, string | null>;
}
export interface ConfigSnapshot {
    id: string;
    value: ConfigRecord;
    digest: string;
    revision?: ConfigRevision;
    files: Record<string, string | null>;
}
export type RevisionRelation = 'same' | 'ancestor' | 'descendant' | 'conflict';
const record = (value: unknown): value is ConfigRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const digestPattern = /^[a-f0-9]{64}$/;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^(?:legacy-)?[a-f0-9]{64}$/.test(value);
const ids = (value: unknown, limit: number): value is string[] => Array.isArray(value) && value.length <= limit
    && value.every(identifier) && new Set(value).size === value.length;
const safeFile = (path: string): boolean => /^(?:data\/icons\.css|data\/devices\/[^/]+\.json)$/.test(path)
    && !path.includes('..') && !path.includes('\\');

function revisionOf(value: unknown): ConfigRevision | undefined {
    if (!record(value) || value.schema !== 1 || !identifier(value.id) || !Number.isSafeInteger(value.generation)
        || typeof value.generation !== 'number' || value.generation < 1 || typeof value.device !== 'string'
        || !/^[a-z0-9-]{8,80}$/.test(value.device) || !ids(value.parents, 16) || !ids(value.ancestors, 256)
        || typeof value.digest !== 'string' || !digestPattern.test(value.digest) || !record(value.files)) return undefined;
    const files: Record<string, string | null> = {};
    for (const [path, digest] of Object.entries(value.files)) {
        if (!safeFile(path) || digest !== null && (typeof digest !== 'string' || !digestPattern.test(digest))) return undefined;
        files[path] = digest;
    }
    return { schema: 1, id: value.id, generation: value.generation, device: value.device,
        parents: value.parents, ancestors: value.ancestors, digest: value.digest, files };
}

/** A revision identifies semantic content and ancestry, never wall-clock time or mtime. */
export async function decodeConfig(value: unknown, hash: DigestText): Promise<ConfigSnapshot> {
    if (!record(value)) throw new Error('Invalid BPM configuration');
    // Hash the JSON representation that can actually reach disk, and detach mutable UI references.
    const serialized: unknown = JSON.parse(JSON.stringify(value));
    if (!record(serialized)) throw new Error('Invalid BPM configuration');
    const payload: ConfigRecord = {};
    for (const key of Object.keys(serialized)) {
        if ([CONFIG_REVISION_KEY, '__proto__', 'constructor', 'prototype'].includes(key)) continue;
        payload[key] = serialized[key];
    }
    const digest = await hash(settingsFingerprint(payload));
    if (!(CONFIG_REVISION_KEY in serialized)) return { id: `legacy-${digest}`, value: payload, digest, files: {} };
    const revision = revisionOf(serialized[CONFIG_REVISION_KEY]);
    if (!revision || revision.digest !== digest) throw new Error('BPM configuration revision does not match its contents');
    const { id, ...body } = revision;
    if (await hash(settingsFingerprint(body)) !== id || revision.ancestors.includes(id) || revision.parents.includes(id)
        || revision.parents.some(parent => !revision.ancestors.includes(parent))) throw new Error('Invalid BPM configuration ancestry');
    return { id, value: payload, digest, revision, files: revision.files };
}

export function compareConfig(local: ConfigSnapshot, incoming: ConfigSnapshot): RevisionRelation {
    if (local.id === incoming.id) return 'same';
    if (local.revision?.ancestors.includes(incoming.id)) return 'ancestor';
    if (incoming.revision?.ancestors.includes(local.id)) return 'descendant';
    if (sameConfigContent(local, incoming)) return 'same';
    return 'conflict';
}

export function sameConfigContent(local: ConfigSnapshot, incoming: ConfigSnapshot): boolean {
    return local.digest === incoming.digest && settingsFingerprint(local.files) === settingsFingerprint(incoming.files);
}

export async function createConfigRevision(value: ConfigRecord, device: string, parents: ConfigSnapshot[],
    files: Record<string, string | null>, hash: DigestText): Promise<ConfigSnapshot> {
    if (!parents.length || parents.length > 16) throw new Error('A configuration commit requires a known parent');
    const normalized = await decodeConfig(value, hash);
    const digest = normalized.digest;
    const ancestors = [...new Set([...parents.map(parent => parent.id), ...parents.flatMap(parent => parent.revision?.ancestors ?? [])])].slice(0, 256);
    const body = { schema: 1 as const, generation: Math.max(...parents.map(parent => parent.revision?.generation ?? 0)) + 1,
        device, parents: [...new Set(parents.map(parent => parent.id))], ancestors, digest, files };
    const revision = { ...body, id: await hash(settingsFingerprint(body)) };
    // Validate our output through the same boundary used for synced files.
    return decodeConfig({ ...normalized.value, [CONFIG_REVISION_KEY]: revision }, hash);
}

export function encodeConfig(snapshot: ConfigSnapshot): ConfigRecord {
    return snapshot.revision ? { ...snapshot.value, [CONFIG_REVISION_KEY]: snapshot.revision } : snapshot.value;
}
