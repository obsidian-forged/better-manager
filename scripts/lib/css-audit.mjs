import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { createHash } from 'node:crypto';

const sharedContexts = new Set(['media', 'supports', 'container', 'layer', 'scope', 'starting-style']);
const escapeCell = value => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').replace(/`/g, '\\`');

function selectorsOf(text) {
    return selectorParser().astSync(text).nodes.map(selector => selectorParser().processSync(selector.toString(), { lossless: false }).trim());
}

function contextOf(rule, identities) {
    const parts = [];
    for (let node = rule.parent; node && node.type !== 'root'; node = node.parent) {
        if (node.type === 'atrule') {
            if (/keyframes$/i.test(node.name)) return null;
            const name = node.name.toLowerCase(), params = node.params.trim();
            // Anonymous layers/scopes and unknown directives are independent contexts.
            parts.unshift({ name: `@${name}`, params, identity: !params || !sharedContexts.has(name) ? identities.get(node) : undefined });
        } else if (node.type === 'rule') {
            // Keep nesting boundaries explicit; do not guess how '&' expands.
            parts.unshift({ name: 'nested', params: node.selector });
        }
    }
    return parts;
}

function simpleSuffix(broad, narrow) {
    if (broad === narrow) return false;
    const left = selectorParser().astSync(broad).nodes[0];
    const right = selectorParser().astSync(narrow).nodes[0];
    if (!left || !right || [...left.nodes, ...right.nodes].some(node => node.type === 'nesting' || node.type === 'combinator' && ![' ', '>'].includes(node.value.trim() || ' '))) return false;
    const tokens = selector => selector.nodes.map(node => node.type === 'combinator' ? node.value.trim() || ' ' : node.toString().trim());
    const old = tokens(left), next = tokens(right);
    if (old.length >= next.length) return false;
    const offset = next.length - old.length;
    // Only an exact selector suffix separated by an ancestor combinator is an overlap hint.
    // This does not imply the broad rule is unused outside that narrower subtree.
    const boundary = right.nodes[offset - 1];
    return boundary?.type === 'combinator' && old.every((token, index) => token === next[offset + index]);
}

function subjectKey(selector) {
    const parsed = selectorParser().astSync(selector).nodes[0];
    const nodes = parsed?.nodes || [];
    const lastCombinator = nodes.reduce((last, node, index) => node.type === 'combinator' ? index : last, -1);
    return nodes.slice(lastCombinator + 1).find(node => node.type === 'class' && !/^(?:is-|has-)/.test(node.value))?.value;
}

function location(node, file) {
    return { file, line: node.source.start.line, column: node.source.start.column, endLine: node.source.end.line };
}
const positionOf = item => ({ file: item.file, line: item.line, column: item.column, endLine: item.endLine });

/** Read-only cascade inventory. Exact duplicates are separate from candidates needing browser validation. */
export function auditCss(source, { file = 'styles.css', maxOverlaps = 1000 } = {}) {
    const root = postcss.parse(source, { from: file });
    const identities = new WeakMap(); let identity = 0;
    root.walk(node => identities.set(node, ++identity));
    const declarations = [], rules = [], ignored = [], warnings = [];
    const headings = root.nodes.filter(node => node.type === 'comment').map(node => ({ line: node.source.start.line, title: node.text.trim().replace(/\s+/g, ' ') }));
    const sectionAt = line => headings.filter(heading => heading.line < line).at(-1) || { line: 1, title: '文件开头' };
    const groups = new Map(), byProperty = new Map(), suffixCache = new Map(), subjectCache = new Map();
    const subject = selector => { if (!subjectCache.has(selector)) subjectCache.set(selector, subjectKey(selector)); return subjectCache.get(selector); };
    root.walkRules(rule => {
        const context = contextOf(rule, identities);
        if (context === null) { ignored.push({ ...location(rule, file), reason: 'keyframes' }); return; }
        let selectors;
        try { selectors = [...new Set(selectorsOf(rule.selector))]; }
        catch (error) { warnings.push({ ...location(rule, file), selector: rule.selector, message: error.message }); return; }
        const ruleRecord = { id: `R${rules.length + 1}`, ...location(rule, file), selector: rule.selector.trim(), selectors,
            selectorList: JSON.stringify([...selectors].sort()), context, contextKey: JSON.stringify(context), section: sectionAt(rule.source.start.line), declarations: [], hasNestedNodes: false };
        rules.push(ruleRecord);
        for (const node of rule.nodes || []) {
            if (node.type !== 'decl') { if (node.type !== 'comment') ruleRecord.hasNestedNodes = true; continue; }
            // CSS custom property names are case-sensitive; normal property names are not.
            const property = node.prop.startsWith('--') ? node.prop : node.prop.toLowerCase();
            const declaration = { id: `D${declarations.length + 1}`, order: declarations.length, ...location(node, file),
                property, value: node.value.trim(), important: Boolean(node.important), rule: ruleRecord.id, selectors,
                selectorList: ruleRecord.selectorList, contextKey: ruleRecord.contextKey };
            declarations.push(declaration); ruleRecord.declarations.push(declaration.id);
            for (const selector of selectors) {
                const key = JSON.stringify([ruleRecord.contextKey, selector, property]);
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(declaration);
                const overlapKey = JSON.stringify([ruleRecord.contextKey, property, subject(selector)]);
                if (!byProperty.has(overlapKey)) byProperty.set(overlapKey, []);
                byProperty.get(overlapKey).push({ declaration, selector });
            }
        }
    });

    const outcomes = new Map();
    for (const [key, chain] of groups) {
        const selector = JSON.parse(key)[1], important = chain.filter(item => item.important), winner = (important.length ? important : chain).at(-1);
        for (const declaration of chain) {
            if (!outcomes.has(declaration.id)) outcomes.set(declaration.id, []);
            outcomes.get(declaration.id).push({ winner: winner.id, selector });
        }
    }
    const declarationById = new Map(declarations.map(item => [item.id, item]));
    const ruleById = new Map(rules.map(item => [item.id, item]));
    const candidates = [], blockers = [];
    for (const declaration of declarations) {
        const branches = outcomes.get(declaration.id) || [];
        const losing = branches.filter(branch => branch.winner !== declaration.id);
        if (!losing.length) continue;
        const activeSelectors = branches.filter(branch => branch.winner === declaration.id).map(branch => branch.selector);
        const replacements = losing.map(branch => {
            const winner = declarationById.get(branch.winner);
            return { selector: branch.selector, winner: winner.id, file: winner.file, line: winner.line, column: winner.column, endLine: winner.endLine, value: winner.value, important: winner.important,
                reason: winner.important && !declaration.important ? 'important-wins' : 'later-declaration',
                exactDuplicate: declaration.value === winner.value && declaration.important === winner.important && declaration.selectorList === winner.selectorList };
        });
        const blocked = replacements.filter(item => declarationById.get(item.winner).order < declaration.order && item.important && !declaration.important);
        if (blocked.length) blockers.push({ declaration: declaration.id, ...positionOf(declaration), selector: ruleById.get(declaration.rule).selector,
            property: declaration.property, value: declaration.value, blockers: blocked });
        candidates.push({ id: declaration.id, ...positionOf(declaration), rule: declaration.rule, selector: ruleById.get(declaration.rule).selector,
            property: declaration.property, value: declaration.value, important: declaration.important, context: ruleById.get(declaration.rule).context,
            section: ruleById.get(declaration.rule).section,
            scrollbarRelated: /^scrollbar-/.test(declaration.property) || /scrollbar|bpm-scroll-strip/.test(ruleById.get(declaration.rule).selector),
            confidence: !activeSelectors.length && replacements.every(item => item.exactDuplicate) ? 'exact-duplicate' : 'review',
            action: activeSelectors.length ? 'split-selectors-first' : blocked.length ? 'resolve-important-blocker' : 'review-declaration-removal', activeSelectors, replacements });
    }
    const candidateById = new Map(candidates.map(item => [item.id, item]));
    const sections = new Map();
    for (const rule of rules) {
        const { line, title } = rule.section;
        if (!sections.has(line)) sections.set(line, { line, title, declarations: 0, important: 0, fullyShadowed: 0, shadowedImportant: 0, exactDuplicates: 0 });
        const section = sections.get(line);
        for (const id of rule.declarations) {
            const declaration = declarationById.get(id), candidate = candidateById.get(id);
            section.declarations++; if (declaration.important) section.important++;
            if (candidate && !candidate.activeSelectors.length) { section.fullyShadowed++; if (declaration.important) section.shadowedImportant++; }
            if (candidate?.confidence === 'exact-duplicate') section.exactDuplicates++;
        }
    }
    const ruleCandidates = rules.filter(rule => rule.declarations.length && !rule.hasNestedNodes
        && rule.declarations.every(id => candidateById.has(id) && !candidateById.get(id).activeSelectors.length)).map(rule => ({
        ...positionOf(rule), id: rule.id, selector: rule.selector, context: rule.context, declarations: rule.declarations,
        confidence: rule.declarations.every(id => candidateById.get(id).confidence === 'exact-duplicate') ? 'exact-duplicate' : 'review',
        importantCount: rule.declarations.filter(id => declarationById.get(id).important).length,
    }));

    const overlaps = []; let overlapCount = 0;
    for (const entries of byProperty.values()) {
        for (let index = 0; index < entries.length; index++) {
            const next = entries[index];
            if (!subject(next.selector)) continue;
            for (const old of entries.slice(0, index)) {
                if (old.declaration.id === next.declaration.id || old.declaration.value === next.declaration.value) continue;
                if (old.declaration.important && !next.declaration.important) continue;
                const pair = JSON.stringify([old.selector, next.selector]);
                if (!suffixCache.has(pair)) suffixCache.set(pair, simpleSuffix(old.selector, next.selector));
                if (!suffixCache.get(pair)) continue;
                overlapCount++;
                if (overlaps.length < maxOverlaps) overlaps.push({ old: old.declaration.id, next: next.declaration.id,
                    property: next.declaration.property, broadSelector: old.selector, narrowSelector: next.selector,
                    oldLine: old.declaration.line, newLine: next.declaration.line, oldValue: old.declaration.value, newValue: next.declaration.value,
                    oldImportant: old.declaration.important, nextImportant: next.declaration.important,
                    context: ruleById.get(next.declaration.rule).context });
            }
        }
    }
    const hotspots = new Map();
    for (const declaration of declarations.filter(item => item.important)) {
        const rule = ruleById.get(declaration.rule), key = rule.selector;
        if (!hotspots.has(key)) hotspots.set(key, { selector: key, importantCount: 0, lines: new Set(), properties: new Set() });
        const hotspot = hotspots.get(key); hotspot.importantCount++; hotspot.lines.add(rule.line); hotspot.properties.add(declaration.property);
    }
    return { schema: 1, file, sourceHash: createHash('sha256').update(source).digest('hex'),
        policy: 'Read-only. Exact duplicates require identical values, priority, selector lists and contexts. All other deletion candidates need review; narrower selector overlaps are not evidence of global redundancy.',
        summary: { rules: rules.length, declarations: declarations.length, important: declarations.filter(item => item.important).length,
            exactDuplicateDeclarations: candidates.filter(item => item.confidence === 'exact-duplicate').length,
            exactDuplicateImportant: candidates.filter(item => item.confidence === 'exact-duplicate' && item.important).length,
            shadowedImportantDeclarations: candidates.filter(item => item.important && !item.activeSelectors.length).length,
            wholeRuleCandidates: ruleCandidates.length, exactDuplicateRules: ruleCandidates.filter(item => item.confidence === 'exact-duplicate').length,
            reviewDeclarations: candidates.filter(item => item.confidence === 'review').length, blockedNormalDeclarations: blockers.length,
            scopedOverlapHints: overlapCount, scopedOverlapHintsShown: overlaps.length, ignoredKeyframeRules: ignored.length },
        candidates, ruleCandidates, blockers, overlaps, warnings,
        sections: [...sections.values()].filter(section => section.fullyShadowed).sort((a, b) => b.shadowedImportant - a.shadowedImportant || b.fullyShadowed - a.fullyShadowed),
        hotspots: [...hotspots.values()].map(item => ({ ...item, lines: [...item.lines], properties: [...item.properties] })).sort((a, b) => b.importantCount - a.importantCount),
    };
}

export function renderAudit(report) {
    const cell = escapeCell, summary = report.summary;
    const lines = [`# CSS 历史覆盖审计`, '', `文件：\`${report.file}\`。SHA-256：\`${report.sourceHash}\`。`, '',
        '此报告是待删除清单，不会改写 CSS。修改样式后须重新运行，行号与判断只对应上述版本。', '',
        '| 项目 | 数量 |', '| --- | ---: |',
        ...Object.entries({ '规则': summary.rules, '声明': summary.declarations, '!important': summary.important,
            '完全重复声明（高置信候选）': summary.exactDuplicateDeclarations, '其中重复 !important': summary.exactDuplicateImportant,
            '已被同条件同选择器覆盖的 !important（需复核）': summary.shadowedImportantDeclarations,
            '整条规则候选': summary.wholeRuleCandidates, '其中整条完全重复规则': summary.exactDuplicateRules,
            '需复核的被覆盖声明': summary.reviewDeclarations, '被旧 !important 阻挡的新普通声明': summary.blockedNormalDeclarations,
            '较窄选择器覆盖线索': summary.scopedOverlapHints }).map(([name, count]) => `| ${name} | ${count} |`), '',
        '## 判断边界', '',
        '- 高置信重复：选择器列表、条件上下文、属性、原始值及 !important 状态均相同；后者保留，前者进入待删除队列。',
        '- 不同值可能是旧浏览器兼容回退；分开保留 @media、@supports、命名层和嵌套上下文，忽略关键帧。不会把较窄选择器的覆盖当作整条旧规则无用。',
        '- 逗号分组仍有分支生效时，先拆分选择器；简写与长写属性不自动合并。没有 DOM/运行期证据，不判断动态选择器“未使用”。',
        '- 用户主题、外部 CSS、内联样式及 CSSOM 动态修改不在静态证明范围内，最终删除后仍需实际界面验证。',
        '- 滚动条的主题变量、悬停显示、不挤占顶栏高度和触屏交互保持为验收条件，不能以减少告警为由直接改成浏览器默认外观。', '',
        '## 优先整理的历史样式区块', '', '按旧重要声明的覆盖数量排序。区块内仍有生效样式，不能按统计比例整段删除。', '',
        '| 区块起始行 | 已覆盖 / 总声明 | 其中旧 !important | 标题注释 |', '| ---: | ---: | ---: | --- |'];
    for (const section of report.sections.slice(0, 20)) lines.push(`| ${section.line} | ${section.fullyShadowed} / ${section.declarations} | ${section.shadowedImportant} | ${cell(section.title)} |`);
    lines.push('',
        '## 整条规则待删除队列', '', '| ID | 判断 | 旧行 | !important | 选择器 |', '| --- | --- | ---: | ---: | --- |');
    for (const rule of report.ruleCandidates) lines.push(`| ${rule.id} | ${rule.confidence === 'exact-duplicate' ? '完全重复' : '需复核值与回退'} | ${rule.line}–${rule.endLine} | ${rule.importantCount} | \`${cell(rule.selector)}\` |`);
    lines.push('', '## 完全重复声明', '', '| ID | 旧行 | 属性和值 | 保留位置 |', '| --- | ---: | --- | --- |');
    for (const item of report.candidates.filter(item => item.confidence === 'exact-duplicate')) lines.push(`| ${item.id} | ${item.line} | \`${cell(`${item.property}: ${item.value}${item.important ? ' !important' : ''}`)}\` | ${[...new Set(item.replacements.map(next => `${next.winner} / L${next.line}`))].join(', ')} |`);
    lines.push('', '## 旧 !important 阻挡的新声明', '', '| 新行 | 选择器 / 属性 | 实际生效的旧声明 |', '| ---: | --- | --- |');
    for (const item of report.blockers) lines.push(`| ${item.line} | \`${cell(item.selector)}\` / \`${item.property}: ${cell(item.value)}\` | ${[...new Set(item.blockers.map(old => `${old.winner} / L${old.line}: ${old.value} !important`))].map(cell).join('; ')} |`);
    lines.push('', '## 被覆盖但需复核的声明', '', '| ID | 旧行 | 属性和值 | 覆盖来源 | 仍生效的分支 / 处理方式 |', '| --- | ---: | --- | --- | --- |');
    for (const item of report.candidates.filter(item => item.confidence === 'review')) lines.push(`| ${item.id} | ${item.line} | \`${cell(`${item.property}: ${item.value}${item.important ? ' !important' : ''}`)}\` | ${[...new Set(item.replacements.map(next => `${next.winner} / L${next.line}: ${next.value}${next.important ? ' !important' : ''}`))].map(cell).join('; ')} | ${item.activeSelectors.length ? cell(item.activeSelectors.join(', ')) : item.action === 'resolve-important-blocker' ? '核对旧重要声明为何仍需优先' : '核对兼容性回退与实际界面'} |`);
    lines.push('', '## 较窄选择器的覆盖线索', '', `显示 ${report.overlaps.length} / ${summary.scopedOverlapHints} 条。旧规则在其它位置仍可能需要，不能据此整条删除。`, '', '| 旧行 → 新行 | 属性 | 较宽 → 较窄选择器 |', '| --- | --- | --- |');
    for (const item of report.overlaps) lines.push(`| ${item.oldLine} → ${item.newLine} | ${item.property} | \`${cell(item.broadSelector)}\` → \`${cell(item.narrowSelector)}\` |`);
    lines.push('', '## !important 集中区域', '', '| 数量 | 规则行 | 选择器 |', '| ---: | --- | --- |');
    for (const item of report.hotspots.slice(0, 30)) lines.push(`| ${item.importantCount} | ${item.lines.join(', ')} | \`${cell(item.selector)}\` |`);
    if (report.warnings.length) { lines.push('', '## 解析警告', ''); for (const warning of report.warnings) lines.push(`- L${warning.line}: ${cell(warning.message)}`); }
    lines.push('', '完整条件、分支、旧值、新值和声明 ID 见同目录的 css-audit.json。', '');
    return lines.join('\n');
}
