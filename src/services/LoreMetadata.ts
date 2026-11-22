import { scanFenceLine, type FenceScanState } from './LoreTemplateService';

const metadataLine = /^ {0,3}(?:\*\*|__)?(别名|別名|Alias(?:es)?|类型|類型|型別|Type)(?:\*\*|__)?[ \t]*[:：][ \t]*(.*)$/i;
const aliasSeparator = /[,，、/|;；]/;
const typeKeys = ['type', '类型', '類型', '型別'];

export function visibleLoreLines(lines: readonly string[]): string[] {
	const fence: FenceScanState = { inFence: false, fenceChar: '', fenceLength: 0 };
	let comment: '%%' | '-->' | undefined;
	return lines.map(line => {
		if (comment) {
			if (line.includes(comment)) comment = undefined;
			return '';
		}
		const state = scanFenceLine(line, fence);
		if (state.inFenceBefore || state.inFenceAfter) return '';
		const trimmed = line.trimStart();
		if (trimmed.startsWith('<!--')) {
			if (!trimmed.includes('-->')) comment = '-->';
			return '';
		}
		if (trimmed.startsWith('%%')) {
			if (trimmed.indexOf('%%', 2) < 0) comment = '%%';
			return '';
		}
		return line;
	});
}

export function readLoreMetadataLine(line: string): { key: 'type' | 'aliases'; value: string } | undefined {
	const match = metadataLine.exec(line.trimEnd());
	if (!match) return undefined;
	return { key: typeKeys.includes(match[1].toLowerCase()) ? 'type' : 'aliases', value: match[2].trim() };
}

function asText(value: unknown): string {
	return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

export function getLoreFrontmatterType(frontmatter?: Record<string, unknown>): string {
	for (const key of typeKeys) {
		const value = asText(frontmatter?.[key]);
		if (value) return value;
	}
	return '';
}

export function readLoreMetadata(lines: readonly string[], frontmatter?: Record<string, unknown>) {
	let type = getLoreFrontmatterType(frontmatter);
	const frontmatterAliases = frontmatter?.aliases ?? frontmatter?.alias ?? frontmatter?.别名 ?? frontmatter?.別名;
	const aliases = Array.isArray(frontmatterAliases) ? frontmatterAliases.map(asText) : asText(frontmatterAliases).split(aliasSeparator);
	for (const line of visibleLoreLines(lines)) {
		const field = readLoreMetadataLine(line);
		if (field?.key === 'type' && !type) type = field.value;
		if (field?.key === 'aliases') aliases.push(...field.value.split(aliasSeparator));
	}
	return { type, aliases: [...new Set(aliases.map(alias => alias.trim()).filter(Boolean))] };
}

export function isProtagonistType(type?: string): boolean {
	return Boolean(type && (type.includes('主角') || type.toLowerCase().includes('protagonist')));
}

/** Updates a top-level scalar type while preserving the rest of the YAML document. */
export function rewriteLoreFrontmatterType(lines: readonly string[], type: string): string[] {
	const result: string[] = [];
	let replaced = false;
	let readingValue = false;
	const key = /^(type|类型|類型|型別|["'](?:type|类型|類型|型別)["'])[ \t]*:/;
	for (const line of lines) {
		const match = key.exec(line);
		if (match) {
			if (!replaced && type) result.push(`${match[1]}: ${JSON.stringify(type)}${line.endsWith('\r') ? '\r' : ''}`);
			replaced = true;
			readingValue = true;
			continue;
		}
		if (readingValue && /^[ \t]+[^\s#]/.test(line)) continue;
		if (/^[^\s#]/.test(line)) readingValue = false;
		result.push(line);
	}
	return result;
}
