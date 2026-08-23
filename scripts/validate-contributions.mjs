import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const STRICT_SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function incrementPatchVersion(version) {
	if (typeof version !== 'string') {
		throw new Error(`Invalid version format: ${String(version)}`);
	}
	const match = version.trim().match(STRICT_SEMVER_REGEX);
	if (!match) {
		throw new Error(`dictionaryVersion "${version}" is not a strict x.y.z semver.`);
	}
	const major = match[1];
	const minor = match[2];
	const patch = BigInt(match[3]) + 1n;
	return `${major}.${minor}.${patch.toString()}`;
}

function restoreContributionFiles(files, contentsMap, targetDir) {
	for (const file of files) {
		const content = contentsMap.get(file);
		if (content !== undefined) {
			const filePath = path.join(targetDir, file);
			try {
				fs.writeFileSync(filePath, content, 'utf8');
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`❌ Failed to restore contribution file "${file}": ${msg}`);
			}
		}
	}
}

function cleanupTempFile(filePath) {
	if (filePath && fs.existsSync(filePath)) {
		try {
			fs.unlinkSync(filePath);
		} catch {
			// ignore cleanup error
		}
	}
}

const isPublishMode = process.argv.slice(2).includes('--publish');

console.info(
	isPublishMode
		? '🚀 Running typo contributions publication...'
		: '🔍 Running typo contributions validation...'
);

const rootDir = path.resolve(__dirname, '..');
const contributionsDir = path.join(rootDir, 'dict', 'contributions');
const officialDictPath = path.join(rootDir, 'dict', 'basic-wrong-words.json');
const candidateOutputPath = path.join(rootDir, 'dict', 'candidate-basic-wrong-words.json');

const errors = [];

// 1. 读取与严格校验官方基础错词库 (Official Basic Wrong Words)
let rawOfficialContent = null;
let officialJson = null;
const officialEntries = new Map();
const officialEntriesList = [];

