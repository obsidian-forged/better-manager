import MarkdownIt from 'markdown-it';
import { documentUrl, RepositoryDocument } from './repository-document';

const parser = new MarkdownIt({ html: false, linkify: true });
type Token = ReturnType<typeof parser.parse>[number];
const tags = new Set<keyof HTMLElementTagNameMap>(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'strong', 'em', 's', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);

/** 通过原生 DOM 绘制 Markdown token，代码始终是文本 / Render tokens with native DOM helpers; code stays inert. */
export function renderRepositoryDocument(container: HTMLElement, document: RepositoryDocument): void {
    container.addClass('markdown-rendered', 'manager-catalog-document');
    const draw = (tokens: Token[], root: HTMLElement): void => {
        const stack = [root];
        for (const token of tokens) {
            const parent = stack[stack.length - 1];
            if (token.nesting === -1) { if (stack.length > 1) stack.pop(); continue; }
            if (token.type === 'inline') { draw(token.children || [], parent); continue; }
            if (token.type === 'image') {
                const source = token.attrGet('src');
                const src = documentUrl(typeof source === 'string' ? source : '', document, true);
                if (src) parent.createEl('img', { attr: { src, alt: token.content, loading: 'lazy', referrerpolicy: 'no-referrer' } });
                else parent.appendText(token.content);
            } else if (token.type === 'link_open') {
                const target = token.attrGet('href');
                const href = documentUrl(typeof target === 'string' ? target : '', document);
                stack.push(href ? parent.createEl('a', { attr: { href, target: '_blank', rel: 'noopener noreferrer' } }) : parent.createSpan());
            } else if (token.type === 'fence' || token.type === 'code_block') parent.createEl('pre').createEl('code', { text: token.content });
            else if (token.type === 'code_inline') parent.createEl('code', { text: token.content });
            else if (token.type === 'hardbreak') parent.createEl('br');
            else if (token.type === 'softbreak') parent.appendText('\n');
            else if (token.type === 'hr') parent.createEl('hr');
            else if (token.nesting === 1) {
                const tag = token.tag as keyof HTMLElementTagNameMap;
                const element = tags.has(tag) ? parent.createEl(tag) : parent.createSpan();
                const start = token.attrGet('start');
                if (tag === 'ol' && (typeof start === 'string' || typeof start === 'number')) element.setAttribute('start', `${start}`);
                stack.push(element);
            } else parent.appendText(token.content);
        }
    };
    draw(parser.parse(document.markdown, {}), container);
}
