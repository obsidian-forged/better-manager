# 配置同步策略 / Configuration sync policy

## 用户行为 / User behavior

- 「自动保留最新配置」默认开启。以 BPM 记录的用户修改时间选择整份配置，不使用插件版本、修订代数、文件修改时间判断新旧。
- 关闭该选项后，保留差异查看、人工选择和保存入口，用户可以选择较早的配置或继续调整。
- 启动、升级、启用新版、迁移、心跳和图标缓存维护不代表用户修改，不应把旧配置变成「最新」。保存重试也不改变原编辑时间。
- 时间戳相同无法判断谁更新；自动模式保留已经到达共享文件的配置，避免两台设备反复覆盖。没有有效时间戳的旧配置仍有兼容处理入口，不用文件时间猜测。
- 时间判断依赖设备时钟；多设备应开启系统时间校准。选择策略可以关闭。

The automatic keep-newest policy is enabled by default and compares BPM-recorded user edit times for the whole configuration. Plugin versions, revision generations and filesystem timestamps do not decide the winner. Disable the policy to review and select configurations manually, including an older one. Startup, upgrades, migrations, heartbeat/cache maintenance and save retries must not refresh user edit time. Equal edit times cannot establish recency; automatic mode retains the shared file instead of repeatedly overwriting it. Legacy data without valid edit times keeps a compatibility path. Device clocks should be synchronized.

## 同步设置指引 / Sync setup guidance

排除规则指引提供可折叠代码块、复制按钮和同步插件设置入口。路径、glob 和正则是不同语法，只复制目标工具实际支持的格式。跳转后由用户手动设置，BPM 不代写同步插件配置。「已设置，不再提醒」只保存在当前设备；手动指引入口保留。

The guide provides collapsible copyable examples and links to the relevant sync settings. Literal paths, globs and regular expressions are distinct formats. Users apply supported rules themselves. Acknowledging setup suppresses advisory reminders on this device and leaves the manual guide available.

## 隔离运行记录 / Isolated runtime checks

2026-11-19，独立空库、独立用户数据和 19223 测试端口，Obsidian 1.15.1；同步插件设置跳转使用无网络的合成插件设置页。

- 普通保存与保护保存均写入用户修改时间；重复保存及后台暂存保持时间不变，新修订不写 `generation`。
- 模拟时间较新的远端配置，在本机存在草稿时自动采用整份远端配置，内存与磁盘一致，未残留待保存状态。
- 关闭自动策略，模拟更新的远端配置，显示人工处理入口；选择较早本机配置后保存成功。
- 展开/收起代码块、复制路径及正则匹配通过；展开后底部按钮保持可见且命中点击。
- 跳转到合成同步插件设置，核对选中设置页，并在设置窗口显示操作步骤。
- 「已设置，不再提醒」写入当前设备存储，关闭窗口；重载插件后仍能手动打开指引。
- 390×760 触屏窄视口、浅色界面下展开长规则，独立内容区滚动，底部两个按钮均在可视区且通过实际点击命中检测。

最终 `npm run check` 通过（701 项测试、类型检查与 lint），`npm run build` 通过。独立审查发现的自动维护误刷新时间、OFF 启动未立即建立人工决策状态已修复并补回归；保存期间新编辑和保存队列阻塞的时间捕获也有回归覆盖。

桌面运行及触屏窄视口模拟不代表 iOS/Android 真机验收。真实同步服务的网络传输与服务端冲突未在此空库测试。


## 元数据边界 / Metadata boundary

编辑时间由 BPM 的编辑/保存流程维护，不从外部文件 mtime 推断。普通本地 JSON 无法实现「只有 BPM 进程拥有写权限」；此字段不是密码学身份认证。完整性校验、写入前复核和中断恢复仍有各自职责，不能把时间戳当成允许覆盖未到齐文件的凭证。

BPM maintains edit-time metadata through its edit/save flow, without inferring it from filesystem mtime. A local JSON file cannot enforce process-exclusive authorship. The timestamp is not an authentication mechanism, and integrity checks, guarded writes and interrupted-save recovery remain necessary.
