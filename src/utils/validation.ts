/**
 * 配置验证工具函数
 * 提供端口号、文件路径、数值范围等验证功能
 */

/**
 * 验证结果接口
 */
export interface ValidationResult {
	valid: boolean;
	error?: string;
}

/**
 * 验证端口号是否有效
 * 端口号必须在 1024-65535 之间
 * @param port - 端口号
 * @returns 验证结果
 * 
 * @example
 * ```typescript
 * validatePort(24816) // { valid: true }
 * validatePort(80) // { valid: false, error: '端口号必须在 1024-65535 之间' }
 * validatePort(70000) // { valid: false, error: '端口号必须在 1024-65535 之间' }
 * ```
 */
export function validatePort(port: number): ValidationResult {
	if (port < 1024 || port > 65535) {
		return {
			valid: false,
			error: '端口号必须在 1024-65535 之间'
		};
	}
	return { valid: true };
}

/**
 * 验证文件路径是否有效
 * @param path - 文件路径
 * @returns 验证结果
 * 
 * @example
 * ```typescript
 * validatePath('/valid/path') // { valid: true }
 * validatePath('') // { valid: false, error: '路径不能为空' }
 * ```
 */
export function validatePath(path: string): ValidationResult {
	if (!path || path.trim().length === 0) {
		return {
			valid: false,
			error: '路径不能为空'
		};
	}
	return { valid: true };
}

/**
 * 验证数值是否在指定范围内
 * @param value - 要验证的数值
 * @param min - 最小值
 * @param max - 最大值
 * @param fieldName - 字段名称(用于错误消息)
 * @returns 验证结果
 * 
 * @example
 * ```typescript
 * validateRange(50, 10, 100, '超时时间') // { valid: true }
 * validateRange(5, 10, 100, '超时时间') // { valid: false, error: '超时时间必须在 10 到 100 之间' }
 * ```
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
			error: `${fieldName}必须在 ${min} 到 ${max} 之间`
		};
	}
	return { valid: true };
}

/**
 * 验证不透明度值是否有效
 * 不透明度必须在 0.1-1.0 之间
 * @param opacity - 不透明度值
 * @returns 验证结果
 * 
 * @example
 * ```typescript
 * validateOpacity(0.9) // { valid: true }
 * validateOpacity(0.05) // { valid: false, error: '不透明度必须在 0.1-1.0 之间' }
 * validateOpacity(1.5) // { valid: false, error: '不透明度必须在 0.1-1.0 之间' }
 * ```
 */
export function validateOpacity(opacity: number): ValidationResult {
	return validateRange(opacity, 0.1, 1.0, '不透明度');
}

/**
 * 验证空闲超时阈值是否有效
 * 超时时间必须在 10-3600 秒之间
 * @param timeoutSeconds - 超时时间(秒)
 * @returns 验证结果
 * 
 * @example
 * ```typescript
 * validateIdleTimeout(60) // { valid: true }
 * validateIdleTimeout(5) // { valid: false, error: '空闲超时必须在 10 到 3600 之间' }
 * ```
 */
export function validateIdleTimeout(timeoutSeconds: number): ValidationResult {
	return validateRange(timeoutSeconds, 10, 3600, '空闲超时');
}
