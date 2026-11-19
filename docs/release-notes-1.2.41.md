# 修复实时同步的无路径通知

当同步工具替换文件或目录时，Obsidian 可能发出没有文件路径的通知。Better Manager 在接收通知和匹配文件时都会跳过此类事件，避免恢复目录观察、共享配置提醒和设备记录监听报错。随后收到的有效路径仍会正常处理。

## English

Obsidian can emit file-change events without a path when a sync tool replaces files or directories. Better Manager ignores these events at both the adapter and watcher boundaries, preventing errors in recovery folder observation, shared settings notifications, and device management. Subsequent events with valid paths are still processed.
