import { TFile, TFolder, normalizePath, requestUrl, type App, type EventRef, type TAbstractFile } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type {
	ProofreadingDiagnostic,
	ParsedDictData,
	WrongWordEntry,
	SensitiveWordEntry,
	SynonymGroup,
	BasicDictInfo,
	DictUpdateResult,
	DictValidationResult
} from '../types/proofreading';
import { ACMatcher, resolveOverlaps } from './proofreading/AhoCorasick';
import { extractMarkdownExclusions } from './proofreading/MarkdownExclusion';
import { DeDiDeScanner } from './proofreading/DeDiDeRule';
import { PunctuationScanner } from './proofreading/PunctuationRule';
import type { DeDiDeLexicon } from '../types/proofreading';
import {
	parseWrongWordsTable,
	parseSynonymsTable,
	parseSensitiveWordsTable,
	updateTableInMarkdown,
	WRONG_WORDS_TEMPLATE,
	SYNONYMS_TEMPLATE,
	SENSITIVE_WORDS_TEMPLATE,
	WRONG_WORDS_TEMPLATE_EN,
	SYNONYMS_TEMPLATE_EN,
	SENSITIVE_WORDS_TEMPLATE_EN
} from './proofreading/tableParser';
import { Logger } from '../utils/Logger';
import { getPluginDir } from '../utils/platform';
import { BASIC_DICT_CONFIG, DEDIDE_DICT_CONFIG, DEFAULT_PROOFREADING_SETTINGS } from '../constants';
import { computeDiagnosticContextFingerprint, isDiagnosticIgnored, type IgnoredContextDetails } from '../utils/proofreadingHelpers';
import { getLocale } from '../i18n';

export const DICT_FOLDER_NAME = '校对词典';
export const DICT_FOLDER_NAME_EN = 'Proofreading Dictionaries';
export const WRONG_WORDS_FILE = '错词.md';
export const WRONG_WORDS_FILE_EN = 'Typos.md';
export const SYNONYMS_FILE = '近义词.md';
export const SYNONYMS_FILE_EN = 'Synonyms.md';
export const SENSITIVE_WORDS_FILE = '敏感词.md';
export const SENSITIVE_WORDS_FILE_EN = 'Sensitive Words.md';

/**
 * 严格校验基础错词库 JSON 格式与词条内容
 *
 * 校验规则：
 * 1. 结构必须为非数组对象；
 * 2. schemaVersion 必须为支持的版本（1）；
 * 3. dictionaryVersion 必须为非空字符串；
 * 4. updatedAt 必须为非空字符串；
 * 5. entries 必须为非空数组；
 * 6. 每条 entry 的 word、suggestion 必须为非空字符串且不超过 32 字符；
 * 7. word !== suggestion（禁止自映射）；
 * 8. description 必须为字符串且不超过 200 字符；
 * 9. 所有 word 必须唯一（禁止重复词条）；
 * 10. 计算 UTF-8 字节与条目数：超过阈值 (>1MB / >5000条) 时仅标记 isLarge 警告，绝不硬拒绝。
 */
export function validateBasicWrongWordsJson(parsed: unknown, rawText?: string): DictValidationResult {
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { valid: false, error: 'Dictionary data must be a JSON object' };
	}

	const obj = parsed as Record<string, unknown>;

	if (typeof obj.schemaVersion !== 'number' || obj.schemaVersion !== BASIC_DICT_CONFIG.SUPPORTED_SCHEMA_VERSION) {
		return { valid: false, error: `Unsupported schemaVersion: ${String(obj.schemaVersion)}` };
	}

	if (typeof obj.dictionaryVersion !== 'string' || obj.dictionaryVersion.trim() === '') {
		return { valid: false, error: 'dictionaryVersion must be a non-empty string' };
	}

	if (typeof obj.updatedAt !== 'string' || obj.updatedAt.trim() === '') {
		return { valid: false, error: 'updatedAt must be a non-empty string' };
	}

	if (obj.license !== undefined && typeof obj.license !== 'string') {
		return { valid: false, error: 'license must be a string' };
	}
	if (obj.source !== undefined && typeof obj.source !== 'string') {
		return { valid: false, error: 'source must be a string' };
	}

	if (!Array.isArray(obj.entries) || obj.entries.length === 0) {
		return { valid: false, error: 'entries must be a non-empty array' };
	}

	const seenWords = new Set<string>();
	const entries: WrongWordEntry[] = [];

	const rawEntries: unknown[] = obj.entries;
	for (let i = 0; i < rawEntries.length; i++) {
		const item: unknown = rawEntries[i];
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			return { valid: false, error: `Entry at index ${i} must be an object` };
		}

		const e = item as Record<string, unknown>;

		if (typeof e.word !== 'string' || e.word.trim() === '') {
			return { valid: false, error: `Entry at index ${i} has empty or non-string word` };
		}

		if (e.word.length > BASIC_DICT_CONFIG.MAX_WORD_LENGTH) {
			return { valid: false, error: `Entry "${e.word}" exceeds max word length of ${BASIC_DICT_CONFIG.MAX_WORD_LENGTH}` };
		}

		if (typeof e.suggestion !== 'string' || e.suggestion.trim() === '') {
			return { valid: false, error: `Entry "${e.word}" has empty or non-string suggestion` };
		}

		if (e.suggestion.length > BASIC_DICT_CONFIG.MAX_WORD_LENGTH) {
			return { valid: false, error: `Entry "${e.word}" suggestion exceeds max length of ${BASIC_DICT_CONFIG.MAX_WORD_LENGTH}` };
		}

		if (e.word === e.suggestion) {
			return { valid: false, error: `Self-mapping entry detected for "${e.word}"` };
		}

		if (typeof e.description !== 'string') {
			return { valid: false, error: `Entry "${e.word}" description must be a string` };
		}

		if (e.description.length > BASIC_DICT_CONFIG.MAX_DESCRIPTION_LENGTH) {
			return { valid: false, error: `Entry "${e.word}" description exceeds max length of ${BASIC_DICT_CONFIG.MAX_DESCRIPTION_LENGTH}` };
		}

		if (seenWords.has(e.word)) {
			return { valid: false, error: `Duplicate word detected: "${e.word}"` };
		}

		seenWords.add(e.word);
		entries.push({
			word: e.word,
			suggestion: e.suggestion,
			description: e.description
		});
	}

	let byteSize = 0;
	try {
		const textToMeasure = rawText ?? JSON.stringify(parsed);
		byteSize = new TextEncoder().encode(textToMeasure).length;
	} catch {
		byteSize = 0;
	}

	const isLarge = byteSize > BASIC_DICT_CONFIG.ADVISORY_BYTE_THRESHOLD || entries.length > BASIC_DICT_CONFIG.ADVISORY_COUNT_THRESHOLD;

	return {
		valid: true,
		data: {
			schemaVersion: obj.schemaVersion,
			dictionaryVersion: obj.dictionaryVersion,
			updatedAt: obj.updatedAt,
			license: typeof obj.license === 'string' ? obj.license : undefined,
			source: typeof obj.source === 'string' ? obj.source : undefined,
			entries
		},
		isLarge,
		byteSize,
		count: entries.length
	};
}

function validateStringArrayField(
	rawVal: unknown,
	key: string,
	optional: boolean = false
): { valid: true; list?: string[] } | { valid: false; error: string } {
	if (rawVal === undefined && optional) {
		return { valid: true, list: undefined };
	}
	if (!Array.isArray(rawVal)) {
		return { valid: false, error: `Missing or invalid array: ${key}` };
	}
	const rawArray = rawVal as readonly unknown[];
	const cleanList: string[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < rawArray.length; i++) {
		const item: unknown = rawArray[i];
		if (typeof item !== 'string' || item.trim() === '') {
			return { valid: false, error: `Array ${key} contains invalid empty or non-string element at index ${i}` };
		}
		const term = item.trim();
		if (term.length > DEDIDE_DICT_CONFIG.MAX_TERM_LENGTH) {
			return { valid: false, error: `Array ${key} contains an overlong term at index ${i}` };
		}
		if (seen.has(term)) {
			return { valid: false, error: `Array ${key} contains duplicate term: ${term}` };
		}
		seen.add(term);
		cleanList.push(term);
	}
	return { valid: true, list: cleanList };
}

/**
 * 严格校验的/地/得词典 JSON 格式与词条内容
 */
