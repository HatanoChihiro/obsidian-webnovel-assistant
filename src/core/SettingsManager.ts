import { Logger } from '../utils/Logger';
import type { Plugin} from 'obsidian';
import { t } from '../i18n';
import { detectLocale } from '../i18n';
import { getLocalizedDefaults } from '../i18n/data-keys';
import { Notice } from 'obsidian';
import type { AccurateCountSettings, ImmersiveModeSettings, ObsSettings } from '../types/settings';
import type { TaskSettings } from '../types/task';
import { VALIDATION_RULES, FLAT_OBS_KEYS, FLAT_IMMERSIVE_KEYS } from '../constants';
import type { ValidationResult } from '../utils/validation';
import { SerializedWriter } from '../utils/SerializedWriter';
import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * 验证规则接口（支持嵌套路径）
 */
interface ValidationRule {
	path: string;
	validate: (value: unknown) => boolean;
	errorMessage: string;
}

/**
 * 需要保留的旧数据键（不属于 AccurateCountSettings 但需要保留用于兼容）
 */
const STALE_KEYS = new Set([
	'cacheData', 'historyData', 'dailyHistory', 'openNotes',
	...FLAT_OBS_KEYS, ...FLAT_IMMERSIVE_KEYS
]);

/**
 * 设置管理器
 * 负责设置的加载、保存、验证和迁移
 */
export class SettingsManager {
	private plugin: Plugin;
	private settings: AccurateCountSettings;
	private defaultSettings: AccurateCountSettings;

	private writer = new SerializedWriter();

	private validationRules: ValidationRule[] = [
		{
			path: 'obs.obsPort',
			validate: (port) => {
				const p = Number(port);
				return !isNaN(p) && p >= VALIDATION_RULES.PORT_RANGE.min && p <= VALIDATION_RULES.PORT_RANGE.max;
			},
			errorMessage: t('notice.port-range-invalid', { min: String(VALIDATION_RULES.PORT_RANGE.min), max: String(VALIDATION_RULES.PORT_RANGE.max) })
		},
		{
			path: 'idleTimeoutThreshold',
			validate: (timeout) => {
				const t = Number(timeout);
				const min = VALIDATION_RULES.IDLE_TIMEOUT_RANGE.min * 1000;
				const max = VALIDATION_RULES.IDLE_TIMEOUT_RANGE.max * 1000;
				return !isNaN(t) && t >= min && t <= max;
			},
			errorMessage: t('validation.range', { fieldName: t('validation.idle-timeout'), min: String(VALIDATION_RULES.IDLE_TIMEOUT_RANGE.min), max: String(VALIDATION_RULES.IDLE_TIMEOUT_RANGE.max) })
		},
		{
			path: 'noteOpacity',
			validate: (opacity) => {
				const o = Number(opacity);
				return !isNaN(o) && o >= VALIDATION_RULES.OPACITY_RANGE.min && o <= VALIDATION_RULES.OPACITY_RANGE.max;
			},
			errorMessage: t('validation.range', { fieldName: t('validation.opacity'), min: String(VALIDATION_RULES.OPACITY_RANGE.min), max: String(VALIDATION_RULES.OPACITY_RANGE.max) })
		},
		{
			path: 'obs.obsOverlayOpacity',
			validate: (opacity) => {
				const o = Number(opacity);
				return !isNaN(o) && o >= 0 && o <= VALIDATION_RULES.OPACITY_RANGE.max;
			},
			errorMessage: t('validation.range', { fieldName: t('validation.opacity'), min: '0', max: String(VALIDATION_RULES.OPACITY_RANGE.max) })
		},
		{
			path: 'defaultGoal',
			validate: (goal) => {
				const g = Number(goal);
				return !isNaN(g) && g >= VALIDATION_RULES.MIN_GOAL;
			},
			errorMessage: t('validation.please-fill', { fieldName: t('setting.default-chapter-goal') })
		}
	];

	constructor(plugin: Plugin, defaultSettings: AccurateCountSettings) {
		this.plugin = plugin;
		this.defaultSettings = this.adjustDefaultsForLocale(defaultSettings);
		this.settings = { ...this.defaultSettings };
	}

