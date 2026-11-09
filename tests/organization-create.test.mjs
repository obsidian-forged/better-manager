import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const nativeRequire = createRequire(import.meta.url);
class Element {
    children = [];
    createDiv() { const child = new Element(); this.children.push(child); return child; }
    createSpan() { return this.createDiv(); }
    addClass() {}
    empty() { this.children = []; }
    setAttribute() {}
}
class Modal {
    static last;
    constructor(app) { this.app = app; this.contentEl = new Element(); this.modalEl = new Element(); this.titleEl = new Element(); Modal.last = this; }
    open() { this.onOpen(); }
    close() { this.closed = true; this.onClose(); }
}
const inputs = [], buttons = [], notices = [], commands = [];
class Button {
    constructor(container) { this.buttonEl = container.createDiv(); buttons.push(this); }
    setButtonText(text) { this.text = text; return this; }
    setIcon() { return this; }
    setTooltip() { return this; }
    setCta() { return this; }
    setDisabled(value) { this.disabled = value; return this; }
    onClick(callback) { this.click = callback; return this; }
}
class Setting {
    controlEl = new Element();
    constructor() {}
    setClass() { return this; }
    setName() { return this; }
    setDesc() { return this; }
    addText(callback) { const input = { setPlaceholder() { return this; }, onChange(fn) { this.change = fn; return this; } }; inputs.push(input); callback(input); return this; }
    addColorPicker(callback) { callback({ setValue() { return this; }, onChange() { return this; } }); return this; }
}
const obsidian = { Modal, ButtonComponent: Button, Setting, Notice: class { constructor(text) { notices.push(text); } }, setIcon() {} };
async function load(entry) {
    const bundle = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['obsidian'], logLevel: 'silent', plugins: [{ name: 'commands', setup(builder) {
        builder.onLoad({ filter: /[/\\]src[/\\]command\.ts$/ }, () => ({ contents: 'export default function Commands(app) { app.commandsCalled(); }', loader: 'ts' }));
    } }] });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'obsidian' ? obsidian : nativeRequire(name), loaded, loaded.exports);
    return loaded.exports;
}
const { createOrganizationEntry } = await load('src/settings/organization.ts');
const { OrganizationCreateModal, addOrganizationCreateAction } = await load('src/ui/organization-create.ts');
const settings = () => ({ GROUPS: [], TAGS: [] });
function fixture(kind = 'group') {
    inputs.length = 0; buttons.length = 0; notices.length = 0;
    const data = settings(), saved = [], applied = [];
    const manager = { settings: data, app: { commandsCalled() { commands.push(true); } }, translator: { t: key => key }, generateAutoColor: () => '#f00', async saveSettings() { saved.push(structuredClone(data)); } };
    const modal = new OrganizationCreateModal(manager, kind, async id => { applied.push(id); });
    modal.open();
    return { manager, modal, data, saved, applied, create: () => buttons.find(button => button.text === (kind === 'group' ? '分组编辑_创建分组' : '标签编辑_创建标签')) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('organization definitions share trimmed IDs, unique IDs per kind and reserved system tags', () => {
    const data = settings();
    assert.deepEqual(createOrganizationEntry(data, 'group', { id: ' writing ', name: ' Articles ', color: '#fff' }), { id: 'writing', name: 'Articles', color: '#fff' });
    assert.equal(createOrganizationEntry(data, 'group', { id: ' writing', name: 'Other', color: '' }), undefined);
    assert.deepEqual(createOrganizationEntry(data, 'tag', { id: 'writing', name: ' ', color: '#fff' }), { id: 'writing', name: 'writing', color: '#fff' });
    const before = structuredClone(data);
    for (const id of ['', ' ', 'bpm-install', 'bpm-ignore', 'bpm-eondr-plugin']) {
        assert.equal(createOrganizationEntry(data, 'tag', { id, name: 'bad', color: '' }), undefined, id);
    }
    assert.deepEqual(data, before);
});

test('contextual creation cancels without staging definitions or assigning plugins', () => {
    const { modal, data, saved, applied } = fixture();
    inputs[0].change('new'); inputs[1].change('New group');
    buttons.find(button => button.text === '通用_取消_文本').click();
    assert.equal(modal.closed, true); assert.deepEqual(data.GROUPS, []); assert.deepEqual(saved, []); assert.deepEqual(applied, []);
});

test('contextual creation stages once, applies the new ID and ignores repeated submit clicks', async () => {
    const { modal, data, saved, applied, create } = fixture();
    inputs[0].change(' new '); inputs[1].change(' New group ');
    assert.equal(create().click(), undefined); create().click(); await flush();
    assert.deepEqual(data.GROUPS, [{ id: 'new', name: 'New group', color: '#f00' }]);
    assert.equal(saved.length, 1); assert.deepEqual(applied, ['new']); assert.equal(modal.closed, true);
});

test('invalid contextual IDs stay editable and never stage or apply a definition', async () => {
    const { modal, data, saved, applied, create } = fixture('tag');
    inputs[0].change('bpm-ignore'); create().click(); await flush();
    assert.deepEqual(data.TAGS, []); assert.equal(saved.length, 0); assert.deepEqual(applied, []);
    assert.equal(modal.closed, undefined); assert.equal(notices.at(-1), '设置_标签设置_通知_二');
});

test('native create action waits for the caller to close its previous menu', () => {
    const { manager } = fixture();
    let item, openNext;
    const menu = { addSeparator() {}, addItem(callback) { item = { setTitle(title) { this.title = title; return this; }, setIcon(icon) { this.icon = icon; return this; }, onClick(fn) { this.click = fn; return this; } }; callback(item); } };
    const previous = Modal.last;
    addOrganizationCreateAction(menu, manager, 'tag', next => { openNext = next; }, async () => {});
    item.click(); assert.equal(Modal.last, previous); assert.equal(item.title, '标签编辑_创建标签');
    openNext(); assert.notEqual(Modal.last, previous);
});
