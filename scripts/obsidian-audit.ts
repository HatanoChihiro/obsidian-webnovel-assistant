import { Project, SyntaxKind, PropertyAccessExpression } from 'ts-morph';
import * as path from 'path';

console.log('🔍 Running Obsidian API Compliance Audit...');

const project = new Project({
	tsConfigFilePath: path.join(__dirname, '../tsconfig.json'),
});

let hasErrors = false;

project.getSourceFiles().forEach(sourceFile => {
	const filePath = sourceFile.getFilePath();
	
	// Skip node_modules and scripts
	if (filePath.includes('node_modules') || filePath.includes('scripts')) return;

	// 1. Check for 'document' usage (should use 'activeDocument')
	const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);
	identifiers.forEach(identifier => {
		if (identifier.getText() === 'document') {
			// Allow activeDocument, Document, document.createElement? No, just flag 'document'
			const parent = identifier.getParent();
			if (parent && parent.getKind() === SyntaxKind.PropertyAccessExpression) {
				const propAccess = parent as PropertyAccessExpression;
				if (propAccess.getExpression() === identifier) {
					console.error(`❌ [Error] Uses 'document' instead of 'activeDocument' in ${filePath}:${identifier.getStartLineNumber()}`);
					hasErrors = true;
				}
			}
		}
		
		// 1b. Check for global app usage (window.app or globalThis.app)
		if (identifier.getText() === 'app') {
			const parent = identifier.getParent();
			if (parent && parent.getKind() === SyntaxKind.PropertyAccessExpression) {
				const propAccess = parent as PropertyAccessExpression;
				if (propAccess.getName() === 'app') {
					const left = propAccess.getExpression().getText();
					if (left === 'window' || left === 'globalThis') {
						console.error(`❌ [Error] Uses global '${left}.app' instead of 'this.app' in ${filePath}:${identifier.getStartLineNumber()}`);
						hasErrors = true;
					}
				}
			}
		}
		// 1c. Check for global timers without window.
		if (['setTimeout', 'setInterval', 'requestAnimationFrame'].includes(identifier.getText())) {
			const parent = identifier.getParent();
			if (parent && parent.getKind() === SyntaxKind.CallExpression) {
				const callExpr = parent as any;
				if (callExpr.getExpression() === identifier) {
					console.error(`❌ [Error] Uses global '${identifier.getText()}' instead of 'window.${identifier.getText()}' in ${filePath}:${identifier.getStartLineNumber()}`);
					hasErrors = true;
				}
			}
		}
	});

	// 2. Check for .style assignment (should use setCssProps/setCssStyles)
	const propertyAccesses = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
	propertyAccesses.forEach(propAccess => {
		if (propAccess.getName() === 'style') {
			const parent = propAccess.getParent();
			if (parent && parent.getKind() === SyntaxKind.PropertyAccessExpression) {
				const parentAccess = parent as PropertyAccessExpression;
				const grandParent = parentAccess.getParent();
				if (grandParent && grandParent.getKind() === SyntaxKind.BinaryExpression) {
					const binaryExpr = grandParent as any;
					if (binaryExpr.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
						console.error(`❌ [Error] Direct style assignment found (use setCssStyles instead) in ${filePath}:${propAccess.getStartLineNumber()}`);
						hasErrors = true;
					}
				}
			}
		}
		
		// 3. Check for renderMarkdown
		if (propAccess.getName() === 'renderMarkdown') {
			console.error(`❌ [Error] 'renderMarkdown' is deprecated. Use 'MarkdownRenderer.render' in ${filePath}:${propAccess.getStartLineNumber()}`);
			hasErrors = true;
		}
		
		// 4. Check for innerHTML / outerHTML
		if (['innerHTML', 'outerHTML', 'insertAdjacentHTML'].includes(propAccess.getName())) {
			console.error(`❌ [Error] Unsafe DOM API '${propAccess.getName()}' found in ${filePath}:${propAccess.getStartLineNumber()}`);
			hasErrors = true;
		}
		
		// 5. Check for createEl('h1') / createEl('h2') etc which should be Setting.setHeading()
		if (propAccess.getName() === 'createEl') {
			const parent = propAccess.getParent();
			if (parent && parent.getKind() === SyntaxKind.CallExpression) {
				const callExpr = parent as any;
				const args = callExpr.getArguments();
				if (args.length > 0) {
					const firstArgText = args[0].getText();
					if (["'h1'", "'h2'", "'h3'", "'h4'", "'h5'", "'h6'", '"h1"', '"h2"', '"h3"', '"h4"', '"h5"', '"h6"'].includes(firstArgText)) {
						console.error(`❌ [Error] createEl(${firstArgText}) found. Use new Setting().setHeading() instead in ${filePath}:${propAccess.getStartLineNumber()}`);
						hasErrors = true;
					} else if (["'div'", '"div"'].includes(firstArgText)) {
						console.error(`❌ [Error] createEl(${firstArgText}) found. Use createDiv() instead in ${filePath}:${propAccess.getStartLineNumber()}`);
						hasErrors = true;
					} else if (["'span'", '"span"'].includes(firstArgText)) {
						console.error(`❌ [Error] createEl(${firstArgText}) found. Use createSpan() instead in ${filePath}:${propAccess.getStartLineNumber()}`);
						hasErrors = true;
					}
				}
			}
		}
		// 6. Check for workspace.activeLeaf
		if (propAccess.getName() === 'activeLeaf') {
			const left = propAccess.getExpression().getText();
			if (left.includes('workspace')) {
				console.error(`❌ [Error] Uses deprecated 'workspace.activeLeaf' in ${filePath}:${propAccess.getStartLineNumber()}. Use 'workspace.getMostRecentLeaf()' or 'workspace.getActiveViewOfType()'.`);
				hasErrors = true;
			}
		}
	});

	// 7. Check for casting to TFile or TFolder
	const asExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.AsExpression);
	asExpressions.forEach(asExpr => {
		const typeText = asExpr.getTypeNode()?.getText();
		if (typeText === 'TFile' || typeText === 'TFolder') {
			console.error(`❌ [Warning] Avoid casting to '${typeText}'. Use an 'instanceof ${typeText}' check to safely narrow the type in ${filePath}:${asExpr.getStartLineNumber()}`);
			hasErrors = true;
		}
	});

	// 8. Check comments for eslint-disable
	const text = sourceFile.getFullText();
	const lines = text.split('\n');
	lines.forEach((line, index) => {
		if (line.includes('eslint-disable')) {
			if (line.includes('@typescript-eslint/no-explicit-any')) {
				console.error(`❌ [Error] Disabling '@typescript-eslint/no-explicit-any' is not allowed in ${filePath}:${index + 1}`);
				hasErrors = true;
			} else if (!line.includes('--')) {
				console.error(`❌ [Error] Unexpected undescribed directive comment in ${filePath}:${index + 1}. Include descriptions to explain why the comment is necessary.`);
				hasErrors = true;
			}
		}
	});
});