	/**
	 * 根据当前语言调整默认设置（仅影响首次安装时的默认值，不覆盖已有用户数据）
	 */
	private adjustDefaultsForLocale(defaults: AccurateCountSettings): AccurateCountSettings {
		const locale = detectLocale();
		if (locale === 'zh-CN') return defaults;

		const adjusted = { ...defaults };
		const localized = getLocalizedDefaults(locale);

		// 调整文件名/文件夹名默认值
		adjusted.novelInfo = { ...defaults.novelInfo, fileName: localized.novelInfoFileName };
		adjusted.foreshadowing = { ...defaults.foreshadowing, fileName: localized.foreshadowingFileName };
		adjusted.timeline = { ...defaults.timeline, fileName: localized.timelineFileName };
		adjusted.task = { ...defaults.task, fileName: localized.taskFileName };
		adjusted.loreFolderName = localized.loreFolderName;

		// 调整标签/类型默认值
		adjusted.foreshadowing = { ...adjusted.foreshadowing, defaultTags: localized.defaultTags };
		adjusted.timeline = { ...adjusted.timeline, defaultTypes: localized.defaultTypes };

		// 调整章节命名规则默认值
		if (adjusted.chapterNamingRules) {
			// 对于非中文环境，提供英文版本的默认规则，并默认启用英文章节和全能括号
			adjusted.chapterNamingRules = [
				{ name: 'Arabic Numerals (Chinese Format)', pattern: '^(?:第(\\d+)[章节回卷部册篇]?|第?(\\d+)[章节回卷部册篇])', enabled: false },
				{ name: 'Chinese Numerals (Chinese Format)', pattern: '^(?:第([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)[章节回卷部册篇]?|第?([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)[章节回卷部册篇])', enabled: false },
				{ name: 'Pure Numbers & Titles (1, 01, 001 Title)', pattern: '^(\\d+)(?:[ \\-].*)?$', enabled: true },
				{ name: 'English Chapters (Chapter 1, Ch.1)', pattern: '^[Cc]h(?:apter)?\\.?\\s*(\\d+)', enabled: true },
				{ name: 'Universal Brackets ( (1), 【30】 )', pattern: '^[（\\(【「{]([0-9零一二三四五六七八九十百千万]+)[）\\)】」}]', enabled: true },
			];
		}
		return adjusted;
	}

	async loadSettings(): Promise<AccurateCountSettings> {
		try {
			const data: unknown = await this.plugin.loadData();

			this.settings = this.mergeSettings((data || {}) as Record<string, unknown>);
			this.settings = this.migrateSettings(this.settings, data);

			// 从内存对象中剥离扁平键（deepMerge 会把旧数据的扁平键合并为顶层属性）
			this.stripStaleKeys(this.settings as unknown as Record<string, unknown>);

			const validation = this.validateSettings(this.settings);
			if (!validation.valid) {
				Logger.warn('[SettingsManager] 设置验证失败:', validation.errors);
				this.settings = this.fixInvalidSettings(this.settings);
				await this.saveSettings();
			}

			return this.settings;
		} catch (error) {
			Logger.error('[SettingsManager] 加载设置失败:', error);
			new Notice(t('notice.load-settings-failed'));
			this.settings = this.mergeSettings({});
			return this.settings;
		}
	}

	async saveSettings(): Promise<void> {
		return this.writer.enqueue(async () => {
			try {
				const pluginSettings = (this.plugin as unknown as WebNovelAssistantPlugin).settings;
				if (pluginSettings) {
					this.settings = pluginSettings;
				}
				// 剥离可能残留的扁平键（用户直接修改 settings 对象不会自动清理）
				this.stripStaleKeys(this.settings as unknown as Record<string, unknown>);

				// 读取旧数据，只保留不属于 STALE_KEYS 的字段
				const data = (await this.plugin.loadData() || {}) as Record<string, unknown>;
				const cleanedData: Record<string, unknown> = {};
				for (const key of Object.keys(data)) {
					if (!STALE_KEYS.has(key)) {
						cleanedData[key] = data[key];
					}
				}

				const newData = { ...cleanedData, ...this.settings };
				await this.plugin.saveData(newData);
			} catch (error) {
				Logger.error('[SettingsManager] 保存设置失败:', error);
				new Notice(t('notice.save-settings-failed'));
				throw error;
			}
		});
	}

	async flush(): Promise<void> {
		await this.writer.flush();
	}

	private getNestedValue(obj: unknown, path: string): unknown {
		const parts = path.split('.');
		let current: unknown = obj;
		for (const part of parts) {
			if (current === null || current === undefined || typeof current !== 'object') {
				return undefined;
			}
			current = (current as Record<string, unknown>)[part];
		}
		return current;
	}

