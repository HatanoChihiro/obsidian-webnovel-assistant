import { build } from 'esbuild';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('production bundle boundaries', () => {
	it('excludes test files and test-only methods while retaining framework callbacks', async () => {
		const result = await build({
			entryPoints: ['main.ts'],
			bundle: true,
			format: 'cjs',
			external: ['obsidian', '@codemirror/*'],
			minify: true,
			charset: 'utf8',
			// Keep identifiers readable for the audit; tree shaking still runs.
			minifyIdentifiers: false,
			metafile: true,
			write: false,
			logLevel: 'silent'
		});
		expect(result.outputFiles![0].text).toContain('Copyright (c) 2009-2015, Kevin Decker');
		expect(result.outputFiles![0].text).toContain('Redistribution and use in source and binary forms');
		expect(Object.keys(result.metafile!.inputs).filter(file => file.startsWith('tests/'))).toEqual([]);
		const source = ts.createSourceFile('main.js', result.outputFiles![0].text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
		const names = new Set<string>();
		const constantKeys = new Map<string, string[]>();
		const visit = (node: ts.Node): void => {
			if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
				constantKeys.set(node.name.getText(source), node.initializer.properties.map(property => property.name?.getText(source) || ''));
			}
			if ((ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name) {
				names.add(node.name.getText(source));
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
		const testOnlyNames = [
			'findChapterByName', 'compareFilesWithCustomOrder', 'updateDailyStat', 'getSettings',
			'hasBaselinePath', 'markHandledDelete', 'isOpen', 'getElement', 'getCacheVersion',
			'subscribe', 'getSiblingNovelsInSeries', 'addRecoveryChapter',
			'getElectronWindow', 'getSupportedLocales', 'consumeHandledDelete'
		];
		expect(testOnlyNames.filter(name => names.has(name))).toEqual([]);
		for (const [name, removed] of [
			['CACHE_CONFIG', ['INVALIDATION_TIMEOUT', 'WORD_COUNT_CACHE_MAX']],
			['VIEW_TYPES', ['STATUS', 'FORESHADOWING', 'CREATIVE', 'CORKBOARD', 'RELATION_GRAPH']],
			['REGEX_PATTERNS', ['ENGLISH_WORD', 'NUMBER', 'PUNCTUATION']]
		] as const) {
			// A single remaining member may be folded into its use by esbuild.
			const keys = constantKeys.get(name) || [];
			expect(removed.filter(key => keys.includes(key)), name).toEqual([]);
		}
		for (const name of ['onload', 'onunload', 'onOpen', 'onClose', 'toDOM', 'eq', 'update', 'destroy']) {
			expect(names.has(name), name).toBe(true);
		}
	});
});
