import * as fs from 'fs';
import * as path from 'path';
import { build } from 'esbuild';
import postcss, { AtRule, Declaration, Rule } from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { Node, Project, SyntaxKind } from 'ts-morph';

interface RuleLocation {
	context: string;
	file: string;
	line: number;
	property: string;
	selector: string;
	value: string;
}

const projectRoot = path.resolve(__dirname, '..');
const stylesRoot = path.join(projectRoot, 'src', 'styles');
const indexPath = path.join(stylesRoot, 'index.css');
const artifactPath = path.join(projectRoot, 'styles.css');
const commonPath = 'src/styles/base/common.css';
const maxCommonLines = 3552;
const maxModuleLines = 1600;
const classOwners = [
	{ owner: 'src/styles/modals/advanced-search.css', prefix: 'advanced-search-' },
	{ owner: 'src/styles/modals/chapter-merge.css', prefix: 'wn-mobile-merge-' },
	{ owner: 'src/styles/modals/task-modal.css', prefix: 'wn-task-modal-' },
] as const;
const legacyClassPrefixes = [
	'webnovel-search-',
	'webnovel-tl-custom-hidden',
	'task-add-modal',
	'wn-task-input',
	'wn-task-label',
	'wn-task-hint',
	'wn-task-btn-container',
	'wn-task-type-group',
	'wn-task-type-badge',
] as const;
const requiredDeclarations = [
	{
		file: 'src/styles/base/common.css',
		property: 'grid-template-columns',
		selector: '.homepage-grid-container',
		value: 'repeat(2, minmax(0, 1fr))',
	},
	{
		file: 'src/styles/base/common.css',
		property: 'justify-content',
		selector: '.homepage-grid-left',
		value: 'space-between',
	},
	{
		file: 'src/styles/base/common.css',
		property: 'height',
		selector: '.homepage-grid-left',
		value: '100%',
	},
	{
		file: 'src/styles/modals/task-modal.css',
		property: 'font-family',
		selector: '.wn-task-modal-content',
		value: 'var(--font-interface)',
	},
	{
		file: 'src/styles/modals/task-modal.css',
		property: 'font-size',
		selector: '.wn-task-modal-content',
		value: 'var(--font-ui-medium)',
	},
] as const;

const errors: string[] = [];

function relativePath(filePath: string): string {
	return path.relative(projectRoot, filePath).replaceAll('\\', '/');
}

function getCssFiles(directory: string): string[] {
	return fs.readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) return getCssFiles(entryPath);
			return entry.isFile() && entry.name.endsWith('.css') ? [entryPath] : [];
		})
		.sort();
}

function getAtRuleContext(rule: Rule): string {
	const context: string[] = [];
	let current: unknown = rule.parent;
	while (current && typeof current === 'object' && 'type' in current) {
		const node = current as { name?: string; params?: string; parent?: unknown; type: string };
		if (node.type === 'atrule') {
			const atRule = node as AtRule;
			context.unshift(`@${atRule.name} ${atRule.params}`.trim());
		}
		current = node.parent;
	}
	return context.join(' > ');
}

