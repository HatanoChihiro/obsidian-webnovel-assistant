/**
 * 工具函数统一导出
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
	escapeRegex,
	parseGoal,
	type ValidationResult
} from './validation';

// DOM 操作工具
export {
	rafThrottle
} from './dom';

// 平台检测工具
export {
	isDesktop,
	isMobile,
	getPlatformTier
} from './platform';

// UI 工具
export { copyDocumentContent } from './ui';

// 路径工具
export { findBookRoot, type FindBookRootPlugin, type CurrentBookContextPlugin } from './path';

// Badge 渲染工具
export { renderForeshadowingBadges, renderLoreBadges } from './badge';
// Leaf 焦点与跳转工具
export { revealAndFocusLeaf, openFileAndFocus, isLeafPinned, isCustomPluginLeaf, getLeafForFileNavigation } from './leaf';
// 持久化工具
export { JsonSnapshotStore, type JsonSnapshotStoreOptions } from './JsonSnapshotStore';
