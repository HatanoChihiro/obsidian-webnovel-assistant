import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	obsidianmd.configs.recommended,
	{
		ignores: [
			'main.js',
			'node_modules/',
			'tests/mocks/',
			'coverage/'
		]
	},
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parserOptions: {
				project: './tsconfig.json',
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'no-console': ['error', { allow: ['warn', 'error', 'info', 'debug'] }],
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unsafe-argument': 'warn',
			'@typescript-eslint/no-unsafe-return': 'warn',
			'@typescript-eslint/no-unsafe-assignment': 'warn',
			'@typescript-eslint/no-unsafe-member-access': 'warn',
			'@typescript-eslint/no-unsafe-call': 'warn',
			'@typescript-eslint/no-unnecessary-type-assertion': 'error',
			'no-restricted-syntax': [
				'error',
				{
					selector: 'CallExpression[callee.property.name="addEventListener"][arguments.0.value="input"] TSAsExpression[typeAnnotation.typeName.name="InputEvent"]',
					message: 'Do not assert input listener events as InputEvent; use inferred types or runtime narrowing.',
				},
			],
			'@typescript-eslint/no-floating-promises': 'warn',
			'@typescript-eslint/await-thenable': 'warn',
			'@typescript-eslint/no-misused-promises': 'warn',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			'@typescript-eslint/consistent-type-imports': [
				'warn',
				{
					prefer: 'type-imports',
					fixStyle: 'separate-type-imports',
				},
			],
			'no-irregular-whitespace': 'error',
			'obsidianmd/ui/sentence-case': 'off',
		},
	}
);
