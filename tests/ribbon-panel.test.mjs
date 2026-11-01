import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const nativeRequire = createRequire(import.meta.url);

// 验证真实面板的重绘/事件链，不启动或改动个人库；Exercise production rendering with native API doubles.
class Element {
    children = [];
    classes = new Set();
    attributes = {};
    isConnected = true;
    scrollTop = 0;
    createDiv(options = {}) { return this.createEl('div', options); }
    createSpan(options = {}) { return this.createEl('span', options); }
    createEl(tag, options = {}) {
        const child = new Element(); child.tag = tag;
        if (typeof options === 'string') options = { cls: options };
        child.text = options.text ?? '';
        child.addClass(...(options.cls ?? '').split(' ').filter(Boolean));
        Object.assign(child.attributes, options.attr);
        this.children.push(child); return child;
    }
    addClass(...names) { names.forEach(name => this.classes.add(name)); }
    setAttribute(name, value) { this.attributes[name] = value; }
    empty() { this.children = []; }
    addEventListener() {}
}
class Base { constructor(app) { this.app = app; this.contentEl = new Element(); } }
class Button {
    constructor(parent) { this.buttonEl = parent.createEl('button'); }
    setIcon() { return this; }
    setButtonText(text) { this.buttonEl.text = text; return this; }
    setTooltip() { return this; }
    onClick(callback) { this.buttonEl.click = callback; return this; }
}
class Text {
    constructor(parent) { this.inputEl = parent.createEl('input'); }
    setPlaceholder() { return this; }
    setValue() { return this; }
    onChange(callback) { this.change = callback; return this; }
}
class Toggle extends Text { setTooltip() { return this; } }
const obsidian = { Modal: Base, FuzzySuggestModal: Base, SuggestModal: Base, Plugin: Base, PluginSettingTab: Base,
    ButtonComponent: Button, TextComponent: Text, ToggleComponent: Toggle, Platform: { isMobileApp: true }, setIcon() {} };
const bundle = await build({ entryPoints: ['src/modal/ribbon-modal.ts'], bundle: true, platform: 'node', format: 'cjs',
    write: false, external: ['obsidian', 'electron'], loader: { '.webp': 'dataurl' }, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'obsidian' ? obsidian : name === 'electron' ? {} : nativeRequire(name), module, module.exports);
const { RibbonModal } = module.exports;
function fixture() {
    const manager = { settings: { RIBBON_SETTINGS: [{ visible: true }, { visible: false }], RIBBON_GROUPS: [] },
        isRibbonManagerEnabled: () => true, translator: { t: key => key } };
    const panel = new RibbonModal({}, manager);
    const rendered = [];
    panel.renderFilteredList = () => { rendered.push(panel.currentFilter); };
    let scopes = 0;
    panel.renderScopeBar = () => { scopes++; };
    return { panel, rendered, scopes: () => scopes };
}
const buttons = host => host.children[0].children[0].children.filter(child => child.tag === 'button');

test('embedded Ribbon re-renders the external active filter on every selection', () => {
    const { panel, rendered, scopes } = fixture();
    const host = new Element(); const page = new Element();
    panel.setExternalFilterBar(true); panel.mountFilterBar(host); panel.display(page, false);
    assert.equal(scopes(), 0);
    for (const index of [1, 2, 0, 2]) {
        buttons(host)[index].click();
        assert.equal(host.children.length, 1);
        assert.deepEqual(buttons(host).map(button => button.classes.has('is-active')), [0, 1, 2].map(value => value === index));
        assert.deepEqual(buttons(host).map(button => button.attributes['aria-pressed']), [0, 1, 2].map(value => `${value === index}`));
        assert.equal(rendered.at(-1), ['all', 'visible', 'hidden'][index]);
    }
    assert.equal(scopes(), 0);
});
test('standalone mobile Ribbon keeps its own single device selector', () => {
    const { panel, scopes } = fixture();
    panel.display(new Element());
    assert.equal(scopes(), 1);
});
