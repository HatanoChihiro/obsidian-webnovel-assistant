import type { Plugin} from 'obsidian';
import { Notice } from 'obsidian';
import type { AccurateCountSettings, ImmersiveModeSettings, ObsSettings } from '../types/settings';
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
			errorMessage: `端口号必须在 ${VALIDATION_RULES.PORT_RANGE.min}-${VALIDATION_RULES.PORT_RANGE.max} 之间`
		},
		{
			path: 'idleTimeoutThreshold',
			validate: (timeout) => {
				const t = Number(timeout);
				const min = VALIDATION_RULES.IDLE_TIMEOUT_RANGE.min * 1000;
				const max = VALIDATION_RULES.IDLE_TIMEOUT_RANGE.max * 1000;
				return !isNaN(t) && t >= min && t <= max;
			},
			errorMessage: `空闲超时必须在 ${VALIDATION_RULES.IDLE_TIMEOUT_RANGE.min}-${VALIDATION_RULES.IDLE_TIMEOUT_RANGE.max} 秒之间`
		},
		{
			path: 'noteOpacity',
			validate: (opacity) => {
				const o = Number(opacity);
				return !isNaN(o) && o >= VALIDATION_RULES.OPACITY_RANGE.min && o <= VALIDATION_RULES.OPACITY_RANGE.max;
			},
			errorMessage: `便签不透明度必须在 ${VALIDATION_RULES.OPACITY_RANGE.min}-${VALIDATION_RULES.OPACITY_RANGE.max} 之间`
		},
		{
			path: 'obs.obsOverlayOpacity',
			validate: (opacity) => {
				const o = Number(opacity);
				return !isNaN(o) && o >= 0 && o <= VALIDATION_RULES.OPACITY_RANGE.max;
			},
			errorMessage: `OBS 叠加层不透明度必须在 0-${VALIDATION_RULES.OPACITY_RANGE.max} 之间`
		},
		{
			path: 'defaultGoal',
			validate: (goal) => {
				const g = Number(goal);
				return !isNaN(g) && g >= VALIDATION_RULES.MIN_GOAL;
			},
			errorMessage: '默认目标字数必须为非负数'
		}
	];

	constructor(plugin: Plugin, defaultSettings: AccurateCountSettings) {
		this.plugin = plugin;
		this.defaultSettings = defaultSettings;
		this.settings = { ...defaultSettings };
	}

	async loadSettings(): Promise<AccurateCountSettings> {
		try {
			const data = await this.plugin.loadData();

			this.settings = this.deepMerge(this.defaultSettings as unknown as Record<string, unknown>, ((data || {}) as Record<string, unknown>)) as unknown as AccurateCountSettings;
			this.settings = this.migrateSettings(this.settings, data);

			// 从内存对象中剥离扁平键（deepMerge 会把旧数据的扁平键合并为顶层属性）
			this.stripStaleKeys(this.settings as unknown as Record<string, unknown>);

			const validation = this.validateSettings(this.settings);
			if (!validation.valid) {
				console.warn('[SettingsManager] 设置验证失败:', validation.errors);
				this.settings = this.fixInvalidSettings(this.settings);
			}

			return this.settings;
		} catch (error) {
			console.error('[SettingsManager] 加载设置失败:', error);
			new Notice('加载设置失败，已使用默认设置');
			this.settings = this.deepMerge(this.defaultSettings as unknown as Record<string, unknown>, {}) as unknown as AccurateCountSettings;
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
				const data = await this.plugin.loadData() || {};
				const cleanedData: Record<string, unknown> = {};
				for (const key of Object.keys(data)) {
					if (!STALE_KEYS.has(key)) {
						(cleanedData as Record<string, unknown>)[key] = (data as Record<string, unknown>)[key];
					}
				}

				const newData = { ...cleanedData, ...this.settings };
				await this.plugin.saveData(newData);
			} catch (error) {
				console.error('[SettingsManager] 保存设置失败:', error);
				new Notice('保存设置失败，请检查磁盘空间和权限');
				throw error;
			}
		});
	}

	async flush(): Promise<void> {
		await this.writer.flush();
	}

	private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
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
				current[parts[i]] = {} as Record<string, unknown>;
			}
			current = current[parts[i]] as Record<string, unknown>;
		}
		current[parts[parts.length - 1]] = value;
	}

	validateSettings(settings: Partial<AccurateCountSettings>): ValidationResult {
		const errors: string[] = [];
		for (const rule of this.validationRules) {
			const value = this.getNestedValue(settings as Record<string, unknown>, rule.path);
			if (value !== undefined && !rule.validate(value)) {
				errors.push(rule.errorMessage);
			}
		}
		return { valid: errors.length === 0, errors };
	}

	private fixInvalidSettings(settings: AccurateCountSettings): AccurateCountSettings {
		const fixed = { ...settings };
		for (const rule of this.validationRules) {
			const value = this.getNestedValue(fixed as unknown as Record<string, unknown>, rule.path);
			if (value !== undefined && !rule.validate(value)) {
				const defaultValue = this.getNestedValue(this.defaultSettings as unknown as Record<string, unknown>, rule.path);
				this.setNestedValue(fixed as unknown as Record<string, unknown>, rule.path, defaultValue);
				console.warn(`[SettingsManager] 修复无效设置: ${rule.path} = ${value} -> ${defaultValue}`);
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
					srcVal as Record<string, unknown>
				) as T[keyof T];
			} else if (srcVal !== undefined && srcVal !== null) {
				result[key] = srcVal as T[keyof T];
			}
		}
		return result;
	}

	private migrateSettings(
		settings: AccurateCountSettings,
		oldData: unknown
	): AccurateCountSettings {
		const migrated = this.deepMerge(this.defaultSettings as unknown as Record<string, unknown>, settings as unknown as Record<string, unknown>) as unknown as AccurateCountSettings;

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

		// 清理弃用的沉浸模式设置字段
		if (migrated.immersive) {
			const obsoleteKeys = [
				'immersiveShowChapterList',
				'immersiveShowReference',
				'immersiveShowStickyNotes',
				'immersiveShowForeshadowing',
				'immersiveShowTimeline',
				'immersivePanelPosition'
			];
			for (const key of obsoleteKeys) {
				if (key in migrated.immersive) {
					delete (migrated.immersive as any)[key];
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
					immersive as unknown as Record<string, unknown>
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
					obs as unknown as Record<string, unknown>
				) as unknown as ObsSettings;
			}
		}

		return migrated;
	}

	getSettings(): AccurateCountSettings {
		return this.settings;
	}

	async updateSettings(partial: Partial<AccurateCountSettings>): Promise<void> {
		const validation = this.validateSettings(partial);
		if (!validation.valid) {
			throw new Error(`设置验证失败: ${validation.errors.join(', ')}`);
		}

		this.settings = this.deepMerge(this.settings as unknown as Record<string, unknown>, partial as unknown as Record<string, unknown>) as unknown as AccurateCountSettings;
		await this.saveSettings();
	}

	async resetToDefaults(): Promise<void> {
		this.settings = { ...this.defaultSettings };
		await this.saveSettings();
	}
}