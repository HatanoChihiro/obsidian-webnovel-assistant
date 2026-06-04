import { describe, it, expect } from 'vitest';
import { validatePort, validatePath, validateRange, validateOpacity, validateIdleTimeout, escapeRegex, parseGoal } from '../src/utils/validation';

describe('validation', () => {
	describe('validatePort', () => {
		it('有效端口号', () => {
			expect(validatePort(8080).valid).toBe(true);
			expect(validatePort(1024).valid).toBe(true);
			expect(validatePort(65535).valid).toBe(true);
		});

		it('无效端口号', () => {
			expect(validatePort(0).valid).toBe(false);
			expect(validatePort(-1).valid).toBe(false);
			expect(validatePort(65536).valid).toBe(false);
			expect(validatePort(1.5).valid).toBe(false);
		});

		it('边界值', () => {
			expect(validatePort(1024).valid).toBe(true);
			expect(validatePort(1023).valid).toBe(false);
		});
	});

	describe('validatePath', () => {
		it('有效路径', () => {
			expect(validatePath('/valid/path').valid).toBe(true);
			expect(validatePath('relative/path').valid).toBe(true);
			expect(validatePath('single').valid).toBe(true);
		});

		it('空路径', () => {
			expect(validatePath('').valid).toBe(false);
			expect(validatePath('   ').valid).toBe(false);
		});
	});

	describe('validateRange', () => {
		it('范围内的值', () => {
			expect(validateRange(5, 1, 10, '测试').valid).toBe(true);
			expect(validateRange(1, 1, 10, '测试').valid).toBe(true);
			expect(validateRange(10, 1, 10, '测试').valid).toBe(true);
		});

		it('超出范围的值', () => {
			expect(validateRange(0, 1, 10, '测试').valid).toBe(false);
			expect(validateRange(11, 1, 10, '测试').valid).toBe(false);
		});
	});

	describe('validateOpacity', () => {
		it('有效不透明度', () => {
			expect(validateOpacity(0.1).valid).toBe(true);
			expect(validateOpacity(0.5).valid).toBe(true);
			expect(validateOpacity(1).valid).toBe(true);
		});

		it('无效不透明度', () => {
			expect(validateOpacity(0).valid).toBe(false);
			expect(validateOpacity(1.1).valid).toBe(false);
		});
	});

	describe('validateIdleTimeout', () => {
		it('有效超时值', () => {
			expect(validateIdleTimeout(10).valid).toBe(true);
			expect(validateIdleTimeout(30).valid).toBe(true);
			expect(validateIdleTimeout(3600).valid).toBe(true);
		});

		it('无效超时值', () => {
			expect(validateIdleTimeout(0).valid).toBe(false);
			expect(validateIdleTimeout(9).valid).toBe(false);
			expect(validateIdleTimeout(3601).valid).toBe(false);
		});
	});

	describe('escapeRegex', () => {
		it('转义特殊字符', () => {
			expect(escapeRegex('hello.world')).toBe('hello\\.world');
			expect(escapeRegex('a+b*c')).toBe('a\\+b\\*c');
			expect(escapeRegex('(test)')).toBe('\\(test\\)');
			expect(escapeRegex('[abc]')).toBe('\\[abc\\]');
		});

		it('普通字符串不变', () => {
			expect(escapeRegex('hello')).toBe('hello');
			expect(escapeRegex('中文测试')).toBe('中文测试');
		});

		it('空字符串', () => {
			expect(escapeRegex('')).toBe('');
		});
	});

	describe('parseGoal', () => {
		it('解析数字', () => {
			expect(parseGoal(3000)).toBe(3000);
			expect(parseGoal(0)).toBe(0);
		});

		it('解析数字字符串', () => {
			expect(parseGoal('3000')).toBe(3000);
			expect(parseGoal('0')).toBe(0);
		});

		it('无效输入返回 0', () => {
			expect(parseGoal(undefined)).toBe(0);
			expect(parseGoal(null)).toBe(0);
			expect(parseGoal('abc')).toBe(0);
			expect(parseGoal('')).toBe(0);
		});

		it('负数返回 0', () => {
			expect(parseGoal(-100)).toBe(0);
			expect(parseGoal('-100')).toBe(0);
		});
	});
});