export function validateDeDiDeLexiconJson(parsed: unknown, rawText?: string): DictValidationResult<DeDiDeLexicon> {
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { valid: false, error: 'Lexicon data must be a JSON object' };
	}

	const obj = parsed as Record<string, unknown>;

	if (typeof obj.schemaVersion !== 'number' || obj.schemaVersion !== DEDIDE_DICT_CONFIG.SUPPORTED_SCHEMA_VERSION) {
		return { valid: false, error: `Unsupported schemaVersion: ${String(obj.schemaVersion)}` };
	}

	if (typeof obj.dictionaryVersion !== 'string' || obj.dictionaryVersion.trim() === '') {
		return { valid: false, error: 'dictionaryVersion must be a non-empty string' };
	}

	if (typeof obj.updatedAt !== 'string' || obj.updatedAt.trim() === '') {
		return { valid: false, error: 'updatedAt must be a non-empty string' };
	}

	if (obj.license !== undefined && typeof obj.license !== 'string') {
		return { valid: false, error: 'license must be a string' };
	}
	if (obj.source !== undefined && typeof obj.source !== 'string') {
		return { valid: false, error: 'source must be a string' };
	}

	const requiredArrays = [
		'adverbialModifiers',
		'actionVerbs',
		'degreePredicates',
		'degreeComplementPrefixes',
		'degreeComplementAdjectives',
		'degreeComplementPhrases',
		'comparativeAdjectives',
		'comparativeWords',
		'nounLookaheadExclusions',
		'attributiveAdjectives',
		'attributiveNouns'
	] as const;
	const optionalArrays = [
		'actionNominalFollowers'
	] as const;
	const allowedKeys = new Set<string>([
		'schemaVersion',
		'dictionaryVersion',
		'updatedAt',
		'license',
		'source',
		...requiredArrays,
		...optionalArrays
	]);
	for (const key of Object.keys(obj)) {
		if (!allowedKeys.has(key)) {
			return { valid: false, error: `Unexpected field: ${key}` };
		}
	}

	const sanitizedArrays: Record<string, string[]> = {};

	for (const key of requiredArrays) {
		const res = validateStringArrayField(obj[key], key, false);
		if (!res.valid) {
			return res;
		}
		if (res.list) {
			sanitizedArrays[key] = res.list;
		}
	}

	for (const key of optionalArrays) {
		const res = validateStringArrayField(obj[key], key, true);
		if (!res.valid) {
			return res;
		}
		if (res.list) {
			sanitizedArrays[key] = res.list;
		}
	}

	let byteSize = 0;
	try {
		const textToMeasure = rawText ?? JSON.stringify(parsed);
		byteSize = new TextEncoder().encode(textToMeasure).length;
	} catch {
		byteSize = 0;
	}

	const totalCount = requiredArrays.reduce((sum, k) => sum + (sanitizedArrays[k]?.length ?? 0), 0) +
		(sanitizedArrays.actionNominalFollowers?.length ?? 0);
	if (totalCount === 0) {
		return { valid: false, error: 'Lexicon must contain at least one term' };
	}
	const allArrayLengths = [
		...requiredArrays.map(k => sanitizedArrays[k]?.length ?? 0),
		sanitizedArrays.actionNominalFollowers?.length ?? 0
	];
	const maxArrayLength = Math.max(...allArrayLengths);
	const isLarge = byteSize > DEDIDE_DICT_CONFIG.ADVISORY_BYTE_THRESHOLD || maxArrayLength > DEDIDE_DICT_CONFIG.ADVISORY_COUNT_THRESHOLD;

	const data: DeDiDeLexicon = {
		schemaVersion: obj.schemaVersion,
		dictionaryVersion: obj.dictionaryVersion,
		updatedAt: obj.updatedAt,
		license: typeof obj.license === 'string' ? obj.license : 'MIT',
		source: typeof obj.source === 'string' ? obj.source : undefined,
		adverbialModifiers: sanitizedArrays.adverbialModifiers || [],
		actionVerbs: sanitizedArrays.actionVerbs || [],
		actionNominalFollowers: sanitizedArrays.actionNominalFollowers,
		degreePredicates: sanitizedArrays.degreePredicates || [],
		degreeComplementPrefixes: sanitizedArrays.degreeComplementPrefixes || [],
		degreeComplementAdjectives: sanitizedArrays.degreeComplementAdjectives || [],
		degreeComplementPhrases: sanitizedArrays.degreeComplementPhrases || [],
		comparativeAdjectives: sanitizedArrays.comparativeAdjectives || [],
		comparativeWords: sanitizedArrays.comparativeWords || [],
		nounLookaheadExclusions: sanitizedArrays.nounLookaheadExclusions || [],
		attributiveAdjectives: sanitizedArrays.attributiveAdjectives || [],
		attributiveNouns: sanitizedArrays.attributiveNouns || []
	};

	return {
		valid: true,
		data,
		isLarge,
		byteSize,
		count: totalCount
	};
}

function resolveCategoryFileName(
	hasZh: boolean,
	hasEn: boolean,
	zhFile: string,
	enFile: string,
	establishedScheme: 'zh' | 'en'
): string {
	if (hasZh && !hasEn) return zhFile;
	if (hasEn && !hasZh) return enFile;
	if (hasZh && hasEn) return getLocale() === 'en' ? enFile : zhFile;
	return establishedScheme === 'en' ? enFile : zhFile;
}

/**
 * 校对管理器 (ProofreadingManager)
 *
 * 核心功能：
 * 1. 词典存储与多表解析（严格唯一标准 Markdown 表，Last-Known-Good 容错）
 * 2. 多模式匹配引擎（Aho-Corasick、Markdown 语法排除、冲突合并与优先级决议）
 * 3. 完整生命周期自管（只读初始化，增删改移监听，Last-Known-Good 维护）
 * 4. 基础错词库独立远程更新与本地可恢复缓存
 */
export class ProofreadingManager {
	private app: App;
	private plugin: WebNovelAssistantPlugin;

	/** 活动词典运行时解析数据 */
	private dictData: ParsedDictData = {
		builtinWrongWords: new Map(),
		userWrongWords: new Map(),
		synonyms: new Map(),
		sensitiveWords: new Map()
	};

	/** Last-Known-Good (LKG) 容错缓存，用于在用户编辑出格式错误或读取异常时保留可用状态 */
	private lkgData: {
		userWrongWords: Map<string, WrongWordEntry>;
		synonyms: Map<string, { group: SynonymGroup; suggestions: string[] }>;
		sensitiveWords: Map<string, SensitiveWordEntry>;
	} = {
		userWrongWords: new Map(),
		synonyms: new Map(),
		sensitiveWords: new Map()
	};

	private eventRefs: EventRef[] = [];
	private acMatcher: ACMatcher | null = null;
	private initialized = false;
	private cacheVersion = 0;
	private debounceTimer: number | null = null;
	private refreshListeners = new Set<(version: number) => void>();

	/** 基础错词库是否正在更新中（防重入锁） */
	private isUpdatingDict = false;
	/** 基础错词库元数据信息 */
	private basicDictInfo: BasicDictInfo = {
		source: 'not_downloaded',
		version: '',
		count: 0,
		isLarge: false
	};

	private dedideScanner: DeDiDeScanner | null = null;
	private punctuationScanner: PunctuationScanner = new PunctuationScanner();
	private isUpdatingDeDiDe = false;
	private dedideDictInfo: BasicDictInfo = {
		source: 'not_downloaded',
		version: '',
		count: 0,
		isLarge: false
	};
	private cachedMaxPatternLength = 50;

	private ignoredWordsSet = new Set<string>();
	private ignoredContextsSet = new Set<string>();
	private ignoredContextEntriesByOriginal = new Map<string, Array<{
		original: string;
		ruleId?: string;
		prefix?: string;
		suffix?: string;
	}>>();

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	/**
	 * 获取当前词典缓存版本号
	 */
	public getCacheVersion(): number {
		return this.cacheVersion;
	}

	/**
	 * 订阅词典缓存刷新事件（返回取消订阅函数）
	 */
	public onRefresh(listener: (version: number) => void): () => void {
		this.refreshListeners.add(listener);
		return () => {
			this.refreshListeners.delete(listener);
		};
	}

	/**
	 * 订阅词典缓存刷新事件（别名）
	 */
	public subscribe(listener: (version: number) => void): () => void {
		return this.onRefresh(listener);
	}

	public notifyRefresh(): void {
		this.cacheVersion++;
		for (const listener of this.refreshListeners) {
			try {
				listener(this.cacheVersion);
			} catch (e) {
				Logger.error('[ProofreadingManager] 刷新监听回调异常:', e);
			}
		}
		try {
			this.app.workspace.trigger('webnovel:proofreading-refreshed', this.cacheVersion);
		} catch {
			// Workspace trigger safe
		}
	}

	/**
	 * 获取当前在内存中的词典快照（只读）
	 */
	public getDictSnapshot(): {
		userWrongWords: Map<string, WrongWordEntry>;
		builtinWrongWords: Map<string, WrongWordEntry>;
		wrongWords: Map<string, WrongWordEntry>;
		synonyms: Map<string, { group: SynonymGroup; suggestions: string[] }>;
		sensitiveWords: Map<string, SensitiveWordEntry>;
	} {
		const mergedWrong = new Map<string, WrongWordEntry>();
		for (const [w, e] of this.dictData.builtinWrongWords) mergedWrong.set(w, e);
		for (const [w, e] of this.dictData.userWrongWords) mergedWrong.set(w, e);

		return {
			userWrongWords: new Map(this.dictData.userWrongWords),
			builtinWrongWords: new Map(this.dictData.builtinWrongWords),
			wrongWords: mergedWrong,
			synonyms: new Map(this.dictData.synonyms),
			sensitiveWords: new Map(this.dictData.sensitiveWords)
		};
	}

	/**
	 * 同步设置中的已忽略词汇与上下文指纹至运行时内存 Set
	 */
	public syncIgnoredSets(): void {
		this.ignoredWordsSet.clear();
		for (const w of this.plugin.settings.proofreading?.ignoredWords ?? []) {
			if (w) this.ignoredWordsSet.add(w);
		}

		this.ignoredContextsSet.clear();
		this.ignoredContextEntriesByOriginal.clear();
		const contexts = this.plugin.settings.proofreading?.ignoredContexts;
		if (contexts) {
			for (const [key, entry] of Object.entries(contexts)) {
				if (key) this.ignoredContextsSet.add(key);
				if (entry && entry.original) {
					let list = this.ignoredContextEntriesByOriginal.get(entry.original);
					if (!list) {
						list = [];
						this.ignoredContextEntriesByOriginal.set(entry.original, list);
					}
					list.push({
						original: entry.original,
						ruleId: entry.ruleId,
						prefix: entry.prefix,
						suffix: entry.suffix
					});
				}
			}
		}
	}

