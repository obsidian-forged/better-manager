# 更稳定的配置同步与更清晰的界面导航

**Better Manager 1.2.4** 改进外部配置更新的处理方式，新增最近安装筛选，并优化桌面与移动端的顶栏。

## 外部更新保留当前编辑界面

- 首次检测到外部配置变化即提醒暂时关闭外部实时同步，不再等待频繁修改阈值；连续提醒按一分钟合并。内容未变以及 BPM 自身成功保存的回声不会触发提醒。
- 打开的 BPM 界面保留当前编辑快照，首次外部变化即启用本机恢复缓存。外部更新不会触发页面跳转、关闭弹窗、重建顶栏或重载外观。
- 关闭最后一个 BPM 界面后，将本机编辑与最新共享配置合并。远端独立改动保留，同一字段冲突时本机编辑优先。
- 插件、外观和 Ribbon 的运行配置在编辑结束后应用；纯筛选变化不再触发运行配置重载。应用外部预设时不再反向保存一次配置，减少重复写入。

## 总览与导航

- 状态筛选第一项新增「最近安装」，沿用最近安装时间范围，默认 7 天，支持与其他状态组合或排除。
- 桌面标题区统一显示「Better Manager」，图标和页面名称随当前视图切换。
- 全局操作保留设置、更多和独立关闭按钮；后台任务移入更多菜单，进行中的任务仍有提示标记。
- 联系方式使用 Obsidian 原生子菜单，集中提供教程、GitHub 和 QQ 群入口。

## Ribbon 移动端修复

- 为主界面内嵌与独立 Ribbon 筛选栏统一限制宽度，增加「插件被禁用」等项目后仍在栏内横向滚动。
- 同时选中显示、隐藏和插件被禁用时，自动归并为「全部」，并同步按钮高亮。

## English

### Stable editing during external settings updates

- The first external settings change immediately recommends pausing external real-time sync. Repeated notices are grouped for one minute; unchanged content and echoes of BPM's own successful saves are ignored.
- Open BPM views retain their editing snapshot and enable a device-specific recovery cache on the first external change. External updates do not navigate away, close dialogs, rebuild the toolbar or reload appearance.
- After the last BPM view closes, local edits merge with the latest shared settings. Independent remote changes are preserved, and local edits take precedence for conflicting fields.
- Plugin, appearance and Ribbon runtime changes apply after editing ends. Filter-only changes no longer reapply runtime configuration, and applying a synced preset no longer writes the settings back again.

### Overview, navigation and mobile Ribbon

- Added Recently installed as the first status filter, using the existing installation window (7 days by default), with multi-select and exclusion support.
- The desktop header displays Better Manager alongside the current view's icon and name.
- The global toolbar keeps Settings, More and a separate Close button. Background tasks move into More while retaining an active-task indicator; contact links use an Obsidian native submenu.
- Embedded and standalone Ribbon filter bars respect narrow widths and scroll horizontally. Selecting Visible, Hidden and Plugin disabled together returns to All with matching button highlights.
