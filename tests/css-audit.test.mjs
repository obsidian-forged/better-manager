import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditCss, renderAudit } from '../scripts/lib/css-audit.mjs';

test('exact duplicates preserve the later rule and identify removable important declarations', () => {
    const report = auditCss('.tab { color: red !important; padding: 3px; }\n.tab { color: red !important; padding: 3px; }');
    assert.equal(report.summary.exactDuplicateDeclarations, 2);
    assert.equal(report.summary.exactDuplicateImportant, 1);
    assert.equal(report.ruleCandidates[0].confidence, 'exact-duplicate');
    assert.equal(report.ruleCandidates[0].line, 1);
    assert.ok(report.candidates.every(item => item.replacements[0].line === 2));
});

test('different values, modern syntax fallbacks and priority changes require review', () => {
    const report = auditCss('.tab { width: 100%; } .tab { width: min(100%, 800px); } .tab { color: red; } .tab { color: red !important; }');
    assert.equal(report.summary.exactDuplicateDeclarations, 0);
    assert.equal(report.summary.reviewDeclarations, 2);
    assert.ok(report.candidates.every(item => item.confidence === 'review'));
});

test('an old important declaration blocking a newer normal declaration is not declared dead', () => {
    const report = auditCss('.tab { color: red !important; }\n.tab { color: blue; }');
    assert.equal(report.blockers.length, 1);
    assert.equal(report.blockers[0].line, 2);
    assert.equal(report.blockers[0].blockers[0].line, 1);
    assert.equal(report.candidates[0].action, 'resolve-important-blocker');
    assert.equal(report.candidates[0].important, false);
});

test('selector list branches still in use prevent removing the entire old declaration', () => {
    const report = auditCss('.tab, .button { color: red; }\n.tab { color: blue; }');
    assert.equal(report.ruleCandidates.length, 0);
    assert.deepEqual(report.candidates[0].activeSelectors, ['.button']);
    assert.equal(report.candidates[0].action, 'split-selectors-first');
    // Differing selector lists can also have different browser parsing validity.
    const overlap = auditCss('.tab { color: red; } .tab, .unknown:future-pseudo { color: red; }');
    assert.equal(overlap.summary.exactDuplicateDeclarations, 0);
});

test('media, support, layer and nesting conditions remain distinct and keyframes are ignored', () => {
    const report = auditCss(`.tab { color: red; }
        @media (max-width: 500px) { .tab { color: blue; } }
        @supports (display: grid) { .tab { color: blue; } }
        @layer first { .tab { color: blue !important; } }
        @layer second { .tab { color: blue !important; } }
        @layer { .tab { color: green; } } @layer { .tab { color: green; } }
        .one { .child { color: red; } } .two { .child { color: red; } }
        @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`);
    assert.equal(report.candidates.length, 0);
    assert.equal(report.summary.ignoredKeyframeRules, 2);
    const repeated = auditCss('@media (max-width: 500px) { .tab { color: red; } } @media (max-width: 500px) { .tab { color: red; } }');
    assert.equal(repeated.summary.exactDuplicateDeclarations, 1);
});

test('custom property case and shorthand/longhand behavior do not get flattened', () => {
    const report = auditCss('.tab { --Color: red; --color: blue; margin-left: 4px; margin: 0; }');
    assert.equal(report.candidates.length, 0);
});

test('narrower important selectors are overlap hints rather than proof the broad rule can be removed', () => {
    const report = auditCss('.tab { color: red !important; } body .panel .tab { color: blue !important; }', { maxOverlaps: 1 });
    assert.equal(report.overlaps.length, 1);
    assert.equal(report.overlaps[0].broadSelector, '.tab');
    assert.equal(report.candidates.length, 0);
    const sibling = auditCss('.tab { color: red; } .other + .tab { color: blue !important; }');
    assert.equal(sibling.overlaps.length, 0);
});

test('normal scoped overrides remain visible after important cleanup without treating a blocked normal declaration as an override', () => {
    const report = auditCss('.tab { padding: 8px; } .panel .tab { padding: 4px; } .protected { color: red !important; } .panel .protected { color: blue; }');
    assert.equal(report.overlaps.length, 1);
    assert.equal(report.overlaps[0].property, 'padding');
    assert.equal(report.overlaps[0].oldImportant, false);
    assert.equal(report.overlaps[0].nextImportant, false);
    assert.equal(report.candidates.length, 0);
});

test('complex selector lists and values with strings, commas and braces are parsed without text replacement', () => {
    const report = auditCss('.tab:is(.a,.b) { content: "};,|"; color: rgb(1,2,3); }\n.tab:is(.a, .b) { content: "};,|"; color: rgb(1,2,3); }');
    assert.equal(report.summary.exactDuplicateDeclarations, 2);
    assert.match(renderAudit(report), /完全重复声明/);
    assert.match(renderAudit(report), /\\\|/);
});

test('the command writes review artifacts without changing the input and rejects malformed CSS', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bpm-css-audit-'));
    try {
        const file = path.join(directory, 'input.css'), out = path.join(directory, 'out');
        const original = '.tab { color: red; }\r\n.tab { color: red; }\r\n';
        await writeFile(file, original);
        const result = spawnSync(process.execPath, ['scripts/audit-css.mjs', file, '--out-dir', out], { encoding: 'utf8', timeout: 5000 });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(await readFile(file, 'utf8'), original);
        const report = JSON.parse(await readFile(path.join(out, 'css-audit.json'), 'utf8'));
        assert.equal(report.summary.exactDuplicateDeclarations, 1);
        assert.match(await readFile(path.join(out, 'css-audit.md'), 'utf8'), /L2/);
        await writeFile(file, '.tab { color: red;');
        const failed = spawnSync(process.execPath, ['scripts/audit-css.mjs', file, '--out-dir', out], { encoding: 'utf8', timeout: 5000 });
        assert.notEqual(failed.status, 0);
        assert.match(failed.stderr, /Unclosed block/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
