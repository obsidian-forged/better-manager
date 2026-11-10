# 配置同步修复与手动刷新

**Better Manager 1.2.30** 修复多设备同步时本机覆盖其他设备修改的问题，并加入手动刷新入口。

## 配置保存与同步

- 单机模式保存前把本机改动合并到其他设备的最新配置上，不再整份覆盖；合并后立即同步内存，后续保存不会把外部改动改回去。
- 磁盘在读取与写入之间再次变化时取消本次保存；支持原子读写的运行环境会使用 `adapter.process` 缩短窗口。
- `data.json` 暂时缺失或为空时，不会把配置重置为默认值；空闲时会直接采纳外部修改。
- 放弃未保存更改会回到最后一次成功保存的基线，读取失败也不会清空设置或预设。
- 保护模式下删除缓存后的重建会先确认 `data.json` 未被同步更新；冲突引用的状态文件缺失时自动丢弃悬空冲突，不再每次启动失败。
- 启动时迁移的设备记录在关闭窗口选择“不保存”后仍会保留；单机模式删除设备会同时删除旧的设备记录文件，避免下次启动复活。

## 配置同步保护开关

- 「启用配置同步保护」改为每台设备自己的设置，只保存在本机，不写入 `data.json`、不随同步传播，也不会影响其他设备。
- 修改开关不需要写配置，重启 Obsidian 后生效；设置页会提示“重启后生效”。
- 关闭保护并选择删除缓存时，只在本设备下次以单机模式启动后删除本机自己的缓存目录，不再删除整个 `.bpm` 根目录。
- 旧版本写在 `data.json` 里的开关会迁移一次；没有开关字段的配置以修订标记或本机 `.bpm` 判断是否为旧保护库，全新安装默认关闭。
- 从保护模式切回单机模式时，启动后自动把 `data.json` 改写成普通格式（去掉修订标记、写回设备记录）。

## 手动刷新

- 管理器「更多」菜单新增「刷新」，重新读取外部设置和插件列表并重绘界面。
- 设置页顶栏新增刷新按钮，可在不重启的情况下采纳外部配置并刷新当前分类。

## 验证

- 自动检查通过（618 个测试），构建通过。
- 在临时 vault 中实测了单机合并、连续自动保存、保护开关切换、保护转单机的格式转换、缓存删除范围，以及两处刷新按钮。

## English

### Configuration sync fixes and manual refresh

**Better Manager 1.2.30** fixes local machines overwriting edits made on other devices during sync, and adds manual refresh entries.

#### Saving and sync

- Single-machine mode merges local edits onto the latest settings from other devices before saving instead of replacing the file; merged values are adopted into memory so later saves do not revert them.
- If the disk changes again between the read and the write, the save is cancelled; environments with atomic read-modify-write use `adapter.process` to narrow the window.
- A temporarily missing or empty `data.json` no longer resets settings to defaults, and external changes are adopted while idle.
- Discarding unsaved changes returns to the last successful baseline; a failed read no longer clears settings or presets.
- In protected mode, rebuilding after cache deletion first verifies that `data.json` has not been updated by sync; conflicts whose referenced states are missing are dropped instead of blocking every startup.
- Device records migrated at startup survive choosing Don't save; deleting a device in single-machine mode also removes its stale record file so it does not return.

#### Configuration sync protection switch

- **Enable configuration sync protection** is now a per-device setting stored locally. It is not written to `data.json`, does not sync to other devices and does not affect them.
- Changing the switch no longer writes configuration; it applies after restarting Obsidian, and the settings page shows a restart notice.
- Turning protection off with cache deletion removes only this device's own cache directory after the next single-machine start, not the whole `.bpm` root.
- A legacy switch stored in `data.json` is migrated once; files without the field are treated as protected only when they carry a revision marker or a local `.bpm` exists, and fresh installs default to off.
- Switching from protected to single-machine mode rewrites `data.json` into the plain format at startup (revision marker removed, device records written back).

#### Manual refresh

- The manager's **More** menu adds **Refresh**, which re-reads external settings and the plugin list and redraws the interface.
- The settings top bar adds a refresh button that adopts external configuration and refreshes the current category without restarting.

#### Verification

- Automated checks pass (618 tests), and the build passes.
- Tested in a temporary vault: single-machine merging, consecutive automatic saves, switching protection, the protected-to-single-machine conversion, cache deletion scope, and both refresh buttons.
