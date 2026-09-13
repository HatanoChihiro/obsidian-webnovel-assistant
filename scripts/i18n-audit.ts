import * as fs from 'fs';
import * as path from 'path';
import { Project, SyntaxKind, Node, SourceFile } from 'ts-morph';

export interface ProofreadingAuditIssue {
	filePath: string;
	line: number;
	sink: string;
	message: string;
}

/**
 * Checks if a string contains user-visible natural language text
 * (ignoring empty strings, pure whitespace, CSS class names, single punctuation / separators).
 */
export function hasUserVisibleText(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;

	// Single or sequence of punctuation characters / separators: e.g. "；", "、", ",", ": ", " - ", "\n"
	if (/^[，。！？；：、…—\s\r\n\-,.:;()/[\]{}|'"`\\<>+*=%&^$#@!~]+$/.test(trimmed)) {
		return false;
	}

	// CSS classes or internal keys: e.g. "wn-proofreading-wrong", "proofreading.dedide-*"
	if (/^wn-[a-z0-9-]+$/.test(trimmed) || /^[a-z0-9_.-]+$/.test(trimmed)) {
		return false;
	}

	// Contains Han (Chinese) characters
	if (/[\u4e00-\u9fa5]/.test(trimmed)) {
		return true;
	}

	// Contains natural English words (length >= 2)
	if (/[a-zA-Z]{2,}/.test(trimmed)) {
		return true;
	}

	return false;
}

/**
 * Checks if an expression in a diagnostic sink is unlocalized.
 * In a diagnostic message/messageBuilder sink, ANY non-empty StringLiteral or TemplateExpression
 * that is not wrapping t() is considered an unlocalized raw literal.
 */
export function isUnlocalizedDiagnosticMessage(node: Node): boolean {
	if (Node.isParenthesizedExpression(node)) {
		return isUnlocalizedDiagnosticMessage(node.getExpression());
	}

	if (Node.isConditionalExpression(node)) {
		return isUnlocalizedDiagnosticMessage(node.getWhenTrue()) ||
			isUnlocalizedDiagnosticMessage(node.getWhenFalse());
	}

	if (Node.isBinaryExpression(node)) {
		return isUnlocalizedDiagnosticMessage(node.getLeft()) ||
			isUnlocalizedDiagnosticMessage(node.getRight());
	}

	if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
		const text = node.getLiteralText();
		if (text.trim() === '' || !hasUserVisibleText(text)) {
			return false;
		}
		return true;
	}

	if (Node.isTemplateExpression(node)) {
		return true;
	}

	return false;
}

/**
 * Determines whether an expression represents a raw, unlocalized literal containing user-visible text in UI sinks.
 */
export function isRawUserVisibleLiteral(node: Node): boolean {
	if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
		return hasUserVisibleText(node.getLiteralText());
	}

	if (Node.isTemplateExpression(node)) {
		if (hasUserVisibleText(node.getHead().getLiteralText())) {
			return true;
		}
		for (const span of node.getTemplateSpans()) {
			if (hasUserVisibleText(span.getLiteral().getLiteralText())) {
				return true;
			}
		}
		return false;
	}

	return false;
}

/**
 * Audit a single SourceFile AST for proofreading diagnostic and UI hardcode sinks.
 */
