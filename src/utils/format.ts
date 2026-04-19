/**
 * 格式化工具函数
 * 提供时间、数字、颜色等格式化功能
 */

/**
 * 将十六进制颜色转换为 RGBA 格式
 * @param hex - 十六进制颜色值 (如 '#FDF3B8' 或 'FDF3B8')
 * @param alpha - 透明度 (0-1)
 * @returns RGBA 颜色字符串
 * 
 * @example
 * ```typescript
 * hexToRgba('#FDF3B8', 0.9) // 'rgba(253, 243, 184, 0.9)'
 * hexToRgba('FFF', 0.5) // 'rgba(255, 255, 255, 0.5)'
 * ```
 */
export function hexToRgba(hex: string, alpha: number): string {
	if (!hex) return `rgba(255, 255, 255, ${alpha})`;
	
	// 移除 # 前缀
	let h = hex.replace('#', '');
	
	// 处理简写形式 (如 'FFF' -> 'FFFFFF')
	if (h.length === 3) {
		h = h.split('').map(c => c + c).join('');
	}
	
	// 验证长度
	if (h.length !== 6) {
		return `rgba(255, 255, 255, ${alpha})`;
	}
	
	// 解析 RGB 值
	const r = parseInt(h.substring(0, 2), 16) || 0;
	const g = parseInt(h.substring(2, 4), 16) || 0;
	const b = parseInt(h.substring(4, 6), 16) || 0;
	
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 将秒数格式化为 HH:MM:SS 格式
 * @param totalSeconds - 总秒数
 * @returns 格式化的时间字符串
 * 
 * @example
 * ```typescript
 * formatTime(3661) // '01:01:01'
 * formatTime(90) // '00:01:30'
 * formatTime(0) // '00:00:00'
 * ```
 */
export function formatTime(totalSeconds: number): string {
	const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
	const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
	const s = (totalSeconds % 60).toString().padStart(2, '0');
	return `${h}:${m}:${s}`;
}

/**
 * 格式化字数显示
 * 将大数字转换为更易读的格式 (1000 -> 1k, 10000 -> 1w)
 * @param count - 字数
 * @returns 格式化的字数字符串
 * 
 * @example
 * ```typescript
 * formatCount(500) // '500'
 * formatCount(1500) // '1.5k'
 * formatCount(15000) // '1.5w'
 * ```
 */
export function formatCount(count: number): string {
	if (count >= 10000) {
		return (count / 10000).toFixed(1) + 'w';
	}
	if (count >= 1000) {
		return (count / 1000).toFixed(1) + 'k';
	}
	return count.toString();
}
