# OBS 叠加层 CSS 自定义指南

本指南帮助你通过自定义 CSS 来个性化 OBS 直播叠加层的外观。

---

## 📋 目录

- [快速开始](#快速开始)
- [可用的 CSS 类名](#可用的-css-类名)
- [常见自定义示例](#常见自定义示例)
- [高级技巧](#高级技巧)

---

## 快速开始

1. 在插件设置中找到「OBS 叠加层」部分
2. 滚动到「自定义 CSS」输入框
3. 输入你的 CSS 代码
4. 保存设置后，OBS 浏览器源会自动刷新

---

## 可用的 CSS 类名

### 容器和布局

| 类名 | 说明 | 默认样式 |
|------|------|----------|
| `.overlay-card` | 叠加层外壳容器 | 宽度 280px，圆角 12px，半透明背景 |
| `.overlay-header` | 顶部标题区域 | 包含标题和状态指示灯 |
| `.overlay-title` | 标题文字 | 字体大小 1.1em，加粗 |
| `.status-dot` | 状态指示灯 | 圆形，8px 直径 |
| `.status-dot.active` | 记录中状态 | 绿色，呼吸动画 |
| `.status-dot.paused` | 已暂停状态 | 灰色 |

### 时间统计

| 类名 | 说明 | 默认样式 |
|------|------|----------|
| `.time-section` | 时间统计区域容器 | 包含所有时间显示 |
| `.time-row` | 单行时间显示 | 左右布局，标签+数值 |
| `.time-label` | 时间标签文字 | 如"总计"、"专注"、"摸鱼" |
| `.time-value` | 时间数值 | 等宽字体，加粗 |
| `.time-value.focus` | 专注时间数值 | 绿色 |
| `.time-value.slack` | 摸鱼时间数值 | 橙色 |

### 目标进度

| 类名 | 说明 | 默认样式 |
|------|------|----------|
| `.goal-section` | 目标进度区域容器 | 包含进度条和数值 |
| `.goal-label` | 目标标签文字 | 如"章节目标"、"当日目标" |
| `.goal-value` | 目标数值容器 | 包含当前值、分隔符、目标值、百分比 |
| `.current-val` | 当前已写字数 | 大字号，加粗 |
| `.target-val` | 目标总字数 | 中等字号，半透明 |
| `.sep` | 分隔符 `/` | 半透明 |
| `.percent` | 百分比文字 | 强调色 |
| `.goal-value.done` | 目标达成状态 | 当百分比 ≥ 100% 时应用 |
| `.progress-bg` | 进度条背景槽 | 灰色，圆角 |
| `.progress-fill` | 进度条填充 | 强调色，过渡动画 |
| `.progress-fill.done` | 进度条达成状态 | 绿色 |

### 本场净增

| 类名 | 说明 | 默认样式 |
|------|------|----------|
| `.session-row` | 本场净增行容器 | 左右布局 |
| `.session-label` | "本场净增"标签 | 小字号 |
| `.session-value` | 净增字数数值 | 等宽字体，加粗 |

---

## 常见自定义示例

### 1. 修改卡片尺寸和圆角

```css
/* 加宽卡片 */
.overlay-card {
  width: 350px;
}

/* 更圆的圆角 */
.overlay-card {
  border-radius: 20px;
}

/* 方形卡片 */
.overlay-card {
  border-radius: 0;
}
```

### 2. 修改字体

```css
/* 使用自定义字体 */
.overlay-card {
  font-family: "Microsoft YaHei", "微软雅黑", sans-serif;
}

/* 加大所有字号 */
.overlay-card {
  font-size: 1.1em;
}

/* 只加大时间数值字号 */
.time-value {
  font-size: 1.5em;
}
```

### 3. 修改颜色主题

```css
/* 深色主题 */
.overlay-card {
  background: rgba(20, 20, 30, 0.95);
  color: #e0e0e0;
}

/* 浅色主题 */
.overlay-card {
  background: rgba(255, 255, 255, 0.95);
  color: #333;
}

/* 自定义强调色 */
.status-dot.active,
.progress-fill {
  background: #ff6b6b; /* 红色 */
}

.time-value.focus {
  color: #51cf66; /* 绿色 */
}

.time-value.slack {
  color: #ffd43b; /* 黄色 */
}
```

### 4. 添加边框和阴影

```css
/* 添加边框 */
.overlay-card {
  border: 2px solid rgba(255, 255, 255, 0.3);
}

/* 加强阴影 */
.overlay-card {
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

/* 发光效果 */
.overlay-card {
  box-shadow: 0 0 20px rgba(100, 200, 255, 0.5);
}
```

### 5. 修改进度条样式

```css
/* 更粗的进度条 */
.progress-bg {
  height: 12px;
}

/* 方形进度条 */
.progress-bg,
.progress-fill {
  border-radius: 0;
}

/* 渐变进度条 */
.progress-fill {
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
}

/* 达成时的特殊效果 */
.progress-fill.done {
  background: linear-gradient(90deg, #56ab2f 0%, #a8e063 100%);
  box-shadow: 0 0 10px rgba(86, 171, 47, 0.5);
}
```

### 6. 隐藏特定元素

```css
/* 隐藏状态指示灯 */
.status-dot {
  display: none;
}

/* 隐藏标题 */
.overlay-title {
  display: none;
}

/* 隐藏摸鱼时间 */
.time-row:has(.time-value.slack) {
  display: none;
}

/* 隐藏百分比 */
.percent {
  display: none;
}
```

### 7. 调整间距和布局

```css
/* 增加内边距 */
.overlay-card {
  padding: 24px;
}

/* 增加各区域间距 */
.time-section,
.goal-section,
.session-row {
  margin-bottom: 20px;
}

/* 紧凑布局 */
.time-row {
  margin-bottom: 4px;
}
```

### 8. 添加动画效果

```css
/* 数值变化时的闪烁效果 */
.time-value,
.session-value {
  transition: all 0.3s ease;
}

/* 进度条填充动画 */
.progress-fill {
  transition: width 0.5s ease-out;
}

/* 卡片悬停效果（虽然在 OBS 中不会触发，但可以用于测试） */
.overlay-card:hover {
  transform: scale(1.02);
  transition: transform 0.2s ease;
}
```

### 9. 毛玻璃效果增强

```css
/* 更强的毛玻璃效果 */
.overlay-card {
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
}

/* 完全透明背景 + 毛玻璃 */
.overlay-card {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(30px);
}
```

### 10. 极简风格

```css
/* 移除所有装饰 */
.overlay-card {
  background: transparent;
  box-shadow: none;
  border: none;
}

/* 只显示关键数据 */
.overlay-title,
.time-label,
.goal-label {
  display: none;
}

/* 大号数值 */
.time-value,
.session-value {
  font-size: 2em;
  font-weight: bold;
}
```

---

## 高级技巧

### 使用 CSS 变量

你可以定义变量来统一管理颜色：

```css
.overlay-card {
  --primary-color: #667eea;
  --success-color: #51cf66;
  --warning-color: #ffd43b;
  --text-color: #ffffff;
}

.status-dot.active {
  background: var(--success-color);
}

.progress-fill {
  background: var(--primary-color);
}

.time-value.slack {
  color: var(--warning-color);
}
```

### 响应式设计

虽然 OBS 浏览器源尺寸固定，但你可以为不同尺寸准备样式：

```css
/* 小尺寸布局 */
@media (max-width: 300px) {
  .overlay-card {
    padding: 12px;
    font-size: 0.9em;
  }
}
```

### 使用伪元素添加装饰

```css
/* 在标题前添加图标 */
.overlay-title::before {
  content: "📝 ";
}

/* 在进度条上添加刻度 */
.progress-bg::after {
  content: "";
  position: absolute;
  top: 0;
  left: 50%;
  width: 2px;
  height: 100%;
  background: rgba(255, 255, 255, 0.3);
}
```

### 条件样式

```css
/* 当专注时间超过 1 小时时高亮 */
.time-value.focus[data-minutes="60"] {
  color: #ffd700;
  font-size: 1.2em;
}

/* 目标达成时的庆祝效果 */
.goal-value.done {
  animation: celebrate 0.5s ease;
}

@keyframes celebrate {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}
```

---

## 💡 调试技巧

1. **在浏览器中测试**：先在普通浏览器中打开 `http://127.0.0.1:24816/` 测试 CSS
2. **使用浏览器开发者工具**：按 F12 打开开发者工具，实时调试样式
3. **OBS 浏览器源刷新**：修改 CSS 后，在 OBS 中右键浏览器源 → 刷新
4. **保存常用样式**：将满意的 CSS 保存到文本文件中备用

---

## 📚 参考资源

- [CSS 颜色参考](https://developer.mozilla.org/zh-CN/docs/Web/CSS/color_value)
- [CSS 渐变生成器](https://cssgradient.io/)
- [CSS 动画参考](https://developer.mozilla.org/zh-CN/docs/Web/CSS/animation)
- [毛玻璃效果生成器](https://glassmorphism.com/)

---

## ❓ 常见问题

**Q: 为什么我的 CSS 没有生效？**
A: 检查 CSS 语法是否正确，确保选择器拼写无误，在 OBS 中刷新浏览器源。

**Q: 可以完全隐藏背景吗？**
A: 可以，设置 `background: transparent;` 并将透明度滑块调到 0。

**Q: 如何让文字更清晰？**
A: 添加文字阴影：`text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);`

**Q: 可以使用自定义字体吗？**
A: 可以，但需要确保 OBS 浏览器源所在系统已安装该字体。

---

如果你创建了很酷的样式，欢迎分享！🎨
