import { Platform, requireApiVersion } from "obsidian";
import type { BetaSource } from "./data/types";
import type { ReleaseVersion } from "./github-install";
import { hasKnownPublicationDate, isReleaseOldEnough } from "./release-policy";

export interface SourceReleaseRef {
	tag: string;
	publishedAt?: string;
	prerelease?: boolean;
	index?: number;
	isGithubLatest?: boolean;
}

export interface SourceReleaseCheck {
	target: SourceReleaseRef | null;
	installed: SourceReleaseRef | null;
}

const cleanReleaseTag = (tag?: string | null): string => (tag || "").trim();

const normalizeReleaseTag = (tag?: string | null): string => {
	const cleaned = cleanReleaseTag(tag).replace(/^refs\/tags\//i, "");
	return cleaned.replace(/^v(?=\d)/i, "");
};

export const releaseTagsMatch = (a?: string | null, b?: string | null): boolean => {
	const left = cleanReleaseTag(a);
	const right = cleanReleaseTag(b);
	if (!left || !right) return false;
	if (left === right) return true;
	const normalizedLeft = normalizeReleaseTag(left);
	const normalizedRight = normalizeReleaseTag(right);
	return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

const releaseToRef = (release: ReleaseVersion, index: number): SourceReleaseRef => ({
	tag: release.version,
	publishedAt: release.publishedAt,
	prerelease: release.prerelease,
	index,
	isGithubLatest: release.isGithubLatest,
});

const normalizeUpdateDelayDays = (source: BetaSource): number => {
	const value = Number(source.updateDelayDays);
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.floor(value);
};

const parseReleaseDate = (value?: string): number | null => {
	if (!value) return null;
	const time = new Date(value).getTime();
	return Number.isNaN(time) ? null : time;
};

const releaseIsMatureEnough = (source: BetaSource, release: ReleaseVersion, now = Date.now()): boolean => {
	const delayDays = normalizeUpdateDelayDays(source);
	return isReleaseOldEnough(release.publishedAt, delayDays, now);
};

export const releaseIsCompatible = (release: ReleaseVersion): boolean => {
	if (Platform?.isMobile && release.isDesktopOnly) return false;
	const minAppVersion = release.minAppVersion?.trim();
	if (!minAppVersion) return release.compatibilityChecked !== false;
	try {
		return requireApiVersion(minAppVersion);
	} catch {
		return false;
	}
};

const sourceTargetIsMatureEnough = (source: BetaSource): boolean => {
	const delayDays = normalizeUpdateDelayDays(source);
	return isReleaseOldEnough(source.latestReleasePublishedAt || source.latestPublishedAt, delayDays);
};

export const findReleaseByTag = (versions: ReleaseVersion[], tag?: string | null): SourceReleaseRef | null => {
	const cleaned = cleanReleaseTag(tag);
	if (!cleaned) return null;
	const exactIndex = versions.findIndex((release) => cleanReleaseTag(release.version) === cleaned);
	if (exactIndex >= 0) return releaseToRef(versions[exactIndex], exactIndex);
	const normalizedIndex = versions.findIndex((release) => releaseTagsMatch(release.version, cleaned));
	return normalizedIndex >= 0 ? releaseToRef(versions[normalizedIndex], normalizedIndex) : null;
};

export const pickSourceTargetRelease = (source: BetaSource, versions: ReleaseVersion[]): SourceReleaseRef | null => {
	if (source.mode === "frozen") {
		const pinnedTag = cleanReleaseTag(source.frozenVersion)
			|| cleanReleaseTag(source.latestReleaseTag)
			|| cleanReleaseTag(source.latestVersion);
		if (!pinnedTag) return null;
		const exact = findReleaseByTag(versions, pinnedTag);
		const pinned = versions.find(item => releaseTagsMatch(item.version, pinnedTag));
		if (pinned && ((source.compatibilityMode !== 'all' && !releaseIsCompatible(pinned)) || (!source.includePrerelease && pinned.prerelease))) return null;
		const fallback = exact ?? {
			tag: pinnedTag,
			publishedAt: source.latestReleasePublishedAt || source.latestPublishedAt,
		};
		return isReleaseOldEnough(fallback.publishedAt, normalizeUpdateDelayDays(source)) ? fallback : null;
	}

	const compatibleVersions = source.compatibilityMode === "all"
		? versions
		: versions.filter((item) => releaseIsCompatible(item));
	const candidates = source.includePrerelease
		? compatibleVersions
		: compatibleVersions.filter((item) => !item.prerelease);
	const githubLatest = candidates.find((item) => item.isGithubLatest);
	const release = githubLatest && releaseIsMatureEnough(source, githubLatest)
		? githubLatest
		: candidates.find((item) => releaseIsMatureEnough(source, item));
	if (!release) return null;
	return releaseToRef(release, versions.indexOf(release));
};

export const resolveInstalledSourceRelease = (
	source: BetaSource,
	versions: ReleaseVersion[],
	localVersion?: string
): SourceReleaseRef | null => {
	const candidates = [
		source.installedReleaseTag,
		localVersion,
		source.localVersion,
	].filter(Boolean) as string[];

	for (const candidate of candidates) {
		const release = findReleaseByTag(versions, candidate);
		if (release) return release;
	}

	const storedTag = cleanReleaseTag(source.installedReleaseTag);
	if (storedTag) {
		return {
			tag: storedTag,
			publishedAt: source.installedReleasePublishedAt,
		};
	}
	const matchingManifest = versions.find(item => item.manifestVersion && releaseTagsMatch(item.manifestVersion, localVersion));
	if (matchingManifest) return releaseToRef(matchingManifest, versions.indexOf(matchingManifest));

	const fallbackTag = cleanReleaseTag(localVersion || source.localVersion);
	return fallbackTag ? { tag: fallbackTag, publishedAt: source.installedReleasePublishedAt } : null;
};

export const syncSourceReleaseCheck = (
	source: BetaSource,
	versions: ReleaseVersion[],
	localVersion?: string
): SourceReleaseCheck => {
	const target = pickSourceTargetRelease(source, versions);
	const installed = resolveInstalledSourceRelease(source, versions, localVersion);
	const eligible = versions.filter(item =>
		(source.compatibilityMode === "all" || releaseIsCompatible(item))
		&& (source.includePrerelease || !item.prerelease));
	const delayDays = normalizeUpdateDelayDays(source);
	source.deferredPublicationDate = delayDays > 0 && !target && (
		versions.length === 0
			? Boolean(source.latestReleaseTag || source.latestVersion)
			: source.mode === "frozen"
				? Boolean(source.frozenVersion && !hasKnownPublicationDate(source.latestReleasePublishedAt || source.latestPublishedAt))
				: eligible.some(item => !hasKnownPublicationDate(item.publishedAt))
	);

	source.localVersion = localVersion || source.localVersion || "";
	source.latestReleaseTag = target?.tag || "";
	source.latestReleasePublishedAt = target?.publishedAt;
	source.latestReleaseIsGithubLatest = target?.isGithubLatest;
	source.latestVersion = target?.tag || "";
	source.latestManifestVersion = versions.find(item => item.version === target?.tag)?.manifestVersion;
	source.latestPublishedAt = target?.publishedAt;

	if (installed?.tag) source.installedReleaseTag = installed.tag;
	if (installed?.publishedAt) source.installedReleasePublishedAt = installed.publishedAt;
	source.installedReleaseIsGithubLatest = installed?.isGithubLatest;

	return { target, installed };
};

export const markSourceInstalledRelease = (
	source: BetaSource,
	releaseTag: string,
	publishedAt?: string,
	localVersion?: string
): void => {
	const tag = cleanReleaseTag(releaseTag);
	if (tag) source.installedReleaseTag = tag;
	source.installedReleasePublishedAt = publishedAt || source.installedReleasePublishedAt;
	if (releaseTagsMatch(tag, source.latestReleaseTag)) {
		source.installedReleaseIsGithubLatest = source.latestReleaseIsGithubLatest;
	}
	source.localVersion = localVersion || source.localVersion || tag;
};

const compareVersionTags = (a = "0.0.0", b = "0.0.0"): number => {
	const pa = a.replace(/^v/i, "").split(".").map(Number);
	const pb = b.replace(/^v/i, "").split(".").map(Number);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const ai = Number.isFinite(pa[i]) ? pa[i] : 0;
		const bi = Number.isFinite(pb[i]) ? pb[i] : 0;
		if (ai > bi) return 1;
		if (ai < bi) return -1;
	}
	return 0;
};

export const sourceUsesReleaseUpdateCheck = (source: BetaSource): boolean =>
	source.updateCheckMode !== "version";

export const sourceHasVersionUpdate = (source: BetaSource): boolean => {
	const targetVersion = cleanReleaseTag(
		source.latestManifestVersion || (source.mode === "frozen"
			? source.frozenVersion || source.latestVersion || source.latestReleaseTag
			: source.latestVersion || source.latestReleaseTag)
	);
	const localVersion = cleanReleaseTag(source.localVersion || source.installedReleaseTag);

	if (!targetVersion || !localVersion) return false;
	if (!sourceTargetIsMatureEnough(source)) return false;
	return source.mode === "frozen"
		? !releaseTagsMatch(targetVersion, localVersion)
		: compareVersionTags(targetVersion, localVersion) > 0;
};

export const sourceHasReleaseUpdate = (source: BetaSource): boolean => {
	const targetTag = source.mode === "frozen"
		? cleanReleaseTag(source.frozenVersion || source.latestReleaseTag || source.latestVersion)
		: cleanReleaseTag(source.latestReleaseTag || source.latestVersion);
	const installedTag = cleanReleaseTag(source.installedReleaseTag || source.localVersion);

	if (!targetTag || !installedTag) return false;
	if (releaseTagsMatch(targetTag, installedTag)) return false;
	if (!sourceTargetIsMatureEnough(source)) return false;
	if (source.compatibilityMode !== "all" && source.installedReleaseIsGithubLatest && !source.latestReleaseIsGithubLatest) return false;

	if (source.mode === "frozen") return true;
	if (source.latestReleaseIsGithubLatest && !source.installedReleaseIsGithubLatest) return true;

	const targetDate = parseReleaseDate(source.latestReleasePublishedAt || source.latestPublishedAt);
	const installedDate = parseReleaseDate(source.installedReleasePublishedAt);
	if (targetDate !== null && installedDate !== null) return targetDate > installedDate;

	return true;
};

export const sourceHasUpdate = (source: BetaSource): boolean =>
	!source.updatePolicyReason && (sourceUsesReleaseUpdateCheck(source)
		? sourceHasReleaseUpdate(source)
		: sourceHasVersionUpdate(source));
