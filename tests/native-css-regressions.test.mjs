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

test('group and tag editors keep content-sized rows and a single compact header on phones', () => {
    for (const phone of [false, true]) for (const kind of ['group', 'tag']) {
        const body = fixtureElement('body', phone ? 'is-mobile is-phone' : '');
        const modal = fixtureElement('div', `modal manager-editor__container manager-tag-editor manager-taxonomy-editor manager-taxonomy-editor--${kind}`, body);
        const close = fixtureElement('div', 'modal-close-button', modal);
        const mobileClose = fixtureElement('div', 'modal-header-button', modal);
        const header = fixtureElement('div', 'modal-header manager-container__header', modal);
        const title = fixtureElement('div', 'modal-title', header);
        const bar = fixtureElement('div', 'setting-item manager-tag-editor__titlebar', title);
        const titleControl = fixtureElement('div', 'setting-item-control', bar);
        const list = fixtureElement('div', 'manager-tag-editor__list', modal);
        const row = fixtureElement('div', 'setting-item manager-editor__item manager-tag-editor__item', list);
        const controls = fixtureElement('div', 'setting-item-control manager-tag-editor__item-actions', row);
        const style = componentStyles(native + '\n' + css, { phone });
        assert.notEqual(style(row, 'height'), '100%');
        assert.equal(style(row, 'display'), 'grid');
        assert.equal(style(bar, 'display'), 'grid');
        assert.equal(style(title, 'width'), '100%');
        assert.equal(style(close, 'display'), 'none');
        assert.equal(style(mobileClose, 'display'), 'none');
        assert.equal(style(titleControl, 'width'), 'auto');
        assert.equal(style(controls, 'width'), 'auto');
        row.classes.add('is-editing');
        if (phone) assert.equal(componentStyles(native + '\n' + css, { phone })(controls, 'grid-column'), '1 / -1');
    }
});

test('dropdown option actions remain beside their option under native mobile button rules', () => {
    for (const phone of [false, true]) {
        const body = fixtureElement('body', phone ? 'is-mobile is-phone' : '');
        const root = fixtureElement('div', 'manager-multiselect-filter', body);
        const menu = fixtureElement('div', 'manager-multiselect-filter__menu', root);
        const row = fixtureElement('div', 'manager-multiselect-filter__option-row', menu);
        const option = fixtureElement('button', 'manager-multiselect-filter__option', row);
        const action = fixtureElement('button', 'manager-multiselect-filter__option-action clickable-icon', row);
        const style = componentStyles(native + '\n' + css, { phone });
        assert.equal(style(row, 'display'), 'flex');
        assert.equal(style(option, 'width'), 'auto');
        assert.equal(style(action, 'padding'), '0');
        assert.equal(style(action, 'width'), style(action, 'height'));
    }
});

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
        assert.equal(style(button,'width'),phone?'32px':'34px');
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

test('workflow modals keep phone toggles and selectors beside labels without native full-width buttons', () => {
    for (const phone of [false, true]) {
        const body = fixtureElement('body', phone ? 'is-mobile is-phone' : '');
        const modal = fixtureElement('div', 'modal manager-container manager-workflow-modal manager-update-rules', body);
        const content = fixtureElement('div', 'modal-content', modal);
        const card = fixtureElement('div', 'manager-source-card manager-workflow-modal__card', content);
        const row = fixtureElement('div', 'setting-item manager-workflow-modal__inline', card);
        const info = fixtureElement('div', 'setting-item-info', row);
        const control = fixtureElement('div', 'setting-item-control', row);
        const select = fixtureElement('select', 'dropdown', control);
        const pagination = fixtureElement('div', 'setting-item manager-workflow-modal__pagination', content);
        const pagingControl = fixtureElement('div', 'setting-item-control', pagination);
        const next = fixtureElement('button', '', pagingControl);
        const style = componentStyles(native + '\n' + css, { phone });
        assert.equal(style(row, 'flex-direction'), 'row');
        assert.equal(style(row, 'flex-wrap'), 'nowrap');
        assert.equal(style(row, 'border-top'), '0');
        assert.equal(style(info, 'min-width'), '0');
        assert.equal(style(control, 'width'), 'auto');
        assert.equal(style(control, 'max-width'), '58%');
        assert.equal(style(select, 'min-width'), '0');
        assert.equal(style(next, 'width'), 'auto');
        assert.equal(style(pagingControl, 'flex-wrap'), 'nowrap');
    }
});

