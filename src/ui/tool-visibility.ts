export type ToolScope = 'plugin' | 'theme' | 'install' | 'global' | 'ribbon' | 'layout' | 'transfer' | 'resource';

/** 统一决定栏目操作的归属；One visibility policy shared by desktop and mobile bars. */
export function isToolInPage(scope: string, page: string, editing: boolean): boolean {
    switch (scope) {
        case 'global': case 'resource': return true;
        case 'plugin': return page === 'plugins';
        case 'theme': return page === 'themes';
        case 'install': return page === 'install' || page === 'sources';
        case 'ribbon': return page === 'ribbon';
        case 'layout': return page === 'plugins' && editing;
        case 'transfer': return page === 'transfer';
        default: return false;
    }
}
