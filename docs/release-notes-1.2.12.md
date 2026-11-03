# 1.2.12 — 更稳定的配置同步与冲突处理

- **配置保护**：启动时在插件内 `.bpm/` 保存相关配置快照。编辑先留在本机草稿，关闭最后一个 BPM 编辑窗口后再保存；未改变的共享配置不重写。
- **冲突处理**：保留本机与远端版本并暂停自动回写。设备筛选器显示警告，顶栏“解决冲突”提供选择入口。
- **配置预览**：冲突项目旁的“本机 / 远端”胶囊可切换预览；启用、禁用筛选横栏右侧的胶囊可统一选择整个插件列表，单项选择不一致时显示“混合”。预览不会切换插件的实际启用状态，确认并关闭后才保存和应用。
- **防止同步循环**：校验配置内容及修订关系，相同内容忽略；已知旧修订按版本对最多恢复一次，重复回灌时暂停自动恢复。
- **更新管理**：支持排除插件、跳过指定来源的版本和暂时静音提醒；一键更新先预览，再逐项执行，并汇总成功、失败与跳过结果。
- **错误信息**：网络失败显示 HTTP 状态码及服务端提供的原因或重试时间。
- **界面与源码整理**：清理重复、覆盖冲突的样式，保留现有工具栏自适应、设备预设与滚动交互修复。

`.bpm/` 快照可能包含敏感配置。请在外部同步工具中排除此目录；隐藏目录不会被所有同步服务自动排除。相关 Obsidian 全局配置只备份供人工恢复，不自动回滚。

验证：255 项自动测试、类型检查、现有 lint 检查及构建通过；在独立 Obsidian 测试库验证了预览不写共享配置、确认后等待关闭保存，以及无修改时不改变配置内容和修改时间。本次新增交互尚未进行手机真机验证。

---

# 1.2.12 — More reliable configuration sync and conflict handling

- **Configuration protection:** Startup snapshots are stored in the plugin’s `.bpm/` directory. Edits remain local drafts until the last BPM editor closes; unchanged shared settings are not rewritten.
- **Conflict handling:** Local and remote copies are retained while automatic writes pause. The device selector shows a warning, with a **Resolve conflict** entry in the toolbar.
- **Configuration previews:** Source pills beside conflicting items switch between local and remote previews. The pill to the right of the enabled/disabled filter bar selects the source for the whole plugin list; individual exceptions show **Mixed**. Previews do not change running plugin states. Confirmed choices are saved and applied after editors close.
- **Sync loop protection:** Content and revision relationships are checked. Identical content is ignored; a known older revision is restored at most once per revision pair, with repeated replays pausing automatic restoration.
- **Update controls:** Exclude plugins, skip source-specific releases or mute reminders. Batch updates provide a preview, execute sequentially and summarize successes, failures and skips.
- **Error details:** Network failures show HTTP status codes and any server-provided explanation or retry time.
- **Interface and source cleanup:** Removes redundant and conflicting style declarations while retaining adaptive toolbars, device presets and scrolling fixes.

Snapshots may contain sensitive settings. Exclude `.bpm/` in external sync tools; hidden folders are not excluded by every provider. Related Obsidian configuration files are backed up for manual recovery only.

Validation: 255 automated tests, type checking, the configured lint checks and the production build passed. An isolated Obsidian vault verified previews without shared writes, saving only after confirmation and closing, and unchanged bytes and modification times for sessions without edits. The new interactions have not yet been tested on a physical phone.
