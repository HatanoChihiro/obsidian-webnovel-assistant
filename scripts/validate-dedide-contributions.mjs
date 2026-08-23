import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const contributionsDir = path.join(rootDir, 'dict', 'contributions', 'dedide');
const officialDictPath = path.join(rootDir, 'dict', 'dedide-lexicon.json');
const candidateOutputPath = path.join(rootDir, 'dict', 'candidate-dedide-lexicon.json');
const isPublishMode = process.argv.slice(2).includes('--publish');

const STRICT_SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CONTRIBUTOR_FILENAME_REGEX = /^[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]+\.md$/;
const MAX_TERM_LENGTH = 32;
const MAX_EXAMPLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 200;
const CATEGORY_KEYS = [
	'adverbialModifiers',
	'actionVerbs',
	'actionNominalFollowers',
	'degreePredicates',
	'degreeComplementPrefixes',
	'degreeComplementAdjectives',
	'degreeComplementPhrases',
	'comparativeAdjectives',
	'comparativeWords',
	'nounLookaheadExclusions',
	'attributiveAdjectives',
	'attributiveNouns',
];
const ALLOWED_OFFICIAL_KEYS = new Set([
	'schemaVersion',
	'dictionaryVersion',
	'updatedAt',
	'license',
	'source',
	...CATEGORY_KEYS,
]);

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function incrementPatchVersion(version) {
	const match = typeof version === 'string' ? version.trim().match(STRICT_SEMVER_REGEX) : null;
	if (!match) throw new Error(`dictionaryVersion "${String(version)}" is not a strict x.y.z semver.`);
	return `${match[1]}.${match[2]}.${(BigInt(match[3]) + 1n).toString()}`;
}

function cleanupFile(filePath) {
	if (!fs.existsSync(filePath)) return;
	try {
		fs.unlinkSync(filePath);
	} catch {
		// Best-effort cleanup only.
	}
}

function restoreContributionFiles(files, contents) {
	for (const file of files) {
		const content = contents.get(file);
		if (content === undefined) continue;
		try {
			fs.writeFileSync(path.join(contributionsDir, file), content, 'utf8');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`❌ Failed to restore contribution file "${file}": ${message}`);
		}
	}
}

function isPlaceholderSource(source) {
	const normalized = source.trim().toLowerCase();
	if (!normalized || (normalized.startsWith('<') && normalized.endsWith('>'))) return true;
	return ['template', 'placeholder', 'todo', 'example', 'xxx'].includes(normalized) || normalized.includes('provenance>');
}

function parseFrontmatter(content, filePath, errors) {
	const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) {
		errors.push(`${relPath}: Missing required YAML frontmatter.`);
		return { body: content, lineOffset: 0 };
	}

	const frontmatter = {};
	for (const line of match[1].split(/\r?\n/)) {
		const colonIndex = line.indexOf(':');
		if (colonIndex < 0) continue;
		const key = line.slice(0, colonIndex).trim();
		const value = line.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, '');
		if (key) frontmatter[key] = value;
	}

	if (frontmatter.license !== 'CC0-1.0') {
		errors.push(`${relPath}: Frontmatter 'license' must be strictly 'CC0-1.0'.`);
	}
	if (!frontmatter.source || isPlaceholderSource(frontmatter.source)) {
		errors.push(`${relPath}: Frontmatter 'source' must specify valid, non-placeholder provenance.`);
	}

	return {
		body: content.slice(match[0].length),
		lineOffset: match[0].split(/\r?\n/).length - 1,
	};
}

