import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TypographyManager } from '../src/services/TypographyManager';
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
});
