const property = node => node?.computed ? node.property.type === 'Literal' ? node.property.value : undefined : node?.property?.name;
const style = node => node?.type === 'MemberExpression' && property(node) === 'style';
const debugGuard = node => node?.type === 'ChainExpression' ? debugGuard(node.expression)
    : node?.type === 'MemberExpression' ? property(node) === 'DEBUG'
    : node?.type === 'LogicalExpression' && node.operator === '&&' && (debugGuard(node.left) || debugGuard(node.right));

/** Diagnostics follow the current user's DEBUG preference, including errors and warnings. */
export const debugConsole = {
    meta: { type: 'problem', schema: [], messages: { unguarded: 'Guard console diagnostics with the DEBUG setting or use the shared diagnostic reporter.' } },
    create(context) {
        return {
            CallExpression(node) {
                const callee = node.callee;
                if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier' || callee.object.name !== 'console') return;
                let child = node;
                for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
                    // A nested callback can run later, after the preference changes.
                    if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(parent.type)) break;
                    if (parent.type === 'IfStatement' && parent.consequent === child && debugGuard(parent.test)) return;
                }
                context.report({ node, messageId: 'unguarded' });
            },
        };
    },
};

/** Project policy covers dynamic style mutations as well as the official static-style rule. */
export const noDirectStyles = {
    meta: { type: 'problem', schema: [], messages: { direct: 'Use CSS classes, setCssStyles() or setCssProps() instead of mutating element.style.' } },
    create(context) {
        const report = node => context.report({ node, messageId: 'direct' });
        return {
            AssignmentExpression(node) { if (node.left.type === 'MemberExpression' && style(node.left.object)) report(node); },
            UpdateExpression(node) { if (node.argument.type === 'MemberExpression' && style(node.argument.object)) report(node); },
            CallExpression(node) {
                const callee = node.callee;
                if (callee.type !== 'MemberExpression') return;
                if (style(callee.object) && ['setProperty', 'removeProperty'].includes(property(callee))) report(node);
                if (property(callee) === 'setAttribute' && node.arguments[0]?.type === 'Literal' && node.arguments[0].value === 'style') report(node);
            },
        };
    },
};
