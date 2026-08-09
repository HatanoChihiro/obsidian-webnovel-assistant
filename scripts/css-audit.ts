import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..');
const cssPath = path.join(projectRoot, 'styles.css');
const srcDir = path.join(projectRoot, 'src');

if (!fs.existsSync(cssPath)) {
    console.error('❌ styles.css not found!');
    process.exit(1);
}

const cssContent = fs.readFileSync(cssPath, 'utf8') as string;

function getAllFiles(dir: string, ext = ['.ts', '.tsx']): string[] {
    let files: string[] = [];
    const list = fs.readdirSync(dir);
    list.forEach((file: string) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            files = files.concat(getAllFiles(filePath, ext));
        } else {
            if (ext.includes(path.extname(filePath))) {
                files.push(filePath);
            }
        }
    });
    return files;
}

const tsFiles = getAllFiles(srcDir);
if (fs.existsSync(path.join(projectRoot, 'main.ts'))) {
    tsFiles.push(path.join(projectRoot, 'main.ts'));
}

const combinedTsContent = tsFiles.map(f => fs.readFileSync(f, 'utf8') as string).join('\n');

const obsidianNativeClasses = new Set([
    'workspace', 'workspace-leaf', 'workspace-leaf-content', 'workspace-ribbon',
    'workspace-tab-header-container', 'workspace-tab-header', 'workspace-split',
    'mod-left-split', 'mod-right-split', 'mod-root', 'titlebar', 'view-content',
    'view-header', 'view-header-title', 'nav-folder', 'nav-folder-title',
    'nav-file', 'nav-file-title', 'tree-item', 'tree-item-self', 'tree-item-children',
    'clickable-icon', 'dropdown', 'app-container', 'horizontal-main-container',
    'workspace-leaf-resize-handle', 'collapse-indicator', 'svg-icon', 'is-mobile',
    'is-phone', 'is-tablet', 'theme-dark', 'theme-light', 'is-active', 'is-focused',
    'is-selected', 'is-collapsed', 'mod-active', 'is-disabled', 'is-hidden',
    'modal', 'modal-container', 'modal-bg', 'modal-close-button', 'modal-title',
    'notice', 'notice-container', 'menu', 'menu-item', 'menu-separator',
    'suggestion-container', 'suggestion-item', 'suggestion-content',
    'setting-item', 'setting-item-heading', 'setting-item-info', 'setting-item-name',
    'setting-item-description', 'setting-item-control', 'checkbox-container',
    'vertical-tab-header', 'vertical-tab-content', 'vertical-tab-nav-item',
    'markdown-source-view', 'markdown-preview-view', 'markdown-preview-sizer',
    'markdown-rendered', 'mod-cm6', 'cm-content', 'cm-line', 'cm-editor',
    'cm-activeLine', 'cm-selectionBackground', 'cm-cursorLayer', 'cm-selectionLayer',
    'cm-embed-block', 'HyperMD-header', 'HyperMD-header-1', 'HyperMD-header-2',
    'HyperMD-header-3', 'HyperMD-quote', 'HyperMD-listblock', 'inline-title',
    'metadata-container', 'metadata-properties', 'metadata-property',
    'frontmatter-container', 'mod-frontmatter', 'el-pre', 'mod-header',
    'search-result-file-title', 'has-focus', 'status-bar'
]);

const lines = cssContent.split(/\r?\n/);
let errors: string[] = [];
let warnings: string[] = [];

// 1. Check for empty rule sets
lines.forEach((line: string, index: number) => {
    const trimmed = line.trim();
    if (trimmed === '{}') {
        errors.push(`Line ${index + 1}: Empty rule set '{}' found.`);
    }
});

for (let i = 0; i < lines.length - 1; i++) {
    const l1 = lines[i].trim();
    const l2 = lines[i + 1].trim();
    if (l1.endsWith('{') && l2 === '}') {
        errors.push(`Line ${i + 1}-${i + 2}: Empty rule block '${l1}' found.`);
    }
}

