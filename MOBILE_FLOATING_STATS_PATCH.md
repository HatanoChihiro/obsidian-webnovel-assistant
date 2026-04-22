# 移动端浮动统计窗口 - 实施指南

## 功能说明

为移动端和平板端添加一个轻量级的浮动字数统计窗口，解决官方隐藏状态栏导致无法查看字数的问题。

### 特点
- 📱 轻量级，不占用太多屏幕空间
- 🎯 显示章节字数和目标进度
- 👆 可拖动位置
- 📊 可折叠/展开
- 💾 自动保存位置和状态
- 🎨 自适应主题颜色

---

## 已完成的工作

### 1. 创建浮窗组件 ✅
**文件：** `src/ui/MobileFloatingStats.ts`

**功能：**
- 显示当前章节字数
- 显示目标进度百分比
- 显示进度条（颜色根据进度变化）
- 支持触摸拖动和鼠标拖动
- 支持折叠/展开
- 位置和状态持久化到 localStorage

### 2. 更新导入 ✅
**文件：** `main.ts`

**修改：**
```typescript
// 添加导入
import { MobileFloatingStats } from './src/ui/MobileFloatingStats';

// 添加属性
mobileFloatingStats: MobileFloatingStats | null = null;
```

---

## 需要手动完成的修改

### 修改 main.ts 中的移动端适配逻辑

**位置：** `main.ts` 第 151 行附近（`this.updateWordCount(); // 初始化状态栏数字` 之后）

**原代码：**
```typescript
this.updateWordCount(); // 初始化状态栏数字

// ==========================================
// 2. 移动端 Lite 模式拦截 (需求 8.1, 8.3)
// ==========================================
if (isMobile()) {
    // 手机端只注册"设定本章目标字数"的右键菜单
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && file.extension === 'md') {
            menu.addItem((item) => {
                item.setTitle('设定本章目标字数').setIcon('target').onClick(() => { new GoalModal(this.app, file).open(); });
            });
        }
    }));
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
        if (view.file) {
            menu.addItem((item) => {
                item.setTitle('设定本章目标字数').setIcon('target').onClick(() => { new GoalModal(this.app, view.file!).open(); });
            });
        }
    }));
    return; // 🛑 关键：手机端执行到这里直接终止，不加载下方的高级重度功能
}
```

**新代码：**
```typescript
this.updateWordCount(); // 初始化状态栏数字

// ==========================================
// 2. 移动端和平板端适配 (需求 8.1, 8.3, 8.6)
// ==========================================
const platformTier = getPlatformTier();

if (platformTier === 'mobile' || platformTier === 'tablet') {
    // 移动端和平板端：启用浮动字数统计窗口
    this.mobileFloatingStats = new MobileFloatingStats(this.app, this);
    this.app.workspace.onLayoutReady(() => {
        this.mobileFloatingStats?.load();
    });
    
    // 监听编辑器变化，更新浮窗
    this.registerEvent(this.app.workspace.on('editor-change', () => {
        this.debounceManager.debounce('mobile-stats-update', () => {
            this.mobileFloatingStats?.update();
        }, 300);
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
        this.mobileFloatingStats?.update();
    }));
    
    // 注册右键菜单
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && file.extension === 'md') {
            menu.addItem((item) => {
                item.setTitle('设定本章目标字数').setIcon('target').onClick(() => { new GoalModal(this.app, file).open(); });
            });
        }
    }));
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
        if (view.file) {
            menu.addItem((item) => {
                item.setTitle('设定本章目标字数').setIcon('target').onClick(() => { new GoalModal(this.app, view.file!).open(); });
            });
        }
    }));
}

// 手机端：只提供核心功能
if (platformTier === 'mobile') {
    return; // 🛑 手机端执行到这里直接终止
}

// 平板端：启用面板功能（待实现）
if (platformTier === 'tablet') {
    // TODO: 未来可以在这里添加平板端专属功能
    return; // 🛑 平板端执行到这里直接终止
}
```

### 修改 onunload 方法

**位置：** `main.ts` 的 `onunload()` 方法中

**添加：**
```typescript
onunload() {
    // ... 现有代码 ...
    
    // 卸载移动端浮窗
    if (this.mobileFloatingStats) {
        this.mobileFloatingStats.unload();
        this.mobileFloatingStats = null;
    }
    
    // ... 现有代码 ...
}
```

---

## 使用说明

### 用户体验

1. **首次加载**
   - 浮窗出现在屏幕左上角（x: 20px, y: 100px）
   - 默认展开状态
   - 显示当前章节字数和进度

2. **拖动浮窗**
   - 触摸或点击 📊 图标区域
   - 拖动到任意位置
   - 松开后自动保存位置

3. **折叠/展开**
   - 点击右上角的 − 或 + 按钮
   - 折叠后只显示 📊 图标
   - 状态自动保存

4. **进度条颜色**
   - 0-79%：主题色
   - 80-99%：橙色 (#f59e0b)
   - 100%：绿色 (#10b981)

### 技术细节

**样式特点：**
- 固定定位（position: fixed）
- 高 z-index (9999) 确保在最上层
- 圆角边框 (12px)
- 阴影效果
- 自适应主题颜色

**性能优化：**
- 使用防抖（300ms）避免频繁更新
- 折叠时不更新内容
- 使用 CSS transition 实现平滑动画

**兼容性：**
- 支持触摸事件（移动端）
- 支持鼠标事件（平板端）
- 使用 localStorage 持久化状态

---

## 测试清单

### 功能测试
- [ ] 浮窗正确显示字数
- [ ] 浮窗正确显示进度
- [ ] 进度条颜色正确变化
- [ ] 可以拖动浮窗
- [ ] 可以折叠/展开
- [ ] 位置和状态持久化

### 平台测试
- [ ] 手机端（iOS）
- [ ] 手机端（Android）
- [ ] 平板端（iPad）
- [ ] 平板端（Android Tablet）

### 边界测试
- [ ] 切换文件时更新
- [ ] 编辑文字时更新
- [ ] 拖动到屏幕边缘
- [ ] 旋转屏幕后位置

---

## 未来优化建议

### 功能增强
1. **主题定制**
   - 允许用户自定义浮窗颜色
   - 提供多种预设主题

2. **显示选项**
   - 可选显示今日字数
   - 可选显示写作时长
   - 可选显示目标字数

3. **交互优化**
   - 双击浮窗打开设置
   - 长按显示更多信息
   - 手势操作（滑动关闭等）

### 性能优化
1. **渲染优化**
   - 使用 requestAnimationFrame
   - 虚拟 DOM 更新

2. **内存优化**
   - 及时清理事件监听器
   - 优化 DOM 结构

---

## 故障排除

### 浮窗不显示
**可能原因：**
- 平台检测失败
- 初始化时机错误

**解决方案：**
- 检查 `getPlatformTier()` 返回值
- 确保在 `onLayoutReady` 后加载

### 拖动不流畅
**可能原因：**
- 事件冲突
- 性能问题

**解决方案：**
- 使用 `e.preventDefault()`
- 添加 `touch-action: none`

### 位置不保存
**可能原因：**
- localStorage 被禁用
- 保存逻辑错误

**解决方案：**
- 检查 localStorage 权限
- 添加错误处理

---

## 总结

移动端浮动统计窗口已经完成开发，只需要手动修改 `main.ts` 中的两处代码即可启用。

**优势：**
- ✅ 解决移动端无状态栏的问题
- ✅ 轻量级，不影响性能
- ✅ 用户体验友好
- ✅ 代码结构清晰

**下一步：**
1. 手动应用上述代码修改
2. 编译并测试
3. 根据用户反馈优化
