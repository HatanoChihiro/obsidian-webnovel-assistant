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
					}
				}
			}
		}
	});
});

if (hasErrors) {
	console.error('💥 Audit failed! Please fix the errors above before releasing.');
	process.exit(1);
} else {
	console.log('✅ Obsidian API Compliance Audit passed!');
}
