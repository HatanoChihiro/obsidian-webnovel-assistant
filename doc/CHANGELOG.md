## 🔧 v3.9.1

### Bug修复
- **同名章节伏笔与时间线隔离**：修复同一作品不同分卷存在同名章节时，伏笔徽标串章、跳转错位以及时间线看板关联混用的问题，确保各卷同名章节的伏笔记录与时间线事件精准对应。
- **章节智能排序与主页置顶自愈**：修复移动端与平板端在侧边栏异步加载、折叠展开或界面布局变化时章节智能排序可能偶发失效的问题，支持在文件列表就绪后自动恢复排序与置顶。
- **时间轴看板滚动稳定性**：修复编辑长事件描述时输入与聚焦导致内部滚动跳顶的问题，并保证在视图刷新与并发重载时时间轴看板与未关联侧边栏的滚动位置稳定保留。
- **校对标记兼容性**：修复错词与近义词下划线在部分 Obsidian 版本中的 CSS 兼容性警告，并将官方 CSS 兼容性检查加入本地验证。
- **时间线与章节同步**：在侧面板、时间轴看板或时间线 Markdown 修改节点名称和关联章节后，章节 timeline 属性会自动同步，多作品同时编辑不会互相影响。
- **文件列表字数清理**：修复插件卸载或关闭字数显示后，重新展开折叠目录时残留字数标签再次出现的问题。

### English Changelog

#### Bug Fixes
- **Duplicate Chapter Isolation for Foreshadowing & Timeline**: Fixed an issue where duplicate chapter names across different volumes in the same work caused foreshadowing badges, jumps, and timeline board events to cross-link incorrectly, ensuring entries and interactions are strictly isolated to the exact chapter file.
- **Smart Chapter Sorting & Homepage Pin Recovery**: Fixed an intermittent issue on mobile and tablet devices where smart chapter sorting could be lost when the sidebar loads asynchronously or layout changes occur, ensuring sorting and pinning automatically self-heal once the file explorer is ready.
- **Timeline Board Scroll Stability**: Fixed an issue where focusing or typing in long event descriptions caused the description container to jump to the top, and ensured timeline waterfall and sidebar scroll positions are reliably preserved during board reloads.
- **Proofreading Marker Compatibility**: Fixed CSS compatibility warnings for typo and synonym underlines in some Obsidian versions and added the official CSS compatibility check to local validation.
- **Timeline & Chapter Synchronization**: When modifying event node names or linked chapters in the side panel, timeline board, or timeline Markdown file, chapter timeline attributes now synchronize automatically, and editing multiple works simultaneously will not affect each other.
- **File Explorer Word Count**: Fixed an issue where lingering word count badges could reappear when expanding previously collapsed folders after the plugin was unloaded or word count display was disabled.

---

## ✨ v3.9.0

### 新增校对系统
- **独立设置入口**：在“排版”右侧提供单独的“校对”设置导航，集中管理校对功能与词典。
- **全局作用域**：启用校对后默认应用于工作区内所有 Markdown 文档；开启“启用全局生效”后扩展至当前笔记库内所有 Markdown 文档。校对词典始终排除。
- **本地内联校对**：在编辑器可视区域检测错词、敏感词和近义词，以不同下划线样式展示，可自行决定是否选择建议替换当前一处文本。
- **按需下载校对词库**：基础错词库与“的/地/得”规则词典支持在设置中按需手动下载与更新，正文内容不上传，无自动联网。首次未下载时保持未下载状态，下载后可手动开启检查。
- **自定义词典**：选中文字后可通过右键菜单（桌面端）或“标注为词库”编辑器命令（支持配置到移动端工具栏）标注为错词、近义词或敏感词，直接写入工作区词典，也可自行编辑文件添加。
- **实验性“的/地/得”语法提示**：涵盖“的→地、得→地、的→得、地→得、地→的、得→的”六向语法误用检查，优化动作结构与单字名词的局部上下文和复合词边界判定，固定补语与“地+程度补语”高置信提示，“的+普通程度词/形容词”严格静默以消除歧义误报；实验性功能存在误报，默认关闭。
- **文本语言标点建议**：根据标点附近的正文语言提示中文全角或英文半角写法，同时检查成对符号是否正确出现，默认关闭。
- **社区词库贡献**：基础错词与“的/地/得”分类词项均提供独立 Markdown 贡献模板、自动校验和候选 JSON，正文不会被自动收集或上传。

### 功能优化
- **便签列表阅读卡片与单卡片编辑**：侧边栏、工作台与沉浸模式中的便签默认以阅读卡片展示，可单独切换当前卡片的编辑与阅读状态；关联文档的便签可从源文件手动同步最新内容，新建便签则直接进入编辑模式。
- **自定义章节规则与下一章创建**：多个规则同时匹配时优先采用编号结构更完整的规则，即使专用规则位于默认规则下方也能正确识别；创建下一章时会按规则保留任意单位及原标题前的分隔占位。
- **设定卡片标题显示**：设定卡片空间不足时优先完整显示正名；存在多个别名时仅展示能够完整容纳的徽章，并以 `+n` 汇总其余别名，只有一个超长别名时则在徽章内省略显示。
- **卡片正文首行缩进与软回车阅读兼容**：在“排版 → 作用域设置”中新增“应用至卡片正文”选项，开启后为便签、设定卡片（含悬浮预览）、章节卡片与时间线事件卡片的显示和编辑内容应用缩进；在开启“阅读模式兼容”时，卡片内 Markdown 软换行（`<br>`）后续行同步支持首行缩进，且不影响字号与其他排版参数。
- **排版作用域加强**：排版开启“全局应用”后可作用于当前库内所有普通文档，功能文档与卡片正文仍保持独立控制。
- **统一便签管理与字号**：工作台便签管理与便签列表复用同一套卡片布局、动态尺寸、自动换列、段落编辑和刷新逻辑；悬浮便签与各便签列表的正文及标题统一由“创作辅助”中的便签字号设置集中控制。
- **章节与设定一览搜索与章节排序**：侧边栏章节一览与设定一览面板顶部新增关键词搜索过滤功能；工作台全章节视图与侧边栏章节一览新增章节正序/倒序显示切换，并确保分卷作品反复切换排序后仍保持正确卷序。
- **沉浸模式面板间距**：缩小沉浸模式辅助面板顶部留白，同时保留正文编辑区原有的舒展间距。
- **历史数据备份**：桌面端可在“数据输出”中单独导出和恢复每日字数、专注与摸鱼统计，方便重装时只保留写作历史；恢复前会明确提示覆盖当前历史数据。
- **官方兼容性提升**：为符合 Obsidian 官方数据存储要求并支持 Obsidian Sync，历史写作统计、专注数据与便签现随插件设置统一保存在 `data.json`；升级时会自动迁移旧独立数据文件，并将原文件保留为备份。本地缓存与校对词典仍保持独立。
- **设定图谱视觉**：聚焦关系线的流光默认跟随实际关系线颜色，并恢复主角节点原有的鲜明主题红色效果；两者仍支持通过 CSS 代码片段覆盖。
- **工作台设定图谱**：双击词条分屏打开设定文件后，嵌入图谱会自动适配收缩后的容器尺寸并保持以主角为视觉中心。

### English Changelog

#### New Features
- **Proofreading**:
  - **Dedicated Settings Entry**: Adds a separate Proofreading settings tab to the right of Typography to centrally manage proofreading features and dictionaries.
  - **Global Scope**: Once enabled, proofreading applies to every Markdown file in configured workspaces. Turning on “Enable Vault-wide Proofreading” extends it to every Markdown file in the current vault. Dictionary folders are always excluded.
  - **Local Inline Proofreading**: Detects typos, sensitive words, and synonyms in the editor's visible area with distinct underline styles, letting users decide whether to replace the current occurrence with a suggestion.
  - **On-Demand Proofreading Dictionaries**: Basic typo and "De/Di/De" rule dictionaries can be manually downloaded and updated on demand in Settings, with no document upload and no automatic networking. Dictionaries remain in a not-downloaded state initially, and checking can be enabled manually after downloading.
  - **Custom Dictionaries**: Selected text can be marked as a typo, synonym, or sensitive word via the context menu (desktop) or the "Annotate to Dictionary" editor command (configurable in the mobile toolbar) and written directly to workspace dictionaries, or added by editing the files manually.
  - **Experimental "De/Di/De" Grammar Hints**: Covers 6-direction grammar misuse checks across 的→地, 得→地, 的→得, 地→得, 地→的, and 得→的, with enhanced local context and compound-word boundary handling for action verbs and single-character nouns; offers high-confidence suggestions for fixed complements and "地 + degree complements" while keeping "的 + general degree words/adjectives" strictly silent to eliminate false positives; experimental feature with potential false positives, disabled by default.
  - **Text-Language Punctuation Suggestions**: Suggests Chinese full-width or English half-width punctuation based on nearby text language and checks whether paired symbols appear correctly; disabled by default.
  - **Community Dictionary Contributions**: Basic typos and categorized De/Di/De terms now have dedicated Markdown templates, automated validation, and candidate JSON artifacts, without automatic manuscript collection or upload.

#### Enhancements
- **Sticky Note List Reading Cards & Per-Card Edit Toggle**: Existing notes across side-panel, workbench, and immersive lists now render as reading cards by default and can switch individually between reading and editing; file-backed notes can manually sync the latest source content, while newly created notes start in edit mode.
- **Custom Chapter Rules & Next-Chapter Creation**: When multiple rules match, the rule covering the most complete numbering structure now takes precedence, so specialized rules still work below default rules. Creating the next chapter preserves any rule-defined unit and the separator placeholder before the original title.
- **Lore Card Title Display**: Lore cards now prioritize the full canonical name. Multiple aliases use only complete badges and summarize the rest with `+n`, while a single overlong alias is truncated within its badge.
- **Card Typography Indent & Soft-Break Compatibility**: Added “Apply to Cards” under Typography → Scope Settings to apply indentation to displayed and edited content across sticky notes, lore cards (including hover previews), chapter cards, and timeline event cards; when Reading compatibility is enabled, soft line breaks (`<br>`) in cards also receive first-line indentation without affecting other typography styles.
- **Expanded Typography Scope**: Turning on “Apply Across Vault” applies typography to all ordinary documents in the current vault, while functional documents and card content remain independently controlled.
- **Unified Sticky Note Management & Font Size**: Workbench sticky-note management now reuses the same card layout, responsive sizing, automatic column reflow, paragraph editor, and refresh path as sticky-note lists. Body text and headings across floating notes and all note lists share the font-size setting under Creative Assistance.
- **Chapter & Lore Overview Search and Chapter Ordering**: Added keyword search filtering to the top of Chapter Overview and Lore Overview side panels, added an ascending/descending chapter display-order toggle to Workbench All Chapters and Chapter Overview, and kept volume ordering stable after repeated direction changes.
- **Immersive Panel Spacing**: Reduced excess top spacing in Immersive Mode auxiliary panels while retaining the roomier spacing of the main editor.
- **History Data Backup**: Desktop users can export and restore daily word counts, focus time, and slack time separately from Data Output, making it possible to preserve writing history without restoring plugin settings. A confirmation is shown before current history is replaced.
- **Improved Official Compatibility**: To follow Obsidian's official data-storage requirements and support Obsidian Sync, writing history, focus statistics, and sticky notes are now stored with plugin settings in `data.json`. Existing standalone data files are migrated automatically during upgrade and retained as backups, while local caches and proofreading dictionaries remain separate.
- **Lore Graph Visuals**: Focused-edge pulses now follow the actual relationship line color, and protagonist nodes regain their original vivid theme red; both remain customizable through CSS snippets.
- **Workbench Lore Graph**: Opening lore files in a split pane via double-click now automatically adapts the embedded graph to the reduced container size while staying visually centered on the protagonist.

