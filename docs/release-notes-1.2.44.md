# 修复延迟启动下「全部插件关闭」的失效状态

延迟启动会把受管插件从 `community-plugins.json` 移出，由 BPM 启动。任何启动失败都会让它们全部保持关闭。1.2.44 修复了多条会把启动流程带进这个状态的链路：

- 清单暂时不完整（移动端同步、目录尚未就绪）时不再删除插件记录；只有显式卸载才裁剪记录，避免名称、分组、标签、备注和启用状态被整批清空。
- 外观/预设投影失败不再中断设备初始化或延迟启动；按需加载初始化失败也只关闭按需功能，不影响 BPM 本体。
- 设备预设应用失败时仍会执行一次延迟队列兜底；单个按需插件失败不会阻断其余插件。
- 启动自检只在延迟队列已经结束、且没有失败项时才接管 `community-plugins.json`。
- 延迟队列结束后一个受管插件都没起来时，会自动把绑定预设和记录中启用的插件恢复为原生启动；BPM 初始化失败时也会先恢复再卸载，避免下次启动被锁死。
- 修复同步来的残缺插件记录（缺少名称、标签、启用标记等）导致的启动异常。

已通过 751 项自动测试、类型检查、Lint 和生产构建。桌面独立库验证了延迟启动、启动兜底和记录保留；平板故障由用户实机复现，本轮未在平板上重新验收。

## English

- Partial manifest lists during sync/startup no longer delete plugin records; only an explicit uninstall prunes them.
- Appearance/preset projection failures no longer abort device initialization or delay startup. On-demand initialization is optional.
- A failed device application still triggers a fallback delay drain; one failing on-demand plugin cannot block the rest.
- The startup self-check rewrites the startup list only after a settled, failure-free delay queue.
- If no managed plugin starts, BPM restores enabled plugins from the bound preset and records to native startup. The same recovery runs before unloading after an initialization failure.
- Malformed synced plugin records are repaired before projection.
- Validated with 751 automated tests, type checking, linting and a production build. Desktop isolation covered delay startup, fallback drain and record preservation. The tablet failure was user-reproduced but was not re-tested on a tablet here.
