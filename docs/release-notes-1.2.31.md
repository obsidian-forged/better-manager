# 配置同步保护加固

**Better Manager 1.2.31** 加固同步库中的配置保存边界，避免后台写入覆盖其他设备的更新，也避免把同步期间暂时缺失的配置误当成首次安装。

## 配置文件同步

- 单机模式检测到 Obsidian Sync 或已知同步插件时，后台自动保存会保留为待保存更改；显式保存时才将本机编辑合并到当时磁盘上的配置。
- 同步服务状态无法确认时，后台自动保存同样保持待处理，避免检测失败导致直接写入。
- 已建立的 `data.json` 暂时缺失或为空时，不会由后台或后续重启自动重建；首次安装仍须由用户显式保存来创建配置文件。
- 保存期间文件消失、变空或被另一设备更新时，取消本次写入并保留本机待保存更改。
- 合并到不完整的外部文件时，仍保留运行所需的设备管理数据，不会因缺少字段而报错。
- 接受外部或合并后的预设内容时，不再以设备本地时钟时间戳判断版本先后，减少时钟偏差导致的旧配置回写。
- 保护模式遇到不完整的共享配置时保留修订标记与原文件，只恢复本机可用状态并提示检查同步文件，不自动修补共享配置。

## 多设备模式

- 同一同步库中的设备应统一开启配置同步保护。混用保护与单机模式时，设备记录格式不同仍可能产生误冲突。
- `.bpm` 恢复目录应加入同步工具的排除列表。

## 验证

- `npm run check` 通过：类型检查、Lint 和 632 项自动化测试。
- `npm run build` 通过；发布产物使用本次构建生成的 `main.js`、`manifest.json` 与 `styles.css`。

## English

### Stronger configuration sync protection

**Better Manager 1.2.31** tightens configuration writes in synced vaults. Background saves no longer overwrite updates from another device, and a temporarily missing file is not mistaken for a fresh installation.

#### Configuration sync

- In single-machine mode, background saves remain pending when Obsidian Sync or a recognized sync plugin is enabled. An explicit Save merges local edits with the configuration currently on disk.
- If the sync-service state cannot be checked, background saves also remain pending instead of writing directly.
- Once `data.json` has been established, a temporary missing or empty file is never recreated by a background save or a later restart. A first-time installation creates it only after an explicit Save.
- If the file disappears, becomes empty or changes on another device during a save, the write is cancelled and local changes remain pending.
- Merging with a partial external file keeps the device-management data required at runtime, so missing fields cannot break the plugin.
- Accepted external and merged presets no longer rely on device-local timestamps to choose a winner, reducing stale writes caused by clock skew.
- In protected mode, an incomplete shared configuration keeps its revision marker and original files. BPM recovers only locally available state and reports the sync issue instead of repairing shared files automatically.

#### Multi-device mode

- Enable configuration sync protection on every device using the same synced vault. Mixing protected and single-machine modes can still cause false conflicts because device records use different representations.
- Exclude the `.bpm` recovery directory from the sync tool.

#### Verification

- `npm run check` passes: type checking, lint and 632 automated tests.
- `npm run build` passes. The release artifacts `main.js`, `manifest.json` and `styles.css` come from this build.
