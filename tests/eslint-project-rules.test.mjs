import { RuleTester } from 'eslint';
import { debugConsole, noDirectStyles } from '../scripts/eslint-project-rules.mjs';

new RuleTester().run('no-direct-styles', noDirectStyles, {
    valid: ['element.setCssStyles({ width: `${size}px` });', 'element.setCssProps({ "--progress": value });', 'element.style.getPropertyValue("width");'],
    invalid: [
        'element.style.width = `${size}px`;', 'element["style"].display = visible ? "" : "none";',
        'element.style.setProperty("width", value);', 'element.style.removeProperty("width");',
        'element.setAttribute("style", css);',
    ].map(code => ({ code, errors: [{ messageId: 'direct' }] })),
});

new RuleTester().run('debug-console', debugConsole, {
    valid: [
        'if (manager.settings.DEBUG) console.error(error);',
        'if (manager.settings?.DEBUG && error) { console.warn(error); }',
        'work.catch(error => { if (manager.settings.DEBUG) console.error(error); });',
    ],
    invalid: [
        'console.error(error);',
        'if (!manager.settings.DEBUG) console.error(error);',
        'if (manager.settings.DEBUG || other) console.error(error);',
        'if (manager.settings.DEBUG) { run(() => console.error(error)); }',
    ].map(code => ({ code, errors: [{ messageId: 'unguarded' }] })),
});