if (fs.existsSync(officialDictPath)) {
	try {
		const raw = fs.readFileSync(officialDictPath, 'utf8');
		rawOfficialContent = raw;
		const parsed = JSON.parse(raw);

		if (!isRecord(parsed)) {
			errors.push('Official basic-wrong-words.json: Root must be an object.');
		} else if (parsed.schemaVersion !== 1) {
			errors.push(`Official basic-wrong-words.json: Expected schemaVersion 1, got ${String(parsed.schemaVersion)}.`);
		} else if (typeof parsed.dictionaryVersion !== 'string' || !parsed.dictionaryVersion.trim()) {
			errors.push('Official basic-wrong-words.json: Missing or empty dictionaryVersion.');
		} else if (!STRICT_SEMVER_REGEX.test(parsed.dictionaryVersion.trim())) {
			errors.push(`Official basic-wrong-words.json: dictionaryVersion "${parsed.dictionaryVersion}" is not a strict x.y.z semver.`);
		} else if (typeof parsed.updatedAt !== 'string' || !parsed.updatedAt.trim()) {
			errors.push('Official basic-wrong-words.json: Missing or empty updatedAt.');
		} else if (typeof parsed.license !== 'string' || !parsed.license.trim()) {
			errors.push('Official basic-wrong-words.json: Missing or empty license.');
		} else if (typeof parsed.source !== 'string' || !parsed.source.trim()) {
			errors.push('Official basic-wrong-words.json: Missing or empty source.');
		} else if (!Array.isArray(parsed.entries)) {
			errors.push('Official basic-wrong-words.json: Field "entries" must be an array.');
		} else {
			officialJson = {
				...parsed,
				entries: []
			};
			for (let idx = 0; idx < parsed.entries.length; idx++) {
				const entry = parsed.entries[idx];
				if (!isRecord(entry)) {
					errors.push(`Official basic-wrong-words.json: Entry at index ${idx} is not an object.`);
					continue;
				}
				if (typeof entry.word !== 'string' || !entry.word.trim()) {
					errors.push(`Official basic-wrong-words.json: Entry at index ${idx} has invalid word.`);
				} else if (typeof entry.suggestion !== 'string' || !entry.suggestion.trim()) {
					errors.push(`Official basic-wrong-words.json: Entry "${entry.word}" has invalid suggestion.`);
				} else if (entry.word === entry.suggestion) {
					errors.push(`Official basic-wrong-words.json: Entry "${entry.word}" has identical suggestion (self-mapping forbidden).`);
				} else if (entry.word.length > 32) {
					errors.push(`Official basic-wrong-words.json: Entry word "${entry.word}" exceeds 32 characters.`);
				} else if (entry.suggestion.length > 32) {
					errors.push(`Official basic-wrong-words.json: Entry suggestion for "${entry.word}" exceeds 32 characters.`);
				} else if (entry.description !== undefined && (typeof entry.description !== 'string' || entry.description.length > 200)) {
					errors.push(`Official basic-wrong-words.json: Entry description for "${entry.word}" is invalid or exceeds 200 characters.`);
				} else if (officialEntries.has(entry.word)) {
					errors.push(`Official basic-wrong-words.json: Duplicate entry for "${entry.word}".`);
				} else {
					officialEntries.set(entry.word, {
						suggestion: entry.suggestion,
						description: entry.description,
					});
					officialEntriesList.push({
						word: entry.word,
						suggestion: entry.suggestion,
						...(entry.description ? { description: entry.description } : {}),
					});
				}
			}
			console.info(`📖 Loaded official dictionary (${officialEntries.size} entries)`);
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		errors.push(`Failed to parse official basic-wrong-words.json: ${msg}`);
	}
} else {
	errors.push(`Official dictionary not found at ${officialDictPath}.`);
}

// 2. 获取贡献文件（严禁修改、创建或删除贡献目录下的任何输入文件）
const allFiles = fs.existsSync(contributionsDir)
	? fs.readdirSync(contributionsDir)
	: [];

// 忽略所有以下划线开头的模板文件（例如 _template.md）
const contributionFiles = allFiles
	.filter(f => !f.startsWith('_') && f.endsWith('.md'))
	.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// 校验文件名规范：必须符合 <github-user>-<topic>.md 格式
const CONTRIBUTOR_FILENAME_REGEX = /^[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]+\.md$/;
for (const file of contributionFiles) {
	if (!CONTRIBUTOR_FILENAME_REGEX.test(file)) {
		errors.push(
			`dict/contributions/${file}: Invalid contributor filename. Filenames must follow '<github-user>-<topic>.md' convention (e.g. 'octocat-chengyu.md').`
		);
	}
}

function isPlaceholderSource(src) {
	const s = src.trim().toLowerCase();
	if (!s) return true;
	if (s.startsWith('<') && s.endsWith('>')) return true;
	if (['template', 'placeholder', 'todo', 'example', 'xxx', 'your name', 'author or reference'].includes(s)) return true;
	if (
		s.includes('community contribution template') ||
		s.includes('author or reference provenance') ||
		s.includes('author or reference') ||
		s.includes('template')
	) {
		return true;
	}
	return false;
}

function parseFrontmatter(content, filePath) {
	const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
	const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
	const match = content.match(fmRegex);

	if (!match) {
		errors.push(`${relPath}: Missing required YAML frontmatter (must specify license: CC0-1.0 and source).`);
		return { frontmatter: {}, body: content, lineOffset: 0 };
	}

	const fmBlock = match[1];
	const body = content.slice(match[0].length);
	const lineOffset = match[0].split(/\r?\n/).length - 1;
	const fm = {};

	for (const line of fmBlock.split(/\r?\n/)) {
		const colonIdx = line.indexOf(':');
		if (colonIdx !== -1) {
			const key = line.slice(0, colonIdx).trim();
			const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
			if (key) fm[key] = val;
		}
	}

	if (!fm['license'] || fm['license'].trim() !== 'CC0-1.0') {
		errors.push(`${relPath}: Frontmatter 'license' must be strictly 'CC0-1.0'.`);
	}
	if (!fm['source'] || isPlaceholderSource(fm['source'])) {
		errors.push(`${relPath}: Frontmatter 'source' must specify a valid, non-placeholder provenance source.`);
	}

	return { frontmatter: fm, body, lineOffset };
}

function parseMarkdownTable(body, filePath, lineOffset = 0) {
	const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
	const lines = body.split(/\r?\n/);
	const tableEntries = [];

	let tableHeaderFound = false;
	let separatorFound = false;
	let inTable = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		const lineNum = lineOffset + i + 1;

		if (!line.startsWith('|') || !line.endsWith('|')) {
			if (inTable) inTable = false;
			continue;
		}

		const rawCells = line.slice(1, -1).split('|');
		const cells = rawCells.map(c => c.trim());

		// 检查严格表头: | 错词 | 建议替换 | 说明 |
		if (!tableHeaderFound) {
			if (cells.length === 3 && cells[0] === '错词' && cells[1] === '建议替换' && cells[2] === '说明') {
				tableHeaderFound = true;
				continue;
			}
		}

		// 检查严格分隔行: | --- | --- | --- |
		if (tableHeaderFound && !separatorFound) {
			if (cells.length === 3 && cells.every(c => /^:?-+:?$/.test(c))) {
				separatorFound = true;
				inTable = true;
				continue;
			} else {
				errors.push(`${relPath}:${lineNum}: Invalid table separator row under header. Must be 3 columns of hyphens.`);
				break;
			}
		}

		if (inTable) {
			if (cells.length !== 3) {
				errors.push(`${relPath}:${lineNum}: Table row must contain exactly 3 columns, found ${cells.length}.`);
				continue;
			}

			const word = cells[0];
			const suggestion = cells[1];
			const description = cells[2];

			if (!word && !suggestion && !description) continue;

			// 检查是否包含示例占位行
			if (word === '示例错词' || word.startsWith('示例') || suggestion === '示例正确') {
				errors.push(`${relPath}:${lineNum}: Found template sample row ("${word}"). Please replace or remove sample rows.`);
				continue;
			}

			if (!word) {
				errors.push(`${relPath}:${lineNum}: Word is empty.`);
				continue;
			}
			if (!suggestion) {
				errors.push(`${relPath}:${lineNum}: Suggestion for "${word}" is empty.`);
				continue;
			}
			if (word === suggestion) {
				errors.push(`${relPath}:${lineNum}: Word and suggestion are identical ("${word}").`);
				continue;
			}
			if (word.length > 32) {
				errors.push(`${relPath}:${lineNum}: Word "${word}" exceeds 32 characters.`);
			}
			if (suggestion.length > 32) {
				errors.push(`${relPath}:${lineNum}: Suggestion "${suggestion}" exceeds 32 characters.`);
			}
			if (description && description.length > 200) {
				errors.push(`${relPath}:${lineNum}: Description for "${word}" exceeds 200 characters.`);
			}

			tableEntries.push({
				word,
				suggestion,
				description: description || undefined,
				sourceFile: relPath,
				sourceLine: lineNum,
			});
		}
	}

	if (!tableHeaderFound) {
		errors.push(`${relPath}: Missing required 3-column table header '| 错词 | 建议替换 | 说明 |'.`);
	} else if (!separatorFound) {
		errors.push(`${relPath}: Missing valid 3-column table separator row under header.`);
	}

	return tableEntries;
}

