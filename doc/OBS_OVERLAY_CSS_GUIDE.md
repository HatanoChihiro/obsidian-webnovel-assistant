# OBS 叠加层 CSS 自定义指南

本指南适用于桌面端 OBS 浏览器源。插件在本机提供统计页面；这套 CSS 与 Obsidian 主题、CSS 代码片段分别生效。英文版见 [English Guide](OBS_OVERLAY_CSS_GUIDE_EN.md)。

## 目录

- [连接与刷新](#连接与刷新)
- [可用选择器](#可用选择器)
- [可直接使用的示例](#可直接使用的示例)
- [自定义 CSS 的限制](#自定义-css-的限制)
- [常见问题](#常见问题)

## 连接与刷新

1. 在 **设置 → WebNovel Assistant → 数据输出 → OBS 数据叠加层** 开启 **启用数据叠加层 (OBS/直播)**，默认端口为 `24816`。开启即启动服务，无需重载插件；修改端口后服务自动重启。
2. 点击 **复制 URL**，在同一台电脑的 OBS 中添加浏览器源并粘贴，默认地址为 `http://127.0.0.1:24816/`。
3. 可先将浏览器源设为 **400×700px**，再根据启用的数据项调整。默认卡片宽 280px，另有 1.1 倍缩放，浏览器源太窄或太矮可能裁切内容。
4. 在插件设置中选择主题、背景透明度和显示项目；将下面需要的样式粘贴到 **自定义 CSS**。示例彼此独立，同一属性重复配置时后面的规则生效。
5. 修改 CSS、主题或显示开关后，**手动刷新 OBS 浏览器源**。统计值会自动更新，页面结构与样式不会因此自动重载。

页面通过本机 `/api/stats` 获取数据，每次请求完成后约 500ms 再次更新。服务仅监听 `127.0.0.1`，OBS 与 Obsidian 需在同一台电脑上；关闭 Obsidian 或关闭叠加层后数据停止更新。

## 可用选择器

关闭某项显示后，对应节点不会出现在页面中；CSS 不能显示未生成的统计项，请先打开对应设置。

| 选择器 | 用途 |
|---|---|
| `.overlay-card` | 卡片外壳，默认宽 280px、圆角 14px、内边距 20px 24px |
| `.overlay-title` | 顶部状态指示区域，当前没有标题文字 |
| `.status-dot`、`.status-dot.active`、`.status-dot.paused` | 12px 状态灯、记录中、已暂停 |
| `.time-row` | 时间统计区域，包含各个 `.time-item` |
| `.time-item`、`.time-label`、`.time-value` | 单项时间、标签与数值 |
| `.time-value.focus`、`.time-value.slack` | 专注与摸鱼时间数值 |
| `#totalTime`、`#focusTime`、`#slackTime` | 单独选择总时长、专注时长或摸鱼时长 |
| `.divider` | 时间区下方分隔线 |
| `.goal-row`、`.goal-label`、`.goal-value` | 章节或今日目标行、标签与数值组 |
| `.current-val`、`.target-val`、`.sep`、`.percent` | 当前字数、目标字数、斜线与百分比 |
| `#todayWords`、`#goalValue`、`#percentText` | 当前章节字数、章节目标与百分比；todayWords 实际对应当前章节 |
| `#dailyWords`、`#dailyGoalValue`、`#dailyPercentText` | 今日净增、今日目标与百分比 |
| `.progress-bg`、`.progress-fill`、`.progress-fill.done` | 进度槽、进度条与达标状态 |
| `#progressFill`、`#dailyProgressFill` | 章节与今日进度条 |
| `.session-row`、`.session-row .val` | 本场统计行与数值 |
| `#sessionWords`、`#sessionSpeed` | 本场净增与本场时速（时速默认不显示） |

## 可直接使用的示例

### 调整卡片与字号

```css
.overlay-card {
  width: 340px;
  border-radius: 18px;
  padding: 18px;
  font-family: "Microsoft YaHei", sans-serif;
}
.time-value {
  font-size: 28px;
}
.goal-value .current-val {
  font-size: 30px;
}
```

### 设置颜色与边框

```css
.overlay-card {
  background: rgba(20, 24, 32, 0.9);
  color: #eeeeee;
  border: 1px solid #667788;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
}
.time-label,
.session-row .val {
  color: #eeeeee;
}
.time-value.focus {
  color: #8cc7ff;
}
.time-value.slack {
  color: #ffc078;
}
.progress-fill {
  background: linear-gradient(90deg, #667eea, #90b5ff);
}
.progress-fill.done {
  background: #76c893;
}
```

### 紧凑显示

```css
.overlay-card {
  padding: 12px;
  gap: 4px;
}
.time-row {
  gap: 6px;
}
.time-value {
  font-size: 20px;
}
.percent,
.divider {
  display: none;
}
```

优先在插件设置中隐藏整项统计。上例隐藏百分比与分隔线，不会改变统计数据。

### 透明背景

```css
.overlay-card {
  background: transparent;
  border: none;
  box-shadow: none;
}
```

同时将插件的 **背景透明度** 调到 `0`，以移除默认毛玻璃背景效果。保留文字与进度条，便于叠加到直播画面上。

## 自定义 CSS 的限制

插件的输入框会过滤 CSS，不等同于完整的样式表编辑器：

- 使用上例的简单类名或 ID 选择器，每条属性单独占一行。
- 常用支持项包括颜色、背景、字体大小、字体族、宽高、整体 `margin` / `padding`、边框、圆角、阴影、显示、Flex/Grid 及 `gap`。
- 当前过滤器会移除 CSS 自定义属性定义（`--变量`）、`content`、`text-shadow`、`backdrop-filter`、`padding-top` 等未列入允许范围的属性。含冒号的伪类选择器和部分高级规则也可能被过滤；不要直接将复杂主题 CSS 粘贴到此处。
- 不支持通过 `@import` 导入外部样式，也不能添加 HTML 或脚本。自行使用远程图片或字体 URL 时，浏览器源可能访问对应地址；使用本机已安装字体无需此类请求。
- 不要固定进度条的 `width`：它由实时统计更新。达标样式使用 `.progress-fill.done`；页面没有 `data-minutes` 属性或 `.goal-value.done` 状态，不能用它们判断时长与达标。

## 常见问题

**Q: 样式修改后没有变化？**

A: 先刷新浏览器源；确认样式写在插件的 **自定义 CSS** 中、选择器对应当前已启用的节点，再检查属性是否被上述过滤器移除。可在同机普通浏览器中打开 URL，用开发者工具检查实际页面。

**Q: 统计显示不再更新？**

A: 确认 Obsidian 正在运行、叠加层已开启、端口与浏览器源 URL 一致。修改端口后要同时更新 OBS 地址；端口占用时在插件设置中更换。

**Q: 卡片显示不全？**

A: 增大浏览器源宽高，检查自定义卡片尺寸。默认 280px 卡片还会进行 1.1 倍缩放；显示项目越多，需要的高度越大。

**Q: 可以用于另一台电脑上的 OBS 吗？**

A: 当前服务仅监听本机回环地址，另一台电脑无法直接连接。本文的配置适用于同机使用。

返回 [用户指南](USER_GUIDE.md#obs-叠加层) · [README](../README.md)
