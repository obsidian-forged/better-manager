# 更清晰的编辑界面与更稳妥的配置保存

## 编辑与快捷创建

- 编辑模式加入用途说明；自定义布局模式提示排序和分割线操作，窄屏下按内容自然排布。
- 批量分组、添加标签和单插件快捷菜单支持直接创建分组或标签，创建后应用到所选插件；没有现有分类时也能使用。
- 分类创建入口共用 ID 校验，防止重复 ID 和覆盖内置标签；取消创建不会修改配置。
- 管理器悬浮提示支持图标、标题与下方说明，长文字完整换行。旧版 Obsidian 保留完整文字提示。

## 配置保存与同步保护

- 单文件模式保存相同内容时跳过重复写盘，减少不必要的同步事件。
- 读取配置失败时停止保存，避免覆盖尚未成功读取的配置。
- 保存等待期间出现新编辑或新的外部配置时，拒绝过期保存，保留待保存内容。
- 为 `.bpm` 中已有的恢复文件建立只读内存基线，避免将相同内容或仅修改时间变化误报为外部修改；不会为此写入磁盘索引。
- 外部修改事件仍仅用于提醒，不会自动采用配置、重建界面或暂停保存。

---

# Clearer editing and safer settings saves

## Editing and quick creation

- Edit mode explains the available actions, with ordering and separator guidance for custom layouts. Narrow screens size the bar to its content.
- Bulk group assignment, tag addition and per-plugin quick menus can create groups or tags and apply them to selected plugins, including when no categories exist yet.
- Creation entry points share ID validation to prevent duplicate IDs and replacement of built-in tags. Cancelling leaves settings unchanged.
- Manager tooltips support an icon, title and wrapping explanation. Older Obsidian versions retain the complete text tooltip.

## Settings saves and sync protection

- Single-file mode skips writes when the configuration content is unchanged, reducing unnecessary sync events.
- A configuration read failure stops the save instead of allowing an unread configuration to be overwritten.
- New edits or external configuration changes while a save is waiting invalidate the stale save and preserve pending changes.
- Existing recovery files in `.bpm` receive a read-only, in-memory baseline so identical content and modification-time-only changes do not trigger false external-change warnings. No disk index is written for this baseline.
- External file events remain advisory: they do not automatically adopt settings, rebuild the interface or pause saving.
