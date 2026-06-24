# WebNovel Assistant User Guide

Welcome to WebNovel Assistant! An Obsidian plugin designed specifically for web novel writing.

## 📚 Table of Contents

- [Getting Started](#getting-started)
  - [Installation](#installation)
  - [First Use](#first-use)
- [Core Features](#core-features)
  - [Creative Homepage](#creative-homepage)
  - [Immersive Writing Mode](#immersive-writing-mode)
  - [Workspace Settings](#workspace-settings)
  - [Word Count](#word-count)
  - [Goal Tracking](#goal-tracking)
  - [Time Tracking](#time-tracking)
  - [File Explorer Word Count](#file-explorer-word-count)
  - [Smart Chapter Sorting](#smart-chapter-sorting)
- [Advanced Features](#advanced-features)
  - [Floating Sticky Notes](#floating-sticky-notes)
  - [Foreshadowing Management](#foreshadowing-management)
  - [Timeline Management](#timeline-management)
  - [Time-Limited Task Tracking](#time-limited-task-tracking)
  - [Lore Quick Reference](#lore-quick-reference)
  - [Chapter Overview](#chapter-overview)
  - [Advanced Search](#advanced-search)
  - [Writing Status Panel](#writing-status-panel)
- [Multi-Platform Adaptation](#multi-platform-adaptation)
- [Streaming Features](#streaming-features)
  - [OBS Overlay](#obs-overlay)
- [Other Settings](#other-settings)
  - [Language Settings](#language-settings)
  - [Eye Comfort Mode](#eye-comfort-mode)
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

### First Use

1. Open any Markdown file
2. The status bar will display the current file's word count
3. Click the status bar to set a word count goal

---

## Core Features

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

#### Creating a New Work
1. Click the "+ Create New Work" button on the right side of the greeting area
2. Fill in the work name, description, genre, and total word count goal in the dialog
3. Click "Create" to automatically generate the work folder and work info file

#### Custom Homepage Greeting
1. Open plugin settings
2. Find **Homepage Greeting**
3. Enter custom text; leave empty to use the time-based automatic greeting

---

### Immersive Writing Mode

#### Overview
- **Full-Screen Focus**: Enter a full-screen writing environment that hides all distracting elements including Obsidian sidebars, status bar, title bar, and more.
- **Dynamic Dashboard**: Top bar displays the novel title in real time, focus/slack duration, today's net word count, and goal progress.
- **Slot-Based Layout**: Freely assign auxiliary panels to the top, bottom, left, and right areas around the main editing zone. Unassigned panel areas automatically collapse to the edges, maximizing the main editing area.
- **Reference Documents**: Left-click a chapter to open the document in the main editing area; right-click to open it in the right reference area

#### How to Use
1. Open any novel chapter (Markdown file).
2. Open the command palette (Ctrl/Cmd + P) and type `Toggle Full-Screen Immersive Writing Mode`.
3. Or click the sidebar ribbon icon.

#### Related Settings
- **Slot Layout**: In the immersive mode tab on the settings page, use the visual layout editor to freely drag and assign panels (chapter list, foreshadowing, timeline, notes, reference documents, chapter overview) to the top, bottom, left, and right areas.
- **Auto-Hide Properties Panel**: When enabled, the Markdown file's properties panel at the top is automatically hidden in immersive mode.
- **Immersive Mode Note Size**: Customize the card edge length in the notes list (default 280px).
- **Immersive Mode Note Font Size**: Adjust the font size for note previews.

---

### Workspace Settings

#### Overview
- **Custom Plugin Workspace**: Specify the folder scope where the plugin operates
- **Scope of Effect**:
  - Word count (status bar, file explorer)
  - Writing status panel history
  - File modification monitoring and cache building
  - Not affected: foreshadowing, timeline, notes, and other features

#### How to Use
1. Open plugin settings
2. Find **Workspace Folder**
3. Enter the folder path (e.g., `Novels/Book One`)
4. Separate multiple folders with commas (e.g., `Novels/Book One, Novels/Book Two`)
5. Leave empty for global scope (all files are counted)

#### Use Cases
- Multiple projects in the same vault, but you only want to count words for a specific project
- Avoid counting non-novel content like notes and diaries in statistics
- Improve performance (only monitor and cache specified folders)

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
| **Web Novel Mode** (default) | All non-whitespace characters count as 1 word each (including punctuation) | Word count rules for platforms like Qidian, JJWXC, and other web novel platforms |
| **Standard Mode** | Chinese character-by-character + English by word + full-width punctuation counts; half-width punctuation excluded | Common word count scheme in Word, WPS, and other document tools |
| **Native Mode** | Chinese character-by-character + English by word, ignoring all punctuation | Closest to Obsidian's built-in word count |

##### How to Switch
1. Open plugin settings → **Word Count Display**
2. Find **Word Count Mode**
3. Select the desired mode from the dropdown
4. After switching, the entire vault is automatically recalculated

> **Tip**: Word counts for the same document may differ significantly between modes. This is normal. Simply choose the counting mode that matches your publishing platform.

---

### Goal Tracking

#### Overview
- **Chapter Goals**: Set independent word count goals for each chapter
- **Daily Goal**: Set today's writing goal
- **Progress Display**: Shows completion percentage in real time
- **Progress Bar**: Visual progress indicator

#### How to Use

##### Setting a Chapter Goal
1. Right-click a file → **Set Chapter Word Goal**
2. Enter the target word count (e.g., 3000)
3. The status bar displays progress: `1,234 / 3,000 (41%)`

##### Setting a Daily Goal
1. Open plugin settings
2. Find **Daily Word Goal**
3. Enter the target (e.g., 5000)

#### Related Settings
- **Default Word Goal**: Default target for new files (default: 3000 words)
- **Daily Word Goal**: Today's writing target (default: 5000 words)
- **Show Goal Progress**: Whether to display progress in the status bar (desktop only, enabled by default)

##### Viewing Progress
- **Status Bar**: Displays current file progress
- **Writing Status Panel**: Displays detailed statistics (click the left Ribbon icon)

---

### Strict Chapter Mode

#### Overview
- **Precise Filtering**: All word count-related features (chapter goals, word counts, left-side reminders, etc.) only take effect in documents that match "chapter naming rules."
- **Exclude Interference**: When enabled, writing outlines, settings, drafts, and other non-chapter documents will no longer be counted toward daily word progress, and progress bars or word count reminder labels will not be displayed.
- **Flexibility**: If you need to count specific named chapters (such as "Side Stories"), simply add the corresponding matching rule in the sorting rules.
- **Configurable Exception Directories**: If you need to count all documents in a specific directory (such as "Short Stories"), you can set that directory as an exception.

#### How to Use
1. Open plugin settings → **Core Settings**.
2. Enable **Enable Strict Chapter Mode**.
3. Make sure your chapter names match one of the enabled rules in **Chapter Naming Rule Configuration**.

---

### Real-Time Word Count Reminders

#### Overview
- **Word Count Reminders**: Displays cumulative word counts on the left side of the editor (line number area) in real time.
- **Visual Aid**: For example, if you set a reminder every 2000 words, labels like `2000`, `4000`, etc. will automatically appear on the left side of the editor, helping you pace your writing.
- **Smart Positioning**: Labels are precisely displayed on the line where the corresponding word count is reached.

#### How to Use
1. Open plugin settings → **Core Settings**.
2. Enable **Enable Real-Time Word Count Reminders**.
3. Enter the target word count in **Word Count Reminder Interval** (e.g., 2000).
4. Write in the editor, and reminder labels will automatically appear on the left.

#### Related Settings
- **Word Count Reminder Interval**: Set how many words between each reminder.
- **Strict Mode Integration**: If strict mode is enabled, reminders only appear in files that match chapter rules.

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
- Command palette → `Reset Stream Statistics (Clear Duration and Net Word Count)`
- Clears the current session's time and word count statistics

#### Related Settings
- **Idle Timeout Threshold**: How many milliseconds of inactivity counts as slack time (default: 60000 = 60 seconds)

> **Note**: Time tracking is not supported on mobile (requires Worker support)

---

### File Explorer Word Count

#### Overview
- **Folder Word Count**: Displays the total word count of all files in a folder
- **File Word Count**: Displays the word count of individual files
- **Real-Time Updates**: Automatically updates after file modifications
- **Workspace Filtering**: Only displays word counts for specified folders
- **Performance Optimization**: Uses a caching mechanism to avoid frequent calculations

> **Note**: This feature is disabled by default because it may affect performance in large projects. To use it, enable it manually in settings.

#### How to Use

##### Enable the Feature
1. Open plugin settings
2. Enable **File Explorer Word Count**
3. The plugin will automatically build the cache (may take a few seconds)
4. Word counts will appear in the file explorer: `Chapter 1 (3,456)`

##### Rebuild Cache
If word counts are displayed incorrectly:
1. Command palette → `Rebuild Folder Word Count Cache`
2. Wait for the rebuild to complete

#### Related Settings
- **File Explorer Word Count**: Whether to enable this feature (disabled by default to avoid performance issues)
- **Workspace Folder**: Limits the counting scope (see [Workspace Settings](#workspace-settings))

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

##### Default Preset Rules

The plugin comes with 3 common preset rules ready to use:

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

**Rule 3: Pure Numbers (1, 01, 001)**
```
Name: Pure Numbers (1, 01, 001)
Regex: ^(\d+)$
Enabled: Yes
```
Supported formats: `1`, `01`, `001` (pure numeric filenames without prefix or suffix)

##### Custom Rule Examples

Beyond the default rules, you can add your own:

**Decimal Chapters** (e.g., 1.1, 1.2, 2.1, 2.2)
```
Name: Decimal Chapters
Regex: ^(\d+\.\d+)
Enabled: Yes
```

**English Chapters** (e.g., Chapter 1, Chapter 01)
```
Name: English Chapters
Regex: ^[Cc]hapter\s*(\d+)
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

> **Important**:
> If you have both a **number rule** (e.g., `^(\d+)$`) and a **decimal rule** (e.g., `^(\d+\.\d+)`) enabled, you must place the decimal rule **above** the number rule. Otherwise, decimal chapters will be matched first by the number rule, resulting in incorrect sorting.
>
> For example: `1.1` would be matched by `^(\d+)$` as `1`, instead of being matched by `^(\d+\.\d+)` as `1.1`.
>
> **Correct order**:
> 1. Decimal Chapters `^(\d+\.\d+)` ✅
> 2. Pure Numbers `^(\d+)$` ✅

#### Related Settings
- **Enable Smart Chapter Sorting**: Master toggle.
- **Sorting Rule Configuration**: Core configuration area, supports adding, deleting, disabling, and ▲/▼ reordering.

---

## Advanced Features

### Floating Sticky Notes

#### Overview
- **Floating Windows**: Draggable, resizable note windows.
- **Multiple Themes**: 6 preset theme colors with real-time switching.
- **Auto Save**: When enabled, content is saved instantly as you type, no manual saving needed.
- **Independent Storage**: Note data is stored in `notes-data.json`, separate from the main configuration file.
- **Immersive Mode Sync**: Changes made in immersive mode are synced in real time to floating notes in normal mode.
- **Linked Files**: Can be linked to specific files; saving automatically updates the original file's content.
- **One-Click Hide/Show**: Support for one-click hiding and restoring the current note layout

#### How to Use

##### Creating a Note
**Method 1: Blank Note**
- Click the left Ribbon icon (note icon)
- Or command palette → `Create Blank Floating Note`

**Method 2: From a File**
- Right-click a file → `Extract as Sticky Note`

**Method 3: From Selected Text**
- Select text → Right-click → `Extract as Sticky Note`

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
- **Note Transparency**: Background transparency (0-1, default 0.9)

---

### Foreshadowing Management

#### Overview
- **Mark Foreshadowing**: Flag plot threads that need to be resolved
- **Multi-Chapter Resolution**: A single foreshadowing can be resolved across multiple chapters
- **Tag Categories**: Organize foreshadowing with tags
- **Timestamps**: Records creation and resolution times

#### How to Use

##### Marking Foreshadowing
1. Select the text you want to mark
2. Right-click → `Mark as Foreshadowing`
3. Or use a keyboard shortcut (must be customized in settings)
4. Enter the foreshadowing description and tags
5. Click save

##### Viewing Foreshadowing
1. Click the left Ribbon icon (bookmark icon)
2. Or command palette → `Toggle Foreshadowing Panel`
3. The panel displays all foreshadowing entries
4. Filter by **status** (All/Unresolved/Resolved/Abandoned) and **tags**

##### Resolving Foreshadowing
**Method 1: In the Foreshadowing Panel**
1. Find the foreshadowing entry to resolve
2. Click **Mark as Resolved**
3. Select the resolution chapter(s) (multiple selection supported)
4. Click confirm

**Method 2: In the Foreshadowing File**
1. Open the foreshadowing file (default name: `Foreshadowing.md`)
2. Place the cursor on the foreshadowing entry
3. Command palette → `Mark Foreshadowing as Resolved`
4. Select the resolution chapter

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

### Lore Quick Reference

#### Overview
- **Dictionary-Style Lore Database**: Create categorized documents under a lore folder (e.g., `Characters.md`, `Items.md`), and the plugin automatically scans and recognizes them
- **Auto Annotation**: Create lore entries using level-2 headings (`##`) in categorized documents, and add `**Aliases**: xxx` in the body. When you type these names in your novel text, the system automatically adds a dashed underline
- **Hover Quick Reference**: Hover over annotated text to pop up a small window precisely positioned to that entry — no need to leave the editing page
- **Right-Click "Write & Build"**: Select a new item or character name in the editor, right-click "Add as New Lore Entry," and quickly enter it in a dialog
- **Alias Support**: Supports both the YAML `aliases` field and the `**Aliases**: xxx` format in the document body

#### How to Use

##### Configure the Lore Folder
1. Open plugin settings → **Writing Aids**
2. Find **Lore Folder Name**
3. Enter the name of the folder for lore files (default: "Lore")
4. Create this folder under each work's directory and place categorized lore documents in it

##### Creating Lore Documents (Dictionary Outline Mode)
Create categorized documents under the lore folder, using `## Level-2 Headings` as the canonical entry name:

```markdown
# Characters

## Zhang San
The protagonist, a young swordsman.
**Aliases**: Brother San, Xiao Zhang

## Li Si
The villain, cunning and treacherous.
**Aliases**: Master Si

## Wang Wu
Supporting character, a loyal companion.
```

> **Tips**:
> - Each level-2 heading (`##`) is a separate entry; the heading text is the canonical name
> - The plugin only recognizes level-2 headings; level-1 (`#`) and level-3 (`###`) headings are not treated as entries
> - Aliases use the `**Aliases**: xxx` format within the entry body; multiple aliases are separated by commas
> - Aliases also support the YAML aliases field (compatible with older format)

##### Using Lore Quick Reference
1. Type a character name or alias in your text (e.g., "Zhang San" or "Brother San")
2. The text will automatically display a dashed underline
3. Hover to preview the lore card content, precisely positioned to the corresponding entry

##### Right-Click to Add New Lore
1. Select a new name in the editor (e.g., "Xuan Tie Sword")
2. Right-click → **Add as New Lore Entry**
3. Fill in the lore name, select a categorized document, add aliases and description in the dialog
4. Click save; the lore entry is automatically written to the corresponding categorized document

> **Note**: The Lore Quick Reference feature is only available on desktop (mobile does not support editor extensions).

#### Related Settings
- **Lore Folder Name**: Default `Lore`, customizable

---

### Chapter Overview

#### Overview
- **Card Display**: Displays all chapter files of the current work as a card grid
- **Status Labels**: Supports marking chapter status (To Write, Outline, Draft, Revising, Final)
- **Summary Editing**: Click the card content area to directly edit the chapter summary (saved to the frontmatter `synopsis` field)
- **Word Count**: Each card displays the chapter word count at the bottom
- **Auto Detection**: Automatically identifies the current work and displays the corresponding chapters when any chapter file is open

#### How to Use

##### Open Chapter Overview
1. Open the command palette (Ctrl/Cmd + P) and type `Toggle Chapter Overview Panel`
2. Or assign "Chapter Overview" to a slot on the right side in immersive mode

##### Editing Chapter Summaries
1. Click the card content area
2. Enter the chapter summary
3. Press Ctrl+Enter or click elsewhere to save; press Esc to cancel

##### Switching Chapter Status
1. Click the status label in the top-right corner of the card
2. Select a new status from the popup menu

> **Tip**: Status and summary information is saved in each chapter file's YAML frontmatter (`status` and `synopsis` fields).

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

> **Note**: Time tracking is not displayed on mobile (requires Worker support)

---

## Mobile Features

### Copy This Document

#### Overview
- **Cross-Platform Support**: One-click copy of all content in the current document.
- **Auto Formatting**: When copying, `# Document Title` and a blank line are automatically added at the top, making it easy to paste directly to social media, blogs, or novel publishing platforms.
- **Solves Mobile Limitations**: Obsidian mobile's Select All feature has a bug that only selects text within the visible viewport. This feature copies the entire long document.
- **Quick Access**: Available via the command palette, file explorer context menu, and editor context menu.

#### How to Use

##### Method 1: Command Palette
1. Open the command palette (Ctrl/Cmd + P)
2. Type `Copy This Document`
3. After execution, a notification appears: `Document content copied`

##### Method 2: Context Menu
1. Right-click a file in the file explorer, or right-click inside the editor.
2. Select **Copy This Document**.

##### Use Cases
- Need to quickly share an entire article to social media or a publishing platform.
- The document is too long on mobile to select manually.
- Need to quickly back up text content to an external editor.

---

### Floating Word Count

#### Overview
- **Mobile Exclusive**: Displays a floating word count window on screen
- **Real-Time Updates**: Word count updates automatically while editing
- **Progress Display**: Includes current word count, chapter goal, and completion percentage
- **Non-Obstructive**: Window position is adjustable

#### How to Use
1. Open plugin settings
2. Find **Show Mobile Floating Word Count**
3. After enabling, the floating window automatically appears on screen
4. Displays: current word count, goal word count, completion percentage

> **Tip**: After enabling the floating window, the status bar word count is automatically hidden to avoid duplicate display.

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
- Command palette → `Copy OBS Overlay URL to Clipboard`

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
1. Open plugin settings → **General Settings**
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

##### Panel Toggles
- **Toggle Foreshadowing Panel**: Quickly open or close the foreshadowing management panel
- **Toggle Timeline Panel**: Quickly open or close the timeline panel
- **Toggle Time-Limited Task Panel**: Quickly open or close the time-limited task panel
- **Toggle Writing Status Panel**: Quickly open or close the writing status panel

##### Immersive Mode
- **Toggle Full-Screen Immersive Writing Mode**: Toggle full-screen immersive writing
- **Reset Immersive Layout (Restore Default Ratios and Positions)**: Return to default panel ratios and positions

##### Foreshadowing Management
- **Mark as Foreshadowing**: Mark selected text as foreshadowing
- **Mark Foreshadowing as Recovered**: Mark the foreshadowing at the current cursor position as recovered

##### Time Tracking
- **Start/Pause Focus Time Tracking**: Start or pause time tracking
- **Reset Stream Statistics (Clear Duration and Net Word Count)**: Clear the current session's duration and net word count

##### Sticky Notes
- **Create Blank Floating Note**: Quickly create a blank note

##### Search
- **Advanced Search (Filter by Book/Global/Multi-Directory)**: Cross-scope content search

##### Chapter Overview
- **Toggle Chapter Overview Panel**: Card-style chapter outline display

##### Chapter Management
- **Create Next Chapter (Smart Increment)**: Automatically create the next chapter file based on the current chapter number
- **Manually Refresh Chapter Sort (Usually Unnecessary)**: Manually trigger chapter sorting (usually unnecessary; the plugin sorts automatically)

##### Cache Management
- **Rebuild Folder Word Count Cache**: Rebuild the file explorer's word count cache

##### Streaming
- **Copy OBS Overlay URL to Clipboard**: Quickly copy the OBS overlay access URL

##### Mobile Exclusive
- **Copy This Document**: One-click copy of entire document content (solves mobile Select All limitation)

#### Recommended Shortcut Settings

Here are some recommended shortcut configurations (for reference only):

| Feature | Recommended Shortcut | Notes |
|---------|---------------------|-------|
| Toggle Full-Screen Immersive Writing Mode | `Ctrl/Cmd + Shift + I` | I = Immersive |
| Mark as Foreshadowing | `Ctrl/Cmd + Shift + F` | F = Foreshadowing |
| Toggle Foreshadowing Panel | `Ctrl/Cmd + Shift + B` | B = Bookmark |
| Toggle Timeline Panel | `Ctrl/Cmd + Shift + T` | T = Timeline |
| Toggle Time-Limited Task Panel | `Ctrl/Cmd + Shift + R` | R = Record |
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

To ensure stability and user experience across different devices, the plugin provides tiered feature support:

### Desktop
- **Full Features**: Supports all features including immersive mode, floating notes, OBS streaming overlay, and Worker-based background time tracking.
- **High Performance Mode**: Enables full file explorer word count caching and real-time sync mechanisms.

### Tablet
- **Productivity Tools**: Supports precise word counting, goal tracking, foreshadowing management panel, timeline panel, and writing status panel.
- **UI Optimization**: Automatically adapts to tablet layouts; tapping icons automatically expands sidebar views.
- **Excluded Features**: Immersive mode and floating notes are not supported (to avoid touch interaction conflicts).

### Mobile (Lite)
- **Basic Features**: Provides precise word counting, goal tracking, and one-click copy full text.
- **Simplified Settings**: Only shows basic settings tabs to prevent misoperation; panel features can be used simply.
- **Performance Priority**: Disables heavy background tasks to ensure smooth mobile operation.

---

## FAQ

### Q: Word count seems inaccurate?
A:
1. Check if **File Explorer Word Count** is enabled
2. Try **Rebuild Folder Word Count Cache**
3. Try **Reload/Restart Obsidian**
4. Confirm file encoding is UTF-8

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

### Q: Limited mobile functionality?
A:
- Mobile only provides basic features (word count, goal tracking, copy full text)
- Advanced features (Worker time tracking, OBS, notes) are only available on desktop
- Tablet supports panel features (writing status, foreshadowing, timeline)
- Mobile provides the "Copy This Document" command, solving the Obsidian mobile limitation where Select All only selects the visible area

### Q: Conflicts with other plugins?
A:
- If you experience conflicts with other plugins, please submit an Issue on GitHub

---

## Feedback & Support

### Bug Reports
- GitHub Issues: [Submit an Issue](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/issues)

### Feature Requests
- GitHub Discussions: [Discuss Features](https://github.com/HatanoChihiro/obsidian-webnovel-assistant/discussions)

### Changelog
- [CHANGELOG.md](CHANGELOG.md)

---

## Related Documentation

- [OBS Overlay CSS Guide](OBS_OVERLAY_CSS_GUIDE.md)
- [README](README.md)

---

**Happy Writing!** ✍️
