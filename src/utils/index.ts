/**
 * 工具函数统一导出
 * 提供便捷的导入方式
 */

// 格式化工具
export { hexToRgba, formatTime, formatCount } from './format';

// 验证工具
export {
	validatePort,
	validatePath,
	validateRange,
	validateOpacity,
	validateIdleTimeout,
	type ValidationResult
} from './validation';

// DOM 操作工具
export {
	injectGlobalStyle,
	removeGlobalStyle,
	createElement,
	safeSetText,
	toggleClass
} from './dom';

// 平台检测工具
export {
	isDesktop,
	isMobile,
	isIOS,
	isAndroid,
	isTablet,
	getPlatformName,
	getPlatformTier,
	supportsAdvancedFeatures,
	supportsNodeModules,
	supportsPanelFeatures,
	getTouchTargetSize
} from './platform';
