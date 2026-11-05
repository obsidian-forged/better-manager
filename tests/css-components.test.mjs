import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { componentFixture, componentStyles, fixtureElement, pseudoElement } from './helpers/css-cascade.mjs';

const css=readFileSync('styles.css','utf8');

test('component rules have one normal cascade and guard wrapper flattening with a usable flex fallback',()=>{
    const root=postcss.parse(css),flatten=[];
    root.walkDecls(decl=>{
        assert.equal(Boolean(decl.important),false,`${decl.parent.selector}: ${decl.prop}`);
        assert.ok(!['text-indent','text-decoration-thickness','column-gap'].includes(decl.prop));
        if (['scrollbar-width','scrollbar-color'].includes(decl.prop)) {
            assert.equal(decl.parent.parent.name, 'supports');
            assert.match(decl.parent.parent.params, /scrollbar-color: auto/);
            assert.match(decl.parent.parent.params, /scrollbar-width: auto/);
        }
        if(decl.prop==='display'&&decl.value==='contents')flatten.push(decl.parent);
    });
    root.walkRules(rule=>assert.ok(!rule.selector.includes(':has(')));
    assert.equal(flatten.length,2);
    for(const rule of flatten){
        assert.equal(rule.parent.name,'supports');
        assert.equal(rule.parent.params,'(display: contents)');
        const fallback=rule.parent.prev();
        assert.equal(fallback.selector,rule.selector);
        assert.ok(fallback.nodes.some(d=>d.prop==='display'&&d.value==='flex'));
        assert.ok(fallback.nodes.some(d=>d.prop==='flex-wrap'&&d.value==='wrap'));
    }
});

test('shared tabs retain their appearance alongside native desktop and mobile button defaults', () => {
    const native = `:root { --radius-s: 4px; }
        button { border-radius: 5px; padding: 4px 12px; }
        button:not(.clickable-icon) { background: var(--interactive-normal); color: var(--text-normal); box-shadow: native-shadow; }
        body.is-mobile button:not(.clickable-icon) { background: var(--interactive-normal); border-radius: 44px; padding: 10px; }
        button:not(.clickable-icon):hover { background: var(--interactive-hover); box-shadow: native-hover-shadow; }`;
    for (const phone of [false, true]) {
        const nodes = componentFixture({ phone, dark: true });
        const style = componentStyles(native + '\n' + css, { phone });
        for (const name of ['manager-setting__tabs-item', 'manager-toolbar__tab', 'manager-repo-page__switch', 'manager-install__segment', 'manager-transfer-segment']) {
            const idle = nodes.get(`${name}/idle`);
            assert.equal(style(idle, 'background'), 'transparent', `${phone}/${name}`);
            assert.equal(style(idle, 'color'), 'var(--text-muted)');
            assert.equal(style(idle, 'box-shadow'), 'none');
            assert.equal(style(idle, 'border-radius'), '6px');
            assert.equal(style(idle, 'padding'), '4px 8px');
        }
    }
});

test('overview search and device scopes wrap without percentage-height fields or forced narrow columns', () => {
    for (const phone of [false, true]) {
        const nodes = componentFixture({ phone }), style = componentStyles(css, { phone });
        assert.equal(style(nodes.get('searchLine'), 'flex-wrap'), 'wrap');
        assert.equal(style(nodes.get('searchField'), 'flex'), '1 1 16rem');
        assert.equal(style(nodes.get('scopeHost'), 'flex-wrap'), 'wrap');
        for (const key of ['scopeDevice', 'scopeMode']) {
            assert.equal(style(nodes.get(key), 'height'), '34px');
            assert.equal(style(nodes.get(key), 'min-height'), '34px');
            assert.equal(style(nodes.get(key), 'width'), phone ? '100%' : 'auto');
        }
        assert.equal(style(nodes.get('filterGrid'), 'grid-template-columns'), 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))');
        assert.notEqual(style(nodes.get('filterGrid'), 'grid-auto-flow'), 'column');
    }
});

