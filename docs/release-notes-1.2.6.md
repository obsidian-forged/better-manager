# 更清晰的界面，更顺畅的操作

**Better Manager 1.2.6** 改进插件卡片、设备预设、Ribbon 和窄屏工具栏，减少重复操作与布局干扰。

## 自适应工具栏

- 插件总览和安装来源根据实际可用宽度调整布局，完整控件放不下一行时自动收起，空间足够后恢复。
- 总览统计收进带图标的状态下拉菜单；批量编辑、编辑模式和刷新保留在外，其余可用操作进入「更多」。
- 安装仓库与来源订阅合并为左侧下拉入口，五项来源统计收进右侧菜单。
- 下拉入口与选项显示 Obsidian 内置图标，当前图标随选择更新。

## Ribbon 与移动端布局

- 修复 Ribbon 搜索输入一个字符就失焦的问题；输入时仅刷新结果，保留输入框、光标与选区。
- 改善溢出顶栏的横向触摸滚动，区分横向拖动与纵向滚动，并抑制滑动后的误触。
- Ribbon 分组编辑区随条目列表一起滚动，不再停留在顶部。
- 修复插件卡片底部、安装来源的统计、说明和输入控件在窄屏下的布局。
- 切换页面时同步移动端标题、图标、搜索和筛选控件；返回插件总览时保留搜索内容。
- 隐藏插件窗口统一标题与内容边距，筛选项等宽排列、背景透明，并移除重复分隔线。

## 插件卡片与设备预设

- 插件卡片支持切换描述与笔记，并记住每个插件的默认展示内容。
- 可单独把插件启用／禁用操作加入命令面板，无需为所有插件注册命令。
- 卡片常用操作集中在「更多」菜单，减少按钮占用；新配置默认使用双列总览。
- 快速应用设备预设时，可选择插件、筛选、Ribbon 或外观部分；未选择的部分保持目标预设原样。

## English

### Adaptive toolbars

- Plugin overview and installation toolbars collapse when the full controls no longer fit on one row, and expand again when space is available.
- Overview statistics become an icon-enabled status dropdown. Bulk edit, layout editing and reload remain directly accessible; other available actions move into More.
- Installation navigation uses a left-aligned dropdown, with five source statistics in a right-aligned menu.
- Dropdown entries use built-in Obsidian icons, and the trigger follows the current selection.

### Ribbon and narrow layouts

- Ribbon search updates results without replacing the input, preserving focus, caret and selection.
- Overflowing toolbar strips support horizontal touch scrolling while preserving vertical scrolling and suppressing accidental clicks after a swipe.
- Ribbon groups scroll together with the item list.
- Plugin card footers, installation statistics, descriptions and input controls fit narrow containers.
- Mobile page changes update the title, icon, search and filters; returning to the overview retains the search query.
- The hidden-plugin dialog uses aligned content, equal-width transparent filters and fewer separator lines.

### Plugin cards and device presets

- Switch between a plugin's description and notes, and save a per-plugin default view.
- Add individual plugin toggles to the command palette without registering commands for every plugin.
- Card actions are grouped into More; new configurations default to the two-column overview.
- Quick apply can copy selected plugin, filter, Ribbon or appearance sections while preserving unselected sections in the target preset.
