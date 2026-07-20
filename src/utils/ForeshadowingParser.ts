import { t } from '../i18n';
import type { ForeshadowingEntry, ParsedForeshadowingEntry } from '../types/foreshadowing';
import { ForeshadowingStatus } from '../types/foreshadowing';
import { escapeRegex } from './validation';
import { FORESHADOWING_STATUS_MAP, getForeshadowingLabel, getForeshadowingStatusText } from '../i18n/data-keys';

export class ForeshadowingParser {
	/**
	 * 将伏笔条目格式化为 Markdown 字符串
	 */
	static formatEntry(entry: ForeshadowingEntry): string {
		const timestamp = ` - ${entry.createdAt}`;
		const lines: string[] = [];

		// 标题行
		lines.push(`## ${entry.description}`);
		lines.push('');

		// 引用块（处理多行内容）
		lines.push(`> [[${entry.sourceFile}]]${timestamp}`);
		const contentLines = entry.content.split('\n');
		for (const line of contentLines) {
			lines.push(`> ${line}`);
		}
		lines.push('');

		// 标签（有标签才显示）
		if (entry.tags.length > 0) {
			lines.push(`**${getForeshadowingLabel('tags')}**：${entry.tags.map(t => `#${t}`).join(', ')}`);
			lines.push('');
		}

		// 状态
		lines.push(`**${getForeshadowingLabel('status')}**：${getForeshadowingStatusText(entry.status)}`);

		// 回收信息（已回收时显示，支持多章节）
		if (entry.status === ForeshadowingStatus.Recovered) {
			// 优先使用新格式（多章节）
			if (entry.recoveryFiles && entry.recoveryFiles.length > 0) {
				lines.push('');
				lines.push(`**${getForeshadowingLabel('recoveredAt')}**：`);
				entry.recoveryFiles.forEach((file, index) => {
					const time = entry.recoveredAts && entry.recoveredAts[index] ? ` - ${entry.recoveredAts[index]}` : '';
					lines.push(`- [[${file}]]${time}`);
				});
			}
			// 向后兼容：如果只有旧格式（单章节）
			else if (entry.recoveryFile) {
				const recoveryTimestamp = entry.recoveredAt ? ` - ${entry.recoveredAt}` : '';
				lines.push('');
				lines.push(`**${getForeshadowingLabel('recoveredAt')}**：[[${entry.recoveryFile}]]${recoveryTimestamp}`);
			}
		}

		lines.push('');
		lines.push('---');
		lines.push('');

		return lines.join('\n');
	}

	/**
	 * 在现有条目中查找相同说明的条目，返回其位置信息
	 * 用于判断是否需要合并
	 */
	static findEntryByDescription(content: string, description: string): {
		found: boolean;
		startPos: number; // 整个条目块的起始位置
		endPos: number;   // 整个条目块的结束位置
		matchedText: string; // 匹配到的旧格式条目的原始内容，供解析后合并
	} {
		// 先尝试匹配新格式的标题行: ## 说明
		const newTitlePattern = new RegExp(`^## \\s*${escapeRegex(description)}\\s*$`, 'm');
		let match = newTitlePattern.exec(content);
		
		let isNewFormat = true;
		
		// 如果没找到，退化到旧格式：寻找 **说明**：说明
		if (!match) {
			const oldDescPattern = new RegExp(`\\*\\*(?:说明|Description|${t('foreshadowing.description')})\\*\\*：${escapeRegex(description)}`, 'm');
			match = oldDescPattern.exec(content);
			isNewFormat = false;
		}
		
		if (!match) return { found: false, startPos: -1, endPos: -1, matchedText: '' };

		let startPos = -1;
		if (isNewFormat) {
			startPos = match.index; // 新格式匹配的就是标题行
		} else {
			// 旧格式匹配的是说明行，需要向上找标题行 ## [[...]]
			const beforeMatch = content.slice(0, match.index);
			const titleMatch = [...beforeMatch.matchAll(/^## \[\[.+?\]\]/gm)].pop();
			if (titleMatch && titleMatch.index !== undefined) {
				startPos = titleMatch.index;
			}
		}
		
		if (startPos === -1) return { found: false, startPos: -1, endPos: -1, matchedText: '' };
		
		// 向下找下一个条目(## )或文件末尾，或者当前条目的 ---
		const afterStart = content.slice(startPos);
		const endMatch = afterStart.match(/\n---\n/);
		let endPos = -1;
		if (endMatch && endMatch.index !== undefined) {
			endPos = startPos + endMatch.index + endMatch[0].length;
		} else {
			const nextTitleMatch = afterStart.slice(3).match(/^## /m);
			if (nextTitleMatch && nextTitleMatch.index !== undefined) {
				endPos = startPos + 3 + nextTitleMatch.index;
			} else {
				endPos = content.length;
			}
		}
		
		const matchedText = content.slice(startPos, endPos);

		return { found: true, startPos, endPos, matchedText };
	}

	/**
	 * 解析伏笔文件内容为结构化数据
	 * 统一的解析逻辑，供 View 层调用
	 */
	static parseEntries(content: string): ParsedForeshadowingEntry[] {
		const entries: ParsedForeshadowingEntry[] = [];

		// 按 --- 分割条目
		const blocks = content.split(/\n---\n/);

		for (const block of blocks) {
			const trimmed = block.trim();
			if (!trimmed || !trimmed.startsWith('## ')) continue;

			// 解析标题行
			const titleMatch = trimmed.match(/^## (.*?)$/m);
			if (!titleMatch) continue;
			
			const titleText = titleMatch[1].trim();
			let sourceFile = '';
			let createdAt = '';
			let parsedTitleDescription = '';
			
			if (titleText.startsWith('[[')) {
				// 旧格式
				const oldMatch = titleText.match(/^\[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
				if (oldMatch) {
					sourceFile = oldMatch[1];
					createdAt = oldMatch[2]?.trim() || '';
				}
			} else {
				// 新格式
				parsedTitleDescription = titleText;
			}

			// 解析所有引用块（支持多条）
			const contents: { source: string; time: string; text: string }[] = [];
			const lines = trimmed.split('\n');
			let i = 0;

			// 跳过标题行
			while (i < lines.length && lines[i].startsWith('## ')) i++;

			// 收集引用块
			while (i < lines.length) {
				const line = lines[i];
				if (line.startsWith('> ')) {
					// 检查上一行是否是来源标注（> [[文件]] - 时间）
					let source = '';
					let time = '';
					const quoteLines: string[] = [];

					// 第一行可能是来源标注
					const sourceLine = line.replace(/^> /, '');
					const sourceMatch = sourceLine.match(/^\[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
					if (sourceMatch) {
						source = sourceMatch[1];
						time = sourceMatch[2]?.trim() || '';
						i++;
						// 收集后续引用行
						while (i < lines.length && lines[i].startsWith('> ')) {
							quoteLines.push(lines[i].replace(/^> /, ''));
							i++;
						}
					} else {
						// 普通引用行（第一条，来源来自标题行）
						while (i < lines.length && lines[i].startsWith('> ')) {
							quoteLines.push(lines[i].replace(/^> /, ''));
							i++;
						}
					}

					if (quoteLines.length > 0) {
						if (!sourceFile && source) sourceFile = source;
						if (!createdAt && time) createdAt = time;
						contents.push({
							source: source || sourceFile,
							time: time || createdAt,
							text: quoteLines.join('\n')
						});
					}
				} else {
					i++;
				}
			}

			// 如果没有解析到引用，用第一个 > 行
			if (contents.length === 0) {
				const firstQuote = lines.find(l => l.startsWith('> '));
				if (firstQuote) {
					contents.push({ source: sourceFile, time: createdAt, text: firstQuote.replace(/^> /, '') });
				}
			}

			// 解析说明
			const descMatch = trimmed.match(new RegExp(`\\*\\*(?:说明|Description|${t('foreshadowing.description')})\\*\\*：(.+)`));
			let description = descMatch ? descMatch[1].trim() : '';
			if (!description) description = parsedTitleDescription;

			// 解析标签
			const tagsMatch = trimmed.match(new RegExp(`\\*\\*(?:标签|Tags|${t('foreshadowing.tags')})\\*\\*：(.+)`));
			const tags = tagsMatch
				? tagsMatch[1].trim().split(/[,，\s]+/).map(t => t.replace(/^#/, ''))
				: [];

			// 解析状态
			const statusMatch = trimmed.match(new RegExp(`\\*\\*(?:状态|Status|${t('foreshadowing.status')})\\*\\*：(.+)`));
			const rawStatusText = statusMatch ? statusMatch[1].trim() : '';
			let status = ForeshadowingStatus.Pending;
			if (rawStatusText) {
				const mapped = FORESHADOWING_STATUS_MAP[rawStatusText];
				if (mapped === 'recovered') status = ForeshadowingStatus.Recovered;
				else if (mapped === 'deprecated') status = ForeshadowingStatus.Deprecated;
			}

			// 解析回收信息（支持多章节）
			// 新格式：**回收于**：\n- [[章节1]] - 时间\n- [[章节2]] - 时间
			const recoveryListMatch = trimmed.match(new RegExp(`\\*\\*(?:回收于|Recovered at|Resolved in|${t('foreshadowing.recovered-at')})\\*\\*：\\n((?:- \\[\\[.+?\\]\\].*\\n?)+)`));
			let recoveryFiles: string[] | undefined;
			let recoveredAts: string[] | undefined;
			let recoveryFile: string | undefined;
			let recoveredAt: string | undefined;

			if (recoveryListMatch) {
				// 多章节格式
				const listLines = recoveryListMatch[1].trim().split('\n');
				recoveryFiles = [];
				recoveredAts = [];
				listLines.forEach(line => {
					const match = line.match(/^- \[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
					if (match) {
						recoveryFiles!.push(match[1]);
						recoveredAts!.push(match[2]?.trim() || '');
					}
				});
			} else {
				// 旧格式（单章节）：**回收于**：[[章节]] - 时间
				const singleRecoveryMatch = trimmed.match(new RegExp(`\\*\\*(?:回收于|Recovered at|Resolved in|${t('foreshadowing.recovered-at')})\\*\\*：\\[\\[(.+?)\\]\\](?:\\s*-\\s*(.+))?`));
				if (singleRecoveryMatch) {
					recoveryFile = singleRecoveryMatch[1];
					recoveredAt = singleRecoveryMatch[2]?.trim();
				}
			}

			if (description) {
				entries.push({ sourceFile, createdAt, contents, description, tags, status, recoveryFiles, recoveredAts, recoveryFile, recoveredAt });
			}
		}

		return entries;
	}
}