test('external Ribbon filters retain selected colours and search spacing outside the list modal', () => {
    const nodes = componentFixture({ phone: true });
    const native = 'button:not(.clickable-icon) { background: native-button; } body.is-mobile button:not(.clickable-icon) { background: native-mobile; } input[type="text"] { padding: 4px 16px; }';
    const style = componentStyles(native + '\n' + css, { phone: true });
    assert.equal(style(nodes.get('filterbutton'), 'background'), 'var(--interactive-accent)');
    assert.equal(style(nodes.get('ribbonsearch'), 'padding'), '6px 12px 6px 32px');
    assert.equal(style(nodes.get('filtergroup'), 'touch-action'), 'pan-y pinch-zoom');
});

test('segmented controls preserve selected and hover states across theme variables without priority overrides',()=>{
    for(const dark of [false,true]){
        const nodes=componentFixture({dark}),style=componentStyles(css);
        for(const name of ['manager-setting__tabs-item','manager-toolbar__tab']){
            for(const state of ['active','active-hover','hover','focus']){
                assert.equal(style(nodes.get(`${name}/${state}`),'color'),'var(--text-accent)');
                assert.equal(style(nodes.get(`${name}/${state}`),'background'),'var(--interactive-normal)');
            }
            assert.equal(style(nodes.get(`${name}/disabled`),'pointer-events'),'none');
        }
        assert.equal(style(nodes.get('manager-repo-page__switch/active'),'color'),'var(--text-normal)');
        assert.equal(style(nodes.get('manager-repo-page__switch/hover'),'color'),dark?'var(--text-muted)':'var(--text-normal)');
        assert.equal(style(nodes.get('manager-toolbar__tab/hidden'),'display'),'none');
    }
});

test('full-width measurement and compact hiding cannot be defeated by phone wrapper styles',()=>{
    for(const phone of [false,true]){
        const full=componentFixture({phone,state:'is-measuring'}),style=componentStyles(css,{phone});
        for(const key of ['food','tools','switcher']){
            assert.equal(style(full.get(key),'display'),'flex');
            assert.equal(style(full.get(key),'width'),'max-content');
            assert.equal(style(full.get(key),'max-width'),'none');
        }
        assert.equal(style(full.get('control'),'display'),'flex');
        const compact=componentFixture({phone,state:'is-compact'});
        assert.equal(style(compact.get('switcher'),'display'),'none');
        assert.equal(style(compact.get('tool/hidden'),'display'),'none');
        assert.equal(style(compact.get('tool/more'),'display'),'inline-flex');
        const fallback=componentStyles(css,{phone,contents:false});
        assert.equal(fallback(compact.get('tools'),'display'),'flex');
        assert.equal(fallback(compact.get('tools'),'flex-wrap'),'wrap');
    }
});

test('card content, native Setting padding and close accents retain their component values',()=>{
    for(const phone of [false,true]){
        const nodes=componentFixture({phone}),style=componentStyles(css,{phone});
        assert.equal(style(nodes.get('themecard'),'padding'),'10px 12px');
        assert.equal(style(nodes.get('content'),'display'),'block');
        assert.equal(style(nodes.get('desc-hidden'),'display'),'none');
        assert.equal(style(nodes.get('viewtoggle'),'width'),'16px');
        assert.equal(style(nodes.get('action'),'width'),phone?'44px':'34px');
        assert.equal(style(nodes.get('close'),'border-color'),'color-mix(in srgb, var(--text-error) 55%, var(--background-modifier-border))');
        assert.equal(style(nodes.get('orderinput'),'padding'),'0');
    }
});

