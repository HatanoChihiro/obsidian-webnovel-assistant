# OBS 叠加层 CSS 样式完整清单

本文档提供了 OBS 叠加层的完整 CSS 类名和可自定义样式属性清单，方便用户通过"自定义 CSS"功能进行个性化定制。

---

## 📋 目录

1. [整体布局](#整体布局)
2. [卡片容器](#卡片容器)
3. [标题区域](#标题区域)
4. [状态指示器](#状态指示器)
5. [时间显示区域](#时间显示区域)
6. [目标进度区域](#目标进度区域)
7. [进度条](#进度条)
8. [本场净增](#本场净增)
9. [分隔线](#分隔线)
10. [动画效果](#动画效果)
11. [常用自定义示例](#常用自定义示例)

---

## 整体布局

### `body`
页面主体容器

**默认样式：**
```css
body {
    background: transparent;
    font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    color: #E8E8E8; /* 深色主题 */ 或 #2C3E50; /* 浅色主题 */
    margin: 0;
    padding: 0;
    display: flex;
    justify-content: flex-start;
    align-items: flex-start;
}
```

**可自定义属性：**
- `background`: 背景颜色（默认透明）
- `font-family`: 全局字体
- `color`: 全局文字颜色
- `justify-content`: 水平对齐方式（flex-start/center/flex-end）
- `align-items`: 垂直对齐方式（flex-start/center/flex-end）

**示例：**
```css
/* 居中显示叠加层 */
body {
    justify-content: center;
    align-items: center;
}

/* 使用自定义字体 */
body {
    font-family: 'Arial', 'SimHei', sans-serif;
}
```

---

## 卡片容器

### `.overlay-card`
叠加层主卡片容器

**默认样式：**
```css
.overlay-card {
    background: rgba(20, 20, 30, 0.85); /* 深色主题 */
    border-radius: 14px;
    padding: 20px 24px;
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.08);
    transition: all 0.3s ease;
    width: 280px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    zoom: 1.1;
}
```

**可自定义属性：**
- `background`: 背景颜色（支持 rgba）
- `border-radius`: 圆角大小
- `padding`: 内边距
- `backdrop-filter`: 背景模糊效果
- `border`: 边框样式
- `width`: 卡片宽度
- `gap`: 子元素间距
- `zoom`: 整体缩放比例
- `box-shadow`: 阴影效果

**示例：**
```css
/* 更宽的卡片 */
.overlay-card {
    width: 350px;
}

/* 添加阴影 */
.overlay-card {
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

/* 完全不透明 */
.overlay-card {
    background: rgba(20, 20, 30, 1);
}

/* 更大的圆角 */
.overlay-card {
    border-radius: 20px;
}
```

---

## 标题区域

### `.overlay-title`
标题容器

**默认样式：**
```css
.overlay-title {
    font-size: 14px;
    font-weight: 700;
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
}
```

**可自定义属性：**
- `font-size`: 字体大小
- `font-weight`: 字体粗细
- `margin-bottom`: 下边距
- `gap`: 与状态点的间距
- `color`: 文字颜色
- `text-align`: 文字对齐

**示例：**
```css
/* 更大的标题 */
.overlay-title {
    font-size: 18px;
}

/* 居中标题 */
.overlay-title {
    justify-content: center;
}
```

---

## 状态指示器

### `.status-dot`
状态指示圆点

**默认样式：**
```css
.status-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: inline-block;
}
```

### `.status-dot.active`
追踪中状态（绿色，带脉冲动画）

**默认样式：**
```css
.status-dot.active {
    background: #4CAF50;
    animation: pulse 1.5s ease-in-out infinite;
}
```

### `.status-dot.paused`
暂停状态（灰色）

**默认样式：**
```css
.status-dot.paused {
    background: #888;
}
```

**可自定义属性：**
- `width` / `height`: 圆点大小
- `background`: 背景颜色
- `border`: 边框样式
- `box-shadow`: 阴影效果

**示例：**
```css
/* 更大的状态点 */
.status-dot {
    width: 16px;
    height: 16px;
}

/* 自定义颜色 */
.status-dot.active {
    background: #00FF00;
}

.status-dot.paused {
    background: #FF0000;
}

/* 添加发光效果 */
.status-dot.active {
    box-shadow: 0 0 10px #4CAF50;
}
```

---

## 时间显示区域

### `.time-row`
时间行容器

**默认样式：**
```css
.time-row {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 6px;
}
```

### `.time-item`
单个时间项容器

**默认样式：**
```css
.time-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
}
```

### `.time-label`
时间标签（如"总计时长"）

**默认样式：**
```css
.time-label {
    font-size: 16px;
    color: #E8E8E8;
    opacity: 0.9;
}
```

### `.time-value`
时间数值

**默认样式：**
```css
.time-value {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: 1px;
}
```

### `.time-value.focus`
专注时长（蓝色）

**默认样式：**
```css
.time-value.focus {
    color: #6C9EFF;
}
```

### `.time-value.slack`
摸鱼时长（红色）

**默认样式：**
```css
.time-value.slack {
    color: #E74C3C;
}
```

**可自定义属性：**
- `font-size`: 字体大小
- `font-family`: 字体（建议使用等宽字体）
- `font-weight`: 字体粗细
- `color`: 文字颜色
- `letter-spacing`: 字符间距
- `text-align`: 对齐方式

**示例：**
```css
/* 更大的时间数字 */
.time-value {
    font-size: 32px;
}

/* 自定义专注时长颜色 */
.time-value.focus {
    color: #00FF00;
}

/* 横向排列时间 */
.time-row {
    flex-direction: row;
    justify-content: space-around;
}

/* 更小的标签 */
.time-label {
    font-size: 12px;
}
```

---

## 目标进度区域

### `.goal-row`
目标进度行容器

**默认样式：**
```css
.goal-row {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    width: 100%;
    margin-bottom: 4px;
    gap: 2px;
}
```

### `.goal-label`
目标标签（"目标进度"）

**默认样式：**
```css
.goal-label {
    font-size: 16px;
    color: #E8E8E8;
    opacity: 0.9;
}
```

### `.goal-value`
目标数值容器

**默认样式：**
```css
.goal-value {
    display: flex;
    justify-content: flex-end;
    align-items: baseline;
    text-align: right;
    width: 100%;
    gap: 4px;
}
```

### `.goal-value .current-val`
当前字数

**默认样式：**
```css
.goal-value .current-val {
    font-size: 24px;
    font-weight: 700;
    color: inherit;
}
```

### `.goal-value .sep`
分隔符（"/"）

**默认样式：**
```css
.goal-value .sep {
    opacity: 0.5;
    margin: 0 2px;
}
```

### `.goal-value .target-val`
目标字数

**默认样式：**
```css
.goal-value .target-val {
    font-size: 20px;
    opacity: 0.8;
}
```

### `.goal-value .percent`
百分比

**默认样式：**
```css
.goal-value .percent {
    font-size: 13px;
    color: #6C9EFF;
    margin-left: 6px;
}
```

### `.goal-value.done`
目标达成状态

**默认样式：**
```css
.goal-value.done .current-val {
    color: #E74C3C !important;
}
```

**可自定义属性：**
- `font-size`: 字体大小
- `color`: 文字颜色
- `font-weight`: 字体粗细
- `align-items`: 对齐方式

**示例：**
```css
/* 更大的当前字数 */
.goal-value .current-val {
    font-size: 32px;
}

/* 目标达成时显示为绿色 */
.goal-value.done .current-val {
    color: #4CAF50 !important;
}

/* 左对齐目标进度 */
.goal-row {
    align-items: flex-start;
}

.goal-value {
    justify-content: flex-start;
}

/* 隐藏百分比 */
.goal-value .percent {
    display: none;
}
```

---

## 进度条

### `.progress-bg`
进度条背景

**默认样式：**
```css
.progress-bg {
    width: 100%;
    height: 6px;
    background: rgba(255,255,255,0.08);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 10px;
}
```

### `.progress-fill`
进度条填充

**默认样式：**
```css
.progress-fill {
    height: 100%;
    border-radius: 3px;
    background: #6C9EFF;
    transition: width 0.8s ease, background-color 0.5s ease;
}
```

### `.progress-fill.done`
进度条达成状态（绿色）

**默认样式：**
```css
.progress-fill.done {
    background: #4CAF50;
}
```

**可自定义属性：**
- `height`: 进度条高度
- `background`: 背景颜色
- `border-radius`: 圆角大小
- `transition`: 动画过渡效果

**示例：**
```css
/* 更粗的进度条 */
.progress-bg {
    height: 10px;
}

/* 渐变色进度条 */
.progress-fill {
    background: linear-gradient(90deg, #6C9EFF, #4CAF50);
}

/* 达成时显示为金色 */
.progress-fill.done {
    background: #FFD700;
}

/* 方形进度条 */
.progress-bg {
    border-radius: 0;
}

.progress-fill {
    border-radius: 0;
}
```

---

## 本场净增

### `.session-row`
本场净增行容器

**默认样式：**
```css
.session-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
}
```

### `.session-row .val`
本场净增数值

**默认样式：**
```css
.session-row .val {
    text-align: right;
    font-family: 'Consolas', monospace;
    font-weight: 600;
    color: #E8E8E8;
    opacity: 1;
}
```

**可自定义属性：**
- `font-size`: 字体大小
- `font-family`: 字体
- `color`: 文字颜色
- `font-weight`: 字体粗细

**示例：**
```css
/* 更大的本场净增数字 */
.session-row .val {
    font-size: 24px;
}

/* 高亮显示 */
.session-row .val {
    color: #FFD700;
    font-weight: 700;
}
```

---

## 分隔线

### `.divider`
分隔线

**默认样式：**
```css
.divider {
    height: 1px;
    background: rgba(255,255,255,0.06);
    margin: 4px 0;
}
```

**可自定义属性：**
- `height`: 线条粗细
- `background`: 颜色
- `margin`: 上下边距
- `border-radius`: 圆角（用于虚线效果）

**示例：**
```css
/* 更粗的分隔线 */
.divider {
    height: 2px;
}

/* 彩色分隔线 */
.divider {
    background: linear-gradient(90deg, #6C9EFF, #4CAF50);
}

/* 虚线效果 */
.divider {
    height: 0;
    border-top: 1px dashed rgba(255,255,255,0.2);
}

/* 隐藏分隔线 */
.divider {
    display: none;
}
```

---

## 动画效果

### `@keyframes pulse`
脉冲动画（用于状态点）

**默认样式：**
```css
@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
}
```

**可自定义属性：**
- 修改透明度变化范围
- 添加缩放效果
- 添加颜色变化

**示例：**
```css
/* 带缩放的脉冲 */
@keyframes pulse {
    0%, 100% {
        opacity: 1;
        transform: scale(1);
    }
    50% {
        opacity: 0.5;
        transform: scale(1.2);
    }
}

/* 颜色渐变脉冲 */
@keyframes pulse {
    0%, 100% {
        background: #4CAF50;
    }
    50% {
        background: #81C784;
    }
}
```

---

## 常用自定义示例

### 示例 1：极简风格
```css
/* 移除所有装饰 */
.overlay-card {
    background: rgba(0, 0, 0, 0.8);
    border: none;
    backdrop-filter: none;
    border-radius: 0;
}

.divider {
    display: none;
}

.status-dot {
    display: none;
}
```

### 示例 2：霓虹风格
```css
.overlay-card {
    background: rgba(10, 10, 20, 0.95);
    border: 2px solid #00FFFF;
    box-shadow: 0 0 20px rgba(0, 255, 255, 0.5);
}

.time-value {
    color: #00FFFF;
    text-shadow: 0 0 10px #00FFFF;
}

.progress-fill {
    background: linear-gradient(90deg, #FF00FF, #00FFFF);
    box-shadow: 0 0 10px #00FFFF;
}
```

### 示例 3：游戏风格
```css
.overlay-card {
    background: rgba(20, 20, 30, 0.95);
    border: 3px solid #FFD700;
    border-radius: 8px;
    font-family: 'Arial Black', sans-serif;
}

.time-value {
    color: #FFD700;
    font-size: 28px;
    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
}

.progress-fill {
    background: linear-gradient(90deg, #FF4500, #FFD700);
    height: 100%;
}
```

### 示例 4：毛玻璃效果
```css
.overlay-card {
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
```

### 示例 5：紧凑布局
```css
.overlay-card {
    width: 200px;
    padding: 12px 16px;
    gap: 4px;
    zoom: 1;
}

.time-label {
    font-size: 12px;
}

.time-value {
    font-size: 18px;
}

.goal-value .current-val {
    font-size: 18px;
}
```

### 示例 6：大字号直播风格
```css
.overlay-card {
    width: 400px;
    padding: 30px 40px;
    zoom: 1.3;
}

.time-value {
    font-size: 36px;
}

.goal-value .current-val {
    font-size: 40px;
}

.time-label {
    font-size: 20px;
}
```

### 示例 7：隐藏特定元素
```css
/* 只显示今日字数和进度条 */
.time-row {
    display: none;
}

.session-row {
    display: none;
}

.overlay-title {
    display: none;
}
```

### 示例 8：垂直居中布局
```css
body {
    justify-content: center;
    align-items: center;
    height: 100vh;
}

.overlay-card {
    margin: auto;
}
```

---

## 📝 使用方法

1. 打开插件设置
2. 找到"OBS 叠加层设置"部分
3. 在"自定义 CSS"文本框中粘贴你的 CSS 代码
4. 保存设置
5. 刷新 OBS 浏览器源（右键 → 刷新）

---

## ⚠️ 注意事项

1. **使用 `!important`**：如果你的样式没有生效，可以在属性后添加 `!important`
   ```css
   .time-value {
       color: #FF0000 !important;
   }
   ```

2. **颜色格式**：支持多种颜色格式
   - 十六进制：`#FF0000`
   - RGB：`rgb(255, 0, 0)`
   - RGBA（带透明度）：`rgba(255, 0, 0, 0.8)`

3. **字体**：确保使用的字体在系统中已安装，或使用通用字体族
   ```css
   font-family: 'Arial', 'Microsoft YaHei', sans-serif;
   ```

4. **测试**：修改 CSS 后记得在 OBS 中刷新浏览器源查看效果

5. **备份**：在大幅修改前，建议先备份原有的自定义 CSS

---

## 🎨 CSS 选择器优先级

从低到高：
1. 元素选择器：`.time-value`
2. 类组合：`.time-value.focus`
3. 带 `!important`：`.time-value { color: red !important; }`

如果样式不生效，尝试提高选择器优先级或使用 `!important`。

---

## 📚 相关资源

- [CSS 教程 - MDN](https://developer.mozilla.org/zh-CN/docs/Web/CSS)
- [CSS 颜色工具](https://www.w3schools.com/colors/colors_picker.asp)
- [Google Fonts](https://fonts.google.com/) - 免费字体资源

---

**版本：** 1.1.0  
**最后更新：** 2026-04-18
