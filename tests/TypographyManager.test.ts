import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TypographyManager } from '../src/services/TypographyManager';
import type { App } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';
import { TFile } from 'obsidian';

describe('TypographyManager', () => {
	let mockPlugin: WebNovelAssistantPlugin;
	let manager: TypographyManager;

	beforeEach(() => {
		mockPlugin = {
			settings: {
				homepagePath: '创作主页.md',
				workspaceFolders: ['Work Novel'],
				typography: {
					enabled: true,
					applyToChapters: true,
					applyToLore: true,
					applyToNovelInfo: true,
					applyToTimeline: true,
					applyToForeshadowing: true,
					applyToTask: true,
					enableBodyFontSize: true,
					bodyFontSize: 20
				}
			},
			cacheManager: {
				isFileInWorkspace: vi.fn((file: TFile) => {
					return file.path.startsWith('Work Novel/');
				})
			}
		} as unknown as WebNovelAssistantPlugin;

		manager = new TypographyManager({ workspace: { getLeavesOfType: () => [] } } as any, mockPlugin);
	});

	it('applies body font size only through the typography variable on registered previews', () => {
		const setProperty = vi.fn();
		const removeProperty = vi.fn();
		const preview = {
			addClass: vi.fn(),
			removeClass: vi.fn(),
			style: { setProperty, removeProperty }
		} as unknown as HTMLElement;

		manager.registerPreviewElement(preview);
		expect(setProperty).toHaveBeenCalledWith('--wn-type-font-size', '20px');

		mockPlugin.settings.typography.bodyFontSize = 24;
		manager.updateTypography();
		expect(setProperty).toHaveBeenCalledWith('--wn-type-font-size', '24px');

		manager.unregisterPreviewElement(preview);
		expect(removeProperty).toHaveBeenCalledWith('--wn-type-font-size');
	});

	it('removes the custom font-size variable when body size control is disabled', () => {
		const removeProperty = vi.fn();
		const preview = {
			addClass: vi.fn(),
			removeClass: vi.fn(),
			style: { setProperty: vi.fn(), removeProperty }
		} as unknown as HTMLElement;

		mockPlugin.settings.typography.enableBodyFontSize = false;
		manager.registerPreviewElement(preview);

		expect(removeProperty).toHaveBeenCalledWith('--wn-type-font-size');
	});

	it('applies card indent to every workspace document and cleans it up', () => {
		const createDocumentMock = () => {
			const body = {
				addClass: vi.fn(),
				removeClass: vi.fn(),
				style: {
					setProperty: vi.fn(),
					removeProperty: vi.fn()
				}
			};
			return { body, document: { body } as unknown as Document };
		};
		const main = createDocumentMock();
		const secondary = createDocumentMock();
		const app = {
			workspace: {
				containerEl: { ownerDocument: main.document },
				getLeavesOfType: () => [],
				iterateAllLeaves: (callback: (leaf: { containerEl: { ownerDocument: Document } }) => void) => {
					callback({ containerEl: { ownerDocument: secondary.document } });
				}
			}
		} as unknown as App;
		const cardManager = new TypographyManager(app, mockPlugin);

		mockPlugin.settings.typography.applyToCards = true;
		mockPlugin.settings.typography.enableIndent = true;
		mockPlugin.settings.typography.enableReadingModeCompat = true;
		mockPlugin.settings.typography.indentSize = '3em';
		cardManager.updateCardTypography();

		expect(main.body.addClass).toHaveBeenCalledWith('wn-card-indent-active');
		expect(secondary.body.addClass).toHaveBeenCalledWith('wn-card-indent-active');
		expect(main.body.addClass).toHaveBeenCalledWith('wn-card-reading-compat-active');
		expect(main.body.style.setProperty).toHaveBeenCalledWith('--wn-card-indent', '3em');

		mockPlugin.settings.typography.enableIndent = false;
		cardManager.updateCardTypography();
		expect(main.body.removeClass).toHaveBeenCalledWith('wn-card-indent-active');
		expect(main.body.removeClass).toHaveBeenCalledWith('wn-card-reading-compat-active');
		expect(main.body.style.removeProperty).toHaveBeenCalledWith('--wn-card-indent');

		mockPlugin.settings.typography.enableIndent = true;
		cardManager.destroy();
		expect(secondary.body.removeClass).toHaveBeenCalledWith('wn-card-indent-active');
		expect(secondary.body.removeClass).toHaveBeenCalledWith('wn-card-reading-compat-active');
		expect(secondary.body.style.removeProperty).toHaveBeenCalledWith('--wn-card-indent');
	});

	it('should apply typography to chapter files INSIDE workspace', () => {
		const fileInWorkspace = new TFile();
		fileInWorkspace.path = 'Work Novel/第01章 测试.md';
		fileInWorkspace.name = '第01章 测试.md';

		expect(manager.shouldApplyTypography(fileInWorkspace)).toBe(true);
	});

	it('should NOT apply typography to chapter files OUTSIDE workspace', () => {
		const fileOutsideWorkspace = new TFile();
		fileOutsideWorkspace.path = 'Random Notes/第01章 日常笔记.md';
		fileOutsideWorkspace.name = '第01章 日常笔记.md';

		expect(manager.shouldApplyTypography(fileOutsideWorkspace)).toBe(false);
	});

	it('should handle applyToOther setting for non-chapter non-functional files inside workspace', () => {
		const outlineFile = new TFile();
		outlineFile.path = 'Work Novel/全书大纲.md';
		outlineFile.name = '全书大纲.md';

		// Default applyToOther is false/undefined in initial mock
		expect(manager.shouldApplyTypography(outlineFile)).toBe(false);

		// Enable applyToOther
		mockPlugin.settings.typography.applyToOther = true;
		expect(manager.shouldApplyTypography(outlineFile)).toBe(true);

		// Disable applyToOther
		mockPlugin.settings.typography.applyToOther = false;
		expect(manager.shouldApplyTypography(outlineFile)).toBe(false);
	});

	it('applies typography to ordinary files across the vault when enableGlobal is true', () => {
		const chapterOutside = new TFile();
		chapterOutside.path = 'Random Notes/第01章 日常笔记.md';
		chapterOutside.name = '第01章 日常笔记.md';

		const noteOutside = new TFile();
		noteOutside.path = 'Personal/灵感草稿.md';
		noteOutside.name = '灵感草稿.md';

		// When enableGlobal is false
		mockPlugin.settings.typography.enableGlobal = false;
		expect(manager.shouldApplyTypography(chapterOutside)).toBe(false);
		expect(manager.shouldApplyTypography(noteOutside)).toBe(false);

		// When enableGlobal is true
		mockPlugin.settings.typography.enableGlobal = true;
		mockPlugin.settings.typography.applyToChapters = false;
		mockPlugin.settings.typography.applyToOther = false;

		// Ordinary documents anywhere in vault receive typography
		expect(manager.shouldApplyTypography(chapterOutside)).toBe(true);
		expect(manager.shouldApplyTypography(noteOutside)).toBe(true);
	});

	it('preserves functional documents controls and homepage exclusion when enableGlobal is true', () => {
		mockPlugin.settings.typography.enableGlobal = true;

		// 1. Homepage remains excluded
		const homepage = new TFile();
		homepage.path = '创作主页.md';
		homepage.name = '创作主页.md';
		expect(manager.shouldApplyTypography(homepage)).toBe(false);

		// 2. Lore file obeys applyToLore
		const loreFile = new TFile();
		loreFile.path = 'Work Novel/设定/主角.md';
		loreFile.name = '主角.md';
		loreFile.parent = { name: '设定', isRoot: () => false, parent: null } as never;

		mockPlugin.settings.typography.applyToLore = false;
		expect(manager.shouldApplyTypography(loreFile)).toBe(false);
		mockPlugin.settings.typography.applyToLore = true;
		expect(manager.shouldApplyTypography(loreFile)).toBe(true);

		// 3. Novel info obeys applyToNovelInfo
		const novelInfo = new TFile();
		novelInfo.path = 'Work Novel/作品信息.md';
		novelInfo.name = '作品信息.md';
		mockPlugin.settings.typography.applyToNovelInfo = false;
		expect(manager.shouldApplyTypography(novelInfo)).toBe(false);
		mockPlugin.settings.typography.applyToNovelInfo = true;
		expect(manager.shouldApplyTypography(novelInfo)).toBe(true);

		// 4. Timeline obeys applyToTimeline
		const timeline = new TFile();
		timeline.path = 'Work Novel/时间线.md';
		timeline.name = '时间线.md';
		mockPlugin.settings.typography.applyToTimeline = false;
		expect(manager.shouldApplyTypography(timeline)).toBe(false);
		mockPlugin.settings.typography.applyToTimeline = true;
		expect(manager.shouldApplyTypography(timeline)).toBe(true);

		// 5. Foreshadowing obeys applyToForeshadowing
		const foreshadowing = new TFile();
		foreshadowing.path = 'Work Novel/伏笔.md';
		foreshadowing.name = '伏笔.md';
		mockPlugin.settings.typography.applyToForeshadowing = false;
		expect(manager.shouldApplyTypography(foreshadowing)).toBe(false);
		mockPlugin.settings.typography.applyToForeshadowing = true;
		expect(manager.shouldApplyTypography(foreshadowing)).toBe(true);

		// 6. Task obeys applyToTask
		const task = new TFile();
		task.path = 'Work Novel/限时任务.md';
		task.name = '限时任务.md';
		mockPlugin.settings.typography.applyToTask = false;
		expect(manager.shouldApplyTypography(task)).toBe(false);
		mockPlugin.settings.typography.applyToTask = true;
		expect(manager.shouldApplyTypography(task)).toBe(true);
	});

	it('strictly rejects outside-workspace functional documents when enableGlobal is false, and obeys dedicated switch when enableGlobal is true', () => {
		const outsideLoreFile = new TFile();
		outsideLoreFile.path = 'Random Notes/设定/外部主角.md';
		outsideLoreFile.name = '外部主角.md';
		outsideLoreFile.parent = { name: '设定', isRoot: () => false, parent: null } as never;

		const outsideTimelineFile = new TFile();
		outsideTimelineFile.path = 'Random Notes/时间线.md';
		outsideTimelineFile.name = '时间线.md';

		const outsideNovelInfoFile = new TFile();
		outsideNovelInfoFile.path = 'Random Notes/作品信息.md';
		outsideNovelInfoFile.name = '作品信息.md';

		// 1. When enableGlobal is false: even if dedicated switch is true, outside workspace must return false
		mockPlugin.settings.typography.enableGlobal = false;
		mockPlugin.settings.typography.applyToLore = true;
		mockPlugin.settings.typography.applyToTimeline = true;
		mockPlugin.settings.typography.applyToNovelInfo = true;

		expect(manager.shouldApplyTypography(outsideLoreFile)).toBe(false);
		expect(manager.shouldApplyTypography(outsideTimelineFile)).toBe(false);
		expect(manager.shouldApplyTypography(outsideNovelInfoFile)).toBe(false);

		// 2. When enableGlobal is true: obeys the dedicated switch value (both true and false cases)
		mockPlugin.settings.typography.enableGlobal = true;

		// When dedicated switch is true -> returns true
		mockPlugin.settings.typography.applyToLore = true;
		mockPlugin.settings.typography.applyToTimeline = true;
		mockPlugin.settings.typography.applyToNovelInfo = true;
		expect(manager.shouldApplyTypography(outsideLoreFile)).toBe(true);
		expect(manager.shouldApplyTypography(outsideTimelineFile)).toBe(true);
		expect(manager.shouldApplyTypography(outsideNovelInfoFile)).toBe(true);

		// When dedicated switch is false -> returns false
		mockPlugin.settings.typography.applyToLore = false;
		mockPlugin.settings.typography.applyToTimeline = false;
		mockPlugin.settings.typography.applyToNovelInfo = false;
		expect(manager.shouldApplyTypography(outsideLoreFile)).toBe(false);
		expect(manager.shouldApplyTypography(outsideTimelineFile)).toBe(false);
		expect(manager.shouldApplyTypography(outsideNovelInfoFile)).toBe(false);
	});
});
