import { Logger } from '../utils/Logger';
import { Notice } from 'obsidian';
import { t } from '../i18n';
import { REGEX_PATTERNS } from '../constants';

/**
 * 复制文档内容到剪贴板（去除属性区、Markdown格式、HTML标签）
 */
export async function copyDocumentContent(title: string, rawContent: string): Promise<void> {
	let cleanContent = rawContent.replace(REGEX_PATTERNS.FRONTMATTER, '').trimStart();
	
	// 去除 HTML 标签
	cleanContent = cleanContent.replace(/<[^>]*>?/gm, '');
	// 去除 Markdown 代码块
	cleanContent = cleanContent.replace(/```[\s\S]*?```/gm, '');
	// 去除 Markdown 行内代码
	cleanContent = cleanContent.replace(/`([^`]+)`/g, '$1');
	// 去除 Markdown 标题
	cleanContent = cleanContent.replace(/^#{1,6}\s+/gm, '');
	// 去除加粗/斜体
	cleanContent = cleanContent.replace(/(\*\*|__)(.*?)\1/g, '$2');
	cleanContent = cleanContent.replace(/(\*|_)(.*?)\1/g, '$2');
	// 去除删除线
	cleanContent = cleanContent.replace(/~~(.*?)~~/g, '$1');
	// 去除图片
	cleanContent = cleanContent.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
	// 去除链接
	cleanContent = cleanContent.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
	// 去除内部链接 [[链接|显示文本]] 或 [[链接]]
	cleanContent = cleanContent.replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1');
	// 去除引用块
	cleanContent = cleanContent.replace(/^\s*>\s*/gm, '');

	const contentWithTitle = title ? `${title}\n\n${cleanContent.trim()}` : cleanContent.trim();
	try {
		await navigator.clipboard.writeText(contentWithTitle);
		new Notice(t('notice.copy-success'));
	} catch (err) {
		Logger.error('[Plugin] 复制失败:', err);
		new Notice(t('notice.copy-failed'));
	}
}