---

## 🔧 v3.8.6

### 功能优化
- **性能与稳定性**：减少大型仓库、频繁保存和长章节跳转时的等待，并提升主页、设定预览、多窗口交互和插件启动的稳定性。
- **界面细节优化**：统一工作台全章节视图与设定、任务等看板的卡片间距。
- **设定图谱样式**：独立设定图谱和工作台全量图谱支持应用 CSS 代码片段并及时刷新，可自定义节点、连线、流光和曲线间距，以及切换关系端点的空心环、实心点、箭头或隐藏样式。

### English Changelog

#### Enhancements
- **Performance and Stability**: Reduced delays in large vaults, during frequent saves, and when navigating long chapters, while improving reliability across the Homepage, lore previews, multi-window interactions, and plugin startup.
- **UI Refinements**: Unified card spacing between Workbench Full Chapter View and lore, task, and other boards.
- **Lore Graph Styles**: Added CSS snippet support with timely refreshes to both standalone and Workbench Full Lore Graphs, including controls for nodes, lines, pulses, curve spacing, and ring, dot, arrow, or hidden endpoint markers.

---

## 🔧 v3.8.5

### 功能优化

- **新增设定一览侧面板**：支持以侧面板形式查看设定卡片，支持分类折叠、就地编辑与精准跳转，可在沉浸模式槽位中配置使用。
- **章节一览支持分卷分组**：侧边栏章节一览面板接入分卷分类，支持分卷折叠与章节统计。
- **支持章节排除字数统计**：章节右键支持一键标记“不计字数”，方便排除大纲与草稿，同时支持在写作台显示。
- **优化设定关系双链生成**：右键或命令新建设定并关联已有设定时，若关联目标处于同一设定分类文件下，自动生成精简的同文档标题双链（`[[#标题]]`），避免附带冗余的文件名前缀。
- **设定文件夹支持多级目录与单文件词条**：自动识别设定子文件夹，当不存在“## 二级标题”时会读取文件名作为设定词条。
- **伏笔与时间线卡片标题直达条目**：伏笔侧面板、伏笔看板、时间线侧面板及时间线看板支持点击卡片标题直接跳转至对应伏笔或时间线文件的具体条目位置并高亮定位。
- **优化文件打开与分屏跳转体验**：在工作台打开章节/设定/时间线/伏笔等文档时，优先开启分屏新窗口并会自动跳过锁定文件；如果当前存在未锁定的分屏窗口，则自动复用；在侧面板打开章节时，自动复用已有章节文件，开启功能性文件则会自动创建新窗口，方便对照修改。
- **优化部分UI样式**：统一伏笔看板与侧面板中出处标签、章节链接与引用框的视觉样式；优化设定图谱关系连线和端点样式，用渐变色和流光显示关系指向，视觉更加直观。

### Bug修复
- 修复多分屏状态下进入沉浸模式的排版异常问题。
- 修复限时任务到期且进度为 0 时未能自动结算为“未完成”的问题。
- 修复创作主页未自动刷新过期任务状态的问题。

### English Changelog

#### Enhancements
- **New Lore Overview Side Panel**: Added a dedicated side panel for lore cards supporting category folding, in-place editing, and precise jump navigation, configurable in Immersive Mode slot positions.
- **Volume Grouping in Chapter Overview**: Chapter Overview side panel now supports volume categorization with collapsible volume headers and chapter counts.
- **Exclude Chapters from Word Count**: Support right-clicking chapters to mark them as "Exclude from Word Count" to omit outlines and drafts from statistics, with indicator badges displayed on Workbench cards.
- **Optimized Lore Relation Wikilink Generation**: When creating new lore entries with relations pointing to entries in the same lore file via context menu or command, automatically formats concise internal heading links (`[[#Heading]]`) without redundant file prefixes.
- **Nested Subdirectories & Single-File Lore Notes**: Automatically detects nested lore subfolders; when no "## Heading 2" exists in a file, uses the filename as the lore entry.
- **Click-to-Locate Title Navigation for Foreshadowing & Timeline**: Clicking card/node titles in Foreshadowing side panel, Foreshadowing board, Timeline side panel, or Timeline board now directly opens and highlights the exact entry location in the corresponding markdown file.
- **Optimized File Opening & Split Pane Navigation**: Opening chapters, lore, timeline, or foreshadowing files from the Workbench now prefers opening in a split pane while automatically skipping locked (pinned) tabs, or reusing existing unpinned split editors. When opening chapters from side panels, stably reuses existing chapter editors; opening metadata/outline files automatically opens in a new split pane for side-by-side reference and editing.
- **UI Styling Refinements**: Unified the visual styling of source tags, chapter links, and quote boxes between the Foreshadowing board and side panel; refined relation graph lines and endpoint styles with flow-direction gradients and animated light beams for clearer visual hierarchy.

#### Bug Fixes
- Fixed layout glitch when entering Immersive Mode with multiple active split panes.
- Fixed an issue where expired timed tasks with zero word progress failed to automatically resolve as "Incomplete".
- Fixed an issue where the Homepage did not automatically refresh expired task statuses.

## 🔧 v3.8.4

### Bug修复
- 修复了沉浸模式下聚焦参考文档并使用高级搜索时，点击搜索结果可能强行跳回主编辑器界面而无法在参考文档面板内打开的问题。
- 修复了在未开启严格章节模式时，非显式“第X章”命名的正文文档无法计入今日目标、文件夹字数及创作主页总字数统计的问题。

### 功能优化
- 完善了用户指南中关于工作区设置与设定速查/写作台联动关系的常见问题解答。

### English Changelog

#### Bug Fixes
- Fixed an issue where searching from a focused reference document in Immersive Mode could incorrectly switch back to the main editor panel instead of opening the result within the reference document.
- Fixed an issue where regular manuscript documents without strict chapter numbering failed to be counted in Daily Goal, folder word counts, and Homepage statistics when Strict Chapter Mode was disabled.

#### Enhancements
- Improved User Guide FAQ with clear instructions on Workspace Folder configuration and Lore Lookup detection.

## 🔧 v3.8.3

### Bug修复
- 修复了在移动端等场景下文件浏览器重新加载时，智能章节排序可能偶尔失效的问题。
- 修复了电脑端悬浮便签切换到编辑模式后，内容一片空白且无法编辑的问题。
- 修复了桌面端工作台固定栏与视图顶边之间留有缝隙、滚动时会露出部分卡片的问题。

### 功能优化
- 优化了设定文件的读取方式，新增“重建设定缓存”快捷命令，支持手动触发全量重建设定条目与章节设定引用统计，并实时刷新编辑器高亮、工作台与关系图谱视图。
- 优化了便签列表中便签卡片的显示宽度，并在移动端强制单列显示。
- 解除了高级搜索面板的单文件超10条匹配自动隐藏的限制，会显示所有搜索结果。
- 优化了全局精准跳转引擎的表现：现在会精准定位并高亮指定内容，不再高亮整行或整段。
- 优化了高级搜索和排版调节面板的显示位置，不再遮挡正文。
- 完善了用户指南和常见问题。

### English Changelog

#### Bug Fixes
- Fixed an intermittent issue where smart chapter sorting could be lost when the file explorer view is destroyed and recreated, particularly on mobile devices.
- Fixed an issue where desktop floating sticky notes became blank and uneditable after switching to edit mode.
- Fixed an issue where a small gap between the desktop workbench sticky bar and the top edge revealed scrolled cards.

#### Enhancements
- Optimized lore note parsing and added "Rebuild Lore Cache" command to manually rebuild lore entries and chapter lore reference stats, refreshing editor highlights, workbench, and relation graph views in real time.
- Improved sticky note list card layout width, enforcing single-column display on mobile devices.
- Removed the 10-match limit per file in Advanced Search modal to display all search results.
- Optimized the unified precise jump engine: now accurately locates and highlights specific target content rather than highlighting entire lines or paragraphs.
- Optimized the display position and size of Advanced Search and Quick Typography adjustment modals to avoid blocking note content.
- Improved the User Guide and FAQ.

## 🔧 v3.8.2

### Bug修复
- 修复了外部导入、系统文件管理器增删文件或整理章节时会误改每日写作字数的问题；现在文件增删只刷新章节总字数，写作数据仅记录在 Obsidian 编辑器中对章节正文产生的字数增减。
- 修复了沉浸模式和侧面板中的便签列表在临界尺寸下可能反复缩放并跳屏的问题。
- 修复了移动端写作实时状态面板会在字数任务中误显示“完成”按钮的问题，现在该按钮仅在事件任务中显示。
- 修复了全章节视图和时间轴看板未关联章节中的卷分类无法隐藏章节卡片的问题，现在点击卷标题可以正常折叠和展开。
- 修复了时间轴看板事件描述编辑时滚动条样式与查看态不一致的问题，现在查看和编辑统一使用事件描述容器的滚动条；同时统一了“添加到时间线”面板标题与其他模态面板的样式。

### 功能优化
- 优化了部分 UI 效果，界面更直观。
- “重置今日写作统计数据”命令升级为操作面板，可选择清空全部数据、仅清空字数并保留专注计时，或将今日字数修正为指定整数。
- 工作台全章节视图新增“合并章节”按钮，位于作品状态按钮左侧，可直接合并当前作品目录内的全部章节。
- 沉浸模式下使用高级搜索时，搜索结果会回到最近聚焦的区域；聚焦参考文档后可直接在参考文档中跳转。
- 排版设置新增可选的“自定义正文大小”；开启后实时预览、阅读视图和章节合并预览会同步调整，且不改变界面字体，关闭时则继续支持 Obsidian 原生 Ctrl + 滚轮缩放；命令面板新增增大/减小正文字体的快捷命令，方便绑定快捷键。
- 重整样式模块归属并集中维护手机端响应式覆盖，降低样式膨胀和跨面板覆盖对后续维护的影响。

### English Changelog

#### Bug Fixes
- Fixed stage-recovery records in the foreshadowing side panel failing to jump from the recovered quote to chapters inside nested folders. The side panel now uses the same chapter resolution rule as the foreshadowing board.
- Fixed tasks from another work remaining or being updated in the live writing status panel. Task loading, progress, and completion are now scoped to their work, and switching to a work without an active task hides the previous task.
- Fixed external imports, file-manager changes, and chapter reorganization incorrectly changing daily writing words. File creation and deletion now refresh only chapter totals, while writing data records chapter text changes made in the Obsidian editor.
- Fixed an issue where sticky note lists in Immersive Mode and side panels could repeatedly resize and jump at certain boundary dimensions.
- Fixed the mobile live writing status panel showing a Complete button for word-count tasks; the button now appears only for event tasks.
- Fixed volume groups in the all-chapters view and the timeline board's unscheduled-chapters area so their chapter cards now collapse and expand when the volume header is clicked.
- Fixed the timeline event description editor using a different scrollbar from view mode; viewing and editing now share the event description container's scrollbar, and the Add to Timeline panel title matches the other modal headings.

#### Improvements
- Improved several UI details for a clearer, more intuitive interface.
- Upgraded the Reset Today Writing Stats command to offer three actions: clear all data, clear only words while preserving focus timing, or correct today's words to a specified integer.
- Added a “Merge Chapters” button to the Workbench all-chapters view, placed to the left of the novel status button, to merge all chapters in the current novel folder directly.
- Advanced Search in Immersive Mode now returns results to the most recently focused area, so results can jump inside the reference document when it has focus.
- Added optional Custom Body Text Size shared by Live Preview, Reading Mode, and Chapter Merge Preview without changing interface fonts; when disabled, Obsidian's native Ctrl + mouse-wheel zoom remains available. The Command Palette also provides increase/decrease body-font commands for keyboard shortcuts.
- Reorganized CSS ownership by feature and kept mobile responsive overrides in one maintained entry point, reducing cross-panel style drift and maintenance overhead.

