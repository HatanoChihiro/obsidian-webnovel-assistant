import { Plugin } from 'obsidian';
import { AccurateCountSettings } from '../types/settings';
import { VALIDATION_RULES } from '../constants';

/**
 * 验证结果接口
 */
export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * 验证规则接口
 */
interface ValidationRule {
	field: keyof AccurateCountSettings;
	validate: (value: unknown) => boolean;
	errorMessage: string;
}

/**
 * 设置管理器
 * 负责设置的加载、保存、验证和迁移
 */
export class SettingsManager {
	private plugin: Plugin;
	private settings: AccurateCountSettings;
	private defaultSettings: AccurateCountSettings;

	// 验证规则
	private validationRules: ValidationRule[] = [
		{
			field: 'obsPort',
			validate: (port) => {
				const p = Number(port);
				return !isNaN(p) && p >= VALIDATION_RULES.PORT_RANGE.min && p <= VALIDATION_RULES.PORT_RANGE.max;
			},
			errorMessage: `端口号必须在 ${VALIDATION_RULES.PORT_RANGE.min}-${VALIDATION_RULES.PORT_RANGE.max} 之间`
		},
		{
			field: 'idleTimeoutThreshold',
			validate: (timeout) => {
				const t = Number(timeout);
				const min = VALIDATION_RULES.IDLE_TIMEOUT_RANGE.min * 1000;
				const max = VALIDATION_RULES.IDLE_TIMEOUT_RANGE.max * 1000;
				return !isNaN(t) && t >= min && t <= max;
			},
			errorMessage: `空闲超时必须在 ${VALIDATION_RULES.IDLE_TIMEOUT_RANGE.min}-${VALIDATION_RULES.IDLE_TIMEOUT_RANGE.max} 秒之间`
		},
		{
			field: 'noteOpacity',
			validate: (opacity) => {
				const o = Number(opacity);
				return !isNaN(o) && o >= VALIDATION_RULES.OPACITY_RANGE.min && o <= VALIDATION_RULES.OPACITY_RANGE.max;
			},
			errorMessage: `便签不透明度必须在 ${VALIDATION_RULES.OPACITY_RANGE.min}-${VALIDATION_RULES.OPACITY_RANGE.max} 之间`
		},
		{
			field: 'obsOverlayOpacity',
			validate: (opacity) => {
				const o = Number(opacity);
				return !isNaN(o) && o >= 0 && o <= VALIDATION_RULES.OPACITY_RANGE.max;
			},
			errorMessage: `OBS 叠加层不透明度必须在 0-${VALIDATION_RULES.OPACITY_RANGE.max} 之间`
		},
		{
			field: 'defaultGoal',
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

	/**
	 * 加载设置
	 */
	async loadSettings(): Promise<AccurateCountSettings> {
		try {
			const data = await this.plugin.loadData();
			
			// 与默认设置合并（深度合并，确保嵌套对象的新字段不丢失）
			this.settings = this.deepMerge(this.defaultSettings, data || {});
			
			// 数据迁移
			this.settings = this.migrateSettings(this.settings, data);
			
			// 验证设置
			const validation = this.validateSettings(this.settings);
			if (!validation.valid) {
				console.warn('[SettingsManager] 设置验证失败:', validation.errors);
				// 使用默认值替换无效值
				this.settings = this.fixInvalidSettings(this.settings);
			}
			
			console.log('[SettingsManager] 设置加载成功');
			return this.settings;
		} catch (error) {
			console.error('[SettingsManager] 加载设置失败:', error);
			
			// 导入 Notice 类型
			const { Notice } = require('obsidian');
			new Notice('加载设置失败，已使用默认设置');
			
			// 返回默认设置
			this.settings = { ...this.defaultSettings };
			return this.settings;
		}
	}

	/**
	 * 保存设置
	 */
	async saveSettings(): Promise<void> {
		try {
			// 从插件获取最新的设置（因为插件可能直接修改了 settings 对象）
			const pluginSettings = (this.plugin as any).settings;
			if (pluginSettings) {
				this.settings = pluginSettings;
			}
			await this.plugin.saveData(this.settings);
		} catch (error) {
			console.error('[SettingsManager] 保存设置失败:', error);
			
			// 导入 Notice 类型
			const { Notice } = require('obsidian');
			new Notice('保存设置失败，请检查磁盘空间和权限');
			
			throw error;
		}
	}

	/**
	 * 验证设置
	 */
	validateSettings(settings: Partial<AccurateCountSettings>): ValidationResult {
		const errors: string[] = [];

		for (const rule of this.validationRules) {
			const value = settings[rule.field];
			if (value !== undefined && !rule.validate(value)) {
				errors.push(rule.errorMessage);
			}
		}

		return {
			valid: errors.length === 0,
			errors
		};
	}

	/**
	 * 修复无效设置
	 */
	private fixInvalidSettings(settings: AccurateCountSettings): AccurateCountSettings {
		const fixed = { ...settings };

		for (const rule of this.validationRules) {
			const value = fixed[rule.field];
			if (value !== undefined && !rule.validate(value)) {
				// 使用默认值替换
				fixed[rule.field] = this.defaultSettings[rule.field] as never;
				console.warn(
					`[SettingsManager] 修复无效设置: ${rule.field} = ${value} -> ${this.defaultSettings[rule.field]}`
				);
			}
		}

		return fixed;
	}

	/**
	 * 深度合并两个对象，default 的字段优先级低于 source
	 * 对嵌套对象递归合并，确保新增字段有默认值
	 */
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
			} else if (srcVal !== undefined) {
				result[key] = srcVal as T[keyof T];
			}
		}
		return result;
	}

	/**
	 * 迁移旧版本设置
	 */
	private migrateSettings(
		settings: AccurateCountSettings,
		oldData: unknown
	): AccurateCountSettings {
		const migrated = { ...settings };

		// 迁移旧版便签颜色到新版主题
		if (oldData && typeof oldData === 'object' && 'noteColors' in oldData) {
			const noteColors = (oldData as { noteColors?: string[] }).noteColors;
			if (noteColors && Array.isArray(noteColors) && (!migrated.noteThemes || migrated.noteThemes.length === 0)) {
				migrated.noteThemes = noteColors.map((color: string) => ({
					bg: color,
					text: '#2C3E50'
				}));
				console.log('[SettingsManager] 已迁移旧版便签颜色到新版主题');
			}
		}

		return migrated;
	}

	/**
	 * 获取当前设置
	 */
	getSettings(): AccurateCountSettings {
		return this.settings;
	}

	/**
	 * 更新设置
	 */
	async updateSettings(partial: Partial<AccurateCountSettings>): Promise<void> {
		// 验证新设置
		const validation = this.validateSettings(partial);
		if (!validation.valid) {
			throw new Error(`设置验证失败: ${validation.errors.join(', ')}`);
		}

		// 更新设置
		this.settings = Object.assign(this.settings, partial);
		
		// 保存
		await this.saveSettings();
	}

	/**
	 * 重置为默认设置
	 */
	async resetToDefaults(): Promise<void> {
		this.settings = { ...this.defaultSettings };
		await this.saveSettings();
		console.log('[SettingsManager] 已重置为默认设置');
	}
}
