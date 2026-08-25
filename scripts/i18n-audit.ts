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

export function runI18nAudit(): boolean {
	console.log('🔍 Running i18n Translation Completeness & Proofreading AST Audit...');

	const i18nDir = path.join(__dirname, '../src/i18n');
	const zhPath = path.join(i18nDir, 'zh-CN.json');
	const enPath = path.join(i18nDir, 'en.json');

	if (!fs.existsSync(zhPath) || !fs.existsSync(enPath)) {
		console.error('❌ i18n JSON files missing!');
		return false;
	}

	const zhData = JSON.parse(fs.readFileSync(zhPath, 'utf8') as string) as Record<string, string>;
	const enData = JSON.parse(fs.readFileSync(enPath, 'utf8') as string) as Record<string, string>;

	const zhKeys = new Set(Object.keys(zhData));
	const enKeys = new Set(Object.keys(enData));

	const missingInEn: string[] = [];
	const missingInZh: string[] = [];

	zhKeys.forEach(key => {
		if (!enKeys.has(key)) {
			missingInEn.push(key);
		}
	});

	enKeys.forEach(key => {
		if (!zhKeys.has(key)) {
			missingInZh.push(key);
		}
	});

	let hasErrors = false;

	if (missingInEn.length > 0) {
		console.error(`❌ [Error] ${missingInEn.length} keys present in zh-CN.json but missing in en.json:`);
		missingInEn.forEach(k => console.error(`  - ${k}`));
		hasErrors = true;
	}

	if (missingInZh.length > 0) {
		console.error(`❌ [Error] ${missingInZh.length} keys present in en.json but missing in zh-CN.json:`);
		missingInZh.forEach(k => console.error(`  - ${k}`));
		hasErrors = true;
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
		console.error(`💥 i18n Audit failed! (${missingInEn.length + missingInZh.length} key mismatch errors, ${astIssueCount} proofreading AST sink errors)`);
		return false;
	} else {
		console.log(`✅ i18n Audit passed! (${zhKeys.size} keys synchronized; ${proofreadingFiles.length} proofreading files audited with 0 AST sink issues)`);
		return true;
	}
}

if (typeof require !== 'undefined' && require.main === module) {
	const success = runI18nAudit();
	if (!success) {
		process.exit(1);
	}
}