// 3. 解析与校验所有 Markdown 贡献文件
const contributedEntries = [];
const seenWords = new Map();
const contributionFileContents = new Map();

for (const file of contributionFiles) {
	const filePath = path.join(contributionsDir, file);
	const content = fs.readFileSync(filePath, 'utf8');
	contributionFileContents.set(file, content);
	const { body, lineOffset } = parseFrontmatter(content, filePath);
	const entries = parseMarkdownTable(body, filePath, lineOffset);

	if (entries.length === 0) {
		errors.push(`dict/contributions/${file}: Contribution file must contain at least one valid typo entry row.`);
	}

	for (const entry of entries) {
		const { word, suggestion, description, sourceFile, sourceLine } = entry;

		// 检查贡献集内部重复与冲突
		const prev = seenWords.get(word);
		if (prev) {
			if (prev.suggestion === suggestion) {
				errors.push(`${sourceFile}:${sourceLine}: Duplicate entry for "${word}" (previously defined in ${prev.file}:${prev.line}).`);
			} else {
				errors.push(`${sourceFile}:${sourceLine}: Conflicting suggestion for "${word}": "${suggestion}" vs "${prev.suggestion}" in ${prev.file}:${prev.line}.`);
			}
			continue;
		}
		seenWords.set(word, { suggestion, file: sourceFile || file, line: sourceLine || 0 });

		// 检查与官方基础词库的重复与冲突
		const official = officialEntries.get(word);
		if (official) {
			if (official.suggestion === suggestion) {
				errors.push(`${sourceFile}:${sourceLine}: Entry "${word}" -> "${suggestion}" already exists in official basic-wrong-words.json.`);
			} else {
				errors.push(`${sourceFile}:${sourceLine}: Entry "${word}" conflicts with official dictionary suggestion ("${official.suggestion}" vs contributed "${suggestion}").`);
			}
			continue;
		}

		contributedEntries.push(entry);
	}
}

// 4. 错误处理
if (errors.length > 0) {
	console.error(`\n❌ Validation failed with ${errors.length} error(s):`);
	for (const err of errors) {
		console.error(`  - ${err}`);
	}
	process.exit(1);
}

// 5. 若无真实贡献，成功退出且不生成候选制品
if (contributedEntries.length === 0) {
	if (fs.existsSync(candidateOutputPath)) {
		try {
			fs.unlinkSync(candidateOutputPath);
		} catch {
			// ignore
		}
	}
	console.info(`\n✅ No new contribution entries to process across ${contributionFiles.length} file(s). (Template files ignored).`);
	process.exit(0);
}

// 6. 生成确定性合并候选 JSON 制品 (Candidate Basic Wrong Words)
// 保留官方词条既有顺序，仅对新增词条按 word 与 suggestion 的序数/码点排序，避免无关的全词库重排。
const sortedContributedEntries = contributedEntries
	.map(({ word, suggestion, description }) => ({
		word,
		suggestion,
		...(description ? { description } : {})
	}))
	.sort((a, b) => {
		if (a.word !== b.word) {
			return a.word < b.word ? -1 : 1;
		}
		if (a.suggestion !== b.suggestion) {
			return a.suggestion < b.suggestion ? -1 : 1;
		}
		return 0;
	});
