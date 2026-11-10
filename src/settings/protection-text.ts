import type Manager from '../main';

const messages = {
    conflict: ['冲突', 'Conflict'],
    unsavedItem: ['未保存', 'Unsaved'],
    presetDescription: ['此设备预设中的插件、筛选、边栏与外观配置。', 'Plugins, filters, Ribbon and appearance in this device preset.'],
    deviceDescription: ['各设备的名称、类型与最近在线记录。', 'Device names, types and last-seen records.'],
    iconsDescription: ['插件图标与自定义配色规则。', 'Plugin icons and custom color rules.'],
    fileDescription: ['相关配置文件的差异。', 'Differences in related configuration files.'],
    unsavedItemTooltip: ['此项目有未保存的更改；使用保存按钮后才会写入共享配置。', 'This item has unsaved changes. Use Save to write them to the shared configuration.'],
    differences: ['有差异', 'Differences'],
    showDifferences: ['显示差异', 'Show differences'],
    hideDifferences: ['隐藏差异', 'Hide differences'],
    differencePath: ['设置项', 'Setting'],
    featureDifferences: ['此功能的配置不同', 'This feature has different settings'],
    saveSettings: ['保存更改', 'Save changes'],
    saving: ['正在保存', 'Saving changes'],
    closeUnsaved: ['有尚未保存的配置，是否保存后关闭？选择“不保存”会丢弃本机草稿，不写入共享配置。', 'Save settings before closing? Choosing Don’t save discards the local draft without publishing it.'],
    saveAndClose: ['保存并关闭', 'Save and close'],
    closeWithoutSaving: ['不保存并丢弃', 'Don’t save and discard'],
    realtimeSyncTag: ['实时同步', 'Realtime sync'],
    compatibilityTag: ['兼容措施', 'Compatibility'],
    manualSaveName: ['仅手动保存配置', 'Save settings manually'],
    manualSaveDescription: ['开启后，持久更改先保留在本机草稿，点击“保存更改”或关闭时选择“保存并关闭”才写入共享配置。关闭此选项后，在最后一个 BPM 编辑窗口关闭时检查并保存。保存时有冲突会保留两份并提示选择；“仅本次会话”更改始终不保存。', 'When enabled, persistent changes remain in a local draft until you select Save changes or Save and close in the closing prompt. When disabled, BPM checks and saves them when the last BPM editor closes. Conflicts preserve both versions for review. Current-session changes are never saved.'],
    syncProtectionName: ['启用配置同步保护', 'Enable configuration sync protection'],
    syncProtectionDescription: ['仅在使用 Obsidian Sync、iCloud、Syncthing 等工具于多台设备间实时同步本库时需要开启。同一同步库中的所有设备都应统一开启；混用保护与单机模式会因设备记录表示不同而产生误冲突。开启后 BPM 会保存未保存草稿与冲突副本，并在保存中断后恢复，同时创建 .bpm 恢复目录；请把该目录排除在同步范围外。本机没有未保存编辑时，会自动采用其他设备同步来的最新版本；只有本机也有编辑时才显示冲突。关闭时只读写 data.json：识别到同步服务时，后台自动写入会保留为待保存状态；显式保存前会把本机改动合并到当时磁盘上的配置，但不会保留冲突副本或中断恢复。修改后需重启 Obsidian 生效。', 'Turn this on only when Obsidian Sync, iCloud, Syncthing or a similar tool syncs this vault in real time across devices. Enable it on every device using the same synced vault; mixing protected and single-file modes can create false conflicts because device records are represented differently. BPM then keeps unsaved drafts, conflict copies and interrupted-save recovery, and creates a .bpm recovery folder; exclude that folder from sync. When this device has no unsaved edits, a newer revision from another device is adopted automatically; a conflict appears only when both sides have edits. When off, only data.json is read and written: background automatic writes stay pending while a recognized sync service is enabled, and explicit Save merges local edits with the file currently on disk, but conflict copies and interrupted-save recovery are unavailable. Restart Obsidian after changing this option.'],
    syncProtectionDefaultOff: ['默认关闭', 'Off by default'],
    syncProtectionEnableWarning: ['开启后将在插件目录创建 .bpm 恢复目录，用于保存草稿、冲突副本和中断恢复。同一同步库中的所有设备都应统一开启，并先将该目录加入同步工具的排除列表，然后重启 Obsidian 生效。', 'Enabling creates a .bpm recovery folder for drafts, conflict copies and interrupted-save recovery. Enable protection on every device using the same synced vault, exclude this folder from sync, then restart Obsidian to apply.'],
    syncProtectionDisableWarning: ['关闭后将只读写 data.json：不再保存草稿与冲突副本，也无法在保存中断后恢复；保存前仍会合并其他设备的最新修改。重启 Obsidian 后生效；勾选删除缓存时，缓存会在下次以单机模式启动后删除。', 'Turning this off keeps only data.json: drafts, conflict copies and interrupted-save recovery stop, but the latest changes from other devices are still merged before saving. Restart Obsidian to apply; when cache deletion is selected, the cache is removed after the next start in single-machine mode.'],
    syncProtectionDeleteCache: ['同时删除现有 .bpm 恢复缓存（重启后执行）', 'Also delete the existing .bpm recovery cache (after restart)'],
    syncProtectionRestart: ['配置同步保护已更改，重启 Obsidian 后生效。若当前为手动保存模式，请先保存配置。', 'Configuration sync protection changed. Restart Obsidian to apply. If manual saving is on, save the settings first.'],
    syncProtectionRestartPending: ['重启 Obsidian 后生效；在此之前仍按当前模式读写配置。', 'Restart Obsidian to apply; the current mode stays active until then.'],
    syncProtectionSaveFirst: ['切换同步保护前，请先保存或放弃当前未保存的配置。', 'Save or discard the current unsaved settings before switching sync protection.'],
    syncProtectionAmbientWarning: ['检测到同步服务，但此设备的配置同步保护已关闭。如多台设备共用本库，请在所有设备统一开启，并把 .bpm 目录排除在同步范围外。', 'A sync service is enabled but configuration sync protection is off on this device. If several devices share this vault, enable it on every device and exclude the .bpm folder from sync.'],
    syncProtectionExternalChanged: ['data.json 已被外部修改。保存时会合并这些修改，不会直接覆盖。', 'data.json changed externally. Saving merges those changes instead of overwriting them.'],
    syncProtectionMerged: ['检测到其他设备的配置修改，已合并后保存。', 'Changes from another device were merged before saving.'],
    syncProtectionOverwrite: ['覆盖并保存', 'Overwrite and save'],
    changeWarningsName: ['频繁外部修改提醒', 'Warn about frequent external changes'],
    changeWarningsDescription: ['同一配置文件在滚动 3 秒内有至少 3 次有效外部内容修改时温和提醒；所有文件合计每分钟最多提醒一次。忽略本机写入、相同内容、JSON 格式与键序、版本标记及设备在线心跳，合并 250 毫秒内的替换事件。提醒不会暂停保存或刷新界面，也不代表已确认同步循环。', 'Show a gentle warning after at least 3 effective external content changes to the same settings file within a rolling 3 seconds, at most once per minute across files. Ignore local writes, identical content, JSON formatting/key order, revision markers and device heartbeats; combine replacement events within 250 ms. Warnings do not pause saving or refresh the interface, and do not confirm a sync loop.'],
    frequentExternalChanges: ['短时间内多次收到外部修改。若持续发生，请检查实时同步设置。此提醒不代表已确认同步循环，也不会暂停保存。', 'Several external changes arrived in a short time. If this continues, review your live sync settings. This does not confirm a sync loop or pause saving.'],
    sharedChangesError: ['无法检查 BPM 配置的外部变动；当前界面和保存方式不受影响。', 'External BPM settings changes could not be checked. The current interface and saving mode are unaffected.'],
    checkSaveSettings: ['检查并保存配置', 'Check and save settings'],
    collapse: ['收起冲突对照', 'Collapse conflict comparison'],
    resolve: ['解决冲突', 'Resolve conflict'], title: ['配置冲突', 'Configuration conflict'],
    paused: ['已保留两个版本。请逐项选择，再点击保存配置。', 'Both versions are preserved. Choose each version, then save the settings.'],
    local: ['本机版本', 'Local version'], incoming: ['远端版本', 'Remote version'],
    allSettings: ['全部配置', 'All settings'],
    applyAllLocal: ['使用本机版本解决全部冲突并保存', 'Resolve all conflicts with local settings and save'],
    applyAllRemote: ['使用远端版本解决全部冲突并保存', 'Resolve all conflicts with remote settings and save'],
    notApplied: ['尚未保存，请检查冲突或错误后重试。', 'Settings were not saved. Review the conflict or error and try again.'],
    shortLocal: ['本机', 'Local'], shortRemote: ['远端', 'Remote'], mixed: ['混合', 'Mixed'],
    switchLocal: ['切换为本机版本', 'Switch to the local version'], switchRemote: ['切换为远端版本', 'Switch to the remote version'],
    listSource: ['整个列表的配置来源', 'Configuration source for the whole list'],
    switchListLocal: ['整个列表切换为本机配置', 'Preview local settings for the whole list'],
    switchListRemote: ['整个列表切换为远端配置', 'Preview remote settings for the whole list'],
    use: ['保留此版本', 'Keep this version'], selected: ['已选择', 'Selected'],
    apply: ['确认选择', 'Confirm choices'], pending: ['已暂存选择，请点击保存配置。', 'Choices are staged. Save the settings to apply them.'],
    chooseAll: ['请为每一项选择要保留的版本。', 'Choose a version for every section.'],
    others: ['其它管理设置', 'Other manager settings'], icons: ['插件图标与配色', 'Plugin icons and colors'],
    device: ['设备记录', 'Device record'], file: ['相关配置', 'Related configuration'],
    absent: ['不存在或已删除', 'Absent or deleted'], on: ['开启', 'On'], off: ['关闭', 'Off'],
    empty: ['未设置', 'Empty'], set: ['已设置（内容隐藏）', 'Set (hidden)'], unset: ['未设置', 'Not set'],
    more: ['显示其余差异', 'Show remaining differences'], error: ['配置保护操作失败', 'Configuration protection failed'],
    syncTitle: ['同步与配置保护', 'Sync and configuration protection'],
    syncDesc: ['检测到以下同步服务。多个设备同时同步插件配置可能造成覆盖或反复写入。', 'These sync services are enabled. Syncing plugin settings on multiple devices can cause overwrites or repeated writes.'],
    syncAdvice: ['建议在同步工具中排除 BPM 恢复目录。BPM 会保留本机启动快照和编辑草稿，默认点击“保存更改”才检查并写入共享配置；可在基础配置关闭“仅手动保存配置”，改为关闭最后一个 BPM 编辑窗口时保存。', 'Exclude the BPM recovery folder in your sync tool. BPM keeps local startup snapshots and editing drafts. By default, shared settings are checked and written when you select Save changes. Turn off Save settings manually in basic settings to save when the last BPM editor closes.'],
    exclude: ['请在同步工具中排除下方恢复目录；插件内的隐藏目录不保证会被排除。BPM 不会修改同步工具的设置。', 'Exclude this recovery folder in your sync tool. Hidden folders inside plugins are not always excluded. BPM does not change sync tool settings.'],
    privateCacheShort: ['排除恢复目录', 'Exclude recovery folder'],
    privateCacheTitle: ['恢复目录被外部修改', 'Recovery folder changed externally'],
    privateCacheChanged: ['检测到 .bpm 恢复目录被外部修改。请将此目录加入同步工具的排除列表，避免恢复副本也被同步覆盖。', 'The .bpm recovery folder changed externally. Add it to your sync exclusions so recovery copies are not overwritten by sync.'],
    privateCacheError: ['无法检查恢复目录的变动，请检查同步排除设置。', 'Recovery folder changes could not be checked. Review your sync exclusions.'],
    understood: ['知道了', 'Understood'], computer: ['电脑', 'Computer'], tablet: ['平板', 'Tablet'], phone: ['手机', 'Phone'],
    damaged: ['传入配置的版本标记与内容不匹配，已保留为独立版本。', 'The incoming version marker does not match its contents. It is preserved as a separate version.'],
    stale: ['旧配置被反复同步回来，已停止自动恢复，避免继续触发同步。', 'Old settings keep returning. Automatic restoration has stopped to avoid a sync loop.'],
} as const;
export type ProtectionMessage = keyof typeof messages;
export function protectionText(manager: Pick<Manager, 'settings'>, key: ProtectionMessage): string {
    return messages[key][/^zh/i.test(manager.settings?.LANGUAGE ?? '') ? 0 : 1];
}
/** 冲突差异里显示设置名称，而不是配置文件的原始键。
 * Show setting names in conflict differences instead of raw configuration keys. */
