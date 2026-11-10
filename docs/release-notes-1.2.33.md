# 同步配置像同步系统一样直接采用最新版本

**Better Manager 1.2.33** 重做了同步冲突的判定：另一台设备保存的 `data.json` 同步过来后，只要本机没有未保存的用户修改，就直接采用最新配置，不再把一次普通的同步变成冲突；真正的冲突也会在发现时立即打开解决窗口，而不是等用户去点闪烁的保存键。

## 跟随最新配置

- 启动、打开管理器、打开设置以及收到同步文件事件时，都会检查共享配置。
- 本机没有用户编辑时，直接采用共享文件中的最新版本并刷新界面；不写入、不覆盖 `data.json`，也不需要点保存。
- “手机同步了电脑的配置却仍显示旧设置，保存键一直闪，点保存才弹冲突”的链路不会再出现。
- 后台自动保存（视图状态、启动迁移、设备心跳）不再把本机标记成“有用户编辑”，不会让保存键无端闪烁。
- 旧版本遗留下来的、本机一侧其实只是基线的冲突，在启动时自动跟随最新远端并清除。
- 本机有真实未保存编辑时，才会保留冲突并交给用户选择。

## 冲突直接显示

- 启动时发现真实冲突，直接打开冲突解决窗口。
- 运行中收到更新且本机有编辑时，检测到冲突就打开窗口，不再依赖保存键提示。
- 已打开并被用户关闭的同一冲突不会反复弹窗，仍可从提示条重新打开。
- 差异按实际有差异的设置项逐项成行，每项单独选择本机/远端；没有差异的项不会渲染，也不存在固定占位的类别。
- 只有紧密相关的键才合并：分组+标签为「分组与标签」，边栏相关键为「边栏设置」，延迟相关键为「延迟启动」；其余设置各占一行，方便逐项选择。
- 每行带一句说明，讲清这一项包含什么；设备预设差异仍按每个预设单独成行。
- 顶层差异由行标题直接表达，不再重复显示「设置项」文本；只有嵌套路径保留「显示差异」明细。
- 差异明细里的设置路径改用设置页名称，不再显示 `RECENT_INSTALL_DAYS` 这类原始配置键；数组项优先显示条目名或插件名。
- “全部保留远端”等原有选择方式不变。

## 冲突范围

- 只把用户定制的内容放进冲突：设置项、插件记录、分组/标签、布局、边栏、设备预设、设备名称/类型、来源订阅、外观方案等。
- BPM 生成、可重新下载/同步且重复无碍的数据不再让用户处理：设备记录文件、插件图标/配色文件、安装记录、仓库映射、安装历史、已解除来源、筛选状态、批量操作快照、排查进度等。
- 设备记录的增删与心跳不进入冲突；共同设备的名称/类型修改仍会保留。设备预设差异继续按预设分行显示。
- 图标文件跟随整体设置来源；设备记录保留本机合并结果。

## 条目差异标记

- 管理器条目新增未保存标记：本机改动与上次保存不同时，卡片上显示圆形铅笔图标。
- 冲突状态下，条目改为圆形来源图标（本机/远端）；冲突标记优先于未保存标记。
- 标记只显示图标，边框为圆形；未保存、本机、远端等文字放在悬浮气泡里。
- 保存完成或冲突解决后，标记自动消失；列表重绘后也会重新挂上。

## 边界

- 没有增加“绝对三设备分立”开关。
- 单机模式的行为保持不变。
- 旧格式、丢失版本标记的共享内容仍交给冲突界面确认，不静默覆盖本机配置。

## 验证

- `npm run check` 通过：类型检查、Lint 和 655 项自动化测试。
- 使用真实文件系统与真实修订逻辑复现完整链路：旧设备私有缓存 + 新 `data.json` 启动后直接显示最新配置且不写共享文件；本机编辑后收到更新会直接产生冲突并打开窗口；选择远端后正确落盘。
- `npm run build` 通过。

## English

### Follow the newest synced configuration

**Better Manager 1.2.33** reworks how sync conflicts are decided. When another device publishes `data.json`, a device with no unsaved user edits adopts the newest configuration immediately instead of turning an ordinary sync into a conflict. Genuine conflicts open the resolver as soon as they are detected, without waiting for a flashing Save button.

#### Following the latest version

- The shared configuration is checked at startup, when the manager or settings open, and when shared files change.
- With no local user edits, the newest shared revision is adopted and the interface refreshes; `data.json` is neither rewritten nor overwritten, and Save is not required.
- The old chain — the phone syncs the computer's file but keeps showing old settings, the Save button keeps flashing, and clicking it finally raises a conflict — no longer occurs.
- Background automatic saves (view state, startup migrations, device heartbeats) no longer mark the device as user-edited, so the Save control no longer flashes without a real edit.
- Conflicts left by older builds where the local side was merely the base are cleared by following the newest remote at startup.
- A real unsaved local edit still produces a conflict for the user to resolve.

#### Conflicts are shown directly

- A genuine conflict found at startup opens the resolver immediately.
- When a newer version arrives while local edits exist, the resolver opens as soon as the conflict is detected.
- The same conflict is not repeatedly reopened after the user dismisses it; it remains available from the notice.
- Each setting that actually differs gets its own row with an independent local/remote choice. Rows without differences are never rendered; there are no placeholder categories.
- Only tightly related keys are combined: groups + tags as **Groups & tags**, Ribbon keys as **Ribbon settings**, and delay keys as **Delayed startup**. Every other setting is its own row for item-by-item resolution.
- Each row carries a one-line description; device presets still appear as one row per preset.
- Top-level differences are stated by the row title, without repeating a "Setting" text block; the **Show differences** details remain only for nested paths.
- Detail paths use the setting names shown in the settings page instead of raw keys such as `RECENT_INSTALL_DAYS`; array items show their item or plugin name when available.
- Existing choices such as **Remote version · All settings** are unchanged.

#### Conflict scope

- Only user-customized content enters conflicts: settings, plugin records, groups/tags, layout, Ribbon, device presets, device names/types, source subscriptions and appearance profiles.
- BPM-generated data that can be re-downloaded or synced harmlessly is no longer user-resolved: device record files, icon/color files, install receipts, repository mappings, install history, unbound sources, saved filters, batch snapshots and troubleshooting progress.
- Added or removed device records and heartbeats do not conflict; name/type edits on devices present on both sides remain selectable. Preset differences still appear as per-preset rows.
- The icon file follows the overall settings source; device record files keep the local merged result.

#### Item marks

- Manager items now show a round pencil icon when they differ from the last save.
- During a conflict, the item shows a round source icon (local or remote) instead; the conflict mark takes priority over the unsaved mark.
- Marks are icon-only with a circular border; the label (Unsaved, Local, Remote) appears in the floating tooltip.
- Marks disappear after saving or resolving, and are reattached after a list re-render.

#### Boundaries

- No "absolute three-device separation" switch was added.
- Single-machine mode is unchanged.
- Legacy shared content without a verifiable revision still goes through the conflict UI instead of silently replacing local settings.

#### Verification

- `npm run check` passes: type checking, lint and 655 automated tests.
- The full path was reproduced with the real filesystem and revision logic: a stale private cache plus a newer `data.json` shows the latest settings at startup without writing the shared file; a local edit plus an incoming update raises and opens a conflict; choosing the remote side is written correctly.
- `npm run build` passes.
