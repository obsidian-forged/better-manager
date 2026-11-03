import type Manager from '../main';

const messages = {
    conflict: ['冲突', 'Conflict'],
    collapse: ['收起冲突对照', 'Collapse conflict comparison'],
    resolve: ['解决冲突', 'Resolve conflict'], title: ['配置冲突', 'Configuration conflict'],
    paused: ['已保留两个版本并暂停自动回写。请逐项选择；关闭所有 BPM 窗口后才会保存。', 'Both versions are preserved. Automatic writes are paused. Choose each version; changes are saved after all BPM windows close.'],
    local: ['本机版本', 'Local version'], incoming: ['远端版本', 'Remote version'],
    shortLocal: ['本机', 'Local'], shortRemote: ['远端', 'Remote'], mixed: ['混合', 'Mixed'],
    switchLocal: ['切换为本机版本', 'Switch to the local version'], switchRemote: ['切换为远端版本', 'Switch to the remote version'],
    listSource: ['整个列表的配置来源', 'Configuration source for the whole list'],
    switchListLocal: ['整个列表切换为本机配置', 'Preview local settings for the whole list'],
    switchListRemote: ['整个列表切换为远端配置', 'Preview remote settings for the whole list'],
    use: ['保留此版本', 'Keep this version'], selected: ['已选择', 'Selected'],
    apply: ['确认选择', 'Confirm choices'], pending: ['已暂存选择，关闭所有 BPM 窗口后保存。', 'Choices are staged. Close all BPM windows to save.'],
    chooseAll: ['请为每一项选择要保留的版本。', 'Choose a version for every section.'],
    others: ['其它管理设置', 'Other manager settings'], icons: ['插件图标与配色', 'Plugin icons and colors'],
    device: ['设备记录', 'Device record'], file: ['相关配置', 'Related configuration'],
    absent: ['不存在或已删除', 'Absent or deleted'], on: ['开启', 'On'], off: ['关闭', 'Off'],
    empty: ['未设置', 'Empty'], set: ['已设置（内容隐藏）', 'Set (hidden)'], unset: ['未设置', 'Not set'],
    more: ['显示其余差异', 'Show remaining differences'], error: ['配置保护操作失败', 'Configuration protection failed'],
    syncTitle: ['同步与配置保护', 'Sync and configuration protection'],
    syncDesc: ['检测到以下同步服务。多个设备同时同步插件配置可能造成覆盖或反复写入。', 'These sync services are enabled. Syncing plugin settings on multiple devices can cause overwrites or repeated writes.'],
    syncAdvice: ['建议暂时关闭插件配置的实时同步，或排除 BPM 配置。BPM 会保留本机启动快照、暂存编辑，并在冲突时暂停自动回写。', 'Consider pausing live sync of plugin settings or excluding BPM settings. BPM keeps local startup snapshots, stages edits and pauses automatic writes on conflict.'],
    exclude: ['请在同步工具中排除下方恢复目录；插件内的隐藏目录不保证会被排除。BPM 不会修改同步工具的设置。', 'Exclude this recovery folder in your sync tool. Hidden folders inside plugins are not always excluded. BPM does not change sync tool settings.'],
    understood: ['知道了', 'Understood'], computer: ['电脑', 'Computer'], tablet: ['平板', 'Tablet'], phone: ['手机', 'Phone'],
    damaged: ['传入配置的版本标记与内容不匹配，已保留为独立版本。', 'The incoming version marker does not match its contents. It is preserved as a separate version.'],
    stale: ['旧配置被反复同步回来，已停止自动恢复，避免继续触发同步。', 'Old settings keep returning. Automatic restoration has stopped to avoid a sync loop.'],
} as const;
export type ProtectionMessage = keyof typeof messages;
export function protectionText(manager: Pick<Manager, 'settings'>, key: ProtectionMessage): string {
    return messages[key][/^zh/i.test(manager.settings?.LANGUAGE ?? '') ? 0 : 1];
}
const labels: Record<string, [string, string]> = {
    name: ['名称', 'Name'], configured: ['已配置', 'Configured'], plugins: ['插件', 'Plugins'], enabled: ['启用', 'Enabled'],
    delay: ['延迟', 'Delay'], filters: ['筛选', 'Filters'], search: ['搜索', 'Search'], status: ['状态', 'Status'],
    group: ['分组', 'Group'], tag: ['标签', 'Tag'], statusOperator: ['状态匹配', 'Status matching'],
    groupOperator: ['分组匹配', 'Group matching'], tagOperator: ['标签匹配', 'Tag matching'], delayOperator: ['延迟匹配', 'Delay matching'],
    ribbon: ['侧边栏', 'Ribbon'], ribbonGroups: ['侧边栏分组', 'Ribbon groups'], ribbonEnabled: ['侧边栏管理', 'Ribbon management'],
    appearance: ['外观', 'Appearance'], theme: ['主题', 'Theme'], snippets: ['样式片段', 'CSS snippets'],
    visible: ['显示', 'Visible'], order: ['顺序', 'Order'], members: ['成员', 'Members'],
    DEVICE_MANAGEMENT: ['设备管理', 'Device management'], defaultPresets: ['默认预设', 'Default presets'],
    Plugins: ['插件配置', 'Plugin settings'], RIBBON_SETTINGS: ['侧边栏配置', 'Ribbon settings'],
    RIBBON_GROUPS: ['侧边栏分组', 'Ribbon groups'], LANGUAGE: ['语言', 'Language'],
    lastSeen: ['最近在线', 'Last seen'], updatedAt: ['最近修改', 'Last changed'], platform: ['系统', 'Platform'], type: ['设备类型', 'Device type'],
};
export function protectionField(manager: Manager, path: string[]): string {
    const language = /^zh/i.test(manager.settings.LANGUAGE) ? 0 : 1;
    return path.map(key => labels[key]?.[language] ?? manager.appPlugins.manifests[key]?.name ?? key).join(' › ');
}