export function auditProofreadingAST(sourceFile: SourceFile): ProofreadingAuditIssue[] {
	const issues: ProofreadingAuditIssue[] = [];
	const filePath = sourceFile.getFilePath();

	// 1. Audit PropertyAssignments: message, messageBuilder
	const propAssignments = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment);
	for (const prop of propAssignments) {
		const propName = prop.getName();

		if (propName === 'messageBuilder') {
			const init = prop.getInitializer();
			if (!init) continue;

			if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
				const body = init.getBody();
				if (Node.isBlock(body)) {
					const returns = body.getDescendantsOfKind(SyntaxKind.ReturnStatement);
					for (const ret of returns) {
						const retExpr = ret.getExpression();
						if (retExpr && isUnlocalizedDiagnosticMessage(retExpr)) {
							issues.push({
								filePath,
								line: ret.getStartLineNumber(),
								sink: 'messageBuilder',
								message: `Raw string/template literal returned in messageBuilder sink: ${retExpr.getText()}`
							});
						}
					}
				} else if (isUnlocalizedDiagnosticMessage(body)) {
					issues.push({
						filePath,
						line: init.getStartLineNumber(),
						sink: 'messageBuilder',
						message: `Raw string/template literal in messageBuilder sink: ${body.getText()}`
					});
				}
			} else if (isUnlocalizedDiagnosticMessage(init)) {
				issues.push({
					filePath,
					line: prop.getStartLineNumber(),
					sink: 'messageBuilder',
					message: `Raw string/template literal in messageBuilder sink: ${init.getText()}`
				});
			}
		} else if (propName === 'message') {
			const init = prop.getInitializer();
			if (init && isUnlocalizedDiagnosticMessage(init)) {
				issues.push({
					filePath,
					line: prop.getStartLineNumber(),
					sink: 'message',
					message: `Raw string/template literal in diagnostic message sink: ${init.getText()}`
				});
			}
		}
	}

	// 2. Audit UI sinks in proofreading UI files (Notice, setText, setButtonText)
	const isUIFile = filePath.includes('/ui/') || filePath.includes('\\ui\\') ||
		filePath.includes('ProofreadingPopover') || filePath.includes('AnnotateDictModal');

	if (isUIFile) {
		// 2a. new Notice(rawLiteral)
		const newExprs = sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression);
		for (const newExpr of newExprs) {
			const expr = newExpr.getExpression();
			if (expr.getText() === 'Notice') {
				const args = newExpr.getArguments();
				if (args.length > 0) {
					const firstArg = args[0];
					if (isRawUserVisibleLiteral(firstArg)) {
						issues.push({
							filePath,
							line: newExpr.getStartLineNumber(),
							sink: 'new Notice',
							message: `Raw string/template literal passed to new Notice: ${firstArg.getText()}`
						});
					}
				}
			}
		}

		// 2b. setText(rawLiteral), setButtonText(rawLiteral)
		const callExprs = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
		for (const callExpr of callExprs) {
			const expr = callExpr.getExpression();
			if (Node.isPropertyAccessExpression(expr)) {
				const name = expr.getName();
				if (name === 'setText' || name === 'setButtonText') {
					const args = callExpr.getArguments();
					if (args.length > 0) {
						const firstArg = args[0];
						if (isRawUserVisibleLiteral(firstArg)) {
							issues.push({
								filePath,
								line: callExpr.getStartLineNumber(),
								sink: name,
								message: `Raw string/template literal with user-visible text in ${name}: ${firstArg.getText()}`
							});
						}
					}
				}
			}
		}
	}

	return issues;
}

/**
 * Helper to audit an in-memory snippet for regression testing.
 */
export function auditProofreadingSnippet(code: string, fileName = 'src/services/proofreading/MockRule.ts'): ProofreadingAuditIssue[] {
	const project = new Project({ useInMemoryFileSystem: true });
	const sourceFile = project.createSourceFile(fileName, code);
	return auditProofreadingAST(sourceFile);
}

/** Returns interpolation placeholder names in deterministic order. */
export function getInterpolationPlaceholders(text: string): string[] {
	return Array.from(text.matchAll(/\{([a-zA-Z0-9_]+)\}/g), match => match[1]).sort();
}

