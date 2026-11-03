import { normalizePath, requestUrl } from "obsidian";
import type Manager from "main";
import { resolveGithubUrl } from "../github-url";
import { CatalogService, catalogUrl, MAX_SOURCE_BYTES } from "./catalog";
import { CatalogTryList } from "./try-list";
import { pluginStorage } from '../storage/plugin-storage';
import { parseRepositoryDocument, RepositoryDocument } from './repository-document';
import { catalogRepo, record } from './catalog';
import { assertHttpSuccess } from '../network/http-error';

const services = new WeakMap<Manager, CatalogService>();
const tryLists = new WeakMap<Manager, CatalogTryList>();
const documents = new WeakMap<Manager, Map<string, Promise<RepositoryDocument>>>();

/** 文档按需读取，失败可重试；缓存归入插件 cache 目录 / On-demand documents use the plugin cache, with retry after errors. */
export async function getRepositoryDocument(manager: Manager, repoInput: string): Promise<RepositoryDocument> {
    const repo = catalogRepo(repoInput).toLowerCase();
    let cache = documents.get(manager);
    if (!cache) { cache = new Map(); documents.set(manager, cache); }
    const pending = cache.get(repo);
    if (pending) return pending;
    const work = (async () => {
        const files = pluginStorage(manager);
        const name = `readme/${repo}.json`;
        const cached = await files.read('cache', name);
        if (cached) {
            try {
                const snapshot: unknown = JSON.parse(cached);
                if (record(snapshot) && typeof snapshot.fetchedAt === 'number' && Date.now() - snapshot.fetchedAt >= 0 && Date.now() - snapshot.fetchedAt < 3600000) {
                    return parseRepositoryDocument(repo, snapshot.payload);
                }
            } catch (error) { if (manager.settings.DEBUG) console.warn('[BPM] README cache invalid', error); }
        }
        const payload = await catalogRequest(manager, `https://api.github.com/repos/${repo}/readme`, true);
        const document = parseRepositoryDocument(repo, payload);
        await files.write('cache', name, JSON.stringify({ fetchedAt: document.fetchedAt, payload }));
        return document;
    })();
    cache.set(repo, work);
    // 仅合并进行中的请求，完成后交由有时效的磁盘缓存 / Deduplicate requests; disk cache controls freshness.
    try { return await work; } finally { cache.delete(repo); }
}

async function catalogRequest(manager: Manager, input: string, githubApi: boolean): Promise<unknown> {
    const original = catalogUrl(input);
    const url = resolveGithubUrl(manager, original);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (githubApi && new URL(original).hostname === 'api.github.com' && new URL(url).hostname === 'api.github.com') {
        const token = await manager.getGithubToken();
        if (token) headers.Authorization = `Bearer ${token}`;
    }
    const response = await requestUrl({ url, headers, throw: false });
    assertHttpSuccess(response);
    if (response.arrayBuffer.byteLength > MAX_SOURCE_BYTES) throw new Error('Catalog response exceeds 16 MiB');
    const value: unknown = response.json;
    return value;
}

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
        request(input, githubApi) { return catalogRequest(manager, input, githubApi); },
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
