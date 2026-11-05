# 大幅度改进界面

## 开放 Preview 功能

- **插件商店 (Preview)**：浏览官方目录与独立插件源，查看插件详情和历史版本，并按来源安装。支持更新排除、兼容性检查和来源替换确认。
- **版本回退与还原点 (Preview)**：保留旧构建、创建命名还原点，并预览配置结构合并。回退时恢复原来源绑定；无法确定来源的早期还原点需要重新绑定。
- 商店和旧版本保留可在基础配置中开启，开启控件及相关入口显示 **Preview**。旧版本备份默认关闭。
- 回退默认保留当前配置；可选配置合并依据还原点中的实际结构，无法逆转插件的任意配置迁移或外部文件格式变化。

## 设置与移动端

- “Better Manager 设置”加入齿轮图标，分类导航显示“切换设置”标签与当前分类图标；切换分类时同步 Obsidian 页面标题。
- 设置分类入口使用固定功能说明，搜索覆盖设置项名称与描述。
- 管理器设置入口移入“更多”；关闭手动保存后，“保存更改”保留在“更多”中作为即时保存入口。
- 统一手机端保存、更多和关闭按钮尺寸；统计、来源与外观导航使用整行下拉菜单，设置分类、搜索与保存紧凑排布。
- Ribbon 状态筛选复用多选菜单，支持显示、隐藏及插件被禁用的组合筛选；全部选中时归为“全部”。
- 手机端 Ribbon 状态和分组菜单并排，搜索框使用筛选区域的完整宽度；数量与展开箭头分别显示。
- 修复手机端“保留插件旧版本”设置的正文和 Preview 标签被长按钮挤压的问题。
- 修复窄宽度下搜索、设备和生效方式控件重叠，以及筛选栏强制等分造成的挤压。

## 配置冲突与安装可靠性

- 配置冲突改为独立窗口，保留分项来源选择；底部带“全部配置”标签的“本机版本／远端版本”按钮可一次应用并保存该来源的全部配置与相关文件，并与“保存更改”同排使用满圆角样式。冲突感叹号集中在通知区域，功能菜单保留差异文字提示。
- 确认期间收到新冲突版本时，旧选择会被拒绝，保留配置供重新选择；重复点击不会重复保存。
- 历史版本信息获取失败时显示具体错误原因，包括 HTTP 状态。
- 加强商店安装及版本回退时的来源、文件和配置一致性检查。
- 阻止通过插件安装入口覆盖 Better Manager 自身；管理器更新请使用 Obsidian 的原生更新入口。

---

# Major interface improvements

## Preview features

- **Plugin store (Preview)**: browse official and independent sources, inspect plugin details and historical releases, and install from the selected source. Update exclusions, compatibility checks and source replacement confirmation apply.
- **Version rollback and restore points (Preview)**: retain previous builds, create named restore points, and preview structural settings merges. Restores recover the original source binding; older points with unknown provenance require rebinding.
- Enable the store and previous-build retention in basic settings. Their controls and entry points display **Preview**. Build backups remain off by default.
- Restores keep current settings by default. Optional settings merges use the structure captured in a restore point and cannot reverse arbitrary plugin migrations or external file format changes.

## Settings and mobile layouts

- Better Manager settings includes a gear icon and a labelled category selector. Changing categories updates Obsidian's native page title.
- Category descriptions explain their purpose; settings search covers names and descriptions.
- Manager settings moves into More. When manual saving is disabled, Save changes remains available in More.
- Save, More and Close share consistent mobile dimensions. Statistics, sources and appearance use full-row dropdowns; settings categories, Search and Save share a compact layout.
- Ribbon status filters share the multi-select component. Visible, hidden and disabled-plugin states can be combined; selecting every state returns to All.
- Mobile Ribbon status and group menus share a row, with search filling the filter area's width. Counts and disclosure arrows remain separately visible.
- Fix the previous-build retention setting's description and Preview label being squeezed by its long action button on mobile.
- Fix overlapping search, device and application-mode controls and cramped filter columns in narrow layouts.

## Configuration conflicts and installation reliability

- Configuration conflicts use a separate dialog with individual source choices. Footer buttons marked All settings apply and save the Local version or Remote version for every configuration section and related file in one action. They share a row and fully rounded styling with Save changes. Conflict warning icons stay in the notification area; feature menus retain text indicators for differences.
- A newer conflict invalidates an older confirmation while preserving the configurations for review. Repeated clicks do not duplicate saves.
- Historical release metadata failures display their error reason, including HTTP status.
- Strengthen source, file and configuration consistency checks during store installations and version restores.
- Prevent plugin installation paths from replacing Better Manager itself. Use Obsidian's native update controls for manager updates.
