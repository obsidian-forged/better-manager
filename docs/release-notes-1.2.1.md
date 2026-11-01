# 稳定多端配置编辑

**Better Manager 1.2.1** 改进多端同步下的编辑体验，并新增设置搜索。

## 配置更新不打断编辑

- 打开 BPM 时，外部 `data.json` 更新先暂存，保留当前界面、筛选、滚动位置与正在编辑的设置，不主动重绘页面或重新应用外观。
- 短时间内频繁收到外部更新时，显示提醒并暂用本机缓存。本机改动先保存在 `data.json` 同级的独立缓存中，最后一个 BPM 窗口关闭后自动合并回共享配置。
- 合并时保留另一端的独立改动；同一字段存在冲突时，本次编辑的改动优先。写回失败会保留恢复缓存，下次启动继续恢复。
- 外观配置未变化时，跳过重复的主题与 CSS 重载，减少无意义的界面闪动。

缓存按本机标识区分，不采用其他设备的缓存。BPM 不会自动关闭同步工具；如更新仍过于频繁，可按提醒暂时关闭实时同步。

## 设置搜索

- 设置顶栏新增搜索按钮，点击后顶栏切换为输入框。
- 搜索同时覆盖设置项名称和描述，按相关性排序，优先显示名称匹配。
- 支持中文片段、多关键词和常见拼写错误；选择结果后直接定位到原设置项。

## 移动端与界面修复

- 修复 Ribbon 页面设备选择组件重复显示的问题。
- 修复“全部 / 显示 / 隐藏”切换后筛选高亮未同步的问题。
- 手机总览的统计与操作按钮共用一行布局，左对齐并按可用宽度换行。
- 修复窄屏“个性化 BPM”的固定高度、溢出和换行问题。
- 缩小激活筛选标签中的叉号并修正垂直对齐；筛选数量气泡背景改为透明。

## English

### Stable configuration editing across devices

- External `data.json` updates are buffered while BPM is open. The current interface, filters, scroll position and edits remain in place without automatically redrawing pages or reapplying appearance.
- Frequent external updates trigger a notice and a device-specific cache beside `data.json`. Local edits merge back into shared settings when the last BPM window closes.
- Independent remote changes are retained; local edits take precedence for conflicting fields. Failed writes keep the recovery cache for the next startup.
- Unchanged appearance settings skip redundant theme and CSS reloads.

Caches are device-specific. BPM does not disable your sync tool automatically; consider pausing real-time sync if updates remain frequent.

### Settings search and interface fixes

- Search setting names and descriptions from the settings toolbar, with relevance ordering, title priority, CJK fragments, multiple keywords and bounded typo tolerance. Results navigate to the original controls.
- Removed duplicate device selectors in the mobile Ribbon page and synchronized active visibility-filter states.
- Phone overview buttons now share a left-aligned wrapping flow. Personalization controls adapt to narrow settings panels.
- Refined filter-chip close icons and made filter-count badge backgrounds transparent.
