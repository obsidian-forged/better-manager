# 大幅度改进界面

**Better Manager 1.2.0**

插件管理、外观、设备与边栏编排采用更清晰的界面，常用操作更集中，小屏幕浏览也更轻松。

## 界面焕新

- 改进插件卡片、底部操作区、筛选控件与页面布局，可按需要显示或隐藏功能入口。
- 顶栏默认仅当前页面显示标签，并开启悬停显示；旧版本升级时会应用这组默认值，之后仍可自行调整。
- 各类横向顶栏统一使用浮动滚动条，不再挤占按钮高度；滑块支持拖动，触屏保留横向滑动。
- 升级后提供一次性的截图介绍，可逐页浏览新版界面；截图随插件离线提供，关闭后不再显示。

![新版插件总览](https://raw.githubusercontent.com/lmce72/obsidian-manager-rev/1.2.0/docs/img/index.png)

## 更多改进

- **设备预设：** 为每种设备类型设置默认预设，在插件、外观与 Ribbon 页面使用统一的设备选择器；删除所选预设后按默认预设回退。
- **会话生效：** 插件与外观总览支持仅本次会话或永久生效，临时改动不写入持久化预设。
- **Ribbon：** 迁移旧格式条目并保留顺序和显隐，改进分组选择、序号控制与手机端布局。
- **最近安装：** 版本号旁新增时钟标签，默认显示 7 天内安装的插件；时间范围设为 **0** 可关闭。

![边栏编排](https://raw.githubusercontent.com/lmce72/obsidian-manager-rev/1.2.0/docs/img/ribbonOrder.png)

## 使用说明

继续沿用发布日期策略：设置最小发布天数后，日期缺失或无效的版本会暂缓更新；SemVer 预发布版本仍按预发布处理。

## English

### Major interface improvements

Better Manager 1.2.0 brings a clearer interface to plugins, appearance, devices and Ribbon arrangement.

- Refined plugin cards, bottom action rows, filters and small-screen layouts, with configurable feature visibility.
- Toolbar labels default to the current page only, with hover labels enabled. Earlier versions adopt these defaults once on upgrade; later choices remain customizable.
- Shared floating scrollbars preserve toolbar height and support thumb dragging and native touch scrolling.
- A one-time screenshot tour introduces the interface after upgrading. Images are bundled offline; dismissing the tour prevents it from appearing again.

### More improvements

- **Device presets:** Per-type defaults and shared selectors across Plugins, Appearance and Ribbon; default-preset fallback when a selected preset is deleted.
- **Session changes:** Choose session-only or permanent changes without saving temporary overrides into preset baselines.
- **Ribbon:** Legacy-entry migration that preserves order and visibility, improved group selection, order-number controls and phone layouts.
- **Recently installed:** A clock badge beside the version marks plugins installed within the last 7 days. Set the window to **0** to disable it.

Existing publication-date and prerelease policies remain in effect.