	private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
		const parts = path.split('.');
		let current: Record<string, unknown> = obj;
		for (let i = 0; i < parts.length - 1; i++) {
			if (!(parts[i] in current) || typeof current[parts[i]] !== 'object' || current[parts[i]] === null) {
				current[parts[i]] = {};
			}
			current = current[parts[i]] as Record<string, unknown>;
		}
		current[parts[parts.length - 1]] = value;
	}

	validateSettings(settings: Partial<AccurateCountSettings>): ValidationResult {
		const errors: string[] = [];
		for (const rule of this.validationRules) {
			const value = this.getNestedValue(settings, rule.path);
			if (value !== undefined && !rule.validate(value)) {
				errors.push(rule.errorMessage);
			}
		}
		return { valid: errors.length === 0, errors };
	}

	private fixInvalidSettings(settings: AccurateCountSettings): AccurateCountSettings {
		const fixed = JSON.parse(JSON.stringify(settings)) as AccurateCountSettings;
		for (const rule of this.validationRules) {
			const value = this.getNestedValue(fixed, rule.path);
			if (value !== undefined && !rule.validate(value)) {
				const defaultValue = this.getNestedValue(this.defaultSettings, rule.path);
				this.setNestedValue(
					fixed as unknown as Record<string, unknown>,
					rule.path,
					defaultValue
				);
				const formatVal = (v: unknown): string => {
					if (typeof v === 'string') return v;
					if (typeof v === 'number' || typeof v === 'boolean') return String(v);
					return JSON.stringify(v);
				};
				const strVal = formatVal(value);
				const strDefault = formatVal(defaultValue);
				Logger.warn(`[SettingsManager] 修复无效设置: ${rule.path} = ${strVal} -> ${strDefault}`);
			}
		}
		return fixed;
	}

	/**
	 * 从设置对象中剥离已废弃的扁平键
	 * deepMerge 会把旧数据的扁平键合并为顶层属性（TS看不见但JS能spread），必须显式清理
	 */
	private stripStaleKeys(obj: Record<string, unknown>): void {
		for (const key of STALE_KEYS) {
			if (key in obj) {
				delete obj[key];
			}
		}
	}

	private deepMerge<T extends Record<string, unknown>>(defaults: T, source: Partial<T>): T {
		const result = { ...defaults };
		for (const key of Object.keys(source) as (keyof T)[]) {
			const srcVal = source[key];
			const defVal = defaults[key];
			if (
				srcVal !== null &&
				typeof srcVal === 'object' &&
				!Array.isArray(srcVal) &&
				defVal !== null &&
				typeof defVal === 'object' &&
				!Array.isArray(defVal)
			) {
				result[key] = this.deepMerge(
					defVal as Record<string, unknown>,
					srcVal
				) as T[keyof T];
			} else if (srcVal !== undefined && srcVal !== null) {
				result[key] = srcVal as T[keyof T];
			}
		}
		return result;
	}

	/**
	 * 将默认设置与来源数据合并，返回完整的 AccurateCountSettings。
	 * 封装 deepMerge 的类型断言链，使调用方无需重复 as unknown as。
	 */
	private mergeSettings(source: Record<string, unknown>): AccurateCountSettings {
		return this.deepMerge(
			this.defaultSettings as unknown as Record<string, unknown>,
			source
		) as unknown as AccurateCountSettings;
	}

	private migrateSettings(
		settings: AccurateCountSettings,
		oldData: unknown
	): AccurateCountSettings {
		const migrated = this.deepMerge(this.defaultSettings as unknown as Record<string, unknown>, settings as unknown as Record<string, unknown>) as unknown as AccurateCountSettings;

		if (oldData && typeof oldData === 'object' && 'ranking' in oldData) {
			const oldRanking = (oldData as Record<string, unknown>).ranking;
			if (oldRanking && typeof oldRanking === 'object') {
				migrated.task = this.deepMerge(
					this.defaultSettings.task as unknown as Record<string, unknown>,
					oldRanking
				) as unknown as TaskSettings;
			}
		}

		if (oldData && typeof oldData === 'object' && 'immersiveShowRankingProgress' in oldData) {
			const oldVal = (oldData as Record<string, unknown>).immersiveShowRankingProgress;
			if (oldVal !== undefined) {
				migrated.immersive.immersiveShowTaskProgress = Boolean(oldVal);
			}
		}

		if (oldData && typeof oldData === 'object' && 'noteColors' in oldData) {
			const noteColors = (oldData as { noteColors?: string[] }).noteColors;
			if (noteColors && Array.isArray(noteColors) && (!migrated.noteThemes || migrated.noteThemes.length === 0)) {
				migrated.noteThemes = noteColors.map((color: string) => ({
					bg: color,
					text: '#2C3E50'
				}));
			}
		}

		// 清理旧版 homepagePath 默认值，让 getHomepageFilePath() 动态推导到工作区下
		if (migrated.homepagePath === '创作主页.md') {
			migrated.homepagePath = '';
		}

		// 保证排版最大行宽默认非空，默认 700px
		if (migrated.typography) {
			if (!migrated.typography.maxLineWidth || migrated.typography.maxLineWidth.trim() === '') {
				migrated.typography.maxLineWidth = '700px';
			}
		}

		// 迁移：将旧的 timeline-view 组件 ID 替换为 wn-timeline-view
		const replaceTimelineView = (slots: string[]) => {
			const idx = slots.indexOf('timeline-view');
			if (idx !== -1) slots[idx] = 'wn-timeline-view';
		};
		if (migrated.immersive) {
			replaceTimelineView(migrated.immersive.immersiveTopSlots);
			replaceTimelineView(migrated.immersive.immersiveBottomSlots);
			replaceTimelineView(migrated.immersive.immersiveLeftSlots);
			replaceTimelineView(migrated.immersive.immersiveRightSlots);
		}

		// 清理弃用的沉浸模式设置字段
		if (migrated.immersive) {
			const obsoleteKeys = [
				'immersiveShowChapterList',
				'immersiveShowReference',
				'immersiveShowStickyNotes',
				'immersiveShowForeshadowing',
				'immersiveShowTimeline',
				'immersivePanelPosition',
				'immersiveShowRankingProgress'
			];
			for (const key of obsoleteKeys) {
				if (key in migrated.immersive) {
					delete (migrated.immersive as unknown as Record<string, unknown>)[key];
				}
			}

			// Migrate corkboard-view back to webnovel-corkboard for compatibility and remove deprecated webnovel-workbench from immersive slots
			const slotsKeys = ['immersiveTopSlots', 'immersiveBottomSlots', 'immersiveLeftSlots', 'immersiveRightSlots'] as const;
			for (const key of slotsKeys) {
				if (Array.isArray(migrated.immersive[key])) {
					migrated.immersive[key] = migrated.immersive[key]
						.map(slot => slot === 'corkboard-view' ? 'webnovel-corkboard' : slot)
						.filter(slot => slot !== 'webnovel-workbench');
				}
			}
		}

		if (oldData && typeof oldData === 'object') {
			const old = oldData as Record<string, unknown>;
			const immersiveKeys = FLAT_IMMERSIVE_KEYS;

			let hasFlatImmersive = false;
			for (const key of immersiveKeys) {
				if (key in old) {
					hasFlatImmersive = true;
					break;
				}
			}

			if (hasFlatImmersive) {
				const immersive: Partial<ImmersiveModeSettings> = {};
				for (const key of immersiveKeys) {
					if (key in old) {
						(immersive as Record<string, unknown>)[key] = old[key];
					}
				}
				migrated.immersive = this.deepMerge(
					this.defaultSettings.immersive as unknown as Record<string, unknown>,
					immersive
				) as unknown as ImmersiveModeSettings;
			}

			const obsKeys = FLAT_OBS_KEYS;

			let hasFlatObs = false;
			for (const key of obsKeys) {
				if (key in old) {
					hasFlatObs = true;
					break;
				}
			}

			if (hasFlatObs) {
				const obs: Partial<ObsSettings> = {};
				for (const key of obsKeys) {
					if (key in old) {
						(obs as Record<string, unknown>)[key] = old[key];
					}
				}
				migrated.obs = this.deepMerge(
					this.defaultSettings.obs as unknown as Record<string, unknown>,
					obs
				) as unknown as ObsSettings;
			}
		}

		return migrated;
	}

	getSettings(): AccurateCountSettings {
		return this.settings;
	}

	async updateSettings(partial: Partial<AccurateCountSettings>): Promise<void> {
		const plugin = this.plugin as unknown as WebNovelAssistantPlugin;
		const current = plugin.settings || this.settings;
		const updated = this.deepMerge(
			current as unknown as Record<string, unknown>,
			partial
		) as unknown as AccurateCountSettings;
		const validation = this.validateSettings(updated);
		if (!validation.valid) {
			throw new Error(`设置验证失败: ${validation.errors.join(', ')}`);
		}

		this.settings = updated;
		plugin.settings = updated;
		await this.saveSettings();
	}

	async resetToDefaults(): Promise<void> {
		this.settings = JSON.parse(JSON.stringify(this.defaultSettings)) as AccurateCountSettings;
		(this.plugin as unknown as WebNovelAssistantPlugin).settings = this.settings;
		await this.saveSettings();
	}
}
