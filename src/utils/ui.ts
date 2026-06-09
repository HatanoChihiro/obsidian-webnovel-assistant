import { Notice } from 'obsidian';
import { REGEX_PATTERNS } from '../constants';

/**
 * 复制文档内容到剪贴板（去除属性区 + 标题 + 空行 + 正文）
 */
export async function copyDocumentContent(title: string, rawContent: string): Promise<void> {
	const cleanContent = rawContent.replace(REGEX_PATTERNS.FRONTMATTER, '').trimStart();
	const contentWithTitle = title ? `${title}\n\n${cleanContent}` : cleanContent;
	try {
		await navigator.clipboard.writeText(contentWithTitle);
		new Notice('[成功] 已复制本文档');
	} catch (err) {
		console.error('[Plugin] 复制失败:', err);
		new Notice('[错误] 复制失败，请重试');
	}
}