---

## 🔧 v3.8.1

### Bug修复
- 修复了使用第三方插件或CSS代码片段修改行宽后会影响创作主页布局的BUG。
- 修复了点击写作实时状态面板中的伏笔跳转、专注计时、章节状态和数据入口时，侧面板抢焦点导致首次点击失效以及章节目标字数短暂变化的问题。
- 修复了工作台新增章节或自动创建下一章时会错误继承上一章标题的问题，现在使用“01 标题”格式时会正确生成不带旧标题的下一章编号。

### 功能优化

- 使用沉浸模式打开非作品文档（不存在锚点文件比如“作品信息.md”的目录）时，现在也支持渲染文件列表，方便更宽泛地使用沉浸模式。
- 工作台新增章节时，如果作品存在包含章节的卷目录，默认创建到最新卷目录中，并按该卷的章节计算下一章名称。
- 导入作品现在可以根据默认或自定义章节命名规则识别 Markdown 与纯文本中的卷章结构，并将章节正确整理到对应的卷目录中。
- 新增“打开便签列表”命令，可在侧面板加载现有便签列表并支持移动端。
- 便签列表文本大小设置现在位于创作辅助的悬浮便签设置中并支持移动端；沉浸模式下的便签列表会根据区域大小智能排布正方形卡片，空间不足时沿对应方向滚动。

### English Changelog

#### Bug Fixes
- Fixed a bug where modifying line width via third-party plugins or CSS snippets could affect the Writing Homepage layout.
- Fixed an issue where clicking foreshadowing jumps, focus timing, chapter status, or data actions in the live writing status panel could lose the first click and temporarily change the chapter goal after the side panel took focus.
- Fixed an issue where adding a chapter from the Workbench or using Create Next Chapter could incorrectly carry over the previous title; formats such as “01 Title” now generate the next chapter without the old title.

#### Improvements
- Immersive Mode now also renders a Markdown file list when opened on a non-novel document directory without marker files such as “作品信息.md”, making it useful in more locations.
- New chapters created from the Workbench now default to the latest volume folder when the novel contains volume folders with chapters, using that volume to determine the next chapter name.
- Novel imports now recognize volume and chapter structures in Markdown and plain-text files using the default or custom chapter naming rules, and organize chapters into the correct volume folders.
- Added an “Open Sticky Note List” command to load the existing sticky note list in a side panel, with mobile support.
- The sticky note list text-size setting is now available under Floating Notes on mobile as well; immersive note lists intelligently arrange square cards and scroll in the appropriate direction when space is limited.

---

## ✨ v3.8.0

### 新增独立排版系统
- **独立开关与设置选项卡**：在设置中新增“排版”选项卡，支持首行缩进、行宽、行高、段间距、字间距、两端对齐等样式自定义，统一管理开关并支持作用于哪些文档（章节、非章节、功能细分）。
- **排版一致性**：设置好的排版同时作用于实时预览（编辑）视图、阅读视图及章节合并导出预览视图，保持视觉统一。
- **快捷调节悬浮窗口**：支持在命令面板随时唤醒 `WebNovel Assistant: 快速调节排版`，通过滑块悬浮窗毫秒级实时微调预览排版效果。

### 章节合并功能升级
- **合并预览及修订**：在进行章节合并时，支持预览及选词修订功能，提供三栏式视图，修订内容支持应用到原文件。
- **合并时可选标题**：导出时可选择是否添加章节文档标题，支持无标题纯净正文合并。
- **移动端瀑布流预览**：移动端提供单栏极简单行正文瀑布流预览视图。