	/**
	 * 获取当前已忽略的词汇列表（副本）
	 */
	public getIgnoredWords(): string[] {
		return Array.from(this.ignoredWordsSet);
	}

	/**
	 * 获取已忽略词汇数量
	 */
	public getIgnoredWordsCount(): number {
		return this.ignoredWordsSet.size;
	}

	/**
	 * 获取已忽略上下文语境数量
	 */
	public getIgnoredContextsCount(): number {
		return this.ignoredContextsSet.size;
	}

	/**
	 * 判断某项诊断是否已被忽略
	 */
	public isIgnored(
		diag: ProofreadingDiagnostic,
		contextFingerprint?: string,
		contextDetails?: IgnoredContextDetails
	): boolean {
		const entries = this.ignoredContextEntriesByOriginal.get(diag.original);
		return isDiagnosticIgnored(
			diag.original,
			contextFingerprint,
			this.ignoredWordsSet,
			this.ignoredContextsSet,
			contextDetails,
			entries
		);
	}

	/**
	 * 将指定词汇加入全局忽略白名单（全书/全库永久生效）
	 */
	public async ignoreWord(word: string): Promise<void> {
		if (!word || word.trim() === '') return;
		const cleanWord = word.trim();
		if (!this.plugin.settings.proofreading) {
			this.plugin.settings.proofreading = { ...DEFAULT_PROOFREADING_SETTINGS };
		}
		if (!this.plugin.settings.proofreading.ignoredWords) {
			this.plugin.settings.proofreading.ignoredWords = [];
		}
		if (!this.plugin.settings.proofreading.ignoredWords.includes(cleanWord)) {
			this.plugin.settings.proofreading.ignoredWords.push(cleanWord);
			this.syncIgnoredSets();
			await this.plugin.saveSettings();
			this.notifyRefresh();
		}
	}

	/**
	 * 从全局忽略白名单中移除词汇
	 */
	public async unignoreWord(word: string): Promise<void> {
		if (!this.plugin.settings.proofreading?.ignoredWords) return;
		const idx = this.plugin.settings.proofreading.ignoredWords.indexOf(word);
		if (idx !== -1) {
			this.plugin.settings.proofreading.ignoredWords.splice(idx, 1);
			this.syncIgnoredSets();
			await this.plugin.saveSettings();
			this.notifyRefresh();
		}
	}

	/**
	 * 记录特定语境下的忽略实例（以指纹哈希为键，仅在该语境下生效）
	 */
	public async ignoreInstance(
		fingerprint: string,
		original: string,
		contextSnippet: string,
		details?: { ruleId?: string; prefix?: string; suffix?: string }
	): Promise<void> {
		if (!fingerprint) return;
		if (!this.plugin.settings.proofreading) {
			this.plugin.settings.proofreading = { ...DEFAULT_PROOFREADING_SETTINGS };
		}
		if (!this.plugin.settings.proofreading.ignoredContexts) {
			this.plugin.settings.proofreading.ignoredContexts = {};
		}

		const contexts = this.plugin.settings.proofreading.ignoredContexts;
		const keys = Object.keys(contexts);
		if (keys.length >= 2000) {
			const oldestKey = keys.sort((a, b) => (contexts[a]?.timestamp ?? 0) - (contexts[b]?.timestamp ?? 0))[0];
			if (oldestKey) delete contexts[oldestKey];
		}

		contexts[fingerprint] = {
			original,
			context: contextSnippet,
			timestamp: Date.now(),
			ruleId: details?.ruleId,
			prefix: details?.prefix,
			suffix: details?.suffix
		};

		this.syncIgnoredSets();
		await this.plugin.saveSettings();
		this.notifyRefresh();
	}

	/**
	 * 获取当前已忽略的特定上下文实例列表（按时间倒序）
	 */
	public getIgnoredInstances(): Array<{
		fingerprint: string;
		original: string;
		context: string;
		timestamp: number;
		ruleId?: string;
	}> {
		if (!this.plugin.settings.proofreading?.ignoredContexts) return [];
		const contexts = this.plugin.settings.proofreading.ignoredContexts;
		return Object.entries(contexts).map(([fingerprint, entry]) => ({
			fingerprint,
			original: entry.original,
			context: entry.context,
			timestamp: entry.timestamp,
			ruleId: entry.ruleId
		})).sort((a, b) => b.timestamp - a.timestamp);
	}

	/**
	 * 移除单条特定上下文忽略记录（恢复该处的校对检测）
	 */
	public async unignoreInstance(fingerprint: string): Promise<void> {
		if (!this.plugin.settings.proofreading?.ignoredContexts) return;
		if (this.plugin.settings.proofreading.ignoredContexts[fingerprint]) {
			delete this.plugin.settings.proofreading.ignoredContexts[fingerprint];
			this.syncIgnoredSets();
			await this.plugin.saveSettings();
			this.notifyRefresh();
		}
	}

	/**
	 * 清空已忽略的内容
	 */
	public async clearIgnored(scope: 'all' | 'words' | 'contexts' = 'all'): Promise<void> {
		if (!this.plugin.settings.proofreading) return;
		if (scope === 'all' || scope === 'words') {
			this.plugin.settings.proofreading.ignoredWords = [];
		}
		if (scope === 'all' || scope === 'contexts') {
			this.plugin.settings.proofreading.ignoredContexts = {};
		}
		this.syncIgnoredSets();
		await this.plugin.saveSettings();
		this.notifyRefresh();
	}

	/**
	 * 服务初始化：只读加载，启动绝不创建任何文件或文件夹
	 */
	public async initialize(): Promise<void> {
		if (this.initialized) return;

		this.syncIgnoredSets();
		this.registerEvents();

		if (this.plugin.settings.proofreading?.enabled) {
			await this.loadDictionaries();
		}

		this.initialized = true;
	}

	/**
	 * 销毁服务：注销监听器并清空全部内存结构
	 */
	public async destroy(): Promise<void> {
		for (const ref of this.eventRefs) {
			this.app.vault.offref(ref);
		}
		this.eventRefs = [];

		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		this.refreshListeners.clear();
		this.acMatcher = null;
		this.dictData = {
			userWrongWords: new Map(),
			builtinWrongWords: new Map(),
			synonyms: new Map(),
			sensitiveWords: new Map()
		};
		this.lkgData = {
			userWrongWords: new Map(),
			synonyms: new Map(),
			sensitiveWords: new Map()
		};
		this.initialized = false;
		this.isUpdatingDict = false;
		this.basicDictInfo = {
			source: 'not_downloaded',
			version: '',
			count: 0,
			isLarge: false
		};
		this.dedideScanner = null;
		this.isUpdatingDeDiDe = false;
		this.dedideDictInfo = {
			source: 'not_downloaded',
			version: '',
			count: 0,
			isLarge: false
		};
		this.cachedMaxPatternLength = 50;
		this.ignoredWordsSet.clear();
		this.ignoredContextsSet.clear();
	}

	/**
	 * 获取或初始化词典根路径（若未配置，推断已有默认目录或依 locale 创建）
	 */
	public resolveDictionaryPath(customPath?: string): string {
		let dictPath = customPath || this.plugin.settings.proofreading?.dictionaryPath;
		if (dictPath && dictPath.trim() !== '') {
			return normalizePath(dictPath);
		}

		const workspaceFolders = this.plugin.settings.workspaceFolders;
		const baseFolder = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0] : '';

		const zhFolderPath = normalizePath(baseFolder ? `${baseFolder}/${DICT_FOLDER_NAME}` : DICT_FOLDER_NAME);
		const enFolderPath = normalizePath(baseFolder ? `${baseFolder}/${DICT_FOLDER_NAME_EN}` : DICT_FOLDER_NAME_EN);

		const hasZhFolder = !!this.app.vault.getAbstractFileByPath(zhFolderPath);
		const hasEnFolder = !!this.app.vault.getAbstractFileByPath(enFolderPath);

		if (hasZhFolder && !hasEnFolder) return zhFolderPath;
		if (hasEnFolder && !hasZhFolder) return enFolderPath;