test('global save, more and close controls share one size on mobile and desktop', () => {
    const native = 'body.is-mobile button:not(.clickable-icon) { border-radius: 44px; padding: 10px; box-shadow: native-shadow; }';
    for (const phone of [false, true]) {
        const nodes = componentFixture({ phone }), style = componentStyles(native + '\n' + css, { phone });
        for (const key of ['save', 'more', 'close']) {
            const control = nodes.get(key), size = phone ? '44px' : '34px';
            for (const property of ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height']) {
                assert.equal(style(control, property), size, `${phone}/${key}/${property}`);
            }
            assert.equal(style(control, 'flex'), `0 0 ${size}`);
            assert.equal(style(control, 'padding'), '0');
            assert.equal(style(control, 'box-sizing'), 'border-box');
            assert.equal(style(control, 'box-shadow'), 'none');
            assert.equal(style(control, 'border-radius'), style(nodes.get('more'), 'border-radius'));
            assert.equal(style(nodes.get(`${key}/icon`), 'width'), '18px');
            assert.equal(style(nodes.get(`${key}/icon`), 'height'), '18px');
        }
    }
});

test('mobile toolbar dropdowns own full rows before actions even when the expanded layout fits', () => {
    for (const state of ['', 'is-compact']) {
        const nodes = componentFixture({ phone: true, state }), style = componentStyles(css, { phone: true });
        for (const key of ['overviewMenu', 'sourceNavigation', 'sourceSummary', 'appearanceMenu']) {
            const field = nodes.get(key);
            assert.equal(style(field, 'display'), 'inline-flex', `${state}/${key}`);
            assert.equal(style(field, 'width'), '100%', `${state}/${key}/width`);
            assert.equal(style(field, 'max-width'), '100%', `${state}/${key}/max-width`);
            assert.equal(style(field, 'flex'), '0 0 auto', `${state}/${key}/flex`);
            assert.equal(style(field, 'height'), '44px');
            assert.equal(style(field, 'min-height'), '44px');
            assert.equal(style(nodes.get(`${key}/trigger`), 'width'), '100%');
        }
        for (const key of ['statChip', 'switcher', 'appearanceTabs']) assert.equal(style(nodes.get(key), 'display'), 'none');
        assert.equal(style(nodes.get('head'), 'flex-wrap'), 'wrap');
        assert.equal(style(nodes.get('settingNavigation'), 'width'), '100%');
        assert.equal(style(nodes.get('settingNavigation'), 'display'), 'flex');
        assert.equal(style(nodes.get('settingsMenu'), 'flex'), '1 1 auto');
        assert.equal(style(nodes.get('settingsMenu'), 'width'), 'auto');
        assert.equal(style(nodes.get('settingsMenu'), 'height'), '44px');
        assert.equal(style(nodes.get('appearanceToolbar'), 'flex-direction'), 'column');
        assert.equal(style(nodes.get('appearanceToolbar'), 'flex'), '0 0 auto');
        const fallback = componentStyles(css, { phone: true, contents: false });
        for (const key of ['food', 'tools', 'bar', 'control']) assert.equal(fallback(nodes.get(key), 'width'), '100%');
    }
    const measuring = componentFixture({ phone: true, state: 'is-measuring' }), mobile = componentStyles(css, { phone: true });
    assert.equal(mobile(measuring.get('food'), 'width'), 'max-content');
    assert.equal(mobile(measuring.get('overviewMenu'), 'display'), 'none');
    const desktop = componentFixture(), style = componentStyles(css);
    for (const key of ['overviewMenu', 'sourceNavigation', 'sourceSummary', 'appearanceMenu']) assert.equal(style(desktop.get(key), 'display'), 'none');
});

