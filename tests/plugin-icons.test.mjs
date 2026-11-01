import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({ entryPoints: ['src/icons/plugin-icons.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['obsidian'], write: false });
function fixture({ builtin = {}, status = 200, cached = '', communityIcon } = {}) {
    const module = { exports: {} }, requests = [], writes = [], styles = [];
    const glyph = name => ({ outerHTML: `<svg>${name}</svg>`, querySelectorAll: () => [] });
    const obsidian = {
        getIcon: name => builtin[name] ? glyph(name) : null,
        setIcon: (el, name) => { el.icon = name; }, normalizePath: path => path,
        requestUrl: async options => {
            requests.push(options.url);
            if (options.url.includes('community.obsidian.md/plugins?q=')) {
                return { status: 200, text: '{\\"apiKey\\":\\"TESTKEY\\"}' };
            }
            if (options.url.includes('/api/search/')) {
                return { status: 200, json: { hits: communityIcon ? [{ document: { slug: 'example', lucide_icon_name: communityIcon } }] : [] } };
            }
            return { status, text: '<svg>downloaded</svg>' };
        },
    };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(() => obsidian, module, module.exports);
    const adapter = { exists: async path => path.endsWith('icons.css') && !!cached, read: async () => cached,
        mkdir: async () => {}, write: async (path, value) => { writes.push([path, value]); } };
    const manager = { manifest: { id: 'bpm' }, settings: {}, appPlugins: { manifests: { example: { name: 'Example', icon: 'new-lucide', icon_color: 'blue' } } },
        app: { vault: { configDir: '.obsidian', adapter }, workspace: {} } };
    const service = new module.exports.PluginIcons(manager);
    // DOM parsing is isolated here; these cases exercise fallback selection and persistence.
    service.parse = text => text.includes('<svg>') ? glyph('cached-or-downloaded') : undefined;
    const doc = { head: { createEl: () => { const style = { remove() {} }; styles.push(style); return style; } }, importNode: node => node };
    const element = () => ({ dataset: {}, ownerDocument: doc, cssProps: {}, empty() { this.icon = null; }, appendChild(node) { this.icon = node.outerHTML; }, setCssProps(props) { this.cssProps = { ...this.cssProps, ...props }; } });
    return { ...module.exports, service, manager, requests, writes, styles, element };
}
async function settle() { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); }
test('registered native icons win without downloading and preserve custom CSS', async () => {
    const f = fixture({ builtin: { 'new-lucide': true }, cached: '/* user styles */\n.my-rule { color: red; }' });
    const el = f.element(); f.service.render(el, 'example', true); await settle();
    assert.equal(el.icon, '<svg>new-lucide</svg>');
    assert.equal(f.requests.length, 0);
    assert.match(f.writes[0][1], /my-rule/);
    assert.match(f.writes[0][1], /--bpm-plugin-icon-color: #027aff/);
});
test('missing native glyph downloads once across cards and reuses persisted CSS offline', async () => {
    const f = fixture(); const a = f.element(), b = f.element();
    f.service.render(a, 'example', true); f.service.render(b, 'example', false); await settle();
    assert.equal(f.requests.length, 1); assert.match(a.icon, /cached-or-downloaded/); assert.equal(a.icon, b.icon);
    assert.match(f.requests[0], /^https:\/\/raw.githubusercontent.com\/lucide-icons\/lucide\/main\/icons\/new-lucide.svg$/);
    const offline = fixture({ status: 404, cached: f.writes.at(-1)[1] }); const el = offline.element();
    offline.service.render(el, 'example', true); await settle();
    assert.match(el.icon, /cached-or-downloaded/); assert.equal(offline.requests.length, 0);
});
test('download failure leaves the existing default and does not repeatedly retry', async () => {
    const f = fixture({ status: 404 }); const el = f.element();
    f.service.render(el, 'example', true); await settle(); assert.equal(el.icon, 'plug-zap');
    f.service.render(el, 'example', false); await settle(); assert.equal(el.icon, 'plug');
    assert.equal(f.requests.filter(url => url.includes('lucide-icons')).length, 1);
});

test('community-assigned icon name is used when local glyphs are unavailable', async () => {
    const f = fixture({ status: 404, builtin: { 'pencil-ruler': true }, communityIcon: 'pencil-ruler' });
    const el = f.element();
    f.service.render(el, 'example', true); await settle();
    assert.equal(el.icon, '<svg>pencil-ruler</svg>');
    assert.ok(f.requests.some(url => url.includes('community.obsidian.md/plugins?q=')));
    assert.ok(f.requests.some(url => url.includes('/api/search/')));
    assert.match(f.writes.at(-1)[1], /pencil-ruler/);
});
test('late downloads cannot overwrite a newly assigned plugin icon', async () => {
    const f = fixture(); const el = f.element();
    f.service.render(el, 'example', true); f.service.render(el, 'other', false); await settle();
    assert.equal(el.icon, 'plug');
});
test('download names and colour values reject URLs and CSS injection', () => {
    const f = fixture();
    assert.equal(f.lucideName('lucide-notebook'), 'notebook');
    for (const name of ['../x', 'https://example.com/x', 'x?token=y', 'x.svg']) assert.equal(f.lucideName(name), undefined);
    assert.equal(f.iconColor('blue'), '#027aff'); assert.equal(f.iconColor('red;display:none'), undefined);
});