		const folderName = getLocale() === 'zh-CN' ? DICT_FOLDER_NAME : DICT_FOLDER_NAME_EN;
		return normalizePath(baseFolder ? `${baseFolder}/${folderName}` : folderName);
	}

	/**
	 * 根据词典目录中已有的已知文件名推断 established scheme，并返回具体的 3 个文件路径及模板
	 * - 不重命名任何已有路径/文件
	 * - 重用已建立的 scheme（中文或英文）补全缺失模板
	 * - 当同一个类别两者同时存在时，采用确定的 established/current-locale 偏好，不无声合并
	 */
	public getResolvedDictFilePaths(dictPath: string): {
		wrongFilePath: string;
		wrongFileName: string;
		wrongTemplate: string;
		synonymFilePath: string;
		synonymFileName: string;
		synonymTemplate: string;
		sensitiveFilePath: string;
		sensitiveFileName: string;
		sensitiveTemplate: string;
	} {
		const normalizedDict = normalizePath(dictPath);

		const wrongZhPath = normalizePath(`${normalizedDict}/${WRONG_WORDS_FILE}`);
		const wrongEnPath = normalizePath(`${normalizedDict}/${WRONG_WORDS_FILE_EN}`);
		const synZhPath = normalizePath(`${normalizedDict}/${SYNONYMS_FILE}`);
		const synEnPath = normalizePath(`${normalizedDict}/${SYNONYMS_FILE_EN}`);
		const senZhPath = normalizePath(`${normalizedDict}/${SENSITIVE_WORDS_FILE}`);
		const senEnPath = normalizePath(`${normalizedDict}/${SENSITIVE_WORDS_FILE_EN}`);

		const hasWrongZh = !!(this.app.vault.getAbstractFileByPath(wrongZhPath) instanceof TFile);
		const hasWrongEn = !!(this.app.vault.getAbstractFileByPath(wrongEnPath) instanceof TFile);
		const hasSynZh = !!(this.app.vault.getAbstractFileByPath(synZhPath) instanceof TFile);
		const hasSynEn = !!(this.app.vault.getAbstractFileByPath(synEnPath) instanceof TFile);
		const hasSenZh = !!(this.app.vault.getAbstractFileByPath(senZhPath) instanceof TFile);
		const hasSenEn = !!(this.app.vault.getAbstractFileByPath(senEnPath) instanceof TFile);

		const zhCount = (hasWrongZh ? 1 : 0) + (hasSynZh ? 1 : 0) + (hasSenZh ? 1 : 0);
		const enCount = (hasWrongEn ? 1 : 0) + (hasSynEn ? 1 : 0) + (hasSenEn ? 1 : 0);

		let establishedScheme: 'zh' | 'en';
		if (zhCount > 0 && enCount === 0) {
			establishedScheme = 'zh';
		} else if (enCount > 0 && zhCount === 0) {
			establishedScheme = 'en';
		} else if (zhCount > 0 && enCount > 0) {
			establishedScheme = getLocale() === 'en' ? 'en' : 'zh';
		} else {
			const folderName = normalizedDict.split('/').pop();
			if (folderName === DICT_FOLDER_NAME) {
				establishedScheme = 'zh';
			} else if (folderName === DICT_FOLDER_NAME_EN) {
				establishedScheme = 'en';
			} else {
				establishedScheme = getLocale() === 'zh-CN' ? 'zh' : 'en';
			}
		}

		const wrongFileName = resolveCategoryFileName(hasWrongZh, hasWrongEn, WRONG_WORDS_FILE, WRONG_WORDS_FILE_EN, establishedScheme);
		const synonymFileName = resolveCategoryFileName(hasSynZh, hasSynEn, SYNONYMS_FILE, SYNONYMS_FILE_EN, establishedScheme);
		const sensitiveFileName = resolveCategoryFileName(hasSenZh, hasSenEn, SENSITIVE_WORDS_FILE, SENSITIVE_WORDS_FILE_EN, establishedScheme);

		return {
			wrongFilePath: normalizePath(`${normalizedDict}/${wrongFileName}`),
			wrongFileName,
			wrongTemplate: wrongFileName === WRONG_WORDS_FILE_EN ? WRONG_WORDS_TEMPLATE_EN : WRONG_WORDS_TEMPLATE,
			synonymFilePath: normalizePath(`${normalizedDict}/${synonymFileName}`),
			synonymFileName,
			synonymTemplate: synonymFileName === SYNONYMS_FILE_EN ? SYNONYMS_TEMPLATE_EN : SYNONYMS_TEMPLATE,
			sensitiveFilePath: normalizePath(`${normalizedDict}/${sensitiveFileName}`),
			sensitiveFileName,
			sensitiveTemplate: sensitiveFileName === SENSITIVE_WORDS_FILE_EN ? SENSITIVE_WORDS_TEMPLATE_EN : SENSITIVE_WORDS_TEMPLATE
		};
	}

	/**
	 * 显式启用校对功能 API
	 *
	 * 规则：在首个 workspaceFolders/校对词典或Proofreading Dictionaries（无则根目录）创建标准模板文件，
	 * 保留已有文件，持久化实际 path；失败时不启用且不删除已创建内容。
	 */
	public async enable(): Promise<boolean> {
		const dictPath = this.resolveDictionaryPath();

		try {
			// 1. 确保目录存在
			const folder = this.app.vault.getAbstractFileByPath(dictPath);
			if (!folder) {
				await this.app.vault.createFolder(dictPath);
			}

			// 2. 确保模板文件存在（保留已有）
			const paths = this.getResolvedDictFilePaths(dictPath);
			await this.ensureTemplateFile(paths.wrongFilePath, paths.wrongTemplate);
			await this.ensureTemplateFile(paths.synonymFilePath, paths.synonymTemplate);
			await this.ensureTemplateFile(paths.sensitiveFilePath, paths.sensitiveTemplate);

			// 3. 持久化设置并启用
			this.plugin.settings.proofreading.dictionaryPath = dictPath;
			this.plugin.settings.proofreading.enabled = true;
			this.plugin.cacheManager?.resetLoreCache();
			await this.plugin.saveSettings();

			// 4. 加载词典数据
			await this.loadDictionaries();
			return true;
		} catch (error) {
			Logger.error('[ProofreadingManager] 启用校对功能失败:', error);
			this.plugin.settings.proofreading.enabled = false;
			return false;
		}
	}

	/**
	 * 显式禁用校对功能 API
	 */
	public async disable(): Promise<void> {
		this.plugin.settings.proofreading.enabled = false;
		await this.plugin.saveSettings();
		this.acMatcher = null;
		this.notifyRefresh();
	}

	/**
	 * 显式补全缺失的模板文件
	 */
	public async regenerateMissingTemplates(specifiedDictPath?: string): Promise<void> {
		const dictPath = this.resolveDictionaryPath(specifiedDictPath);

		// 先成功创建/补齐目录和 3 个模板文件
		const folder = this.app.vault.getAbstractFileByPath(dictPath);
		if (!folder) {
			await this.app.vault.createFolder(dictPath);
		}

		const paths = this.getResolvedDictFilePaths(dictPath);
		await this.ensureTemplateFile(paths.wrongFilePath, paths.wrongTemplate);
		await this.ensureTemplateFile(paths.synonymFilePath, paths.synonymTemplate);
		await this.ensureTemplateFile(paths.sensitiveFilePath, paths.sensitiveTemplate);

		// 成功后再持久化路径
		if (this.plugin.settings.proofreading.dictionaryPath !== dictPath) {
			this.plugin.settings.proofreading.dictionaryPath = dictPath;
			this.plugin.cacheManager?.resetLoreCache();
			await this.plugin.saveSettings();
		}

		await this.loadDictionaries();
	}

	/**
	 * 为标注/编辑准备词典文件
	 * 确保目录与 3 个模板文件存在，并持久化 dictionaryPath，但不更改 enabled 状态
	 */
	public async prepareDictionaryForEditing(): Promise<string> {
		const dictPath = this.resolveDictionaryPath();

		// 先成功创建/补齐目录和 3 个模板文件
		const folder = this.app.vault.getAbstractFileByPath(dictPath);
		if (!folder) {
			await this.app.vault.createFolder(dictPath);
		}

		const paths = this.getResolvedDictFilePaths(dictPath);
		await this.ensureTemplateFile(paths.wrongFilePath, paths.wrongTemplate);
		await this.ensureTemplateFile(paths.synonymFilePath, paths.synonymTemplate);
		await this.ensureTemplateFile(paths.sensitiveFilePath, paths.sensitiveTemplate);

		// 创建成功后再持久化路径
		if (this.plugin.settings.proofreading.dictionaryPath !== dictPath) {
			this.plugin.settings.proofreading.dictionaryPath = dictPath;
			this.plugin.cacheManager?.resetLoreCache();
			await this.plugin.saveSettings();
		}

		// 每次 prepare 后都无条件加载词典，确保内存快照完整（即使 proofreading 处于 disabled）
		await this.loadDictionaries();

		return dictPath;
	}

	/**
	 * 更新当前词典中最大词条长度缓存（最小 50）
	 */
	private updateCachedMaxPatternLength(): void {
		let maxLen = 50;
		for (const w of this.dictData.userWrongWords.keys()) {
			if (w.length > maxLen) maxLen = w.length;
		}
		for (const w of this.dictData.builtinWrongWords.keys()) {
			if (w.length > maxLen) maxLen = w.length;
		}
		for (const w of this.dictData.synonyms.keys()) {
			if (w.length > maxLen) maxLen = w.length;
		}
		for (const w of this.dictData.sensitiveWords.keys()) {
			if (w.length > maxLen) maxLen = w.length;
		}
		this.cachedMaxPatternLength = maxLen;
	}

	/**
	 * 获取当前词典中最大词条长度（用于视口扩展扫描，最小 50）
	 */
	public getMaxPatternLength(): number {
		return this.cachedMaxPatternLength;
	}

	/**
	 * 重命名校对词典目录 API
	 * 使用 app.fileManager.renameFile，同父 basename，校验非法名/冲突
	 */
	public async renameDictionaryFolder(newBasename: string): Promise<boolean> {
		const currentPath = this.plugin.settings.proofreading.dictionaryPath;
		if (!currentPath) return false;

		const trimmedName = newBasename.trim();
		if (!trimmedName || /[\\/:*?"<>|]/.test(trimmedName)) {
			Logger.warn('[ProofreadingManager] 重命名失败：目录名包含非法字符或为空', trimmedName);
			return false;
		}

		const folder = this.app.vault.getAbstractFileByPath(currentPath);
		if (!(folder instanceof TFolder)) {
			Logger.warn('[ProofreadingManager] 重命名失败：当前词典目录不存在', currentPath);
			return false;
		}

		// 计算同父级的新路径
		const parentPath = folder.parent ? folder.parent.path : '';
		const newPath = normalizePath(parentPath && parentPath !== '/' ? `${parentPath}/${trimmedName}` : trimmedName);

		if (newPath === currentPath) return true;

		const existing = this.app.vault.getAbstractFileByPath(newPath);
		if (existing) {
			Logger.warn('[ProofreadingManager] 重命名失败：目标路径已存在同名文件或目录', newPath);
			return false;
		}

		try {
			await this.app.fileManager.renameFile(folder, newPath);
			this.plugin.settings.proofreading.dictionaryPath = newPath;
			this.plugin.cacheManager?.resetLoreCache();
			await this.plugin.saveSettings();
			await this.loadDictionaries();
			return true;
		} catch (error) {
			Logger.error('[ProofreadingManager] 词典目录重命名失败:', error);
			return false;
		}
	}

	private async ensureParentFolderExists(filePath: string): Promise<void> {
		const lastSlash = filePath.lastIndexOf('/');
		if (lastSlash === -1) return;
		const parentPath = filePath.slice(0, lastSlash);
		const parts = parentPath.split('/');
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const exists = this.app.vault.getAbstractFileByPath(current);
			if (!exists) {
				try {
					await this.app.vault.createFolder(current);
				} catch {
					// Folder may already exist or be concurrently created
				}
			}
		}
	}

	/**
	 * 当首个工作区目录变更时，自动平移默认管理的校对词典目录
	 *
	 * 规则：
	 * 1. 仅当 dictionaryPath 完全等于原首个工作区下的默认目录名（校对词典 或 Proofreading Dictionaries，包括原工作区为空时的根目录默认路径）时才执行迁移；
	 * 2. 用户自定义词典路径/名称必须保持原样，不予迁移；
	 * 3. 通过 Obsidian 公开 API (app.fileManager.renameFile) 进行迁移；
	 * 4. 目标路径已存在同名文件/目录或移动失败时，保持原路径不丢数据，不指向缺失路径；
	 * 5. 迁移成功后更新 dictionaryPath、刷新排除缓存并重新加载词典。
	 */
	public async relocateDefaultDictionary(oldFirst: string, newFirst: string): Promise<boolean> {
		const rawDictPath = this.plugin.settings.proofreading?.dictionaryPath;
		if (!rawDictPath || rawDictPath.trim() === '') {
			return false;
		}

		const currentDictPath = normalizePath(rawDictPath);
		const normOldFirst = oldFirst ? normalizePath(oldFirst) : '';
		const normNewFirst = newFirst ? normalizePath(newFirst) : '';

		const expectedZhOld = normalizePath(normOldFirst ? `${normOldFirst}/${DICT_FOLDER_NAME}` : DICT_FOLDER_NAME);
		const expectedEnOld = normalizePath(normOldFirst ? `${normOldFirst}/${DICT_FOLDER_NAME_EN}` : DICT_FOLDER_NAME_EN);

		let matchedBasename: string | null = null;
		if (currentDictPath === expectedZhOld) {
			matchedBasename = DICT_FOLDER_NAME;
		} else if (currentDictPath === expectedEnOld) {
			matchedBasename = DICT_FOLDER_NAME_EN;
		}

		if (!matchedBasename) {
			return false;
		}

		const targetPath = normalizePath(normNewFirst ? `${normNewFirst}/${matchedBasename}` : matchedBasename);
		if (currentDictPath === targetPath) {
			return false;
		}

		const oldFolder = this.app.vault.getAbstractFileByPath(currentDictPath);
		if (oldFolder instanceof TFolder) {
			const destExists = this.app.vault.getAbstractFileByPath(targetPath);
			if (destExists) {
				Logger.warn(`[ProofreadingManager] 词典目录迁移失败：目标路径 "${targetPath}" 已存在同名文件或目录`);
				return false;
			}

			try {
				await this.ensureParentFolderExists(targetPath);
				await this.app.fileManager.renameFile(oldFolder, targetPath);
				this.plugin.settings.proofreading.dictionaryPath = targetPath;
				this.plugin.cacheManager?.resetLoreCache();
				await this.loadDictionaries();
				return true;
			} catch (error) {
				Logger.error('[ProofreadingManager] 词典目录迁移异常:', error);
				return false;
			}
		} else if (!oldFolder) {
			// 旧目录在物理磁盘上尚不存在（如尚未启用或未创建），同步更新逻辑路径
			this.plugin.settings.proofreading.dictionaryPath = targetPath;
			this.plugin.cacheManager?.resetLoreCache();
			return true;
		}

		return false;
	}

	/**
	 * 注册 Vault 事件监听
	 */
	private registerEvents(): void {
		this.eventRefs.push(
			this.app.vault.on('create', (file) => {
				if (this.isDictionaryFile(file) || (file instanceof TFolder && this.isFileInsideDictionary(file))) {
					this.scheduleReload();
				}
			}),
			this.app.vault.on('modify', (file) => {
				if (this.isDictionaryFile(file)) {
					this.scheduleReload();
				}
			}),
			this.app.vault.on('delete', (file) => {
				const currentDict = this.plugin.settings.proofreading?.dictionaryPath;
				if (!currentDict) return;
				const normalizedCurrent = normalizePath(currentDict);
				const normalizedDeleted = normalizePath(file.path);

				// 检查是否为词典目录或其祖先目录被删除
				if (normalizedCurrent === normalizedDeleted || normalizedCurrent.startsWith(normalizedDeleted + '/')) {
					// 仅内存清理并视为空，不自动重建
					this.dictData.userWrongWords.clear();
					this.dictData.synonyms.clear();
					this.dictData.sensitiveWords.clear();
					this.lkgData.userWrongWords.clear();
					this.lkgData.synonyms.clear();
					this.lkgData.sensitiveWords.clear();
					this.buildAhoCorasick();
					this.notifyRefresh();
				} else if (this.isDictionaryFile(file)) {
					this.scheduleReload();
				}
			}),
			this.app.vault.on('rename', (file, oldPath) => {
				void (async () => {
					const currentDict = this.plugin.settings.proofreading?.dictionaryPath;
					if (!currentDict) return;
					const normalizedCurrent = normalizePath(currentDict);
					const normalizedOld = normalizePath(oldPath);
					const normalizedNew = normalizePath(file.path);

					// 1. 检查是否为词典目录或其祖先目录移动/重命名
					if (normalizedCurrent === normalizedOld) {
						try {
							this.plugin.settings.proofreading.dictionaryPath = normalizedNew;
							this.plugin.cacheManager?.resetLoreCache();
							await this.plugin.saveSettings();
						} catch (err) {
							Logger.error('[ProofreadingManager] 保存词典重命名设置失败:', err);
						}
						this.scheduleReload();
					} else if (normalizedCurrent.startsWith(normalizedOld + '/')) {
						const suffix = normalizedCurrent.substring(normalizedOld.length);
						try {
							this.plugin.settings.proofreading.dictionaryPath = normalizePath(normalizedNew + suffix);
							this.plugin.cacheManager?.resetLoreCache();
							await this.plugin.saveSettings();
						} catch (err) {
							Logger.error('[ProofreadingManager] 保存词典祖先重命名设置失败:', err);
						}
						this.scheduleReload();
					} else {
						// 2. 检查普通文件是否移入、移出或在词典目录内重命名
						const wasInsideDict = this.isInsideDictionaryPath(normalizedOld);
						const isNowInsideDict = this.isInsideDictionaryPath(normalizedNew);
						if (wasInsideDict || isNowInsideDict) {
							this.scheduleReload();
						}
					}
				})();
			})
		);
	}

	private scheduleReload(): void {
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			void this.loadDictionaries();
		}, 200);
	}

	private isDictionaryFile(file: unknown): boolean {
		if (!(file instanceof TFile)) return false;
		const dictPath = this.plugin.settings.proofreading?.dictionaryPath;
		if (!dictPath) return false;
		const normalizedDict = normalizePath(dictPath);
		const normalizedFile = normalizePath(file.path);
		if (!normalizedFile.startsWith(normalizedDict + '/')) return false;

		const name = file.name;
		return (
			name === WRONG_WORDS_FILE ||
			name === WRONG_WORDS_FILE_EN ||
			name === SYNONYMS_FILE ||
			name === SYNONYMS_FILE_EN ||
			name === SENSITIVE_WORDS_FILE ||
			name === SENSITIVE_WORDS_FILE_EN
		);
	}

	public isFileInsideDictionary(fileOrPath: TAbstractFile | string | null | undefined): boolean {
		if (!fileOrPath) return false;
		const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
		return this.isInsideDictionaryPath(path);
	}

	private isInsideDictionaryPath(path: string): boolean {
		const dictPath = this.plugin.settings.proofreading?.dictionaryPath;
		if (!dictPath) return false;
		const normalizedDict = normalizePath(dictPath);
		const normalized = normalizePath(path);
		return normalized === normalizedDict || normalized.startsWith(normalizedDict + '/');
	}

	private async ensureTemplateFile(path: string, defaultContent: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file) {
			await this.app.vault.create(path, defaultContent);
		}
	}

	/**
	 * 加载并解析所有词典文件（容错机制：格式错误或读取抛错时保留 last-known-good，文件确实缺失时视为空）
	 */
	public async loadDictionaries(): Promise<void> {
		this.syncIgnoredSets();
		const settings = this.plugin.settings.proofreading;
		const dictPath = settings?.dictionaryPath;
		const dictFilePaths = dictPath ? this.getResolvedDictFilePaths(dictPath) : null;

		let nextBuiltinWords = new Map<string, WrongWordEntry>();
		let nextUserWrongWords = new Map<string, WrongWordEntry>();
		let nextSynonyms = new Map<string, { group: SynonymGroup; suggestions: string[] }>();
		let nextSensitiveWords = new Map<string, SensitiveWordEntry>();

		// 1. 加载基础错词（优先本地 dict/ 缓存，无缓存时状态为 not_downloaded，0 条，绝不自动联网）
		if (settings?.enableBuiltin !== false) {
			const cached = await this.loadBasicWrongWordsCache();
			if (cached) {
				nextBuiltinWords = cached.entries;
				this.basicDictInfo = cached.info;
			} else {
				nextBuiltinWords = new Map();
				this.basicDictInfo = {
					source: 'not_downloaded',
					version: '',
					count: 0,
					isLarge: false
				};
			}
		} else {
			nextBuiltinWords = new Map();
		}

		// 1.5. 加载 DeDiDe 词典（优先本地 dict/ 缓存，无词典时不可启用且 scanner 为 null，绝不自动联网）
		const cachedDeDiDe = await this.loadDeDiDeLexiconCache();
		if (cachedDeDiDe) {
			this.dedideDictInfo = cachedDeDiDe.info;
			this.dedideScanner = settings?.enableDeDiDe ? new DeDiDeScanner(cachedDeDiDe.lexicon) : null;
		} else {
			this.dedideDictInfo = {
				source: 'not_downloaded',
				version: '',
				count: 0,
				isLarge: false
			};
			this.dedideScanner = null;
		}

		// 2. 加载用户错词
		if (dictPath && dictFilePaths && settings?.enableUserDict !== false) {
			const wrongFile = this.app.vault.getAbstractFileByPath(dictFilePaths.wrongFilePath);
			if (!wrongFile) {
				// 文件确实缺失：视为空
				nextUserWrongWords = new Map();
				this.lkgData.userWrongWords = new Map();
			} else if (wrongFile instanceof TFile) {
				try {
					const content = await this.app.vault.read(wrongFile);
					const parseRes = parseWrongWordsTable(content);
					if (parseRes.success) {
						nextUserWrongWords = parseRes.data;
						this.lkgData.userWrongWords = new Map(parseRes.data);
					} else {
						Logger.warn('[ProofreadingManager] 错词词典解析失败，沿用 Last-Known-Good 缓存:', parseRes.reason);
						nextUserWrongWords = new Map(this.lkgData.userWrongWords);
					}
				} catch (e) {
					Logger.error('[ProofreadingManager] 读取错词文件失败，沿用 Last-Known-Good 缓存:', e);
					nextUserWrongWords = new Map(this.lkgData.userWrongWords);
				}
			}
		} else {
			nextUserWrongWords = new Map();
		}

		// 3. 加载近义词组
		if (dictPath && dictFilePaths && settings?.enableSynonyms !== false) {
			const synFile = this.app.vault.getAbstractFileByPath(dictFilePaths.synonymFilePath);
			if (!synFile) {
				nextSynonyms = new Map();
				this.lkgData.synonyms = new Map();
			} else if (synFile instanceof TFile) {
				try {
					const content = await this.app.vault.read(synFile);
					const parseRes = parseSynonymsTable(content);
					if (parseRes.success) {
						nextSynonyms = parseRes.data;
						this.lkgData.synonyms = new Map(parseRes.data);
					} else {
						Logger.warn('[ProofreadingManager] 近义词词典解析失败，沿用 Last-Known-Good 缓存:', parseRes.reason);
						nextSynonyms = new Map(this.lkgData.synonyms);
					}
				} catch (e) {
					Logger.error('[ProofreadingManager] 读取近义词文件失败，沿用 Last-Known-Good 缓存:', e);
					nextSynonyms = new Map(this.lkgData.synonyms);
				}
			}
		} else {
			nextSynonyms = new Map();
		}

		// 4. 加载敏感词
		if (dictPath && dictFilePaths && settings?.enableSensitive !== false) {
			const senFile = this.app.vault.getAbstractFileByPath(dictFilePaths.sensitiveFilePath);
			if (!senFile) {
				nextSensitiveWords = new Map();
				this.lkgData.sensitiveWords = new Map();
			} else if (senFile instanceof TFile) {
				try {
					const content = await this.app.vault.read(senFile);
					const parseRes = parseSensitiveWordsTable(content);
					if (parseRes.success) {
						nextSensitiveWords = parseRes.data;
						this.lkgData.sensitiveWords = new Map(parseRes.data);
					} else {
						Logger.warn('[ProofreadingManager] 敏感词词典解析失败，沿用 Last-Known-Good 缓存:', parseRes.reason);
						nextSensitiveWords = new Map(this.lkgData.sensitiveWords);
					}
				} catch (e) {
					Logger.error('[ProofreadingManager] 读取敏感词文件失败，沿用 Last-Known-Good 缓存:', e);
					nextSensitiveWords = new Map(this.lkgData.sensitiveWords);
				}
			}
		} else {
			nextSensitiveWords = new Map();
		}

		this.dictData = {
			builtinWrongWords: nextBuiltinWords,
			userWrongWords: nextUserWrongWords,
			synonyms: nextSynonyms,
			sensitiveWords: nextSensitiveWords
		};

		// 5. 构建 Aho-Corasick 自动机
		this.buildAhoCorasick();
		this.notifyRefresh();
	}

	/**
	 * 构建多模匹配 Aho-Corasick 自动机
	 * 用户错词覆盖内置错词时，source 确定为 user_wrong
	 */
	private buildAhoCorasick(): void {
		const matcher = new ACMatcher();

		// 用户错词（最高错词优先级）
		for (const [word, entry] of this.dictData.userWrongWords.entries()) {
			matcher.insert(word, 'user_wrong', `user_wrong_${word}`, entry);
		}

		// 内置错词：若用户错词未定义同字面词条，则插入为 builtin
		for (const [word, entry] of this.dictData.builtinWrongWords.entries()) {
			if (!this.dictData.userWrongWords.has(word)) {
				matcher.insert(word, 'builtin', `builtin_wrong_${word}`, entry);
			}
		}

		// 敏感词
		for (const [word, entry] of this.dictData.sensitiveWords.entries()) {
			matcher.insert(word, 'user_sensitive', `sensitive_${word}`, entry);
		}

		// 近义词
		for (const [word, entry] of this.dictData.synonyms.entries()) {
			matcher.insert(word, 'user_synonym', `synonym_${word}`, entry);
		}

		matcher.build();
		this.acMatcher = matcher;
		this.updateCachedMaxPatternLength();
	}

	/**
	 * 统一扫描入口
	 *
	 * @param target 文本字符串或 TFile 对象
	 * @param maybeFile 当 target 为字符串时可选关联的 TFile 文件对象
	 */
	public scan(target: string | TFile, maybeFile?: TFile): ProofreadingDiagnostic[] {
		if (!this.plugin.settings.proofreading?.enabled) {
			return [];
		}

		let text = '';
		let file: TFile | undefined;

		if (typeof target === 'string') {
			text = target;
			file = maybeFile;
		} else if (target instanceof TFile) {
			file = target;
		}

		// 如果提供了 TFile，默认限制在工作区；开启全局后仅保留词典目录排除。
		if (file) {
			if (!this.plugin.settings.proofreading?.enableGlobal) {
				if (typeof this.plugin.isFileInWorkspace === 'function' && !this.plugin.isFileInWorkspace(file)) {
					return [];
				}
			}
			if (this.isInsideDictionaryPath(file.path)) {
				return [];
			}
		}

		if (!text || !this.acMatcher) {
			return [];
		}

		// 1. 提取 Markdown 语法排除区间
		const excludedRanges = extractMarkdownExclusions(text);

		// 2. Aho-Corasick 扫描
		const rawMatches = this.acMatcher.match(text, excludedRanges);

		// 3. 保守“的/地/得”语法检测（若启用）
		if (this.plugin.settings.proofreading?.enableDeDiDe && this.dedideScanner) {
			const dedideMatches = this.dedideScanner.scan(text, excludedRanges);
			rawMatches.push(...dedideMatches);
		}

		// 3.5. 标点符号诊断（仅在显式启用时运行，旧设置缺失时默认关闭）
		if (this.plugin.settings.proofreading?.enablePunctuation === true) {
			const punctuationMatches = this.punctuationScanner.scan(text, excludedRanges);
			rawMatches.push(...punctuationMatches);
		}

		// 4. 重叠冲突决议与优先级排序
		const resolved = resolveOverlaps(rawMatches);
		if (this.ignoredWordsSet.size === 0 && this.ignoredContextsSet.size === 0) {
			return resolved;
		}

		return resolved.filter(diag => {
			let fingerprint: string | undefined;
			let details: IgnoredContextDetails | undefined;
			if (text && this.ignoredContextsSet.size > 0) {
				fingerprint = computeDiagnosticContextFingerprint(text, diag.from, diag.to, diag.ruleId, diag.original);
				const prefix = text.slice(Math.max(0, diag.from - 12), diag.from);
				const suffix = text.slice(diag.to, Math.min(text.length, diag.to + 12));
				details = { ruleId: diag.ruleId, prefix, suffix };
			}
			return !this.isIgnored(diag, fingerprint, details);
		});
	}

	/**
	 * 增量/修改写入表格条目 API
	 * 必须使用 vault.process，保留表外 Markdown；无唯一标准表时拒写
	 */
	public async updateTableEntry(
		fileType: 'wrong' | 'synonym' | 'sensitive',
		keyWord: string,
		rowData: string[]
	): Promise<boolean> {
		const dictPath = this.plugin.settings.proofreading?.dictionaryPath;
		if (!dictPath) return false;

		const paths = this.getResolvedDictFilePaths(dictPath);
		let targetFilePath = paths.wrongFilePath;
		let targetTemplate = paths.wrongTemplate;

		if (fileType === 'synonym') {
			targetFilePath = paths.synonymFilePath;
			targetTemplate = paths.synonymTemplate;
		} else if (fileType === 'sensitive') {
			targetFilePath = paths.sensitiveFilePath;
			targetTemplate = paths.sensitiveTemplate;
		}

		let file = this.app.vault.getAbstractFileByPath(targetFilePath);
		if (!file) {
			await this.ensureTemplateFile(targetFilePath, targetTemplate);
			file = this.app.vault.getAbstractFileByPath(targetFilePath);
		}

		if (!(file instanceof TFile)) return false;

		let writeSuccess = false;

		await this.app.vault.process(file, (content) => {
			const updateRes = updateTableInMarkdown(content, fileType, keyWord, rowData);
			if (updateRes.success) {
				writeSuccess = true;
				return updateRes.newContent;
			}
			Logger.warn('[ProofreadingManager] 写入表格条目失败:', updateRes.reason);
			return content;
		});

		if (writeSuccess) {
			await this.loadDictionaries();
		}

		return writeSuccess;
	}

	/**
	 * 获取当前基础错词库状态与元数据信息
	 */
	public getBasicDictInfo(): BasicDictInfo {
		return { ...this.basicDictInfo };
	}

	private getDictDir(): string {
		return `${getPluginDir(this.plugin)}/dict`;
	}

	private async ensureDictDir(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const dictDir = this.getDictDir();
		if (!(await adapter.exists(dictDir))) {
			await adapter.mkdir(dictDir);
		}
	}

	private getBasicDictCachePath(): string {
		return `${this.getDictDir()}/${BASIC_DICT_CONFIG.CACHE_FILENAME}`;
	}

	private getBasicDictBackupPath(): string {
		return `${this.getDictDir()}/${BASIC_DICT_CONFIG.CACHE_FILENAME}.bak`;
	}

	private getBasicDictTempPath(): string {
		return `${this.getDictDir()}/${BASIC_DICT_CONFIG.CACHE_FILENAME}.tmp`;
	}

	/**
	 * 从本地插件 dict 目录缓存中只读加载基础错词库
	 * 支持从 .bak 备份中自动恢复损坏的主缓存，彻底失败时返回 null
	 */
	private async loadBasicWrongWordsCache(): Promise<{ entries: Map<string, WrongWordEntry>; info: BasicDictInfo } | null> {
		const adapter = this.app.vault.adapter;
		const cachePath = this.getBasicDictCachePath();
		const backupPath = this.getBasicDictBackupPath();

		// 1. 尝试读取主缓存文件
		try {
			if (await adapter.exists(cachePath)) {
				const content = await adapter.read(cachePath);
				const parsed: unknown = JSON.parse(content);
				const val = validateBasicWrongWordsJson(parsed, content);
				if (val.valid && val.data) {
					const map = new Map<string, WrongWordEntry>();
					for (const entry of val.data.entries) {
						map.set(entry.word, entry);
					}
					return {
						entries: map,
						info: {
							source: 'online_cache',
							version: val.data.dictionaryVersion,
							count: val.data.entries.length,
							updatedAt: val.data.updatedAt,
							isLarge: val.isLarge
						}
					};
				} else {
					Logger.warn('[ProofreadingManager] 基础错词库缓存校验失败:', val.error);
				}
			}
		} catch (err) {
			Logger.error('[ProofreadingManager] 读取基础错词库主缓存失败:', err);
		}

		// 2. 主缓存缺失或损坏时，尝试从备份文件恢复
		try {
			if (await adapter.exists(backupPath)) {
				const bakContent = await adapter.read(backupPath);
				const bakParsed: unknown = JSON.parse(bakContent);
				const bakVal = validateBasicWrongWordsJson(bakParsed, bakContent);
				if (bakVal.valid && bakVal.data) {
					Logger.info('[ProofreadingManager] 从备份文件恢复基础错词库缓存');
					try {
						await this.ensureDictDir();
						await adapter.write(cachePath, bakContent);
					} catch (writeErr) {
						Logger.warn('[ProofreadingManager] 写回恢复的主缓存失败:', writeErr);
					}
					const map = new Map<string, WrongWordEntry>();
					for (const entry of bakVal.data.entries) {
						map.set(entry.word, entry);
					}
					return {
						entries: map,
						info: {
							source: 'online_cache',
							version: bakVal.data.dictionaryVersion,
							count: bakVal.data.entries.length,
							updatedAt: bakVal.data.updatedAt,
							isLarge: bakVal.isLarge
						}
					};
				}
			}
		} catch (bakErr) {
			Logger.error('[ProofreadingManager] 读取基础错词库备份失败:', bakErr);
		}

		return null;
	}

	/**
	 * 手动更新基础错词库 API（供设置页面调用）
	 *
	 * 流程：
	 * 1. 防重入锁检测；
	 * 2. 通过 Obsidian requestUrl 发送网络请求；
	 * 3. 严格全量 schema/内容校验，错误时保留原运行时与缓存并返回原因；
	 * 4. 检查版本是否已为最新（already-current）；
	 * 5. 构建完整候选 Map 与 ACMatcher 确保匹配机可用；
	 * 6. 执行可恢复持久化（备份原缓存、校验 .tmp、覆盖主缓存、清理 .tmp）；
	 * 7. 成功后无缝切换活动词典运行时并通知视图刷新。
	 */
	public async updateBasicDictionary(): Promise<DictUpdateResult> {
		if (this.isUpdatingDict) {
			return {
				status: 'failed',
				failureReason: 'concurrent_error',
				errorMessage: 'Another update is already in progress'
			};
		}

		this.isUpdatingDict = true;

		try {
			// 1. 发起网络请求获取远程字典
			let response;
			try {
				response = await requestUrl({
					url: BASIC_DICT_CONFIG.REMOTE_URL,
					method: 'GET',
					headers: { 'Accept': 'application/json' }
				});
			} catch (netErr) {
				return {
					status: 'failed',
					failureReason: 'network_error',
					errorMessage: netErr instanceof Error ? netErr.message : String(netErr)
				};
			}

			if (response.status !== 200) {
				return {
					status: 'failed',
					failureReason: 'network_error',
					errorMessage: `HTTP ${response.status}`
				};
			}

			// 2. 解析 JSON
			const jsonText = response.text;
			let parsed: unknown;
			try {
				parsed = JSON.parse(jsonText);
			} catch {
				return {
					status: 'failed',
					failureReason: 'corrupt_data',
					errorMessage: 'Failed to parse JSON response'
				};
			}

			// 3. 严格校验格式与内容（整体验收/拒绝）
			const validation = validateBasicWrongWordsJson(parsed, jsonText);
			if (!validation.valid || !validation.data) {
				return {
					status: 'failed',
					failureReason: 'validation_error',
					errorMessage: validation.error || 'Invalid dictionary format'
				};
			}

			const data = validation.data;

			// 4. 检查是否已经是最新版本
			if (this.basicDictInfo.source === 'online_cache' && this.basicDictInfo.version === data.dictionaryVersion) {
				return {
					status: 'already-current',
					version: data.dictionaryVersion,
					count: data.entries.length,
					updatedAt: data.updatedAt,
					isLarge: validation.isLarge
				};
			}

			// 5. 构建候选 Map 与 候选 ACMatcher
			const candidateBuiltinMap = new Map<string, WrongWordEntry>();
			for (const entry of data.entries) {
				candidateBuiltinMap.set(entry.word, entry);
			}

			const candidateMatcher = new ACMatcher();
			for (const [word, entry] of this.dictData.userWrongWords.entries()) {
				candidateMatcher.insert(word, 'user_wrong', `user_wrong_${word}`, entry);
			}
			if (this.plugin.settings.proofreading?.enableBuiltin !== false) {
				for (const [word, entry] of candidateBuiltinMap.entries()) {
					if (!this.dictData.userWrongWords.has(word)) {
						candidateMatcher.insert(word, 'builtin', `builtin_wrong_${word}`, entry);
					}
				}
			}
			for (const [word, entry] of this.dictData.sensitiveWords.entries()) {
				candidateMatcher.insert(word, 'user_sensitive', `sensitive_${word}`, entry);
			}
			for (const [word, entry] of this.dictData.synonyms.entries()) {
				candidateMatcher.insert(word, 'user_synonym', `synonym_${word}`, entry);
			}
			candidateMatcher.build();

			// 6. 可恢复持久化
			const adapter = this.app.vault.adapter;
			const cachePath = this.getBasicDictCachePath();
			const backupPath = this.getBasicDictBackupPath();
			const tempPath = this.getBasicDictTempPath();

			let backupCreated = false;
			try {
				await this.ensureDictDir();
				if (await adapter.exists(cachePath)) {
					const existingContent = await adapter.read(cachePath);
					await adapter.write(backupPath, existingContent);
					backupCreated = true;
				}
				await adapter.write(tempPath, jsonText);
				const persistedTemp = await adapter.read(tempPath);
				const persistedValidation = validateBasicWrongWordsJson(JSON.parse(persistedTemp), persistedTemp);
				if (!persistedValidation.valid) {
					throw new Error('Temporary dictionary cache verification failed');
				}
				await adapter.write(cachePath, persistedTemp);
			} catch (diskErr) {
				if (backupCreated) {
					try {
						const bakContent = await adapter.read(backupPath);
						await adapter.write(cachePath, bakContent);
					} catch {
						// safe
					}
				}
				return {
					status: 'failed',
					failureReason: 'disk_error',
					errorMessage: diskErr instanceof Error ? diskErr.message : String(diskErr)
				};
			}

			try {
				if (await adapter.exists(tempPath)) {
					await adapter.remove(tempPath);
				}
			} catch (cleanupError) {
				Logger.warn('[ProofreadingManager] 清理基础错词库临时文件失败:', cleanupError);
			}

			// 7. 切换活动运行时
			if (this.plugin.settings.proofreading?.enableBuiltin !== false) {
				this.dictData.builtinWrongWords = candidateBuiltinMap;
			}
			this.acMatcher = candidateMatcher;
			this.updateCachedMaxPatternLength();
			this.basicDictInfo = {
				source: 'online_cache',
				version: data.dictionaryVersion,
				count: data.entries.length,
				updatedAt: data.updatedAt,
				isLarge: validation.isLarge
			};

			this.notifyRefresh();

			return {
				status: 'updated',
				version: data.dictionaryVersion,
				count: data.entries.length,
				updatedAt: data.updatedAt,
				isLarge: validation.isLarge
			};
		} finally {
			this.isUpdatingDict = false;
		}
	}

	// ==========================================
	// DeDiDe 词典功能
	// ==========================================

	public getDeDiDeDictInfo(): BasicDictInfo {
		return { ...this.dedideDictInfo };
	}

	private getDeDiDeDictCachePath(): string {
		return `${this.getDictDir()}/${DEDIDE_DICT_CONFIG.CACHE_FILENAME}`;
	}

	private getDeDiDeDictBackupPath(): string {
		return `${this.getDictDir()}/${DEDIDE_DICT_CONFIG.CACHE_FILENAME}.bak`;
	}

	private getDeDiDeDictTempPath(): string {
		return `${this.getDictDir()}/${DEDIDE_DICT_CONFIG.CACHE_FILENAME}.tmp`;
	}

	private async loadDeDiDeLexiconCache(): Promise<{ lexicon: DeDiDeLexicon; info: BasicDictInfo } | null> {
		const adapter = this.app.vault.adapter;
		const cachePath = this.getDeDiDeDictCachePath();
		const backupPath = this.getDeDiDeDictBackupPath();

		try {
			if (await adapter.exists(cachePath)) {
				const content = await adapter.read(cachePath);
				const parsed: unknown = JSON.parse(content);
				const val = validateDeDiDeLexiconJson(parsed, content);
				if (val.valid && val.data) {
					return {
						lexicon: val.data,
						info: {
							source: 'online_cache',
							version: val.data.dictionaryVersion,
							count: val.count || 0,
							updatedAt: val.data.updatedAt,
							isLarge: val.isLarge
						}
					};
				} else {
					Logger.warn('[ProofreadingManager] DeDiDe词典缓存校验失败:', val.error);
				}
			}
		} catch (err) {
			Logger.error('[ProofreadingManager] 读取DeDiDe词典主缓存失败:', err);
		}

		try {
			if (await adapter.exists(backupPath)) {
				const bakContent = await adapter.read(backupPath);
				const bakParsed: unknown = JSON.parse(bakContent);
				const bakVal = validateDeDiDeLexiconJson(bakParsed, bakContent);
				if (bakVal.valid && bakVal.data) {
					Logger.info('[ProofreadingManager] 从备份文件恢复DeDiDe词典缓存');
					try {
						await this.ensureDictDir();
						await adapter.write(cachePath, bakContent);
					} catch (writeErr) {
						Logger.warn('[ProofreadingManager] 写回恢复的主缓存失败:', writeErr);
					}
					return {
						lexicon: bakVal.data,
						info: {
							source: 'online_cache',
							version: bakVal.data.dictionaryVersion,
							count: bakVal.count || 0,
							updatedAt: bakVal.data.updatedAt,
							isLarge: bakVal.isLarge
						}
					};
				}
			}
		} catch (bakErr) {
			Logger.error('[ProofreadingManager] 读取DeDiDe词典备份失败:', bakErr);
		}

		return null;
	}

	public async updateDeDiDeLexicon(): Promise<DictUpdateResult> {
		if (this.isUpdatingDeDiDe) {
			return {
				status: 'failed',
				failureReason: 'concurrent_error',
				errorMessage: 'Another update is already in progress'
			};
		}

		this.isUpdatingDeDiDe = true;

		try {
			let response;
			try {
				response = await requestUrl({
					url: DEDIDE_DICT_CONFIG.REMOTE_URL,
					method: 'GET',
					headers: { 'Accept': 'application/json' }
				});
			} catch (netErr) {
				return {
					status: 'failed',
					failureReason: 'network_error',
					errorMessage: netErr instanceof Error ? netErr.message : String(netErr)
				};
			}

			if (response.status !== 200) {
				return {
					status: 'failed',
					failureReason: 'network_error',
					errorMessage: `HTTP ${response.status}`
				};
			}

			const jsonText = response.text;
			let parsed: unknown;
			try {
				parsed = JSON.parse(jsonText);
			} catch {
				return {
					status: 'failed',
					failureReason: 'corrupt_data',
					errorMessage: 'Failed to parse JSON response'
				};
			}

			const validation = validateDeDiDeLexiconJson(parsed, jsonText);
			if (!validation.valid || !validation.data) {
				return {
					status: 'failed',
					failureReason: 'validation_error',
					errorMessage: validation.error || 'Invalid dictionary format'
				};
			}

			const data = validation.data;

			if (this.dedideDictInfo.source === 'online_cache' && this.dedideDictInfo.version === data.dictionaryVersion) {
				return {
					status: 'already-current',
					version: data.dictionaryVersion,
					count: validation.count || 0,
					updatedAt: data.updatedAt,
					isLarge: validation.isLarge
				};
			}

			const wasDownloaded = this.dedideDictInfo.source === 'online_cache';

			// 首次下载绝不自动启用：即使 settings 异常预存了 true 且此前无下载，首次 update 也不构造 scanner
			if (!wasDownloaded && this.plugin.settings.proofreading) {
				this.plugin.settings.proofreading.enableDeDiDe = false;
				await this.plugin.saveSettings();
			}

			const candidateScanner = wasDownloaded && this.plugin.settings.proofreading?.enableDeDiDe
				? new DeDiDeScanner(data)
				: null;

			const adapter = this.app.vault.adapter;
			const cachePath = this.getDeDiDeDictCachePath();
			const backupPath = this.getDeDiDeDictBackupPath();
			const tempPath = this.getDeDiDeDictTempPath();

			let backupCreated = false;
			try {
				await this.ensureDictDir();
				if (await adapter.exists(cachePath)) {
					const existingContent = await adapter.read(cachePath);
					await adapter.write(backupPath, existingContent);
					backupCreated = true;
				}
				await adapter.write(tempPath, jsonText);
				const persistedTemp = await adapter.read(tempPath);
				const persistedValidation = validateDeDiDeLexiconJson(JSON.parse(persistedTemp), persistedTemp);
				if (!persistedValidation.valid) {
					throw new Error('Temporary dictionary cache verification failed');
				}
				await adapter.write(cachePath, persistedTemp);
			} catch (diskErr) {
				if (backupCreated) {
					try {
						const bakContent = await adapter.read(backupPath);
						await adapter.write(cachePath, bakContent);
					} catch {
						// safe
					}
				}
				return {
					status: 'failed',
					failureReason: 'disk_error',
					errorMessage: diskErr instanceof Error ? diskErr.message : String(diskErr)
				};
			}

			try {
				if (await adapter.exists(tempPath)) {
					await adapter.remove(tempPath);
				}
			} catch (cleanupError) {
				Logger.warn('[ProofreadingManager] 清理DeDiDe词典临时文件失败:', cleanupError);
			}

			this.dedideScanner = candidateScanner;
			this.dedideDictInfo = {
				source: 'online_cache',
				version: data.dictionaryVersion,
				count: validation.count || 0,
				updatedAt: data.updatedAt,
				isLarge: validation.isLarge
			};

			this.notifyRefresh();

			return {
				status: 'updated',
				version: data.dictionaryVersion,
				count: validation.count || 0,
				updatedAt: data.updatedAt,
				isLarge: validation.isLarge
			};
		} finally {
			this.isUpdatingDeDiDe = false;
		}
	}
}
