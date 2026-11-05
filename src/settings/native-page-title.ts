/**
 * 仅同步当前插件设置页的标题，不导航、不重建返回按钮。
 * Keep the native page and modal title in sync without replacing their controls.
 */
export function syncNativeSettingsPageTitle(root: HTMLElement | undefined, title: string, app: object): void {
    const pageRoot = root?.closest<HTMLElement>('.setting-page');
    if (!pageRoot) return;
    syncNativePageState(pageRoot, title, app);
    const titlebar = Array.from(pageRoot.children).find(child => child.hasClass('setting-page-titlebar'));
    titlebar?.querySelector<HTMLElement>('.setting-page-title')?.setText(title);
}

function syncNativePageState(pageRoot: HTMLElement, title: string, app: object): void {
    // Declarative items expose no public SettingPage handle. Guard the observed
    // native stack and verify ownership before updating the public title field.
    const settings: unknown = Reflect.get(app, 'setting');
    if (!settings || typeof settings !== 'object' || !('pageStack' in settings) || !Array.isArray(settings.pageStack)) return;
    const entry: unknown = settings.pageStack[settings.pageStack.length - 1];
    if (!entry || typeof entry !== 'object' || !('page' in entry)) return;
    const page = entry.page;
    if (!page || typeof page !== 'object' || !('rootEl' in page) || page.rootEl !== pageRoot || !('title' in page) || typeof page.title !== 'string') return;
    page.title = title;
    const updater: unknown = Reflect.get(settings, 'updatePageTitle');
    if (isTitleUpdater(updater)) updater.call(settings);
}

function isTitleUpdater(value: unknown): value is () => void { return typeof value === 'function'; }
