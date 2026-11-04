import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componentFixture, componentStyles, fixtureElement } from './helpers/css-cascade.mjs';

const css=readFileSync('styles.css','utf8');

// Native Obsidian rules observed in the isolated 1.14 runtime; these fixtures
// check the host/plugin cascade and do not replace native or minimum-version QA.
const native=`
    :root { --size-4-4: 16px; --input-height: 34px; }
    .is-mobile { --input-height: 44px; }
    .modal:not(.mod-settings) .setting-item:not(.setting-item-heading):where(:not(.setting-group *)) {
        padding: var(--size-4-4) 0;
        border-top: 1px solid var(--background-modifier-border);
        background-color: transparent;
    }
    .modal:not(.mod-settings) .setting-item:not(.setting-item-heading):where(:not(.setting-group *)):first-child { padding-top: 0; }
    .modal:not(.mod-settings) .setting-item:not(.setting-item-heading):where(:not(.setting-group *)):last-child { padding-bottom: 0; }
    .is-phone .modal .setting-item:not(:is(.mod-toggle, .mod-navigable, .mod-action, .setting-item-heading)) {
        flex-direction: column;
        align-items: flex-start;
    }
    .is-phone .modal .setting-item-control button:not(.clickable-icon) { width: 100%; margin: 0; }
    .is-phone .modal .setting-item-control button { padding: 10px; }
    .is-tablet button:not(.clickable-icon) { padding: 4px 20px; }
    @container (max-width: 400px) {
        .setting-item:not(:is(.mod-toggle, .mod-navigable, .mod-action, .setting-item-heading, .mod-list *)) {
            flex-direction: column;
        }
        .setting-item:not(:is(.mod-toggle, .mod-navigable, .mod-action, .setting-item-heading, .mod-list *)) .setting-item-control {
            width: 100%;
            justify-content: flex-start;
        }
        .setting-item:not(:is(.mod-toggle, .mod-navigable, .mod-action, .setting-item-heading, .mod-list *)) .setting-item-control button:not(.clickable-icon) {
            width: 100%;
            max-width: 100%;
        }
    }
`;

test('appearance cards keep their compact padding inside native mobile modals',()=>{
    for(const phone of [false,true]){
        const nodes=componentFixture({phone}),style=componentStyles(native+'\n'+css,{phone});
        assert.equal(style(nodes.get('themecard'),'padding'),'10px 12px');
        assert.equal(style(nodes.get('themecard'),'padding-top'),'10px');
        assert.equal(style(nodes.get('themecard'),'padding-bottom'),'10px');
    }
});

test('quick apply rows keep compact padding and omit native modal separators',()=>{
    for(const phone of [false,true]){
        const nodes=componentFixture({phone});
        nodes.get('quicksetting').classes.add('quick-apply-parts__row');
        const style=componentStyles(native+'\n'+css,{phone});
        assert.equal(style(nodes.get('quicksetting'),'padding'),'2px 0');
        assert.equal(style(nodes.get('quicksetting'),'border-top'),'0');
        assert.equal(style(nodes.get('quickheading'),'padding'),'0');
    }
});

test('personalization icon actions avoid native full-width buttons and column-only rows',()=>{
    for(const phone of [false,true]){
        const body=fixtureElement('body',phone?'is-mobile is-phone':''),
            modal=fixtureElement('div','modal mod-settings',body),
            setting=fixtureElement('div','manager-setting__container',modal),
            personal=fixtureElement('div','manager-personalize',setting),
            tools=fixtureElement('div','manager-personalize__tools',personal),
            row=fixtureElement('div','setting-item manager-personalize__actions mod-action',tools),
            control=fixtureElement('div','setting-item-control',row),
            button=fixtureElement('button','clickable-icon manager-personalize__tool',control),
            style=componentStyles(native+'\n'+css,{phone});
        assert.equal(style(button,'width'),phone?'44px':'34px');
        assert.equal(style(button,'padding'),'0');
        assert.notEqual(style(row,'flex-direction'),'column');
        assert.notEqual(style(control,'flex-direction'),'column');
    }
});

test('tablet note-view icons stay visible inside their 16px controls',()=>{
    const nodes=componentFixture();
    const defaultButton=fixtureElement('button','manager-plugin-card__view-default',nodes.get('viewbar'));
    let body=nodes.get('viewtoggle');
    while(body.parent)body=body.parent;
    body.classes.add('is-mobile');
    body.classes.add('is-tablet');
    const style=componentStyles(native+'\n'+css);
    for(const button of [nodes.get('viewtoggle'),defaultButton]){
        assert.equal(style(button,'width'),'16px');
        assert.equal(style(button,'height'),'16px');
        assert.equal(style(button,'padding'),'0');
    }
});

test('collapsed page navigation occupies the same header row as global actions',()=>{
    const nodes=componentFixture(),toolbar=nodes.get('tabs').parent;
    toolbar.classes.add('bpm-responsive-tabs');
    toolbar.classes.add('is-tabs-compact');
    nodes.get('tabs').classes.add('bpm-responsive-tabs__rail');
    fixtureElement('div','manager-global-tools',toolbar);
    const select=fixtureElement('div','manager-scope-select--compact bpm-responsive-tabs__select',toolbar);
    const style=componentStyles(css);
    assert.equal(style(select,'display'),'inline-flex');
    assert.equal(style(select,'grid-column'),'2');
    assert.equal(style(select,'grid-row'),'1');
    assert.equal(style(nodes.get('tabs'),'display'),'none');
});
