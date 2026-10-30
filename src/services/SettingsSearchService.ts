import { t } from '../i18n';
import { WORKBENCH_BOARD_IDS, WORKBENCH_BOARD_LABEL_KEYS } from '../ui/workbenchBoards';
import { getPlatformTier } from '../utils/platform';

export type SettingsCategoryId =
	| 'general'
	| 'typography'
	| 'proofreading'
	| 'wordcount'
	| 'creative'
	| 'immersive'
	| 'obs';

export type SettingsPlatformRule = 'all' | 'desktop' | 'mobile';

export type SettingsPlatformTier = 'desktop' | 'tablet' | 'mobile';

export interface SettingCatalogueEntry {
	readonly id: string;
	readonly category: SettingsCategoryId;
	readonly categoryNameKey: string;
	readonly titleKey: string;
	readonly descKeys: readonly string[];
	readonly descParams?: Readonly<Record<string, string | number>>;
	readonly sectionKey?: string;
	readonly fallbackKeys?: readonly string[];
	readonly platform: SettingsPlatformRule;
	readonly isHeading?: boolean;
}

export interface SettingSearchResult {
	readonly entry: SettingCatalogueEntry;
	readonly categoryLabel: string;
	readonly sectionLabel: string;
	readonly title: string;
	readonly description: string;
	readonly matchTier: number;
}

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export const SETTINGS_CATEGORY_NAME_KEYS: Readonly<Record<SettingsCategoryId, string>> = {
	general: 'setting.tab-general',
	typography: 'setting.tab-typography',
	proofreading: 'setting.proofreading-title',
	wordcount: 'setting.tab-wordcount',
	creative: 'setting.tab-creative',
	immersive: 'setting.tab-immersive',
	obs: 'setting.tab-obs'
};

type SettingDefinition = Pick<SettingCatalogueEntry, 'titleKey'> & Partial<Pick<SettingCatalogueEntry,
	'descKeys' | 'descParams' | 'sectionKey' | 'fallbackKeys' | 'platform' | 'isHeading'>>;

function categoryEntries(category: SettingsCategoryId, definitions: readonly SettingDefinition[]): SettingCatalogueEntry[] {
	return definitions.map(definition => ({
		...definition,
		id: `${category}:${definition.titleKey}`,
		category,
		categoryNameKey: SETTINGS_CATEGORY_NAME_KEYS[category],
		descKeys: definition.descKeys ?? [],
		platform: definition.platform ?? (category === 'immersive' || category === 'obs' ? 'desktop' : 'all')
	}));
}

