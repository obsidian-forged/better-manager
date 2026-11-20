# 按需加载与插件清单元数据同步

- 新增「按需加载」：在 Better Manager 设置中把单个插件标记为按需加载，其余插件继续遵循正常／延迟启动。首次选择会运行一次插件、记住命令，然后让它休眠；执行已记住的命令时再加载真实插件并转到原生命令。
- 休眠插件不再出现在 Obsidian 的启动列表；重启后只保留命令占位。缓存版本与已安装清单不一致时会自动重新采集一次。
- 按需插件使用后保持加载到本次会话结束；「遵循正常／延迟设置」会立即恢复插件并交回 Obsidian 管理。
- 选择按需加载的插件默认提供功能区加载按钮、右侧栏休眠插件面板，以及文件／编辑器右键菜单的加载项；三项均可单独关闭。它们只是加载入口，不会伪造插件自己的 Ribbon 或右键命令。
- 按需选择保存在 `data.json` 的 `ON_DEMAND` 中，随配置同步并进入冲突处理；设备预设仍决定插件是否启用。选择按需模式或界面入口后立即作为一次用户编辑保存，即使开启了「仅手动保存配置」也不需要在主界面再点保存。
- 修复插件清单改名后「能搜到新名字、卡片仍显示旧名字」：刷新清单时会把名称和描述写回插件记录。旧记录升级后采用一次当前清单值；之后在界面里改过的名称或描述会被保留，点击「还原初始状态」可重新跟随清单。来源标记不进入配置冲突。

已通过 742 项自动测试、类型检查、Lint 和生产构建；桌面验收覆盖首次采集、命令触发、休眠/唤醒、重启保持、功能区按钮、侧栏面板、右键菜单、选项开关与外部启停。移动端未单独验收。

## English

- Adds **On-demand loading**. Mark individual plugins in Better Manager settings; all other plugins keep following normal or delayed startup. The first choice runs the plugin once to remember its commands, then unloads it. Executing a remembered command loads the real plugin and forwards to the native command.
- Sleeping plugins leave Obsidian's startup list; only command placeholders remain after a restart. A stale manifest version triggers one recapture.
- A plugin used through on-demand stays loaded for the rest of the session. **Follow normal / delayed settings** restores it immediately and returns it to Obsidian's management.
- On-demand plugins get Ribbon load buttons, a right-sidebar sleeping-plugin panel, and file/editor context-menu load items; each surface can be disabled. They are load entry points, not fabricated copies of the plugin's own Ribbon or context commands.
- Choices live in `ON_DEMAND` inside `data.json`, following configuration sync and conflict resolution. Device presets still decide whether a plugin is enabled. A mode or surface choice is published immediately as a user edit, even when **Save settings manually** is enabled.
- Fixes cards keeping an old plugin name after a manifest rename. Refreshing manifests now writes the current name and description back into plugin records. Legacy records adopt the manifest once; later user edits are preserved, and **Restore to the initial state** resumes following the manifest. Provenance markers never create a configuration conflict.

Validated with 742 automated tests, type checking, linting and a production build. Desktop acceptance covered first capture, command triggering, sleep/wake, restart persistence, Ribbon buttons, the sidebar panel, context menus, option toggles and external enable/disable. Mobile was not separately tested.