function parseContributionTable(body, filePath, lineOffset, errors) {
	const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
	const lines = body.split(/\r?\n/);
	const expectedHeader = ['词项', '分类', '错误例句', '正确例句', '正确反例（可选）', '说明'];
	const entries = [];
	let headerFound = false;
	let separatorFound = false;
	let inTable = false;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index].trim();
		const lineNumber = lineOffset + index + 1;
		if (!line.startsWith('|') || !line.endsWith('|')) {
			if (inTable) inTable = false;
			continue;
		}

		const cells = line.slice(1, -1).split('|').map(cell => cell.trim());
		if (!headerFound && cells.length === expectedHeader.length && cells.every((cell, i) => cell === expectedHeader[i])) {
			headerFound = true;
			continue;
		}

		if (headerFound && !separatorFound) {
			if (cells.length === expectedHeader.length && cells.every(cell => /^:?-+:?$/.test(cell))) {
				separatorFound = true;
				inTable = true;
				continue;
			}
			errors.push(`${relPath}:${lineNumber}: Invalid table separator; expected 6 Markdown columns.`);
			break;
		}

		if (!inTable) continue;
		if (cells.length !== expectedHeader.length) {
			errors.push(`${relPath}:${lineNumber}: Table row must contain exactly 6 columns.`);
			continue;
		}

		const [term, category, wrongExample, correctExample, negativeExample, description] = cells;
		if (!term && !category && !wrongExample && !correctExample && !negativeExample && !description) continue;
		if (term.startsWith('示例') || description.includes('替换本行')) {
			errors.push(`${relPath}:${lineNumber}: Replace or remove the template sample row.`);
			continue;
		}
		if (!term || term.length > MAX_TERM_LENGTH || term !== term.trim()) {
			errors.push(`${relPath}:${lineNumber}: Term must be 1-${MAX_TERM_LENGTH} trimmed characters.`);
			continue;
		}
		if (!CATEGORY_KEYS.includes(category)) {
			errors.push(`${relPath}:${lineNumber}: Unknown category "${category}".`);
			continue;
		}
		if (!wrongExample || !correctExample || wrongExample === correctExample) {
			errors.push(`${relPath}:${lineNumber}: Wrong and correct examples are required and must differ.`);
			continue;
		}
		if (!wrongExample.includes(term) || !correctExample.includes(term)) {
			errors.push(`${relPath}:${lineNumber}: Both examples must contain the contributed term "${term}".`);
			continue;
		}
		if (!/[的地得]/.test(wrongExample) || !/[的地得]/.test(correctExample)) {
			errors.push(`${relPath}:${lineNumber}: Both examples must demonstrate 的/地/得 usage.`);
			continue;
		}
		if (wrongExample.length > MAX_EXAMPLE_LENGTH || correctExample.length > MAX_EXAMPLE_LENGTH || negativeExample.length > MAX_EXAMPLE_LENGTH) {
			errors.push(`${relPath}:${lineNumber}: Examples must not exceed ${MAX_EXAMPLE_LENGTH} characters.`);
			continue;
		}
		if (description.length > MAX_DESCRIPTION_LENGTH) {
			errors.push(`${relPath}:${lineNumber}: Description must not exceed ${MAX_DESCRIPTION_LENGTH} characters.`);
			continue;
		}

		entries.push({ term, category, sourceFile: relPath, sourceLine: lineNumber });
	}

	if (!headerFound) errors.push(`${relPath}: Missing the required 6-column De/Di/De contribution table header.`);
	else if (!separatorFound) errors.push(`${relPath}: Missing a valid Markdown table separator.`);
	return entries;
}

console.info(isPublishMode
	? '🚀 Running De/Di/De contributions publication...'
	: '🔍 Running De/Di/De contributions validation...');

const errors = [];
let rawOfficialContent = null;
let officialJson = null;
const officialSets = new Map();

try {
	rawOfficialContent = fs.readFileSync(officialDictPath, 'utf8');
	const parsed = JSON.parse(rawOfficialContent);
	if (!isRecord(parsed)) throw new Error('Root must be an object.');
	if (parsed.schemaVersion !== 1) errors.push('Official dedide-lexicon.json: schemaVersion must be 1.');
	if (typeof parsed.dictionaryVersion !== 'string' || !STRICT_SEMVER_REGEX.test(parsed.dictionaryVersion)) {
		errors.push('Official dedide-lexicon.json: dictionaryVersion must be strict x.y.z semver.');
	}
	for (const key of ['updatedAt', 'license', 'source']) {
		if (typeof parsed[key] !== 'string' || !parsed[key].trim()) errors.push(`Official dedide-lexicon.json: ${key} must be a non-empty string.`);
	}
	for (const key of Object.keys(parsed)) {
		if (!ALLOWED_OFFICIAL_KEYS.has(key)) errors.push(`Official dedide-lexicon.json: Unexpected field "${key}".`);
	}
	for (const category of CATEGORY_KEYS) {
		if (!Array.isArray(parsed[category])) {
			errors.push(`Official dedide-lexicon.json: Missing array "${category}".`);
			continue;
		}
		const seen = new Set();
		for (const term of parsed[category]) {
			if (typeof term !== 'string' || !term.trim() || term !== term.trim() || term.length > MAX_TERM_LENGTH) {
				errors.push(`Official dedide-lexicon.json: Invalid term in "${category}".`);
				continue;
			}
			if (seen.has(term)) errors.push(`Official dedide-lexicon.json: Duplicate "${term}" in "${category}".`);
			seen.add(term);
		}
		officialSets.set(category, seen);
	}
	officialJson = parsed;
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	errors.push(`Failed to parse official dedide-lexicon.json: ${message}`);
}

