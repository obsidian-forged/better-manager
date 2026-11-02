# 更明确的 Ribbon 状态筛选

**Better Manager 1.2.5** 修复 Ribbon 设置中禁用插件条目混入「显示」或「隐藏」结果的问题。

- 「显示」「隐藏」「插件被禁用」使用互斥分类，按钮数量与筛选结果保持一致。
- 同时选择「显示」和「隐藏」时，不再包含所属插件已禁用的条目；选中「插件被禁用」后才会纳入这些条目。
- 保留多选、全部、分组和搜索筛选。三个状态全部选中时自动切换为「全部」。
- 筛选不会修改 Ribbon 条目原有的显示设置，重新启用插件后仍按原设置分类。

## English

**Better Manager 1.2.5** fixes disabled-plugin Ribbon items appearing in Visible or Hidden results.

- Visible, Hidden and Plugin disabled now use mutually exclusive categories, with matching counts and results.
- Selecting Visible and Hidden excludes items owned by disabled plugins. Select Plugin disabled to include those items.
- Multi-select, All, groups and search remain available. Selecting all three states switches to All.
- Filtering preserves each item's saved visibility, which applies again when its plugin is re-enabled.
