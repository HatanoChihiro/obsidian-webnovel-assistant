# WebNovel Assistant User Guide

Welcome to WebNovel Assistant! An Obsidian plugin designed specifically for web novel writing.

## 📚 Table of Contents

- [Getting Started](#getting-started)
  - [Installation](#installation)
  - [First Use](#first-use)
- [Core Features](#core-features)
  - [Workspace Settings](#workspace-settings)
  - [Create and Import Works](#create-and-import-works)
  - [Smart Chapter Sorting](#smart-chapter-sorting)
  - [Strict Chapter Mode](#strict-chapter-mode)
  - [Word Count](#word-count)
    - [Selection Word Count Tooltip](#selection-word-count-tooltip)
    - [Exclude a File from Word Count](#exclude-a-file-from-word-count)
    - [Goal Tracking](#goal-tracking)
    - [Real-Time Word Count Reminders](#real-time-word-count-reminders)
    - [File Explorer Word Count](#file-explorer-word-count)
  - [Time Tracking](#time-tracking)
  - [Writing Workbench](#writing-workbench)
  - [Immersive Writing Mode](#immersive-writing-mode)
- [Advanced Features](#advanced-features)
  - [Creative Homepage](#creative-homepage)
  - [Smart Chapter Creation](#smart-chapter-creation)
  - [Chapter Templates](#chapter-templates)
  - [Merge Chapters](#merge-chapters)
  - [Floating Sticky Notes](#floating-sticky-notes)
    - [Sticky Note List](#sticky-note-list)
  - [Foreshadowing Management](#foreshadowing-management)
  - [Timeline Management](#timeline-management)
  - [Time-Limited Task Tracking](#time-limited-task-tracking)
  - [Lore Management](#lore-management)
    - [Lore Quick Reference](#lore-quick-reference)
    - [Lore Graph](#lore-graph)
    - [Lore Overview](#lore-overview)
  - [Proofreading](#proofreading)
  - [Chapter Overview (Classic)](#chapter-overview-classic)
  - [Advanced Search](#advanced-search)
  - [Writing Status Panel](#writing-status-panel)
- [Multi-Platform Adaptation](#multi-platform-adaptation)
- [Streaming Features](#streaming-features)
  - [OBS Overlay](#obs-overlay)
- [Other Settings](#other-settings)
  - [Language Settings](#language-settings)
  - [Typography Settings](#typography-settings)
  - [Eye Comfort Mode](#eye-comfort-mode)
  - [Debug Mode](#debug-mode)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
- [FAQ](#faq)
- [Feedback & Support](#feedback--support)
- [Related Documentation](#related-documentation)

---

## Getting Started

### Installation

#### From Obsidian Community Plugin Market (Recommended)
1. Open **Settings → Community plugins → Browse**
2. Search for **"WebNovel Assistant"**
3. Click **Install**, then **Enable**

#### Using BRAT
1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Add this repository in BRAT settings: `HatanoChihiro/obsidian-webnovel-assistant`
3. Enable the plugin

#### Manual Installation
1. Download the latest `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/releases)
2. Create a folder in your Obsidian vault: `.obsidian/plugins/web-novel-assistant/`
3. Place the downloaded files in that folder
4. Restart Obsidian and enable the plugin in Settings → Community plugins

> ⚠️ **Data Backup Notice**: On desktop, if you only need writing history and focus statistics, use **Settings → WebNovel Assistant → Data Output → History Data Backup** to export them, then restore the backup from the same location after reinstalling. This backup does not include plugin settings or sticky notes. To preserve settings or sticky notes that were not saved as Markdown files—or when using mobile—we still recommend closing Obsidian normally and backing up the complete `.obsidian/plugins/web-novel-assistant/data.json` file.

### First Use

1. Open any Markdown file
2. The status bar will display the current file's word count
3. Click the status bar to set a word count goal

---

## Core Features

### Workspace Settings

#### Overview
- **Scanning and Work Recognition Boundary**: A workspace is the upper boundary for plugin scanning and work recognition, not an individual work folder. For normal use, set a top-level category containing multiple works, such as `Novels`; the plugin recursively recognizes categories, works, and volume folders below it.
- **Default Location**: The first workspace determines the Creative Homepage location and the default parent folder for new/imported works. For example, with `Novels` as the workspace, a new work is created as `Novels/Work Name`. Do not set an individual work or volume folder: the homepage and new works would be placed inside that work, and homepage initialization can treat its direct child folders as works when creating missing work info.
- **Scope of Effect**:
  - Work root recognition and work context in the Workbench, Chapter Overview, and Immersive Mode (including foreshadowing and timeline features that rely on that context)
  - Creative Homepage work lists and total word counts, plus locations for new/imported works
  - Chapter word counts, goals, writing increments and history, plus File Explorer word-count caching
  - Lore cache, editor highlights, and relation graph
  - Chapter sorting, file-event handling, and typography scope
- **Outside the Scope and Empty Setting**: Files outside workspaces still show a basic word count, but do not participate in writing increments, history, or goals. Leaving this empty makes the scope vault-wide and scans more files.

#### How to Use
1. Open plugin settings
2. Find **Workspace Folders**
3. Enter a top-level category (e.g., `Novels`), not an individual work or volume folder
4. Separate top-level categories with commas (e.g., `Novels, Short Stories`); the first is the default location for the homepage and new/imported works
5. Leave empty for vault-wide scope

#### Use Cases
- Multiple projects in the same vault, but you only want the novel categories scanned and recognized as works
- Avoid counting non-novel content like notes and diaries in statistics
- Reduce the scanning, monitoring, and caching scope

---

### Create and Import Works

Configure Workspace Folders first. The recommended entry points are available directly from the File Explorer and do not require the Creative Homepage to be enabled. New and imported works are placed under the first configured workspace folder.

#### Create from the File Explorer (Recommended)
1. In the File Explorer, right-click the first configured workspace folder and select **Create New Work**.
2. Enter the work name, synopsis, genre, and total word-count goal.
3. Select **Create** to generate the work folder and Novel Info file.

#### Import from the File Explorer (Recommended)
1. In the File Explorer, right-click the first configured workspace folder and select **Import Novel**.
2. Select one long-form novel file in `.txt` or `.md` format.
3. The plugin uses the default or configured **Custom Chapter Naming Rules** to recognize volumes and chapters, preview the split, and create the Markdown files under the corresponding volume folders.
4. For Word files (`.docx` / `.doc`), first save or convert them to `.md` with Word, Pandoc, or another tool to preserve formatting.

#### Creative Homepage Entry (Optional)
If the Creative Homepage is enabled, its **Create New Work** and **Import Novel** buttons provide the same operations. Users who do not use the homepage can rely entirely on the File Explorer entries.

---

### Smart Chapter Sorting

#### Overview
- **Auto Sorting**: Automatically sorts by chapter number
- **Multiple Formats**: Default support for Arabic numerals and Chinese numerals
- **Folder Sorting**: Folders (such as "Volume 1") can also participate in sorting; folders with the same number are placed before files
- **Custom Rules**: Supports custom regular expressions
- **Real-Time Effect**: Automatically sorts after creating/renaming files
- **Drag Sorting**: Non-chapter files and chapter blocks can be reordered by dragging; chapter blocks move as a whole

> **Drag Sorting**:
> Smart chapter sorting has built-in drag sorting functionality:
> - **Chapter Blocks**: All chapter files form a single block that can be dragged to a new position (e.g., below non-chapter files)
> - **Non-Chapter Files**: Can be dragged to adjust order, interspersed above or below chapter blocks
> - Chapter blocks are always sorted internally by number; individual chapters cannot be dragged separately

#### How to Use

##### Enable the Feature
1. Open plugin settings
2. Enable **Smart Chapter Sorting**
3. Chapters in the file explorer will be automatically sorted

##### Supported Formats
- Arabic numerals: `第1章`, `第01章`, `Chapter 1`
- Chinese numerals: `第一章`, `第二十三章`, `第一百章`, `第九百九十九章`
- Named chapters: `大纲`, `番外`, `楔子` (must be configured in rules)
- Pure numbers: `1`, `01`, `001`
- Custom rules

##### Custom Rules

1. Open plugin settings → **Smart Sorting**.
2. Find **Sorting Rule Configuration**.
3. Click **+ Add New Rule**.
4. Enter the rule name and regular expression.
5. **Adjust Order**: Use the **▲/▼** buttons on the left side of each rule to adjust priority.
6. **Enable/Disable**: Each rule can be toggled individually.

> **Core Principle of Regex Rules**:
> - **Rules with parentheses `(\d+)`**: The parentheses capture the number, and the plugin sorts by that number. For example, `第1章` → number 1, `第2章` → number 2.
> - **Rules without parentheses**: No number is extracted; these are treated as "named chapters" and sorted alphabetically by filename. For example, `前言`, `番外`.
> - **Rule order determines position**: Groups that match earlier rules are placed above. To place side stories after the main text, put the side story rule below the numbered rules.

##### Default Rules

The plugin comes with 5 pre-configured rules in settings (the first 3 are enabled by default), which you can toggle anytime:

**Rule 1: Arabic Numerals (第1章, 第01章)**
```
Name: Arabic Numerals (第1章, 第01章)
Regex: ^第?(\d+)[章节回卷部册篇]?
Enabled: Yes
```
Supported formats: `第1章`, `第01章`, `1章`, `第1节`, `第1回`, `第1卷`, `第1部`, `第1册`, `第1篇`

**Rule 2: Chinese Numerals (第一章, 第二章)**
```
Name: Chinese Numerals (第一章, 第二章)
Regex: ^第?([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)[章节回卷部册篇]?
Enabled: Yes
```
Supported formats: `第一章`, `第二十三章`, `第一百章`, `第九百九十九章` (supports one through nine hundred ninety-nine)

**Rule 3: Pure Numbers & Titles (1, 01, 001 Title)**
```
Name: Pure Numbers & Titles (1, 01, 001 Title)
Regex: ^(\d+)(?:[ \-].*)?$
Enabled: Yes
```
Supported formats: `1`, `01`, `001 Prologue` (pure numeric filenames or numeric followed by a space/hyphen and title, **does NOT include decimals**)

**Rule 4: English Chapters (Chapter 1, Ch.1)**
```
Name: English Chapters (Chapter 1, Ch.1)
Regex: ^[Cc]h(?:apter)?\.?\s*(\d+)
Enabled: No
```
Supported formats: `Chapter 1`, `Ch 01`, `ch.1`

**Rule 5: Universal Brackets ( (1), 【30】 )**
```
Name: Universal Brackets ( (1), 【30】 )
Regex: ^[（\(【「{]([0-9零一二三四五六七八九十百千万]+)[）\)】」}]
Enabled: No
```
Supported formats: `(1)`, `（一）`, `【30】`, `「一百」`, `{2}`

##### Custom Rule Examples

Beyond the default rules, you can add your own:

**Decimal Chapters** (e.g., 1.1, 1.2, 2.1, 2.2)
```
Name: Decimal Chapters
Regex: ^(\d+\.\d+)
Enabled: Yes
```

**Mixed Numbers and Decimals** (e.g., 1, 1.5, 2, 2.1)

If you want pure numbers and decimal chapters to be strictly interleaved based on their mathematical value, you must **disable the default pure number rule** and only enable this "all-inclusive" rule (grouping them into the same rule category so the engine can compare their values):
```
Name: Mixed Numbers and Decimals
Regex: ^(\d+(?:\.\d+)?)(?:[ \-].*)?$
Enabled: Yes
```

**Volume-Chapter** (e.g., 第一卷第一章)
```
Name: Volume-Chapter
Regex: ^第.+卷第?(\d+)[章节]?
Enabled: Yes
```

**Named Chapters — Multiple Names in One Rule** (e.g., 前言, 番外, 后记)

A single rule can match multiple filenames by separating them with `|`; no need to add them one by one:
```
Name: Special Chapters (前言/番外/后記 etc.)
Regex: ^(前言|序章|楔子|引子|番外|外传|后记|尾声|附录)
Enabled: Yes
```
This rule has no parentheses to capture a number, so matched files are sorted alphabetically by filename. You can control their position by adjusting the rule order — place above numbered rules to appear before the main text, or below to appear after.

**Numbered Named Chapters** (e.g., 番外1, 番外2)

If named chapters themselves have numbers, add parentheses to capture the number for numeric sorting:
```
Name: Side Story Series
Regex: ^番外(\d+)
Enabled: Yes
```
This way `番外1` → number 1, `番外2` → number 2, and they are automatically sorted in order.

> **Tips**:
> - `(\d+)` or `(\d+\.\d+)` in regular expressions captures the chapter number
> - Rule order determines sorting priority (rules above have higher priority)
> - Multiple rules can be enabled simultaneously; the plugin matches them in order
> - `|` means "or" and allows one rule to match multiple filenames

> **⚠️ Important**:
> If you have both a **number rule** (e.g., `^(\d+)(?:[ \-].*)?$`) and a **decimal rule** (e.g., `^(\d+\.\d+)`) enabled, it is recommended to place the decimal rule **above** the number rule. Although the new default number rule has been optimized to prevent mismatches with decimals, order still matters for custom number rules.
>
> **Correct order**:
> 1. Decimal Chapters `^(\d+\.\d+)` ✅
> 2. Pure Numbers `^(\d+)(?:[ \-].*)?$` ✅


#### Related Settings
- **Enable Smart Chapter Sorting**: Master toggle.
- **Sorting Rule Configuration**: Core configuration area, supports adding, deleting, disabling, and ▲/▼ reordering.

---

### Strict Chapter Mode

#### Overview
- **Precise Filtering**: Chapter lists, the Writing Workbench, and all word-count features recognize only documents that match the chapter naming rules.
- **Exclude Interference**: Outlines, lore, drafts, and other non-chapter documents stay out of chapter views and do not contribute to daily progress or show goals and word-count markers.
- **Flexibility**: To recognize named chapters such as side stories, add a matching rule to the sorting rules.
- **Configurable Exception Directories**: Mark a directory as an exception to treat every document inside it as a chapter.

#### How to Use
1. Open plugin settings → **General**.
2. Enable **Enable Strict Chapter Mode**.
3. Ensure chapter names match an enabled rule under **Chapter Naming Rule Configuration**, or add a directory that should be recognized in full as an exception.

---

### Word Count

#### Overview
- **Accurate Chinese Word Count**: Correctly identifies Chinese characters, English words, and numbers
- **Real-Time Updates**: Word count updates automatically while editing
- **Net Word Count**: Displays the number of new words added in the current session
- **Status Bar Display**: Shown in the Obsidian bottom status bar
- **Strict Chapter Mode**: Restricts word count features to only files that match chapter naming rules (see [Strict Chapter Mode](#strict-chapter-mode))
- **Real-Time Word Count Reminders**: Displays cumulative word count reminders on the left side of the editor in real time (see [Real-Time Word Count Reminders](#real-time-word-count-reminders))

#### How to Use
1. Open any Markdown file
2. The status bar automatically displays the word count: `1,234 words | Net: +56 words`
3. Click the status bar to quickly set a goal

#### Related Settings
- **Workspace Folder**: Limits the counting scope (see [Workspace Settings](#workspace-settings))
- **Non-Workspace Files**: Files outside the workspace scope still display basic word counts in the status bar (without tracking state and net word count)

- Counted: Chinese characters, English words, numbers
- Not counted: Markdown syntax, code blocks, comments, YAML frontmatter

#### Word Count Stability and Anti-Jitter [HOT]
To solve the common "word count spike/drop" problem in Obsidian plugins, this plugin uses a multi-layer verification architecture:
- **Real-Time Sync**: Changes in the editor are immediately synced to the in-memory cache.
- **File Baseline Sync**: When a file is auto-saved (triggering a modify event), the plugin compares the current cache against disk content using timestamp verification, ensuring incremental calculations are based on the same baseline.
- **Cold Start Protection**: During plugin loading and index building, all file changes are captured in real time to update the cache baseline, preventing massive false increments after layout is ready.

#### Word Count Modes

The plugin provides three word count algorithms for different writing scenarios:

| Mode | Rules | Use Case |
|------|-------|----------|
| **Web Novel Mode** | All non-whitespace characters count as 1 word each (including punctuation) | Word count rules for platforms like Qidian, JJWXC, and other web novel platforms |
| **Standard Mode** (default) | Chinese character-by-character + English by word + full-width punctuation counts; half-width punctuation excluded | Common word count scheme in Word, WPS, and other document tools |
| **Native Mode** | Chinese character-by-character + English by word, ignoring all punctuation | Closest to Obsidian's built-in word count |

##### How to Switch
1. Open plugin settings → **Word Count**
2. Find **Word Count Mode**
3. Select the desired mode from the dropdown
4. After switching, the entire vault is automatically recalculated

> **Tip**: Word counts for the same document may differ significantly between modes. This is normal. Simply choose the counting mode that matches your publishing platform.

#### Selection Word Count Tooltip

Enable **Selection Word Count Tooltip** under **Settings → Word Count**. Selecting two or more characters in the editor displays the selection's accurate count near the cursor using the current word count mode. The tooltip disappears when the selection is cleared.

#### Exclude a File from Word Count

If a chapter should not be counted temporarily—for example, an outline, discarded draft, or alternate version—you can exclude that file without enabling Strict Chapter Mode.

##### How to Use

- **Desktop**: Right-click the target file in the File Explorer or while it is open, then select **Exclude from Word Count**.
- **Phone/Tablet**: Open the target file's menu, then select **WebNovel Assistant → Exclude from Word Count**.
- **Writing Workbench**: Right-click a chapter card and select **Exclude from Word Count**. The card will display an **Excluded** status.

After exclusion, the file is omitted from the novel total, daily writing statistics, and other features that depend on chapter word counts. The plugin writes `exclude-word-count: true` to the document's frontmatter without changing its body text.

To restore counting, choose **Include in Word Count** from the same location. The plugin recalculates the file and refreshes the related statistics.

#### Goal Tracking

##### Overview
- **Chapter Goals**: Set independent word count goals for each chapter
- **Daily Goal**: Set today's writing goal
- **Progress Display**: Shows completion percentage in real time
- **Progress Bar**: Visual progress indicator

##### How to Use

###### Setting a Chapter Goal
1. Right-click a file → **Set Chapter Word Goal**
2. Enter the target word count (e.g., 3000)
3. The status bar displays progress: `1,234 / 3,000 (41%)`

###### Setting a Daily Goal
1. Open plugin settings
2. Find **Daily Word Goal**
3. Enter the target (e.g., 5000)

##### Related Settings
- **Default Chapter Goal**: Default target for new files (default: 3000 words)
- **Daily Word Goal**: Today's writing target (default: 5000 words)
- **Show Status Bar Progress**: Whether to display progress in the status bar (desktop only, enabled by default)

###### Viewing Progress
- **Status Bar**: Displays current file progress
- **Writing Status Panel**: Displays detailed statistics (click the left Ribbon icon)

#### Real-Time Word Count Reminders

##### Overview
- **Word Count Reminders**: Displays cumulative word counts on the left side of the editor (line number area) in real time.
- **Visual Aid**: For example, if you set a reminder every 2000 words, labels like `2000`, `4000`, etc. will automatically appear on the left side of the editor, helping you pace your writing.
- **Smart Positioning**: Labels are precisely displayed on the line where the corresponding word count is reached.

##### How to Use
1. Open plugin settings → **Word Count**.
2. Enable **Real-Time Word Count Markers**.
3. Enter the target word count in **Word Count Reminder Interval** (e.g., 2000).
4. Write in the editor, and reminder labels will automatically appear on the left.

##### Related Settings
- **Word Count Reminder Interval**: Set how many words between each reminder.
- **Strict Mode Integration**: If strict mode is enabled, reminders only appear in files that match chapter rules.

#### File Explorer Word Count

##### Overview
- **Folder Word Count**: Displays the total word count of all files in a folder
- **File Word Count**: Displays the word count of individual files
- **Real-Time Updates**: Automatically updates after file modifications
- **Workspace Filtering**: Only displays word counts for specified folders
- **Performance Optimization**: Uses a caching mechanism to avoid frequent calculations

> **Note**: This feature is disabled by default because it may affect performance in large projects. To use it, enable it manually in settings.

##### How to Use

###### Enable the Feature
1. Open plugin settings
2. Enable **Show Word Counts in File Explorer**
3. The plugin will automatically build the cache (may take a few seconds)
4. Word counts will appear in the file explorer: `Chapter 1 (3,456)`

###### Rebuild Cache
If word counts are displayed incorrectly:
1. Command palette → `Rebuild Folder Word Count Cache`
2. Wait for the rebuild to complete

##### Related Settings
- **Show Word Counts in File Explorer**: Whether to enable this feature (disabled by default to avoid performance issues)
- **Workspace Folder**: Limits the counting scope (see [Workspace Settings](#workspace-settings))

---

### Time Tracking

#### Overview
- **Focus Time**: Tracks actual writing time
- **Slack Time**: Tracks idle time
- **Auto Detection**: Automatically switches to slack after 60 seconds of inactivity
- **History**: Saves daily statistics

#### How to Use

##### Start Tracking
1. Open the command palette (Ctrl/Cmd + P)
2. Type `Start/Pause Focus Time Tracking`
3. Start writing, and the plugin automatically tracks time

##### View Statistics
- **Status Bar**: Displays today's focus time
- **Writing Status Panel**: Displays detailed time breakdown
- **History**: Click "View Historical Statistics" in the panel

##### Reset Statistics
- Command palette → `Reset today writing stats` opens an action panel: clear all of today's data; clear only today's words while keeping focus time, slack time, and the current timer state; or correct today's words to a specified integer.

#### Related Settings
- **Idle Timeout Threshold**: How many seconds without keyboard input count as slack time (default: 60 seconds)

> **Mobile**: Phones and tablets can use the experimental focus timer after enabling **Show Floating Word Stats** and **Enable Focus Timer on Mobile**. Control it with the play/pause button in the floating widget; screen-off and background time are filtered out, and data syncs with desktop.

---

### Writing Workbench

#### Overview
The Writing Workbench is a comprehensive writing management center upgraded from the original "Chapter Overview", integrating 6 main tab panels:

Use the links after each panel title to jump to its detailed feature documentation.

1. **All Chapters Panel** (see [Smart Chapter Sorting](#smart-chapter-sorting), [Smart Chapter Creation](#smart-chapter-creation), [Chapter Templates](#chapter-templates), and [Merge Chapters](#merge-chapters)):
   - Quickly create chapters, modify chapter names and summaries.
   - Supports **manual drag-and-drop reordering** (automatically renames subsequent numbered chapter files).
   - Badges at the bottom display **Lore** and **Foreshadowing** appearing in the current chapter; click to preview.
   - **Supports Multi-Template Selection**: Configure multiple template files in settings to select on demand when creating chapters.
2. **Timeline Panel** (see [Timeline Management](#timeline-management)):
   - Displays novel events in a vertical timeline flow; supports dragging chapters to timeline nodes and dragging event cards to reorder.
   - Features a bottom floating window for unlinked chapters and highlighted association lines.
3. **Lore Panel** (see [Lore Quick Reference](#lore-quick-reference), [Lore Graph](#lore-graph), and [Lore Overview](#lore-overview)):
   - Supports switching between **Table View**, **Card View**, and **Full Lore Graph View**.
   - Automatically tracks appearance counts and chapters; supports double-clicking graph nodes to jump directly to the Markdown document.
4. **Foreshadowing Board Panel** (see [Foreshadowing Management](#foreshadowing-management)):
   - Dedicated management view for all plot threads and foreshadowing entries.
   - Categorized into 3 collapsible sections: `Pending` (including Unresolved and Progressive Stage entries), `Resolved`, and `Deprecated`.
   - Top search input bar for real-time filtering by title, description, or tags.
   - Clicking a foreshadowing card triggers precise jump-and-highlight positioning in the target note.
5. **Task Board Panel** (see [Time-Limited Task Tracking](#time-limited-task-tracking)):
   - Consolidates timed writing tasks into a grid card view directly inside the workbench.
   - Provides a voluntary **Abandon Task** button with a confirmation modal for incomplete tasks, setting status to `abandoned` while preserving word count records.
6. **Notes Management Panel** (see [Floating Sticky Notes](#floating-sticky-notes)):
   - Centralizes management for all floating and immersive sticky notes. Create, edit, switch themes, or delete notes with real-time bi-directional sync.

- **Split-Pane Navigation**: Opening chapters, lore, timeline entries, or foreshadowing entries from the Workbench prefers an available unpinned editor split and avoids pinned tabs for side-by-side reference.
- **Full-Text Filtering**: All Chapters filters chapter titles, synopses, and body text; Lore filters titles, aliases, and body text; Foreshadowing filters titles, source quotes, tags, and resolution notes. Use the clear button, press Esc, or run **Workbench: Clear Search Filter** to restore the full list.

#### How to Use

##### Open Writing Workbench
1. Open the command palette (Ctrl/Cmd + P) and type `Toggle Writing Workbench View`
2. Or click the workbench icon in the left Ribbon menu
3. After opening any chapter file, the workbench will automatically identify the current novel and display its content.

---

### Immersive Writing Mode

#### Overview
- **Full-Screen Focus**: Enter a full-screen writing environment that hides all distracting elements including Obsidian sidebars, status bar, title bar, ribbon menu, and more.
- **Top-Right Semi-Hidden Exit Button**: An exit button is deliberately designed in the top-right corner; it automatically hides upon entering immersive mode and becomes visible when hovering your mouse over the top-right corner for a quick exit (you can also exit via the command palette), designed specifically to minimize visual distractions and enhance immersion.
- **Dynamic Dashboard**: Top bar displays the novel title in real time, focus/slack duration, today's net word count, and goal progress.
- **Typewriter Scroll & Line Dimming**: Supports Typewriter Scroll and Context Line Dimming, toggleable via the central status bar for focused line writing.
- **Slot-Based Layout**: Freely assign auxiliary panels to top, bottom, left, and right areas around the main editing zone. Unassigned panel areas collapse to edges to maximize editing area.
- **Reference Documents**: Left-click a chapter to open the document in the main editing area; right-click to open it in the right reference area.

#### How to Use
- **Entering Immersive Mode**: Open any novel chapter (Markdown file), and type `Toggle Full-Screen Immersive Writing Mode` in the command palette (Ctrl/Cmd + P), or click the left Ribbon icon in normal mode.
- **Exiting Immersive Mode**: Move your mouse to the top-right corner of the screen and click the revealed exit button, or open the command palette (Ctrl/Cmd + P) and type `Toggle Full-Screen Immersive Writing Mode`.

#### Related Settings
- **Typewriter Scroll**: Keeps the active cursor line vertically centered on screen.
- **Context Line Dimming**: Dims non-focused lines when typewriter mode is active to boost concentration.
- **Center Offset and Unfocused Line Opacity**: Fine-tune the active line's vertical position and the dimming strength of surrounding text.
- **Slot Layout**: In settings under Immersive Mode, use the visual layout editor to freely assign panels (chapter list, foreshadowing, timeline, notes, reference documents, chapter overview, lore overview) to top, bottom, left, and right slots.
- **Auto-Hide Properties Panel**: When enabled, the Markdown properties panel at the top is automatically hidden in immersive mode.
- **Top Dashboard Data Toggles**: Independently show or hide total time, focus time, slack time, chapter goal, daily goal, task goal, and session net words.
- **Note Typography & Style**: Note font sizes and display styles are now centrally managed under **Writing Tools** settings.

---

## Advanced Features

### Creative Homepage

#### Overview
- **Full-Width Dashboard**: 2-row x 2-column grid layout that breaks through Obsidian's content width limit, filling the entire editor viewport
- **Dynamic Greeting**: Automatically changes based on time of day (Good morning, Good afternoon, It's late, etc.), displaying total word count (actual workspace count) and today's new words
- **Work Overview**: At a glance view of In Progress (with time-limited task progress), In Draft, On Hold, and Completed works
- **Data Panel**: Right column displays efficiency overview, 365-day heatmap, and 30-day trend
- **Narrow Screen Adaptation**: Automatically switches to single-column layout when editor width is < 1200px
- **Quick Create**: The "+ Create New Work" button on the right side of the greeting area opens a dialog to fill in metadata and automatically creates a folder and work info file

#### How to Use
1. After enabling the plugin, enable the Creative Homepage in settings
2. The homepage file is automatically generated in the first folder of the workspace (default name: Creative Homepage.md)
3. Click the homepage file to enter the Creative Homepage
4. The homepage automatically switches to preview/reading mode, with document properties and title hidden

#### Custom Homepage Greeting
1. Open plugin settings
2. Find **Custom Welcome Message**
3. Enter custom text; leave empty to use the time-based automatic greeting

#### Other Homepage Settings and Commands
- **Open Homepage on Startup**: Automatically opens the Creative Homepage whenever Obsidian starts.
- **Custom Homepage Filename**: Renames the existing homepage automatically; do not include the `.md` extension.
- **Homepage Position in File Tree**: Pin the homepage to the top or bottom of the File Explorer, or leave it under normal sorting and manual drag order.
- **Novel Info Filename**: Changing this setting automatically renames existing Novel Info files across configured workspaces.
- **Command Palette**: Use **Open Creative Homepage** to navigate to it quickly.

---

### Smart Chapter Creation

#### Overview
- Provides two entry points: **+ New Chapter** in the Workbench and **Create Next Chapter (Smart Increment)** in the Command Palette.
- Uses enabled custom chapter naming rules first, with built-in support for common Arabic-number, Chinese-number, and decimal chapter formats.
- Both paths integrate with [Chapter Templates](#chapter-templates): no valid template creates a blank chapter, one template is applied automatically, and multiple templates open a selector that also offers a blank chapter.

#### Create a Chapter from the Workbench
1. Open the Writing Workbench, switch to the **All Chapters Panel**, and select **+ New Chapter** in the upper-right corner.
2. The plugin suggests the next chapter name from existing files in the latest chapter folder of the current work. You may edit the full chapter name in the dialog; do not add the `.md` extension.
3. Confirm the name and choose a chapter template when prompted. The file is created in the current work's latest chapter folder, and the Workbench refreshes while remaining open.

#### Create the Next Chapter from the Command Palette
1. Open an existing chapter whose filename contains a recognizable chapter number.
2. Open the Command Palette (Ctrl/Cmd + P) and run **Create Next Chapter (Smart Increment)**, or assign it under **Settings → Hotkeys**.
3. The plugin preserves the current numbering structure, increments the number, and creates the next chapter in the same folder. The previous chapter's descriptive title is not carried into the new filename.
4. If the calculated target already exists, the plugin opens it instead of creating a duplicate. Otherwise, it applies the selected template, creates the file, and opens it automatically.

> **If creation fails**: When neither a custom rule nor a built-in number format recognizes the current filename, creation stops with a notice. Rename the file or add the corresponding format under Chapter Naming Rules.

---

### Chapter Templates

#### Overview
- Configure one or more Markdown templates in Settings for creating new chapters.
- With no template, new chapters are blank; with one template, it is applied automatically; with multiple templates, creating a chapter opens a selector that also allows a blank chapter.
- Chapter templates apply both to chapters created from the Workbench and through the **Create Next Chapter (Smart Increment)** command.

#### How to Use
1. Open plugin settings and enable **Enable Chapter Template**.
2. Under **Template File List**, use the add button to select one or more Markdown template files from the vault.
3. Create a chapter from the Workbench or run the next-chapter command, then choose a template when prompted.

---

### Merge Chapters

#### Overview
- Merge an entire work or a selected volume in the current chapter order, with an option to include chapter titles.
- Desktop provides merged/original comparison, content revision, applying changes back to source chapters, and export.
- Phones and tablets provide a single-column waterfall preview, a chapter-title toggle, and export, but do not support revision or applying changes back.

#### How to Use
1. Select **Merge Chapters** to the left of the work-status button in the Workbench All Chapters panel, or right-click a work or volume folder in the File Explorer and select **Merge Chapters**.
2. Preview the merged result and choose whether to include chapter titles.
3. On desktop, revise and apply changes back or export directly; on mobile, export after reviewing the preview.

---

### Floating Sticky Notes

#### Overview
- **Floating Windows**: Draggable, resizable note windows.
- **Multiple Themes**: 6 preset theme colors with real-time switching.
- **Auto Save**: When enabled, content is saved instantly as you type, no manual saving needed.
- **Obsidian Sync Compatibility**: Sticky-note data is stored with plugin settings in `data.json` so it can sync across devices through Obsidian Sync.
- **Immersive Mode Sync**: Changes made in immersive mode are synced in real time to floating notes in normal mode.
- **Linked Files**: Can be linked to specific files; saving automatically updates the original file's content.
- **One-Click Hide/Show**: Support for one-click hiding and restoring the current note layout
- **Sticky Note List**: View, create, and edit all notes in one fixed side panel on both desktop and mobile.

#### How to Use

##### Creating a Note
**Method 1: Blank Note**
- Click the left Ribbon icon (note icon)
- Or command palette → `Create Blank Floating Note`

**Method 2: From a File**
- Right-click a file → `Extract Current File as Note`

**Method 3: From Selected Text**
- Select text → Right-click → `Extract as Sticky Note`

##### Sticky Note List
1. Open the Command Palette (Ctrl/Cmd + P) and run **Open Sticky Note List**. The list remains available as a fixed Obsidian side panel on both desktop and mobile.
2. Use the **+** button in the panel toolbar to create a blank note, or use the folder button to select a Markdown file and open it as a linked note.
3. Notes are arranged as cards and can be edited directly. With **Sticky Note Auto-Save** enabled, changes are saved automatically and linked files are updated as well.
4. Use the **×** button on a card to close and remove that note. When content still needs to be saved, the plugin asks for confirmation first.
5. The side-panel list, desktop floating notes, the Workbench Notes panel, and Immersive Mode notes share the same data, so edits from any entry point appear in the others. On mobile, where desktop floating windows are unavailable, the side panel can serve as the primary note-management interface.

##### Editing a Note
- **Edit Mode**: Click the pencil icon
- **Preview Mode**: Click the eye icon
- **Change Theme**: Click the palette icon
- **Pin Position**: Click the pin icon
- **Sync Document**: Click the refresh icon to sync the latest content from the linked document to the note (only shown when the note is linked to a document)

##### Saving a Note
- **Save to File**: Click the save icon
- **Linked File**: If the note was created from a file, saving updates the original file
- **New File**: If it's a blank note, you'll be prompted to create a new file

##### Closing a Note
- Click the close button (X)
- If there is unsaved content, you'll be prompted to save

> **Note**:
> - Notes support **auto save** (must be enabled in settings). Even after restarting Obsidian, any notes that were not closed will be restored.
> - In immersive mode, notes appear as **grid cards** arranged in the bottom/top auxiliary panel.

- **Sync Mechanism**: Floating notes in normal mode and card view in immersive mode share the same data. Any changes you make on one side are reflected on the other in real time.

#### Related Settings
- **Note Theme**: 6 preset theme colors, customizable
- **Idle Opacity**: Floating-note background opacity (0.1-1, default 0.9)
- **Sticky Note Auto-Save**: Saves edits as you type; when disabled, closing a modified note prompts you to save.
- **Sticky Note Text Size**: Controls body text size across desktop floating notes, side-panel note lists, Workbench notes, and Immersive Mode notes. Floating notes no longer use `Ctrl/Cmd + mouse wheel` for per-note scaling.
- **Show/Hide All Floating Notes**: On desktop, use the Command Palette to hide or restore all floating notes and their layout at once.

---

### Foreshadowing Management

#### Overview
- **Mark Foreshadowing**: Flag plot threads that need to be resolved.
- **Multi-Stage Resolution**: Track foreshadowing through progressive stages (`[Stage]`) until final resolution (`[Resolved]`), matching the organic flow of long-form storytelling.
- **Multi-Chapter Links**: Associate a single foreshadowing entry with multiple chapters during progressive stages or final resolution.
- **Workbench Foreshadowing Board**: Dedicated board view inside Writing Workbench categorized into `Pending` (Unresolved & Stage), `Resolved`, and `Deprecated` sections with collapsible groups.
- **Tag Categories**: Organize and filter foreshadowing with tags.
- **Smart Jump & Highlight**: Click any foreshadowing card to automatically open the note and flash-highlight the target line.

#### How to Use

##### Marking Foreshadowing
1. Select the text you want to mark
2. Right-click → `Mark as Foreshadowing`
3. Or use a keyboard shortcut (must be customized in settings)
4. Enter the foreshadowing description and tags
5. Click save

##### Viewing & Managing Foreshadowing
- **Method 1: Workbench Foreshadowing Board (Recommended)**
  1. Open Writing Workbench and switch to the **Foreshadowing Board** tab.
  2. View entries grouped under `Pending` (Unresolved + Progressive Stage), `Resolved`, and `Deprecated`.
  3. Filter entries in real-time using the top keyword search input.
- **Method 2: Sidebar Foreshadowing Panel**
  1. Click the left Ribbon icon (bookmark icon) or command palette → `Toggle Foreshadowing Panel`.
  2. Filter by status and tags.

##### Resolving & Advancing Foreshadowing
- **Progressive Stage Resolution**:
  1. Click **Stage Resolution** on a foreshadowing card or panel entry.
  2. Enter progressive notes and select associated chapters (e.g., "Chapter 15: Revealed part of hero's past"). The entry remains in `Pending` with appended stage logs.
- **Final Resolution**:
  1. Click **Final Resolution**.
  2. Select the final resolution chapter(s) and submit. Status updates to `Resolved`.
- **In the Foreshadowing File**:
  1. Open the foreshadowing file (default: `Foreshadowing.md`).
  2. Place the cursor on the entry.
  3. Command palette → `Mark Foreshadowing as Resolved`.
  4. Select the resolution chapter.

#### Related Settings
- **Foreshadowing File Name**: Default `Foreshadowing`, customizable
- **Show Timestamps**: Whether to display creation time (enabled by default)
- **Default Tags**: Preset common tags (default: Character, Plot, Worldbuilding, Item, Clue)

---

### Timeline Management

#### Overview
- **Timeline Records**: Records the story's chronological progression
- **Type Categories**: Main plot, side plot, flashback, etc.
- **Chapter Association**: Records which chapter an event occurs in
- **Quick Add**: Add events quickly from selected text

#### How to Use

##### Adding a Timeline Event
**Method 1: From Selected Text**
1. Select text describing an event
2. Right-click → `Add to Timeline`
3. Enter the time, type, and other information
4. Click save

**Method 2: In the Timeline Panel**
1. Open the Timeline panel
2. Click **Add Event**
3. Fill in the information
4. Click save

##### Viewing the Timeline
1. Click the left Ribbon icon (clock icon)
2. Or command palette → `Toggle Timeline Panel`
3. The panel displays all events
4. Filter timeline events by **type**
5. Click an event card title to open the timeline file and precisely locate and highlight that entry. The Writing Workbench timeline board supports the same navigation.

##### Timeline File Format
```markdown
## Day 1 - Main Plot

> The protagonist leaves home and embarks on an adventure

**Chapter**: [[第一章]]
**Type**: Main Plot

---

## Day 3 - Side Plot

> The protagonist meets a mysterious old man at the tavern

**Chapter**: [[第五章]]
**Type**: Side Plot
```

#### Related Settings
- **Timeline File Name**: Default `Timeline`, customizable
- **Default Types**: Preset common types (default: Main Plot, Side Plot, Flashback, Foreshadowing Line, Hidden Line)

---

### Time-Limited Task Tracking

#### Overview
- **Time-Limited Task Tracking**: Tracks time-limited tasks from web novel platforms (Qidian, JJWXC, etc.), adapting to various writing scenarios
- **Auto Calculation**: Records a snapshot of the folder's total word count at creation time and calculates word count increments in real time
- **Auto-Close on Expiry**: Automatically updates the task status when the task period expires, recording completion status
- **Period Auto-Increment**: Supports multiple task periods for the same folder; the period number auto-increments when adding a new one
- **Progress Visualization**: The writing status panel displays task progress bars and deadline reminders
- **Completion Indicator**: The progress bar turns green when the word goal is met, and "Goal Met!" is displayed at the deadline
- **Editable Starting Word Count**: When adding a new task, you can view and manually modify the starting word count, making it easy to carry over progress from the previous period

#### How to Use

##### Enable Time-Limited Task Tracking
1. Right-click a folder or file → **Start Task Tracking**
2. Fill in the dialog:
   - Name (e.g., Qidian Chinese Network)
   - Period number (auto-increments when adding new)
   - Start/End time (default: start = today, end = start + 7 days, customizable)
   - Details (e.g., New Book Rankings #3)
   - Word count requirement (e.g., 30000)
   - Starting word count (auto-filled with the current folder's chapter total word count; editable)
3. Click confirm; a task record file is automatically generated and the time-limited task panel opens

##### View Time-Limited Task Panel
1. Click the left Ribbon icon (trophy icon)
2. Or command palette → `Toggle Time-Limited Task Panel`
3. The panel displays current in-progress task progress and history

##### Add a Time-Limited Task
- Click the "Add Task" button in the time-limited task panel, or select "Start Task Tracking" from the context menu again
- The period number is auto-filled as the previous period + 1

#### Related Settings
- **Time-Limited Task File Name**: Default `Time-Limited Tasks`, customizable in settings (older versions used the default name `Ranking Records`, which is automatically compatible)
- **Immersive Mode Task Progress**: Whether to display time-limited task progress in the immersive mode top status bar (enabled by default)

---

### Lore Management

Lore Management brings inline quick reference, the relationship graph, and the standalone Lore Overview under one category. All three use the same lore files and cache.

#### Lore Quick Reference

##### Overview
- **Nested Lore Database**: The lore folder supports subdirectories at any depth, and the plugin automatically scans Markdown documents within them
- **Auto Annotation**: Create lore entries using level-2 headings (`##`) in categorized documents, and add `**Alias**: xxx` in the body. When you type canonical names or aliases in your novel text, the system automatically adds a dashed underline
- **Single-File Entries**: If a lore document has no level-2 headings, the plugin treats its filename as one lore entry, supporting a one-file-per-entry organization style
- **Hover/Tap Quick Reference**: Hover over annotated text on desktop or tap it on mobile to open a small window precisely positioned to that entry — no need to leave the editing page
- **Right-Click "Write & Build"**: Select a new item or character name in the editor, right-click "Add as New Lore Entry," and quickly enter it in a dialog
- **Alias Support**: In each entry body, use `Alias: xxx` or `别名：xxx`; the label may be bold, and either English or Chinese colons work. Separate multiple aliases with commas, enumeration commas, semicolons, slashes, or vertical bars; each alias maps to that entry

##### How to Use

###### Configure the Lore Folder
1. Open plugin settings → **Writing Tools**
2. Find **Lore Folder Name**
3. Enter the name of the folder for lore files (default: "Lore")
4. Create this folder under each work's directory and place categorized lore documents in it

###### Creating Lore Documents (Dictionary Outline Mode)
Create categorized documents under the lore folder, using `## Level-2 Headings` as the canonical entry name:

```markdown
# Characters

## Zhang San
The protagonist, a young swordsman.
**Alias**: Brother San, Xiao Zhang

## Li Si
The villain, cunning and treacherous.
**Alias**: Master Si

## Wang Wu
Supporting character, a loyal companion.
```

> **Tips**:
> - Each level-2 heading (`##`) is a separate entry; the heading text is the canonical name
> - When level-2 headings exist, level-1 (`#`) and level-3 (`###`) headings are not treated as separate entries
> - If the entire file has no level-2 heading, its filename becomes the only entry name; aliases can still be added in the body or frontmatter
> - Lore files may be organized in nested subfolders under the configured lore folder
> - Aliases must be in the body of their level-2 entry. Use `Alias: xxx` or `别名：xxx` (bolding is optional); separate multiple aliases with commas, enumeration commas, semicolons, slashes, or vertical bars

###### Using Lore Quick Reference
1. Type a character name or alias in your text (e.g., "Zhang San" or "Brother San")
2. The text will automatically display a dashed underline
3. Hover to preview the lore card content, precisely positioned to the corresponding entry

###### Rebuild Lore Cache
When lore files or chapters already exist but lore highlighting, Workbench statistics, or the relation graph have not updated correctly, run **Command Palette (Ctrl/Cmd + P) → `Rebuild Lore Cache`**. It rescans lore entries, refreshes chapter lore-reference statistics in bulk, and refreshes editor highlights, the Workbench, and the relation graph.

###### Right-Click to Add New Lore
1. Select a new name in the editor (e.g., "Xuan Tie Sword")
2. Right-click → **Add as New Lore Entry**
3. Fill in the lore name, select a categorized document, add aliases and description in the dialog
4. Click save; the lore entry is automatically written to the corresponding categorized document

> **Mobile**: Lore names and aliases are still recognized and shown with dashed underlines. Enable **Lore Hover Popover on Mobile** to tap and view a card; disabling it only disables the cards to prevent accidental taps while scrolling.

##### Related Settings
- **Lore Folder Name**: Default `Lore`, customizable

---

#### Lore Graph

##### Overview
- **Auto Relationship Parsing**: Generate a relationship graph of characters with a single click, based on the mutual mentions parsed by "Lore Quick Reference" (dashed lines).
- **Explicit Relationship Definition**: In the character lore Markdown files, use `### Relations` or `### 关系` to establish explicit relationships (solid lines). It supports unordered lists, such as `- [Target Character]: Relationship Description`.
- **Customizable Styles**: Highly customizable appearance (colors, lines, dashes, etc.), which can be deeply modified via CSS Snippets.
- **Complete Example**: Copy and customize the [complete Lore Graph CSS snippet example](LORE_GRAPH_CSS_EXAMPLE.css), which applies to both the standalone graph and Workbench Full Lore Graph.
- **Dynamic Interaction**: Double-click to jump to the character document, scroll wheel to zoom, and right-click to pan the canvas. Hover to highlight related nodes and edges.

##### How to Use

###### Open Lore Graph
1. Right-click any document **inside the Lore folder**, and select **Open Relation Graph** from the context menu.
2. The plugin will automatically infer the novel this document belongs to, load global characters, and open the graph view in the right sidebar.

###### Define Explicit Relationships
1. In the lore document (e.g., `Characters.md`), find the character heading where you want to add relationships (e.g., `## Protagonist`).
2. Create a level-3 heading named `### Relations` under the character name.
3. Fill it out in the following format (bold text represents the **Relation Name**, followed by a colon and target characters separated by commas):
```markdown
## John Doe
**Alias**: Johnny
**Description**: The Protagonist

### Relations
- **Childhood Friend**: Jane Doe
- **Arch-nemesis**: Bob, Alice
```
4. The Lore Graph will parse `**Relation Name**: Target Name` and draw arrows and labels with solid lines in the graph.

##### Related Settings
- **Collapse Subheadings in Hover Card**: For long quick-reference content, collapse level-3 and deeper subheadings by default and expand them on click.
- **Auto-Link Mentions**: When enabled, the graph creates relationships from mentions of other lore names or aliases. When disabled, it displays only relationships explicitly defined under `### Relations`.
- **Enable Cross-File Lore Graph**: When enabled, the graph reads the entire lore folder and builds global relationships. This may add processing cost with very large lore collections. When disabled, it stays within the current lore document.

#### Lore Overview

##### Overview
- **Direct Card Extraction**: Extracts all setting cards from the Lore Board into a dedicated side panel for intuitive reference across categories.
- **Collapsible Category Groups**: Groups cards under collapsible headers showing the category name and item count, matching the Chapter Overview volume grid experience.
- **In-Place Editing & Saving**: Click the edit pencil icon on any card to open an adaptive textarea for direct editing; auto-saves on blur or Esc and updates the source note.
- **Click-to-Locate Navigation**: Click any lore card title to open the source setting note in a split pane and jump directly to highlighted keyword position.
- **Immersive Mode Component**: Can be slotted into any Immersive Mode layout slot for real-time reference and note-taking during full-screen writing.

##### How to Use
1. Open the command palette (Ctrl/Cmd + P) and type `Open Lore Overview`.
2. Or assign "Lore Overview" to any slot in the Immersive Mode visual layout designer in plugin settings.

---

### Chapter Overview (Classic)

#### Overview
- **Sidebar Mounting**: The original Chapter Overview panel is still available, mainly used to be mounted in Obsidian's left or right sidebars as an auxiliary view, or as a dedicated component in **Immersive Mode**.
- **Volume Grouping Support**: Recognizes volume subdirectories within the novel folder. When volumes exist, it automatically displays collapsible volume headers with chapter counts, perfectly matching the Workbench corkboard.
- **Status Labels**: Supports marking chapter status (To Write, Outline, Draft, Revising, Final) and directly editing chapter summaries (saved to the frontmatter `synopsis` field).
- **Word Count**: Each card displays the chapter word count at the bottom.

#### How to Use

##### Open Chapter Overview
1. Open the command palette (Ctrl/Cmd + P) and type `Open Chapter Overview`
2. Or assign "Chapter Overview" to any slot in immersive mode

##### Editing Chapter Summaries
1. Click the card content area
2. Enter the chapter summary
3. Press Ctrl+Enter or click elsewhere to save; press Esc to cancel

##### Switching Chapter Status
1. Click the status label in the top-right corner of the card
2. Select a new status from the popup menu

> **Tip**: Status and summary information is saved in each chapter file's YAML frontmatter (`status` and `synopsis` fields).

---

### Proofreading

#### Overview
- **Local Real-Time Scanning & Privacy**: Typo detection, synonym recommendations, sensitive term scanning, punctuation checks, and “De/Di/De” grammar hints all run strictly locally. Manuscript text is never uploaded, and the plugin performs no automatic networking.
- **Scope**: Once enabled, proofreading checks every Markdown file in configured workspaces, while dictionary folders are always excluded. Enable **Enable Vault-wide Proofreading** to extend checking to every Markdown file in the current vault.

> **Language scope:** The downloadable **Basic Typo Dictionary** and experimental **“De/Di/De” Grammar Check** support Chinese text only. Both start as "Not Downloaded" (0 entries) with no automatic networking and use their separate update buttons in Settings. Initial grammar-dictionary download does not enable the default-off check automatically. Custom Markdown dictionaries and text-language punctuation checks remain available for English text.

- **Custom Markdown Dictionaries (Vault-Editable)**: Custom dictionaries are stored as plain Markdown table files in `Proofreading Dictionaries/` (`Typos.md`, `Synonyms.md`, `Sensitive Words.md`) or Chinese `校对词典/` (`错词.md`, `近义词.md`, `敏感词.md`). Existing dictionary paths and files are strictly preserved across language switches:
  - **Typos**: Table header `| Typo | Suggestion | Description |` (Chinese `| 错词 | 建议 | 说明 |`).
  - **Synonyms**: Table header `| Synonym Group | Description |` (Chinese `| 近义词组 | 说明 |`), supporting symmetric bidirectional recommendations (one group per word).
  - **Sensitive Words**: Table header `| Term | Suggestions | Level | Exceptions | Description |` (Chinese `| 词语 | 建议 | 级别 | 例外 | 说明 |`), with severity levels `Info` / `Warning` (or Chinese `提示` / `警告`).
  - **Template Creation & Restoration**: Missing templates are automatically created on first enabling proofreading or on first using **Annotate to Dictionary** (via desktop context menu or cross-platform command). Clicking **Regenerate Missing Templates** restores missing default Markdown table files without overwriting existing content.
- **Punctuation Check**: Disabled by default. Suggests Chinese full-width or English half-width punctuation based on the surrounding text language (independent of UI language), and checks paired punctuation (such as `“”` or `《》`) for unclosed, isolated, or consecutive occurrences.
- **Underline Patterns & Interactive Cards**: Highlights issues in the visible viewport with distinct underline styles. Hover or click any highlight to view replacement cards with one-click in-place application. In any Markdown document except the proofreading dictionary files, select short single-line text and right-click **Annotate to Dictionary** on desktop, or run the same command on any platform to add a custom entry.

#### How to Use
1. Open **Settings → Proofreading** (located to the right of Typography) and enable **Enable Proofreading**.
2. On first activation, `Proofreading Dictionaries/` (or `校对词典/` in Chinese locale) and default template Markdown files are automatically created (or loaded directly if already present). Use **Regenerate Missing Templates** if template files are accidentally removed.
3. Type in any Markdown document within the active scope, and diagnostics in the visible viewport will highlight automatically. Hover over or click highlighted text to view replacement options and apply them in place. To check documents outside configured workspaces, enable **Enable Vault-wide Proofreading**.
4. In any Markdown document except the proofreading dictionary files, select short single-line text and right-click **Annotate to Dictionary** on desktop. You can also assign the command under **Settings → Hotkeys** or add it to Obsidian's mobile toolbar. The first use also prepares the dictionary directory and templates.
5. Toggle **Punctuation Check** independently in Settings as needed.

---

### Advanced Search

#### Overview
- **Multi-Scope Search**: Supports global search, current book search, and custom scope search
- **Current Book**: Automatically identifies the work directory of the currently open file and only searches files within that directory
- **Custom Scope**: Tree-view multi-select to choose multiple folders and files as the search scope
- **Result Preview**: Displays context snippets around matched keywords with highlighted matches
- **One-Click Jump**: Click a search result to jump directly to the matching position in the corresponding file

#### How to Use

##### Open Advanced Search
1. Open the command palette (Ctrl/Cmd + P) and type `Advanced Search`
2. The search panel opens

##### Search Scope
- **Global Search**: Searches all Markdown files in the vault
- **Current Book**: Automatically identifies the top-level work directory of the current file and searches only that directory
- **Custom Scope**: Expand the tree view and check the folders or files you want to search

##### Search Operations
1. Enter the search keyword
2. Select the search scope
3. Click "Start Search" or press Enter
4. View the search results and click a match to jump to the corresponding position

> **Tip**: Search results are displayed in the order determined by smart chapter sorting and custom drag sorting, consistent with the order in the file explorer.

---

### Writing Status Panel

#### Overview
- **Current Work Info**: Displays the directory name and total word count of the current file
- **Real-Time Statistics**: Displays progress for daily goals and chapter goals
- **Time Breakdown**: Displays focus time and slack time
- **Historical Charts**: Displays writing data for the last 7 days
- **Time-Limited Task Progress**: Progress bars and deadline reminders for in-progress tasks, highlighted when goal is met

#### How to Use

##### Open the Panel
1. Click the left Ribbon icon (bar chart icon)
2. Or command palette → `Toggle Writing Status Panel`

##### Panel Content
- **Current Work**: Directory name, total word count
- **Today's Status**: Daily goal progress, chapter goal progress, time-limited task goal progress
- **Focus Timer**: Total duration, focus time, slack time
- **Word Count Statistics**: This week/month/year net increase, cumulative total, 7-day bar chart

##### View Historical Statistics
1. Click **View Historical Statistics** in the panel
2. A detailed historical data window opens
3. You can view statistics for any date

##### Back Up and Restore History Data (Desktop)
1. Open **Settings → WebNovel Assistant → Data Output**
2. Under **History Data Backup** at the top, click **Export History Data** and save the JSON backup
3. After reinstalling the plugin, return to the same location, click **Restore History Data**, and select the backup
4. After confirmation, the backup's daily word counts, focus time, and slack time replace the current history

> History-only backups do not include plugin settings or sticky notes. Mobile users, and anyone who also needs settings or sticky notes, should continue to back up the complete `data.json` file from the plugin directory.

> **Mobile**: The Writing Status Panel does not show the time-tracking card on mobile; use the Mobile Floating Word Count & Focus Timer widget instead. Its experimental timer filters out screen-off and background time, and data syncs with desktop.

---

## Mobile Features

### Copy Document Pure Text

#### Overview
- **Extract Pure Text**: One-click extraction of all text content from the current document, automatically stripping out all Markdown formatting (headings, bold, italics, code blocks, links, images) and HTML tags.
- **Auto Formatting**: When copying, the document title and a blank line are automatically added at the top, making it ready to paste directly to web novel platforms, blogs, or social media.
- **Solves Mobile Limitations**: Overcomes Obsidian mobile's native selection bug where "Select All" fails on long documents beyond the visible viewport.
- **Quick Access**: Available via the command palette, file explorer context menu, and editor context menu.

#### How to Use

##### Method 1: Command Palette
1. Open the command palette (Ctrl/Cmd + P)
2. Type `Copy Document Pure Text`
3. After execution, a notification appears: `Document content copied`

##### Method 2: Context Menu
1. Right-click inside the editor or on a file in the file explorer.
2. Select **Copy Document Pure Text**.

##### Use Cases
- Need to quickly share an entire article to social media or a publishing platform.
- The document is too long on mobile to select manually.
- Need to quickly back up text content to an external editor.

---

### Floating Word Count & Focus Timer (Experimental)

#### Overview
- **Mobile Exclusive**: Displays floating word count and focus timer window on mobile devices.
- **Real-Time Updates**: Automatically updates word count, target percentage, and focus timer while editing.
- **Edge Docking & Auto-Collapse**: Dragging to left/right screen edges (≤35px) automatically collapses the widget into a subtle semi-transparent handle (opacity 0.35) without obstructing typing; click or hover expands it back.
- **Settings Customization**: Adjust the **Focus Sensitivity Threshold** slider in mobile settings to control idle timeout detection.

#### How to Use
1. Open plugin settings → Enable **Show Floating Word Stats**; for timing, also enable **Enable Focus Timer on Mobile (Experimental)**.
2. The widget displays current word count, chapter goal, and completion percentage; when timing is enabled, use the play/pause button to control focus duration.
3. Drag to left or right screen edge to trigger edge docking collapse.

> **Tip**: After enabling the floating window, status bar word count is automatically hidden to avoid duplicate display. The experimental focus timer filters out screen-off and background time, and data syncs with desktop.

---

## Streaming Features

### OBS Overlay

#### Overview
- **HTTP Server**: Provides real-time data interface
- **Browser Source**: Displays writing data in OBS
- **Custom Styles**: Supports custom CSS
- **Theme Switching**: Light/Dark themes

#### How to Use

##### Enable OBS Overlay
1. Open plugin settings
2. Enable **OBS Overlay**
3. Set the port (default: 24816)
4. Restart the plugin

##### Add in OBS
1. Open OBS Studio
2. Add a **Browser** source
3. Enter the URL: `http://127.0.0.1:24816/`
4. Width: 800, Height: 600
5. Check **Refresh browser when scene becomes active**

##### Copy URL
- Open **Settings → Data Output → OBS Data Overlay**, then click **Copy URL**.

##### Customize Display Content
In plugin settings, you can toggle the visibility of:
- Focus time
- Slack time
- Total duration
- Today's word count
- Today's goal
- Current session word count

##### Custom Styles
1. **Change Theme**: Select **Light** or **Dark** in settings
2. **Adjust Transparency**: Drag the slider to adjust background transparency (0-1, default 0.85)
3. **Custom CSS**: Enter custom style code in settings

For detailed CSS customization guide, see: [OBS Overlay CSS Guide](OBS_OVERLAY_CSS_GUIDE.md)

---

## Other Settings

### Language Settings

#### Overview
- **Bilingual Support**: The plugin supports both Chinese and English language interfaces
- **Auto Language Detection**: On first installation, the plugin automatically detects Obsidian's language setting — Chinese environment displays Chinese, other environments display English
- **Seamless Language Switching**: Custom document names are preserved when switching languages, old language documents are automatically matched, and no duplicates are generated
- **Cross-Language Document Compatibility**: English mode can recognize old Chinese documents (e.g., `伏笔.md`), and Chinese mode can also recognize English documents
- **Auto Document Renaming**: When changing the default document name in settings, all old documents under every workspace are automatically renamed in bulk

#### How to Use

##### Switch Language
1. Open plugin settings → **General**
2. Find the **语言/Language** option
3. Select **中文** or **English** from the dropdown
4. After switching, all panels, dialogs, and document labels update automatically

> **Tips**:
> - Switching languages does not affect existing custom document names
> - Documents created in one language remain recognizable and editable in another language
> - Foreshadowing tags now use comma separation (e.g., `#Character, #Plot`); old data with space-separated tags is automatically compatible

---

### Eye Comfort Mode

#### Overview
- Adds an eye-friendly background color to the editor
- Reduces eye strain during long writing sessions

#### How to Use
1. Open plugin settings
2. Enable **Eye Comfort Mode**
3. Customize the comfort color (default: #E8F5E9 light green)

---

### Typography Settings

In the plugin settings **Typography** tab, enable **Enable Typography Control** to apply first-line indent, line height, paragraph spacing, letter spacing, maximum line width, heading/body alignment, and body text size to chapters, other documents, or selected functional documents (Lore, Novel Info, Timeline, Foreshadowing, and Timed Tasks). Enabling **Apply Across Vault** extends typography to every ordinary document in the current vault; functional documents and card content remain independently controlled, and the Homepage is always excluded. **Apply to Cards** in Scope Settings applies only the current indent setting to both displayed and edited sticky-note, lore-card (including hover preview), chapter-card, and timeline-event-card content; font size and all other typography continue to follow each card's existing design. Body text size is shared by editing, reading, and chapter-merge previews; when custom body text size is disabled, Obsidian's native `Ctrl + mouse wheel` adjustment remains available. If you use `<br>` soft breaks, enable **Reading Mode Compatibility** to add indent placeholders to continuation lines in Reading Mode. The Command Palette also provides **Quick Typography Adjustment** and increase/decrease body-font commands.

---

### Debug Mode

On desktop, enable **Debug Mode** at the bottom of **Settings → Data Output → OBS Data Overlay** to print performance and runtime logs to the developer console. Keep it disabled during normal use; enable it temporarily when diagnosing an issue and include only relevant logs in a bug report.

---

### Keyboard Shortcuts

#### Overview
The plugin provides multiple commands that can be assigned custom keyboard shortcuts in Obsidian settings for quick access to frequently used features.

#### How to Set Up
1. Open Obsidian settings
2. Find the **Hotkeys** option
3. Search for "WebNovel" or a specific command name
4. Click the **+** icon on the right side of the command
5. Press your desired keyboard shortcut combination
6. Save

##### Customizable Commands

This list matches the commands currently registered by the plugin. Commands marked “desktop only” are not registered on phones or tablets.

##### Panels, Homepage, and Workbench
- **Toggle Writing Status Panel**
- **Toggle Foreshadowing Panel**
- **Toggle Timeline Panel**
- **Toggle Writing Workbench View**
- **Open Chapter Overview**
- **Open Lore Overview**
- **Open Creative Homepage**
- **Workbench: Clear Search Filter**

##### Immersive Mode and Typography (Immersive Mode is desktop only)
- **Toggle Full-Screen Immersive Writing Mode**
- **Quick Typography Adjustment**
- **Quickly Adjust Body Font Size: Increase**
- **Quickly Adjust Body Font Size: Decrease**

##### Chapters and Statistics
- **Set Chapter Word Count Goal**
- **Create Next Chapter (Smart Increment)**
- **Manually Refresh Chapter Sort (Usually Unnecessary)**
- **Rebuild Folder Word Count Cache**
- **Reset today writing stats**
- **Start/Pause Focus Time Tracking** (desktop only)

##### Foreshadowing, Timeline, Lore, and Proofreading
- **Mark as Foreshadowing**
- **Mark Foreshadowing as Resolved**
- **Add to Timeline**
- **Add New Lore Entry**
- **Rebuild Lore Cache**
- **Annotate to Dictionary**

##### Sticky Notes, Search, and Documents
- **Open Sticky Note List**
- **Create Blank Floating Note** (desktop only)
- **Show/Hide All Floating Notes** (desktop only)
- **Advanced Search (Filter by Book/Global/Multi-Directory)**
- **Copy This Document** (available on all platforms and especially useful for long-document selection limits on mobile)

#### Recommended Shortcut Settings

Here are some recommended shortcut configurations (for reference only):

| Feature | Recommended Shortcut | Notes |
|---------|---------------------|-------|
| Toggle Full-Screen Immersive Writing Mode | `Ctrl/Cmd + Shift + I` | I = Immersive |
| Mark as Foreshadowing | `Ctrl/Cmd + Shift + F` | F = Foreshadowing |
| Toggle Foreshadowing Panel | `Ctrl/Cmd + Shift + B` | B = Bookmark |
| Toggle Timeline Panel | `Ctrl/Cmd + Shift + T` | T = Timeline |
| Toggle Writing Workbench View | `Ctrl/Cmd + Shift + W` | W = Workbench |
| Toggle Writing Status Panel | `Ctrl/Cmd + Shift + S` | S = Status |
| Create Blank Floating Note | `Ctrl/Cmd + Shift + N` | N = Note |
| Advanced Search | `Ctrl/Cmd + Shift + H` | H = Hunt |
| Start/Pause Focus Time Tracking | `Ctrl/Cmd + Shift + P` | P = Pause |
| Create Next Chapter (Smart Increment) | `Ctrl/Cmd + Shift + C` | C = Create |

> **Tips**:
> - Shortcuts can be freely customized to your personal preferences
> - Avoid conflicts with Obsidian or other plugin shortcuts
> - Mobile does not support keyboard shortcuts; use the command palette or menus instead

---

## Multi-Platform Adaptation

The plugin provides full feature integration across **Desktop** and **Mobile (Phone / Tablet)**. All core creative tools (Creative Homepage, Writing Workbench, Word Count & Focus Analytics, Foreshadowing Manager, Story Timeline, Lore Graphs, Task Tracker) are fully available on mobile devices, with UI layouts automatically adapted for different screen sizes:

### Desktop
- **Full Feature Suite**: Supports all features including creative homepage, writing workbench, immersive mode, floating desktop notes, OBS streaming overlay, and Worker background time tracking.
- **High Performance**: Enables full file explorer word count caching and high-performance graph rendering.

### Mobile (Phone & Tablet)
- **Unified Functionality**: Phones and tablets share full mobile capabilities, including the full workbench suite, mobile floating stats widget (with focus timer and edge docking/collapse), quick lookup cards, and one-click full document copy command.
- **Responsive Layout Adaptation**:
  - **Phone (`body.is-phone`)**: Activates mobile-first compact layouts (stacked headers, compact heatmaps, touch-scrolling timeline cards, vertical button flows).
  - **Tablet (`body.is-tablet`)**: Activates tablet widescreen layouts (inline header buttons, expanded multi-column grids, sidebar integration).
- **Platform Limitations**: Immersive Writing Mode, OBS Streaming Overlay (requires local HTTP server), and multi-window desktop floating notes are desktop-exclusive.

---

## FAQ

### Q: How do I exit Immersive Writing Mode?
A: Immersive Writing Mode is desktop-only. Move the pointer to the extreme top-right corner to reveal the semi-hidden **Exit Immersive Mode** button, then click it. You can also open the Command Palette and run **Toggle Full-Screen Immersive Writing Mode** again. Assigning this command under **Settings → Hotkeys** in advance is recommended. The plugin locks `Esc` so the system does not leave fullscreen without fully restoring the immersive layout, so `Esc` is not the normal exit method.

### Q: Why does proofreading miss issues or produce inaccurate or false-positive results?
A: Proofreading runs entirely locally and does not use AI or online semantic analysis. The official local dictionaries are still growing, so limited coverage can cause missed issues; context-based checks such as De/Di/De and punctuation may also flag proper nouns, fictional phrasing, or ambiguous sentences. Treat every suggestion as a prompt for manual review rather than applying it blindly. Use **Annotate to Dictionary** to add missing entries to your custom dictionaries. Contributions of high-confidence entries and anonymized examples to the repository's `dictionary` branch are also welcome; see the contribution instructions in the Proofreading section.

### Q: Why did history or sticky notes fail to sync through Obsidian Sync, and has this been fixed?
A: Older plugin versions stored history, sticky notes, and caches in additional JSON files, while Obsidian Sync primarily recognizes a third-party plugin's `data.json`. This could sync settings without syncing history or notes. The latest plugin now stores settings, writing history, and sticky notes together in `data.json`, and performs a one-time migration from old files when the corresponding data has not yet been migrated. `cache-data.json` and downloaded official dictionaries remain device-local because they can be rebuilt or downloaded again. Update every device to the latest version, wait for Obsidian Sync to finish, and then reload the plugin. Before uninstalling, reinstalling, or working on mobile, backing up the complete `data.json` is still recommended.

### Q: Word count seems inaccurate?
A:
1. Check if **Show Word Counts in File Explorer** is enabled
2. Try **Rebuild Folder Word Count Cache**
3. Try **Reload/Restart Obsidian**
4. Confirm file encoding is UTF-8

### Q: Installation failed or the plugin cannot be enabled?
A:
1. Confirm that Obsidian is version 1.8.7 or later, then turn off Restricted Mode in **Settings → Community plugins** before enabling the plugin.
2. If Community Plugins installation fails, check your network, proxy, or firewall, then restart Obsidian and try again.
3. For manual installation, make sure `main.js`, `manifest.json`, and `styles.css` are in the same `.obsidian/plugins/web-novel-assistant/` folder, without an extra nested extraction folder.
4. On mobile devices (especially Android), installation or loading failures may be caused by an outdated system WebView engine. Try updating Android System WebView and/or your system browser/Chrome from the app store, restart Obsidian or the device, and try again (this applies only to mobile environments, not desktop).
5. If an old-file overwrite still fails to load and requires reinstallation, close Obsidian normally first and back up `data.json` to preserve plugin settings, historical statistics, and any sticky-note contents and states not separately saved as Markdown files.

### Q: When should I use “Rebuild Lore Cache”?
A: Run **Command Palette (Ctrl/Cmd + P) → `Rebuild Lore Cache`**. It rebuilds lore entries and chapter lore-reference statistics, then refreshes editor highlights, the Workbench, and the relation graph. It is especially useful:
1. After importing a novel, to populate lore-reference statistics for the imported chapters.
2. When Lore Lookup underlines, hover cards, Workbench statistics, or the relation graph display incorrectly.
3. When installing the plugin for the first time in an existing library that already contains lore files and chapters.

### Q: Why can't I find the commands to open the Chapter Overview and Lore Overview side panels in the Command Palette?
A: Chapter Overview and Lore Overview depend on the currently active novel context, so their open commands are available only while a chapter file from a novel is focused.

### Q: Lore highlights / hover popovers do not appear, or Workbench shows "No lore entries"?
A:
1. **Check Workspace Folders Setting (Common Misconfiguration)**:
   - **Single Book / Vault-wide Novel Project**: If your entire vault is dedicated to writing, **leave the "Workspace Folders" setting empty**.
   - **Multiple Books Under a Library Directory**: The Workspace Folder setting is designed as a "parent container for multiple books" (e.g., `Novels/`), and the plugin automatically treats each direct subfolder as an independent book. **Do NOT add an individual book folder (e.g., `Novels/Book1/`) directly as a workspace folder**, as this causes volume subfolders (e.g., `Volume 1`) to be misidentified as separate books and lose link to the peer `Lore/` directory.
2. **Verify Lore Folder & Entry Format**:
   - Lore markdown files must be placed inside the `Lore/` (or `设定/`) directory under the book root.
   - Lore entries must use `## Level 2 Headings` as the canonical entry names (aliases can be added using `**Alias**: Alias1, Alias2` in the content).
3. **Rebuild Lore Cache**:
   - Press `Ctrl/Cmd + P` to open the Command Palette and run **`WebNovel Assistant: Rebuild Lore Cache`**.

### Q: Chapter sorting not working?
A:
1. Check if **Smart Chapter Sorting** is enabled
2. Confirm filenames match the rule format
3. Try **Manually Refresh Chapter Sort (Usually Unnecessary)**

### Q: OBS overlay not displaying?
A:
1. Check if **OBS Overlay** is enabled
2. Confirm the port is not in use
3. Test by visiting `http://127.0.0.1:24816/` in a browser
4. Check firewall settings

### Q: Can't find the foreshadowing file?
A:
1. The foreshadowing file is in the same directory as the current file
2. The default filename is `Foreshadowing.md`
3. You can change the filename in settings

### Q: Time tracking seems inaccurate?
A:
1. Confirm time tracking is started (command palette)
2. Check the **Idle Timeout Threshold** setting
3. 60 seconds of inactivity automatically switches to slack time

### Q: Note content lost?
A:
1. You are prompted to save when closing a note
2. Note state is saved in plugin settings
3. It is recommended to save to a file promptly

### Q: What is the difference between Mobile and Desktop features?
A:
- **Unified Core Features**: Mobile devices (both phones and tablets) support the Creative Homepage, Writing Workbench (Chapters, Timeline, Lore, Task boards), focus timing, and foreshadowing tracking.
- **Mobile-Exclusive Features**: Includes the Mobile Floating Stats Widget (with edge docking/auto-collapse) and the "Copy This Document" command (solves the mobile Obsidian restriction where Select All only selects text in the visible viewport).
- **Device-Specific UI**: Phone and tablet views automatically adapt layout and touch gestures to fit screen sizes.
- **Desktop-Only Features**: Immersive Writing Mode (full-screen typewriter focus mode), OBS Streaming Overlay (HTTP server), and multi-window floating notes remain desktop-exclusive due to mobile touch interaction and OS sandbox restrictions.

### Q: Will reinstalling or deleting the plugin lose my writing history and sticky note data?
A:
- **Standard/Overwriting Updates**: Updating via Community Plugins or replacing `main.js` will not delete your data.
- **Complete Reinstallation/Deletion**: If you delete the plugin directory `.obsidian/plugins/web-novel-assistant/`, plugin settings, historical statistics (daily word counts and focus heatmap data), and sticky-note contents, positions, and theme states stored in `data.json` will be deleted. Any sticky notes not separately saved as Markdown files will be lost (ordinary Markdown files in your vault are not affected).
- **History-Only Backup (Desktop)**: If plugin settings and sticky notes are not needed, export a JSON backup from **Settings → WebNovel Assistant → Data Output → History Data Backup**, then restore it from the same location after reinstalling. Restoring replaces the current history.
- **Complete Backup (Desktop and Mobile)**: To preserve settings or sticky notes—or when using mobile—close Obsidian normally first and back up the complete `data.json` file from the plugin directory. Copy it back after reinstalling to restore settings, history, and sticky notes. Migrated `history-data.json` and `notes-data.json` files are retained only as legacy backups and are no longer updated.

### Q: Gutter word count markers hidden or misaligned when using Minimal or third-party themes?
A: The Minimal theme applies strict display and margin restrictions on editor gutters. You can use Obsidian's **Settings → Appearance → CSS Snippets** feature to add the following custom CSS snippet to remove visibility restrictions and adjust marker offsets & line margins:

```css
/* 1. Remove container restrictions and hidden states */
.markdown-source-view.mod-cm6 .cm-gutters {
  display: flex !important;
  opacity: 1 !important;
  background-color: transparent !important;
}

.markdown-source-view.mod-cm6 .cm-gutter.webnovel-word-count-gutter {
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  overflow: visible !important;
}

/* 2. Reset marker container positioning and offset to the right using relative + left */
.webnovel-word-count-marker-wrapper {
  display: inline-flex !important;
  visibility: visible !important;
  opacity: 1 !important;
  white-space: nowrap !important;
  transform: none !important; /* Clear previous translateX effect */
  
  /* Position control: move pixels to the right via relative positioning */
  position: relative !important;
  left: 80px !important; /* Adjust this value! Larger value moves marker further right */
}

/* 3. Add sufficient left margin for main content area to prevent overlap */
.markdown-source-view.mod-cm6 .cm-sizer {
  margin-left: 60px !important; /* Increase this value if markers overlap text after shift */
}
```

### Q: Conflicts with other plugins?
A:
- If you experience conflicts with other plugins, please submit an Issue on GitHub

---

## Feedback & Support

### Bug Reports
- GitHub Issues: [Submit an Issue](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/issues)

### Feature Requests
- GitHub Issues: [Submit a Feature Request](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/issues)

### Changelog
- [CHANGELOG.md](CHANGELOG.md)

---

## Related Documentation

- [OBS Overlay CSS Guide](OBS_OVERLAY_CSS_GUIDE.md)
- [README](../README.md)

---

**Happy Writing!** ✍️