// 9. CSS Checks
import * as fs from 'fs';
const cssPath = path.join(__dirname, '../styles.css');
if (fs.existsSync(cssPath)) {
	const cssText = fs.readFileSync(cssPath, 'utf8');
	const cssLines = cssText.split('\n');
	let inBlock = false;
	let propsInBlock: { [key: string]: number } = {};

	cssLines.forEach((line, index) => {
		if (line.includes('!important')) {
			console.error(`❌ [Warning] Avoid !important — override styles by increasing selector specificity or using CSS variables instead in styles.css:${index + 1}`);
			hasErrors = true;
		}

		if (line.includes('{')) {
			inBlock = true;
			propsInBlock = {};
		}
		if (inBlock) {
			const match = line.match(/^\s*([\w-]+)\s*:/);
			if (match) {
				const prop = match[1];
				if (propsInBlock[prop]) {
					console.error(`❌ [Warning] Unexpected duplicate "${prop}" in styles.css:${index + 1}`);
					hasErrors = true;
				} else {
					propsInBlock[prop] = index + 1;
				}
			}
		}
		if (line.includes('}')) {
			inBlock = false;
		}
	});
}

if (hasErrors) {
	console.error('💥 Audit failed! Please fix the errors above before releasing.');
	process.exit(1);
} else {
	console.log('✅ Obsidian API Compliance Audit passed!');
}
