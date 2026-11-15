# 修复同步配置无法保存

Better Manager 1.2.35 修复关联配置文件校验导致保存受阻的问题，并为需要确认的文件差异提供处理入口。

- 设备记录仅 JSON 排版、字段顺序或在线时间变化，以及 BPM 自动生成的图标缓存变化，不再误拦截保存。设备名称、类型和自定义 CSS 等实际修改仍需核对。
- 保存遇到关联文件缺失或不一致时，可从通知打开处理窗口，重新检查同步状态，或选择使用当前文件、恢复已保存副本后保存。
- 处理文件差异时保留当前设置草稿，并在覆盖文件前保存恢复副本。没有可验证副本的文件不会提供恢复操作。
- 确认前再次核对文件；如果期间又收到同步更新，需重新检查后选择，避免旧选择覆盖新内容。
- 没有实际修改时不为这些缓存变化重写共享配置；正常保存保留已到达的设备在线时间和图标缓存。

## English

### Fix saving synced configuration

Better Manager 1.2.35 fixes saves blocked by auxiliary-file validation and provides a way to resolve file differences that need confirmation.

- Device JSON formatting, key order, heartbeat timestamps and validated BPM-generated icon-cache changes no longer block saving. Actual changes to device names, types or custom CSS remain subject to review.
- When related files are missing or inconsistent, open the resolver from the notice to check sync again, use the current files, or restore verified saved copies and save.
- Your settings draft is preserved. Recovery copies are retained before files are overwritten; restore is unavailable without a verified copy.
- Files are checked again before confirmation. A newer sync delivery requires a fresh review, preventing an outdated choice from overwriting new content.
- Cache-only changes do not rewrite shared configuration when there are no actual edits. Normal saves retain received device heartbeats and icon-cache discoveries.
