import type { ReleaseVersion } from '../github-install';
import type { PluginUpdateCheckMode, ReleaseCompatibilityMode } from '../settings/data';

export type InstallationSource = { kind: 'github'; repo: string } | { kind: 'catalog'; key: string; sourceId: string; pluginId: string; url?: string };
export interface InstalledRelease {
    source: InstallationSource;
    tag: string;
    manifestVersion: string;
    publishedAt?: string;
    isGithubLatest?: boolean;
}
export interface SkippedRelease { source: string; tag: string; manifestVersion?: string }
export interface UpdateRule { excluded?: boolean; skipped?: SkippedRelease[]; muteUntil?: number }
export type UpdateRules = Record<string, UpdateRule>;
export type UpdateReason = 'excluded' | 'skipped-version' | 'unknown-source' | 'source-unavailable' | 'source-disabled' | 'incompatible' | 'prerelease' | 'too-new' | 'metadata-unavailable' | 'up-to-date' | 'check-failed' | 'self' | 'changed' | 'cancelled';
export interface UpdateStatus {
    source: 'official' | 'github' | 'catalog' | 'unknown';
    localVersion?: string;
    remoteVersion?: string | null;
    remotePublishedAt?: string;
    hasUpdate?: boolean;
    message?: string;
    error?: string;
    checkedAt?: number;
    repo?: string | null;
    versions?: ReleaseVersion[];
    checkMode?: PluginUpdateCheckMode;
    updateDelayDays?: number;
    reason?: UpdateReason;
    sourceIdentity?: string;
    sourceLabel?: string;
    installationSource?: InstallationSource;
    target?: ReleaseVersion;
    fingerprint?: string;
}
export interface UpdateCheckOptions {
    updateCheckMode?: PluginUpdateCheckMode;
    compatibilityMode?: ReleaseCompatibilityMode;
    updateDelayDays?: number;
    force?: boolean;
}
export interface BatchUpdateRow { pluginId: string; name: string; status: UpdateStatus }
export interface BatchUpdatePlan { createdAt: number; rows: BatchUpdateRow[] }
export interface BatchUpdateResult { row: BatchUpdateRow; outcome: 'updated' | 'failed' | 'skipped'; reason?: UpdateReason; error?: string }
export interface BatchUpdateReport { results: BatchUpdateResult[]; refreshError?: string }
