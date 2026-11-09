import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Exercise the shared production renderer without opening a vault.
class Element {
    children = [];
    classes = new Set();
    attributes = {};
    ownerDocument = {
        defaultView: { addEventListener() {}, removeEventListener() {} },
        addEventListener() {}, removeEventListener() {},
    };
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    createEl(tag, options = {}) {
        if (typeof options === 'string') options = { cls: options };
        const child = new Element();
        child.tag = tag;
        child.parentElement = this;
        child.ownerDocument = this.ownerDocument;
        child.addClass(...(options.cls ?? '').split(' ').filter(Boolean));
        Object.assign(child.attributes, options.attr);
        this.children.push(child);
        return child;
    }
    addClass(...names) { names.forEach(name => this.classes.add(name)); }
    removeClass(...names) { names.forEach(name => this.classes.delete(name)); }
    toggleClass(name, value) { if (value) this.classes.add(name); else this.classes.delete(name); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener() {}
    closest() { return null; }
    empty() { this.children = []; }
    find(className) {
        return this.children.flatMap(child => [
            ...(child.classes.has(className) ? [child] : []), ...child.find(className),
        ]);
    }
}
const bundle = await build({ entryPoints: ['src/devices/device-scope-bar.ts'], bundle: true,
    platform: 'node', format: 'cjs', write: false, external: ['obsidian'], logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(() => ({
    Modal: class {}, setIcon() {},
}), module, module.exports);
const { DeviceScopeBar } = module.exports;
function fixture(enabled, feature = true) {
    const changes = [];
    const manager = {
        settings: { FEATURES: { devices: feature } },
        translator: { t: key => key },
        devices: {
            data: { enabled }, boundPresetId: 'local',
            selectedScope: () => {
                assert.equal(manager.devices.data.enabled && manager.settings.FEATURES.devices, true,
                    'hidden device controls must not resolve or project a preset');
                return { key: 'preset:local', presetId: 'local' };
            },
            presetsFor: type => type === 'computer' ? [{ id: 'local', name: 'Computer' }] : [],
            label: type => type, isLiveScope: () => true,
        },
        overview: { mode: () => 'session', setMode: (...args) => changes.push(args) },
    };
    return { manager, bar: new DeviceScopeBar(manager, () => changes.push('render')), changes };
}

for (const page of ['plugins', 'themes']) {
    for (const inline of [false, true]) {
        test(`${page} keeps apply mode while hiding disabled device controls (inline=${inline})`, () => {
            const { bar } = fixture(false);
            const host = new Element();
            bar.render(host, page, inline);
            assert.equal(host.hidden, false);
            assert.equal(host.find('manager-overview-controls__device').length, 0);
            assert.equal(host.find('manager-device-scope__quick-apply').length, 0);
            assert.equal(host.find('manager-overview-controls__mode').length, 1);
            bar.close();
        });
    }
}

test('disabled Ribbon device scope hides the whole row, and re-enabling restores it', () => {
    const { manager, bar } = fixture(false);
    const host = new Element();
    bar.render(host, 'ribbon');
    assert.equal(host.hidden, true);
    assert.equal(host.children.length, 0);
    manager.devices.data.enabled = true;
    bar.render(host, 'ribbon');
    assert.equal(host.hidden, false);
    assert.equal(host.find('manager-overview-controls__device').length, 1);
    assert.equal(host.find('manager-device-scope__quick-apply').length, 1);
    assert.equal(host.find('manager-overview-controls__mode').length, 0);
    bar.close();
});

test('hiding the device feature also removes its controls while retaining apply mode', () => {
    const { bar } = fixture(true, false);
    const host = new Element();
    bar.render(host, 'plugins');
    assert.equal(host.find('manager-overview-controls__device').length, 0);
    assert.equal(host.find('manager-overview-controls__mode').length, 1);
    bar.close();
});

test('reusing an inline scope container removes the previous device control', () => {
    const { manager, bar } = fixture(true);
    const host = new Element();
    bar.render(host, 'plugins', true);
    assert.equal(host.find('manager-overview-controls__device').length, 1);
    manager.devices.data.enabled = false;
    bar.render(host, 'plugins', true);
    assert.equal(host.find('manager-overview-controls__device').length, 0);
    assert.equal(host.find('manager-overview-controls__mode').length, 1);
    bar.close();
});
