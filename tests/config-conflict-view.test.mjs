import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

class Element {
    children = [];
    classes = new Set();
    attributes = {};
    isConnected = true;
    scrollTop = 0;
    text = '';
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.text = value; this.children = []; }
    constructor(doc = { activeElement: null }) { this.ownerDocument = doc; }
    createDiv(options = '') {
        const child = new Element(this.ownerDocument);
        child.parentElement = this;
        if (typeof options === 'string') options = { cls: options };
        child.addClass(...(options.cls ?? '').split(' ').filter(Boolean));
        child.textContent = options.text ?? '';
        Object.assign(child.attributes, options.attr);
        this.children.push(child); return child;
    }
    createSpan(options) { return this.createDiv(options); }
    createEl(_tag, options) { return this.createDiv(options); }
    addClass(...names) { names.forEach(name => this.classes.add(name)); }
    toggleClass(name, enabled) { if (enabled) this.classes.add(name); else this.classes.delete(name); }
    setAttribute(name, value) { this.attributes[name] = value; }
    setText(value) { this.textContent = value; }
    empty() { this.children.forEach(child => { child.isConnected = false; }); this.children = []; this.text = ''; }
    focus() { this.ownerDocument.activeElement = this; }
    querySelector(selector) { return descendants(this).find(child => child.classes.has(selector.slice(1))) ?? null; }
}
function descendants(root) { return root.children.flatMap(child => [child, ...descendants(child)]); }
class Modal {
    constructor(app) { this.app = app; this.modalEl = new Element(); this.titleEl = this.modalEl.createDiv(); this.contentEl = this.modalEl.createDiv(); }
    open() { this.isOpen = true; this.onOpen(); }
    close() { if (this.isOpen) { this.isOpen = false; this.onClose(); } }
}
class ButtonComponent {
    constructor(parent) { this.buttonEl = parent.createDiv(); }
    setButtonText(value) { this.buttonEl.setText(value); return this; }
    setIcon(icon) { this.buttonEl.empty(); this.buttonEl.icon = icon; return this; }
    setTooltip(value) { this.buttonEl.tooltip = value; return this; }
    setDisabled(value) { this.buttonEl.disabled = value; return this; }
    setCta() { return this; }
    onClick(callback) { this.buttonEl.click = callback; return this; }
}
const notices = [];
const result = await build({ stdin: { contents: "export { ConfigConflictModal } from './src/settings/conflict-view'; export { ConfigConflictChoices } from './src/settings/conflict-choices';", resolveDir: process.cwd() },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['obsidian'], logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(() => ({ Modal, ButtonComponent, Notice: class { constructor(text) { notices.push(text); } }, setIcon() {} }), module, module.exports);
const { ConfigConflictModal, ConfigConflictChoices } = module.exports;
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
    const choices = new ConfigConflictChoices('conflict-one', { LANGUAGE: 'en', githubToken: 'secret-local' }, { LANGUAGE: 'zh', githubToken: 'secret-remote' });
    choices.setFiles({}, {});
    const calls = [], editing = new Set();
    const manager = { app: {}, settings: { LANGUAGE: 'en' }, isSavingSettings: false,
        beginSettingsEditing(owner) { editing.add(owner); }, endSettingsEditing(owner) { editing.delete(owner); },
        async savePendingSettings() { calls.push(['save']); return true; },
        configProtection: { protection: { conflict: { id: choices.id } }, conflictChoices: choices,
            async prepareConflictChoices() { return choices; },
            async selectConflictSection(id, side) { choices.selectSection(id, side); modal.refresh(); },
            async confirmAllConflictChoices(side, id) { calls.push(['all', side, id]); choices.selectAll(side); },
            async confirmConflictChoices(id) { calls.push(['confirm', id]); },
        },
    };
    let closed = 0;
    const modal = new ConfigConflictModal(manager, () => { closed++; });
    modal.open();
    return { modal, manager, choices, calls, editing, closed: () => closed };
}
const sourceButtons = modal => descendants(modal.contentEl).filter(el => el.classes.has('bpm-config-conflict__choice'));

test('conflict dialog uses source-labelled all-settings actions and preserves mounted choices on refresh', async () => {
    const f = fixture(); await settle();
    assert.equal(f.modal.titleEl.textContent, 'Configuration conflict');
    const buttons = sourceButtons(f.modal);
    assert.deepEqual(buttons.map(button => button.textContent), ['Local version', 'Remote version', 'Local version', 'Remote version']);
    assert.equal(buttons[1].tooltip, 'Resolve all conflicts with remote settings and save');
    const content = f.modal.contentEl.querySelector('.bpm-config-conflict__content');
    content.scrollTop = 91; buttons[3].focus();
    f.choices.selectSection('settings', 'incoming'); f.modal.refresh(); await settle();
    assert.equal(sourceButtons(f.modal)[3], buttons[3]);
    assert.equal(content.scrollTop, 91);
    assert.equal(buttons[3].ownerDocument.activeElement, buttons[3]);
    assert.equal(buttons[1].attributes['aria-pressed'], 'true');
    assert.equal(descendants(f.modal.contentEl).some(el => /secret-local|secret-remote/.test(el.textContent)), false);
    assert.deepEqual(f.calls, []);
    f.modal.close(); assert.equal(f.editing.size, 0);
});

test('either all-settings source applies and saves once, blocking repeated clicks until completion', async () => {
    for (const [index, side] of [[0, 'local'], [1, 'incoming']]) {
        const f = fixture(); await settle();
        let finish;
        f.manager.savePendingSettings = () => { f.calls.push(['save']); return new Promise(resolve => { finish = resolve; }); };
        const buttons = sourceButtons(f.modal);
        assert.equal(buttons[index].click(), undefined);
        await settle();
        assert.deepEqual(f.calls, [['all', side, 'conflict-one'], ['save']]);
        assert.ok(buttons.every(button => button.disabled));
        buttons[index].click(); await settle();
        assert.equal(f.calls.length, 2);
        finish(true); await settle();
        assert.equal(f.closed(), 1); assert.equal(f.editing.size, 0);
    }
});

test('section choices remain individual until Save confirms them through the shared save entry', async () => {
    const f = fixture(); await settle();
    sourceButtons(f.modal)[3].click(); await settle();
    assert.deepEqual(f.calls, []);
    const save = descendants(f.modal.contentEl).find(el => el.textContent === 'Save changes' && typeof el.click === 'function');
    assert.equal(save.click(), undefined); await settle();
    assert.deepEqual(f.calls, [['confirm', 'conflict-one'], ['save']]);
    assert.equal(f.closed(), 1);
});

test('a stale source action stays open with a readable error and never reaches Save', async () => {
    const f = fixture(); await settle();
    f.manager.configProtection.confirmAllConflictChoices = async () => { throw new Error('Incoming version changed'); };
    sourceButtons(f.modal)[1].click(); await settle();
    assert.deepEqual(f.calls, []); assert.equal(f.closed(), 0);
    assert.ok(sourceButtons(f.modal).every(button => !button.disabled));
    assert.ok(notices.includes('Configuration protection failed: Incoming version changed'));
    f.modal.close();
});

test('closing during preparation never adds controls back to the dismissed dialog', async () => {
    const f = fixture(); await settle();
    let finish;
    f.manager.configProtection.protection.conflict = { id: 'conflict-two' };
    f.manager.configProtection.prepareConflictChoices = () => new Promise(resolve => { finish = resolve; });
    f.modal.refresh(); f.modal.close();
    finish(f.choices); await settle();
    assert.equal(f.modal.contentEl.children.length, 0);
    assert.equal(f.closed(), 1); assert.deepEqual(f.calls, []);
});