### 功能优化
- **设定看板卡片模式tab栏**：当存在多个设定文件时，在设定看板卡片模式下增加tab栏，支持快速切换浏览不同设定（感谢社区贡献者 **@tyf2018** 提交的 [PR #16](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/pull/16)）
- **伏笔标签同步筛选**：在侧面板中选择伏笔标签进行筛选，工作台的伏笔看板会实时同步联动展示对应的伏笔卡片。
- **作品导入模版补全**：导入作品时生成的作品信息文档自动补全作品状态、简介、角色、题材、字数目标与立项日期等基础信息。
- **设定图谱**：类型为主角的设定节点在图谱中将默认以鲜艳的红色彩度呈现，并锁定为视觉中心。
- **UI展示优化**：优化了非常多UI的显示效果，尤其是手机端，具体我也忘记了，反正很多。

### bug修复
- 修复了退出沉浸模式后迅速关闭Obsidian/反复重新进入沉浸模式 ，沉浸模式布局有概率侵入普通模式的BUG。
- 修复了写作工作台英文模式下标题异常的BUG。
- 修复了切换到非工作区或非章节文档时偶尔会显示章节字数目标的BUG。
- 修复了如果在开启工作区和严格章节模式之前先开启创作主页，主页总字数会包含所有文档的BUG。
- 修复了沉浸模式下按下esc会触发原生退出DOM全屏，导致UI显示出现问题的BUG。
- 修复了沉浸模式下每次重新进入时布局会产生轻微偏移的BUG。
- 修复了设定图谱内容“自动提及”功能无法关联到设定别名的BUG。

### English Changelog

#### New Typography System
- **Master Toggle & Dedicated Tab**: Added a "Typography" tab in settings supporting custom styles for first-line indent, line width, line height, paragraph spacing, letter spacing, and text justification, with granular document scope controls (chapters, non-chapters, functional documents).
- **Typography Consistency**: Applied typography settings consistently across Live Preview (Editing) Mode, Reading Mode, and Chapter Merge Export Preview for a unified visual experience.
- **Quick Adjustment Floating Modal**: Trigger `WebNovel Assistant: Quick Typography Adjustment` via the Command Palette to fine-tune typography settings in real-time using smooth sliders.

#### Chapter Merge Upgrade
- **Merge Preview & Revision**: Supports continuous manuscript preview and text selection revision in a 3-pane view, with options to apply revisions back to source files.
- **Optional Document Titles**: Choose whether to include chapter titles during export, supporting clean title-free manuscript concatenation.
- **Mobile Stream Preview**: Provides a streamlined single-pane continuous stream preview for mobile devices (phones and tablets).

#### Improvements
- **Lore Board Card View Tabs**: Added a tab bar when multiple lore files exist in card view for quick switching (Thanks to community contributor **@tyf2018** for [PR #16](https://github.com/HatanoChihiro/webnovel-assistant/pull/16)).
- **Foreshadowing Tag Filter Sync**: Filtering foreshadowing tags in the side panel now instantly syncs and displays matching cards on the Workbench Foreshadowing Board.
- **Novel Import Template Completion**: When importing a novel, the generated Novel Info file now auto-populates status, blurb, characters, genre, word count targets, and creation date.
- **Lore Graph Protagonist Highlight**: Protagonist lore nodes now default to a vibrant red hue and anchor to the visual center of relation graphs.
- **UI Display Optimizations**: Enhanced various UI display effects and layout alignments.

#### Bug Fixes
- Fixed an issue where rapidly closing Obsidian after exiting Immersive Mode could cause the immersive layout to intrude into Normal Mode upon restart.
- Fixed abnormal title displays in English mode on the Writing Workbench.
- Fixed an issue where the chapter word count target was occasionally displayed when switching to non-workspace or non-chapter documents.
- Fixed a bug where opening the Creative Homepage before enabling Workspace and Strict Chapter Mode caused the total word count to include all vault documents.
- Fixed a bug where pressing Esc in Immersive Mode triggered native DOM fullscreen exit, causing UI display issues.
- Fixed a bug where the layout shifted slightly upon re-entering Immersive Mode.
- Fixed a bug where the Lore Graph "Auto-Link Mentions" feature failed to associate lore aliases.

---

## ✨ v3.7.0

### 写作工作台【伏笔看板】与阶段回收
- **工作台全新【伏笔看板】**：工作台新增【伏笔看板】视图，按 `待回收`（含未回收与阶段推进）、`已回收`、`已废弃` 三大分类归组，支持关键词搜索过滤与分类折叠。
- **伏笔阶段性回收**：支持记录伏笔在故事推进中的多次阶段进展（`[阶段]`）与最终彻底回收（`[回收]`），贴合长篇小说中伏笔逐步揭晓的创作规律。
- **全站通用智能高亮跳转引擎**：重构并统一了伏笔看板、伏笔侧边栏、实时状态面板、时间线、设定看板及关系图谱的点击跳转定位机制。自动复用已有打开窗口，采用忽略大小写与空白的正则模糊匹配，精准定位目标行并触发行背景闪烁高亮。
- **看板视觉与布局优化**：精细对齐了全工作台各类看板的卡片边距与标头排版，带来更加紧凑精致的视觉体验。

### 支持导入外部作品

- 在主页作品卡片区以及文件夹右键菜单新增“导入作品”功能。
- 依据自定义章节命名规则智能识别、切分并批量生成 Markdown 章节文档。
- 支持.txt及.md文件，如果原作品是word并想保留格式，建议使用pandoc转换为md文档再导入

### 功能优化和BUG修复

- 优化章节模板功能，支持在设置中配置多个模板文件；配置多个模板时，创建下一章或工作台新增章节跳出弹窗选择模板，选择“不使用模板”或取消弹窗默认创建空白文档；单个模板时默认套用，无需弹窗
- 优化自动创建下一章和工作台新增章节的功能，自动匹配自定义章节规则
- 优化设置的相关功能，支持使用文件选择器进行文件夹或文件设置
- 优化了事件任务卡片在写作实时状态面板上的呈现形式
- 底层核心性能优化及相关 API 安全合规性整改


### English Changelog

#### Foreshadowing Board & Multi-Stage Resolution
- **Workbench Foreshadowing Board**: Added a dedicated Foreshadowing Board tab in Workbench with 3 categories (*Pending/Stage*, *Resolved*, and *Deprecated*), featuring real-time search filtering and collapsible sections.
- **Multi-Stage Resolution**: Track plot foreshadowing through progressive stages (`[Stage]`) until final resolution (`[Resolved]`), matching the organic flow of long-form storytelling.
- **Unified Smart Location & Highlight Engine**: Unified jump-and-highlight logic across Foreshadowing Board, Sidebar Views, Status View, Timeline, Lore Board, and Relation Graph. Automatically reuses open leaves, matches quotes via case-insensitive regex, and triggers line background flash animations.
- **Polished Board Visuals**: Refined margins, left-accent borders, and header typography across all board views for a seamless writing environment.

#### Import External Works
- Added "Import Novel" feature to the homepage work cards area and folder right-click context menus.
- Automatically parse, split, and batch-generate Markdown chapter files based on custom chapter naming rules.
- Supports `.txt` and `.md` files. If your original work is in Word format and you wish to preserve formatting, we recommend converting to `.md` using Pandoc before importing.

#### Optimizations & Bug Fixes
- **Multi-Template Support for Chapter Creation**: Enhanced chapter template functionality to support configuring multiple template files in settings. When multiple templates are configured, creating a new chapter (via command or Workbench) opens a template selection modal (selecting "Do not use template" or canceling defaults to a blank document); when 1 template exists, it is applied automatically without popups.
- **Dynamic Chapter Generation & Custom Rule Alignment**: Refactored next-chapter creation across commands and Workbench to automatically match custom chapter naming rules.
- **Enhanced Settings Manager**: Improved setting configurations with integrated Obsidian file/folder suggest modal pickers.
- **Status View Event Task Cards**: Refined presentation and layout of event task cards in the writing real-time Status View.
- **Performance & Compliance**: Core performance optimizations for vault traversal and cache building, along with API security compliance updates.

---

## ✨ v3.6.3

### 🚀 性能重构与体验优化
- **看板加载与切换极速提升**：重构了文件检索与页面渲染逻辑，解决了在含有大量笔记的仓库中切换时间轴看板时的卡顿问题。
- **防止频繁切换卡顿**：优化了后台数据保存与事件响应，快速点击或频繁切换面板时更加平滑顺畅。
- **工作台固定顶部导航**：工作台导航不会跟随页面滑动而消失，始终置顶，提供切换视图，搜索筛选等快捷功能。

### 核心功能与 UI 细节
- **双端分离右键与下拉菜单架构**：桌面端保持直观高效的平铺直达右键菜单；移动端/平板端右上角“更多选项”中仅占用 1 个入口 `网文助手 ▸`，展开进入原生二级折叠菜单，解决多插件菜单过长问题。
- **目标字数设定命令面板注册与移动端快捷工具栏开放**：将「设定本章目标字数」注册为全局命令（图标 `target`），支持直接固定到 Obsidian 移动端键盘快捷工具栏，1 秒直达。
- **工作台关键词搜索筛选与快捷键重构**：工作台新增搜索输入框，支持按标题、摘要或正文关键词实时过滤卡片。为了避免硬编码快捷键干扰输入框原生的撤销（Ctrl+Z）体验，本版本将清空动作注册为 Obsidian 原生命令「工作台：清空搜索筛选框」，您可在 Obsidian 设置▸快捷键中按需自定义快捷键，并保留按 `Esc` 键一键清空。（感谢社区贡献者 **@tyf2018** 提交的 [PR #13](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/pull/13)）
- **实时字数提醒主题色适配**：去除了字数提醒标签混入的固定 warning 颜色，使其完全跟随 Obsidian 当前主题的强调色（`--interactive-accent`）。
- **关系双链精准匹配**：在添加设定关系时改用 `[[设定文件#词条标题|显示名]]` 精准锚点链接，点击即可精确跳转至对应设定的标题位置，避免生成不必要的假文件。
- **调试模式设置开关**：在【数据输出 (OBS/叠加层)】设置页底部新增【开启调试模式】开关（桌面端），方便开启性能日志。
- **嵌套作品识别与去重防护**：主页看板支持自动搜寻多层嵌套目录下的作品，并修复了工作区目录配置重叠时重复显示卡片的问题。
- **平板端原生触控错位 Bug 规避建议**：由于 Obsidian 移动端底层引擎的原生 Bug，在平板横屏状态下“更多选项”菜单过长（多插件叠加时）会导致点击错位。在官方修复此问题前，建议您将常用功能（如“设定本章目标字数”）通过 Obsidian 设置固定到**底部移动端快捷工具栏**使用，以避免触发该 Bug。
- **UI 样式优化**：优化了任务卡片英文排版及按钮布局，适配调整了移动端与平板端时间轴卡片的展示比例。

### English Changelog

#### 🚀 Performance & UX Optimizations
- **Faster Board Loading & Switching**: Rebuilt file indexing and page rendering logic, eliminating lag when switching to the Timeline Board in large vaults.
- **Smoother Tab Switching**: Optimized background data saving and event triggers to prevent stutters during fast tab navigation.
- **Workbench Top Navigation Fixed**: Workbench navigation no longer disappears when scrolling and stays fixed at the top, providing quick access to switching views and other features.

#### Features & UI Polish
- **Dual-Mode Context Menu Architecture**: Maintained full flat context menus on desktop for max efficiency, while auto-folding into a neat `WebNovel Assistant ▸` submenu on mobile/tablet to eliminate excessive vertical scrolling.
- **Set Chapter Goal Command & Mobile Toolbar Support**: Registered "Set Chapter Word Goal" as a global command (`target` icon), enabling 1-click access via Obsidian Mobile Toolbar.
- **Workbench Keyword Filter & Hotkey Refactor ([#13](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/pull/13))**: Added a search bar to the Workbench to filter chapter and lore cards by keywords in real-time. To avoid hardcoded shortcuts interfering with native input undo (Ctrl+Z), the clear action is now registered as an Obsidian command (`Workbench: Clear Search Filter`), allowing custom hotkeys via Obsidian Settings ▸ Hotkeys while supporting `Esc` clear. (Special thanks to community contributor **@tyf2018** for [PR #13](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/pull/13)!)
- **Precise Heading Links for Lore Relations**: Updated relation links to use precise heading wikilinks (`[[File#Heading|Name]]`), navigating directly to heading sections without creating non-existent markdown files.
- **Tablet Touch Offset Native Bug Workaround**: Due to a native Obsidian engine bug, overly long "More options" menus on tablets (landscape mode) can cause touch offset issues. Until this is officially fixed, we highly recommend pinning frequently used commands (like "Set Chapter Goal") to the bottom **Mobile Toolbar** via Obsidian settings to avoid this bug.
- **Debug Mode Toggle**: Added **Enable Debug Mode** toggle under Data Output settings (Desktop) for performance logs.
- **Nested Novel Discovery**: Auto-detect novels inside multi-level nested folders, and fix duplicate chapter cards when workspace folders overlap.
- **UI Style Polish**: Compacted task card layouts and adjusted timeline chapter card dimensions on mobile and tablet.

---

## ✨ v3.6.2

### 官方审查合规修复 (Official Review Compliance)
- 移除 `manifest.json` 描述中冗余的 "in Obsidian" 单词，符合 Obsidian 官方审查规范。

### English Changelog

#### Official Review Compliance
- Removed redundant "in Obsidian" phrasing from `manifest.json` description to comply with official Obsidian review guidelines.

---

## ✨ v3.6.1 

### 功能优化
- **限时任务增加事件类型**：现在新增任务可以选择事件任务，无需设定字数目标与初始字数，需手动确认完成。
- **效率指标补充**：新增码字时速、任务达成和完结比例三个指标卡片，会在创作主页与写作数据追踪面板中自动计算并添加。
- **点击折叠**：全章节看板、设定看板、任务看板分栏标题全量支持点击平滑折叠/展开，并内置指示箭头。
- **中文分隔符全量兼容**：在插件设置面板中配置「工作区文件夹」及「严格章节模式例外目录」时，全面兼容中文全角逗号 `，`、全角分号 `；`、半角分号 `;`、顿号 `、` 以及换行符等多种常见分隔符，契合中文输入习惯。
- **UI优化**：优化了部分UI的显示效果。

### BUG修复

- 修复了写作实时状态面板中柱状图与指标不会实时更新的问题。
- 修复了开启工作台时，另外打开非工作区内文件，工作台会自动跟随切换的问题。

### English Changelog

#### Feature Optimizations
- **Event Tasks Support**: Added event task option when creating new tasks, requiring no word count targets or initial counts, with manual completion confirmation.
- **Efficiency Indicators**: Added Writing Speed, Task Completion, and Completed Ratio metric cards, automatically calculated and displayed on the Creative Homepage and Writing Data Tracker.
- **Click to Collapse**: Column headers on the All Chapters Board, Lore Board, and Task Board now support smooth click-to-collapse/expand with built-in indicator arrows.
- **Full Chinese Delimiter Support**: Workspace Folders and Strict Chapter Mode Exceptions in settings now fully support Chinese full-width commas `，`, full-width semicolons `；`, half-width semicolons `;`, enumeration dots `、`, and newlines for natural Chinese input habits.
- **UI Optimization**: Optimized display effects for various UI elements.

#### Bug Fixes
- Fixed an issue where bar charts and indicators in the real-time Writing Status Panel did not update in real-time.
- Fixed a bug where opening a file outside the workspace while Workbench was active caused Workbench to automatically switch its context.

---

## 🚀 v3.6.0 移动端新增专注计时支持

### 移动端设定速查与专注计时（实验性）

- **悬浮卡片**：移动端可单独选择是否启用，若不启用则只呈现虚线样式而不显示悬浮卡片
- **浮动统计**：专注计时状态将合并在浮动字数面板中，开启时请启用悬浮字数统计
- **数据互通**：移动端与电脑端的数据彼此互通，都能够实现数据面板的渲染
- **实验性**：由于移动端设备系统众多，两个功能均可能存在记录偏差或各种bug，谨慎开启

### 移动端UI全面重构和体验升级
- **创作主页**：调整了主页的布局，更适配窄屏幕
- **写作数据追踪面板**：修复了无法完整显示的BUG
- **时间轴看板**：优化布局，增加底部未关联章节悬浮窗，未关联章节面板不再遮挡时间轴
- **触摸优化**：减少了卡片移动时的阻塞感，让触摸移动拖拽更丝滑
- **添加快捷命令**：移动端现在支持使用命令添加时间线、标注伏笔和添加新设定

### 工作台优化升级

- **任务看板**：工作台增加任务看板视图，支持在工作台新增任务，取消了原侧面板挂载功能
- *新增*：任务现在支持自主放弃，毕竟完不成的事情大抵在一开始就已经知道了，继续下去不过苟延残喘自我欺骗罢了
- **便签管理**：你现在可以在工作台中直接管理所有打开的便签，支持关闭、编辑或者新建，完全同步
- **设定看板**：图谱动画效果和单独的设定图谱保持一致，增加双击跳转设定文档功能
- **添加新设定**：添加新设定面板增加预设的类型和关系可选项，无需在描述框中费劲地手写MD格式了

### 沉浸模式新增打字机滚动

- 新增沉浸模式下的打字机滚动功能，开启后仅在主编辑器启动 
- 在沉浸模式中移除了“写作工作台”组件，提升沉浸模式的纯净度
- 优化了沉浸模式下主编辑器与参考文档的切换逻辑，减少卡顿和错误

### 其他功能优化与修复

- 写作状态实时面板的章节部分增加了状态徽章和章节摘要，状态徽章可以点击切换，所有子模块支持点击折叠展开
- 尝试优化了启动和运行性能与速度，可能可以增加部分老旧设备的体验
- 优化了创作主页、工作台、写作数据面板的UI样式
- 修复了一些其他BUG

### English Changelog

#### Mobile Quick Lore & Focus Timer (Experimental)

- **Floating Cards**: Can be toggled independently on mobile devices. If disabled, only dashed underline styling is shown without popover cards.
- **Floating Stats**: Focus timer status is merged into the floating word count panel; please enable floating word count stats when using this feature.
- **Data Interoperability**: Data is fully synchronized between mobile and desktop devices, rendering statistics panels on both platforms.
- **Experimental**: Due to the wide variety of mobile OS devices, both features may have recording discrepancies or bugs. Please use with caution.

#### Mobile UI Overhaul & Experience Upgrade

- **Novel Homepage**: Adjusted homepage layout for better narrow screen compatibility.
- **Writing Data Tracker**: Fixed a bug where the panel could not display completely.
- **Timeline Board**: Optimized layout and added a floating window for unlinked chapters at the bottom, so unlinked chapters no longer obscure the timeline.
- **Touch Optimization**: Reduced resistance during card movement for smoother touch dragging and dropping.
- **Quick Commands**: Mobile now supports commands to add timeline events, mark foreshadowing, and add new lore.

#### Workbench Optimization & Upgrade

- **Task Board**: Added Task Board view to the workbench, supporting task creation directly in the workbench and removing the original sidebar tab mounting.
- *New*: Tasks can now be voluntarily abandoned—after all, tasks destined to remain incomplete are often recognized early on, and persisting is merely lingering self-deception.
- **Sticky Notes Management**: You can now manage all open sticky notes directly in the workbench, supporting closing, editing, or creating new ones with full synchronization.
- **Lore Board**: Graph animations are aligned with the standalone Lore Graph, and double-clicking to jump to lore documents is now supported.
- **Add New Lore**: Added preset type and relation options to the "Add New Lore" modal, eliminating the need to manually write MD format in description fields.

#### Typewriter Scroll in Immersive Mode

- Added typewriter scrolling feature to Immersive Mode, active only in the main editor when enabled.
- Removed the "Writing Workbench" component from Immersive Mode to keep the mode clean and focused.
- Optimized tab switching logic between the main editor and reference documents in Immersive Mode, reducing lag and errors.

#### Other Optimizations & Fixes

- Added status badges and chapter summaries to the chapter section of the real-time Writing Status panel. Status badges can be clicked to toggle, and all sub-modules support click-to-collapse/expand.
- Attempted performance and speed optimizations for startup and runtime, potentially improving experience on older devices.
- Optimized UI styling for Novel Homepage, Workbench, and Writing Data panel.
- Fixed various other bugs.

---

## 🔧 v3.5.6

- 修复了一些代码问题。
- Fixed some code issues.

---

## 🔧 v3.5.5

- 修复了非章节文档也会自动统计“设定”出场次数的BUG
- 修复了部分代码会触发官方审查拦截的问题。

### English Changelog

- Fixed a bug where non-chapter documents would also automatically count the number of "Lore" appearances.
- Fixed a bug where some code triggered official review interception.

---

## ✨ v3.5.4

### 工作台优化升级

- **全章节模式**：支持手动拖拽排序，如果章节存在序号，拖拽后会自动重命名后续章节，方便在开文阶段整理，不支持跨卷拖动；
  *注意*：当章节内已有正文内容时慎用，有概率引发意想不到的BUG。
- **时间轴看板**：增加事件卡片的拖拽响应，现在你可以把事件拖拽到任何时间节点下并支持重新排序；单章节关联多个事件时且事件节点本身不相连时，会固定在第一个事件右侧，对其他事件进行虚线连接。
- **设定看板**：在原有表格视图的基础上，增加了卡片视图和全量设定图谱视图（无视设置），可在看板内切换，卡片视图下支持快速编辑设定和拖动排序，不支持跨文件拖动；看板下的设定图谱仅供查看，不支持双击跳转文档。
- **章节卡片**：增加了“已回收”状态徽章，同步显示在写作状态侧面板，支持文本高亮跳转

### 功能优化与修复

- 优化了设定悬浮卡片的最大高度和防遮挡逻辑，改善低分辨率屏幕的使用体验
- 优化了移动端写作工作台布局，按钮不再遮挡标题
- 优化了实时字数提醒的徽章样式，让字数保持居中显示
- 修改了插件的默认章节规则，仅限首次安装生效，已安装升级不受影响
- 修复了智能创建章节的正则表达式解析bug，现在即使你的章节序号被括号包裹，如（1）,也能正确创建下一章节
- 修复了在工作台新建章节时，自动命名空格会越来越多的BUG
- 修复了工作台章节卡片上的伏笔相关徽章悬浮内容过长时，可能会溢出屏幕的BUG
- 修复了章节名为繁体大写数字但自动创建下一章为简体大写数字的BUG
- 修复了如果章节命名时尾部有多余空格，无法通过时间线看板解除事件关联的BUG
- 修复了写作状态面板中的“待回收”伏笔点击偶尔无法触发跳转的BUG
- 修复了移动端工作台卡片拖拽不生效的BUG（部分设备可能仍然存在问题，请提交Issue反馈）

### English Changelog

#### Workbench Optimization

- **All Chapters Board**: Supported manual drag-and-drop reordering. If chapters have sequential numbers, dragging will automatically rename subsequent chapters, making it convenient to organize during the initial writing phase. Cross-volume dragging is not supported.
  *Note*: Use with caution when chapters already contain text content, as it may cause unexpected bugs.
- **Timeline Board**: Added drag-and-drop response for event cards. You can now drag events under any time node and reorder them. When a single chapter is associated with multiple disconnected event nodes, it will be fixed to the right of the first event, with dashed lines connecting to the other events.
- **Lore Board**: Added Card View and Full Lore Graph View (ignoring settings) alongside the original Table View, switchable within the board. The Card View supports quick editing and drag-and-drop sorting (cross-file dragging is not supported). The Lore Graph within the board is for viewing only and does not support double-click document jumping.
- **Chapter Cards**: Added "Resolved" status badge for foreshadowing, synchronously displayed in the writing status side panel, supporting text highlight jumping.

#### Features and Fixes

- Optimized the maximum height and anti-occlusion logic of lore hover cards, improving the experience on low-resolution screens.
- Optimized the mobile writing workbench layout; buttons no longer overlap the title.
- Optimized the real-time word count reminder badge style to keep the text vertically centered.
- Modified the default chapter rules of the plugin to take effect only on initial installation, without affecting existing installations.
- Fixed a regex parsing bug in smart chapter creation; now it can correctly create the next chapter even if your chapter number is enclosed in parentheses, such as `(1)`.
- Fixed a bug where creating new chapters in the workbench would progressively add more trailing spaces to the auto-generated name.
- Fixed a bug where excessively long hover content on foreshadowing badges on chapter cards might overflow the screen.
- Fixed a bug where chapter names with Traditional Chinese uppercase numbers would incorrectly generate the next chapter with Simplified Chinese uppercase numbers.
- Fixed a bug where trailing spaces in chapter names prevented unlinking events via the timeline board.
- Fixed a bug where clicking "Unresolved" foreshadowing in the writing status panel occasionally failed to trigger the jump.
- Fixed a bug where card dragging in the mobile workbench was unresponsive (some devices might still experience issues, please submit an Issue report).

---

## 🔧 v3.5.3

- 修复了新建文件夹重命名时被打断的BUG
- 修复了初次安装时，如果有已开启的文档，则启用失败的BUG
- 优化了实时字数提醒功能，现在它提示的位置会更加精准

### English Changelog

- Fixed a bug where renaming a newly created folder was interrupted.
- Fixed a bug where if an already enabled document exists during initial installation, it fails to activate.
- Optimized the real-time word count reminder feature to display at a more precise location.


## 🔧 v3.5.2

- 修复了部分已知 Bug。

### English Changelog

- Fixed some known bugs.

## 🔧 v3.5.1

- 统一了在不同位置下相同功能的描述文本，减少因描述不同而导致的理解门槛；统一了新增时间线节点的弹窗逻辑。
- 优化了文档打开逻辑：工作区点击章节标题、设定看板点击设定、以及设定速查悬浮卡片点击标题，均默认在左右分屏的新窗口打开，方便对照编辑。
- 设定面板和悬浮卡片点击设定跳转时，现在能够直接定位到设定文件中的对应标题位置了。
- 优化了沉浸模式的章节列表：现在会锁定显示当前小说的根目录，不会再因为切换了外部参考文档而乱跳，同时支持树状展示目录内的所有文件夹（如“设定”等），方便直接作为参考打开。
- 修改了部分CSS类名，避免和其他插件产生冲突，解决部分主题下样式会出现错误的问题。
- 优化了写作工作台，自动区分分卷章节，事件卡片可在看板内删除，修改了样式，整体设计更精致现代。
- 添加了章节模板功能，默认关闭，在设置中启用并指定模板后，新增章节与自动创建下一章功能均会自动按照模板生成。

### English Changelog

- Unified descriptive text for identical functions across different locations to reduce comprehension barriers; unified the logic for the "add timeline node" modal.
- Optimized document opening logic: clicking chapter titles in the workbench, lore in the Lore Board, and titles in the Quick Lore floating card will now open in a split-pane by default for easier side-by-side editing.
- Clicking on a lore entry in the lore panel or floating card now directly scrolls to the corresponding heading in the lore file.
- Optimized the chapter list in Immersive Mode: it now locks to the root directory of the current novel, preventing jumping when switching to external reference documents. It also supports tree-view display for all folders (like "Lore") within the directory, making them easy to open as references.
- Modified some CSS class names to avoid conflicts with other plugins, fixing styling issues in certain themes.
- Optimized the Writing Workbench to automatically distinguish volume chapters, allow deleting event cards within the board, modify styles, and present a more refined and modern overall design.
- Added Chapter Template feature (disabled by default). Once enabled and configured in settings, creating a new chapter or using the "Create Next Chapter" command will automatically generate content based on the template.


## 🚀 v3.5.0 写作工作台全新上线

### 新增写作工作台

- 由原“章节一览”升级而来，现在可以通过工作台快速创建章节，填写章节摘要，切换作品状态
- 章节卡片自动关联出现的设定与伏笔，一个面板全面掌握作品信息
- 工作台新增时间轴看板，支持手动拖拽章节卡片到事件节点，支持时间线面板联动排序筛选，自动关联事件
- 新增设定看板，在工作台内可以看到所有设定的出场次数和出场章节，以及设定之间的关系，添加新设定
- 原“章节一览”面板仍支持挂载在侧面板和作为沉浸模式组件添加

### 功能优化与修复

- 设定图谱现在支持跨文件关联！在设置-创作辅助中启用
- 写作实时状态面板中增加章节状态一览，可以快速查看该章节未回收的伏笔及关联设定
- 沉浸模式的章节列表中显示对应章节的伏笔及关联设定
- 修复了创作主页中关于效率部分描述错误的问题

### New Writing Workbench

- Upgraded from the original "Chapter Overview", you can now quickly create chapters, fill in chapter synopsis, and switch novel statuses directly from the workbench.
- Chapter cards automatically associate with appearing lore and foreshadowing, giving you a comprehensive grasp of your novel's information in one panel.
- Added Timeline Board to the workbench: supports manually dragging chapter cards to event nodes, synchronizes sorting and filtering with the timeline panel, and automatically links events.
- Added Lore Board: view appearance counts and chapters for all lore, check relationships between lore, and add new lore directly within the workbench.
- The original "Chapter Overview" panel is still supported as a sidebar view and can be added as an Immersive Mode component.

### Optimizations & Bug Fixes

- The Lore Graph now supports cross-file associations! Enable this feature in Settings - Writing Assistance.
- Added a chapter status overview to the Writing Status panel, allowing you to quickly check unrecovered foreshadowing and associated lore for the current chapter.
- Immersive Mode chapter list now displays the foreshadowing and associated lore for each chapter.
- Fixed an incorrect description regarding efficiency on the Novel Homepage.

## ✨ v3.4.2

- 章节一览重构为双模式（全章节 / 时间轴看板）。
- 时间轴看板支持按章节设定中的时间线事件对章节进行分组聚合。
- 支持在章节一览中点击标题旁的编辑图标直接进行快速重命名。
- 新增“自动关联提及”设置项：设定图谱现支持关闭隐式提及连线，仅显示明确定义的关系，让图谱更清爽精准。

- The Corkboard is now dual-mode (All Chapters / Timeline Board).
- The Timeline Board supports grouping chapters by timeline events set in chapter frontmatter.
- Support for quick renaming chapters directly from the Corkboard by clicking the edit icon.
- Added "Auto-Link Mentions" toggle: The lore graph now supports disabling implicit mention connections, displaying only explicitly defined relationships for a cleaner and more precise graph.

## 🔧 v3.4.1

- 优化设定图谱渲染样式和动画，标签或节点有重叠时，会自动透明化下层节点
- 修复移动端因为无法设置设定文件夹而无法触发设定图谱的BUG

- Optimize lore graph rendering style and animation: when labels or nodes overlap, the underlying node will be automatically transparent
- Fix: Fix a bug where the lore graph could not be triggered on mobile devices because the setting folder could not be set


## 🚀 v3.4.0 设定图谱 (Lore Graph) 全新上线

### 新增设定图谱自动生成功能
- **角色关系可视化**：一键生成角色的关系图谱，理清复杂人物网络！
- **智能解析与手动定义**：在设定文件夹内右键开启，插件会自动关联文中的互相提及。你也可以在角色的 ### 关系 子标题下手动定义带有标签的显式关系。
- **拓展性强**：除了人物，该功能理论上也支持物品、地点等其他分类设定，你可以根据需求自由发挥。

### 其他优化
- **悬浮卡片折叠**：由于设定卡片内容可能较长，现支持在设置中开启“子标题折叠”功能，开启后卡片内的子段落将默认折叠，点击即可展开，方便查阅。
- **辅助视图增强**：沉浸模式下的侧边栏现已支持添加 Obsidian 原生的“大纲 (Outline)”视图。
- **字数统计规则升级**：提升了自定义章节规则的优先级。现在，只要将文件（如时间线、伏笔、设定等文档）名称加入自定义章节规则，它们便能突破硬编码限制，被正常纳入字数统计中。
- **手机端设置界面优化**：修复了手机无法看到当前启用的章节规则的BUG。

### New Lore Graph Feature
- **Relationship Visualization**: Generate a relationship graph for your characters with a single click to easily manage complex character networks!
- **Smart Parsing & Explicit Definitions**: Right-click any lore document to open the graph. The plugin will automatically connect mutually mentioned characters. You can also explicitly define labeled relationships using a ### Relations (or ### 关系) subheading.
- **Highly Extensible**: While designed for characters, this feature theoretically supports items, locations, and other lore types—feel free to use it creatively!

### Other Optimizations
- **Collapsible Lore Popovers**: To better handle lengthy lore cards, you can now enable "Subtitle Folding" in the settings. When enabled, subheadings inside hover cards will be collapsed by default and can be expanded on click for easier reading.
- **Enhanced Auxiliary Views**: Immersive Mode now supports adding the native Obsidian "Outline" view to the sidebar.
- **Upgraded Word Count Logic**: Elevated the priority of custom chapter rules. You can now track word counts for normally excluded documents (like timelines, foreshadowing, or lore files) by simply adding their names to your custom chapter matching rules.
- **Mobile Settings Optimization**: Fixed an bug on mobile where the currently enabled chapter rules were not visible.

## 🔧 v3.3.3

- 修复伏笔无法废弃和回收的BUG
- fix: Fixed an bug where lore could not be discarded and recycled

## 🔧 v3.3.2

- 优化超长篇工作逻辑：当单本小说下存在多个分卷文件夹时，会自动向上遍历并定位到作品信息所在的文件夹作为小说目录，新建时间线/伏笔/设定/任务等文档时不会在卷文件夹下重复创建，合并章节时会自动添加卷信息
- 优化章节读取规则：开启严格章节模式后，在进行伏笔面板回收选择章节、新增时间线关联章节等操作时，会自动忽略非章节文档并按智能顺序进行排列

- optimize ultra-long-form novel workflow: when there are multiple volume folders under a single novel, the plugin will automatically traverse upward to locate the folder containing the novel information as the novel directory. New timeline/lore/setting/task documents will not be created repeatedly under volume folders, and volume information will be automatically added when merging chapters
- optimize chapter reading rules: when strict chapter mode is enabled, the plugin will automatically ignore non-chapter documents and sort them in smart order when performing actions such as selecting chapters in the lore panel or adding timeline-related chapters


## ✨ v3.3.1 时间线与伏笔增强

- 增加“添加时间线”命令，方便移动端操作
- 时间线现在可以定位到添加时选中的原文段落并高亮显示（仅支持新添加时间线跳转，如果旧时间线想兼容可以参考线格式自行添加原文）
- 伏笔.md 格式升级，现在采用说明作为标题而非首次添加的章节名，提升阅读体验；旧的伏笔条目会在添加新的合并内容时自动升级为新格式，并兼容老版格式

- add timeline command for mobile devices
- timelines can now link to the selected paragraph in the original text and highlight it (only supports new timelines; old timelines can be upgraded by manually adding the original text according to the timeline format)
- lore.md format upgrade: the description is now used as the title instead of the chapter name when it was first added, improving the reading experience; old lore entries will be automatically upgraded to the new format when adding new merged content, and are compatible with the old version

## 🔧 v3.3.0

- 修复了英文环境下，伏笔面板的描述错误
- 优化了字数计算的实现方式，可能可以解决部分字数显示bug
- 修复部分UI界面内的显示错误

- fix: Fixed an error in the description of the Lore panel in English environment
- optimize: Optimized the implementation of word count calculation, which may solve some word count display bugs
- fix: Fixed some display errors in the UI

## 🔧 v3.2.9

### 修复若干bug和优化部分功能

- 修复了在未开启严格章节模式的情况下，部分功能仍只匹配章节文档的BUG
- 修复了删除文件夹下章节文件时，文件夹无法自动重新计算字数，也不会记录字数减少的bug
- 为移动端注册“重建文件夹字数缓存”的命令，方便出现计算错误时重置缓存
- 优化“合并章节”功能，正文内仅显示小说名作为一级标题
- 优化部分UI显示，配色更柔和

---

### Fixes and Optimizations

- Fixed an issue where some features still only matched chapter files when strict chapter mode was not enabled
- Fixed a bug where a folder would not automatically recalculate its word count when chapter files within it were deleted, and would not record the decrease in word count
- Registered a "Rebuild Folder Word Count Cache" command for mobile devices to easily reset the cache when calculation errors occur
- Optimized "Merge Chapter" function to only show the novel title as a level 1 heading in the main text
- Optimized UI display for a softer color scheme

## 🔧 v3.2.8

- 修复非专注计时状态下本场净增仍在增加的BUG
- fixed a bug where the net increase in word count continued to increase in non-focus mode

## 🔧 v3.2.7

- 修复了众多字数统计和显示上的bug
- Fix: Fixed various bugs in word count statistics and display.


## 🔧 v3.2.6

- 修复了新创建或被其他设备（如 Obsidian Sync）后台同步修改的文件在未点开前不会自动统计字数的 BUG
- 修复沉浸模式中被设置成参考文档的章节在退出后不计算字数的 BUG

---

- Fix: Fixed an issue where newly created files or files modified in the background via other devices (e.g., Obsidian Sync) would not update their word count automatically until opened.
- Fix: Fixed a bug where the word count of chapters set as reference documents in Immersive Mode was not calculated after exiting the mode.


## ✨ v3.2.5

- **新增**：框选任意文本即可在光标附近悬浮显示选中字数。可在设置中开启或关闭，与设置的统计方式一致。
- **修复**：修复了打开四面插槽后沉浸模式布局记忆不准确的BUG
- **优化**：优化沉浸模式布局及显示样式，当前聚焦卡片高亮显示，参考文档会自动记录上次打开的文件

---

- **Feature**: Selecting any text now displays a floating word count tooltip near the cursor. This can be toggled in settings and is consistent with your chosen counting method.
- **Fix**: Fixed a bug where Immersive Mode layout ratios were not remembered accurately when slots on all four sides were opened.
- **Optimize**: Optimized Immersive Mode layout and display styles. The currently focused card is now visually highlighted, and the reference document view automatically remembers the last opened file.


## 🔧 v3.2.4

- 优化部分代码，提升使用体验
- Optimized some code to improve user experience

## 🔧 v3.2.3

### ⚡ 设定速查卡片增强

- 全面重构卡片样式，脱离 Obsidian 原生预览机制，采用全新极简徽章设计
- 新增悬停 1 秒防误触延迟，且不再受原生选项（需按住 Ctrl）的限制

---

### ⚡ Enhanced Lore Cards

- Completely refactored the card style, breaking away from the native Obsidian preview to introduce a clean, black-and-white badge design.
- Added a 1-second hover delay to prevent accidental triggers. It is also no longer restricted by the native "Require Ctrl" option.

## 🔧 v3.2.2

### 🐞 问题修复
- 修复了在设置中更改工作区文件夹后，创作主页（Homepage）文件未能跟随移动，导致可能在旧文件夹下重复创建新主页的 Bug。现在更改工作区时，主页将自动移动到新目录。

### ⚡ 高级搜索增强
- 现在高级搜索会自动记忆您上一次输入的搜索词，无需重复输入
- 点击搜索结果跳转到对应章节时，搜索面板将保持打开状态，方便您连续查看多个匹配结果

---

### 🐞 Bug Fixes
- Fixed a bug where changing the workspace folder in settings would not move the Homepage file, causing it to be recreated in the old folder. The Homepage now automatically moves to the new directory when changing the workspace.

### ⚡ Advanced Search Enhanced
- The advanced search panel now automatically remembers your last used search keyword
- Clicking a search result will no longer close the search panel by default, allowing you to easily check multiple matching chapters in a row

## 🔧 v3.2.1

- 修复因添加英语支持而造成的部分页面显示问题
- 调整作品信息的设置选项至通用栏
- 修复在作品中右键添加新设定无法按照自定义文件夹名创建目录的BUG

- Fixed display issues caused by the addition of English support
- Moved the novel info filename setting to the General section
- Fixed a bug where right-click "Add New Lore" created folders using the default name instead of the custom name

## 🚀 v3.2.0

本次更新全面支持英文环境！

### ✨ 新增双语支持
- **自动匹配系统语言**：首次安装自动检测 Obsidian 语言设置，中文环境显示中文，其他环境显示英文
- **完整英文体验**：所有面板、弹窗、文档标签、状态值均已翻译
- **语言切换无缝衔接**：切换语言后保留自定义文档名，自动匹配旧语言文档，不会重复生成
- **跨语言文档兼容**：英文模式下可识别中文旧文档（如 `伏笔.md`），中文模式也可识别英文文档

### ⚡ 使用体验优化
- **文档自动重命名**：在设置中修改默认文档名时，自动批量重命名所有工作区下的旧文档
- **限时任务追踪**：「榜单追踪」更名为「限时任务追踪」，适配更多创作场景
- **标签分隔符改进**：伏笔标签改为逗号分隔（如 `#人物, #情节`），对英文标签更友好，旧数据自动兼容

---

This update brings full English language support!

### ✨ New Bilingual Support
- **Auto-detect system language**: On first install, the plugin detects your Obsidian language — Chinese environments get Chinese UI, all others get English
- **Complete English experience**: All panels, dialogs, document labels, and status values are fully translated
- **Seamless language switching**: Changing language preserves your custom document names and auto-matches old-language documents — no duplicate files generated
- **Cross-language document compatibility**: English mode can read Chinese documents (e.g. `伏笔.md`), and vice versa

### ⚡ Experience Improvements
- **Auto-rename on settings change**: Changing default document names in settings now automatically renames all existing documents across your workspaces
- **Timed Task Tracker**: "Ranking Tracker" is now "Timed Task Tracker", better suited for broader writing scenarios
- **Improved tag separator**: Foreshadowing tags now use comma separation (e.g. `#Character, #Plot`) — friendlier for English tags, with backward compatibility for old space-separated data

## 🔧 v3.1.2

- 移除不必要的 eslint-disable 注释

## 🔧 v3.1.1

- 修复因代码迁移导致的部分显示BUG

## 🔧 v3.1.0

- 修复合并章节功能会自动增加文档属性的bug

## 🚀 v3.0.0

本次更新带来了重磅升级！

### ✨ 章节一览（大纲视图）
- **章节卡片瀑布流**：新增独立的「章节一览」视图，将当前作品所有的章节以卡片形式直观排列。
- **无缝大纲编辑**：点击卡片可直接编辑该章的摘要大纲（自动存入文件属性中），方便随时梳理剧情主线。
- **写作状态标记**：支持通过卡片快速修改章节进度（待写、大纲、草稿、修稿中、已完稿）。

### ✨ 设定速查（卡片悬浮预览）
- **多词条设定库**：只需在设定文件夹下创建分类文档（如 `角色志.md`），插件即可自动扫描识别。
- **自动标记**：在分类文档中使用二级标题（`##`）创建设定词条，并在正文补充 `**别名**: xxx`。当你在小说正文敲出这些名字时，系统自动打上虚线下划线。
- **悬浮速查**：鼠标悬停在标记的文本上，即可瞬间弹出精准定位到该词条的小窗口，让你无需切出编辑页就能查看设定内容（打开核心插件的页面预览功能）。
- **右键“边写边建”**：灵感来了？在编辑器中直接划选一个新道具或角色的名字，右键点击“添加为新设定”，即可在弹窗中极速录入并自动将其保存到指定的设定文档中。

### ⚡ 功能与体验升级
- **沉浸模式重构**：升级为全自由的插槽架构，支持上下左右四个区域挂载面板。
- **字数统计模式切换**：新增标准模式（文档工具常用的字数方案，英文以词组计算，半角符号不计入）以及 Obsidian 原生（仅统计词数）两种统计模式以供切换。

## 🔧 v2.6.4

- 优化移动端（手机/平板）使用体验
- 修复部分已知BUG

## 🔧 v2.6.3

- 伏笔面板的跳转现在可以定位到精确段落并高亮显示

## 🚀 v2.6.2

- 新增高级搜索功能：支持当前书籍/全局/自定义范围搜索，树形目录多选

## 🔧 v2.6.1

- 修复手动拖拽排序时出现的列表闪烁问题
- 移除了数据输出文本文件的兼容功能，提升本地安全性
- 去除适配打字机模式（typewriter scroll）的功能，推荐安装typewriter mode以获得更好的打字机体验
- 新增创作主页自定义功能
- 优化部分功能细节


## 🚀 v2.6.0

### ✨ 全新创作主页

- 2行×2列网格布局：欢迎语+连载中 / 作品区 / 数据区（效率总览、热力图、趋势图）
- 全宽填满编辑器可视区域，窄屏自动切换单列布局，适配手机与平板
- 欢迎语随时间段变化，显示总字数与今日新增，右侧新增作品按钮
- 连载中显示榜单追踪进度（如开启），已完结/存稿中/已暂停卡片横向滚动
- 支持将 `创作主页.md` 永远固定在文件列表的最顶端或最底端，避免新增作品时被自动排序冲走
- **新增作品弹窗**: 填写名称、简介、类型、总字数目标，自动创建作品文件夹和信息文件
- 开启时在单本创作目录下新增“作品信息.md"，记录作品基本信息和数据

### ✨ 其他优化

- 新增“显示/隐藏所有悬浮便签”命令，保留隐藏前所有便签的布局、状态数据以及设置持久化
- 严格章节模式下新增例外目录设置，可将短篇/杂谈之类的目录设置为例外，整个目录内的文档都会作为章节计算
- 优化了移动端（手机/平板）的相关设置界面
- **新增拖拽自定义排序功能**：非章节文件和章节区块均可拖拽调整顺序，章节区块整体移动
- 沉浸模式文件列表高亮显示当前编辑文档

### ✨ 修复BUG
- 修复了关闭插件后无法完全卸载悬浮便签的BUG
- 修复了沉浸模式下文件列表自动跳转回开头的BUG

---

## 🚀 v2.5.0

### ✨ 榜单追踪系统

- 新增榜单追踪功能：右键菜单「开启榜单追踪」，填写平台、期数、起止时间、字数要求后自动生成追踪文件
- 榜单侧面板实时显示当前进度、剩余天数、历史记录
- 写作状态面板增加榜单进度卡片，含进度条与截止时间提示
- 写作状态面板增加当前作品信息，显示所在目录名与总字数
- 沉浸模式顶部状态栏增加榜单进度显示
- 周期到期自动关闭追踪并记录完成情况，支持「新增榜单」期数自动递增
- 新增榜单时可查看并手动修改起始字数，方便衔接上一期
- 进行中榜单进度实时持久化到榜单记录文件
- 榜单达标时状态面板与榜单面板显示高亮提示

### 🔧 修复与优化

- 修复智能章节排序在部分环境失效的问题
- 面板显示持久化，UI稳定性提升
- 伏笔和时间线自定义标签/类型不再自动同步保存到设置，独立存储于当前目录下，可以在设置中自定义全局标签/类型，而在单个目录中添加特有标签/类型
- 伏笔标注弹窗快捷按钮合并显示全局默认标签与当前小说已有标签
- 文件浏览器现在显示精准字数，并只统计章节文档，方便实时查看全文字数
- 榜单、伏笔、时间线文件写入全部采用串行写入器，防止并发写入导致文件损坏
- 严格章节模式下缓存重建时清除旧缓存，避免非章节文件残留

---

## 🚀 v2.4.0

### ⚡ 面板UI优化

- 统一遵循主题色设计，提升整体视觉体验

### ✨ 历史统计面板全面升级

- 历史统计面板更名为“写作数据追踪”
- 新增创作天数、专注效率、活跃时段、日均字数等数据实时查看
- 新增365热力图，一年数据尽在掌握

---

## 🔧 v2.3.1

### ⚡ 优化
- **设置面板重构**: 重新组织设置选项卡分类，逻辑更清晰
  - 通用：工作区文件夹、严格章节模式、智能排序规则、护眼模式
  - 字数统计：状态栏进度、文件列表字数、字数实时提醒、写作目标
  - 创作辅助：悬浮便签、伏笔标注、时间线
  - 沉浸模式、数据输出保持不变
- **字数提醒标签位置修复**: 修复字数提醒标签在沉浸模式和编辑时位置偏差的问题

---

## 🚀 v2.3.0

### ✨ 新增
- **便签文档同步按钮**: 悬浮便签新增同步按钮，可一键从关联文档同步最新内容到便签窗口
- **伏笔标签筛选**: 伏笔面板新增按标签筛选，支持与状态筛选组合使用
- **时间线类型筛选**: 时间线面板新增按类型筛选事件

### ⚡ 优化
- **智能排序支持文件夹**: 文件夹（如"第1卷"）现在也能参与章节排序，同编号文件夹排在文件前
- **非工作区文件显示字数**: 不在工作区范围内的文件仍会在状态栏显示基本字数（不含追踪和进度）
- **合并章节优化**: 合并文件输出到文件夹内部，重复合并时自动覆盖已有文件
- 修复部分BUG，优化功能体验

---

## 🔧 v2.2.2 - 修复版本更新导致的伏笔标注失败BUG

---

## 🚀 v2.2.1 - 字数实时提醒与严格章节模式增强

### ✨ 新增功能
- **复制本文档**: 全平台支持一键复制当前文档，并在首行自动添加标题与空行
- **字数实时提醒**: 在编辑器左侧实时显示累计字数提醒，支持自定义间隔
- **严格章节模式**: 限制字数统计、进度追踪等功能仅在符合命名规则的章节文档中生效
- **具名章节支持**: 排序规则支持“大纲”、“番外”等不带数字的特殊章节，并纳入字数统计（需开启相关规则）
- **规则排序优化**: 设置页面支持通过 ▲/▼ 按钮自由调整排序规则的优先级

### ⚡ 优化与修复
- **字数统计稳定性**: 采用编辑器事件与文件系统双重校验架构，引入时间戳守卫，彻底解决重命名、启动扫描或自动保存导致的字数统计跳变/重复计算问题
- **悬浮便签增强**: 修复悬浮便签在部分输入法下的中文输入兼容性问题，优化进入沉浸模式时的内容强制持久化
- **逻辑统一**: 统一使用 `isEligibleForWordCount` 逻辑校验文件合法性
- **性能优化**: 优化文件夹字数缓存的批量扫描逻辑，支持更大规模的库文件统计

---

## 🚀 v2.2.0 - 新增沉浸写作模式！

### ✨ 新增功能
- **沉浸式写作模式**: 全屏专注创作，隐藏所有干扰元素，自定义面板显示，进入时自动计时
- **选项卡式设置页面**: 全新模块化交互，选项卡式分类，查找更高效
- **历史统计维度增强**: 增加更多历史统计呈现的数据类型，精细化记录每日写作点滴


### ⚡ 优化与修复
- **存储机制**: 字数缓存数据正式独立存储于 `cache-data.json`，提升启动速度与运行稳定性
- **悬浮便签**: 悬浮便签现在可以在设置中开启自动保存，同时新建悬浮便签缓存文件`note-data.json`，打开的便签即使未保存，只要没有关闭，也能在重启软件时保留文本状态

---



## 🔧 v2.1.4 - 数据安全与代码质量提升

### 数据安全与稳定性

- 历史数据独立管理（从data.json迁移到history-data.json）
- 正则表达式状态泄漏修复
- 使用体验细节优化

### 升级说明

- **自动迁移**: 从 v2.1.3 升级无需任何操作，历史数据自动迁移
- **降级安全**: 可安全降级到 v2.1.3，旧数据仍保留在 `data.json` 中
- **数据备份**: 建议升级前备份 `.obsidian/plugins/web-novel-assistant/data.json`
- **重启建议**: 升级后建议重启 Obsidian 以确保所有功能正常工作

---

## 🔧 v2.1.3 - 优化功能

### 修复
- 修复部分bug

### 优化
- 优化 UI，使用更简洁的格式
- 字数面板现在可以统计负增长（修文或删除章节时会计负数）
- 合并章节不加入统计

---

## 🔧 v2.1.2 - Bug 修复

### 修复
- 修复悬浮便签编辑时按空格或回车会自动跳转到底层编辑器的问题

---

## 🔧 v2.1.1 - Bug 修复与性能优化

### 修复
- 修复事件监听器泄漏问题
- 修复 OBS CSS 注入安全漏洞
- 修复 OBS HTML 模板 CSS 语法错误
- 修复重复的定时器注册
- 修复智能排序禁用后无法恢复原始排序
- 修复悬浮便签编辑时无法输入空格和回车的问题

### 优化
- 删除未使用的死代码
- 优化伏笔正则表达式缓存（LRU 限制 100 个）
- 优化护眼模式样式管理
- 优化字数统计性能

---

## 🎯 v2.1.0 - 功能增强与体验优化

### 新增功能

#### 工作区设置
- **文件夹限定**: 可指定插件工作的文件夹，留空则全局生效
- **多文件夹支持**: 支持设置多个工作区文件夹，用逗号分隔
- **灵活控制**: 适合多项目管理，不同项目使用不同设置

#### 伏笔多章节关联回收
- **多章节回收**: 回收伏笔时可以关联多个章节
- **列表选择**: 支持从章节列表中多选回收章节
- **手动输入**: 支持手动输入多个章节名，用逗号或空格分隔
- **向后兼容**: 完全兼容旧版单章节回收格式

#### 章节命名规则自定义
- **自定义规则**: 支持自定义章节命名规则（正则表达式）
- **规则排序**: 规则按顺序匹配，决定大块排序
- **启用/禁用**: 每个规则可单独启用或禁用
- **预设模板**: 提供常用模板（阿拉伯数字、中文数字、纯数字）
- **智能合并**: 合并章节时只导出匹配规则的章节

#### 移动端复制全文
- **解决限制**: 解决 Obsidian 移动端全选只能选择可视范围的问题
- **命令面板**: 通过命令面板或文件菜单调用
- **完整复制**: 无论文档多长，都能完整复制

### 功能修复

#### 文件列表字数刷新
- **自动刷新**: 修改文档名后字数统计自动刷新
- **合并刷新**: 合并章节后字数统计自动更新
- **实时同步**: 文件重命名和创建事件实时监听

#### 中文章节排序
- **扩展支持**: 中文数字支持范围扩展到一到九百九十九
- **修复乱码**: 修复正则表达式缺少"零"字符导致的匹配错误
- **修复合并**: 修复合并章节时排序不正确的问题

#### 时间线视图
- **修复刷新**: 添加 100ms 延迟确保文件写入完成后再刷新
- **关联章节**: 修复右键添加时间线时关联章节不显示的问题

### 移动端优化
- **状态栏优化**: 移动端启用浮动窗口时自动隐藏状态栏
- **设置页面优化**: 移动端隐藏"显示目标进度"设置
- **写作状态面板优化**: 移动端隐藏时间追踪功能
- **文件浏览器字数统计**: 修复移动端需要重新开关才能显示的问题

### 文档完善
- **用户指南**: 新增完整的用户使用指南 (USER_GUIDE.md)
- **编码规范**: 创建 .editorconfig 文件统一编码
- **README 精简**: 精简 README，详细功能说明查看用户指南

### 默认设置调整
- **文件浏览器字数统计**: 默认关闭（避免性能问题）
- **智能章节排序**: 默认关闭（用户按需启用）

---

## 📝 v2.0.1 - Bug 修复

### 修复内容
- 修复伏笔面板标记回收时出现重复列表的问题
- 修复伏笔面板操作按钮位置不固定的问题
- 修复 OBS 端口更改后不生效的问题

---

## 🚀 v2.0.0 - 性能优化与跨平台体验提升

本次更新专注于性能优化和跨平台体验提升，实现了自适应防抖、缓存优化、平台细分检测等核心改进。

### ⚡ 性能优化

#### 自适应防抖策略
- **智能延迟调整**: 根据用户输入速度动态调整防抖延迟
  - 快速输入时延迟更长（最高 500ms），避免频繁计算
  - 慢速输入时延迟更短（最低 150ms），保持响应性
  - 自动学习用户输入习惯，优化体验
- **性能提升**: CPU 使用率降低 10-20%，输入更流畅

#### 缓存批量保存优化
- **批量写入**: 缓存更新采用 5 秒防抖批量保存
- **减少 I/O**: 磁盘写入次数减少 80%+
- **启动加速**: 缓存持久化后启动速度提升 30%+
- **完整性检查**: 自动检测缓存完整性，不完整时自动重建

### 📱 跨平台支持增强

#### 平台检测细分
- **三级平台检测**: 桌面端 / 平板端 / 移动端
  - 桌面端：完整功能（所有面板、Worker、OBS、缓存）
  - 平板端：中间模式（面板功能 + 浮动字数窗口）
  - 移动端：轻量模式（浮动字数窗口 + 基础功能）
- **智能适配**: 根据屏幕尺寸和设备类型自动选择最佳模式

#### 平板端中间模式
- **面板支持**: 支持写作状态面板、伏笔面板、时间线面板
- **浮动字数窗口**: 可拖动的浮动字数统计窗口
- **右键菜单**: 支持设定章节目标、标注伏笔、添加时间线
- **性能优化**: 不启用重度功能（Worker、OBS、文件夹缓存）

#### 移动端浮动字数统计
- **可拖动窗口**: 半透明浮动窗口，可自由拖动位置
- **实时统计**: 显示当前文件字数、中文字数、净增字数
- **目标进度**: 显示章节目标进度条和百分比
- **触摸优化**: 44px 最小触摸目标，防止误触
- **可选功能**: 可在设置中关闭

### 🎨 UI 优化

#### 触摸目标优化
- 所有可点击元素最小尺寸 44px（符合 Apple HIG 和 Material Design）
- 增加按钮间距，避免误触
- 优化移动端和平板端的触摸体验

#### 浮动字数窗口
- 半透明背景，不遮挡内容
- 可拖动到任意位置
- 自动保存位置，下次打开恢复
- 简洁的卡片式设计

### 📊 性能指标

| 指标 | v1.1.3 | v2.0.0 | 提升 |
|------|--------|--------|------|
| CPU 使用率 | 基准 | 优化后 | 降低 10-20% |
| 磁盘 I/O | 基准 | 批量保存 | 减少 80%+ |
| 启动速度 | 基准 | 缓存持久化 | 提升 30%+ |
| 输入响应 | 固定延迟 | 自适应延迟 | 提升 15-30% |

### 🔄 升级说明

- 从 v1.x 升级无需任何操作，插件会自动迁移设置
- 首次启动会检测缓存完整性，可能需要重建缓存（几秒钟）
- 平板端和移动端用户会自动启用对应的优化模式
- 建议重启 Obsidian 以确保所有功能正常工作

### 💡 使用建议

#### 桌面端用户
- 享受完整功能和性能优化
- 自适应防抖会根据你的输入习惯自动调整
- 缓存系统会自动管理，无需手动干预

#### 平板端用户
- 可以使用所有面板功能（状态、伏笔、时间线）
- 浮动字数窗口可拖动到合适位置
- 右键菜单支持章节目标、伏笔标注等功能

#### 移动端用户
- 浮动字数窗口提供实时统计
- 可在设置中关闭浮动窗口
- 右键菜单支持设定章节目标

---

## 📚 v1.1.3 - 时间线系统与字数统计完善

### ✨ 新功能

#### 时间线系统
- 侧边栏新增时间线面板（点击 ribbon 时钟图标或命令面板打开）
- 时间格式完全自由，支持真实日期、架空年份等任意格式
- 每个文件夹独立一条时间线，自动跟随当前活动文件切换
- 相同时间点的事件自动合并，以列表形式展示
- **多章节关联**：每个事件可关联多个章节，使用动态列表和下拉选择
- **自定义类型**：在设置中配置常用类型，添加时从下拉列表选择
- **独立事件编辑**：每个事件有独立的编辑块，可单独管理
- 拖拽排序、内联编辑、从正文添加事件
- 手动编辑时间线文件后面板自动刷新

### 🐛 Bug 修复
- 修复字数统计包含 Markdown 语法符号的问题
- 修复悬浮便签编辑不计入每日历史统计的问题

### ⚙️ 功能优化
- 时间线文件名可在设置中自定义
- 写作状态面板的状态徽章可直接点击切换
- 优化防抖策略，减少不必要的 DOM 操作

---

## 🎨 v1.1.2 - 伏笔标注系统与写作目标优化

### ✨ 新功能

#### 伏笔标注系统
- 选中文字后右键选择「标注为伏笔」，或使用快捷键 Ctrl/Cmd+Shift+F
- 标注内容自动保存到当前文件夹下的伏笔文件（默认：伏笔.md，可自定义）
- 支持多标签，相同说明的伏笔自动合并

#### 伏笔面板视图
- 侧边栏新增伏笔面板，按状态分组显示
- 直接在面板中标记回收、废弃或恢复

#### 护眼模式
- 设置中可开启护眼模式，颜色可自定义，默认豆沙绿 #E8F5E9

#### 当日目标进度
- 新增当日目标字数设置，统计今日所有文件的新增字数总和

### 🐛 Bug 修复
- 修复 OBS 叠加层开关在设置中无法即时生效的问题
- 修复章节目标进度跨章节累计的问题

### ⚙️ 功能优化
- 合并导出改为合并章节，自动排除非章节文件
- 叠加层当日目标进度和章节目标进度可分别独立开关
- 目标进度名称统一改为章节目标进度

---

## 🔢 v1.1.1 - 智能章节排序与便签增强

### ✨ 新功能

#### 智能章节排序
- **自动识别章节编号**: 自动识别文件名中的章节编号并按数字大小排序
- **支持多种格式**:
  - ✅ 中文数字：第一章、第二章...第九十九章
  - ✅ 阿拉伯数字：第1章、第01章、第001章
  - ✅ 英文格式：Chapter1、Chapter01、Chapter 1
  - ✅ 混合格式：第1章 标题、Chapter 01 - Title
- **智能排序**: 文件夹优先显示，章节文件按编号顺序排列
- **可选功能**: 在设置中可启用/禁用，避免与其他排序插件冲突

#### 便签保存增强
- **自定义保存位置**: 新建便签可自定义保存路径，默认保存在当前文件所在文件夹
- **自定义文件名**: 保存时可自定义文件名，默认格式为 `便签_YYYYMMDD_HHmmss.md`
- **关闭时保存提示**: 关闭便签时智能提示是否保存，防止内容丢失
  - 新建便签：有内容时总是提示保存
  - 已有文件：仅在修改后提示保存
  - 空白便签：直接关闭，不提示

### 🐛 Bug 修复
- **创建下一章优化**: 修复从"第一章 标题.md"创建下一章时会复制标题的问题，现在只生成"第二章.md"，让用户自定义标题

### 📝 使用建议
- 在设置中启用"智能章节排序"功能即可自动排序章节文件
- 使用 Ctrl/Cmd+Shift+N 快速创建空白便签
- 选中文字后右键选择"抽出为便签"快速提取内容
- 关闭便签时根据提示选择是否保存

### 🔄 升级说明
- 从 v1.1.0 升级无需任何操作
- 所有设置自动保留
- 建议重启 Obsidian 以确保新功能正常工作

---

## ⚡ v1.1.0 - 性能优化与稳定性提升

本次更新主要针对插件的性能和稳定性进行了全面优化，没有新增功能，但使用体验更流畅。

### ⚡ 性能优化

- **文件夹字数查询提升 95%+**：引入缓存系统，大幅减少重复计算
- **UI 更新频率减少 60%+**：防抖机制避免频繁刷新
- **CPU 使用率降低 40%+**：优化计算逻辑和更新策略
- **启动速度提升 37%+**：懒加载非核心功能，启动时间 < 500ms

### 🛡️ 稳定性改进

- **错误处理增强**：文件操作、OBS 服务器、缓存构建等异常情况的友好提示
- **设置验证**：自动检测并修复无效配置，防止插件异常
- **优雅降级**：功能启动失败时自动切换到备用方案
- **Worker 自动重启**：时间追踪崩溃后自动恢复

### 📱 移动端优化

- **完整适配**：核心功能在移动端完全可用
- **触摸优化**：44px 最小触摸目标，避免误触
- **简化界面**：移动端只显示相关设置选项

### 🐛 Bug 修复

- 修复字数超过一万时显示不完整的问题
- 修复拉窄面板时排版混乱的问题
- 修复状态徽章文字对比度不足的问题
- 修复便签标题和按钮布局问题
- 修复缓存构建时单个文件失败导致整体失败的问题

### 🔄 升级说明

从 v1.0.x 升级到 v1.1.0 **无需任何操作**，所有设置自动迁移。建议升级后重启 Obsidian。

---

## 📺 v1.0.1 - OBS 高性能叠加层

### 🚀 OBS 高性能叠加层

- **内置 HTTP Server + 浏览器源**方案取代传统 TXT 文件导出
- 零延迟、零磁盘消耗，解决 OBS 预览卡顿
- 专业级 UI：透明背景、毛玻璃模糊、流畅动画

### ✨ 新增功能
- 自适应布局（280px 宽度，高度随模块收缩）
- 自由透明度调节滑块
- 叠加层主题联动（6 种便签预设配色）
- 模块化控制（总计/专注/摸鱼、目标进度、本场净增）
- 数字等宽对齐，500ms 采样率 + 增量渲染

### 🔧 修复
- esbuild 构建输出 CommonJS 格式
- 保留旧版 TXT 导出兼容性
- 修正时间显示顺序（总计→专注→摸鱼）
- 状态灯动画优化
- 特定主题便签抽出 JS 作用域报错修复

---

## 🎉 v1.0.0 - 首个正式发布版本

### 功能
- 📝 精准字数统计（更适配中文创作网站）
- 🎯 写作目标追踪
- ⏱️ 专注/摸鱼计时
- 📌 悬浮便签（6 种主题配色）
- 📊 写作实时状态面板
- 📈 字数统计（按日/周/月/年）
- 📂 文件夹合并导出
- 📺 直播数据同步（可选功能）
- 📱 移动端 Lite 模式
- 📖 自动生成下一章

### 安装
1. 下载 `main.js` 和 `manifest.json`
2. 放入 Obsidian 库的 `.obsidian/plugins/web-novel-assistant/` 目录
3. 重启 Obsidian，在设置中启用插件
