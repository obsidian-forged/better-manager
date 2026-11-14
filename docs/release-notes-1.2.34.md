# Better Manager 1.2.34

本次为实时同步提醒与设置说明的小幅修复。

- 未开启配置实时同步保护时，启动提醒不再要求排除 `.bpm` 恢复目录；开启保护时仍保留对应说明。
- 设置名称和提示明确为“实时同步”，检测到支持该能力的服务时，不再暗示其内部实时同步模式已开启。
- 检测名单移除 EasySync、Remotely Save；保留 Obsidian Sync、Sync Engine、Nutstore Sync、Fast Note Sync 和 Self-hosted LiveSync。
- 修正检测名单后，EasySync、Remotely Save 不再因该检测而触发提醒或阻止单机模式的后台配置写入。

验证：类型检查、Lint 与 660 项自动化测试通过，生产构建通过。

## English

This is a small maintenance update to realtime sync notices and setting descriptions.

- Startup notices no longer ask users to exclude the `.bpm` recovery folder when configuration realtime sync protection is off. The relevant advice remains available when protection is enabled.
- Settings and notices explicitly refer to realtime sync. Detecting a capable service no longer implies that its realtime mode is currently enabled.
- Removed EasySync and Remotely Save from detection. Obsidian Sync, Sync Engine, Nutstore Sync, Fast Note Sync and Self-hosted LiveSync remain supported.
- EasySync and Remotely Save no longer trigger these notices or block background configuration writes in single-file mode through this detection.

Validation: type checking, lint and all 660 automated tests pass; the production build passes.