test('restore-point rename forms reserve a full control row while keeping actions compact', () => {
    const body = fixtureElement('body', 'is-mobile is-phone');
    const modal = fixtureElement('div', 'modal manager-container manager-workflow-modal manager-history', body);
    const content = fixtureElement('div', 'modal-content', modal);
    const row = fixtureElement('div', 'setting-item manager-workflow-modal__form', content);
    const control = fixtureElement('div', 'setting-item-control', row);
    const input = fixtureElement('input', '', control);
    const button = fixtureElement('button', '', control);
    const style = componentStyles(native + '\n' + css, { phone: true });
    assert.equal(style(control, 'width'), '100%');
    assert.equal(style(control, 'flex'), '1 1 100%');
    assert.equal(style(input, 'flex'), '1 1 100px');
    assert.equal(style(button, 'width'), 'auto');
});

test('workflow title and close share a compact native header on phones and desktops', () => {
    for (const phone of [false, true]) {
        const body = fixtureElement('body', phone ? 'is-mobile is-phone' : '');
        const modal = fixtureElement('div', 'modal manager-container manager-workflow-modal manager-container--mobile', body);
        const header = fixtureElement('div', 'modal-header manager-workflow-modal__header', modal);
        const title = fixtureElement('div', 'modal-title manager-workflow-modal__title', header);
        const icon = fixtureElement('span', 'manager-workflow-modal__icon', title);
        const close = fixtureElement('button', 'clickable-icon manager-modal-close manager-workflow-modal__close', title);
        const style = componentStyles(native + '\n' + css, { phone });
        assert.equal(style(header, 'margin'), '0');
        assert.equal(style(header, 'min-height'), '0');
        assert.equal(style(title, 'display'), 'flex');
        assert.equal(style(title, 'text-align'), 'start');
        assert.equal(style(title, 'max-width'), 'none');
        assert.equal(style(close, 'width'), style(icon, 'width'));
        assert.equal(style(close, 'height'), style(icon, 'height'));
        assert.equal(style(close, 'padding'), '0');
    }
});

test('catalog mobile navigation overrides the legacy fit-content segmented group at every layer', () => {
    const body = fixtureElement('body', 'is-mobile is-phone');
    const modal = fixtureElement('div', 'modal manager-container manager-container--mobile manager-catalog manager-workflow-modal', body);
    const switcher = fixtureElement('div', 'manager-repo-page__switcher manager-catalog__mobile-navigation', modal);
    const scope = fixtureElement('div', 'manager-scope-select--compact', switcher);
    const root = fixtureElement('div', 'manager-multiselect-filter', scope);
    const trigger = fixtureElement('button', 'manager-multiselect-filter__trigger', root);
    const style = componentStyles(native + '\n' + css, { phone: true });
    for (const element of [switcher, scope, root, trigger]) assert.equal(style(element, 'width'), '100%');
    assert.equal(style(switcher, 'align-self'), 'stretch');
    assert.equal(style(switcher, 'margin-inline'), '0');
    assert.equal(style(switcher, 'height'), 'auto');
    assert.equal(style(switcher, 'overflow'), 'visible');
});

