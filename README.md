# WebNovel Assistant Dictionaries

[中文](#中文) | [English](#english)

## 中文

### 分支说明

`dictionary` 是独立的词典数据分支，拥有自己的首次提交和提交历史，不继承 `main` 或 `dev` 的历史，也不包含插件源代码。

本分支只用于：

- 发布 [`dict/basic-wrong-words.json`](dict/basic-wrong-words.json) 基础高置信错词库；
- 发布 [`dict/dedide-lexicon.json`](dict/dedide-lexicon.json)“的 / 地 / 得”检查词表；
- 接收和校验社区错词贡献。

请勿在 `dictionary` 与 `main` / `dev` 之间执行合并、变基或 Cherry-pick，也不要向 `main` / `dev` 提交词典贡献 PR。

### 贡献指南

1. Fork 仓库，并基于 `dictionary` 创建贡献分支。
2. 复制 [`dict/contributions/_template.md`](dict/contributions/_template.md)，保存为 `dict/contributions/<GitHub用户名>-<主题>.md`。
3. 保留 `license: CC0-1.0`，填写可核查的 `source`，并用真实词条替换示例行。
4. 每个词条填写“错词、建议替换、说明”；不要直接修改官方 JSON 词典。
5. 提交 Pull Request，并将目标分支设为 **`dictionary`**。

可在提交前运行本地校验（Node.js 18 或更高版本，无需安装依赖）：

```bash
node scripts/validate-contributions.mjs
```

社区贡献采用 CC0-1.0；官方编译词典采用 MIT 许可证。

## English

### About this branch

`dictionary` is an independent data branch with its own initial commit and history. It does not inherit history from `main` or `dev`, and it contains no plugin source code.

This branch is used only to:

- publish the high-confidence typo dictionary at [`dict/basic-wrong-words.json`](dict/basic-wrong-words.json);
- publish the "的 / 地 / 得" proofreading lexicon at [`dict/dedide-lexicon.json`](dict/dedide-lexicon.json);
- receive and validate community typo contributions.

Do not merge, rebase, or cherry-pick between `dictionary` and `main` / `dev`. Do not target `main` or `dev` with dictionary contribution pull requests.

### Contribution guide

1. Fork the repository and create a contribution branch from `dictionary`.
2. Copy [`dict/contributions/_template.md`](dict/contributions/_template.md) to `dict/contributions/<github-user>-<topic>.md`.
3. Keep `license: CC0-1.0`, provide a verifiable `source`, and replace the sample row with real entries.
4. Fill in the typo, suggested replacement, and description columns. Do not edit the official JSON dictionaries directly.
5. Open a Pull Request with **`dictionary`** as the target branch.

Run the zero-dependency validator before submitting (Node.js 18 or later):

```bash
node scripts/validate-contributions.mjs
```

Community contributions use CC0-1.0. Official compiled dictionaries use the MIT License.