const settingLabels: Record<string, [string, string]> = {
    FEATURES: ['功能开关', 'Feature switches'],
    TOOLS: ['工具开关', 'Tool switches'],
    PLUGIN_UPDATE_RULES: ['插件更新规则', 'Plugin update rules'],
    PLUGIN_INSTALLATIONS: ['插件安装记录', 'Plugin installation records'],
    PLUGIN_SOURCE_UNBOUND: ['已解除绑定的来源', 'Unbound sources'],
    PLUGIN_ROLLBACK_ENABLED: ['保留回退版本', 'Keep rollback versions'],
    PLUGIN_ROLLBACK_LIMIT: ['回退版本数量', 'Rollback versions kept'],
    DEVICE_MANAGEMENT: ['设备管理', 'Device management'],
    LANGUAGE: ['界面语言', 'Interface language'],
    LANGUAGE_INITIALIZED: ['语言初始化', 'Language initialization'],
    MIGRATION_VERSION: ['数据迁移版本', 'Migration version'],
    RELEASE_HIGHLIGHTS_PENDING: ['版本介绍', 'Upgrade tour'],
    DEBUG: ['调试日志', 'Debug logging'],
    PERSISTENCE: ['持久化筛选', 'Persist filters'],
    MANUAL_CONFIG_SAVE: ['仅手动保存配置', 'Save settings manually'],
    SYNC_CHANGE_WARNINGS: ['频繁外部修改提醒', 'Warn about frequent external changes'],
    RECENT_INSTALL_DAYS: ['最近安装天数', 'Recently installed window'],
    CENTER: ['管理器居中', 'Center the manager'],
    DELAY: ['延迟启动', 'Delayed startup'],
    DELAY_WAIT_MESSAGE: ['延迟启动倒计时', 'Delayed startup countdown'],
    DELAY_WAIT_MESSAGE_TEXT: ['倒计时提示文字', 'Countdown message'],
    DELAY_WAIT_MESSAGE_EXTRA_SECONDS: ['倒计时额外等待', 'Extra countdown seconds'],
    HIDE_BPM_TAG: ['隐藏 BPM 标签', 'Hide BPM tags'],
    RIBBON_MANAGER_ENABLED: ['边栏编排', 'Ribbon management'],
    MAIN_PAGE_ACTION_PLACEMENT: ['卡片功能位置', 'Card action placement'],
    AUTO_TAKEOVER: ['自检自动接管', 'Automatic takeover after self-check'],
    SELF_CHECK_IGNORED: ['自检提示已忽略', 'Self-check notice dismissed'],
    COMMAND_ITEM: ['插件启停命令', 'Plugin toggle commands'],
    COMMAND_TOGGLE_PLUGINS: ['单独加入命令的插件', 'Plugins with toggle commands'],
    PLUGIN_CARD_VIEW: ['插件卡片描述', 'Plugin card description'],
    COMMAND_GROUP: ['分组批量命令', 'Group batch commands'],
    COMMAND_TAG: ['标签批量命令', 'Tag batch commands'],
    COMMAND_PROFILE: ['方案应用命令', 'Profile apply commands'],
    COMMAND_PROFILES: ['命令方案', 'Command profiles'],
    APPEARANCE_PROFILES: ['外观方案', 'Appearance profiles'],
    COMMAND_LAST_STATE: ['批量操作快照', 'Batch undo snapshot'],
    STARTUP_CHECK_UPDATES: ['启动检查插件更新', 'Check plugin updates at startup'],
    SOURCE_STARTUP_CHECK_UPDATES: ['启动检查来源更新', 'Check sources at startup'],
    SOURCE_AUTO_UPDATE: ['来源自动更新', 'Automatic source updates'],
    PLUGIN_UPDATE_CHECK_MODE: ['更新检测方式', 'Update check mode'],
    PLUGIN_UPDATE_COMPATIBILITY_MODE: ['兼容性过滤', 'Compatibility filter'],
    PLUGIN_UPDATE_DELAY_DAYS: ['更新延迟天数', 'Update delay'],
    PLUGIN_UPDATE_OFFICIAL_SOURCE: ['官方更新源', 'Official update source'],
    PLUGIN_UPDATE_UNOFFICIAL_SOURCE: ['非官方更新源', 'Unofficial update source'],
    GITHUB_PROXY: ['GitHub 中转地址', 'GitHub proxy'],
    GITHUB_TOKEN: ['GitHub Token', 'GitHub token'],
    FILTER_SEARCH: ['搜索筛选', 'Search filter'],
    FILTER_STATUS: ['状态筛选', 'Status filter'],
    FILTER_STATUS_VALUES: ['状态筛选值', 'Status filter values'],
    FILTER_STATUS_OPERATOR: ['状态匹配方式', 'Status matching'],
    FILTER_GROUP: ['分组筛选', 'Group filter'],
    FILTER_GROUP_VALUES: ['分组筛选值', 'Group filter values'],
    FILTER_GROUP_OPERATOR: ['分组匹配方式', 'Group matching'],
    FILTER_TAG: ['标签筛选', 'Tag filter'],
    FILTER_TAG_VALUES: ['标签筛选值', 'Tag filter values'],
    FILTER_TAG_OPERATOR: ['标签匹配方式', 'Tag matching'],
    FILTER_DELAY: ['延迟筛选', 'Delay filter'],
    FILTER_DELAY_VALUES: ['延迟筛选值', 'Delay filter values'],
    FILTER_DELAY_OPERATOR: ['延迟匹配方式', 'Delay matching'],
    PLUGIN_OVERVIEW_LAYOUT: ['插件总览布局', 'Plugin overview layout'],
    PLUGIN_OVERVIEW_SORT: ['插件总览排序', 'Plugin overview sort'],
    TOOLBAR_LABEL_MODE: ['工具栏标签', 'Toolbar labels'],
    TOOLBAR_HOVER_LABELS: ['悬停显示标签', 'Labels on hover'],
    ITEM_STYLE: ['插件卡片样式', 'Plugin card style'],
    GROUP_STYLE: ['分组样式', 'Group style'],
    TAG_STYLE: ['标签样式', 'Tag style'],
    FADE_OUT_DISABLED_PLUGINS: ['淡化禁用插件', 'Fade disabled plugins'],
    GROUPS: ['分组', 'Groups'],
    TAGS: ['标签', 'Tags'],
    DELAYS: ['延迟启动配置', 'Delayed startup entries'],
    Plugins: ['插件配置', 'Plugin settings'],
    HIDES: ['隐藏的插件', 'Hidden plugins'],
    PLUGIN_LAYOUT: ['自定义布局', 'Custom layout'],
    REPO_MAP: ['仓库映射', 'Repository mapping'],
    BPM_INSTALLED: ['BPM 安装记录', 'Plugins installed by BPM'],
    BETA_SOURCES: ['来源订阅', 'Source subscriptions'],
    INSTALL_HISTORY: ['安装历史', 'Install history'],
    RIBBON_SETTINGS: ['边栏配置', 'Ribbon settings'],
    RIBBON_GROUPS: ['边栏分组', 'Ribbon groups'],
    SHARED_VAULT_MAIN_PATH: ['共享主库路径', 'Shared main vault'],
    SHARED_VAULTS: ['共享库', 'Shared vaults'],
    EXPORT_DIR: ['旧版导出目录', 'Legacy export folder'],
    TROUBLESHOOT_STATE: ['冲突排查进度', 'Troubleshooting progress'],
};
const fieldLabels: Record<string, [string, string]> = {
    name: ['名称', 'Name'], configured: ['已配置', 'Configured'], plugins: ['插件', 'Plugins'], enabled: ['启用', 'Enabled'],
    delay: ['延迟', 'Delay'], filters: ['筛选', 'Filters'], search: ['搜索', 'Search'], status: ['状态', 'Status'],
    group: ['分组', 'Group'], tag: ['标签', 'Tag'], statusOperator: ['状态匹配', 'Status matching'],
    groupOperator: ['分组匹配', 'Group matching'], tagOperator: ['标签匹配', 'Tag matching'], delayOperator: ['延迟匹配', 'Delay matching'],
    ribbon: ['侧边栏', 'Ribbon'], ribbonGroups: ['侧边栏分组', 'Ribbon groups'], ribbonEnabled: ['侧边栏管理', 'Ribbon management'],
    appearance: ['外观', 'Appearance'], theme: ['主题', 'Theme'], snippets: ['样式片段', 'CSS snippets'],
    visible: ['显示', 'Visible'], order: ['顺序', 'Order'], members: ['成员', 'Members'],
    defaultPresets: ['默认预设', 'Default presets'], presets: ['预设', 'Presets'], devices: ['设备', 'Devices'],
    id: ['标识', 'ID'], color: ['颜色', 'Color'], time: ['延迟时间', 'Delay time'], title: ['标题', 'Title'],
    icon: ['图标', 'Icon'], desc: ['描述', 'Description'], description: ['描述', 'Description'], note: ['备注', 'Note'],
    lastSeen: ['最近在线', 'Last seen'], updatedAt: ['最近修改', 'Last changed'], platform: ['系统', 'Platform'],
    type: ['类型', 'Type'], version: ['版本', 'Version'], source: ['来源', 'Source'], repo: ['仓库', 'Repository'],
    url: ['地址', 'URL'], kind: ['类型', 'Kind'], author: ['作者', 'Author'], minAppVersion: ['最低 Obsidian 版本', 'Minimum Obsidian version'],
    excluded: ['不自动更新', 'Excluded from updates'], skipped: ['跳过的版本', 'Skipped versions'],
    muteUntil: ['静音截止', 'Muted until'], computer: ['电脑', 'Computer'], tablet: ['平板', 'Tablet'], phone: ['手机', 'Phone'],
};
function humanizeField(key: string): string {
    const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_+/g, ' ').trim().toLowerCase();
    return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : key;
}
function readField(value: object, key: string): unknown {
    return (value as Record<string, unknown>)[key];
}
function itemName(item: unknown): string | undefined {
    if (item === null || typeof item !== 'object') return;
    for (const field of ['name', 'title', 'repo', 'id']) {
        const value = readField(item, field);
        if (typeof value === 'string' && value) return value;
    }
}
function indexedField(manager: Manager, path: string[], index: number): string | undefined {
    const position = Number(path[index]);
    if (!Number.isSafeInteger(position) || position < 0) return;
    const parent = path.slice(0, index);
    const settings = manager.settings as unknown as Record<string, unknown>;
    const label = (item: unknown): string | undefined => {
        if (typeof item === 'string') return manager.appPlugins.manifests[item]?.name ?? item;
        const name = itemName(item);
        // 布局/隐藏列表里存的是插件 id；Layout/hidden lists store plugin ids.
        return name && manager.appPlugins.manifests[name] ? manager.appPlugins.manifests[name].name : name;
    };
    if (parent.length === 1) {
        const list = settings[parent[0]];
        if (Array.isArray(list)) return label(list[position]);
    }
    if (parent[0] !== 'DEVICE_MANAGEMENT') return;
    const management = settings.DEVICE_MANAGEMENT;
    if (management === null || typeof management !== 'object') return;
    if (parent.length === 2 && parent[1] === 'devices') {
        const list = readField(management, 'devices');
        if (Array.isArray(list)) return label(list[position]);
    }
    if (parent.length === 3 && parent[1] === 'presets') {
        const presets = readField(management, 'presets');
        if (presets === null || typeof presets !== 'object') return;
        const list = readField(presets, parent[2]);
        if (Array.isArray(list)) return label(list[position]);
    }
}
function fieldLabel(manager: Manager, path: string[], index: number, language: number): string {
    const key = path[index];
    if (/^\d+$/.test(key)) return indexedField(manager, path, index)
        ?? (language === 0 ? `第 ${Number(key) + 1} 项` : `Item ${Number(key) + 1}`);
    // 功能/工具开关的子键使用设置页同一套译名；Feature/tool ids reuse the settings-page labels.
    if ((path[index - 1] === 'FEATURES' || path[index - 1] === 'TOOLS') && manager.translator) {
        const translated = manager.translator.t(`功能开关_${key}`);
        if (translated !== `功能开关_${key}`) return translated;
    }
    return settingLabels[key]?.[language] ?? fieldLabels[key]?.[language]
        ?? manager.appPlugins.manifests[key]?.name ?? humanizeField(key);
}
export function protectionField(manager: Manager, path: string[]): string {
    const language = /^zh/i.test(manager.settings.LANGUAGE) ? 0 : 1;
    return path.map((_key, index) => fieldLabel(manager, path, index, language)).join(' › ');
}

