const english = {
    title: 'On-demand loading',
    scope: 'These loading choices apply to all device presets. Each preset still controls which plugins are enabled.',
    introduction: 'When you first choose on-demand loading, the plugin runs once to remember its commands, then goes to sleep. After you use it, it stays loaded for the rest of this session.',
    search: 'Find a plugin',
    normal: 'Follow normal / delayed settings',
    demand: 'Load on demand',
    mode: 'Loading choice for {name}',
    normalState: 'Normal',
    unauthorized: 'Not enabled',
    sleeping: 'Sleeping',
    running: 'Running',
    status: '{state} · {count} remembered commands',
    load: 'Load now',
    loadLabel: 'Load {name} now',
    panelTitle: 'On-demand plugins',
    panelEmpty: 'No sleeping on-demand plugins.',
    openCommand: 'Open on-demand plugins',
    loadFailed: 'Could not load {name}',
    ribbon: 'Ribbon loading buttons',
    ribbonDescription: 'Show a button for loading each sleeping plugin in the ribbon.',
    views: 'Sidebar loading entry',
    viewsDescription: 'Show a sidebar entry for loading sleeping plugins.',
    menus: 'Right-click loading entry',
    menusDescription: 'Offer “Load plugin” in right-click menus. After loading, reopen the menu to see the plugin’s own actions.',
    empty: 'No matching plugins.',
};
type TextKey = keyof typeof english;
const chinese: Record<TextKey, string> = {
    title: '按需加载',
    scope: '加载策略适用于所有设备预设；各预设仍独立决定启用哪些插件。',
    introduction: '首次选择按需加载时，插件会运行一次以记住命令，随后休眠。使用后，插件会在本次会话中保持加载。',
    search: '搜索插件',
    normal: '遵循正常／延迟设置',
    demand: '按需加载',
    mode: '{name} 的加载策略',
    normalState: '正常',
    unauthorized: '未启用',
    sleeping: '休眠',
    running: '运行中',
    status: '{state} · 已记住 {count} 个命令',
    load: '立即加载',
    loadLabel: '立即加载 {name}',
    panelTitle: '按需加载插件',
    panelEmpty: '没有休眠中的按需加载插件。',
    openCommand: '打开按需加载插件',
    loadFailed: '无法加载 {name}',
    ribbon: '功能区加载按钮',
    ribbonDescription: '在功能区显示休眠插件的加载按钮。',
    views: '侧栏加载入口',
    viewsDescription: '在侧栏提供加载休眠插件的入口。',
    menus: '右键加载入口',
    menusDescription: '在右键菜单中提供“加载插件”。加载后需重新打开菜单，才能看到插件自己的操作。',
    empty: '没有匹配的插件。',
};

/** 独立双语文案，未知语言回退英文；Standalone copy with an English fallback. */
export function ondemandText(language: string, key: TextKey, vars: Record<string, string | number> = {}): string {
    const dictionary = /^zh(?:[-_]|$)/i.test(language) ? chinese : english;
    return dictionary[key].replace(/\{(\w+)\}/g, (match, variable: string) =>
        Object.prototype.hasOwnProperty.call(vars, variable) ? String(vars[variable]) : match);
}
