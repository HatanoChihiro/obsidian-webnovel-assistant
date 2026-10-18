/**
 * 解析按行分隔的目录设置文本。
 * 支持 CRLF / LF、跳过空行、去除每行首尾空格、去重并保持原有顺序（首个工作区语义）。
 * 保护目录名中包含的半角/全角逗号及其他标点符号不被拆分。
 */
export function parseDirectorySettingLines(text: string): string[] {
	if (!text) return [];
	const lines = text.split(/\r?\n/);
	const result: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed && !result.includes(trimmed)) {
			result.push(trimmed);
		}
	}
	return result;
}

/**
 * 格式化目录数组为按行显示的文本。
 */
export function formatDirectorySettingLines(folders: string[]): string {
	return (folders || []).join('\n');
}
