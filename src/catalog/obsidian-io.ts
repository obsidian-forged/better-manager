import { normalizePath, requestUrl } from "obsidian";
import type Manager from "main";
import { resolveGithubUrl } from "../github-url";
import { CatalogService, catalogUrl, MAX_SOURCE_BYTES } from "./catalog";
import { CatalogTryList } from "./try-list";
import { pluginStorage } from '../storage/plugin-storage';

const services = new WeakMap<Manager, CatalogService>();
const tryLists = new WeakMap<Manager, CatalogTryList>();

export function getCatalogTryList(manager: Manager): CatalogTryList {
    const existing = tryLists.get(manager);
    if (existing) return existing;
    const path = normalizePath(`${manager.app.vault.configDir}/plugins/${manager.manifest.id}/catalog-try-list.json`);
    const files = pluginStorage(manager);
    const library = new CatalogTryList({
        async read() {
            const text = await files.read('data', 'catalog-try-list.json', [path]);
            if (text === undefined) return undefined;
            const value: unknown = JSON.parse(text);
            return value;
        },
        async write(value) { await files.write('data', 'catalog-try-list.json', JSON.stringify(value)); },
    });
    tryLists.set(manager, library);
    return library;
}

/** 所有自定义源均无认证请求；GitHub 密钥仅发往官方 API / Never forward GitHub credentials to catalog servers or proxies. */
export function getCatalogService(manager: Manager): CatalogService {
    const existing = services.get(manager);
    if (existing) return existing;
    const path = normalizePath(`${manager.app.vault.configDir}/plugins/${manager.manifest.id}/catalog-cache.json`);
    const files = pluginStorage(manager);
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
            const json = await files.read('cache', 'catalog-cache.json', [path]);
            if (json === undefined) return undefined;
            const value: unknown = JSON.parse(json);
            return value;
        },
        async write(value) { await files.write('cache', 'catalog-cache.json', JSON.stringify(value)); },
    });
    services.set(manager, service);
    return service;
}
