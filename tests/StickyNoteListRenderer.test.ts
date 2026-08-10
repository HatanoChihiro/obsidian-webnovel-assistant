import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('obsidian', async () => {
	const actual = await vi.importActual<typeof import('obsidian')>('obsidian');
	return {
		...actual,
		FuzzySuggestModal: class<T> {
			constructor(_app: unknown) {}
			setPlaceholder(_placeholder: string): void {}
			open(): void {}
		}
	};
});

import { TFile } from 'obsidian';
import { getStickyNoteFileCandidates } from '../src/ui/components/StickyNoteListRenderer';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';

describe('StickyNoteListRenderer file candidates', () => {
	it('includes non-chapter Markdown files', () => {
		const chapter = new TFile('第一章.md', '作品/第一章.md');
		const novelInfo = new TFile('作品信息.md', '作品/作品信息.md');
		const plugin = {
			getVaultMarkdownFiles: () => [chapter, novelInfo]
		} as Pick<WebNovelAssistantPlugin, 'getVaultMarkdownFiles'>;

		expect(getStickyNoteFileCandidates(plugin)).toEqual([chapter, novelInfo]);
	});
});

describe('StickyNoteListRenderer immersive layout', () => {
	it('keeps cards in a bounded, scrollable grid and applies body font size as a style', () => {
		const css = readFileSync(resolve(process.cwd(), 'src/styles/features/sticky-notes.css'), 'utf8');
		const renderer = readFileSync(resolve(process.cwd(), 'src/ui/components/StickyNoteListRenderer.ts'), 'utf8');
		const immersiveModeManager = readFileSync(resolve(process.cwd(), 'src/ui/ImmersiveModeManager.ts'), 'utf8');
		const settingsTab = readFileSync(resolve(process.cwd(), 'src/ui/SettingsTab.ts'), 'utf8');

		expect(css).toContain('grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 300px));');
		expect(css).toContain('grid-auto-rows: minmax(240px, 300px);');
		expect(css).toContain('overflow-y: auto;');
		expect(css).toContain('max-width: 300px;');
		expect(css).toContain('font-size: var(--font-ui-medium, 1rem);');
		expect(css).toContain('.webnovel-immersive-slot-horizontal .webnovel-immersive-sticky-container .immersive-sticky-dock');
		expect(css).toContain('grid-auto-flow: column;');
		expect(css).toContain('overflow-x: auto;');
		expect(css).toContain('.webnovel-immersive-slot-vertical .webnovel-immersive-sticky-container .immersive-sticky-dock');
		expect(css).toContain('grid-auto-flow: row;');
		expect(renderer).toContain('new ResizeObserver');
		expect(renderer).toContain('--wn-immersive-note-grid-lines');
		expect(renderer).toContain('--wn-immersive-note-grid-size');
		expect(css).toMatch(/\.wn-sticky-note-list-side-panel\s*\{[^}]*overflow:\s*hidden;/s);
		expect(css).toMatch(/\.wn-sticky-note-list-grid\s*\{[^}]*overflow-y:\s*auto;/s);
		expect(renderer).toContain('observeSidePanelGrid(dockContainer)');
		expect(renderer).toContain("'--wn-side-note-grid-columns': String(columnCount)");
		expect(renderer).toContain("'--wn-side-note-grid-size': `${noteSize}px`");
		expect(css).toContain('grid-auto-rows: var(--wn-side-note-grid-size, auto);');
		expect(css).toMatch(/\.wn-sticky-note-list-side-panel \.wn-sticky-note-list-card\s*\{[^}]*width:\s*var\(--wn-side-note-grid-size, 100%\);[^}]*height:\s*var\(--wn-side-note-grid-size, auto\);/s);
		expect(renderer).toContain('textarea.setCssStyles({ fontSize:');
		expect(renderer).not.toContain('textarea.setCssProps({ fontSize:');
		expect(immersiveModeManager).toContain('webnovel-immersive-slot-horizontal');
		expect(immersiveModeManager).toContain('webnovel-immersive-slot-vertical');
		const stickySettingsStart = settingsTab.indexOf('private displayStickyNoteSettings');
		const immersiveSettingsStart = settingsTab.indexOf('private displayImmersiveModeSettings');
		const stickySettings = settingsTab.slice(stickySettingsStart, immersiveSettingsStart);
		const immersiveSettings = settingsTab.slice(immersiveSettingsStart);
		expect(stickySettings).toContain("setting.sticky-note-list-font-size");
		expect(stickySettings).toContain('this.plugin.stickyNoteManager.refreshImmersiveNotes()');
		expect(immersiveSettings).not.toContain("setting.sticky-note-list-font-size");
	});
});
