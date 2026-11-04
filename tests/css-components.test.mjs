import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { componentFixture, componentStyles, pseudoElement } from './helpers/css-cascade.mjs';

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
