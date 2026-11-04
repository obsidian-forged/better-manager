# Better Add-on Manager (obsidian-manager)

## 开发工作流

- 开发前按需查阅 [官方 sample plugin 的 Agent 指南](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/AGENTS.md)、[Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) 与 [官方 ESLint 说明](https://github.com/obsidianmd/eslint-plugin)。本仓库的业务约束与用户授权优先；示例代码不能直接替代边界校验。
- 安装使用 `npm ci`；修改后运行 `npm run check`、`npm run build`。`check` 包含类型检查、`eslint.review.mjs` 的官方类型感知规则和全部 `tests/*.test.mjs`，CI 对 push / pull request 执行相同检查。不得通过 `eslint-disable`、忽略业务源码或关闭规则掩盖问题。
- 模块按职责组织，复杂异步 UI 复用 `createActionHandler`。要求返回 void 的事件/生命周期不返回 Promise；错误转为 Error，诊断日志受 DEBUG 控制，必要失败给用户可操作的提示。未知 JSON / 网络数据先收窄，展示用 `toText`，不引入 `any` 或未类型化成员。
- DOM 使用 Obsidian helpers，禁止 HTML 注入；跨窗口使用所属文档/窗口、`.instanceOf()` 和成对注册/释放的监听、计时器、动画帧。系统识别使用 `Platform`。避免全局状态与重复原生补丁。
- 样式先改共用组件、状态类和 Obsidian 变量，不叠加 `!important`。新 CSS 对最低版本给出真实回退；保留主题风格、悬停滚动条与触屏行为，不能机械删规则消除提示。
- SDK 类型版本不等于最低运行版本：新 API 要有能力/版本检查；设置定义与旧版 `display()` 共用真实控件和搜索元数据，不能空实现或隐藏占位。
- 保持草稿与共享保存分离：默认仅显式保存；用户关闭“仅手动保存配置”后，只在最后一个 BPM 编辑窗口关闭时走同一保存/冲突入口，编辑器重开须取消尚未提交的关闭保存。外部文件事件只可参与只读、分文件的频繁修改提醒，不得采用配置、重建界面、暂停保存或自动修复；排除本机回声、相同内容和纯元数据通知。“仅本次会话”修改不能进入待保存配置。不得增加遥测或上传用户配置。
- 必要回归在独立空 vault 或原生 API 测试替身中执行，区分自动检查与实际 UI/真机验收。临时扫描/批改脚本用 Node.js 并清理；保留现有未提交改动，不擅自部署、提交或发布。

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

