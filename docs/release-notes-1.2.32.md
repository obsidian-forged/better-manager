# 冲突界面可查看差异

**Better Manager 1.2.32** 让配置冲突弹窗可以展开查看具体差异位置，并澄清「生效方式」与手动保存的关系。

## 配置冲突

- 冲突弹窗底部新增「显示差异 / 隐藏差异」按钮，默认收起。
- 展开后按冲突分区列出发生变化的设置路径，方便判断冲突在哪。
- 只显示设置路径，不显示两侧的具体值，避免把令牌等敏感内容展示出来。
- 展开/收起不会重建分区，也不会丢失已选择的本机/远端版本或滚动位置。

## 生效方式说明

- 明确「仅本次会话」的更改立即生效、不写入配置、无需保存，重启后还原。
- 只有「持久保存」的更改才受「仅手动保存配置」控制；不会因为切换生效方式而自动更改该设置。

## 验证

- `npm run check` 通过：类型检查、Lint 和 633 项自动化测试。
- `npm run build` 通过；发布产物使用本次构建生成的 `main.js`、`manifest.json` 与 `styles.css`。
- 在临时 vault 中制作真实同步冲突，验证差异按钮、路径列表与展开/收起状态。

## English

### View differences in the conflict dialog

**Better Manager 1.2.32** lets the configuration-conflict dialog reveal exactly which settings differ, and clarifies how the apply mode relates to manual saving.

#### Configuration conflicts

- The conflict dialog gains a **Show differences / Hide differences** button, collapsed by default.
- Expanding it lists the changed setting paths per conflict section, making the conflict easy to locate.
- Only setting paths are shown, never the values from either side, so tokens and other sensitive content stay hidden.
- Expanding or collapsing does not rebuild the sections or lose the selected local/remote choices or scroll position.

#### Apply mode

- **This session only** changes take effect immediately, are never written to configuration, do not need saving, and reset after restarting Obsidian.
- Only **Save permanently** changes follow **Save settings manually**; switching the apply mode never changes that setting automatically.

#### Verification

- `npm run check` passes: type checking, lint and 633 automated tests.
- `npm run build` passes. The release artifacts `main.js`, `manifest.json` and `styles.css` come from this build.
- A real sync conflict was created in a temporary vault to verify the difference button, the path list and the expanded/collapsed states.