test('mobile Ribbon status and group menus fill separate rows and retain fixed menu positioning', () => {
    const native = 'body.is-mobile button:not(.clickable-icon) { padding: 10px; border-radius: 44px; background: native-button; }';
    const nodes = componentFixture({ phone: true }), style = componentStyles(native + '\n' + css, { phone: true });
    assert.equal(style(nodes.get('filterbutton'), 'display'), 'none');
    assert.equal(style(nodes.get('filtergroup'), 'width'), '100%');
    assert.equal(style(nodes.get('filtergroup'), 'flex-wrap'), 'wrap');
    assert.equal(style(nodes.get('filterbar'), 'overflow'), 'visible');
    for (const key of ['ribbonState', 'ribbonGroup']) {
        assert.equal(style(nodes.get(key), 'display'), 'inline-flex');
        assert.equal(style(nodes.get(key), 'width'), '100%');
        assert.equal(style(nodes.get(key), 'height'), '44px');
        assert.equal(style(nodes.get(key), 'flex'), '0 0 auto');
    }
    for (const key of ['ribbonStateTrigger', 'ribbonGroup/trigger']) {
        assert.equal(style(nodes.get(key), 'height'), '100%');
        assert.equal(style(nodes.get(key), 'background'), style(nodes.get('overviewMenu/trigger'), 'background'));
        assert.equal(style(nodes.get(key), 'border-radius'), style(nodes.get('overviewMenu/trigger'), 'border-radius'));
    }
    assert.equal(style(nodes.get('ribbonStateMenu'), 'position'), 'fixed');
    const desktop = componentFixture(), desktopStyle = componentStyles(css);
    assert.equal(desktopStyle(desktop.get('ribbonState'), 'display'), 'none');
    assert.equal(desktopStyle(desktop.get('filterbutton'), 'display'), 'flex');
});

test('standalone mobile Ribbon menus share geometry without depending on the manager container', () => {
    const body = fixtureElement('body', 'is-mobile');
    const modal = fixtureElement('div', 'modal ribbon-manager-modal', body);
    const bar = fixtureElement('div', 'ribbon-manager-filter-bar', modal);
    const group = fixtureElement('div', 'ribbon-manager-filter-group', bar);
    const status = fixtureElement('div', 'manager-multiselect-filter ribbon-manager-state-menu', group);
    const trigger = fixtureElement('button', 'manager-multiselect-filter__trigger', status);
    const menu = fixtureElement('div', 'manager-multiselect-filter__menu is-fixed', status);
    const style = componentStyles('body.is-mobile button:not(.clickable-icon) { border-radius: 44px; background: native-button; }\n' + css, { phone: true });
    assert.equal(style(group, 'width'), '100%');
    assert.equal(style(status, 'display'), 'inline-flex');
    assert.equal(style(status, 'height'), '44px');
    assert.equal(style(trigger, 'height'), '100%');
    assert.equal(style(trigger, 'background'), style(componentFixture({ phone: true }).get('ribbonStateTrigger'), 'background'));
    assert.notEqual(style(trigger, 'border-radius'), '44px');
    assert.equal(style(menu, 'position'), 'fixed');
});

