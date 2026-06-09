/**
 * 配置验证工具函数
 * 提供端口号、文件路径、数值范围等验证功能
 */

/**
 * 验证结果接口（统一定义，全项目唯一）
 * 
 * - SettingsManager 批量验证时使用 errors 数组收集多个错误
 * - 单项验证函数返回时 errors 数组长度为 0 或 1
 */
export interface ValidationResult {
	/** 验证是否通过 */
	valid: boolean;
	/** 错误消息列表 */
	errors: string[];
}

/**
 * 验证端口号是否有效
 * 端口号必须在 1024-65535 之间
 * @param port - 端口号
 * @returns 验证结果
 * 
 * @example
 * ```typescript
 * validatePort(24816) // { valid: true, errors: [] }
 * validatePort(80) // { valid: false, errors: ['端口号必须在 1024-65535 之间'] }
 * ```
 */
export function validatePort(port: number): ValidationResult {
	if (port < 1024 || port > 65535) {
		return {
			valid: false,
			errors: ['端口号必须在 1024-65535 之间']
		};
	}
	return { valid: true, errors: [] };
}

/**
 * 验证文件路径是否有效
 * @param path - 文件路径
 * @returns 验证结果
 */
export function validatePath(path: string): ValidationResult {
	if (!path || path.trim().length === 0) {
		return {
			valid: false,
			errors: ['路径不能为空']
		};
	}
	return { valid: true, errors: [] };
}

/**
 * 验证数值是否在指定范围内
 * @param value - 要验证的数值
 * @param min - 最小值
 * @param max - 最大值
 * @param fieldName - 字段名称(用于错误消息)
 * @returns 验证结果
 */
export function validateRange(
	value: number,
	min: number,
	max: number,
	fieldName: string
): ValidationResult {
	if (value < min || value > max) {
		return {
			valid: false,
			errors: [`${fieldName}必须在 ${min} 到 ${max} 之间`]
		};
	}
	return { valid: true, errors: [] };
}

/**
 * 验证不透明度值是否有效
 * 不透明度必须在 0.1-1.0 之间
 * @param opacity - 不透明度值
 * @returns 验证结果
 */
export function validateOpacity(opacity: number): ValidationResult {
	return validateRange(opacity, 0.1, 1.0, '不透明度');
}

/**
 * 验证空闲超时阈值是否有效
 * 超时时间必须在 10-3600 秒之间
 * @param timeoutSeconds - 超时时间(秒)
 * @returns 验证结果
 */
export function validateIdleTimeout(timeoutSeconds: number): ValidationResult {
	return validateRange(timeoutSeconds, 10, 3600, '空闲超时');
}

/**
 * 转义正则表达式特殊字符（公共工具函数）
 * 用于将用户输入安全地嵌入到正则表达式中
 * @param s - 要转义的字符串
 * @returns 转义后的字符串
 */
export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 安全解析 Frontmatter 中的目标字数
 * 兼容数字、字符串类型，处理 NaN 情况 [M-T4]
 * @param value - frontmatter 中的原始值
 * @returns 解析后的数字，无效时返回 0
 */
export function parseGoal(value: unknown): number {
	if (typeof value === 'number') return Math.max(0, Math.floor(value));
	if (typeof value === 'string') {
		const parsed = parseInt(value, 10);
		return isNaN(parsed) ? 0 : Math.max(0, parsed);
	}
	return 0;
}
