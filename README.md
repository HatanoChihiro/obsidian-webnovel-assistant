<a id="中文"></a>

<div align="center">

# ✍️ WebNovel Assistant

**[English](#english)** | **中文**

[![GitHub release](https://img.shields.io/github/v/release/HatanoChihiro/obsidian-webnovel-assistant?label=release&color=brightgreen)](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/releases)
[![License](https://img.shields.io/github/license/HatanoChihiro/obsidian-webnovel-assistant?color=blue)](LICENSE)
[![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=8b5cf6&label=downloads&query=%24%5B%223.2.0%22%5D&url=https%3A%2F%2Fraw.githubusercontent.com%2FHatanoChihiro%2Fobsidian-webnovel-assistant%2Fmain%2Fversions.json)](https://obsidian.md/plugins?id=web-novel-assistant)

为网络小说与故事创作者打造的 Obsidian 一站式写作套件。<br />
精准字数统计与目标追踪 · 故事时间线看板 · 伏笔回收管理 · 章节概览看板 · 设定图谱与专注打字模式。

<br />

<a href="doc/USER_GUIDE.md"><kbd>📖 使用指南</kbd></a>
<a href="doc/OBS_OVERLAY_CSS_GUIDE.md"><kbd>🎥 OBS CSS 指南</kbd></a>
<a href="doc/CHANGELOG.md"><kbd>📋 更新日志</kbd></a>

<br />

<details>
<summary><kbd>💖 支持项目 · 请作者喝杯咖啡</kbd></summary>

<br />

如果这个插件对你的码字事业有所帮助，欢迎支持作者，你的支持是我持续更新的最大动力！

<img width="500" alt="赞赏码" src="assets/donate.png" />

</details>

<br />

<img width="100%" alt="homepage" src="assets/homepage.png" />

</div>

<br />

## ✨ 功能一览

### 🏠 创作主页
<sub>全宽仪表盘 · 动态欢迎语 · 作品总览 · 数据面板 · 一键新建与导入作品</sub>

<img width="100%" alt="homepage" src="assets/homepage.gif" />

### 🗂️ 写作工作台
<sub>全章节面板 · 时间轴看板 · 伏笔看板 · 设定看板 · 任务看板 · 便签管理</sub>

<img width="100%" alt="workbench" src="assets/workbench.gif" />

### 🌑 沉浸写作模式
<sub>全屏专注 · 打字机居中滚动与行淡化 · 动态仪表盘 · 插槽化布局</sub>

<img width="100%" alt="immersive-mode" src="assets/immersive-mode.gif" />

### 📊 字数统计与目标追踪
<sub>3种字数统计模式 · 多向目标追踪 · 严格章节模式 · 选区字数提示 · 章节排除统计 · 文件夹字数显示</sub>

<img width="100%" alt="word-count-gutter" src="assets/word-count-gutter.gif" />

### ⏱️ 专注时间追踪
<sub>自动区分专注与摸鱼 · Worker线程 · 365热力图 · 柱状+趋势 · 效率卡片</sub>

<img width="100%" alt="history-chart" src="assets/history-chart.gif" />

### 🔍 校对
<sub>完全本地的编辑器内联检查 · 错词与敏感词 · 近义词一致性 · 中英文语境标点 · 可选“的/地/得”规则 · 建议卡片与确认后单处替换</sub>

<img width="100%" alt="proofreading" src="assets/proofreading.gif" />

### 📝 创作辅助工具

<table>
<tr>
<td width="33%" align="center" valign="top"><img width="100%" alt="foreshadowing" src="assets/foreshadowing.gif" /><br /><b>伏笔管理</b><br /><sub>标注 → 阶段推进 → 彻底回收</sub></td>
<td width="33%" align="center" valign="top"><img width="100%" alt="timeline" src="assets/timeline.gif" /><br /><b>时间线系统</b><br /><sub>事件记录、多章节关联、类型分类</sub></td>
<td width="33%" align="center" valign="top"><img width="100%" alt="corkboard" src="assets/corkboard.gif" /><br /><b>章节一览</b><br /><sub>卡片式展示、状态标记、摘要编辑</sub></td>
</tr>
<tr>
<td width="33%" align="center" valign="top"><img width="100%" alt="lore-lookup" src="assets/lore-lookup.gif" /><br /><b>设定速查与图谱</b><br /><sub>嵌套目录、单文件词条、自动标注与关系图谱</sub></td>
<td width="33%" align="center" valign="top"><img width="100%" alt="sticky-note" src="assets/sticky-note.gif" /><br /><b>悬浮便签</b><br /><sub>自动保存、Markdown渲染</sub></td>
<td width="33%" align="center" valign="top"><img width="100%" alt="task" src="assets/task.gif" /><br /><b>任务追踪</b><br /><sub>创建周期任务、支持自主放弃</sub></td>
</tr>
<tr>
<td width="33%" align="center" valign="top"><img width="100%" alt="search" src="assets/search.gif" /><br /><b>高级搜索</b><br /><sub>支持当前书籍、全局、自定义，快速跳转</sub></td>
<td width="33%" align="center" valign="top"><img width="100%" alt="merge" src="assets/merge.gif" /><br /><b>合并章节</b><br /><sub>桌面预览修订 · 移动端预览导出</sub></td>
<td width="33%" align="center" valign="top"><img width="100%" alt="auto-create-next" src="assets/auto-create-next.gif" /><br /><b>自动创建下一章</b><br /><sub>自动创建带标号文档，支持模板</sub></td>
</tr>
</table>

### 🎥 OBS直播叠加层 & 📱 移动端

| 🎥 OBS叠加层 | 📱 移动端 |
|:---|:---|
| 实时显示写作数据 | 浮动字数统计与专注计时小窗 |
| 自定义样式、透明度、内容 | 贴边吸附与自动收起手柄模式 |
| 零延迟、零磁盘消耗 | **复制本文档纯净文本** — 一键带标题提取纯净正文 |

<br />

## 📥 安装

| 方式 | 步骤 |
|:-----|:-----|
| **社区插件市场** *(推荐)* | 设置 → 第三方插件 → 浏览 → 搜索 **"WebNovel Assistant"** → 安装 → 启用 |
| **BRAT** | 安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) → 添加仓库 `HatanoChihiro/obsidian-webnovel-assistant` → 启用 |
| **手动安装** | [下载](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/releases) → 解压到 `.obsidian/plugins/web-novel-assistant/` → 重启启用 |

## 🚀 快速开始

1. **安装插件** → 打开任意 Markdown 文件
2. **状态栏**显示实时字数 → 点击设置目标
3. **命令面板** `Ctrl/Cmd+P` → 搜索 "WebNovel"
4. **设置** → 自定义各项功能

<details>
<summary><kbd>🎯 主要命令</kbd></summary>

| 命令 | 说明 |
|------|------|
| 进入/退出 沉浸写作模式 | 切换全屏沉浸创作环境 |
| 打开/关闭写作实时状态面板 | 详细统计和历史图表 |
| 打开/关闭伏笔面板 | 管理伏笔标注和回收 |
| 打开/关闭时间线面板 | 管理故事时间线 |
| 打开写作工作台面板 | 管理章节、时间线、设定、任务和便签看板 |
| 打开章节一览 | 卡片式展示章节纲要 |
| 开始/暂停 专注时间统计 | 切换专注/摸鱼计时 |
| 标注为伏笔 | 将选中文字标注为伏笔 |
| 新建空白悬浮便签 | 创建浮动便签 |
| 高级搜索 | 搜索书籍/全局/自定义范围 |
| 自动创建下一章 (智能递增) | 智能递增章节编号 |
| 重建设定缓存 | 重建设定条目和章节设定引用统计 |
| 标注为词库 | 将任意 Markdown 文档中的选中文字录入自定义词典 |

> 所有命令可在 **设置 → 快捷键** 中自定义

> 详细设置与故障排查请参阅完整[使用指南](doc/USER_GUIDE.md) / [User Guide](doc/USER_GUIDE_EN.md)。

</details>

<details>
<summary><kbd>⚙️ 主要设置</kbd></summary>

| 设置 | 默认值 | 说明 |
|------|--------|------|
| 语言 | 跟随系统 | 界面语言，首次安装自动检测 |
| 默认章节目标 | 3000 | 新文件的默认章节目标 |
| 今日目标字数 | 5000 | 今日写作目标 |
| 显示文件列表字数 | 关闭 | 大型项目建议关闭 |
| 智能章节排序 | 关闭 | 自动按章节编号排序 |
| 护眼模式 | 关闭 | 编辑器背景护眼色 |
| 沉浸便签尺寸 | 280px | 沉浸模式下便签卡片边长 |
| 伏笔文件名 | `伏笔` | 可按工作区自定义 |
| 时间线文件名 | `时间线` | 可按工作区自定义 |
| 限时任务文件名 | `限时任务` | 可按工作区自定义 |
| 设定文件夹名称 | `设定` | 支持字典大纲模式 |
| 字数统计模式 | 标准模式 | 标准/网文/原生 统计算法 |

</details>

<details>
<summary><kbd>🎨 OBS叠加层设置</kbd></summary>

1. 插件设置 → 启用 **OBS叠加层**
2. OBS → 添加 **浏览器源** → URL `http://127.0.0.1:24816/`
3. 建议 **300×500px**

详见 [OBS叠加层CSS指南](doc/OBS_OVERLAY_CSS_GUIDE.md)

</details>

<br />

## 🌐 联网行为说明

校对扫描及全部笔记分析均在本地完成，插件无自动联网请求。基础错词库与“的/地/得”规则词典未内置打包，首次使用需在设置中手动下载。只有用户主动点击 **更新基本错词库** 或 **更新规则词典** 时，才会通过 Obsidian 的 `requestUrl` API 从 `raw.githubusercontent.com/HatanoChihiro/obsidian-webnovel-assistant` 下载公开 JSON 词典；绝不上传正文、仓库路径、设备标识、账户数据或遥测信息。下载内容只会按纯词典数据严格校验并缓存，不允许包含远程正则或脚本，不会作为代码执行，也不会用于更新插件本身或依赖。

<br />

<div align="center">

## 📄 许可证 & 💬 反馈

[MIT License](LICENSE)

⭐ Star · 🐛 [提交问题](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/issues) · 💡 [功能建议](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/issues)

<br />

**反馈和交流群：964265407**

<br />

**祝你写作愉快！** ✍️

</div>

---

<a id="english"></a>

<div align="center">

# ✍️ WebNovel Assistant

**English** | **[中文](#中文)**

[![GitHub release](https://img.shields.io/github/v/release/HatanoChihiro/obsidian-webnovel-assistant?label=release&color=brightgreen)](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/releases)
[![License](https://img.shields.io/github/license/HatanoChihiro/obsidian-webnovel-assistant?color=blue)](LICENSE)
[![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=8b5cf6&label=downloads&query=%24%5B%223.2.0%22%5D&url=https%3A%2F%2Fraw.githubusercontent.com%2FHatanoChihiro%2Fobsidian-webnovel-assistant%2Fmain%2Fversions.json)](https://obsidian.md/plugins?id=web-novel-assistant)

An all-in-one writing studio for novel and story writers in Obsidian.<br />
Accurate word count & goal tracking · Story timeline · Foreshadowing manager · Chapter corkboard · Lore graphs & focus timers.

<br />

<a href="doc/USER_GUIDE_EN.md"><kbd>📖 User Guide</kbd></a>
<a href="doc/OBS_OVERLAY_CSS_GUIDE_EN.md"><kbd>🎥 OBS CSS Guide</kbd></a>
<a href="doc/CHANGELOG.md"><kbd>📋 Changelog</kbd></a>

<br />

<details>
<summary><kbd>💖 Support the Project · Buy the Author a Coffee</kbd></summary>

<br />

If this plugin helps with your writing, consider supporting the author. Your support is the greatest motivation for continuous updates!

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/hatanochihiro)

</details>

<br />

<img width="100%" alt="homepage" src="assets/homepage_en.png" />

</div>

<br />

## ✨ Feature Highlights

### 🏠 Creative Homepage
<sub>Full-width Dashboard · Dynamic Welcome · Novel Overview · Stats Panel · One-Click New Novel & Import Novel</sub>

<img width="100%" alt="homepage" src="assets/homepage_en.gif" />

### 🗂️ Writing Workbench
<sub>All Chapters Panel · Timeline Board · Foreshadowing Board · Lore Board · Task Board · Notes Management</sub>

<img width="100%" alt="workbench" src="assets/workbench_en.gif" />

### 🌑 Immersive Writing Mode
<sub>Full-screen Focus · Typewriter Scroll & Line Dimming · Dynamic Dashboard · Slot-based Layout</sub>

<img width="100%" alt="immersive-mode" src="assets/immersive-mode_en.gif" />

### 📊 Word Count & Goals
<sub>3 Counting Modes · Multi-direction Goal Tracking · Strict Chapter Mode · Selection Count Tooltip · Chapter Exclusion · Folder Word Counts</sub>

<img width="100%" alt="word-count-gutter" src="assets/word-count-gutter_en.gif" />

### ⏱️ Focus Time Tracking
<sub>Auto focus vs. slack detection · Web Worker · 365 Heatmap · Bar+line trend · Efficiency card</sub>

<img width="100%" alt="history-chart" src="assets/history-chart_en.gif" />

### 🔍 Proofreading
<sub>Fully local inline diagnostics · Typos & sensitive words · Synonym consistency · Text-aware Chinese/English punctuation · Optional De/Di/De rules · Review cards & confirmed one-at-a-time replacement</sub>

<img width="100%" alt="proofreading" src="assets/proofreading_en.gif" />

### 📝 Creative Assistants

<table>
<tr>
<td width="33%" align="center" valign="top"><img width="100%" alt="foreshadowing" src="assets/foreshadowing_en.gif" /><br /><b>Foreshadowing Manager</b><br /><sub>Mark → Multi-stage tracking → Final resolution</sub></td>
<td width="33%" align="center" valign="top"><img width="100%" alt="timeline" src="assets/timeline_en.gif" /><br /><b>Timeline System</b><br /><sub>Events, multi-chapter links, custom types</sub></td>
<td width="33%" align="center" valign="top"><img width="100%" alt="corkboard" src="assets/corkboard_en.gif" /><br /><b>Chapter Corkboard</b><br /><sub>Card overview, status & synopsis editing</sub></td>
</tr>
<tr>
<td width="33%" align="center" valign="top"><img width="100%" alt="lore-lookup" src="assets/lore-lookup_en.gif" /><br /><b>Lore Quick Lookup</b><br /><sub>Nested folders, file entries, auto-highlights & relation graph</sub></td>
<td width="33%" align="center" valign="top"><img width="100%" alt="sticky-note" src="assets/sticky-note_en.gif" /><br /><b>Sticky Notes</b><br /><sub>Auto-save, Markdown render</sub></td>
<td width="33%" align="center" valign="top"><img width="100%" alt="task" src="assets/task_en.gif" /><br /><b>Task Tracker</b><br /><sub>Create periodic tasks, self-driven deadlines & voluntary abandon</sub></td>
</tr>
<tr>
<td width="33%" align="center" valign="top"><img width="100%" alt="search" src="assets/search_en.gif" /><br /><b>Advanced Search</b><br /><sub>Search by book, global or custom scope</sub></td>
<td width="33%" align="center" valign="top"><img width="100%" alt="merge" src="assets/merge_en.gif" /><br /><b>Merge Chapters</b><br /><sub>Desktop preview & revision · Mobile preview & export</sub></td>
<td width="33%" align="center" valign="top"><img width="100%" alt="auto-create-next" src="assets/auto-create-next_en.gif" /><br /><b>Auto-Create Next Chapter</b><br /><sub>Auto-create numbered documents, template support</sub></td>
</tr>
</table>

### 🎥 OBS Streaming Overlay & 📱 Mobile

| 🎥 OBS Overlay | 📱 Mobile |
|:---|:---|
| Real-time writing stats in OBS | Floating word count & focus timer widget |
| Custom style, opacity & content | Edge docking & auto-collapse handle |
| Zero latency, zero disk I/O | **Copy Document** — one-click with title prepended |

<br />

## 📥 Installation

| Method | Steps |
|:-------|:------|
| **Community Plugins** *(Recommended)* | Settings → Community Plugins → Browse → Search **"WebNovel Assistant"** → Install → Enable |
| **BRAT** | Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) → Add repo `HatanoChihiro/obsidian-webnovel-assistant` → Enable |
| **Manual** | [Download](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/releases) → Extract to `.obsidian/plugins/web-novel-assistant/` → Restart & Enable |

## 🚀 Quick Start

1. **Install** → open any Markdown file
2. **Status bar** shows live word count → click to set a goal
3. **Command Palette** `Ctrl/Cmd+P` → search "WebNovel"
4. **Settings** → customize each feature

<details>
<summary><kbd>🎯 Key Commands</kbd></summary>

| Command | Description |
|---------|-------------|
| Toggle Immersive Writing Mode | Full-screen distraction-free writing |
| Toggle Writing Status Panel | Detailed stats & history charts |
| Toggle Foreshadowing Panel | Manage foreshadowing & recovery |
| Toggle Timeline Panel | Manage story timeline |
| Toggle Writing Workbench View | Chapters, timeline, lore, task and notes boards |
| Open Chapter Overview | Card-style chapter overview |
| Start/Pause Focus Time Tracking | Toggle focus/slack tracking |
| Mark as Foreshadowing | Mark selected text as foreshadowing |
| Create Blank Sticky Note | New floating sticky note |
| Advanced Search | Search by book/global/custom scope |
| Create Next Chapter (Smart Increment) | Smart chapter numbering |
| Rebuild Lore Cache | Rebuild lore entries and chapter reference statistics |
| Annotate to Dictionary | Add selected text from any Markdown document to a custom dictionary |

> All commands can get custom shortcuts in **Settings → Hotkeys**

> Need setup details or troubleshooting? See the full [User Guide](doc/USER_GUIDE_EN.md) / [使用指南](doc/USER_GUIDE.md).

</details>

<details>
<summary><kbd>⚙️ Key Settings</kbd></summary>

| Setting | Default | Description |
|---------|---------|-------------|
| Language | Auto | UI language — auto-detects Obsidian locale |
| Default Chapter Goal | 3000 | Chapter word goal for new files |
| Daily Goal | 5000 | Daily writing target |
| Show Word Counts in File Explorer | Off | Folder word counts in sidebar |
| Smart Chapter Sorting | Off | Auto-sort by chapter numbers |
| Eye Care Mode | Off | Warm background color |
| Immersive Note Size | 280px | Sticky note card size in immersive mode |
| Foreshadowing Filename | `Foreshadowing` | Customizable per workspace |
| Timeline Filename | `Timeline` | Customizable per workspace |
| Timed Task Filename | `Timed Task` | Customizable per workspace |
| Lore Folder Name | `Lore` | Supports dictionary outline mode |
| Word Count Mode | Standard | Standard / Web Novel / Native algorithm |

</details>

<details>
<summary><kbd>🎨 OBS Overlay Setup</kbd></summary>

1. Plugin settings → Enable **OBS Overlay**
2. OBS → Add **Browser Source** → URL `http://127.0.0.1:24816/`
3. Recommended: **300×500px**

See [OBS Overlay CSS Guide](doc/OBS_OVERLAY_CSS_GUIDE_EN.md) for full customization.

</details>

<br />

## 🌐 Network Use Disclosure

Proofreading and all note analysis run entirely locally. The plugin makes no automatic network requests. The basic typo dictionary and De/Di/De grammar dictionary are not bundled and require manual download in Settings on first use. Only when you explicitly click **Update Basic Dictionary** or **Update Grammar Dictionary** does it use Obsidian's `requestUrl` API to download public JSON dictionaries from `raw.githubusercontent.com/HatanoChihiro/obsidian-webnovel-assistant`. No note content, vault path, device identifier, account data, or telemetry is uploaded. Responses are strictly validated as dictionary data, cached as JSON, and never executed as code or used to update the plugin or its dependencies.

<br />

<div align="center">

## 📄 License & 💬 Feedback

[MIT License](LICENSE)

⭐ Star · 🐛 [Issues](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/issues) · 💡 [Feature Requests](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/issues)

<br />

**Happy writing!** ✍️

</div>
