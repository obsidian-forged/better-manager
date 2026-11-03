import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

class Element {
    children = []; attributes = {}; text = ''; isConnected = true;
    createEl(tag, options = {}) { const child = new Element(); child.tag = tag; child.parentElement = this; child.text = options.text || ''; Object.assign(child.attributes, options.attr); this.children.push(child); return child; }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    empty() { this.children = []; }
    addClass() {} toggleClass() {} getElementsByClassName() { return []; }
    setText(text) { this.text = text; } setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, callback) { this[name] = callback; }
    remove() { this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
}
class Modal {
    constructor(app) { this.app = app; this.modalEl = new Element(); this.titleEl = this.modalEl.createDiv(); this.contentEl = this.modalEl.createDiv(); }
    close() { this.didClose = true; this.onClose(); }
}
class Button {
    constructor(parent) { this.buttonEl = parent.createEl('button'); }
    setButtonText(text) { this.buttonEl.text = text; return this; } setIcon() { return this; } setTooltip() { return this; } setCta() { return this; }
    setDisabled(value) { this.buttonEl.disabled = value; return this; } onClick(callback) { this.buttonEl.click = callback; return this; }
}
class Setting {
    constructor(parent) { this.settingEl = parent.createDiv(); this.nameEl = this.settingEl.createDiv(); this.descEl = this.settingEl.createDiv(); this.controlEl = this.settingEl.createDiv(); }
    setName(text) { this.nameEl.text = text; return this; } setDesc(text) { this.descEl.text = text; return this; } setClass() { return this; }
    addButton(callback) { callback(new Button(this.controlEl)); return this; }
}
const notices = [];
const api = { Modal, Setting, ButtonComponent: Button, ExtraButtonComponent: Button, setIcon() {}, Platform: {}, requireApiVersion: () => true,
    Notice: class { constructor(message) { notices.push(message); } } };
const built = await build({ entryPoints: ['src/modal/update-modal.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['obsidian'], logLevel: 'silent' });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(() => api, loaded, loaded.exports);
const { UpdateModal } = loaded.exports;
const descendants = el => [el, ...el.children.flatMap(descendants)];
function manager() { return { settings: { DEBUG: false }, appPlugins: { manifests: { example: { name: 'Example', version: '1.0.0' } } },
    translator: { t: key => key }, updates: { blockReason() {} }, getPluginUpdateCheckOptions: () => ({}) }; }

test('version picker closes before installation starts and does not add a duplicate completion notice', async () => {
    notices.length = 0;
    let finish, started = false;
    const pending = new Promise(resolve => { finish = resolve; });
    const modal = new UpdateModal({}, manager(), 'example', [{ version: '2.0.0', prerelease: false }], '2.0.0', undefined,
        async version => { assert.equal(modal.didClose, true); assert.equal(version, '2.0.0'); started = true; return pending; });
    await modal.onOpen();
    const button = descendants(modal.contentEl).find(el => el.tag === 'button' && el.text === '管理器_选择版本_切换按钮');
    button.click();
    assert.equal(started, true); assert.equal(modal.didClose, true); assert.equal(modal.contentEl.children.length, 0);
    finish(true); await pending; await Promise.resolve();
    assert.deepEqual(notices, []);
});
test('version picker shows the HTTP reason when loading history fails', async () => {
    notices.length = 0;
    const modal = new UpdateModal({}, manager(), 'example', [], undefined, undefined, undefined,
        { loadVersions: async () => { throw Error('HTTP 403: API rate limit exceeded'); } });
    await modal.onOpen();
    assert.ok(notices.some(text => text.includes('HTTP 403')));
    assert.equal(modal.downloadButton.disabled, true);
    assert.ok(descendants(modal.contentEl).some(el => el.attributes.role === 'alert' && el.text.includes('HTTP 403')));
    assert.equal(modal.downloadButton.disabled, true);
});
