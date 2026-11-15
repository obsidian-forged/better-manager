# 修复保存被误拦截与处理窗口按钮不可见

Better Manager 1.2.37 修复同步送来的新设备记录导致保存被拒绝，以及处理配置文件窗口底部按钮被文件列表挤出可视区域的问题。

- 其他设备同步送达的新设备记录即使只是 JSON 格式或心跳时间不同，也不再阻止保存；设备名称、类型等真实内容变化仍需在处理窗口确认。
- 处理配置文件的窗口改为文件列表单独滚动，操作按钮固定在底部，文件较多时也能随时点击。
- 没有可验证已保存副本时不再显示灰色的“恢复已保存文件并保存”按钮，只保留可用的“使用当前文件并保存”。

## English

### Fix blocked saves and unreachable resolver buttons

Better Manager 1.2.37 fixes saves rejected because of newly synced device records, and resolver buttons pushed out of view by a long file list.

- New device records delivered by another device no longer block saving when only JSON formatting or heartbeat timestamps differ; actual changes to names, types and other content still require confirmation in the resolver.
- The configuration-file resolver now scrolls its file list separately and pins the action buttons to the bottom, so they stay reachable with many files.
- The greyed-out "Restore saved files and save" button is no longer shown when no verified copy exists, leaving only "Use current files and save".