test('conflict choices use a native modal with a scrolling middle and visible heading and save action', () => {
    const native = '.modal-content { overflow: auto; } body.is-mobile .modal-content { overflow: auto; } body.is-mobile button:not(.clickable-icon) { padding: 10px; border-radius: 44px; background: native-button; }';
    for (const phone of [false, true]) {
        const nodes = componentFixture({ phone }), style = componentStyles(native + '\n' + css, { phone });
        assert.equal(style(nodes.get('conflictModal'), 'display'), 'flex');
        assert.match(style(nodes.get('conflictModal'), 'max-height'), /^calc\(100vh -/);
        const host = nodes.get('conflictHost');
        assert.equal(style(host, 'display'), 'flex');
        assert.equal(style(host, 'flex-direction'), 'column');
        assert.equal(style(host, 'min-height'), '0');
        assert.equal(style(host, 'overflow'), 'hidden');
        for (const property of ['position', 'inset', 'z-index', 'height']) assert.equal(style(host, property), undefined, property);
        assert.equal(style(nodes.get('conflictContent'), 'overflow-y'), 'auto');
        assert.equal(style(nodes.get('conflictContent'), 'min-height'), '0');
        for (const key of ['conflictHeading', 'conflictFooter']) assert.equal(style(nodes.get(key), 'flex'), '0 0 auto');
        for (const key of ['conflictLocal', 'conflictIncoming', 'conflictSave']) assert.equal(style(nodes.get(key), 'min-height'), phone ? '44px' : '34px');
        for (const key of ['conflictLocal', 'conflictIncoming']) assert.equal(style(nodes.get(key), 'border-radius'), 'var(--radius-rounded)');
        assert.equal(style(nodes.get('conflictLocal'), 'color'), 'var(--color-blue)');
        assert.equal(style(nodes.get('conflictIncoming'), 'color'), 'var(--color-purple)');
        assert.equal(style(nodes.get('conflictLocal'), 'background'), 'var(--background-modifier-hover)');
        assert.equal(style(nodes.get('conflictIncoming'), 'background'), 'transparent');
    }
    assert.doesNotMatch(css, /\.bpm-config-conflict-anchor|\.bpm-config-conflict__(?:versions|version|field|difference)\b/);
});

test('sync notices share their component outside the manager and follow each toolbar size', () => {
    for (const phone of [false, true]) {
        const nodes = componentFixture({ phone }), style = componentStyles(css, { phone });
        for (const key of ['globalNoticeIdle', 'settingNoticeIdle']) assert.equal(style(nodes.get(key), 'display'), 'none');
        for (const key of ['globalNotice', 'settingNotice']) {
            assert.equal(style(nodes.get(key), 'display'), 'inline-flex');
            assert.equal(style(nodes.get(key), 'box-sizing'), 'border-box');
            assert.equal(style(nodes.get(key), 'border-radius'), 'var(--radius-rounded)');
        }
        assert.equal(style(nodes.get('globalNotice'), 'height'), phone ? '44px' : '34px');
        assert.equal(style(nodes.get('settingNotice'), 'height'), phone ? '44px' : '30px');
        assert.equal(style(nodes.get('settingNoticeIcon'), 'display'), 'inline-flex');
        assert.equal(style(nodes.get('settingNoticeSvg'), 'width'), 'var(--icon-size)');
        assert.equal(style(nodes.get('settingNoticeSvg'), 'height'), 'var(--icon-size)');
    }
});

test('only the Preview tool expands for its native flair while personalization actions still wrap', () => {
    const native = ':root { --input-height: 30px; } body.is-mobile { --input-height: 44px; }';
    for (const phone of [false, true]) {
        const nodes = componentFixture({ phone }), style = componentStyles(native + '\n' + css, { phone });
        const standard = nodes.get('personalbutton'), preview = nodes.get('previewtool');
        assert.equal(style(standard, 'width'), phone ? '44px' : '30px');
        assert.equal(style(standard, 'padding'), '0');
        assert.equal(style(preview, 'width'), 'auto');
        assert.equal(style(preview, 'padding'), '0 var(--size-4-2)');
        assert.equal(style(preview, 'height'), style(standard, 'height'));
        assert.equal(style(preview, 'max-width'), '100%');
        assert.equal(style(nodes.get('personalcontrol'), 'flex-wrap'), 'wrap');
    }
});

test('managed native scrollbar tracks reserve no height and floating thumbs retain Obsidian colours',()=>{
    const nodes=componentFixture(),style=componentStyles(css);
    for(const key of ['tabs','switcher','filtergroup']){
        const scrollbar=pseudoElement(nodes.get(key),'::-webkit-scrollbar');
        assert.equal(style(scrollbar,'display'),'none');
        assert.equal(style(scrollbar,'width'),'0');
        assert.equal(style(scrollbar,'height'),'0');
        assert.equal(style(nodes.get(key),'position'),'relative');
    }
    const track=nodes.get('track');
    assert.equal(style(track,'display'),'none');
    assert.equal(style(track,'height'),'4px');
    assert.equal(style(track,'bottom'),'1px');
    assert.equal(style(nodes.get('thumb'),'background'),'var(--background-modifier-border)');
    const theme=componentStyles(`${css}\nbody { --scrollbar-thumb-bg: var(--text-muted); }`);
    assert.equal(theme(nodes.get('thumb'),'background'),'var(--text-muted)');
});
