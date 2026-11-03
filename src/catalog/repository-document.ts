import { catalogRepo, record, text } from './catalog';

export interface RepositoryDocument {
    markdown: string;
    pageUrl: string;
    imageUrl: string;
    fetchedAt: number;
}

/** 远程文档不经过库内 Markdown 后处理器 / Remote documents never run vault Markdown processors. */
export function parseRepositoryDocument(repoInput: string, value: unknown): RepositoryDocument {
    const repo = catalogRepo(repoInput);
    if (!record(value) || value.encoding !== 'base64' || typeof value.content !== 'string') throw new Error('README content unavailable');
    if (value.content.length > 2800000) throw new Error('README exceeds 2 MiB');
    const path = text(value.path) || 'README.md';
    if (path.split('/').some(part => !part || part === '.' || part === '..') || path.includes('\\') || [...path].some(char => char.charCodeAt(0) < 32)) throw new Error('Invalid README path');
    const bytes = Uint8Array.from(atob(value.content.replace(/\s/g, '')), char => char.charCodeAt(0));
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    return {
        markdown: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        pageUrl: `https://github.com/${repo}/blob/HEAD/${encodedPath}`,
        imageUrl: `https://raw.githubusercontent.com/${repo}/HEAD/${encodedPath}`,
        fetchedAt: Date.now(),
    };
}

/** 仅允许网页链接和远程图片；相对路径以文档所在目录为准 / Resolve links against the document, never the vault. */
export function documentUrl(input: string, document: RepositoryDocument, image = false): string | undefined {
    try {
        const base = image ? document.imageUrl : document.pageUrl;
        const root = new URL(base).pathname.split('/').slice(0, image ? 4 : 5).join('/') + '/';
        const url = input.startsWith('/') && !input.startsWith('//')
            ? new URL(root + input.slice(1), base) : new URL(input, base);
        if (!['https:', ...(image ? [] : ['mailto:'])].includes(url.protocol) || url.username || url.password) return undefined;
        return url.href;
    } catch { return undefined; }
}
