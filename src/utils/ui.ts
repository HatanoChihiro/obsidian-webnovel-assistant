import { Notice } from 'obsidian';

/**
 * 复制文档内容到剪贴板（标题 + 空行 + 正文）
 */
export async function copyDocumentContent(title: string, rawContent: string): Promise<void> {
	const contentWithTitle = title ? `${title}\n\n${rawContent}` : rawContent;
	try {
		await navigator.clipboard.writeText(contentWithTitle);
		new Notice('[成功] 已复制本文档');
	} catch (err) {
		console.error('[Plugin] 复制失败:', err);
		new Notice('[错误] 复制失败，请重试');
	}
}