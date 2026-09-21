import { Logger } from '../utils/Logger';
import { Notice } from 'obsidian';
import { t } from '../i18n';
import { cleanForPlainCopy, type MarkdownCleanerOptions } from './markdownCleaner';

/**
 * 复制并清理 Markdown 语法，只保留纯文本内容
 */
export async function copyDocumentContent(title: string, rawContent: string, options: MarkdownCleanerOptions = {}): Promise<void> {
	const cleanContent = cleanForPlainCopy(rawContent, options);

	const contentWithTitle = title ? `${title}\n\n${cleanContent.trim()}` : cleanContent.trim();
	try {
		await navigator.clipboard.writeText(contentWithTitle);
		new Notice(t('notice.copy-success'));
	} catch (err) {
		Logger.error('[Plugin] 复制失败:', err);
		new Notice(t('notice.copy-failed'));
	}
}