const mergedEntries = [...officialEntriesList, ...sortedContributedEntries];

if (!officialJson) {
	console.error('❌ Cannot proceed without valid official dictionary.');
	process.exit(1);
}

if (isPublishMode) {
	// 发布模式 (Publication Mode): 递增 patch 版本号、更新 UTC 日期并原子写入官方词典，随后清理已处理的贡献文件
	let nextVersion;
	try {
		nextVersion = incrementPatchVersion(officialJson.dictionaryVersion);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error(`❌ Version increment failed: ${msg}`);
		process.exit(1);
	}

	const nowUtcDate = new Date().toISOString().slice(0, 10);
	const publishPayload = {
		...officialJson,
		dictionaryVersion: nextVersion,
		updatedAt: nowUtcDate,
		entries: mergedEntries
	};

	const formattedJson = JSON.stringify(publishPayload, null, 2) + '\n';
	const tempFilePath = path.join(rootDir, 'dict', `.basic-wrong-words.json.tmp.${Date.now()}`);

	// 1. 完全校验并准备/写入新的官方临时文件
	try {
		fs.writeFileSync(tempFilePath, formattedJson, 'utf8');
	} catch (e) {
		cleanupTempFile(tempFilePath);
		const msg = e instanceof Error ? e.message : String(e);
		console.error(`❌ Failed to write temporary official dictionary: ${msg}`);
		process.exit(1);
	}

	// 2. 在替换官方词典前删除已处理的顶层贡献文件
	let deleteFailed = false;
	let deleteError = null;

	for (const file of contributionFiles) {
		const filePath = path.join(contributionsDir, file);
		try {
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
			}
		} catch (e) {
			deleteFailed = true;
			deleteError = e;
			break;
		}
	}

	if (deleteFailed) {
		// 回滚：恢复所有贡献文件，清理临时文件，保持官方词典不变
		restoreContributionFiles(contributionFiles, contributionFileContents, contributionsDir);
		cleanupTempFile(tempFilePath);
		const msg = deleteError instanceof Error ? deleteError.message : String(deleteError);
		console.error(`❌ Failed to delete contribution file during publish, rolled back changes: ${msg}`);
		process.exit(1);
	}

	// 3. 替换官方词典
	try {
		fs.renameSync(tempFilePath, officialDictPath);
	} catch (e) {
		// 回滚：恢复所有贡献文件，清理临时文件，恢复原始官方词典
		restoreContributionFiles(contributionFiles, contributionFileContents, contributionsDir);
		cleanupTempFile(tempFilePath);
		if (rawOfficialContent !== null) {
			try {
				fs.writeFileSync(officialDictPath, rawOfficialContent, 'utf8');
			} catch (writeErr) {
				const writeMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
				console.error(`❌ Failed to restore original official dictionary: ${writeMsg}`);
			}
		}
		const msg = e instanceof Error ? e.message : String(e);
		console.error(`❌ Failed to replace official dictionary, rolled back changes: ${msg}`);
		process.exit(1);
	}

	// 4. 清理残留产物（候选制品和临时文件）
	cleanupTempFile(tempFilePath);
	if (fs.existsSync(candidateOutputPath)) {
		try {
			fs.unlinkSync(candidateOutputPath);
		} catch {
			// ignore
		}
	}

	console.info(`\n🚀 Successfully published ${contributedEntries.length} contribution entry/entries into basic-wrong-words.json!`);
	console.info(`📌 Dictionary version updated from ${officialJson.dictionaryVersion} to ${nextVersion}`);
	console.info(`📅 Dictionary updatedAt set to ${nowUtcDate}`);
	console.info(`🧹 Removed ${contributionFiles.length} processed contribution Markdown file(s).`);
	process.exit(0);
} else {
	// PR 校验模式 (Candidate Mode): 生成候选合并 JSON 制品供 Actions 产物上传校验
	const candidatePayload = {
		schemaVersion: officialJson.schemaVersion,
		dictionaryVersion: officialJson.dictionaryVersion,
		updatedAt: officialJson.updatedAt,
		license: officialJson.license || 'MIT',
		source: officialJson.source || 'WebNovel Assistant Project / Self-curated',
		entries: mergedEntries
	};

	fs.writeFileSync(candidateOutputPath, JSON.stringify(candidatePayload, null, 2) + '\n', 'utf8');
	console.info(`\n✅ Validated ${contributedEntries.length} new contribution entries across ${contributionFiles.length} file(s).`);
	console.info(`📦 Deterministic merged candidate dictionary written to: ${path.relative(rootDir, candidateOutputPath).replace(/\\/g, '/')}`);
	process.exit(0);
}
