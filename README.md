# WebNovel Assistant Dictionaries

[中文](#中文) | [English](#english)

## 中文

### 分支说明

`dictionary` 分支用于发布 WebNovel Assistant 的公开校对词典，并接收社区错词及“的 / 地 / 得”分类词项贡献。

本分支只用于：

- 发布 [`dict/basic-wrong-words.json`](dict/basic-wrong-words.json) 基础高置信错词库；
- 发布 [`dict/dedide-lexicon.json`](dict/dedide-lexicon.json)“的 / 地 / 得”检查词表；
- 接收和校验社区错词及“的 / 地 / 得”分类词项贡献。

### 贡献指南

1. Fork 仓库，并基于 `dictionary` 创建贡献分支。
2. 根据贡献类型复制对应模板：
   - 基础错词：复制 [`dict/contributions/_template.md`](dict/contributions/_template.md)，保存为 `dict/contributions/<GitHub用户名>-<主题>.md`。
   - “的 / 地 / 得”：复制 [`dict/contributions/dedide/_template.md`](dict/contributions/dedide/_template.md)，保存为 `dict/contributions/dedide/<GitHub用户名>-<主题>.md`。
3. 保留 `license: CC0-1.0`，填写可核查的 `source`，并用真实内容替换示例行。
4. 错词贡献填写“错词、建议替换、说明”；“的 / 地 / 得”贡献填写分类词项、错误例句、正确例句及可选反例。不要直接修改官方 JSON 词典。
5. 例句应简短、自拟或匿名化；不要提交小说原文、真实姓名、剧情细节或其他隐私内容。
6. 提交 Pull Request，并将目标分支设为 **`dictionary`**。

“的 / 地 / 得”贡献中的分类必须使用以下键；同一词项在不同语法位置成立时，可以分别贡献到多个分类：

| 分类键 | 中文含义 | 典型用途 |
| --- | --- | --- |
| `adverbialModifiers` | 状语修饰词 | 快乐地唱歌 |
| `actionVerbs` | 动作动词 | 认真地打开 |
| `actionNominalFollowers` | 动作名词化后继词 | 认真的打开方式（用于抑制误报） |
| `degreePredicates` | 可带程度补语的谓词 | 跑得快 |
| `degreeComplementPrefixes` | 程度补语前缀 | 跑得很快 |
| `degreeComplementAdjectives` | 程度补语形容词 | 做得漂亮 |
| `degreeComplementPhrases` | 固定程度补语短语 | 笑得合不拢嘴 |
| `comparativeAdjectives` | 可比较形容词 | 做得更好 |
| `comparativeWords` | 比较程度词 | 更好得多 |
| `nounLookaheadExclusions` | 名词前瞻排除词 | 用于保护歧义搭配 |
| `attributiveAdjectives` | 定语形容词 | 美丽的女孩 |
| `attributiveNouns` | 被定语修饰的名词 | 沉默的女孩 |

可在提交前运行本地校验（Node.js 18 或更高版本，无需安装依赖）：

```bash
node scripts/validate-contributions.mjs
node scripts/validate-dedide-contributions.mjs
```

### 采纳与自动发布流程

- **最终审核**：Maintainer 合并 PR 即代表词条通过审核并最终采纳。
- **自动发布**：PR 合并入 `dictionary` 分支后，CI 会按贡献类型自动合并至 [`dict/basic-wrong-words.json`](dict/basic-wrong-words.json) 或 [`dict/dedide-lexicon.json`](dict/dedide-lexicon.json)。
- **版本与日期**：发生实际合并的对应词典会独立递增补丁版本号（patch version）并更新 UTC 日期；另一份词典保持不变。
- **贡献文件归档**：发布完成后，已处理的贡献 Markdown 文件会从当前工作树中移除，但完整保留在 Git 提交历史中。
- **隐私边界**：插件不会读取或上传用户正文；只有用户主动创建并提交的贡献文件会进入 Pull Request。

社区贡献采用 CC0-1.0；官方编译词典采用 MIT 许可证。

## English

### About this branch

The `dictionary` branch publishes the public proofreading dictionaries for WebNovel Assistant and accepts community typo and De/Di/De lexicon contributions.

This branch is used only to:

- publish the high-confidence typo dictionary at [`dict/basic-wrong-words.json`](dict/basic-wrong-words.json);
- publish the "的 / 地 / 得" proofreading lexicon at [`dict/dedide-lexicon.json`](dict/dedide-lexicon.json);
- receive and validate community typo and De/Di/De lexicon contributions.

### Contribution guide

1. Fork the repository and create a contribution branch from `dictionary`.
2. Copy the template for the contribution type:
   - Typos: copy [`dict/contributions/_template.md`](dict/contributions/_template.md) to `dict/contributions/<github-user>-<topic>.md`.
   - De/Di/De: copy [`dict/contributions/dedide/_template.md`](dict/contributions/dedide/_template.md) to `dict/contributions/dedide/<github-user>-<topic>.md`.
3. Keep `license: CC0-1.0`, provide a verifiable `source`, and replace sample rows with real content.
4. Typo rows require a typo, replacement, and description. De/Di/De rows require a categorized term, wrong example, correct example, and optional negative example. Never edit official JSON dictionaries directly.
5. Keep examples short, self-authored, or anonymized. Do not submit manuscript excerpts, real names, plot details, or private information.
6. Open a Pull Request with **`dictionary`** as the target branch.

De/Di/De contributions must use one of these category keys. A term may be contributed to multiple categories when supported by distinct examples:

| Category key | Meaning | Typical use |
| --- | --- | --- |
| `adverbialModifiers` | Adverbial modifier | 快乐地唱歌 |
| `actionVerbs` | Action verb | 认真地打开 |
| `actionNominalFollowers` | Action nominalization follower | 认真的打开方式 (false-positive suppression) |
| `degreePredicates` | Predicate accepting a degree complement | 跑得快 |
| `degreeComplementPrefixes` | Degree-complement prefix | 跑得很快 |
| `degreeComplementAdjectives` | Degree-complement adjective | 做得漂亮 |
| `degreeComplementPhrases` | Fixed degree-complement phrase | 笑得合不拢嘴 |
| `comparativeAdjectives` | Comparable adjective | 做得更好 |
| `comparativeWords` | Comparative degree word | 更好得多 |
| `nounLookaheadExclusions` | Noun-lookahead exclusion | Protects ambiguous contexts |
| `attributiveAdjectives` | Attributive adjective | 美丽的女孩 |
| `attributiveNouns` | Noun modified by an attribute | 沉默的女孩 |

Run the zero-dependency validator before submitting (Node.js 18 or later):

```bash
node scripts/validate-contributions.mjs
node scripts/validate-dedide-contributions.mjs
```

### Acceptance & Automated Publication

- **Final Approval**: Maintainer merging the PR constitutes final review approval and acceptance.
- **Automated Publication**: Once merged into `dictionary`, CI merges accepted entries into [`dict/basic-wrong-words.json`](dict/basic-wrong-words.json) or [`dict/dedide-lexicon.json`](dict/dedide-lexicon.json), according to contribution type.
- **Version & Date**: Only the dictionary receiving entries independently increments its patch version and UTC update date; the other dictionary remains unchanged.
- **Contribution Archival**: Processed contribution Markdown files are removed from the active tree after publication, while permanently preserved in Git history.
- **Privacy Boundary**: The plugin never reads or uploads manuscript text. Only contribution files explicitly created and submitted by users enter a Pull Request.

Community contributions use CC0-1.0. Official compiled dictionaries use the MIT License.
