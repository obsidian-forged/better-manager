# Better Add-on Manager (obsidian-manager)

## 前端测试程序

- Chrome（`chrome@openai-bundled`）是用户指定的可用前端测试程序，可用于插件商店前端的预览、交互和视觉验证；按 `chrome:control-chrome` 技能建立连接。
- `chrome-devtools-mcp` 已获用户授权并注册到 Codex 用户级 MCP 配置，服务名为 `chrome-devtools`，可用于 Obsidian/CDP 调试。连接既有调试端口前先验证浏览器身份，显式定位主窗口；个人库不得执行导航、关闭、视口修改或写入测试。使用时关闭 usage statistics 与 performance CrUX 外发，单次调用超时不超过 6 秒。
- 测试程序可用不代表本次连接已成功；连接失败时须如实记录，不能把类型检查或单元测试描述成浏览器验证。
- Obsidian 插件界面测试使用空的临时 vault，不得为测试修改 AstroScope 个人库。

## 参考资料

本仓库包含 Obsidian 插件开发参考库作为 git 子模块：
`.agent/references/obsidian-sample-plugin-plus/`

该库提供：
- 完整的 Obsidian 插件开发最佳实践
- 项目模板构建、测试、部署流程
- TypeScript API 使用参考
- 社区插件发布规范指南

需要查阅时，读取对应目录下的 `AGENTS.md` 和 `.agent/skills/` 中的 skill 文件。

