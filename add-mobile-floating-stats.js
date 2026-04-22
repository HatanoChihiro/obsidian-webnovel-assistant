// 脚本：在 main.ts 中添加移动端浮窗初始化代码
const fs = require('fs');

// 读取文件
let content = fs.readFileSync('main.ts', 'utf8');

// 要插入的代码
const codeToInsert = `\t\t\t// 移动端：启用浮动字数统计窗口
\t\t\tthis.mobileFloatingStats = new MobileFloatingStats(this.app, this);
\t\t\tthis.app.workspace.onLayoutReady(() => {
\t\t\t\tthis.mobileFloatingStats?.load();
\t\t\t});
\t\t\t
\t\t\t// 监听编辑器变化，更新浮窗
\t\t\tthis.registerEvent(this.app.workspace.on('editor-change', () => {
\t\t\t\tthis.debounceManager.debounce('mobile-stats-update', () => {
\t\t\t\t\tthis.mobileFloatingStats?.update();
\t\t\t\t}, 300);
\t\t\t}));
\t\t\tthis.registerEvent(this.app.workspace.on('active-leaf-change', () => {
\t\t\t\tthis.mobileFloatingStats?.update();
\t\t\t}));
\t\t\t
`;

// 查找插入位置（在 "手机端只注册" 注释之前）
const searchText = '\t\t\t// 手机端只注册"设定本章目标字数"的右键菜单';
const index = content.indexOf(searchText);

if (index === -1) {
	console.error('未找到插入位置！');
	process.exit(1);
}

// 插入代码
content = content.slice(0, index) + codeToInsert + content.slice(index);

// 写回文件
fs.writeFileSync('main.ts', content, 'utf8');

console.log('✅ 成功添加移动端浮窗初始化代码！');
console.log('📍 插入位置：第', content.slice(0, index).split('\\n').length, '行');
