# 1.2.13 — 大幅改进界面，更清晰地保存与同步配置

- **设置导航更清晰**：设置入口更名为「Better Manager 设置」。分类入口带有图标、设置名称和项目概览；设置视图使用单个带图标的下拉菜单切换分类，避免重复导航。窄屏工具栏的下拉菜单与操作按钮保持同行，菜单中保留图标。
- **修复界面样式**：恢复标签按钮、插件卡片、Ribbon 筛选与搜索框的布局、间距和选中状态，改善手机端显示。保留 Obsidian 风格的悬停滚动条、触屏滚动及弹出窗口兼容性。
- **批量隐藏与快捷分类**：插件总览支持批量隐藏、取消隐藏所选插件。通过插件的原生右键菜单，可快捷添加分组和标签。
- **明确保存时机**：管理器和设置页提供「保存更改」按钮；存在未保存修改时，以强调色提示。保存前检查最新共享配置，冲突时保留两份，等待选择。
- **仅本次会话**：临时调整立即生效，不改写已保存的预设，也不产生待保存修改。切回持久模式不会补存之前的临时调整。
- **更容易定位冲突**：桌面顶栏和移动端视图菜单标出存在差异的功能项；通过项目旁或列表横栏的「本机 / 远端」按钮选择配置。外部 `data.json` 变化不会重建当前界面、退出编辑或触发自动回写。
- **恢复目录提醒**：检测到 `.bpm/` 被外部工具修改时，在管理器通知区域提醒将其加入同步排除列表；本机正常写入不触发提醒。
- **原生设置搜索**：Obsidian 1.13 及以上版本可通过原生设置搜索找到设置项名称和描述；旧版保留原有设置界面。

基础配置新增两个带有「实时同步」「兼容措施」标签的设置：

- **仅手动保存配置**：默认开启，持久修改先保留为本机草稿，点击「保存更改」才写入共享配置。关闭后，在最后一个 BPM 编辑窗口关闭时检查并保存。两种方式均保留保存前的冲突检查；「仅本次会话」更改始终不保存。
- **频繁外部修改提醒**：同一配置文件在滚动 3 秒内发生至少 3 次有效外部内容修改时，温和提示检查实时同步设置；所有文件合计每分钟最多提醒一次。忽略本机写入、相同内容、JSON 格式与键序、版本标记及设备在线心跳，并合并 250 毫秒内的替换事件。提醒不会暂停保存或刷新界面，也不代表已确认同步循环。

**保存提示**：默认设置下，需要同步到其他设备的永久修改，请点击顶栏「更多」左侧的「保存更改」。

**同步排除**：请在外部同步工具中排除插件内的 `.bpm/` 目录。恢复快照可能包含敏感配置；相关 Obsidian 配置仅备份供手动恢复。

---

# 1.2.13 — Major interface improvements and clearer configuration saving

- **Clearer settings navigation:** The entry is now named **Better Manager settings**. Categories show an icon, a setting name and an overview of their settings. The settings view uses a single icon dropdown to switch categories. Compact toolbar dropdowns stay beside their action buttons and retain icons.
- **Interface fixes:** Restores the layout, spacing and selected states of tabs, plugin cards, Ribbon filters and search fields, with improved phone layouts. Retains Obsidian-themed hover scrollbars, touch scrolling and popout-window compatibility.
- **Bulk visibility and quick organization:** Hide or unhide selected plugins from the overview. Add groups and tags directly through a plugin's native context menu.
- **Clear saving behavior:** The manager and settings pages include **Save changes**, highlighted when changes are unsaved. Saving checks the latest shared settings and preserves both versions when a conflict needs a choice.
- **This session only:** Temporary changes apply immediately without changing saved presets or marking settings as unsaved. Returning to permanent mode does not save earlier session changes.
- **Clearer conflict navigation:** Desktop tabs and the mobile view menu identify features with configuration differences. **Local / Remote** controls beside items and in the list toolbar select the desired settings. External `data.json` changes do not rebuild the interface, interrupt editing or trigger automatic writes.
- **Recovery folder reminders:** External changes to `.bpm/` trigger a reminder in the manager's notification area to exclude this folder from sync. Normal local writes do not trigger the reminder.
- **Native settings search:** On Obsidian 1.13 and later, native settings search includes setting names and descriptions. Older versions retain the existing settings interface.

Basic settings includes two options tagged **Realtime sync** and **Compatibility**:

- **Save settings manually:** Enabled by default. Persistent changes remain in a local draft until you select **Save changes**. Turn this off to check and save when the last BPM editor closes. Both modes check for conflicts before saving. Session-only changes are never saved.
- **Warn about frequent external changes:** Gently suggests reviewing sync settings after at least 3 effective external content changes to the same settings file within a rolling 3 seconds, at most once per minute across files. Ignores local writes, identical content, JSON formatting and key order, revision markers and device heartbeats; combines replacement events within 250 milliseconds. Warnings do not pause saving or refresh the interface, and do not confirm a sync loop.

**Saving:** With the default settings, use **Save changes**, immediately to the left of **More** in the top bar, to save permanent changes for other devices.

**Sync exclusions:** Exclude the plugin's `.bpm/` folder in external sync tools. Recovery snapshots can contain sensitive settings. Related Obsidian configuration files are backed up for manual recovery only.