export function runI18nAudit(): boolean {
	console.log('🔍 Running i18n Translation Completeness & Proofreading AST Audit...');

	const i18nDir = path.join(__dirname, '../src/i18n');
	const locales = fs.readdirSync(i18nDir)
		.filter(fileName => fileName.endsWith('.json'))
		.map(fileName => path.basename(fileName, '.json'))
		.sort();
	const dataMap: Record<string, Record<string, string>> = {};
	const keysMap: Record<string, Set<string>> = {};

	for (const locale of locales) {
		const filePath = path.join(i18nDir, `${locale}.json`);
		if (!fs.existsSync(filePath)) {
			console.error(`❌ i18n JSON file missing: ${locale}.json`);
			return false;
		}
		dataMap[locale] = JSON.parse(fs.readFileSync(filePath, 'utf8') as string);
		keysMap[locale] = new Set(Object.keys(dataMap[locale]));
	}

	let hasErrors = false;
	const referenceLocale = 'zh-CN';
	const refKeys = keysMap[referenceLocale];

	for (const locale of locales) {
		if (locale === referenceLocale) continue;

		const missingInTarget: string[] = [];
		const extraInTarget: string[] = [];
		const placeholderMismatch: { key: string, refVars: string[], tgtVars: string[] }[] = [];

		refKeys.forEach(key => {
			if (!keysMap[locale].has(key)) {
				missingInTarget.push(key);
			} else {
				const refText = dataMap[referenceLocale][key] || '';
				const tgtText = dataMap[locale][key] || '';
				const refVars = getInterpolationPlaceholders(refText);
				const tgtVars = getInterpolationPlaceholders(tgtText);

				if (JSON.stringify(refVars) !== JSON.stringify(tgtVars)) {
					placeholderMismatch.push({ key, refVars, tgtVars });
				}
			}
		});

		keysMap[locale].forEach(key => {
			if (!refKeys.has(key)) {
				extraInTarget.push(key);
			}
		});

		if (missingInTarget.length > 0) {
			console.error(`❌ [Error] ${missingInTarget.length} keys present in ${referenceLocale}.json but missing in ${locale}.json:`);
			missingInTarget.forEach(k => console.error(`  - ${k}`));
			hasErrors = true;
		}

		if (extraInTarget.length > 0) {
			console.error(`❌ [Error] ${extraInTarget.length} keys present in ${locale}.json but missing in ${referenceLocale}.json:`);
			extraInTarget.forEach(k => console.error(`  - ${k}`));
			hasErrors = true;
		}

		if (placeholderMismatch.length > 0) {
			console.error(`❌ [Error] ${placeholderMismatch.length} keys have placeholder mismatch in ${locale}.json:`);
			placeholderMismatch.forEach(m => {
				console.error(`  - ${m.key}: expected {${m.refVars.join(', ')}}, got {${m.tgtVars.join(', ')}}`);
			});
			hasErrors = true;
		}
	}

	// 2. TypeScript AST Audit for Proofreading Code
	const project = new Project({
		tsConfigFilePath: path.join(__dirname, '../tsconfig.json'),
	});

	const proofreadingFiles = project.getSourceFiles().filter(sf => {
		const fp = sf.getFilePath();
		if (fp.includes('node_modules') || fp.includes('scripts') || fp.includes('tests')) return false;
		return (
			fp.includes('proofreading') ||
			fp.includes('Proofreading') ||
			fp.includes('AnnotateDict')
		);
	});

	let astIssueCount = 0;
	for (const sf of proofreadingFiles) {
		const issues = auditProofreadingAST(sf);
		for (const issue of issues) {
			console.error(`❌ [Error] ${issue.message} in ${issue.filePath}:${issue.line}`);
			hasErrors = true;
			astIssueCount++;
		}
	}

	if (hasErrors) {
		console.error(`💥 i18n Audit failed! (key mismatch errors found, ${astIssueCount} proofreading AST sink errors)`);
		return false;
	} else {
		console.log(`✅ i18n Audit passed! (${refKeys.size} keys synchronized across ${locales.length} locales; ${proofreadingFiles.length} proofreading files audited with 0 AST sink issues)`);
		return true;
	}
}

if (typeof require !== 'undefined' && require.main === module) {
	const success = runI18nAudit();
	if (!success) {
		process.exit(1);
	}
}