function getSelectors(rule: Rule, file: string): string[] {
	try {
		const parsed = selectorParser().astSync(rule.selector);
		const selectorTexts = parsed.nodes.map((selector) => selector.toString().trim().replace(/\s+/g, ' '));
		if (new Set(selectorTexts).size !== selectorTexts.length) {
			errors.push(`${file}:${rule.source?.start?.line ?? 1} 同一规则中包含重复选择器。`);
		}
		const selectors = parsed.nodes.map((selector) => {
			const selectorText = selector.toString().trim().replace(/\s+/g, ' ');
			const classCounts = new Map<string, number>();
			selector.walkClasses((className) => {
				classCounts.set(className.value, (classCounts.get(className.value) ?? 0) + 1);
			});
			const repeatedClasses = [...classCounts.keys()].filter((className) => {
				const repeated = `.${className}.${className}`;
				const index = selectorText.indexOf(repeated);
				if (index < 0) return false;
				const nextCharacter = selectorText[index + repeated.length];
				return nextCharacter === undefined || /[.:#[\]\s>+~]/.test(nextCharacter);
			});
			const isImmersiveThemeBoundary = file === commonPath && selectorText.startsWith('body.immersive-mode-active');
			if (repeatedClasses.length > 0 && !isImmersiveThemeBoundary) {
				errors.push(`${file}:${rule.source?.start?.line ?? 1} 禁止通过重复类名提升特异性：'${selectorText}'。`);
			}
			if (classCounts.has('is-mobile') && !classCounts.has('is-phone') && !classCounts.has('is-tablet')) {
				errors.push(`${file}:${rule.source?.start?.line ?? 1} .is-mobile 必须显式限定 .is-phone 或 .is-tablet。`);
			}
			for (const { owner, prefix } of classOwners) {
				if ([...classCounts.keys()].some((className) => className.startsWith(prefix)) && file !== owner) {
					errors.push(`${file}:${rule.source?.start?.line ?? 1} '${prefix}*' 选择器只能由 ${owner} 定义。`);
				}
			}
			for (const legacyClass of legacyClassPrefixes) {
				if ([...classCounts.keys()].some((className) => className.startsWith(legacyClass))) {
					errors.push(`${file}:${rule.source?.start?.line ?? 1} 禁止恢复已迁移的旧类名 '${legacyClass}*'。`);
				}
			}
			return selectorText;
		});
		parsed.walkPseudos((pseudo) => {
			if (pseudo.value === ':has') {
				errors.push(`${file}:${rule.source?.start?.line ?? 1} 禁止使用 :has()。`);
			}
		});
		return selectors;
	} catch (error) {
		errors.push(`${file}:${rule.source?.start?.line ?? 1} 无法解析选择器 '${rule.selector}': ${String(error)}`);
		return [];
	}
}

function auditImports(allCssFiles: string[]): void {
	const indexRoot = postcss.parse(fs.readFileSync(indexPath, 'utf8'), { from: indexPath });
	const importedFiles: string[] = [];
	indexRoot.walkAtRules('import', (atRule) => {
		const match = atRule.params.match(/^["'](.+)["']$/);
		if (!match) {
			errors.push(`${relativePath(indexPath)}:${atRule.source?.start?.line ?? 1} @import 必须使用静态相对路径。`);
			return;
		}
		importedFiles.push(path.resolve(path.dirname(indexPath), match[1]));
	});

	const expected = allCssFiles.filter((file) => file !== indexPath);
	for (const file of expected) {
		const count = importedFiles.filter((imported) => imported === file).length;
		if (count !== 1) {
			errors.push(`${relativePath(file)} 必须在 src/styles/index.css 中且只能导入一次，当前为 ${count} 次。`);
		}
	}
	for (const imported of importedFiles) {
		if (!expected.includes(imported)) {
			errors.push(`${relativePath(indexPath)} 导入了不存在或不受管的文件：${relativePath(imported)}。`);
		}
	}
}

function auditSourceFiles(allCssFiles: string[]): number {
	const selectorRules = new Map<string, RuleLocation[]>();
	let auditedRules = 0;

	for (const filePath of allCssFiles) {
		if (filePath === indexPath) continue;
		const file = relativePath(filePath);
		const css = fs.readFileSync(filePath, 'utf8');
		const root = postcss.parse(css, { from: filePath });

		const lineCount = css.split(/\r?\n/).length;
		if (file === commonPath) {
			if (lineCount > maxCommonLines) {
				errors.push(`${file} 不得继续增长：当前 ${lineCount} 行，上限 ${maxCommonLines} 行。`);
			}
		} else if (lineCount > maxModuleLines) {
			errors.push(`${file} 过大：当前 ${lineCount} 行，上限 ${maxModuleLines} 行。请按功能继续拆分。`);
		}

		root.walkRules((rule) => {
			auditedRules += 1;
			const line = rule.source?.start?.line ?? 1;
			const declarations = rule.nodes.filter((node): node is Declaration => node.type === 'decl');
			if (declarations.length === 0) {
				errors.push(`${file}:${line} 空规则 '${rule.selector}'。`);
			}

			const properties = new Map<string, number>();
			for (const declaration of declarations) {
				const declarationLine = declaration.source?.start?.line ?? line;
				const declarationValue = declaration.value.trim();
				if (declaration.important) {
					errors.push(`${file}:${declarationLine} 禁止使用 !important。`);
				}
				if (declaration.prop === 'display' && declaration.value.trim() === 'contents') {
					errors.push(`${file}:${declarationLine} 禁止使用 display: contents。`);
				}
				if (declaration.prop === 'text-indent') {
					errors.push(`${file}:${declarationLine} 禁止使用 text-indent。`);
				}
				const allowedHexFallback = declarationValue.includes('var(--text-on-accent, #ffffff)')
					|| declarationValue.includes('var(--webnovel-eye-care-color, #E8F5E9)');
				if (/#[0-9a-f]{3,8}\b/i.test(declarationValue) && !allowedHexFallback) {
					errors.push(`${file}:${declarationLine} 禁止硬编码颜色 '${declarationValue}'，请使用主题或 wn 语义变量。`);
				}
				const count = (properties.get(declaration.prop) ?? 0) + 1;
				properties.set(declaration.prop, count);
				if (count > 1) {
					errors.push(`${file}:${declarationLine} 规则 '${rule.selector}' 重复声明 '${declaration.prop}'。`);
				}
			}

			if (file.endsWith('/base/typography-scopes.css')) {
				for (const declaration of declarations) {
					if (declaration.prop !== 'font-family') {
						errors.push(`${file}:${declaration.source?.start?.line ?? line} 排版作用域文件只能声明 font-family。`);
					}
				}
			}

			const context = getAtRuleContext(rule);
			for (const selector of getSelectors(rule, file)) {
				for (const declaration of declarations) {
					const key = `${context}\u0000${selector}\u0000${declaration.prop}`;
					const location: RuleLocation = {
						context,
						file,
						line,
						property: declaration.prop,
						selector,
						value: declaration.value.trim().replace(/\s+/g, ' '),
					};
					const locations = selectorRules.get(key) ?? [];
					locations.push(location);
					selectorRules.set(key, locations);
				}
			}
		});
	}

	for (const locations of selectorRules.values()) {
		const values = new Set(locations.map((location) => location.value));
		if (locations.length > 1 && values.size > 1) {
			const first = locations[0];
			const details = locations.map((location) => `${location.value} @ ${location.file}:${location.line}`).join('; ');
			errors.push(`层叠属性冲突 '${first.selector} { ${first.property} }'${first.context ? ` (${first.context})` : ''}: ${details}`);
		}
	}
	for (const required of requiredDeclarations) {
		const key = `\u0000${required.selector}\u0000${required.property}`;
		const matches = selectorRules.get(key) ?? [];
		if (!matches.some((location) => location.file === required.file && location.value === required.value)) {
			errors.push(`${required.file} 必须保留 '${required.selector} { ${required.property}: ${required.value}; }' 回归约束。`);
		}
	}

	return auditedRules;
}

function auditTypeScriptInlineStyles(): void {
	const project = new Project({ tsConfigFilePath: path.join(projectRoot, 'tsconfig.json') });
	for (const sourceFile of project.getSourceFiles()) {
		const filePath = sourceFile.getFilePath();
		const relative = relativePath(filePath);
		if (relative !== 'main.ts' && !relative.startsWith('src/')) continue;
		const sourceText = sourceFile.getFullText();
		for (const legacyClass of legacyClassPrefixes) {
			if (sourceText.includes(legacyClass)) {
				errors.push(`${relative} 禁止恢复已迁移的旧类名 '${legacyClass}*'。`);
			}
		}
		for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
			const expression = call.getExpression();
			if (!Node.isPropertyAccessExpression(expression)) continue;
			const method = expression.getName();
			if (method !== 'setCssProps' && method !== 'setCssStyles') continue;
			const argument = call.getArguments()[0];
			if (!argument || !Node.isObjectLiteralExpression(argument)) continue;
			for (const property of argument.getProperties()) {
				if (Node.isPropertyAssignment(property) && property.getName() === 'display') {
					errors.push(`${relative}:${property.getStartLineNumber()} 禁止通过 ${method} 写入 display；请使用组件状态类或 hidden 属性。`);
				}
			}
		}
	}
}

async function auditArtifact(): Promise<void> {
	if (!fs.existsSync(artifactPath)) {
		errors.push('styles.css 不存在，请先运行 npm run build:css。');
		return;
	}
	const result = await build({
		absWorkingDir: projectRoot,
		bundle: true,
		entryPoints: [indexPath],
		logLevel: 'silent',
		outfile: artifactPath,
		write: false,
	});
	const output = result.outputFiles.find((file) => file.path === artifactPath) ?? result.outputFiles[0];
	const artifact = fs.readFileSync(artifactPath);
	if (!output || !artifact.equals(Buffer.from(output.contents))) {
		errors.push('styles.css 与 src/styles 源模块不一致，请运行 npm run build:css。');
	}
}

async function main(): Promise<void> {
	console.log('🔍 Running source CSS architecture audit...');
	const allCssFiles = getCssFiles(stylesRoot);
	auditImports(allCssFiles);
	const auditedRules = auditSourceFiles(allCssFiles);
	auditTypeScriptInlineStyles();
	await auditArtifact();

	if (errors.length > 0) {
		console.error(`❌ [CSS Errors] (${errors.length}):`);
		for (const error of errors) console.error(`   - ${error}`);
		process.exit(1);
	}
	console.log(`✅ Source CSS architecture audit passed (${allCssFiles.length - 1} modules, ${auditedRules} rules).`);
}

void main();