test('expanded catalog phone filters place labels above full-width values and retain a full-width search', () => {
    const body = fixtureElement('body', 'is-mobile is-phone');
    const modal = fixtureElement('div', 'modal manager-container manager-container--mobile manager-catalog manager-workflow-modal', body);
    const content = fixtureElement('div', 'modal-content', modal);
    const filters = fixtureElement('div', 'manager-catalog-filters', content);
    const bar = fixtureElement('div', 'setting-item manager-bar__search', filters);
    const control = fixtureElement('div', 'setting-item-control', bar);
    const search = fixtureElement('div', 'manager-search-line', control);
    const group = fixtureElement('div', 'manager-filter-control-group', control);
    const field = fixtureElement('div', 'manager-filter-field manager-filter-field--select', group);
    const label = fixtureElement('div', 'manager-filter-field__label', field);
    const value = fixtureElement('div', 'manager-filter-field__control', field);
    const style = componentStyles(native + '\n' + css, { phone: true });
    assert.equal(style(control, 'width'), '100%');
    assert.equal(style(search, 'width'), '100%');
    assert.equal(style(group, 'grid-template-columns'), 'repeat(2, minmax(0, 1fr))');
    assert.equal(style(field, 'flex-direction'), 'column');
    assert.equal(style(label, 'flex'), '0 0 auto');
    assert.equal(style(label, 'width'), '100%');
    assert.equal(style(label, 'border-right'), '0');
    assert.equal(style(value, 'width'), '100%');
    assert.equal(style(value, 'height'), 'auto');
});

test('catalog stacked fields escape legacy fixed input height and card actions stay square in one row', () => {
    const body = fixtureElement('body', 'is-mobile is-phone');
    const modal = fixtureElement('div', 'modal manager-container manager-container--mobile manager-catalog manager-workflow-modal', body);
    const group = fixtureElement('div', 'manager-filter-control-group', modal);
    const field = fixtureElement('div', 'manager-filter-field manager-filter-field--select', group);
    const card = fixtureElement('div', 'manager-source-card manager-catalog-card', modal);
    const actions = fixtureElement('div', 'manager-source-page__actions manager-catalog-card__actions', card);
    const button = fixtureElement('button', 'clickable-icon', actions);
    const style = componentStyles(native + '\n' + css, { phone: true });
    assert.equal(style(field, 'height'), 'auto');
    assert.equal(style(field, 'min-height'), '0');
    assert.equal(style(group, 'grid-auto-rows'), 'auto');
    assert.equal(style(actions, 'flex-direction'), 'row');
    assert.equal(style(actions, 'flex-wrap'), 'nowrap');
    assert.equal(style(actions, 'justify-content'), 'flex-end');
    assert.equal(style(button, 'width'), style(button, 'height'));
    assert.equal(style(button, 'flex'), '0 0 ' + style(button, 'width'));
    assert.equal(style(button, 'padding'), '0');
});

test('catalog detail statistics and return link stay lightweight while hero actions remain compact', () => {
    const body = fixtureElement('body', 'is-mobile is-phone');
    const modal = fixtureElement('div', 'modal manager-container manager-container--mobile manager-catalog manager-workflow-modal', body);
    const content = fixtureElement('div', 'modal-content', modal);
    const stat = fixtureElement('span', 'manager-repo-page__stat', content);
    const back = fixtureElement('button', 'manager-catalog__back', content);
    const detail = fixtureElement('div', 'manager-catalog__detail', content);
    const card = fixtureElement('div', 'manager-source-card manager-catalog__detail-overview', detail);
    const row = fixtureElement('div', 'setting-item manager-catalog__section-heading', card);
    const actions = fixtureElement('div', 'manager-catalog-card__actions manager-catalog__detail-actions', card);
    const button = fixtureElement('button', 'clickable-icon', actions);
    const style = componentStyles(native + '\n' + css, { phone: true });
    assert.equal(style(stat, 'padding'), '0');
    assert.equal(style(stat, 'background'), 'transparent');
    assert.equal(style(stat, 'height'), 'auto');
    assert.equal(style(back, 'width'), 'auto');
    assert.equal(style(back, 'height'), style(button, 'height'));
    assert.equal(style(row, 'min-height'), '0');
    assert.equal(style(row, 'margin'), '0');
    assert.equal(style(actions, 'padding'), '0');
    assert.equal(style(actions, 'flex-direction'), 'row');
    assert.equal(style(button, 'width'), style(button, 'height'));
});
