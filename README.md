# WebNovel Assistant

专为网文小说创作设计的 Obsidian 插件 | Obsidian Plugin for Chinese Web Novel Writing

一个功能强大的 Obsidian 插件，专为中文网络小说作者打造，提供字数统计、写作目标追踪、伏笔管理、时间线系统、OBS 直播叠加层等丰富功能。

**关键词**：Obsidian 插件、网文写作、小说创作、字数统计、写作工具、中文写作、创意写作、Markdown 编辑器

[![GitHub release](https://img.shields.io/github/v/release/HatanoChihiro/obsidian-webnovel-assistant)](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/releases)
[![License](https://img.shields.io/github/license/HatanoChihiro/obsidian-webnovel-assistant)](LICENSE)

---

## 📖 文档

- **[用户使用指南](USER_GUIDE.md)** - 完整的功能说明和使用教程
- **[OBS 叠加层 CSS 指南](OBS_OVERLAY_CSS_GUIDE.md)** - 自定义 OBS 样式
- **[更新日志](CHANGELOG.md)** - 版本更新记录

---

## ✨ 核心功能

### 📊 字数统计与目标追踪
- 实时统计字数，适配中文创作平台计算规则
- 章节目标、每日目标，进度可视化
- 文件浏览器显示文件夹字数（高性能缓存）

### ⏱️ 专注时间追踪
- 自动区分专注时间与摸鱼时间
- 历史统计图表（日/周/月/年）
- Worker 线程处理，不影响编辑性能

### 📝 创作辅助工具
- **悬浮便签**：可拖动、多主题、关联文件
- **伏笔管理**：标注、追踪、多章节回收
- **时间线系统**：事件记录、多章节关联、类型分类
- **智能章节排序**：自动识别章节编号排序
- **合并章节**：一键合并文件夹内所有章节

### 🎥 直播功能
- OBS 叠加层：实时显示写作数据
- 自定义样式、透明度、显示内容
- 零延迟、零磁盘消耗

### 📱 移动端支持
- 浮动字数统计窗口
- 触摸优化，防误触
- 复制全文功能（解决移动端全选限制）

### ⚡ 性能优化
- 自适应防抖，CPU 使用率降低 10-20%
- 缓存批量保存，磁盘 I/O 减少 80%+
- 启动速度提升 30%+

---

## 📥 安装

### 方法 1: 使用 BRAT（推荐）
1. 安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件
2. 在 BRAT 设置中添加此仓库：`HatanoChihiro/obsidian-webnovel-assistant`
3. 启用插件

### 方法 2: 手动安装
1. 从 [Releases](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/releases) 下载最新版本
2. 解压到 `.obsidian/plugins/web-novel-assistant/`
3. 重启 Obsidian 并启用插件

---

## 🚀 快速开始

1. **安装插件**后，打开任意 Markdown 文件
2. **状态栏**会显示当前字数统计
3. **点击状态栏**可快速设置目标字数
4. **命令面板**（Ctrl/Cmd + P）搜索 "WebNovel" 查看所有功能
5. **插件设置**中可自定义各项功能

详细使用方法请查看 **[用户使用指南](USER_GUIDE.md)**

---

## 🎯 主要命令

| 命令 | 说明 |
|------|------|
| 打开/关闭写作实时状态面板 | 显示详细统计和历史图表 |
| 打开/关闭伏笔面板 | 管理伏笔标注和回收 |
| 打开/关闭时间线面板 | 管理故事时间线 |
| 开始/暂停 摸鱼时间统计 | 切换时间追踪 |
| 标注为伏笔 | 将选中文字标注为伏笔 |
| 新建空白悬浮便签 | 创建浮动便签 |
| 自动创建下一章 | 智能递增章节编号 |
| 重置直播统计数据 | 清空当前会话数据 |

> **提示**：所有命令都可以在 Obsidian 设置 → 快捷键中自定义快捷键

---

## ⚙️ 主要设置

| 设置 | 默认值 | 说明 |
|------|--------|------|
| 默认目标字数 | 3000 | 新文件的默认章节目标 |
| 每日目标字数 | 5000 | 每日写作目标 |
| 文件浏览器字数统计 | 关闭 | 显示文件夹字数（大型项目建议关闭） |
| 智能章节排序 | 关闭 | 自动按章节编号排序 |
| 护眼模式 | 关闭 | 编辑器背景护眼色 |
| 伏笔文件名 | 伏笔 | 伏笔文件的名称 |
| 时间线文件名 | 时间线 | 时间线文件的名称 |

更多设置请查看 **[用户使用指南](USER_GUIDE.md)**

---

## 🎨 OBS 叠加层快速设置

1. 插件设置 → 启用 **OBS 叠加层**
2. OBS 中添加 **浏览器源**
3. URL 填入：`http://127.0.0.1:24816/`
4. 建议尺寸：宽度 800px，高度 600px

详细自定义方法请查看 **[OBS 叠加层 CSS 指南](OBS_OVERLAY_CSS_GUIDE.md)**

---

## 📄 许可证

[MIT License](LICENSE)

---

## 💖 支持项目

如果这个插件对你有帮助，欢迎：
- ⭐ 给项目点个 Star
- 🐛 [提交问题](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/issues)
- 💡 [功能建议](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/discussions)

---

**祝你写作愉快！** ✍️

---

## 🔍 搜索关键词

Obsidian 插件、Obsidian plugin、网文写作、网络小说、小说创作工具、中文写作、字数统计、word count、写作目标、writing goals、伏笔管理、时间线、timeline、OBS 叠加层、直播写作、creative writing、markdown editor、productivity tool、作家工具、novelist tool、中文网文、起点、晋江、番茄小说