// Mirrors the settings labels, sections and conditional parent switches in SettingsTab.
export const SETTINGS_SEARCH_CATALOGUE: readonly SettingCatalogueEntry[] = [
	...categoryEntries('general', [
		{ titleKey: 'setting.show-floating-stats', descKeys: ['setting.show-floating-stats-desc'], platform: 'mobile' },
		{ titleKey: 'setting.enable-mobile-focus-timer', descKeys: ['setting.enable-mobile-focus-timer-desc'], platform: 'mobile' },
		{ titleKey: 'setting.idle-threshold', descKeys: ['setting.idle-threshold-desc'], fallbackKeys: ['setting.enable-mobile-focus-timer'], platform: 'mobile' },
		{ titleKey: 'setting.language', descKeys: ['setting.language-desc'] },
		{ titleKey: 'setting.workspace-and-chapters', isHeading: true },
		{ titleKey: 'setting.novel-info-filename', descKeys: ['setting.novel-info-filename-desc'], sectionKey: 'setting.workspace-and-chapters' },
		{ titleKey: 'setting.enable-homepage', descKeys: ['setting.enable-homepage-desc'], sectionKey: 'setting.workspace-and-chapters' },
		{ titleKey: 'setting.open-homepage-on-startup', descKeys: ['setting.open-homepage-on-startup-desc'], sectionKey: 'setting.workspace-and-chapters', fallbackKeys: ['setting.enable-homepage'] },
		{ titleKey: 'setting.custom-homepage-filename', descKeys: ['setting.custom-homepage-filename-desc'], sectionKey: 'setting.workspace-and-chapters', fallbackKeys: ['setting.enable-homepage'] },
		{ titleKey: 'setting.custom-welcome', descKeys: ['setting.custom-welcome-desc'], sectionKey: 'setting.workspace-and-chapters', fallbackKeys: ['setting.enable-homepage'] },
		{ titleKey: 'setting.homepage-pin-position', descKeys: ['setting.homepage-pin-position-desc'], sectionKey: 'setting.workspace-and-chapters', fallbackKeys: ['setting.enable-homepage'] },
		{ titleKey: 'setting.workspace-folders', descKeys: ['setting.workspace-folders-desc'], sectionKey: 'setting.workspace-and-chapters' },
		{ titleKey: 'setting.strict-chapter-mode', descKeys: ['setting.strict-chapter-mode-desc'], sectionKey: 'setting.workspace-and-chapters' },
		{ titleKey: 'setting.exception-directories', descKeys: ['setting.exception-directories-desc'], sectionKey: 'setting.workspace-and-chapters', fallbackKeys: ['setting.strict-chapter-mode'] },
		{ titleKey: 'setting.chapter-template', descKeys: ['setting.chapter-template-desc'], sectionKey: 'setting.workspace-and-chapters' },
		{ titleKey: 'setting.chapter-template-list', descKeys: ['setting.chapter-template-list-desc'], sectionKey: 'setting.workspace-and-chapters', fallbackKeys: ['setting.chapter-template'] },
		{ titleKey: 'setting.smart-chapter-sort', descKeys: ['setting.smart-chapter-sort-desc'], sectionKey: 'setting.workspace-and-chapters' },
		{ titleKey: 'setting.sorting-rules', sectionKey: 'setting.workspace-and-chapters', fallbackKeys: ['setting.smart-chapter-sort'], isHeading: true },
		{ titleKey: 'setting.workbench-boards-visibility', descKeys: ['setting.workbench-boards-visibility-desc'], sectionKey: 'setting.workspace-and-chapters' },
		...WORKBENCH_BOARD_IDS.map(boardId => ({
			titleKey: WORKBENCH_BOARD_LABEL_KEYS[boardId],
			sectionKey: 'setting.workbench-boards-visibility',
			descKeys: ['setting.workbench-boards-visibility-desc']
		}))
	]),
	...categoryEntries('typography', [
		{ titleKey: 'setting.eyecare-mode', isHeading: true },
		{ titleKey: 'setting.enable-eyecare', descKeys: ['setting.enable-eyecare-desc'], sectionKey: 'setting.eyecare-mode' },
		{ titleKey: 'setting.eyecare-bg-color', descKeys: ['setting.eyecare-bg-color-desc'], sectionKey: 'setting.eyecare-mode' },
		{ titleKey: 'setting.tab-typography', isHeading: true },
		{ titleKey: 'setting.typography-master-toggle', descKeys: ['setting.typography-master-toggle-desc'], sectionKey: 'setting.tab-typography' },
		{ titleKey: 'setting.typography-scope-heading', fallbackKeys: ['setting.typography-master-toggle'], isHeading: true },
		{ titleKey: 'setting.typography-enable-global', descKeys: ['setting.typography-enable-global-desc'], sectionKey: 'setting.typography-scope-heading', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-apply-chapters', descKeys: ['setting.typography-apply-chapters-desc'], sectionKey: 'setting.typography-scope-heading', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-apply-other', descKeys: ['setting.typography-apply-other-desc'], sectionKey: 'setting.typography-scope-heading', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-apply-cards', descKeys: ['setting.typography-apply-cards-desc'], sectionKey: 'setting.typography-scope-heading', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-scope-functional', descKeys: ['setting.typography-scope-functional-desc'], sectionKey: 'setting.typography-scope-heading', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-apply-lore', descKeys: ['setting.typography-scope-functional-desc'], sectionKey: 'setting.typography-scope-functional', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-apply-novel-info', descKeys: ['setting.typography-scope-functional-desc'], sectionKey: 'setting.typography-scope-functional', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-apply-timeline', descKeys: ['setting.typography-scope-functional-desc'], sectionKey: 'setting.typography-scope-functional', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-apply-foreshadowing', descKeys: ['setting.typography-scope-functional-desc'], sectionKey: 'setting.typography-scope-functional', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-apply-task', descKeys: ['setting.typography-scope-functional-desc'], sectionKey: 'setting.typography-scope-functional', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-details-heading', fallbackKeys: ['setting.typography-master-toggle'], isHeading: true },
		{ titleKey: 'setting.typography-header-align', sectionKey: 'setting.typography-details-heading', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-enable-body-font-size', descKeys: ['setting.typography-enable-body-font-size-desc'], sectionKey: 'setting.typography-details-heading', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-body-font-size', descKeys: ['setting.typography-body-font-size-desc'], sectionKey: 'setting.typography-details-heading', fallbackKeys: ['setting.typography-enable-body-font-size', 'setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-enable-indent', sectionKey: 'setting.typography-details-heading', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-indent-size', descKeys: ['setting.typography-indent-size-desc'], sectionKey: 'setting.typography-details-heading', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-line-height', descKeys: ['setting.typography-line-height-desc'], sectionKey: 'setting.typography-details-heading', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-para-spacing', descKeys: ['setting.typography-para-spacing-desc'], sectionKey: 'setting.typography-details-heading', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-letter-spacing', descKeys: ['setting.typography-letter-spacing-desc'], sectionKey: 'setting.typography-details-heading', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-max-line-width', descKeys: ['setting.typography-max-line-width-desc'], sectionKey: 'setting.typography-details-heading', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-justify-text', descKeys: ['setting.typography-justify-text-desc'], sectionKey: 'setting.typography-details-heading', fallbackKeys: ['setting.typography-master-toggle'] },
		{ titleKey: 'setting.typography-reading-compat', descKeys: ['setting.typography-reading-compat-desc'], sectionKey: 'setting.typography-details-heading', fallbackKeys: ['setting.typography-master-toggle'] },
	]),
	...categoryEntries('proofreading', [
		{ titleKey: 'setting.proofreading-title', isHeading: true },
		{ titleKey: 'setting.proofreading-enable', descKeys: ['setting.proofreading-enable-desc'], sectionKey: 'setting.proofreading-title' },
		{ titleKey: 'setting.proofreading-enable-global', descKeys: ['setting.proofreading-enable-global-desc'], sectionKey: 'setting.proofreading-title' },
		{ titleKey: 'setting.proofreading-dict-folder', descKeys: ['setting.proofreading-dict-folder-desc'], sectionKey: 'setting.proofreading-title' },
		{ titleKey: 'setting.proofreading-regenerate-templates', descKeys: ['setting.proofreading-regenerate-templates-desc'], sectionKey: 'setting.proofreading-title' },
		{ titleKey: 'setting.proofreading-enable-punctuation', descKeys: ['setting.proofreading-enable-punctuation-desc'], sectionKey: 'setting.proofreading-title' },
		{ titleKey: 'setting.proofreading-enable-dedide', descKeys: ['setting.proofreading-enable-dedide-desc'], sectionKey: 'setting.proofreading-title' },
		{ titleKey: 'setting.proofreading-basic-dict', descKeys: ['setting.proofreading-basic-dict-desc'], sectionKey: 'setting.proofreading-title' },
		{ titleKey: 'setting.proofreading-dedide-dict', descKeys: ['setting.proofreading-dedide-dict-desc'], sectionKey: 'setting.proofreading-title' },
		{ titleKey: 'setting.proofreading-ignored-heading', isHeading: true },
		{ titleKey: 'setting.proofreading-ignored-status', descKeys: ['setting.proofreading-ignored-status-desc'], sectionKey: 'setting.proofreading-ignored-heading', descParams: {"words":"-","contexts":"-"} },
		{ titleKey: 'setting.proofreading-ignored-words-list', descKeys: ['setting.proofreading-ignored-words-list-desc'], sectionKey: 'setting.proofreading-ignored-heading' },
		{ titleKey: 'setting.proofreading-ignored-contexts-list', descKeys: ['setting.proofreading-ignored-contexts-list-desc'], sectionKey: 'setting.proofreading-ignored-heading' },
	]),
	...categoryEntries('wordcount', [
		{ titleKey: 'setting.word-count-display', isHeading: true },
		{ titleKey: 'setting.word-count-mode', descKeys: ['setting.word-count-mode-desc'], sectionKey: 'setting.word-count-display' },
		{ titleKey: 'setting.include-footnotes', descKeys: ['setting.include-footnotes-desc'], sectionKey: 'setting.word-count-display' },
		{ titleKey: 'setting.show-status-bar-progress', descKeys: ['setting.show-status-bar-progress-desc'], sectionKey: 'setting.word-count-display' },
		{ titleKey: 'setting.show-explorer-counts', descKeys: ['setting.show-explorer-counts-desc'], sectionKey: 'setting.word-count-display' },
		{ titleKey: 'setting.enable-selection-count', descKeys: ['setting.enable-selection-count-desc'], sectionKey: 'setting.word-count-display' },
		{ titleKey: 'setting.word-count-gutter', descKeys: ['setting.word-count-gutter-desc'], sectionKey: 'setting.word-count-display', platform: 'desktop' },
		{ titleKey: 'setting.word-count-interval', descKeys: ['setting.word-count-interval-desc'], sectionKey: 'setting.word-count-display', fallbackKeys: ['setting.word-count-gutter'], platform: 'desktop' },
		{ titleKey: 'setting.writing-goals', isHeading: true },
		{ titleKey: 'setting.default-chapter-goal', descKeys: ['setting.default-chapter-goal-desc'], sectionKey: 'setting.writing-goals' },
		{ titleKey: 'setting.daily-goal', descKeys: ['setting.daily-goal-desc'], sectionKey: 'setting.writing-goals' },
	]),
	...categoryEntries('creative', [
		{ titleKey: 'setting.editor-typewriter-title', isHeading: true },
		{ titleKey: 'setting.editor-typewriter-enable', descKeys: ['setting.editor-typewriter-enable-desc'], sectionKey: 'setting.editor-typewriter-title' },
		{ titleKey: 'setting.editor-typewriter-offset', descKeys: ['setting.editor-typewriter-offset-desc'], sectionKey: 'setting.editor-typewriter-title' },
		{ titleKey: 'setting.editor-typewriter-opacity', descKeys: ['setting.editor-typewriter-opacity-desc'], sectionKey: 'setting.editor-typewriter-title' },
		{ titleKey: 'setting.sticky-notes', isHeading: true },
		{ titleKey: 'setting.idle-opacity', sectionKey: 'setting.sticky-notes', platform: 'desktop' },
		{ titleKey: 'setting.sticky-note-autosave', descKeys: ['setting.sticky-note-autosave-desc'], sectionKey: 'setting.sticky-notes' },
		{ titleKey: 'setting.sticky-note-list-font-size', descKeys: ['setting.sticky-note-list-font-size-desc'], sectionKey: 'setting.sticky-notes' },
		{ titleKey: 'setting.theme-colors', descKeys: ['setting.theme-colors-desc'], sectionKey: 'setting.sticky-notes' },
		{ titleKey: 'setting.foreshadowing', isHeading: true },
		{ titleKey: 'setting.foreshadowing-filename', descKeys: ['setting.foreshadowing-filename-desc'], sectionKey: 'setting.foreshadowing' },
		{ titleKey: 'setting.common-tags', descKeys: ['setting.common-tags-desc'], sectionKey: 'setting.foreshadowing' },
		{ titleKey: 'setting.timeline', isHeading: true },
		{ titleKey: 'setting.timeline-filename', descKeys: ['setting.timeline-filename-desc'], sectionKey: 'setting.timeline' },
		{ titleKey: 'setting.timeline-default-types', descKeys: ['setting.timeline-default-types-desc'], sectionKey: 'setting.timeline' },
		{ titleKey: 'setting.task-tracking', isHeading: true },
		{ titleKey: 'setting.task-filename', descKeys: ['setting.task-filename-desc'], sectionKey: 'setting.task-tracking' },
		{ titleKey: 'setting.lore-lookup', isHeading: true },
		{ titleKey: 'setting.lore-folder-name', descKeys: ['setting.lore-folder-name-desc-prefix', 'setting.lore-folder-name-desc-hint', 'setting.lore-folder-name-desc'], sectionKey: 'setting.lore-lookup' },
		{ titleKey: 'setting.series-lore-folder-name', descKeys: ['setting.series-lore-folder-name-desc'], sectionKey: 'setting.lore-lookup' },
		{ titleKey: 'setting.enable-mobile-lore-popover', descKeys: ['setting.enable-mobile-lore-popover-desc'], sectionKey: 'setting.lore-lookup', platform: 'mobile' },
		{ titleKey: 'setting.lore-popover-collapse', descKeys: ['setting.lore-popover-collapse-desc'], sectionKey: 'setting.lore-lookup' },
		{ titleKey: 'setting.lore-card-preview-enabled', descKeys: ['setting.lore-card-preview-enabled-desc'], sectionKey: 'setting.lore-lookup' },
		{ titleKey: 'setting.lore-card-hover-preview', descKeys: ['setting.lore-card-hover-preview-desc'], sectionKey: 'setting.lore-lookup', fallbackKeys: ['setting.lore-card-preview-enabled'] },
		{ titleKey: 'setting.lore-card-preview-persistent', descKeys: ['setting.lore-card-preview-persistent-desc'], sectionKey: 'setting.lore-lookup', fallbackKeys: ['setting.lore-card-preview-enabled'] },
		{ titleKey: 'setting.lore-card-preview-max-count', descKeys: ['setting.lore-card-preview-max-count-desc'], sectionKey: 'setting.lore-lookup', fallbackKeys: ['setting.lore-card-preview-enabled'] },
		{ titleKey: 'setting.lore-graph-auto-link-mentions', descKeys: ['setting.lore-graph-auto-link-mentions-desc'], sectionKey: 'setting.lore-lookup' },
		{ titleKey: 'setting.lore-graph-enable-global', descKeys: ['setting.lore-graph-enable-global-desc'], sectionKey: 'setting.lore-lookup' },
	]),
	...categoryEntries('immersive', [
		{ titleKey: 'setting.immersive-layout-builder', descKeys: ['setting.immersive-layout-builder-desc'], isHeading: true },
		{ titleKey: 'setting.immersive-hide-properties', descKeys: ['setting.immersive-hide-properties-desc'], sectionKey: 'setting.immersive-layout-builder' },
		{ titleKey: 'setting.immersive-typewriter-title', isHeading: true },
		{ titleKey: 'setting.immersive-typewriter-enable', descKeys: ['setting.immersive-typewriter-enable-desc'], sectionKey: 'setting.immersive-typewriter-title' },
		{ titleKey: 'setting.immersive-typewriter-offset', descKeys: ['setting.immersive-typewriter-offset-desc'], sectionKey: 'setting.immersive-typewriter-title' },
		{ titleKey: 'setting.immersive-typewriter-opacity', descKeys: ['setting.immersive-typewriter-opacity-desc'], sectionKey: 'setting.immersive-typewriter-title' },
		{ titleKey: 'setting.immersive-pomodoro-title', isHeading: true },
		{ titleKey: 'setting.immersive-pomodoro-enabled', descKeys: ['setting.immersive-pomodoro-enabled-desc'], sectionKey: 'setting.immersive-pomodoro-title' },
		{ titleKey: 'setting.immersive-pomodoro-interval', descKeys: ['setting.immersive-pomodoro-interval-desc'], sectionKey: 'setting.immersive-pomodoro-title' },
		{ titleKey: 'setting.immersive-dashboard-toggles', isHeading: true },
		{ titleKey: 'setting.show-total-time', sectionKey: 'setting.immersive-dashboard-toggles' },
		{ titleKey: 'setting.show-focus-time', sectionKey: 'setting.immersive-dashboard-toggles' },
		{ titleKey: 'setting.show-slack-time', sectionKey: 'setting.immersive-dashboard-toggles' },
		{ titleKey: 'setting.show-chapter-progress', sectionKey: 'setting.immersive-dashboard-toggles' },
		{ titleKey: 'setting.show-daily-progress', sectionKey: 'setting.immersive-dashboard-toggles' },
		{ titleKey: 'setting.show-task-progress', sectionKey: 'setting.immersive-dashboard-toggles' },
		{ titleKey: 'setting.show-session-words', sectionKey: 'setting.immersive-dashboard-toggles' },
		{ titleKey: 'setting.show-current-time', sectionKey: 'setting.immersive-dashboard-toggles' },
	]),
	...categoryEntries('obs', [
		{ titleKey: 'setting.history-backup', isHeading: true },
		{ titleKey: 'setting.history-backup-actions', descKeys: ['setting.history-backup-actions-desc'], sectionKey: 'setting.history-backup' },
		{ titleKey: 'setting.focus-judgment', isHeading: true },
		{ titleKey: 'setting.idle-threshold', descKeys: ['setting.idle-threshold-desc'], sectionKey: 'setting.focus-judgment' },
		{ titleKey: 'setting.obs-overlay', isHeading: true },
		{ titleKey: 'setting.enable-obs-overlay', descKeys: ['setting.enable-obs-overlay-desc'], sectionKey: 'setting.obs-overlay' },
		{ titleKey: 'setting.overlay-port', descKeys: ['setting.overlay-port-desc'], sectionKey: 'setting.obs-overlay' },
		{ titleKey: 'setting.overlay-opacity', descKeys: ['setting.overlay-opacity-desc'], sectionKey: 'setting.obs-overlay' },
		{ titleKey: 'setting.custom-css', descKeys: ['setting.custom-css-desc'], sectionKey: 'setting.obs-overlay' },
		{ titleKey: 'setting.overlay-theme', sectionKey: 'setting.obs-overlay' },
		{ titleKey: 'obs.total-time', sectionKey: 'setting.obs-overlay' },
		{ titleKey: 'obs.focus-time', sectionKey: 'setting.obs-overlay' },
		{ titleKey: 'obs.slack-time', sectionKey: 'setting.obs-overlay' },
		{ titleKey: 'obs.daily-goal', sectionKey: 'setting.obs-overlay' },
		{ titleKey: 'obs.chapter-goal', sectionKey: 'setting.obs-overlay' },
		{ titleKey: 'obs.session-words', sectionKey: 'setting.obs-overlay' },
		{ titleKey: 'setting.copy-obs-url', descKeys: ['setting.copy-obs-url-desc'], sectionKey: 'setting.obs-overlay' },
		{ titleKey: 'setting.debug-mode', descKeys: ['setting.debug-mode-desc'], sectionKey: 'setting.obs-overlay' },
	]),
];

export function isEntryAvailableOnPlatform(
	entry: SettingCatalogueEntry,
	tier: SettingsPlatformTier = getPlatformTier()
): boolean {
	if (tier === 'desktop') {
		return entry.platform === 'all' || entry.platform === 'desktop';
	}
	return entry.platform === 'all' || entry.platform === 'mobile';
}

export function resolveEntryDescription(
	entry: SettingCatalogueEntry,
	translate: TranslateFn = t
): string {
	if (entry.descKeys.length > 0) {
		const params = entry.descParams ? { ...entry.descParams } : undefined;
		const joined = entry.descKeys
			.map((key) => translate(key, params))
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (joined) return joined;
	}
	if (entry.sectionKey) {
		return translate(entry.sectionKey);
	}
	return translate(entry.categoryNameKey);
}

interface RankedSearchCandidate {
	readonly result: SettingSearchResult;
	readonly titleMatchCount: number;
	readonly firstTitleMatchPos: number;
	readonly isHeadingRank: number;
	readonly titleLength: number;
	readonly catalogueIndex: number;
}

export function searchSettingsCatalogue(
	query: string,
	options?: {
		tier?: SettingsPlatformTier;
		translate?: TranslateFn;
	}
): SettingSearchResult[] {
	const trimmed = query.trim().toLowerCase();
	if (!trimmed) return [];

	const tokens = trimmed.split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return [];

	const tier = options?.tier ?? getPlatformTier();
	const translate = options?.translate ?? t;
	const candidates: RankedSearchCandidate[] = [];

	SETTINGS_SEARCH_CATALOGUE.forEach((entry, index) => {
		if (!isEntryAvailableOnPlatform(entry, tier)) return;

		const title = translate(entry.titleKey);
		const categoryLabel = translate(entry.categoryNameKey);
		const sectionLabel = entry.sectionKey ? translate(entry.sectionKey) : '';
		const description = resolveEntryDescription(entry, translate);

		const titleLower = title.toLowerCase();
		const descLower = description.toLowerCase();
		const sectionLower = sectionLabel.toLowerCase();

		const allTokensMatch = tokens.every(
			(token) =>
				titleLower.includes(token) ||
				descLower.includes(token) ||
				sectionLower.includes(token)
		);
		if (!allTokensMatch) return;

		let titleMatchCount = 0;
		let firstTitleMatchPos = Number.MAX_SAFE_INTEGER;
		for (const token of tokens) {
			const pos = titleLower.indexOf(token);
			if (pos !== -1) {
				titleMatchCount += 1;
				if (pos < firstTitleMatchPos) {
					firstTitleMatchPos = pos;
				}
			}
		}

		let matchTier: number;
		if (titleLower === trimmed) {
			matchTier = entry.isHeading ? 1 : 0;
		} else if (titleMatchCount === tokens.length && titleLower.startsWith(trimmed)) {
			matchTier = 2;
		} else if (titleMatchCount === tokens.length) {
			matchTier = 3;
		} else if (titleMatchCount > 0) {
			matchTier = 4;
		} else {
			matchTier = 5;
		}

		candidates.push({
			result: {
				entry,
				categoryLabel,
				sectionLabel,
				title,
				description,
				matchTier
			},
			titleMatchCount,
			firstTitleMatchPos,
			isHeadingRank: entry.isHeading ? 1 : 0,
			titleLength: title.length,
			catalogueIndex: index
		});
	});

	candidates.sort((a, b) => {
		if (a.result.matchTier !== b.result.matchTier) {
			return a.result.matchTier - b.result.matchTier;
		}
		if (a.titleMatchCount !== b.titleMatchCount) {
			return b.titleMatchCount - a.titleMatchCount;
		}
		if (a.firstTitleMatchPos !== b.firstTitleMatchPos) {
			return a.firstTitleMatchPos - b.firstTitleMatchPos;
		}
		if (a.isHeadingRank !== b.isHeadingRank) {
			return a.isHeadingRank - b.isHeadingRank;
		}
		if (a.titleLength !== b.titleLength) {
			return a.titleLength - b.titleLength;
		}
		return a.catalogueIndex - b.catalogueIndex;
	});

	return candidates.map((candidate) => candidate.result);
}
