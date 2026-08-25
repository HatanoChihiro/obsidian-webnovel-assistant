import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	isSelectionEligibleForAnnotate,
	validateSynonymGroupInput,
	expandAndMergeRanges,
	isReplacementStale
} from '../../src/utils/proofreadingHelpers';
import type { SynonymGroup } from '../../src/types/proofreading';
import { ProofreadingManager } from '../../src/services/ProofreadingManager';
import { forceProofreadingUpdate } from '../../src/editor/ProofreadingExtension';
import { ACMatcher } from '../../src/services/proofreading/AhoCorasick';
import { DeDiDeScanner } from '../../src/services/proofreading/DeDiDeRule';
import type { DeDiDeLexicon } from '../../src/types/proofreading';
import { getProofreadingDiagnosticDisplayMessage } from '../../src/ui/ProofreadingPopover';
import type { WebNovelAssistantPlugin } from '../../src/types/plugin';
import { TFile, TFolder, type App, type Vault } from 'obsidian';
import { setLocale } from '../../src/i18n';

function createMockTFile(path: string): TFile {
	const name = path.split('/').pop() || '';
	return Object.assign(new TFile(), {
		name,
		path,
		basename: name.replace(/\.[^/.]+$/, ''),
		extension: name.includes('.') ? name.split('.').pop() || 'md' : 'md'
	});
}

function createMockTFolder(path: string): TFolder {
	const name = path.split('/').pop() || '';
	return Object.assign(new TFolder(), {
		name,
		path,
		children: []
	});
}

