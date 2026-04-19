# 工具函数模块

本目录包含从 main.ts 中提取的工具函数,提高代码的可重用性和可维护性。

## 模块说明

### format.ts - 格式化工具
提供时间、数字、颜色等格式化功能:
- `hexToRgba(hex, alpha)` - 将十六进制颜色转换为 RGBA 格式
- `formatTime(totalSeconds)` - 将秒数格式化为 HH:MM:SS 格式
- `formatCount(count)` - 格式化字数显示 (1000 -> 1k, 10000 -> 1w)

### validation.ts - 配置验证工具
提供端口号、文件路径、数值范围等验证功能:
- `validatePort(port)` - 验证端口号是否有效 (1024-65535)
- `validatePath(path)` - 验证文件路径是否有效
- `validateRange(value, min, max, fieldName)` - 验证数值是否在指定范围内
- `validateOpacity(opacity)` - 验证不透明度值 (0.1-1.0)
- `validateIdleTimeout(timeoutSeconds)` - 验证空闲超时阈值 (10-3600秒)

### dom.ts - DOM 操作工具
提供 DOM 元素创建、样式注入等辅助功能:
- `injectGlobalStyle(styleId, cssContent)` - 注入全局样式到文档头部
- `removeGlobalStyle(styleId)` - 移除全局样式
- `createElement(tag, options)` - 创建带有类名和文本的 DOM 元素
- `safeSetText(elementId, text)` - 安全地设置元素文本内容
- `toggleClass(element, className, force)` - 切换元素的类名

### platform.ts - 平台检测工具
提供平台检测和功能分级逻辑:
- `isDesktop()` - 检查是否为桌面端
- `isMobile()` - 检查是否为移动端
- `isIOS()` - 检查是否为 iOS 设备
- `isAndroid()` - 检查是否为 Android 设备
- `getPlatformName()` - 获取平台名称
- `supportsAdvancedFeatures()` - 检查是否支持高级功能
- `supportsNodeModules()` - 检查是否支持 Node.js 模块
- `getTouchTargetSize()` - 获取触摸目标的推荐尺寸

### index.ts - 统一导出
提供便捷的导入方式,可以从 `./src/utils` 直接导入所有工具函数。

## 使用示例

```typescript
// 导入单个函数
import { formatTime, hexToRgba } from './src/utils';

// 使用格式化函数
const timeStr = formatTime(3661); // '01:01:01'
const color = hexToRgba('#FDF3B8', 0.9); // 'rgba(253, 243, 184, 0.9)'

// 使用验证函数
import { validatePort } from './src/utils';
const result = validatePort(24816); // { valid: true }

// 使用平台检测
import { isDesktop, isMobile } from './src/utils';
if (isDesktop()) {
  // 加载桌面端专属功能
}
```

## 设计原则

1. **单一职责**: 每个函数只做一件事
2. **纯函数**: 尽可能使用纯函数,避免副作用
3. **类型安全**: 所有函数都有完整的 TypeScript 类型定义
4. **文档完善**: 每个函数都有 JSDoc 注释和使用示例
5. **易于测试**: 函数设计便于单元测试

## 相关需求

本模块实现了以下需求:
- **需求 11.1**: 时间格式化工具函数
- **需求 11.2**: 数字格式化工具函数
- **需求 11.3**: 颜色转换工具函数
- **需求 11.4**: 配置验证工具
- **需求 11.5**: DOM 操作工具
