# 首次安装自动建立配置，语言跟随 Obsidian

Better Manager 1.2.36 修复手动安装后没有 `data.json` 却提示“配置文件缺失”且无法保存的问题，并让插件语言默认跟随 Obsidian 界面语言。

- 全新安装时，如果没有正在使用的同步服务，启动后立即建立配置文件，不再停留在“未保存”，保存也不会报错。
- Obsidian 自带的 Sync 只是默认开启、尚未登录时，不再被当作活跃同步服务，因此不会阻止首次建立配置。
- 配置文件缺失或为空时，会弹出处理窗口说明原因：可「重新检查」等待同步送达，或「创建配置文件」在本机建立配置；当前设置会保留。
- 处理窗口中点「重新检查」会继续完成此前中断的保存，收到的配置与草稿合并，不会直接覆盖；确认创建前会再次核对文件。
- 已在使用同步的库中，缺失的文件仍不会被后台自动重建，避免覆盖其他设备尚未送达的配置。
- 插件语言默认读取 Obsidian 界面语言（官方 `getLanguage()`），旧版本 Obsidian 保留原有回退方式。

## English

### First-install configuration and language detection

Better Manager 1.2.36 fixes manual installs that had no `data.json`, reported a missing configuration, and could not save. The plugin language now follows Obsidian's interface language by default.

- A first install with no active sync service creates the configuration file at startup instead of staying unsaved, and saving no longer reports a missing file.
- Obsidian's built-in Sync, enabled by default but not signed in, no longer counts as an active sync service and does not block the first install.
- When the configuration file is missing or empty, a dialog explains the situation and offers **Check again** to wait for sync or **Create the file** to create it locally. Current settings are kept.
- **Check again** finishes the interrupted save and merges a delivered file with the draft instead of overwriting it; the file is verified again before creation.
- On vaults that already sync, a missing file is still never recreated in the background, so another device's undelivered configuration is not overwritten.
- The interface language defaults to Obsidian's language through the official `getLanguage()`, with the previous fallbacks for older Obsidian versions.