describe('Proofreading Helpers & UI Pure Functions', () => {
	it('should localize empty user-dictionary descriptions when the popover is shown in English', async () => {
		const matcher = new ACMatcher();
		matcher.insert('teh', 'user_wrong', 'wrong-en', {
			word: 'teh',
			suggestion: 'the',
			description: ''
		});
		matcher.insert('test', 'user_sensitive', 'sen-en', {
			word: 'test',
			suggestions: [],
			severity: 'info',
			exceptions: [],
			description: ''
		});
		matcher.insert('quick', 'user_synonym', 'syn-en', {
			group: { words: ['quick', 'fast'], description: '' },
			suggestions: ['fast']
		});
		matcher.build();

		const matches = matcher.match('A teh test is quick.', []);
		expect(matches).toHaveLength(3);
		expect(matches.every(match => match.message === '')).toBe(true);

		await setLocale('en');
		try {
			expect(matches.map(getProofreadingDiagnosticDisplayMessage)).toEqual([
				'Suggested replacement: "the"',
				'Contains sensitive word "test"',
				'Synonym recommendations'
			]);
		} finally {
			await setLocale('zh-CN');
		}
	});

	it('should display localized DeDiDe diagnostic messages in popover for all three categories in zh and en', async () => {
		const testLexicon: DeDiDeLexicon = {
			schemaVersion: 1,
			dictionaryVersion: 'test',
			updatedAt: '2026-08-23',
			license: 'MIT',
			adverbialModifiers: ['飞快'],
			actionVerbs: ['跑'],
			degreePredicates: ['笑'],
			degreeComplementPrefixes: [],
			degreeComplementAdjectives: [],
			degreeComplementPhrases: ['不行'],
			comparativeAdjectives: [],
			comparativeWords: [],
			nounLookaheadExclusions: [],
			attributiveAdjectives: ['美丽'],
			attributiveNouns: ['姑娘']
		};

		const scanner = new DeDiDeScanner(testLexicon);
		const text = '飞快的跑，笑的不行，美丽地姑娘';

		// 1. zh-CN
		await setLocale('zh-CN');
		const diagsZh = scanner.scan(text, []);
		expect(diagsZh).toHaveLength(3);
		expect(diagsZh.map(getProofreadingDiagnosticDisplayMessage)).toEqual([
			'可能误用：“飞快的跑”中修饰动作，建议使用“地”',
			'可能误用：“笑的不行”后接程度补语，建议使用“得”',
			'可能误用：“美丽地姑娘”修饰名词，建议使用“的”'
		]);

		// 2. en
		await setLocale('en');
		try {
			const diagsEn = scanner.scan(text, []);
			expect(diagsEn).toHaveLength(3);
			expect(diagsEn.map(getProofreadingDiagnosticDisplayMessage)).toEqual([
				'Possible misuse: modifying an action in "飞快的跑", suggest using "地"',
				'Possible misuse: followed by a degree complement in "笑的不行", suggest using "得"',
				'Possible misuse: modifying a noun in "美丽地姑娘", suggest using "的"'
			]);
		} finally {
			await setLocale('zh-CN');
		}
	});

	describe('isSelectionEligibleForAnnotate', () => {
		const mockEligibleFile = createMockTFile('NovelBook/Chapter1.md');
		const isInsideDict = (fileOrPath: TFile | string) => {
			const p = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
			return p.startsWith('NovelBook/校对词典');
		};

		it('should return true for valid single-line selection in any Markdown file', () => {
			const res = isSelectionEligibleForAnnotate(
				'迫不急待',
				mockEligibleFile,
				isInsideDict
			);
			expect(res).toBe(true);
			expect(isSelectionEligibleForAnnotate('灵感', createMockTFile('Other/Note.md'), isInsideDict)).toBe(true);
		});

		it('should return false for multiline selection', () => {
			const res = isSelectionEligibleForAnnotate(
				'第一行\n第二行',
				mockEligibleFile,
				isInsideDict
			);
			expect(res).toBe(false);
		});

		it('should return false for empty or whitespace-only selection', () => {
			expect(isSelectionEligibleForAnnotate('', mockEligibleFile, isInsideDict)).toBe(false);
			expect(isSelectionEligibleForAnnotate('   ', mockEligibleFile, isInsideDict)).toBe(false);
			expect(isSelectionEligibleForAnnotate(null, mockEligibleFile, isInsideDict)).toBe(false);
		});

		it('should return false for selection length >= 50', () => {
			const longStr = '一'.repeat(50);
			const res = isSelectionEligibleForAnnotate(longStr, mockEligibleFile, isInsideDict);
			expect(res).toBe(false);
		});

		it('should return false for a file inside the dictionary directory', () => {
			const dictFile = createMockTFile('NovelBook/校对词典/错词.md');
			expect(isSelectionEligibleForAnnotate('错词', dictFile, isInsideDict)).toBe(false);
		});
	});

	describe('validateSynonymGroupInput', () => {
		it('should accept valid synonym group with >= 2 unique words separated by dunhao or commas', () => {
			const existing = new Map<string, { group: SynonymGroup }>();
			const res = validateSynonymGroupInput('高兴、快乐, 开心，愉悦', '高兴', existing);
			expect(res.valid).toBe(true);
			expect(res.words).toEqual(['高兴', '快乐', '开心', '愉悦']);
			expect(res.errorCode).toBeUndefined();
		});

		it('should reject empty input with EMPTY_INPUT errorCode', () => {
			const existing = new Map<string, { group: SynonymGroup }>();
			const res = validateSynonymGroupInput('', '高兴', existing);
			expect(res.valid).toBe(false);
			expect(res.errorCode).toBe('EMPTY_INPUT');
		});

		it('should reject input with less than 2 unique words with LESS_THAN_TWO errorCode', () => {
			const existing = new Map<string, { group: SynonymGroup }>();
			const res1 = validateSynonymGroupInput('高兴', '高兴', existing);
			expect(res1.valid).toBe(false);
			expect(res1.errorCode).toBe('LESS_THAN_TWO');

			const res2 = validateSynonymGroupInput('高兴、高兴', '高兴', existing);
			expect(res2.valid).toBe(false);
			expect(res2.errorCode).toBe('LESS_THAN_TWO');
		});

		it('should reject input when any word belongs to another existing group with CROSS_GROUP_COLLISION and conflictWord', () => {
			const groupA: SynonymGroup = { words: ['高兴', '快乐'], description: '组A' };
			const groupB: SynonymGroup = { words: ['悲伤', '难过'], description: '组B' };

			const existing = new Map<string, { group: SynonymGroup }>();
			existing.set('高兴', { group: groupA });
			existing.set('快乐', { group: groupA });
			existing.set('悲伤', { group: groupB });
			existing.set('难过', { group: groupB });

			// 尝试为“高兴”所在组添加“难过”，由于“难过”属于 groupB，应拒绝
			const res = validateSynonymGroupInput('高兴、快乐、难过', '高兴', existing);
			expect(res.valid).toBe(false);
			expect(res.errorCode).toBe('CROSS_GROUP_COLLISION');
			expect(res.conflictWord).toBe('难过');
		});

		it('should allow editing within the same existing group', () => {
			const groupA: SynonymGroup = { words: ['高兴', '快乐'], description: '组A' };
			const existing = new Map<string, { group: SynonymGroup }>();
			existing.set('高兴', { group: groupA });
			existing.set('快乐', { group: groupA });

			const res = validateSynonymGroupInput('高兴、快乐、愉悦', '高兴', existing);
			expect(res.valid).toBe(true);
			expect(res.words).toEqual(['高兴', '快乐', '愉悦']);
			expect(res.errorCode).toBeUndefined();
		});
	});

	describe('expandAndMergeRanges', () => {
		it('should expand ranges by maxLen and clamp to document boundaries', () => {
			const ranges = [{ from: 10, to: 20 }];
			const docLen = 100;
			const maxLen = 5;
			const expanded = expandAndMergeRanges(ranges, maxLen, docLen);
			expect(expanded).toEqual([{ from: 5, to: 25 }]);
		});

		it('should merge overlapping or contiguous expanded ranges', () => {
			const ranges = [
				{ from: 10, to: 20 },
				{ from: 25, to: 35 }
			];
			const docLen = 100;
			const maxLen = 10;
			const merged = expandAndMergeRanges(ranges, maxLen, docLen);
			expect(merged).toEqual([{ from: 0, to: 45 }]);
		});

		it('should keep distinct ranges separate if they do not overlap after expansion', () => {
			const ranges = [
				{ from: 10, to: 20 },
				{ from: 80, to: 90 }
			];
			const docLen = 100;
			const maxLen = 5;
			const merged = expandAndMergeRanges(ranges, maxLen, docLen);
			expect(merged).toEqual([
				{ from: 5, to: 25 },
				{ from: 75, to: 95 }
			]);
		});
	});

	describe('isReplacementStale', () => {
		it('should return false when target text exactly matches expected original', () => {
			const docText = '这是测试迫不急待的正文。';
			const from = 4;
			const to = 8;
			const expected = '迫不急待';
			expect(isReplacementStale(docText, from, to, expected)).toBe(false);
		});

		it('should return true when target text has changed', () => {
			const docText = '这是测试迫不及待的正文。';
			const from = 4;
			const to = 8;
			const expected = '迫不急待';
			expect(isReplacementStale(docText, from, to, expected)).toBe(true);
		});

		it('should return true when offsets are out of bounds', () => {
			const docText = '正文';
			expect(isReplacementStale(docText, -1, 2, '正文')).toBe(true);
			expect(isReplacementStale(docText, 0, 10, '正文')).toBe(true);
			expect(isReplacementStale(docText, 5, 2, '正文')).toBe(true);
		});
	});

	describe('forceProofreadingUpdate StateEffect definition', () => {
		it('should define a valid CodeMirror StateEffect', () => {
			expect(forceProofreadingUpdate).toBeDefined();
			const effect = forceProofreadingUpdate.of(null);
			expect(effect.is(forceProofreadingUpdate)).toBe(true);
		});
	});
});