// 2. Parse CSS rules to check duplicate selectors
interface CSSRule {
    media: string;
    selector: string;
    startLine: number;
    endLine: number;
}

let inComment = false;
let depth = 0;
let currentMedia = '';
let currentSelector = '';
let ruleStartLine = 0;
const parsedRules: CSSRule[] = [];

for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    let idx = 0;

    while (idx < line.length) {
        if (!inComment && line.substr(idx, 2) === '/*') { inComment = true; idx += 2; continue; }
        if (inComment && line.substr(idx, 2) === '*/') { inComment = false; idx += 2; continue; }
        if (inComment) { idx++; continue; }

        const c = line[idx];
        if (c === '{') {
            depth++;
            if (depth === 1) {
                if (currentSelector.trim().startsWith('@media') || currentSelector.trim().startsWith('@keyframes')) {
                    currentMedia = currentSelector.trim();
                    currentSelector = '';
                } else {
                    ruleStartLine = lineNum;
                }
            } else if (depth === 2 && currentMedia) {
                ruleStartLine = lineNum;
            }
        } else if (c === '}') {
            if (depth === 1 && currentMedia && !currentSelector.trim()) {
                currentMedia = '';
            } else if ((depth === 1 && !currentMedia) || (depth === 2 && currentMedia)) {
                const sel = currentSelector.trim().replace(/\s+/g, ' ');
                parsedRules.push({
                    media: currentMedia,
                    selector: sel,
                    startLine: ruleStartLine,
                    endLine: lineNum
                });
                currentSelector = '';
            }
            depth--;
        } else {
            if (depth === 0 || (depth === 1 && currentMedia && !currentSelector.includes('{'))) {
                currentSelector += c;
            }
        }
        idx++;
    }
    if (depth === 0 && currentSelector.trim()) {
        currentSelector += ' ';
    }
}

// Check selector duplication
const selectorMap = new Map<string, CSSRule[]>();
parsedRules.forEach(rule => {
    if (!rule.selector || rule.selector.startsWith('@keyframes') || rule.selector.startsWith('from') || rule.selector.startsWith('to') || rule.selector.includes('%')) return;
    const key = `${rule.media} || ${rule.selector}`;
    if (!selectorMap.has(key)) selectorMap.set(key, []);
    selectorMap.get(key)!.push(rule);
});

selectorMap.forEach((occurrences, key) => {
    if (occurrences.length > 1) {
        const lineStr = occurrences.map(o => `L${o.startLine}-L${o.endLine}`).join(', ');
        errors.push(`Duplicate selector rule '${key.split('||')[1].trim()}' in '${key.split('||')[0].trim() || 'top-level'}' found at lines: ${lineStr}`);
    }
});

// 3. Check for un-scoped mobile selector violations
parsedRules.forEach(rule => {
    if (rule.selector.includes('.is-mobile') && !rule.selector.includes('.is-phone') && !rule.selector.includes('.is-tablet')) {
        // Exclude TouchDragPolyfill / gesture utility classes
        if (!rule.selector.includes('touch') && !rule.selector.includes('drag') && !rule.selector.includes('polyfill')) {
            warnings.push(`Line ${rule.startLine}: Selector '${rule.selector}' uses generic '.is-mobile' without 'body.is-phone' or 'body.is-tablet' scope.`);
        }
    }
});

console.log('🔍 Running styles.css Quality & Compliance Audit...');
if (warnings.length > 0) {
    console.log(`💡 [CSS Warnings] (${warnings.length}):`);
    warnings.forEach(w => console.log(`   - ${w}`));
}

if (errors.length > 0) {
    console.error(`❌ [CSS Errors] (${errors.length}):`);
    errors.forEach(e => console.error(`   - ${e}`));
    console.error('styles.css Audit Failed!');
    process.exit(1);
} else {
    console.log(`✅ styles.css Quality & Compliance Audit passed! (${parsedRules.length} rules audited)`);
}