/** 每个实际有差异的设置项/自然分组单独成行；类别细化的目的是让用户逐项选择。
 * Each differing setting or natural group gets its own row so users choose item by item. */
const settingDescriptions: Record<string, [string, string]> = {
    RECENT_INSTALL_DAYS: ['插件卡片「最近安装」标签的显示天数。', 'How many days the Recently installed badge stays on plugin cards.'],
    GROUPS_TAGS: ['插件的分组与标签定义。', 'Plugin group and tag definitions.'],
    RIBBON: ['边栏按钮、分组与边栏编排开关。', 'Ribbon buttons, groups and the Ribbon management switch.'],
    DELAYS: ['延迟启动配置与倒计时提示。', 'Delayed startup entries and the countdown prompt.'],
    PLUGIN_LAYOUT: ['插件总览中的排序、分隔线与插件排列。', 'Plugin order, separators and layout in the overview.'],
    Plugins: ['插件记录的名称、说明、启用状态、分组、标签与备注。', 'Plugin records: names, descriptions, enabled state, groups, tags and notes.'],
    DEVICE_MANAGEMENT: ['设备名称、类型与默认预设；具体预设见下方各行。', 'Device names, types and default presets; individual presets are listed below.'],
    LANGUAGE: ['当前界面语言。', 'Current interface language.'],
    FEATURES: ['功能模块开关。', 'Feature module switches.'],
    TOOLS: ['独立工具开关。', 'Optional tool switches.'],
    PERSISTENCE: ['管理页筛选是否持久保存。', 'Whether manager filters persist.'],
    MANUAL_CONFIG_SAVE: ['配置是否只在手动保存时写入。', 'Whether settings are written only on manual save.'],
    SYNC_CHANGE_WARNINGS: ['频繁外部修改提醒。', 'Warnings about frequent external changes.'],
    CENTER: ['管理器弹窗的显示位置。', 'Where the manager window is shown.'],
    HIDE_BPM_TAG: ['插件卡片上的 BPM 内置标签。', 'BPM built-in tags on plugin cards.'],
    MAIN_PAGE_ACTION_PLACEMENT: ['插件卡片功能的位置。', 'Where plugin card actions appear.'],
    AUTO_TAKEOVER: ['启动自检后的自动接管。', 'Automatic takeover after the startup self-check.'],
    PLUGIN_CARD_VIEW: ['插件卡片描述区的显示内容。', 'What plugin card descriptions show.'],
    PLUGIN_ROLLBACK_ENABLED: ['是否保留插件回退版本。', 'Whether plugin rollback versions are kept.'],
    PLUGIN_ROLLBACK_LIMIT: ['保留的回退版本数量。', 'How many rollback versions are kept.'],
    COMMAND_ITEM: ['插件启停命令。', 'Plugin toggle commands.'],
    COMMAND_TOGGLE_PLUGINS: ['单独加入命令的插件。', 'Plugins with their own toggle commands.'],
    COMMAND_GROUP: ['分组批量命令。', 'Group batch commands.'],
    COMMAND_TAG: ['标签批量命令。', 'Tag batch commands.'],
    COMMAND_PROFILE: ['方案一键应用命令。', 'Profile apply commands.'],
    COMMAND_PROFILES: ['命令面板保存的插件状态方案。', 'Plugin state profiles saved for commands.'],
    APPEARANCE_PROFILES: ['外观方案。', 'Appearance profiles.'],
    STARTUP_CHECK_UPDATES: ['启动检查插件更新。', 'Check plugin updates at startup.'],
    SOURCE_STARTUP_CHECK_UPDATES: ['启动检查来源更新。', 'Check source updates at startup.'],
    SOURCE_AUTO_UPDATE: ['来源自动更新。', 'Automatic source updates.'],
    PLUGIN_UPDATE_RULES: ['单个插件的更新排除与跳过规则。', 'Per-plugin update exclusions and skipped versions.'],
    PLUGIN_UPDATE_CHECK_MODE: ['更新检测方式。', 'How updates are checked.'],
    PLUGIN_UPDATE_COMPATIBILITY_MODE: ['更新兼容性过滤。', 'Update compatibility filter.'],
    PLUGIN_UPDATE_DELAY_DAYS: ['更新延迟天数。', 'Update delay in days.'],
    PLUGIN_UPDATE_OFFICIAL_SOURCE: ['官方插件更新源。', 'Official plugin update source.'],
    PLUGIN_UPDATE_UNOFFICIAL_SOURCE: ['非官方插件更新源。', 'Unofficial plugin update source.'],
    GITHUB_PROXY: ['GitHub 请求中转地址。', 'GitHub request proxy.'],
    GITHUB_TOKEN: ['GitHub API Token。', 'GitHub API token.'],
    PLUGIN_OVERVIEW_LAYOUT: ['插件总览布局。', 'Plugin overview layout.'],
    PLUGIN_OVERVIEW_SORT: ['插件总览排序。', 'Plugin overview sort.'],
    TOOLBAR_LABEL_MODE: ['工具栏标签显示方式。', 'Toolbar label display.'],
    TOOLBAR_HOVER_LABELS: ['悬停时是否显示工具栏标签。', 'Show toolbar labels on hover.'],
    ITEM_STYLE: ['插件卡片展开样式。', 'Plugin card expansion style.'],
    GROUP_STYLE: ['分组标签样式。', 'Group chip style.'],
    TAG_STYLE: ['标签样式。', 'Tag chip style.'],
    FADE_OUT_DISABLED_PLUGINS: ['禁用插件是否淡化显示。', 'Fade disabled plugin cards.'],
    HIDES: ['在管理页隐藏的插件。', 'Plugins hidden from the manager.'],
    BETA_SOURCES: ['GitHub 与测试来源订阅。', 'GitHub and beta source subscriptions.'],
    SHARED_VAULT_MAIN_PATH: ['共享库的主库路径。', 'Shared vault main path.'],
    SHARED_VAULTS: ['纳入共享管理的库。', 'Vaults included in sharing.'],
    DEBUG: ['调试日志开关。', 'Debug logging.'],
    OTHER: ['其余尚未归类的配置项。', 'Remaining configuration entries without a dedicated category.'],
};
const groupTitles: Record<string, [string, string]> = {
    GROUPS_TAGS: ['分组与标签', 'Groups & tags'],
    RIBBON: ['边栏设置', 'Ribbon settings'],
    DELAYS: ['延迟启动', 'Delayed startup'],
    OTHER: ['其它管理设置', 'Other manager settings'],
};
const categoryLanguage = (manager: Pick<Manager, 'settings'>): number =>
    /^zh/i.test(manager.settings?.LANGUAGE ?? '') ? 0 : 1;
export function protectionCategoryTitle(manager: Manager, category: string): string {
    const fixed = groupTitles[category];
    if (fixed) return fixed[categoryLanguage(manager)];
    return protectionField(manager, [category]);
}
export function protectionCategoryDescription(manager: Pick<Manager, 'settings'>, category: string): string {
    const language = categoryLanguage(manager);
    return settingDescriptions[category]?.[language]
        ?? (language === 0 ? '此设置项的配置不同。' : 'This setting differs.');
}
/** 把顶层设置键归入自然分组；其余每项单独成行。Keep natural groups together; every other key is its own row. */
export function protectionSettingCategory(key: string): string {
    if (key === 'GROUPS' || key === 'TAGS') return 'GROUPS_TAGS';
    if (key.startsWith('RIBBON_')) return 'RIBBON';
    if (key === 'DELAY' || key === 'DELAYS' || key.startsWith('DELAY_')) return 'DELAYS';
    return key;
}

