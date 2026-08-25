/**
 * 校对功能核心类型定义
 */

/**
 * 校对设置接口
 */
export interface ProofreadingSettings {
	/** 是否启用校对功能 */
	enabled: boolean;
	/** 词典目录路径（相对于 vault 根目录） */
	dictionaryPath: string;
	/** 是否启用内置错词库 */
	enableBuiltin: boolean;
	/** 是否启用用户自定义错词词典 */
	enableUserDict: boolean;
	/** 是否启用敏感词检测 */
	enableSensitive: boolean;
	/** 是否启用近义词提示 */
	enableSynonyms: boolean;
	/** 是否启用地/得/的保守语法检测 */
	enableDeDiDe: boolean;
	/** 是否启用标点符号检查 */
	enablePunctuation?: boolean;
	/** 是否全库生效（对所有 Markdown 文档开启校对，不再限制于工作区或章节） */
	enableGlobal?: boolean;
}

/** 诊断类型 */
export type ProofreadingType = 'wrong_word' | 'sensitive' | 'synonym' | 'grammar' | 'punctuation';

/** 诊断严重级别 */
export type ProofreadingSeverity = 'error' | 'warning' | 'info';

/** 诊断置信度 */
export type ProofreadingConfidence = 'high' | 'medium' | 'low';

/** 诊断来源 */
export type ProofreadingSource = 'builtin' | 'user_wrong' | 'user_sensitive' | 'user_synonym' | 'dedide' | 'punctuation';

/**
 * 统一校对诊断结果接口
 * 采用 UTF-16 偏移量
 */
export interface ProofreadingDiagnostic {
	/** 规则唯一 ID */
	ruleId: string;
	/** 诊断类型 */
	type: ProofreadingType;
	/** UTF-16 起始偏移量 */
	from: number;
	/** UTF-16 结束偏移量 */
	to: number;
	/** 原文匹配文本 */
	original: string;
	/** 严重级别 */
	severity: ProofreadingSeverity;
	/** 置信度 */
	confidence: ProofreadingConfidence;
	/** 诊断提示消息 */
	message: string;
	/** 替换建议列表 */
	suggestions: string[];
	/** 诊断来源 */
	source: ProofreadingSource;
}

/** 兼容别名 */
export type MatchResult = ProofreadingDiagnostic;

/** 错词词条 */
export interface WrongWordEntry {
	word: string;
	suggestion: string;
	description: string;
}

/** 近义词组 */
export interface SynonymGroup {
	words: string[];
	description: string;
}

/** 敏感词词条（建议支持多个，如“、、,”分隔） */
export interface SensitiveWordEntry {
	word: string;
	suggestions: string[];
	severity: 'warning' | 'info';
	exceptions: string[];
	description: string;
}

/** 词典解析全量数据 */
export interface ParsedDictData {
	userWrongWords: Map<string, WrongWordEntry>;
	builtinWrongWords: Map<string, WrongWordEntry>;
	synonyms: Map<string, { group: SynonymGroup; suggestions: string[] }>;
	sensitiveWords: Map<string, SensitiveWordEntry>;
}

/** 基础错词库 JSON 格式规范 */
export interface BasicWrongWordsData {
	schemaVersion: number;
	dictionaryVersion: string;
	updatedAt: string;
	license?: string;
	source?: string;
	entries: WrongWordEntry[];
}

/** DeDiDe 规则词典 JSON 格式规范 */
export interface DeDiDeLexicon {
	schemaVersion: number;
	dictionaryVersion: string;
	updatedAt: string;
	license: string;
	source?: string;
	adverbialModifiers: string[];
	actionVerbs: string[];
	actionNominalFollowers?: string[];
	degreePredicates: string[];
	degreeComplementPrefixes: string[];
	degreeComplementAdjectives: string[];
	degreeComplementPhrases: string[];
	comparativeAdjectives: string[];
	comparativeWords: string[];
	nounLookaheadExclusions: string[];
	attributiveAdjectives: string[];
	attributiveNouns: string[];
}

/** 基础错词库 / 规则词典元数据信息 */
export interface BasicDictInfo {
	source: 'online_cache' | 'not_downloaded';
	version: string;
	count: number;
	updatedAt?: string;
	isLarge?: boolean;
}

/** 基础错词库更新状态 */
export type DictUpdateStatus = 'updated' | 'already-current' | 'failed';

/** 基础错词库更新失败原因 */
export type DictUpdateFailureReason =
	| 'network_error'
	| 'validation_error'
	| 'disk_error'
	| 'concurrent_error'
	| 'corrupt_data';

/** 基础错词库更新结果接口 */
export interface DictUpdateResult {
	status: DictUpdateStatus;
	version?: string;
	count?: number;
	updatedAt?: string;
	isLarge?: boolean;
	errorMessage?: string;
	failureReason?: DictUpdateFailureReason;
}

/** 基础错词库 / 规则词典校验结果 */
export interface DictValidationResult<T = BasicWrongWordsData> {
	valid: boolean;
	error?: string;
	data?: T;
	isLarge?: boolean;
	byteSize?: number;
	count?: number;
}