describe('ProofreadingManager prepareDictionaryForEditing, isFileInsideDictionary & getMaxPatternLength', () => {
	let app: App;
	let plugin: WebNovelAssistantPlugin;
	let manager: ProofreadingManager;
	let virtualFiles: Map<string, string>;
	let virtualFolders: Set<string>;
	let vaultMock: {
		adapter: Record<string, ReturnType<typeof vi.fn>>;
		on: ReturnType<typeof vi.fn>;
		offref: ReturnType<typeof vi.fn>;
		getAbstractFileByPath: ReturnType<typeof vi.fn>;
		create: ReturnType<typeof vi.fn>;
		createFolder: ReturnType<typeof vi.fn>;
		read: ReturnType<typeof vi.fn>;
		process: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		virtualFiles = new Map();
		virtualFolders = new Set(['NovelBook']);

		const adapterMock = {
			exists: vi.fn().mockImplementation((p: string) => Promise.resolve(virtualFiles.has(p))),
			read: vi.fn().mockImplementation((p: string) => {
				if (!virtualFiles.has(p)) return Promise.reject(new Error('File not found in storage'));
				return Promise.resolve(virtualFiles.get(p) || '');
			}),
			write: vi.fn().mockImplementation((p: string, content: string) => {
				virtualFiles.set(p, content);
				return Promise.resolve();
			}),
			remove: vi.fn().mockImplementation((p: string) => {
				virtualFiles.delete(p);
				return Promise.resolve();
			}),
			mkdir: vi.fn().mockImplementation((p: string) => {
				virtualFolders.add(p);
				return Promise.resolve();
			})
		};

		vaultMock = {
			adapter: adapterMock,
			on: vi.fn().mockImplementation(() => ({})),
			offref: vi.fn(),
			getAbstractFileByPath: vi.fn().mockImplementation((path: string) => {
				if (virtualFiles.has(path)) {
					return createMockTFile(path);
				}
				if (virtualFolders.has(path)) {
					return createMockTFolder(path);
				}
				return null;
			}),
			create: vi.fn().mockImplementation((path: string, content: string) => {
				virtualFiles.set(path, content);
				return Promise.resolve(createMockTFile(path));
			}),
			createFolder: vi.fn().mockImplementation((path: string) => {
				virtualFolders.add(path);
				return Promise.resolve(createMockTFolder(path));
			}),
			read: vi.fn().mockImplementation((file: TFile) => {
				return Promise.resolve(virtualFiles.get(file.path) || '');
			}),
			process: vi.fn().mockImplementation(async (file: TFile, fn: (data: string) => string) => {
				const current = virtualFiles.get(file.path) || '';
				const updated = fn(current);
				virtualFiles.set(file.path, updated);
				return Promise.resolve(updated);
			})
		};

		app = {
			vault: vaultMock as unknown as Vault,
			fileManager: {
				renameFile: vi.fn().mockResolvedValue(undefined)
			},
			workspace: {
				trigger: vi.fn()
			}
		} as unknown as App;

		plugin = {
			manifest: {
				id: 'obsidian-webnovel-assistant',
				dir: '.obsidian/plugins/WebNovel Assistant'
			},
			settings: {
				proofreading: {
					enabled: false,
					dictionaryPath: '',
					enableBuiltin: true,
					enableUserDict: true,
					enableSensitive: true,
					enableSynonyms: true,
					enableDeDiDe: false
				},
				workspaceFolders: ['NovelBook']
			} as unknown as WebNovelAssistantPlugin['settings'],
			saveSettings: vi.fn().mockResolvedValue(undefined),
			isFileInWorkspace: vi.fn().mockReturnValue(true)
		} as unknown as WebNovelAssistantPlugin;

		manager = new ProofreadingManager(app, plugin);
	});

	it('prepareDictionaryForEditing should create folder and template files without enabling proofreading', async () => {
		const dictPath = await manager.prepareDictionaryForEditing();
		expect(dictPath).toBe('NovelBook/校对词典');
		expect(virtualFolders.has('NovelBook/校对词典')).toBe(true);
		expect(virtualFiles.has('NovelBook/校对词典/错词.md')).toBe(true);
		expect(virtualFiles.has('NovelBook/校对词典/近义词.md')).toBe(true);
		expect(virtualFiles.has('NovelBook/校对词典/敏感词.md')).toBe(true);

		// 确保 enabled 依然保持为 false
		expect(plugin.settings.proofreading.enabled).toBe(false);
	});

	it('prepareDictionaryForEditing in English locale should create English folder and English template files without enabling proofreading', async () => {
		await setLocale('en');
		const dictPath = await manager.prepareDictionaryForEditing();
		expect(dictPath).toBe('NovelBook/Proofreading Dictionaries');
		expect(virtualFolders.has('NovelBook/Proofreading Dictionaries')).toBe(true);
		expect(virtualFiles.has('NovelBook/Proofreading Dictionaries/Typos.md')).toBe(true);
		expect(virtualFiles.has('NovelBook/Proofreading Dictionaries/Synonyms.md')).toBe(true);
		expect(virtualFiles.has('NovelBook/Proofreading Dictionaries/Sensitive Words.md')).toBe(true);
		expect(plugin.settings.proofreading.enabled).toBe(false);
		await setLocale('zh-CN');
	});

	it('prepareDictionaryForEditing should propagate error if createFolder fails and not persist invalid path', async () => {
		plugin.settings.proofreading.dictionaryPath = '';
		vaultMock.createFolder.mockRejectedValueOnce(new Error('Permission denied'));
		await expect(manager.prepareDictionaryForEditing()).rejects.toThrow('Permission denied');
		// 失败时绝不留下已保存的无效 path
		expect(plugin.settings.proofreading.dictionaryPath).toBe('');
	});

	it('prepareDictionaryForEditing should preload existing synonyms into snapshot when proofreading is disabled', async () => {
		plugin.settings.proofreading.enabled = false;
		plugin.settings.proofreading.dictionaryPath = '';

		virtualFiles.set(
			'NovelBook/校对词典/近义词.md',
			`| 近义词组 | 说明 |\n| --- | --- |\n| 高兴、快乐、开心 | 喜悦词组 |`
		);

		await manager.prepareDictionaryForEditing();

		// 验证快照正确预载已存在的近义词组
		const snapshot = manager.getDictSnapshot();
		const existingGroup = snapshot.synonyms.get('高兴');
		expect(existingGroup).toBeDefined();
		expect(existingGroup?.group.words).toEqual(['高兴', '快乐', '开心']);
		expect(existingGroup?.group.description).toBe('喜悦词组');
	});

	it('isFileInsideDictionary should work for both TFile objects and string paths', () => {
		plugin.settings.proofreading.dictionaryPath = 'NovelBook/校对词典';

		const dictFile = createMockTFile('NovelBook/校对词典/错词.md');
		const normalFile = createMockTFile('NovelBook/Chapter1.md');

		expect(manager.isFileInsideDictionary(dictFile)).toBe(true);
		expect(manager.isFileInsideDictionary(normalFile)).toBe(false);
		expect(manager.isFileInsideDictionary('NovelBook/校对词典/近义词.md')).toBe(true);
		expect(manager.isFileInsideDictionary('NovelBook/Chapter1.md')).toBe(false);
		expect(manager.isFileInsideDictionary(null)).toBe(false);
		expect(manager.isFileInsideDictionary(undefined)).toBe(false);
	});

	it('getMaxPatternLength should return maximum pattern length in active dictionary with minimum 50', async () => {
		expect(manager.getMaxPatternLength()).toBe(50);

		// 加载一条超长词条
		const longWord = '超'.repeat(65);
		virtualFiles.set(
			'NovelBook/校对词典/错词.md',
			`| 错词 | 建议 | 说明 |\n| --- | --- | --- |\n| ${longWord} | 修复 | 说明 |`
		);
		plugin.settings.proofreading.dictionaryPath = 'NovelBook/校对词典';
		await manager.loadDictionaries();

		expect(manager.getMaxPatternLength()).toBe(65);
	});
});
