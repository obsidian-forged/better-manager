# 1.2.13 — 更清晰的保存方式，更稳定的界面

- **手动保存配置**：管理器和设置页新增「保存」按钮。存在未保存修改时，按钮以强调色提示；点击后检查最新共享配置并保存。关闭窗口只保留本机草稿，不再自动提交。
- **仅本次会话**：临时调整插件启用状态或外观时立即生效，不改写已保存的预设，也不产生待保存修改。切回持久模式不会补存之前的临时调整。
- **减少同步干扰**：外部 `data.json` 变化不会重建当前界面、退出编辑或触发自动回写。保存时如有冲突，保留两份配置，等待明确选择。
- **更容易定位冲突**：桌面顶栏和移动端视图菜单标出存在差异的功能项；可通过项目旁或列表横栏的「本机 / 远端」按钮选择配置。
- **恢复目录提醒**：检测到 `.bpm/` 被外部工具修改时，在管理器通知区域提醒将其加入同步排除列表；本机正常写入不触发提醒。
- **界面与兼容性**：整理工具栏、标签、卡片与移动端共用样式，移除 `!important` 覆盖，保留 Obsidian 风格的悬停滚动条。改进弹出窗口、异步操作与插件卸载时的资源清理。
- **原生设置搜索**：Obsidian 1.13 及以上版本可通过原生设置搜索找到 BPM 的设置项名称和描述，旧版保留原有设置界面。

**保存提示**：需要同步到其他设备的永久修改，请点击顶栏「更多」左侧的「保存」。仅本次会话的调整无需保存。

**同步排除**：请在外部同步工具中排除插件内的 `.bpm/` 目录。恢复快照可能包含敏感配置；相关 Obsidian 配置仅备份供手动恢复。

验证：318 项自动测试、类型检查、官方类型感知 ESLint（零错误、零警告）与生产构建通过。本次未进行手机真机及最低 Obsidian 版本的界面验收。

---

# 1.2.13 — Clearer saving, a more stable interface

- **Explicit saving:** The manager and settings pages now include a **Save** button. An accent highlights unsaved changes. Saving checks the latest shared configuration before writing; closing an editor keeps its local draft without publishing it.
- **This session only:** Temporary plugin and appearance changes apply immediately without changing saved presets or marking settings as unsaved. Returning to permanent mode does not save earlier session changes.
- **Less sync disruption:** External `data.json` changes no longer rebuild the current interface, interrupt editing or trigger automatic writes. Saving retains both configurations when a conflict needs a choice.
- **Clearer conflict navigation:** Desktop tabs and the mobile view menu identify features with configuration differences. **Local / Remote** controls beside items and in the list toolbar select the desired configuration.
- **Recovery folder reminders:** External changes to `.bpm/` trigger a reminder in the manager's notification area to exclude this folder from sync. Normal local writes do not trigger the reminder.
- **Interface and compatibility:** Consolidated toolbar, tag, card and mobile styles remove `!important` overrides while retaining Obsidian-themed hover scrollbars. Improves popout-window behavior, async operations and resource cleanup when unloading.
- **Native settings search:** On Obsidian 1.13 and later, native settings search includes BPM setting names and descriptions. Older versions retain the existing settings interface.

**Saving:** To share permanent changes with other devices, use **Save**, immediately to the left of **More** in the top bar. Session-only adjustments do not need saving.

**Sync exclusions:** Exclude the plugin's `.bpm/` folder in external sync tools. Recovery snapshots can contain sensitive settings. Related Obsidian configuration files are backed up for manual recovery only.

Validation: All 318 automated tests, type checks, official type-aware ESLint checks (zero errors or warnings), and the production build passed. Physical-phone and minimum-version interface acceptance tests were not performed for this release.
