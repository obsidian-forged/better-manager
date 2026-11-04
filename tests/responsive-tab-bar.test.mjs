import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
    entryPoints: ['src/ui/responsive-tab-bar.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['obsidian'], plugins: [{ name: 'menu-fixture', setup(builder) {
        builder.onResolve({ filter: /^\.\/scope-select$/ }, () => ({ path: 'menu-fixture', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
            export class ScopeSelect {
                static compact(host, label, value, options, onChange) {
                    const select = { value, label, options, onChange, trigger: {}, closes: 0,
                        field: { addClass() {}, remove() { select.removed = true; } },
                        setValue(value) { this.value = value; },
                        setOptionLabel(value, label) { this.options.find(o => o.value === value).label = label; },
                        close() { this.closes++; } };
                    host.select = select;
                    return select;
                }
            }` }));
    } }],
});

function fixture({ mobile = false, available = 600, required = 400 } = {}) {
    const observers = [];
    class Observer {
        targets = [];
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(target, options) { this.targets.push({ target, options }); }
        disconnect() { this.disconnected = true; }
    }
    const view = { ResizeObserver: Observer, MutationObserver: Observer };
    const element = () => ({
        classes: new Set(), attributes: new Map(), isConnected: true, clientWidth: available,
        ownerDocument: { defaultView: view },
        addClass(...names) { names.forEach(name => this.classes.add(name)); },
        removeClass(...names) { names.forEach(name => this.classes.delete(name)); },
        toggleClass(name, value) { value ? this.classes.add(name) : this.classes.delete(name); },
        setAttribute(name, value) { this.attributes.set(name, value); },
        removeAttribute(name) { this.attributes.delete(name); },
    });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
        id => { assert.equal(id, 'obsidian'); return { Platform: { isMobile: mobile, isMobileApp: false } }; }, module, module.exports);
    const host = element(), rail = element(), peer = element(), changes = [];
    peer.reserved = 0;
    rail.width = required;
    rail.getBoundingClientRect = () => ({ width: rail.width });
    const tabs = new module.exports.ResponsiveTabBar(host, rail, 'Pages', 'overview', [
        { value: 'overview', label: 'Overview', icon: 'list' }, { value: 'ribbon', label: 'Ribbon', icon: 'grip-vertical' },
    ], value => changes.push(value), () => host.clientWidth - peer.reserved, [peer]);
    return { tabs, host, rail, peer, observers, changes };
}

test('page navigation collapses before overflow, preserves selection, and expands with its original rail', () => {
    const { tabs, host, rail, observers, changes } = fixture();
    assert.equal(host.classes.has('is-tabs-compact'), false);
    host.clientWidth = 399; observers[0].callback();
    assert.equal(host.classes.has('is-tabs-compact'), false);
    host.clientWidth = 398; observers[0].callback();
    assert.equal(host.classes.has('is-tabs-compact'), true);
    assert.equal(rail.attributes.get('aria-hidden'), 'true');
    host.select.onChange('ribbon');
    tabs.setValue('ribbon');
    assert.deepEqual(changes, ['ribbon']);
    host.clientWidth = 600; observers[0].callback();
    assert.equal(host.classes.has('is-tabs-compact'), false);
    assert.equal(rail.attributes.get('aria-hidden'), 'false');
    assert.equal(host.select.value, 'ribbon');
    assert.equal(host.classes.has('is-tabs-measuring'), false);
    tabs.destroy();
    assert.ok(observers.every(observer => observer.disconnected));
    assert.equal(host.select.removed, true);
    assert.equal(rail.classes.has('bpm-responsive-tabs__rail'), false);
    host.clientWidth = 1; observers[0].callback();
    assert.equal(host.classes.has('is-tabs-compact'), false);
});

test('mobile emulation uses the same icon menu even when a wide viewport could fit the tabs', () => {
    const { tabs, host } = fixture({ mobile: true, available: 1200 });
    assert.equal(host.classes.has('is-tabs-compact'), true);
    assert.equal(host.select.options[0].icon, 'list');
    tabs.setOptionLabel('overview', 'Overview · Differences');
    assert.equal(host.select.options[0].label, 'Overview · Differences');
});

test('changing neighbouring actions or tab labels updates the fit without observing its own host classes', () => {
    const { host, rail, peer, observers } = fixture();
    assert.ok(observers[0].targets.some(item => item.target === peer));
    assert.deepEqual(observers[1].targets.map(item => item.target), [rail]);
    peer.reserved = 250; observers[0].callback();
    assert.equal(host.classes.has('is-tabs-compact'), true);
    peer.reserved = 0; rail.width = 700; observers[1].callback();
    assert.equal(host.classes.has('is-tabs-compact'), true);
    rail.width = 300; observers[1].callback();
    assert.equal(host.classes.has('is-tabs-compact'), false);
});