const allFiles = fs.existsSync(contributionsDir) ? fs.readdirSync(contributionsDir) : [];
const contributionFiles = allFiles.filter(file => !file.startsWith('_') && file.endsWith('.md')).sort();
const contributionContents = new Map();
const contributedEntries = [];
const contributedKeys = new Map();

for (const file of contributionFiles) {
	const filePath = path.join(contributionsDir, file);
	if (!CONTRIBUTOR_FILENAME_REGEX.test(file)) {
		errors.push(`dict/contributions/dedide/${file}: Filename must follow '<github-user>-<topic>.md'.`);
	}
	const content = fs.readFileSync(filePath, 'utf8');
	contributionContents.set(file, content);
	const { body, lineOffset } = parseFrontmatter(content, filePath, errors);
	const entries = parseContributionTable(body, filePath, lineOffset, errors);
	if (entries.length === 0) errors.push(`dict/contributions/dedide/${file}: At least one valid contribution row is required.`);

	for (const entry of entries) {
		const key = `${entry.category}\u0000${entry.term}`;
		const previous = contributedKeys.get(key);
		if (previous) {
			errors.push(`${entry.sourceFile}:${entry.sourceLine}: Duplicate "${entry.term}" in category "${entry.category}" (first in ${previous.file}:${previous.line}).`);
			continue;
		}
		contributedKeys.set(key, { file: entry.sourceFile, line: entry.sourceLine });
		if (officialSets.get(entry.category)?.has(entry.term)) {
			errors.push(`${entry.sourceFile}:${entry.sourceLine}: "${entry.term}" already exists in official category "${entry.category}".`);
			continue;
		}
		contributedEntries.push(entry);
	}
}

if (errors.length > 0) {
	console.error(`\n❌ Validation failed with ${errors.length} error(s):`);
	for (const error of errors) console.error(`  - ${error}`);
	process.exit(1);
}

if (contributedEntries.length === 0) {
	cleanupFile(candidateOutputPath);
	console.info(`\n✅ No new De/Di/De entries to process across ${contributionFiles.length} file(s).`);
	process.exit(0);
}

const additionsByCategory = new Map(CATEGORY_KEYS.map(category => [category, []]));
for (const entry of contributedEntries) additionsByCategory.get(entry.category).push(entry.term);
for (const additions of additionsByCategory.values()) additions.sort();

const mergedJson = { ...officialJson };
for (const category of CATEGORY_KEYS) {
	mergedJson[category] = [...officialJson[category], ...additionsByCategory.get(category)];
}

if (!isPublishMode) {
	fs.writeFileSync(candidateOutputPath, `${JSON.stringify(mergedJson, null, 2)}\n`, 'utf8');
	console.info(`\n✅ Validated ${contributedEntries.length} new De/Di/De entry/entries across ${contributionFiles.length} file(s).`);
	console.info('📦 Candidate lexicon written to dict/candidate-dedide-lexicon.json.');
	process.exit(0);
}

const previousVersion = officialJson.dictionaryVersion;
mergedJson.dictionaryVersion = incrementPatchVersion(previousVersion);
mergedJson.updatedAt = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
const tempFilePath = path.join(rootDir, 'dict', `.dedide-lexicon.json.tmp.${Date.now()}`);

try {
	fs.writeFileSync(tempFilePath, `${JSON.stringify(mergedJson, null, 2)}\n`, 'utf8');
	for (const file of contributionFiles) fs.unlinkSync(path.join(contributionsDir, file));
	fs.renameSync(tempFilePath, officialDictPath);
} catch (error) {
	restoreContributionFiles(contributionFiles, contributionContents);
	cleanupFile(tempFilePath);
	if (rawOfficialContent !== null) {
		try {
			fs.writeFileSync(officialDictPath, rawOfficialContent, 'utf8');
		} catch (restoreError) {
			const message = restoreError instanceof Error ? restoreError.message : String(restoreError);
			console.error(`❌ Failed to restore official lexicon: ${message}`);
		}
	}
	const message = error instanceof Error ? error.message : String(error);
	console.error(`❌ Publication failed and was rolled back: ${message}`);
	process.exit(1);
}

cleanupFile(candidateOutputPath);
console.info(`\n🚀 Published ${contributedEntries.length} De/Di/De entry/entries.`);
console.info(`📌 Lexicon version updated from ${previousVersion} to ${mergedJson.dictionaryVersion}.`);
console.info(`🧹 Removed ${contributionFiles.length} processed contribution file(s).`);
