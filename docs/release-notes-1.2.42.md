# 修复插件清单改名后的刷新与搜索

- 手动修改自制插件的 `manifest.json` 后，管理器会自动刷新清单；无需递增插件版本号即可搜索新的名称和描述。
- 「刷新」会重新读取磁盘清单；桌面与移动端的「重载插件列表」共用清单读取入口，并清除过期缓存。
- 搜索同时保留管理器中的自定义名称和描述，不覆盖用户别名、分组、标签或备注，也不重启正在运行的插件。

已通过 708 项自动测试、类型检查、Lint 和生产构建，并在 Linux Obsidian 1.15.0 独立测试库中验收自动刷新、手动刷新及工具栏重载。移动端真机未单独验收。

## English

- Editing a custom plugin's `manifest.json` automatically refreshes its metadata. New names and descriptions are searchable without changing the plugin version.
- Refresh rereads manifests from disk. Desktop and mobile plugin-list reload actions share the same read operation and invalidate stale caches.
- Search also includes saved custom names and descriptions. Aliases, groups, tags and notes are preserved, and running plugins are not restarted.

Validated with all 708 automated tests, type checking, linting and a production build. Automatic refresh, manual Refresh and toolbar reload also passed desktop window acceptance in an isolated Linux Obsidian 1.15.0 vault. Mobile devices were not separately tested.
