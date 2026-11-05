import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

class Element {
    children = [];
    classes = new Set();
    attributes = {};
    text = '';
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.text = value; this.children = []; }
    createDiv(options = '') {
        const child = new Element();
        if (typeof options === 'string') options = { cls: options };
        child.addClass(...(options.cls ?? '').split(' ').filter(Boolean)); child.text = options.text ?? '';
        this.children.push(child); return child;
    }
    createSpan(options) { return this.createDiv(options); }
    createEl(_tag, options) { return this.createDiv(options); }
    addClass(...classes) { classes.forEach(cls => this.classes.add(cls)); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    setText(value) { this.textContent = value; }
    empty() { this.children = []; this.text = ''; }
    querySelector(selector) { return descendants(this).find(child => child.classes.has(selector.slice(1))) ?? null; }
}
const descendants = root => root.children.flatMap(child => [child, ...descendants(child)]);
class Modal {
    constructor(app) { this.app = app; this.modalEl = new Element(); this.titleEl = this.modalEl.createDiv(); this.contentEl = this.modalEl.createDiv(); }
    open() { this.opened = true; this.onOpen(); }
    close() { if (!this.opened) return; this.opened = false; this.onClose(); }
}
class ButtonComponent {
    constructor(parent) { this.buttonEl = parent.createDiv(); }
    setButtonText(text) { this.buttonEl.setText(text); return this; }
    setDisabled(value) { this.buttonEl.disabled = value; return this; }
    setCta() { return this; }
    onClick(callback) { this.buttonEl.click = callback; return this; }
}
class ValueComponent {
    setValue(value) { this.value = value; return this; }
    setPlaceholder() { return this; }
    addOption() { return this; }
    onChange(callback) { this.change = callback; return this; }
}
class Setting {
    constructor(parent) { this.settingEl = parent.createDiv('setting-item'); this.nameEl = this.settingEl.createDiv('setting-item-name'); this.controlEl = this.settingEl.createDiv(); }
    setName(value) { this.nameEl.setText(value); return this; }
    setDesc() { return this; }
    setHeading() { return this; }
    addToggle(callback) { callback(new ValueComponent()); return this; }
    addDropdown(callback) { callback(new ValueComponent()); return this; }
    addText(callback) { callback(new ValueComponent()); return this; }
    addButton(callback) { callback(new ButtonComponent(this.controlEl)); return this; }
}
const notices = [];
const built = await build({ entryPoints: ['src/rollback/history-modal.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, external: ['obsidian'], logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(() => ({ Modal, Setting, ButtonComponent, Notice: class { constructor(message) { notices.push(message); } } }), module, module.exports);
const { HistoryModal } = module.exports;
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
    const editors = new Set();
    const plan = { snapshot: { id: 'point-one', version: '1.0.0', binding: { unresolved: true } }, removed: [], restored: [], preservableObjects: [], preservePaths: [] };
    const manager = { settings: { PLUGIN_ROLLBACK_ENABLED: false }, manifest: { id: 'self' }, appPlugins: { manifests: { example: { id: 'example', name: 'Example', version: '2.0.0' } } },
        translator: { t: key => key === '回退_标题' ? 'Plugin rollback (Preview)' : key },
        beginSettingsEditing(owner) { editors.add(owner); }, endSettingsEditing(owner) { editors.delete(owner); },
        history: { available: true, enabled: () => manager.settings.PLUGIN_ROLLBACK_ENABLED, async list() { return []; }, async prepare() { return plan; } },
    };
    const modal = new HistoryModal({}, manager, 'example');
    return { modal, manager, editors, plan };
}

test('rollback Preview labels are visible while automatic backups remain disabled by default', async () => {
    const f = fixture(); f.modal.open(); await settle();
    assert.equal(f.modal.titleEl.textContent, 'Plugin rollback (Preview)');
    const names = descendants(f.modal.contentEl).filter(element => element.classes.has('setting-item-name'));
    assert.equal(names[0].textContent, '回退_开启 Preview');
    assert.equal(descendants(names[0]).filter(element => element.classes.has('flair')).length, 1);
    const create = descendants(f.modal.contentEl).find(element => element.click && element.textContent === '回退_创建');
    assert.equal(create.disabled, true); assert.equal(f.manager.settings.PLUGIN_ROLLBACK_ENABLED, false);
    f.modal.close(); assert.equal(f.editors.size, 0);
});

test('closing the rollback window invalidates its in-flight restore token and prevents a success notification', async () => {
    const f = fixture(); f.manager.settings.PLUGIN_ROLLBACK_ENABLED = true; f.modal.open(); await settle();
    await f.modal.preview('point-one');
    let activeActions = 0;
    f.manager.configProtection = { beginUserAction() { activeActions++; return () => { activeActions--; }; } };
    let release, current;
    const gate = new Promise(resolve => { release = resolve; });
    f.manager.history.restore = async (plan, isCurrent) => {
        assert.equal(plan, f.plan); current = isCurrent; await gate;
        if (!isCurrent()) throw new Error('Cancelled');
    };
    const restore = descendants(f.modal.contentEl).find(element => element.click && element.textContent === '回退_确认');
    const count = notices.length; assert.equal(restore.click(), undefined); assert.equal(current(), true);
    assert.equal(activeActions, 1);
    f.modal.close(); assert.equal(current(), false); release(); await settle();
    assert.equal(notices.length, count); assert.equal(f.modal.contentEl.children.length, 0); assert.equal(f.editors.size, 0);
    assert.equal(activeActions, 0);
});

test('a late restore preview cannot repopulate a closed window', async () => {
    const f = fixture(); f.modal.open(); await settle();
    let release;
    f.manager.history.prepare = () => new Promise(resolve => { release = resolve; });
    const preview = f.modal.preview('point-one'); f.modal.close(); release(f.plan); await preview;
    assert.equal(f.modal.contentEl.children.length, 0);
});

test('initial settings-render failures are reported and release the busy state', async () => {
    const f = fixture(); f.manager.history.enabled = () => { throw new Error('History settings unavailable'); };
    const count = notices.length; f.modal.open(); await settle();
    assert.ok(notices.slice(count).includes('History settings unavailable'));
    assert.equal(f.modal.busy, false); assert.equal(f.modal.modalEl.attributes['aria-busy'], undefined);
    f.modal.close();
});
