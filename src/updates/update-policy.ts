import type { InstalledRelease, InstallationSource, UpdateReason, UpdateRule, UpdateRules } from './types';
import { releaseTagsMatch } from '../source-release';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export class UpdateGuardError extends Error {
    constructor(readonly reason: UpdateReason, message: string) { super(message); this.name = 'UpdateGuardError'; }
}

export function sourceIdentity(source: InstallationSource): string {
    return source.kind === 'github' ? `github:${source.repo.trim().toLowerCase()}` : `catalog:${source.key}`;
}

/** 从旧配置或外部同步中收窄规则 / Validate rules loaded from older settings or external sync. */
export function readUpdateRule(rules: unknown, id: string): UpdateRule {
    const value = record(rules) && Object.prototype.hasOwnProperty.call(rules, id) ? rules[id] : undefined;
    if (!record(value)) return {};
    return {
        excluded: value.excluded === true,
        muteUntil: typeof value.muteUntil === 'number' && Number.isFinite(value.muteUntil) && value.muteUntil > 0 ? value.muteUntil : undefined,
        skipped: Array.isArray(value.skipped) ? value.skipped.flatMap(item => record(item) && typeof item.source === 'string' && typeof item.tag === 'string' && item.tag.trim()
            ? [{ source: item.source, tag: item.tag, manifestVersion: typeof item.manifestVersion === 'string' ? item.manifestVersion : undefined }] : []) : [],
    };
}

export function updateBlockReason(rules: unknown, id: string, identity?: string, tag?: string): 'excluded' | 'skipped-version' | undefined {
    const rule = readUpdateRule(rules, id);
    if (rule.excluded) return 'excluded';
    if (identity && tag && rule.skipped?.some(item => item.source === identity && releaseTagsMatch(item.tag, tag))) return 'skipped-version';
    return undefined;
}

export function notificationsMuted(rules: unknown, id: string, now = Date.now()): boolean {
    return (readUpdateRule(rules, id).muteUntil || 0) > now;
}

export function writeUpdateRule(rules: UpdateRules | undefined, id: string, rule: UpdateRule): UpdateRules {
    const next = { ...rules };
    if (!rule.excluded && !rule.muteUntil && !rule.skipped?.length) delete next[id];
    else next[id] = rule;
    return next;
}

export function readInstalledRelease(input: unknown): InstalledRelease | undefined {
    if (!record(input) || !record(input.source) || typeof input.tag !== 'string' || typeof input.manifestVersion !== 'string') return undefined;
    const source = input.source;
    if (source.kind === 'github' && typeof source.repo === 'string' && /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(source.repo)) {
        return { source: { kind: 'github', repo: source.repo }, tag: input.tag, manifestVersion: input.manifestVersion, publishedAt: typeof input.publishedAt === 'string' ? input.publishedAt : undefined, isGithubLatest: input.isGithubLatest === true };
    }
    if (source.kind === 'catalog' && typeof source.key === 'string' && typeof source.sourceId === 'string' && typeof source.pluginId === 'string') {
        return { source: { kind: 'catalog', key: source.key, sourceId: source.sourceId, pluginId: source.pluginId, url: typeof source.url === 'string' ? source.url : undefined }, tag: input.tag, manifestVersion: input.manifestVersion, publishedAt: typeof input.publishedAt === 'string' ? input.publishedAt : undefined };
    }
    return undefined;
}
