import { normalizePath, requestUrl } from "obsidian";
import type Manager from "main";
import { resolveGithubUrl } from "../github-url";
import { CatalogService, catalogUrl, MAX_SOURCE_BYTES } from "./catalog";
import { CatalogTryList } from "./try-list";

const services = new WeakMap<Manager, CatalogService>();
const tryLists = new WeakMap<Manager, CatalogTryList>();

export function getCatalogTryList(manager: Manager): CatalogTryList {
    const existing = tryLists.get(manager);
    if (existing) return existing;
    const adapter = manager.app.vault.adapter;
    const path = normalizePath(`${manager.app.vault.configDir}/plugins/${manager.manifest.id}/catalog-try-list.json`);
    const library = new CatalogTryList({
        async read() {
            if (!(await adapter.exists(path))) return undefined;
            const value: unknown = JSON.parse(await adapter.read(path));
            return value;
        },
        async write(value) { await adapter.write(path, JSON.stringify(value)); },
    });
    tryLists.set(manager, library);
    return library;
}

/** 所有自定义源均无认证请求；GitHub 密钥仅发往官方 API / Never forward GitHub credentials to catalog servers or proxies. */
export function getCatalogService(manager: Manager): CatalogService {
    const existing = services.get(manager);
    if (existing) return existing;
    const adapter = manager.app.vault.adapter;
    const path = normalizePath(`${manager.app.vault.configDir}/plugins/${manager.manifest.id}/catalog-cache.json`);
    const service = new CatalogService({
        async request(input, githubApi) {
            const original = catalogUrl(input);
            const url = resolveGithubUrl(manager, original);
            const headers: Record<string, string> = { Accept: "application/json" };
            if (githubApi && new URL(original).hostname === "api.github.com" && new URL(url).hostname === "api.github.com") {
                const token = await manager.getGithubToken();
                if (token) headers.Authorization = `Bearer ${token}`;
            }
            const response = await requestUrl({ url, headers, throw: false });
            if (response.status >= 400) {
                const reset = response.headers["x-ratelimit-reset"];
                const resetTime = reset ? Number(reset) * 1000 : NaN;
                const limit = response.status === 403 || response.status === 429;
                throw new Error(`HTTP ${response.status}${limit ? ` (request limit or access denied${Number.isFinite(resetTime) ? `; reset ${new Date(resetTime).toISOString()}` : ""})` : ""}`);
            }
            if (response.arrayBuffer.byteLength > MAX_SOURCE_BYTES) throw new Error("Catalog response exceeds 16 MiB");
            const value: unknown = response.json;
            return value;
        },
        async read() {
            if (!(await adapter.exists(path))) return undefined;
            const json = await adapter.read(path);
            const value: unknown = JSON.parse(json);
            return value;
        },
        async write(value) { await adapter.write(path, JSON.stringify(value)); },
    });
    services.set(manager, service);
    return service;
}
