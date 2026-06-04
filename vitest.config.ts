import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		// 只测试 tests/ 目录下的文件
		include: ['tests/**/*.test.ts'],
	},
	resolve: {
		alias: {
			// Mock obsidian 模块，覆盖所有依赖链中的 obsidian 导入
			'obsidian': path.resolve(__dirname, 'tests/mocks/obsidian.ts'),
		},
	},
});
