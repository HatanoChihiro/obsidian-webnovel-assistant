// Synthetic, local-only comparison with the pre-optimization source. No vault data is read.
// node scripts/performance-benchmark.cjs [baseline-ref]
// node scripts/performance-benchmark.cjs --browser [baseline-ref]
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const browserMode = process.argv.includes('--browser');
const baseline = process.argv.slice(2).find(arg => arg !== '--browser') || '837ac04';
assert.match(baseline, /^[\w./-]+$/);
const source = (file, ref) => ref
    ? execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, file), 'utf8');
const compile = text => ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
}).outputText;
class TFolder { constructor(folderPath) { this.path = folderPath; this.name = folderPath.split('/').pop(); } }
class TFile {
    constructor(filePath) {
        this.path = filePath;
        this.name = filePath.split('/').pop();
        this.basename = this.name.replace(/\.md$/, '');
        this.extension = 'md';
        this.parent = new TFolder(filePath.slice(0, filePath.lastIndexOf('/')));
        this.stat = { mtime: 1, size: 1 };
    }
}
const obsidian = { TFile, TFolder, normalizePath: value => value.replace(/\\/g, '/'), Notice: class {} };
const labels = {
    getDefaultFileName: key => key,
    getDefaultFileNameCandidates: () => [],
    getTimelineLabel: key => key,
    getForeshadowingStatusText: key => key
};
function loader(ref) {
    const modules = new Map();
    const metrics = { cleanups: 0 };
    function load(file) {
        if (modules.has(file)) return modules.get(file);
        const module = { exports: {} };
        modules.set(file, module.exports);
        const localRequire = specifier => {
            if (specifier === 'obsidian') return obsidian;
            if (/\/i18n$/.test(specifier)) return { t: key => key };
            if (/i18n\/data-keys$/.test(specifier)) return labels;
            if (/utils\/path$/.test(specifier)) return { findBookRoot: () => 'Novel' };
            const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)) + '.ts';
            assert.ok(resolved.startsWith('src/'), `Unexpected module: ${resolved}`);
            return load(resolved);
        };
        new Function('require', 'module', 'exports', compile(source(file, ref)))(localRequire, module, module.exports);
        modules.set(file, module.exports);
        if (file === 'src/utils/markdownCleaner.ts') {
            const clean = module.exports.cleanForWordCount;
            module.exports.cleanForWordCount = (...args) => { metrics.cleanups++; return clean(...args); };
        }
        return module.exports;
    }
    return { load, metrics };
}
async function measure(run) {
    for (let i = 0; i < 3; i++) await run();
    const samples = [];
    let result;
    for (let i = 0; i < 21; i++) {
        const start = performance.now();
        result = await run();
        samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return { medianMs: +samples[10].toFixed(3), p95Ms: +samples[19].toFixed(3), result };
}
async function serviceBenchmarks(ref) {
    const { load, metrics } = loader(ref);
    const { ChapterSorter } = load('src/services/ChapterSorter.ts');
    const { TimelineManager } = load('src/services/TimelineManager.ts');
    const { ForeshadowingManager } = load('src/services/ForeshadowingManager.ts');
    const { ForeshadowingStatus } = load('src/types/foreshadowing.ts');
    const { WordCounter } = load('src/services/WordCounter.ts');
    const files = Array.from({ length: 500 }, (_, i) => new TFile(`Novel/第${i + 1}章.md`));
    const plugin = { settings: { customSortOrder: {}, timeline: {}, foreshadowing: {} } };
    const app = { metadataCache: { getFirstLinkpathDest: () => null } };
    ChapterSorter.getAllChapters = () => files;
    let indexes = 0;
    const createIndex = ChapterSorter.createReferenceIndex;
    ChapterSorter.createReferenceIndex = function (...args) { indexes++; return createIndex.apply(this, args); };
    const timeline = new TimelineManager(app, plugin);
    const timelineFile = new TFile('Novel/timeline.md');
    const entries = files.map((file, i) => ({ time: `Day ${i}`, chapter: file.basename, description: '', rawBlock: '' }));
    const linking = await measure(() => {
        indexes = 0;
        const result = timeline.buildChapterToNodesMap(entries, 'Novel', timelineFile);
        assert.equal(result.chapterPathToNodes.size, 500);
        return { indexes, chapters: result.chapterPathToNodes.size };
    });
    const foreshadowing = new ForeshadowingManager(app, plugin);
    foreshadowing.findForeshadowingFile = () => new TFile('Novel/foreshadowing.md');
    foreshadowing.parseEntries = () => files.map(file => ({ sourceFile: file.basename, status: ForeshadowingStatus.Pending }));
    const foreshadowingLinks = await measure(async () => {
        indexes = 0;
        const result = await foreshadowing.buildChapterForeshadowingMap('Novel', files, { cachedRead: async () => '' });
        assert.equal(result.size, 500);
        return { indexes, chapters: result.size };
    });
    let seed = 123;
    const shuffled = Array.from({ length: 1000 }, (_, i) => new TFile(`Novel/第${i + 1}章.md`));
    for (let i = shuffled.length - 1; i > 0; i--) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const j = seed % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let parses = 0;
    const extract = ChapterSorter.extractChapterNumber;
    ChapterSorter.extractChapterNumber = function (...args) { parses++; return extract.apply(this, args); };
    const sorting = await measure(() => {
        parses = 0;
        const comparator = ChapterSorter.createFileComparator
            ? ChapterSorter.createFileComparator({})
            : (a, b) => ChapterSorter.compareFilesWithCustomOrder(a, b, {});
        const sorted = [...shuffled].sort(comparator);
        assert.equal(sorted[0].basename, '第1章');
        assert.equal(sorted[999].basename, '第1000章');
        return { parses };
    });
    const text = '# Synthetic title\n' + '这是合成测试文本 **Markdown** [link](example.md) 。\n'.repeat(1100);
    const counting = await measure(() => {
        const counter = new WordCounter();
        metrics.cleanups = 0;
        let words = 0;
        for (let i = 0; i < 20; i++) words = counter.calculateAccurateWords(text);
        return { cleanups: metrics.cleanups, words, characters: text.length };
    });
    return { linking, foreshadowingLinks, sorting, counting };
}
if (browserMode) {
    // A small localhost fixture uses the actual renderer and CSS in a real browser.
    const modules = ['src/ui/components/TrajectoryBoardRenderer.ts', 'src/services/TimelineManager.ts'];
    const payloads = Object.fromEntries(['before', 'after'].map(version => {
        const ref = version === 'before' ? baseline : null;
        return [version, { css: source('src/styles/views/timeline-trajectory.css', ref), renderer: compile(source(modules[0], ref)), timeline: compile(source(modules[1], ref)) }];
    }));
    const harness = fs.readFileSync(path.join(__dirname, 'performance-browser-fixture.html'), 'utf8');
    const http = require('node:http');
    const server = http.createServer((req, res) => {
        if (req.url === '/payload.js') {
            res.setHeader('Content-Type', 'application/javascript');
            res.end(`const benchmarkPayloads = ${JSON.stringify(payloads)};`);
        } else if (req.url === '/') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(harness);
        } else { res.statusCode = 404; res.end(); }
    });
    server.listen(18765, '127.0.0.1', () => console.log('Synthetic fixture: http://127.0.0.1:18765/'));
} else {
    (async () => console.log(JSON.stringify({ baseline, runtime: process.version, before: await serviceBenchmarks(baseline), after: await serviceBenchmarks(null) }, null, 2)))()
        .catch(error => { console.error(error); process.exitCode = 1; });
}
