import type { App, EventRef, MarkdownView, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { Modal, Setting, TFile, setIcon } from 'obsidian';
import { MOBILE_DASHBOARD_STAT_KEYS, MOBILE_IMMERSIVE_AUX_VIEW_TYPES, VALIDATION_RULES, VIEW_TYPES } from '../constants';
import { t } from '../i18n';
import {
	formatMobileDashboardValues,
	formatMobileTimerValues,
	getMobileDashboardItemTone,
	resolveMobileTaskProgress,
	sanitizeMobileDashboardItems,
	type MobileDashboardTaskManagerLike
} from '../services/MobileDashboardStats';
import {
	MOBILE_AUX_PANEL_BOUNDS,
	clampMobileAuxPanelGeometry,
	clampTabletDockedAuxPanelGeometry,
	sanitizeMobileAuxPanelState,
	sanitizeMobileCutoutOffset,
	type MobileAuxPanelRect,
	type MobileAuxViewportRect
} from '../services/MobileImmersivePanelGeometry';
import { enterMobileNativeFullscreen, type MobileFullscreenHandle } from '../services/ObsidianInternals';
import type {
	AccurateCountSettings,
	MobileDashboardStatKey,
	MobileImmersiveAuxPanelState,
	MobileImmersiveAuxViewType
} from '../types/settings';
import { Logger } from '../utils/Logger';
import { getPlatformTier } from '../utils/platform';
import { attachLegacySliderValue } from '../utils/ui';
import type {
	ImmersiveModeManagerReferenceManager,
	ImmersiveModeManagerStatisticsManager
} from './ImmersiveModeManager';

export interface MobileImmersiveControllerPlugin {
	app: App;
	focusMs?: number;
	slackMs?: number;
	lastTaskFolder?: string;
	taskManager?: MobileDashboardTaskManagerLike;
	settings: Pick<AccurateCountSettings, 'immersive'> & Partial<Pick<
		AccurateCountSettings,
		'workspaceFolders' | 'loreFolderName' | 'timeline' | 'foreshadowing' | 'novelInfo'
	>>;
	statisticsManager: ImmersiveModeManagerStatisticsManager & {
		getSessionSpeed?: () => number;
	};
	immersiveReferenceManager: ImmersiveModeManagerReferenceManager;
	saveSettings(): Promise<void>;
	getVaultMarkdownFiles?: () => TFile[];
}

export interface MobileImmersiveControllerHost {
	app: App;
	plugin: MobileImmersiveControllerPlugin;
	ownerDocument: Document;
	getMainLeaf: () => WorkspaceLeaf | null;
	getMainView: () => MarkdownView | null;
	getMainFile: () => TFile | null;
	getCurrentWorkPath: () => string;
	onRequestExit: () => Promise<void>;
	onHandleManuscriptSettingChanged: (enabled: boolean) => Promise<boolean>;
	attachReferenceToolbar: (leaf: WorkspaceLeaf) => void;
	syncMobileWorkReference: (leaf: WorkspaceLeaf, file: TFile | null, workPath: string) => Promise<void>;
	invalidateReferenceLeaf: (leaf: WorkspaceLeaf) => Promise<void>;
	restoreMainEditorFocus: () => void;
}

function normalizePathSlashes(path: string): string {
	if (!path || path === '/') return '';
	return path.replace(/^\/+|\/+$/g, '');
}

function rewritePathPrefix(fullPath: string, oldPath: string, newPath: string): string | null {
	const normFull = normalizePathSlashes(fullPath);
	const normOld = normalizePathSlashes(oldPath);
	const normNew = normalizePathSlashes(newPath);
	if (!normFull || !normOld) return null;
	if (normFull === normOld) return normNew;
	if (normFull.startsWith(normOld + '/')) {
		const suffix = normFull.substring(normOld.length + 1);
		return normNew ? `${normNew}/${suffix}` : suffix;
	}
	return null;
}

interface HostedLeafRecord {
	leaf: WorkspaceLeaf;
	originalParent: HTMLElement | null;
	nextSibling: ChildNode | null;
	extraCleanup?: () => void;
}

interface ActiveGesture {
	mode: 'drag' | 'resize';
	isMinimizedDrag: boolean;
	hasMoved: boolean;
	startClientX: number;
	startClientY: number;
	originRect: MobileAuxPanelRect;
	pointerId: number | null;
	viewport: MobileAuxViewportRect | null;
	flushMove: () => void;
	cleanup: () => void;
}

interface ViewportMetrics {
	left: number;
	top: number;
	width: number;
	height: number;
	keyboardInset: number;
}

export const MOBILE_AUX_VIEW_LABEL_KEYS: Record<MobileImmersiveAuxViewType, string> = {
	'immersive-chapter-status-view': 'setting.layout-view-chapter-status',
	'immersive-sticky-notes-view': 'setting.layout-view-sticky-notes',
	'reference-view': 'setting.layout-view-reference',
	'foreshadowing-view': 'setting.layout-view-foreshadowing',
	'wn-timeline-view': 'setting.layout-view-timeline',
	'webnovel-lore-overview': 'setting.layout-view-lore-overview',
	'webnovel-corkboard': 'setting.layout-view-corkboard',
	'outline': 'setting.layout-view-outline'
};

class MobileImmersiveQuickSettingsModal extends Modal {
	constructor(
		app: App,
		private plugin: MobileImmersiveControllerPlugin,
		private callbacks: {
			isActive: () => boolean;
			onTypewriterChanged: () => void;
			onManuscriptToggle: (enabled: boolean) => Promise<boolean>;
			onCutoutChanged: () => void;
			onClose: () => void;
		}
	) {
		super(app);
		this.modalEl.addClass('wn-plugin-modal', 'wn-immersive-mobile-settings-modal');
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		const immersive = this.plugin.settings.immersive;
		new Setting(contentEl).setName(t('immersive.mobile-quick-settings-title')).setHeading();
		new Setting(contentEl)
			.setName(t('setting.immersive-typewriter-enable'))
			.addToggle(toggle => toggle.setValue(Boolean(immersive.typewriterEnabled)).onChange(async value => {
				if (!this.callbacks.isActive()) return;
				immersive.typewriterEnabled = value;
				await this.plugin.saveSettings();
				if (this.callbacks.isActive()) this.callbacks.onTypewriterChanged();
			}));
		new Setting(contentEl)
			.setName(t('setting.immersive-typewriter-offset'))
			.addSlider(slider => slider.setLimits(-30, 30, 1)
				.setValue(immersive.typewriterCenterOffset ?? 0).then(attachLegacySliderValue)
				.onChange(async value => {
					if (!this.callbacks.isActive()) return;
					immersive.typewriterCenterOffset = value;
					await this.plugin.saveSettings();
					if (this.callbacks.isActive()) this.callbacks.onTypewriterChanged();
				}));
		new Setting(contentEl)
			.setName(t('setting.immersive-typewriter-opacity'))
			.addSlider(slider => slider.setLimits(0.1, 1, 0.05)
				.setValue(immersive.typewriterUnfocusedOpacity ?? 0.4).then(attachLegacySliderValue)
				.onChange(async value => {
					if (!this.callbacks.isActive()) return;
					immersive.typewriterUnfocusedOpacity = Math.round(value * 100) / 100;
					await this.plugin.saveSettings();
					if (this.callbacks.isActive()) this.callbacks.onTypewriterChanged();
				}));
		new Setting(contentEl)
			.setName(t('setting.immersive-manuscript-mode'))
			.addToggle(toggle => toggle.setValue(Boolean(immersive.manuscriptModeEnabled)).onChange(async value => {
				if (!this.callbacks.isActive()) return;
				immersive.manuscriptModeEnabled = value;
				await this.plugin.saveSettings();
				if (!this.callbacks.isActive()) return;
				const effective = await this.callbacks.onManuscriptToggle(value);
				if (this.callbacks.isActive() && effective !== value) toggle.setValue(effective);
			}));

		const cutoutEnabled = Boolean(immersive.mobileCutoutAvoidance);
		const { min, max } = VALIDATION_RULES.IMMERSIVE_MOBILE_CUTOUT_OFFSET;
		const initialOffset = sanitizeMobileCutoutOffset(immersive.mobileCutoutLeftOffset);

		let cutoutSliderSetting: Setting | null = null;

		new Setting(contentEl)
			.setName(t('setting.immersive-mobile-cutout-avoidance'))
			.setDesc(t('setting.immersive-mobile-cutout-avoidance-desc'))
			.addToggle(toggle => toggle.setValue(cutoutEnabled).onChange(async value => {
				if (!this.callbacks.isActive()) return;
				immersive.mobileCutoutAvoidance = value;
				if (cutoutSliderSetting) {
					cutoutSliderSetting.settingEl.hidden = !value;
					cutoutSliderSetting.settingEl.classList.toggle('is-hidden', !value);
				}
				this.callbacks.onCutoutChanged();
				await this.plugin.saveSettings();
			}));

		cutoutSliderSetting = new Setting(contentEl)
			.setName(t('setting.immersive-mobile-cutout-offset'))
			.setDesc(`${initialOffset}px`)
			.addSlider(slider => slider
				.setLimits(min, max, 2)
				.setValue(initialOffset)
				.then(attachLegacySliderValue)
				.onChange(async value => {
					if (!this.callbacks.isActive()) return;
					immersive.mobileCutoutLeftOffset = value;
					cutoutSliderSetting?.setDesc(`${value}px`);
					this.callbacks.onCutoutChanged();
					await this.plugin.saveSettings();
				}));

		cutoutSliderSetting.settingEl.hidden = !cutoutEnabled;
		cutoutSliderSetting.settingEl.classList.toggle('is-hidden', !cutoutEnabled);
	}

	onClose(): void {
		this.contentEl.empty();
		this.callbacks.onClose();
	}
}

/**
 * 移动端（手机与平板）沉浸模式控制器
 * 负责轻量全屏顶栏、左侧固定覆盖章节目录、可选悬浮辅助面板（锁定/缩放/最小化/视口约束）、
 * 虚拟键盘视口适配及严格的参考文档导航隔离与异步生命周期收尾。
 */
export class MobileImmersiveController {
	private host: MobileImmersiveControllerHost;
	private ownerDocument: Document;
	private ownerWindow: Window;

	private isMounted = false;
	private isDisposed = false;
	private sessionGeneration = 0;
	private dirGeneration = 0;
	private auxGeneration = 0;
	private dirOperationQueue: Promise<void> = Promise.resolve();
	private auxOperationQueue: Promise<void> = Promise.resolve();
	private pendingSavePromise: Promise<void> = Promise.resolve();

	// Top bar elements
	private topBarEl: HTMLElement | null = null;
	private topBarStatsEl: HTMLElement | null = null;
	private workTitleEl: HTMLElement | null = null;
	private statItemEls: Partial<Record<MobileDashboardStatKey, HTMLElement>> = {};
	private lastHasStatsRow = true;
	private topBarTaskSeq = 0;
	private cachedTaskProgress: { words: number; goal: number } = { words: 0, goal: 0 };
	private clockIntervalId: number | null = null;
	private fullscreenHandle: MobileFullscreenHandle | null = null;

	// Fixed left overlay directory
	private isDirOpen = false;
	private dirBackdropEl: HTMLElement | null = null;
	private dirOverlayEl: HTMLElement | null = null;
	private dirBodyEl: HTMLElement | null = null;
	private dirRestoreBtnEl: HTMLButtonElement | null = null;
	private dirHostedLeaf: HostedLeafRecord | null = null;

	// Floating auxiliary panel
	private auxState: MobileImmersiveAuxPanelState;
	private auxPanelEl: HTMLElement | null = null;
	private auxHeaderEl: HTMLElement | null = null;
	private auxSelectEl: HTMLSelectElement | null = null;
	private auxLockBtnEl: HTMLButtonElement | null = null;
	private auxDockBtnEl: HTMLButtonElement | null = null;
	private lastDockWidth = 0;
	private auxRestoreBtnEl: HTMLButtonElement | null = null;
	private auxBodyEl: HTMLElement | null = null;
	private auxResizeHandleEl: HTMLElement | null = null;
	private auxHostedLeaf: HostedLeafRecord | null = null;
	private referenceLeaf: WorkspaceLeaf | null = null;
	private expectedReferencePath: string | null = null;
	private outlineContainerEl: HTMLElement | null = null;
	private outlineMetadataRef: EventRef | null = null;
	private renderedAuxRect: MobileAuxPanelRect | null = null;
	private activeGesture: ActiveGesture | null = null;
	private suppressRestoreClick = false;
	private activeSettingsModal: MobileImmersiveQuickSettingsModal | null = null;

	// Viewport listeners
	private safeAreaProbeEl: HTMLElement | null = null;
	private viewportCleanup: (() => void) | null = null;
	private lastViewportHeight = 0;
	private lastViewportWidth = 0;
	private lastTopBarHeight = 0;
	private createdLeaves = new Set<WorkspaceLeaf>();
	private pendingRetiredRefs: Array<{ leaf: WorkspaceLeaf; pendingOp: Promise<void> }> = [];
	private pendingRetiringRefPromises = new Set<Promise<void>>();

	constructor(host: MobileImmersiveControllerHost) {
		this.host = host;
		this.ownerDocument = host.ownerDocument;
		this.ownerWindow = host.ownerDocument.defaultView ?? window;
		this.auxState = sanitizeMobileAuxPanelState(host.plugin.settings.immersive.mobileAuxPanel);
		host.plugin.settings.immersive.mobileAuxPanel = { ...this.auxState };
	}

	public mount(): void {
		if (this.isMounted) return;
		this.isDisposed = false;
		this.isMounted = true;
		this.sessionGeneration++;

		this.fullscreenHandle?.release();
		this.fullscreenHandle = enterMobileNativeFullscreen(this.host.app, this.ownerDocument);

		this.createTopBar();
		this.createDirectoryOverlay();
		this.createAuxPanel();
		this.safeAreaProbeEl = this.ownerDocument.body.createDiv({
			cls: 'wn-immersive-mobile-safe-area-probe',
			attr: { 'aria-hidden': 'true' }
		});
		this.bindViewportListeners();
		this.syncViewportMetrics(false);
		this.refreshTopBar();

		// 初始进入时左侧目录默认折叠，不遮挡正文，保留边缘快速恢复按钮
		this.updateDirectoryVisibilityDom();

		// 恢复持久化的辅助面板显示状态
		this.updateAuxPanelControlsDom();
		this.applyAuxPanelGeometry();
		if (this.auxState.isOpen) {
			void this.mountAuxContent(this.auxState.viewType);
		}
	}

	public getAuxState(): MobileImmersiveAuxPanelState {
		return { ...this.auxState };
	}

	public getRenderedAuxRect(): MobileAuxPanelRect | null {
		return this.renderedAuxRect ? { ...this.renderedAuxRect } : null;
	}

	public getAuxPanelElement(): HTMLElement | null {
		return this.auxPanelEl;
	}

	public getReferenceLeaf(): WorkspaceLeaf | null {
		return this.referenceLeaf;
	}

	public isReferenceLeaf(leaf: WorkspaceLeaf | null | undefined): boolean {
		if (!leaf) return false;
		if (leaf === this.referenceLeaf) return true;
		return Boolean(leaf.containerEl?.classList?.contains?.('wn-immersive-reference-view'));
	}

	public isCurrentReferenceLeaf(leaf: WorkspaceLeaf | null | undefined): boolean {
		return Boolean(leaf && !this.isDisposed && leaf === this.referenceLeaf);
	}

	public ownsLeaf(leaf: WorkspaceLeaf | null | undefined): boolean {
		if (!leaf) return false;
		return this.createdLeaves.has(leaf) || leaf === this.dirHostedLeaf?.leaf || leaf === this.auxHostedLeaf?.leaf || leaf === this.referenceLeaf;
	}

	public handleVaultRename(abstractFile: TAbstractFile, oldPath: string): void {
		if (this.isDisposed || !this.expectedReferencePath) return;
		const rewritten = rewritePathPrefix(this.expectedReferencePath, oldPath, abstractFile.path);
		if (rewritten !== null) {
			this.expectedReferencePath = rewritten || null;
		}
	}

	public getExpectedReferencePath(): string | null {
		return this.expectedReferencePath;
	}

	public setExpectedReferencePath(path: string | null): void {
		this.expectedReferencePath = path;
	}

	public isDirectoryOpen(): boolean {
		return this.isDirOpen;
	}

	public hasActiveGesture(): boolean {
		return this.activeGesture !== null;
	}

	// ==========================================
	// Top Bar (header and customizable stats)
	// ==========================================

	private getSelectedDashboardItems(): MobileDashboardStatKey[] {
		return sanitizeMobileDashboardItems(this.host.plugin.settings.immersive.mobileDashboardItems);
	}

	private syncClockInterval(selected: readonly MobileDashboardStatKey[]): void {
		const needsClock = this.isMounted && !this.isDisposed && selected.includes('currentTime');
		if (!needsClock) {
			this.stopClockInterval();
			return;
		}
		if (this.clockIntervalId !== null || typeof this.ownerWindow.setInterval !== 'function') {
			return;
		}
		this.clockIntervalId = this.ownerWindow.setInterval(() => {
			this.refreshTopBarTimer();
		}, 1000);
	}

	private stopClockInterval(): void {
		if (this.clockIntervalId !== null) {
			if (typeof this.ownerWindow.clearInterval === 'function') {
				this.ownerWindow.clearInterval(this.clockIntervalId);
			}
			this.clockIntervalId = null;
		}
	}

	private createTopBar(): void {
		if (this.topBarEl) return;
		const bar = this.ownerDocument.body.createDiv({ cls: 'wn-immersive-mobile-topbar' });
		this.topBarEl = bar;

		const headerRow = bar.createDiv({ cls: 'wn-immersive-mobile-topbar-header' });
		this.workTitleEl = headerRow.createSpan({ cls: 'wn-immersive-mobile-work-title' });

		const rightGroup = headerRow.createDiv({ cls: 'wn-immersive-mobile-topbar-right' });
		const settingsBtn = rightGroup.createEl('button', {
			cls: 'clickable-icon wn-immersive-mobile-topbar-btn wn-immersive-mobile-settings-btn',
			attr: { type: 'button', 'aria-label': t('immersive.mobile-quick-settings') }
		});
		setIcon(settingsBtn, 'sliders-horizontal');
		settingsBtn.addEventListener('click', e => {
			e.stopPropagation();
			this.openQuickSettingsModal();
		});
		const exitBtn = rightGroup.createEl('button', {
			cls: 'clickable-icon wn-immersive-mobile-topbar-btn wn-immersive-mobile-exit-btn',
			attr: { type: 'button', 'aria-label': t('immersive.exit-btn') }
		});
		setIcon(exitBtn, 'x');
		exitBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.host.onRequestExit();
		});

		const statsGroup = bar.createDiv({ cls: 'wn-immersive-mobile-topbar-stats' });
		this.topBarStatsEl = statsGroup;
		this.statItemEls = {};
		for (const key of MOBILE_DASHBOARD_STAT_KEYS) {
			const tone = getMobileDashboardItemTone(key);
			const toneCls = tone === 'focus' ? ' is-focus' : tone === 'slack' ? ' is-slack' : '';
			const el = statsGroup.createSpan({
				cls: `wn-immersive-mobile-stat${toneCls} is-hidden`
			});
			el.setAttribute('data-stat-key', key);
			el.hidden = true;
			this.statItemEls[key] = el;
		}
		this.lastHasStatsRow = this.getSelectedDashboardItems().length > 0;
		statsGroup.hidden = !this.lastHasStatsRow;
		statsGroup.classList.toggle('is-hidden', !this.lastHasStatsRow);
		this.applyCutoutOffset();
	}

	public applyCutoutOffset(): void {
		if (!this.topBarEl) return;
		const immersive = this.host.plugin.settings.immersive;
		const offset = immersive.mobileCutoutAvoidance ? sanitizeMobileCutoutOffset(immersive.mobileCutoutLeftOffset) : 0;
		this.topBarEl.setCssProps({
			'--wn-immersive-mobile-cutout-left-offset': `${offset}px`
		});
	}

	private applyStatVisibilityAndValues(
		selected: readonly MobileDashboardStatKey[],
		values: Partial<Record<MobileDashboardStatKey, string>>
	): void {
		const selectedSet = new Set<MobileDashboardStatKey>(selected);
		for (const key of MOBILE_DASHBOARD_STAT_KEYS) {
			const el = this.statItemEls[key];
			if (!el) continue;
			const visible = selectedSet.has(key);
			el.hidden = !visible;
			el.classList.toggle('is-hidden', !visible);
			if (visible && values[key] !== undefined) {
				el.textContent = values[key]!;
			}
		}
	}

	public refreshTopBar(): void {
		if (!this.isMounted || this.isDisposed || !this.topBarEl) return;
		this.applyCutoutOffset();

		const mainFile = this.host.getMainFile();
		const workPath = this.host.plugin.immersiveReferenceManager.getWorkPath(mainFile);
		const workName = normalizePathSlashes(workPath).split('/').pop() ?? '';
		if (this.workTitleEl) {
			this.workTitleEl.textContent = workName;
			this.workTitleEl.setAttribute('aria-label', workName);
			this.workTitleEl.hidden = !workName;
			this.workTitleEl.classList.toggle('is-hidden', !workName);
		}

		const selected = this.getSelectedDashboardItems();
		this.syncClockInterval(selected);
		const hasStatsRow = selected.length > 0;
		if (this.topBarStatsEl) {
			this.topBarStatsEl.hidden = !hasStatsRow;
			this.topBarStatsEl.classList.toggle('is-hidden', !hasStatsRow);
		}
		if (hasStatsRow !== this.lastHasStatsRow) {
			this.lastHasStatsRow = hasStatsRow;
			this.syncViewportMetrics(true);
		}
		if (!hasStatsRow) {
			this.applyStatVisibilityAndValues(selected, {});
			return;
		}

		const rawStats = mainFile
			? this.host.plugin.statisticsManager.getCoreStats()
			: this.host.plugin.statisticsManager.getCoreStats(null);
		const stats = mainFile
			? rawStats
			: { ...rawStats, todayWords: 0 };
		const values = formatMobileDashboardValues(stats, this.cachedTaskProgress);
		this.applyStatVisibilityAndValues(selected, values);

		if (selected.includes('taskProgress') && this.host.plugin.taskManager) {
			const reqSeq = ++this.topBarTaskSeq;
			const sessionGen = this.sessionGeneration;
			void resolveMobileTaskProgress({
				app: this.host.app,
				plugin: this.host.plugin,
				file: mainFile
			}).then(progress => {
				if (this.isDisposed || !this.isMounted || sessionGen !== this.sessionGeneration || reqSeq !== this.topBarTaskSeq) {
					return;
				}
				this.cachedTaskProgress = progress;
				const taskEl = this.statItemEls.taskProgress;
				if (taskEl && !taskEl.hidden) {
					taskEl.textContent = `${progress.words}/${progress.goal}`;
				}
			});
		}
	}

	public refreshTopBarTimer(): void {
		if (!this.isMounted || this.isDisposed || !this.topBarStatsEl) return;
		const selected = this.getSelectedDashboardItems();
		this.syncClockInterval(selected);
		if (selected.length === 0) return;

		const statsManager = this.host.plugin.statisticsManager;
		const speed = typeof statsManager.getSessionSpeed === 'function'
			? statsManager.getSessionSpeed()
			: (statsManager.getCoreStats().sessionSpeed ?? 0);

		const timerValues = formatMobileTimerValues({
			focusMs: this.host.plugin.focusMs,
			slackMs: this.host.plugin.slackMs,
			sessionSpeed: speed
		});

		for (const key of ['totalTime', 'focusTime', 'slackTime', 'sessionSpeed', 'currentTime'] as const) {
			if (!selected.includes(key)) continue;
			const el = this.statItemEls[key];
			if (el) {
				el.textContent = timerValues[key];
			}
		}
	}

	// ==========================================
	// Fixed Left Overlay Chapter Directory
	// ==========================================

	private createDirectoryOverlay(): void {
		const backdrop = this.ownerDocument.body.createDiv({ cls: 'wn-immersive-mobile-dir-backdrop is-hidden' });
		backdrop.hidden = true;
		backdrop.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.setDirectoryOpen(false);
		});
		this.dirBackdropEl = backdrop;

		const overlay = this.ownerDocument.body.createDiv({ cls: 'wn-immersive-mobile-dir-overlay is-hidden' });
		overlay.hidden = true;
		this.dirOverlayEl = overlay;

		const header = overlay.createDiv({ cls: 'wn-immersive-mobile-dir-header' });
		header.createSpan({ cls: 'wn-immersive-mobile-dir-title', text: t('setting.layout-view-chapter-list') });
		const closeBtn = header.createEl('button', {
			cls: 'clickable-icon wn-immersive-mobile-dir-close-btn',
			attr: {
				type: 'button',
				'aria-label': t('immersive.mobile-close-directory')
			}
		});
		setIcon(closeBtn, 'chevron-left');
		closeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.setDirectoryOpen(false);
		});

		this.dirBodyEl = overlay.createDiv({ cls: 'wn-immersive-mobile-dir-body' });

		const restoreBtn = this.ownerDocument.body.createEl('button', {
			cls: 'clickable-icon wn-immersive-mobile-dir-restore-btn',
			attr: {
				type: 'button',
				'aria-label': t('immersive.mobile-open-directory')
			}
		});
		setIcon(restoreBtn, 'chevron-right');
		restoreBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.setDirectoryOpen(true);
		});
		this.dirRestoreBtnEl = restoreBtn;
	}

	private openQuickSettingsModal(): void {
		if (this.isDisposed || !this.isMounted || this.activeSettingsModal) return;
		const modal: MobileImmersiveQuickSettingsModal = new MobileImmersiveQuickSettingsModal(this.host.app, this.host.plugin, {
			isActive: () => !this.isDisposed && this.isMounted && this.activeSettingsModal === modal,
			onTypewriterChanged: () => {
				const immersive = this.host.plugin.settings.immersive;
				this.ownerDocument.body.classList.toggle('wn-typewriter-active', Boolean(immersive.typewriterEnabled));
				this.ownerDocument.body.setCssProps({ '--wn-typewriter-opacity': String(immersive.typewriterUnfocusedOpacity ?? 0.4) });
				this.refreshMainEditorLayout();
			},
			onManuscriptToggle: enabled => this.host.onHandleManuscriptSettingChanged(enabled),
			onCutoutChanged: () => this.applyCutoutOffset(),
			onClose: () => { if (this.activeSettingsModal === modal) this.activeSettingsModal = null; }
		});
		this.activeSettingsModal = modal;
		modal.open();
	}

	private updateDirectoryVisibilityDom(): void {
		const open = this.isDirOpen;
		if (this.dirOverlayEl) {
			this.dirOverlayEl.classList.toggle('is-hidden', !open);
			this.dirOverlayEl.hidden = !open;
		}
		if (this.dirBackdropEl) {
			const showBackdrop = open && this.isPhoneTier();
			this.dirBackdropEl.classList.toggle('is-hidden', !showBackdrop);
			this.dirBackdropEl.hidden = !showBackdrop;
		}
		if (this.dirRestoreBtnEl) {
			this.dirRestoreBtnEl.classList.toggle('is-hidden', open);
			this.dirRestoreBtnEl.hidden = open;
		}
	}

	private isPhoneTier(): boolean {
		return this.ownerDocument.body.classList.contains('is-phone') || getPlatformTier() === 'mobile';
	}

	public setDirectoryOpen(open: boolean): Promise<void> {
		if (this.isDisposed) return Promise.resolve();
		this.isDirOpen = open;
		this.updateDirectoryVisibilityDom();
		const reqGen = ++this.dirGeneration;
		const sessionGen = this.sessionGeneration;

		const op = this.dirOperationQueue.catch(() => {}).then(async () => {
			if (this.isDisposed || sessionGen !== this.sessionGeneration || reqGen !== this.dirGeneration) return;
			if (!open) {
				this.unmountDirectoryLeaf();
				return;
			}
			if (this.dirHostedLeaf) {
				const view = this.dirHostedLeaf.leaf.view as { refresh?: () => Promise<void> | void; onResize?: () => void } | undefined;
				view?.onResize?.();
				return;
			}
			const leaf = this.createAuxiliaryLeaf();
			if (!leaf) return;
			try {
				await leaf.setViewState({ type: VIEW_TYPES.IMMERSIVE_CHAPTER_LIST, active: false });
				await leaf.loadIfDeferred?.();
			} catch (err) {
				Logger.warn('[MobileImmersiveController] 挂载移动端章节目录失败:', err);
				this.detachRawLeaf(leaf);
				return;
			}
			if (this.isDisposed || sessionGen !== this.sessionGeneration || reqGen !== this.dirGeneration || !this.isDirOpen || !this.dirBodyEl) {
				this.detachRawLeaf(leaf);
				return;
			}
			this.dirHostedLeaf = this.hostLeafInContainer(leaf, this.dirBodyEl);
			this.restoreMainLeafSilently();
			const view = leaf.view as { onResize?: () => void } | undefined;
			view?.onResize?.();
		});
		this.dirOperationQueue = op;
		return op;
	}

	public handleDirectoryChapterSelected(): void {
		if (this.isDisposed) return;
		if (this.isPhoneTier() && this.isDirOpen) {
			void this.setDirectoryOpen(false);
		}
	}

	private unmountDirectoryLeaf(): void {
		if (this.dirHostedLeaf) {
			this.detachHostedLeaf(this.dirHostedLeaf);
			this.dirHostedLeaf = null;
		}
		this.dirBodyEl?.empty();
	}

	// ==========================================
	// Floating Auxiliary Panel
	// ==========================================

	private createAuxPanel(): void {
		const panel = this.ownerDocument.body.createDiv({ cls: 'wn-immersive-mobile-aux-panel is-hidden' });
		panel.hidden = true;
		this.auxPanelEl = panel;

		const header = panel.createDiv({ cls: 'wn-immersive-mobile-aux-header' });
		this.auxHeaderEl = header;

		const select = header.createEl('select', {
			cls: 'dropdown wn-immersive-mobile-aux-select',
			attr: {
				'aria-label': t('immersive.mobile-aux-select')
			}
		});
		for (const viewType of MOBILE_IMMERSIVE_AUX_VIEW_TYPES) {
			const option = select.createEl('option', { text: t(MOBILE_AUX_VIEW_LABEL_KEYS[viewType]) });
			option.value = viewType;
		}
		select.value = this.auxState.viewType;
		select.addEventListener('change', () => {
			const nextType = select.value as MobileImmersiveAuxViewType;
			void this.setAuxViewType(nextType);
		});
		this.auxSelectEl = select;

		const grip = header.createSpan({ cls: 'wn-immersive-mobile-aux-grip', attr: { 'aria-hidden': 'true' } });
		setIcon(grip, 'grip-horizontal');
		const controls = header.createDiv({ cls: 'wn-immersive-mobile-aux-controls' });

		const lockBtn = controls.createEl('button', {
			cls: 'clickable-icon wn-immersive-mobile-aux-btn wn-immersive-mobile-aux-lock-btn',
			attr: {
				type: 'button',
				'aria-label': t('immersive.mobile-aux-lock'),
				'aria-pressed': String(this.auxState.isLocked)
			}
		});
		setIcon(lockBtn, this.auxState.isLocked ? 'lock' : 'unlock');
		lockBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.setAuxLocked(!this.auxState.isLocked);
		});
		this.auxLockBtnEl = lockBtn;

		if (this.isTabletTier()) {
			const dockBtn = controls.createEl('button', {
				cls: 'clickable-icon wn-immersive-mobile-aux-btn wn-immersive-mobile-aux-dock-btn',
				attr: { type: 'button', 'aria-label': t('immersive.mobile-aux-dock') }
			});
			setIcon(dockBtn, 'panel-right');
			dockBtn.addEventListener('click', e => {
				e.stopPropagation();
				void this.setAuxDocked(!this.auxState.isDocked);
			});
			this.auxDockBtnEl = dockBtn;
		}

		const minBtn = controls.createEl('button', {
			cls: 'clickable-icon wn-immersive-mobile-aux-btn wn-immersive-mobile-aux-min-btn',
			attr: {
				type: 'button',
				'aria-label': t('immersive.mobile-aux-minimize')
			}
		});
		setIcon(minBtn, 'minus');
		minBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.setAuxMinimized(true);
		});

		const restoreBtn = panel.createEl('button', {
			cls: 'clickable-icon wn-immersive-mobile-aux-restore-btn is-hidden',
			attr: { type: 'button', 'aria-label': t('immersive.mobile-aux-restore') }
		});
		restoreBtn.hidden = true;
		setIcon(restoreBtn, 'chevron-up');
		restoreBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (this.suppressRestoreClick && e.detail !== 0) {
				this.suppressRestoreClick = false;
				e.preventDefault();
				return;
			}
			this.suppressRestoreClick = false;
			void this.setAuxMinimized(false);
		});
		this.auxRestoreBtnEl = restoreBtn;

		this.auxBodyEl = panel.createDiv({ cls: 'wn-immersive-mobile-aux-body' });

		const resizeHandle = panel.createEl('button', {
			cls: 'clickable-icon wn-immersive-mobile-aux-resize-handle',
			attr: {
				type: 'button',
				'aria-label': t('immersive.mobile-aux-resize')
			}
		});
		this.auxResizeHandleEl = resizeHandle;

		this.bindAuxDragAndResize(header, resizeHandle);
	}

	private updateAuxPanelControlsDom(): void {
		const { isOpen, isMinimized, isLocked, viewType } = this.auxState;
		if (this.auxPanelEl) {
			this.auxPanelEl.classList.toggle('is-hidden', !isOpen);
			this.auxPanelEl.hidden = !isOpen;
			this.auxPanelEl.classList.toggle('is-minimized', isMinimized);
			this.auxPanelEl.classList.toggle('is-locked', isLocked);
			this.auxPanelEl.classList.toggle('is-docked', this.isAuxDocked());
		}
		if (this.auxBodyEl) {
			this.auxBodyEl.classList.toggle('is-hidden', isMinimized);
			this.auxBodyEl.hidden = isMinimized;
		}
		if (this.auxResizeHandleEl) {
			const hideHandle = isMinimized || isLocked;
			this.auxResizeHandleEl.classList.toggle('is-hidden', hideHandle);
			this.auxResizeHandleEl.hidden = hideHandle;
		}
		if (this.auxSelectEl && this.auxSelectEl.value !== viewType) {
			this.auxSelectEl.value = viewType;
		}
		if (this.auxLockBtnEl) {
			this.auxLockBtnEl.setAttribute('aria-pressed', String(isLocked));
			this.auxLockBtnEl.setAttribute('aria-label', isLocked ? t('immersive.mobile-aux-unlock') : t('immersive.mobile-aux-lock'));
			this.auxLockBtnEl.classList.toggle('is-active', isLocked);
			setIcon(this.auxLockBtnEl, isLocked ? 'lock' : 'unlock');
		}
		if (this.auxDockBtnEl) {
			this.auxDockBtnEl.setAttribute('aria-pressed', String(this.auxState.isDocked));
			this.auxDockBtnEl.setAttribute('aria-label', t(this.auxState.isDocked ? 'immersive.mobile-aux-undock' : 'immersive.mobile-aux-dock'));
		}
		if (this.auxHeaderEl) {
			this.auxHeaderEl.hidden = isMinimized;
			this.auxHeaderEl.classList.toggle('is-hidden', isMinimized);
		}
		if (this.auxRestoreBtnEl) {
			this.auxRestoreBtnEl.hidden = !isMinimized;
			this.auxRestoreBtnEl.classList.toggle('is-hidden', !isMinimized);
		}
	}

	private isInteractiveHeaderTarget(target: EventTarget | null): boolean {
		const el = target as HTMLElement | null;
		if (!el) return false;
		const tag = el.tagName?.toUpperCase?.();
		if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'OPTION' || tag === 'INPUT' || tag === 'A') {
			return true;
		}
		return Boolean(el.closest?.('button, select, input, a'));
	}

	private bindAuxDragAndResize(headerEl: HTMLElement, resizeHandleEl: HTMLElement): void {
		const startGesture = (mode: 'drag' | 'resize', clientX: number, clientY: number, pointerId: number | null, isMinimizedDrag = false) => {
			if (this.isDisposed || this.auxState.isLocked || !this.auxPanelEl) return;
			if (mode === 'resize' && this.auxState.isMinimized) return;
			if (mode === 'drag' && this.isAuxDocked()) return;

			this.cancelActiveGesture();

			const currentRect = this.renderedAuxRect ?? this.computeClampedAuxRect();
			const resizeViewport = mode === 'resize' && this.isAuxDocked() ? this.getAuxViewportRect() : null;
			this.auxPanelEl.classList.add(mode === 'drag' ? 'is-dragging' : 'is-resizing');

			const handleMove = (moveX: number, moveY: number) => {
				if (!this.activeGesture || this.auxState.isLocked || this.isDisposed) return;
				const dx = moveX - this.activeGesture.startClientX;
				const dy = moveY - this.activeGesture.startClientY;
				if (this.activeGesture.isMinimizedDrag) {
					if (!this.activeGesture.hasMoved && Math.hypot(dx, dy) < 5) return;
					this.activeGesture.hasMoved = true;
					this.suppressRestoreClick = true;
				}
				const viewport = this.activeGesture.viewport ?? this.getAuxViewportRect();

				if (mode === 'drag') {
					const tentative: MobileAuxPanelRect = {
						x: this.activeGesture.originRect.x + dx,
						y: this.activeGesture.originRect.y + dy,
						width: this.auxState.width,
						height: this.auxState.height
					};
					const clamped = clampMobileAuxPanelGeometry(tentative, viewport, {
						isMinimized: this.auxState.isMinimized
					});
					this.auxState.x = clamped.x;
					this.auxState.y = clamped.y;
					this.applyRectToAuxPanel(clamped);
				} else if (this.isAuxDocked()) {
					const clamped = clampTabletDockedAuxPanelGeometry(this.activeGesture.originRect.width - dx, viewport);
					this.auxState.width = clamped.width;
					this.applyRectToAuxPanel(clamped);
				} else {
					const tentative: MobileAuxPanelRect = {
						x: this.activeGesture.originRect.x,
						y: this.activeGesture.originRect.y,
						width: this.activeGesture.originRect.width + dx,
						height: this.activeGesture.originRect.height + dy
					};
					const clamped = clampMobileAuxPanelGeometry(tentative, viewport, {
						isMinimized: false
					});
					this.auxState.width = clamped.width;
					this.auxState.height = clamped.height;
					this.applyRectToAuxPanel(clamped);
				}
			};

			let pendingMove: { x: number; y: number } | null = null;
			let pendingFrame: { id: number } | null = null;
			const flushMove = () => {
				if (pendingFrame) this.ownerWindow.cancelAnimationFrame(pendingFrame.id);
				pendingFrame = null;
				const point = pendingMove;
				pendingMove = null;
				if (point) handleMove(point.x, point.y);
			};
			const queueMove = (x: number, y: number) => {
				if (!resizeViewport) {
					handleMove(x, y);
					return;
				}
				pendingMove = { x, y };
				if (pendingFrame) return;
				const frame = { id: 0 };
				pendingFrame = frame;
				frame.id = this.ownerWindow.requestAnimationFrame(() => {
					if (pendingFrame !== frame) return;
					pendingFrame = null;
					flushMove();
				});
			};

			const onPointerMove = (evt: Event) => {
				const pe = evt as PointerEvent;
				if (pointerId !== null && typeof pe.pointerId === 'number' && pe.pointerId !== pointerId) return;
				if (typeof pe.clientX !== 'number' || typeof pe.clientY !== 'number') return;
				if (typeof pe.preventDefault === 'function') pe.preventDefault();
				queueMove(pe.clientX, pe.clientY);
			};

			const onTouchMove = (evt: Event) => {
				const te = evt as TouchEvent;
				const touch = te.touches?.[0];
				if (!touch) return;
				if (typeof te.preventDefault === 'function') te.preventDefault();
				queueMove(touch.clientX, touch.clientY);
			};

			const onEnd = (evt: Event) => {
				const pe = evt as PointerEvent;
				if (pointerId !== null && typeof pe.pointerId === 'number' && pe.pointerId !== pointerId) return;
				this.finishActiveGesture(true);
			};

			this.ownerDocument.addEventListener('pointermove', onPointerMove);
			this.ownerDocument.addEventListener('pointerup', onEnd);
			this.ownerDocument.addEventListener('pointercancel', onEnd);
			this.ownerDocument.addEventListener('touchmove', onTouchMove, { passive: false });
			this.ownerDocument.addEventListener('touchend', onEnd);
			this.ownerDocument.addEventListener('touchcancel', onEnd);

			this.activeGesture = {
				mode,
				isMinimizedDrag,
				hasMoved: false,
				startClientX: clientX,
				startClientY: clientY,
				originRect: currentRect,
				pointerId,
				viewport: resizeViewport,
				flushMove,
				cleanup: () => {
					if (pendingFrame) this.ownerWindow.cancelAnimationFrame(pendingFrame.id);
					pendingFrame = null;
					pendingMove = null;
					this.ownerDocument.removeEventListener('pointermove', onPointerMove);
					this.ownerDocument.removeEventListener('pointerup', onEnd);
					this.ownerDocument.removeEventListener('pointercancel', onEnd);
					this.ownerDocument.removeEventListener('touchmove', onTouchMove);
					this.ownerDocument.removeEventListener('touchend', onEnd);
					this.ownerDocument.removeEventListener('touchcancel', onEnd);
				}
			};
		};

		headerEl.addEventListener('pointerdown', (evt: Event) => {
			if (this.auxState.isLocked || this.isInteractiveHeaderTarget(evt.target)) return;
			const pe = evt as PointerEvent;
			if (typeof pe.button === 'number' && pe.button !== 0) return;
			if (typeof pe.clientX !== 'number' || typeof pe.clientY !== 'number') return;
			if (typeof pe.preventDefault === 'function') pe.preventDefault();
			startGesture('drag', pe.clientX, pe.clientY, typeof pe.pointerId === 'number' ? pe.pointerId : null);
		});

		this.auxRestoreBtnEl?.addEventListener('pointerdown', (evt: PointerEvent) => {
			this.suppressRestoreClick = false;
			if (this.auxState.isLocked || !this.auxState.isMinimized || evt.button !== 0) return;
			startGesture('drag', evt.clientX, evt.clientY, evt.pointerId, true);
		});

		resizeHandleEl.addEventListener('pointerdown', (evt: Event) => {
			if (this.auxState.isLocked || this.auxState.isMinimized) return;
			const pe = evt as PointerEvent;
			if (typeof pe.button === 'number' && pe.button !== 0) return;
			if (typeof pe.clientX !== 'number' || typeof pe.clientY !== 'number') return;
			evt.stopPropagation();
			if (typeof pe.preventDefault === 'function') pe.preventDefault();
			startGesture('resize', pe.clientX, pe.clientY, typeof pe.pointerId === 'number' ? pe.pointerId : null);
		});
	}

	public cancelActiveGesture(): void {
		this.finishActiveGesture(false);
	}

	private finishActiveGesture(persist: boolean): void {
		const gesture = this.activeGesture;
		if (!gesture) return;
		if (persist) gesture.flushMove();
		this.activeGesture = null;
		gesture.cleanup();
		this.auxPanelEl?.classList.remove('is-dragging', 'is-resizing');
		if (gesture.mode === 'resize' && !this.isDisposed && this.auxState.isOpen && !this.auxState.isMinimized) {
			if (this.isAuxDocked()) this.refreshMainEditorLayout();
			(this.auxHostedLeaf?.leaf.view as { onResize?: () => void } | undefined)?.onResize?.();
		}
		if (persist && !this.isDisposed) {
			void this.persistAuxState();
		}
	}

	public async setAuxOpen(open: boolean): Promise<void> {
		if (this.isDisposed) return;
		if (!open) {
			this.cancelActiveGesture();
		}
		const hadFocusInsidePanel = Boolean(
			!open && this.auxPanelEl && this.ownerDocument.activeElement &&
			typeof this.auxPanelEl.contains === 'function' &&
			this.auxPanelEl.contains(this.ownerDocument.activeElement)
		);
		this.auxState.isOpen = open;
		this.updateAuxPanelControlsDom();
		this.applyAuxPanelGeometry();
		const persistTask = this.persistAuxState();
		if (open) {
			await this.mountAuxContent(this.auxState.viewType);
		} else {
			this.auxGeneration++;
			this.beginRetireAuxContentSync();
			await this.unmountAuxContent();
			if (hadFocusInsidePanel) {
				this.host.restoreMainEditorFocus();
			}
		}
		await persistTask;
	}

	public async setAuxViewType(viewType: MobileImmersiveAuxViewType): Promise<void> {
		if (this.isDisposed) return;
		if (!MOBILE_IMMERSIVE_AUX_VIEW_TYPES.includes(viewType)) return;
		this.auxState.viewType = viewType;
		this.updateAuxPanelControlsDom();
		const persistTask = this.persistAuxState();
		if (this.auxState.isOpen) {
			this.beginRetireAuxContentSync();
			await this.mountAuxContent(viewType);
		}
		await persistTask;
	}

	public async setAuxDocked(docked: boolean): Promise<void> {
		if (this.isDisposed || !this.isTabletTier()) return;
		this.cancelActiveGesture();
		this.auxState.isDocked = docked;
		this.updateAuxPanelControlsDom();
		this.applyAuxPanelGeometry();
		(this.auxHostedLeaf?.leaf.view as { onResize?: () => void } | undefined)?.onResize?.();
		await this.persistAuxState();
	}

	public async setAuxLocked(locked: boolean): Promise<void> {
		if (this.isDisposed) return;
		if (locked) {
			// 锁定立即中止正在进行的拖拽或缩放手势
			this.cancelActiveGesture();
		}
		this.auxState.isLocked = locked;
		this.updateAuxPanelControlsDom();
		await this.persistAuxState();
	}

	public async setAuxMinimized(minimized: boolean): Promise<void> {
		if (this.isDisposed) return;
		if (minimized && this.activeGesture) {
			this.cancelActiveGesture();
		}
		this.auxState.isMinimized = minimized;
		this.updateAuxPanelControlsDom();
		this.applyAuxPanelGeometry();
		if (!minimized && this.auxState.isOpen) {
			(this.auxHostedLeaf?.leaf.view as { onResize?: () => void } | undefined)?.onResize?.();
		}
		await this.persistAuxState();
	}

	private persistAuxState(): Promise<void> {
		if (this.isDisposed) return Promise.resolve();
		const sanitized = sanitizeMobileAuxPanelState(this.auxState);
		this.auxState = sanitized;
		this.host.plugin.settings.immersive.mobileAuxPanel = { ...sanitized };
		const next = this.pendingSavePromise.catch(() => {}).then(async () => {
			try {
				await this.host.plugin.saveSettings();
			} catch (err) {
				Logger.warn('[MobileImmersiveController] 持久化移动端辅助面板状态失败:', err);
			}
		});
		this.pendingSavePromise = next;
		return next;
	}

	// ==========================================
	// Auxiliary Content Mounting & Reference Isolation
	// ==========================================

	private mountAuxContent(viewType: MobileImmersiveAuxViewType): Promise<void> {
		const reqGen = ++this.auxGeneration;
		const sessionGen = this.sessionGeneration;
		const isCurrent = () =>
			!this.isDisposed &&
			sessionGen === this.sessionGeneration &&
			reqGen === this.auxGeneration &&
			this.auxState.isOpen &&
			this.auxState.viewType === viewType;

		const op = this.auxOperationQueue.catch(() => {}).then(async () => {
			this.beginRetireAuxContentSync();
			if (this.pendingRetiredRefs.length > 0) {
				await this.flushRetiredReferenceLeavesAsync();
			}
			if (!isCurrent() || !this.auxBodyEl) return;

			if (viewType === 'outline') {
				this.mountMainOutline(this.auxBodyEl);
				return;
			}

			const leaf = this.createAuxiliaryLeaf();
			if (!leaf) return;

			if (viewType === 'reference-view') {
				leaf.containerEl?.classList?.add('wn-immersive-reference-view');
				const workPath = this.host.getCurrentWorkPath();
				const refPath = this.host.plugin.immersiveReferenceManager.getReferenceFilePath(workPath);
				const candidate = refPath ? this.host.app.vault.getAbstractFileByPath(refPath) : null;
				const initialFile = candidate instanceof TFile && candidate.extension === 'md' ? candidate : null;
				this.expectedReferencePath = initialFile?.path ?? null;
				this.referenceLeaf = leaf;
				const extraCleanup = this.installReferenceNavigationGuard(leaf);
				this.auxHostedLeaf = this.hostLeafInContainer(leaf, this.auxBodyEl, extraCleanup);
				this.host.attachReferenceToolbar(leaf);
				this.renderReferenceEmptyHintIfNeeded();

				try {
					await this.host.syncMobileWorkReference(leaf, initialFile, workPath);
					await leaf.loadIfDeferred?.();
				} catch (err) {
					Logger.warn('[MobileImmersiveController] 挂载移动端参考文档失败:', err);
				}

				if (!isCurrent()) {
					if (this.referenceLeaf === leaf) {
						this.beginRetireAuxContentSync();
						await this.flushRetiredReferenceLeavesAsync();
					}
					return;
				}

				this.restoreMainLeafSilently();
				if (!this.auxState.isMinimized) {
					(leaf.view as { onResize?: () => void } | undefined)?.onResize?.();
				}
				return;
			}

			try {
				await leaf.setViewState({ type: viewType, active: false });
				await leaf.loadIfDeferred?.();
			} catch (err) {
				Logger.warn(`[MobileImmersiveController] 挂载辅助组件 ${viewType} 失败:`, err);
				this.detachRawLeaf(leaf);
				return;
			}

			if (!isCurrent() || !this.auxBodyEl) {
				this.detachRawLeaf(leaf);
				return;
			}

			this.auxHostedLeaf = this.hostLeafInContainer(leaf, this.auxBodyEl);
			this.restoreMainLeafSilently();
			if (!this.auxState.isMinimized) {
				(leaf.view as { onResize?: () => void } | undefined)?.onResize?.();
			}
		});
		this.auxOperationQueue = op;
		return op;
	}

	private unmountAuxContent(): Promise<void> {
		this.auxGeneration++;
		const op = this.auxOperationQueue.catch(() => {}).then(async () => {
			this.beginRetireAuxContentSync();
			await this.flushRetiredReferenceLeavesAsync();
		});
		this.auxOperationQueue = op;
		return op;
	}

	/**
	 * 同步退役当前辅助区内容：
	 * - 立即失效旧参考叶子的序列号、关闭绑定到该叶子的搜索弹窗并移除工具栏监听，避免泄漏；
	 * - 对仍存在在途原生打开操作的参考叶子，先从面板宿主移出并等待在途队列收尾后再真正 detach。
	 */
	private beginRetireAuxContentSync(): void {
		if (this.outlineMetadataRef) {
			if (typeof this.host.app.metadataCache?.offref === 'function') {
				this.host.app.metadataCache.offref(this.outlineMetadataRef);
			}
			this.outlineMetadataRef = null;
		}
		this.outlineContainerEl = null;

		const oldRefLeaf = this.referenceLeaf;
		if (oldRefLeaf) {
			this.referenceLeaf = null;
			this.expectedReferencePath = null;
			const pendingOp = this.host.invalidateReferenceLeaf(oldRefLeaf).catch(() => {});
			this.pendingRetiringRefPromises.add(pendingOp);
			void pendingOp.finally(() => {
				this.pendingRetiringRefPromises.delete(pendingOp);
			});

			if (this.auxHostedLeaf && this.auxHostedLeaf.leaf === oldRefLeaf) {
				this.restoreHostedLeafDomWithoutDetach(this.auxHostedLeaf);
				this.auxHostedLeaf = null;
			}
			this.pendingRetiredRefs.push({ leaf: oldRefLeaf, pendingOp });
		}

		if (this.auxHostedLeaf) {
			this.detachHostedLeaf(this.auxHostedLeaf);
			this.auxHostedLeaf = null;
		}

		this.auxBodyEl?.empty();
	}

	private async flushRetiredReferenceLeavesAsync(): Promise<void> {
		while (this.pendingRetiredRefs.length > 0) {
			const batch = this.pendingRetiredRefs.splice(0);
			await Promise.allSettled(batch.map(item => item.pendingOp));
			for (const item of batch) {
				this.detachRawLeaf(item.leaf);
			}
		}
	}

	private clearAuxContentSync(): void {
		this.beginRetireAuxContentSync();
		const batch = this.pendingRetiredRefs.splice(0);
		for (const item of batch) {
			this.detachRawLeaf(item.leaf);
		}
	}

	private renderReferenceEmptyHintIfNeeded(): void {
		if (!this.auxBodyEl || this.auxState.viewType !== 'reference-view') return;
		const existingHint = this.auxBodyEl.querySelector?.('.wn-immersive-mobile-ref-empty');
		if (this.expectedReferencePath) {
			existingHint?.remove();
			return;
		}
		if (!existingHint) {
			this.auxBodyEl.createDiv({
				cls: 'wn-immersive-mobile-ref-empty',
				text: t('immersive.mobile-reference-empty')
			});
		}
	}

	private installReferenceNavigationGuard(leaf: WorkspaceLeaf): () => void {
		const containerEl = leaf.containerEl;
		if (!containerEl || typeof containerEl.addEventListener !== 'function') {
			return () => {};
		}

		const isBlockedNavTarget = (target: EventTarget | null): boolean => {
			const el = target as Element | null;
			if (!el) return false;
			if (el.closest?.('.wn-immersive-ref-toolbar')) return false;
			return Boolean(
				el.closest?.('a.internal-link, [data-href], .cm-hmd-internal-link, a.tag, .cm-hashtag')
			);
		};

		const blockNavigation = (evt: Event) => {
			if (isBlockedNavTarget(evt.target)) {
				evt.preventDefault();
				evt.stopPropagation();
				if (typeof evt.stopImmediatePropagation === 'function') {
					evt.stopImmediatePropagation();
				}
			}
		};

		containerEl.addEventListener('click', blockNavigation, true);
		containerEl.addEventListener('auxclick', blockNavigation, true);

		return () => {
			containerEl.removeEventListener('click', blockNavigation, true);
			containerEl.removeEventListener('auxclick', blockNavigation, true);
		};
	}

	public handleReferenceOpened(file: TFile | null, leaf?: WorkspaceLeaf): void {
		if (this.isDisposed) return;
		if (leaf && leaf !== this.referenceLeaf) return;
		this.expectedReferencePath = file?.path ?? null;
		this.renderReferenceEmptyHintIfNeeded();
	}

	// ==========================================
	// Main-Bound Outline Renderer
	// ==========================================

	private mountMainOutline(bodyEl: HTMLElement): void {
		bodyEl.empty();
		const outlineRoot = bodyEl.createDiv({ cls: 'wn-immersive-mobile-outline' });
		this.outlineContainerEl = outlineRoot;
		this.renderMainOutline();

		if (typeof this.host.app.metadataCache?.on === 'function') {
			this.outlineMetadataRef = this.host.app.metadataCache.on('changed', (changedFile) => {
				if (this.isDisposed || !this.outlineContainerEl) return;
				const mainFile = this.host.getMainFile();
				if (mainFile && changedFile.path === mainFile.path) {
					this.renderMainOutline();
				}
			});
		}
	}

	private renderMainOutline(): void {
		const container = this.outlineContainerEl;
		if (!container || this.isDisposed) return;
		container.empty();

		const mainFile = this.host.getMainFile();
		const headings = mainFile
			? (this.host.app.metadataCache?.getFileCache?.(mainFile)?.headings ?? [])
			: [];

		if (!mainFile || headings.length === 0) {
			container.createDiv({
				cls: 'wn-immersive-mobile-outline-empty',
				text: t('immersive.mobile-outline-empty')
			});
			return;
		}

		for (const heading of headings) {
			const level = Math.min(6, Math.max(1, heading.level || 1));
			const itemBtn = container.createEl('button', {
				cls: `wn-immersive-mobile-outline-item wn-immersive-mobile-outline-level-${level}`,
				text: heading.heading,
				attr: { type: 'button' }
			});
			itemBtn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const targetLine = heading.position?.start?.line ?? 0;
				this.jumpMainEditorToLine(targetLine);
			});
		}
	}

	private jumpMainEditorToLine(line: number): void {
		const mainLeaf = this.host.getMainLeaf();
		const mainView = this.host.getMainView();
		if (!mainLeaf || !mainView?.editor) return;
		const pos = { line: Math.max(0, line), ch: 0 };
		this.host.app.workspace.setActiveLeaf(mainLeaf, { focus: true });
		if (typeof mainView.editor.setCursor === 'function') {
			mainView.editor.setCursor(pos);
		}
		if (typeof mainView.editor.scrollIntoView === 'function') {
			mainView.editor.scrollIntoView({ from: pos, to: pos }, true);
		}
		if (typeof mainView.editor.focus === 'function') {
			mainView.editor.focus();
		}
	}

	public async notifyMainChapterChanged(mainFile: TFile | null, workChanged: boolean): Promise<void> {
		if (this.isDisposed || !this.isMounted) return;
		this.refreshTopBar();
		if (this.outlineContainerEl) {
			this.renderMainOutline();
		}
		if (this.dirHostedLeaf) {
			const view = this.dirHostedLeaf.leaf.view as { refresh?: () => Promise<void> | void } | undefined;
			if (workChanged && typeof view?.refresh === 'function') {
				void view.refresh();
			}
		}
		if (this.auxHostedLeaf && this.auxState.viewType !== 'reference-view') {
			const view = this.auxHostedLeaf.leaf.view as {
				updateData?: (immediate?: boolean) => Promise<void> | void;
				refresh?: () => Promise<void> | void;
				reloadBoard?: () => Promise<void> | void;
			} | undefined;
			if (typeof view?.updateData === 'function') {
				void view.updateData(true);
			} else if (workChanged && typeof view?.reloadBoard === 'function') {
				void view.reloadBoard();
			} else if (workChanged && typeof view?.refresh === 'function') {
				void view.refresh();
			}
		}
		const refLeaf = this.referenceLeaf;
		const reqSessionGen = this.sessionGeneration;
		const reqAuxGen = this.auxGeneration;
		if (workChanged && mainFile && refLeaf && this.auxState.viewType === 'reference-view') {
			const workPath = this.host.getCurrentWorkPath();
			const nextRefPath = this.host.plugin.immersiveReferenceManager.getReferenceFilePath(workPath);
			const candidate = nextRefPath ? this.host.app.vault.getAbstractFileByPath(nextRefPath) : null;
			const targetFile = candidate instanceof TFile && candidate.extension === 'md' ? candidate : null;
			if (
				this.isDisposed ||
				reqSessionGen !== this.sessionGeneration ||
				reqAuxGen !== this.auxGeneration ||
				refLeaf !== this.referenceLeaf
			) {
				return;
			}
			// 无论切换为目标文档还是清空参考，均经由管理器串行队列与所有权/代次守卫执行
			await this.host.syncMobileWorkReference(refLeaf, targetFile, workPath);
		}
	}

	// ==========================================
	// Safe Leaf Hosting Helpers
	// ==========================================

	private createAuxiliaryLeaf(): WorkspaceLeaf | null {
		const workspace = this.host.app.workspace;
		let leaf: WorkspaceLeaf | null = null;
		if (typeof workspace.getRightLeaf === 'function') {
			leaf = workspace.getRightLeaf(true);
		}
		if (!leaf && typeof workspace.getLeaf === 'function') {
			leaf = workspace.getLeaf('tab');
		}
		if (leaf) {
			this.createdLeaves.add(leaf);
		}
		return leaf;
	}

	private hostLeafInContainer(
		leaf: WorkspaceLeaf,
		targetContainer: HTMLElement,
		extraCleanup?: () => void
	): HostedLeafRecord {
		const leafEl = leaf.containerEl;
		const originalParent = leafEl?.parentElement ?? null;
		const nextSibling = leafEl?.nextSibling ?? null;
		if (leafEl) {
			leafEl.classList?.add('wn-immersive-mobile-hosted-leaf');
			targetContainer.appendChild(leafEl);
		}
		return { leaf, originalParent, nextSibling, extraCleanup };
	}

	private restoreHostedLeafDomWithoutDetach(record: HostedLeafRecord): void {
		try {
			record.extraCleanup?.();
		} catch { /* ignored */ }
		const leafEl = record.leaf.containerEl;
		if (leafEl) {
			leafEl.classList?.remove('wn-immersive-mobile-hosted-leaf', 'wn-immersive-reference-view');
			if (record.originalParent && record.originalParent !== leafEl.parentElement) {
				try {
					if (record.nextSibling && record.nextSibling.parentNode === record.originalParent) {
						record.originalParent.insertBefore(leafEl, record.nextSibling);
					} else {
						record.originalParent.appendChild(leafEl);
					}
				} catch { /* ignored */ }
			}
		}
	}

	private detachHostedLeaf(record: HostedLeafRecord): void {
		this.restoreHostedLeafDomWithoutDetach(record);
		this.detachRawLeaf(record.leaf);
	}

	private detachRawLeaf(leaf: WorkspaceLeaf): void {
		this.createdLeaves.delete(leaf);
		try {
			leaf.detach?.();
		} catch { /* ignored */ }
		try {
			leaf.containerEl?.remove?.();
		} catch { /* ignored */ }
	}

	private restoreMainLeafSilently(): void {
		const mainLeaf = this.host.getMainLeaf();
		if (mainLeaf) {
			this.host.app.workspace.setActiveLeaf(mainLeaf, { focus: false });
		}
	}

	// ==========================================
	// Viewport, Virtual Keyboard & Geometry Clamp
	// ==========================================

	private bindViewportListeners(): void {
		this.unbindViewportListeners();
		const onViewportChange = () => {
			this.syncViewportMetrics(true);
		};
		const vv = this.ownerWindow.visualViewport;
		vv?.addEventListener('resize', onViewportChange);
		vv?.addEventListener('scroll', onViewportChange);
		this.ownerWindow.addEventListener('resize', onViewportChange);
		this.ownerWindow.addEventListener('orientationchange', onViewportChange);

		const RO = (this.ownerWindow as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver
			?? (typeof ResizeObserver !== 'undefined' ? ResizeObserver : undefined);
		let topBarObserver: ResizeObserver | null = null;
		if (RO && this.topBarEl) {
			topBarObserver = new RO(() => {
				this.syncViewportMetrics(true);
			});
			topBarObserver.observe(this.topBarEl);
		}

		this.viewportCleanup = () => {
			vv?.removeEventListener('resize', onViewportChange);
			vv?.removeEventListener('scroll', onViewportChange);
			this.ownerWindow.removeEventListener('resize', onViewportChange);
			this.ownerWindow.removeEventListener('orientationchange', onViewportChange);
			topBarObserver?.disconnect();
		};
	}

	private unbindViewportListeners(): void {
		if (this.viewportCleanup) {
			this.viewportCleanup();
			this.viewportCleanup = null;
		}
	}

	private readCssLengthPx(raw: string | null | undefined): number {
		if (!raw) return 0;
		const parsed = Number.parseFloat(raw.trim());
		return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
	}

	private readInlineCssVarPx(el: { style?: unknown } | null | undefined, varName: string): number {
		const styleObj = el?.style as ({ getPropertyValue?: (n: string) => string } & Record<string, unknown>) | undefined;
		if (!styleObj) return 0;
		const val = typeof styleObj.getPropertyValue === 'function' ? styleObj.getPropertyValue(varName) : styleObj[varName];
		return typeof val === 'string' ? this.readCssLengthPx(val) : 0;
	}

	private readSafeAreaInsets(): { top: number; right: number; bottom: number; left: number } {
		const doc = this.ownerDocument;
		const win = this.ownerWindow;
		const getComputed = typeof win.getComputedStyle === 'function' ? win.getComputedStyle.bind(win) : null;
		const probeStyle = this.safeAreaProbeEl && getComputed ? getComputed(this.safeAreaProbeEl) : null;
		const bodyStyle = doc.body && getComputed ? getComputed(doc.body) : null;
		const rootStyle = doc.documentElement && getComputed ? getComputed(doc.documentElement) : null;

		const readSide = (
			prop: 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft',
			varName: '--safe-area-inset-top' | '--safe-area-inset-right' | '--safe-area-inset-bottom' | '--safe-area-inset-left'
		): number => {
			return Math.max(
				this.readCssLengthPx(probeStyle?.[prop]),
				this.readCssLengthPx(bodyStyle?.getPropertyValue?.(varName)),
				this.readCssLengthPx(rootStyle?.getPropertyValue?.(varName)),
				this.readInlineCssVarPx(doc.body, varName),
				this.readInlineCssVarPx(doc.documentElement, varName)
			);
		};

		return {
			top: readSide('paddingTop', '--safe-area-inset-top'),
			right: readSide('paddingRight', '--safe-area-inset-right'),
			bottom: readSide('paddingBottom', '--safe-area-inset-bottom'),
			left: readSide('paddingLeft', '--safe-area-inset-left')
		};
	}

	private readViewportMetrics(): ViewportMetrics {
		const vv = this.ownerWindow.visualViewport;
		const innerW = typeof this.ownerWindow.innerWidth === 'number' && this.ownerWindow.innerWidth > 0
			? this.ownerWindow.innerWidth : 390;
		const innerH = typeof this.ownerWindow.innerHeight === 'number' && this.ownerWindow.innerHeight > 0
			? this.ownerWindow.innerHeight : 844;
		const width = Math.max(1, Math.round(vv?.width && vv.width > 0 ? vv.width : innerW));
		const height = Math.max(1, Math.round(vv?.height && vv.height > 0 ? vv.height : innerH));
		const top = Math.max(0, Math.round(vv?.offsetTop ?? 0));
		const left = Math.max(0, Math.round(vv?.offsetLeft ?? 0));
		const keyboardInset = Math.max(0, Math.round(innerH - (height + top)));
		return { left, top, width, height, keyboardInset };
	}

	private getTopBarHeight(): number {
		const safeTop = this.readSafeAreaInsets().top;
		const hasStatsRow = this.getSelectedDashboardItems().length > 0;
		const row1Min = this.fullscreenHandle?.isNativeFullscreen
			? Math.max(36, safeTop)
			: (36 + safeTop);
		const minRequired = row1Min + (hasStatsRow ? 32 : 0);
		const rectHeight = typeof this.topBarEl?.getBoundingClientRect === 'function'
			? this.topBarEl.getBoundingClientRect().height
			: 0;
		const offsetHeight = typeof this.topBarEl?.offsetHeight === 'number'
			? this.topBarEl.offsetHeight
			: 0;
		const measured = Math.max(
			Number.isFinite(rectHeight) ? Math.ceil(rectHeight) : 0,
			Number.isFinite(offsetHeight) ? Math.ceil(offsetHeight) : 0
		);
		return Math.max(minRequired, measured);
	}

	private getAuxViewportRect(): MobileAuxViewportRect {
		const metrics = this.readViewportMetrics();
		const topBarHeight = this.getTopBarHeight();
		const insets = this.readSafeAreaInsets();
		const innerW = typeof this.ownerWindow.innerWidth === 'number' && this.ownerWindow.innerWidth > 0
			? this.ownerWindow.innerWidth : metrics.left + metrics.width;
		const innerH = typeof this.ownerWindow.innerHeight === 'number' && this.ownerWindow.innerHeight > 0
			? this.ownerWindow.innerHeight : metrics.top + metrics.height;
		const layoutW = Math.max(innerW, metrics.left + metrics.width);
		const layoutH = Math.max(innerH, metrics.top + metrics.height);

		// Intersect visualViewport with layout safe-area bounds so visualViewport offsets
		// and keyboard insets are never double-counted against side/bottom safe areas.
		const usableLeft = Math.max(metrics.left, insets.left);
		const usableRight = Math.min(metrics.left + metrics.width, layoutW - insets.right);
		const usableTop = metrics.top + topBarHeight;
		const usableBottom = Math.min(metrics.top + metrics.height, layoutH - insets.bottom);

		return {
			left: usableLeft,
			top: usableTop,
			width: Math.max(120, usableRight - usableLeft),
			height: Math.max(MOBILE_AUX_PANEL_BOUNDS.MINIMIZED_HEIGHT, usableBottom - usableTop)
		};
	}

	private isTabletTier(): boolean {
		return !this.ownerDocument.body.classList.contains('is-phone') &&
			(this.ownerDocument.body.classList.contains('is-tablet') || getPlatformTier() === 'tablet');
	}

	private isAuxDocked(): boolean {
		return this.isTabletTier() && this.auxState.isDocked && this.auxState.isOpen && !this.auxState.isMinimized;
	}

	private computeClampedAuxRect(): MobileAuxPanelRect {
		if (this.isAuxDocked()) {
			return clampTabletDockedAuxPanelGeometry(this.auxState.width, this.getAuxViewportRect());
		}
		return clampMobileAuxPanelGeometry(
			{
				x: this.auxState.x,
				y: this.auxState.y,
				width: this.auxState.width,
				height: this.auxState.height
			},
			this.getAuxViewportRect(),
			{ isMinimized: this.auxState.isMinimized }
		);
	}

	private applyRectToAuxPanel(rect: MobileAuxPanelRect): void {
		this.renderedAuxRect = rect;
		const dockWidth = this.isAuxDocked()
			? Math.max(rect.width, (this.ownerWindow.innerWidth || rect.x + rect.width) - rect.x)
			: 0;
		this.ownerDocument.body.setCssProps({ '--wn-immersive-mobile-dock-width': `${dockWidth}px` });
		if (dockWidth !== this.lastDockWidth) {
			this.lastDockWidth = dockWidth;
			this.refreshMainEditorLayout(this.activeGesture?.mode !== 'resize');
		}
		if (!this.auxPanelEl) return;
		this.auxPanelEl.setCssStyles({
			left: `${rect.x}px`,
			top: `${rect.y}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`
		});
	}

	private applyAuxPanelGeometry(): void {
		const clamped = this.computeClampedAuxRect();
		// 仅更新实际渲染位置/尺寸，不修改 auxState 中的用户首选尺寸
		this.applyRectToAuxPanel(clamped);
	}

	public syncViewportMetrics(refreshEditor = true): void {
		if (this.isDisposed || !this.isMounted) return;
		const metrics = this.readViewportMetrics();
		const topBarHeight = this.getTopBarHeight();

		this.ownerDocument.body.setCssProps({
			'--wn-immersive-mobile-viewport-top': `${metrics.top}px`,
			'--wn-immersive-mobile-viewport-left': `${metrics.left}px`,
			'--wn-immersive-mobile-viewport-width': `${metrics.width}px`,
			'--wn-immersive-mobile-viewport-height': `${metrics.height}px`,
			'--wn-immersive-mobile-keyboard-inset': `${metrics.keyboardInset}px`,
			'--wn-immersive-mobile-topbar-height': `${topBarHeight}px`
		});

		if (this.activeGesture?.viewport) this.activeGesture.viewport = this.getAuxViewportRect();

		// 即使面板已锁定，旋转/缩放/软键盘弹出时也必须重新约束以确保控件可达且不覆盖首选尺寸
		this.applyAuxPanelGeometry();

		const dimensionsChanged =
			metrics.height !== this.lastViewportHeight ||
			metrics.width !== this.lastViewportWidth ||
			topBarHeight !== this.lastTopBarHeight;
		this.lastViewportHeight = metrics.height;
		this.lastViewportWidth = metrics.width;
		this.lastTopBarHeight = topBarHeight;

		if (refreshEditor && dimensionsChanged) {
			this.refreshMainEditorLayout();
			if (this.isDirOpen) {
				(this.dirHostedLeaf?.leaf.view as { onResize?: () => void } | undefined)?.onResize?.();
			}
			if (this.auxState.isOpen && !this.auxState.isMinimized) {
				(this.auxHostedLeaf?.leaf.view as { onResize?: () => void } | undefined)?.onResize?.();
			}
		}
	}

	private refreshMainEditorLayout(dispatchUpdate = true): void {
		// 仅刷新主编辑器几何测量与打字机扩展，不抢夺焦点、不改动选区、不打断手动浏览
		// 贴边缩放过程中只请求测量，松手后才派发事务，避免高频刷新扩展。
		const mainView = this.host.getMainView();
		const cm = mainView?.editor?.cm;
		if (cm) {
			cm.requestMeasure?.();
			if (dispatchUpdate) cm.dispatch?.({});
		}
	}

	// ==========================================
	// Teardown & Lifecycle Cleanup
	// ==========================================

	public unmountSync(): void {
		this.isDisposed = true;
		this.isMounted = false;
		this.sessionGeneration++;
		this.dirGeneration++;
		this.auxGeneration++;

		this.cancelActiveGesture();
		this.stopClockInterval();
		this.unbindViewportListeners();
		this.fullscreenHandle?.release();
		this.fullscreenHandle = null;
		const settingsModal = this.activeSettingsModal;
		this.activeSettingsModal = null;
		try { settingsModal?.close(); } catch (err) {
			Logger.warn('[MobileImmersiveController] 关闭快捷设置失败:', err);
		}
		this.suppressRestoreClick = false;

		this.unmountDirectoryLeaf();
		this.clearAuxContentSync();

		for (const leaf of Array.from(this.createdLeaves)) {
			this.detachRawLeaf(leaf);
		}
		this.createdLeaves.clear();

		this.topBarEl?.remove();
		this.topBarEl = null;
		this.topBarStatsEl = null;
		this.workTitleEl = null;
		this.statItemEls = {};
		this.safeAreaProbeEl?.remove();
		this.safeAreaProbeEl = null;
		this.lastTopBarHeight = 0;

		this.dirBackdropEl?.remove();
		this.dirBackdropEl = null;
		this.dirOverlayEl?.remove();
		this.dirOverlayEl = null;
		this.dirBodyEl = null;
		this.dirRestoreBtnEl?.remove();
		this.dirRestoreBtnEl = null;

		this.auxPanelEl?.remove();
		this.auxPanelEl = null;
		this.auxHeaderEl = null;
		this.auxSelectEl = null;
		this.auxLockBtnEl = null;
		this.auxDockBtnEl = null;
		this.lastDockWidth = 0;
		this.auxRestoreBtnEl = null;
		this.auxBodyEl = null;
		this.auxResizeHandleEl = null;
		this.renderedAuxRect = null;

		this.ownerDocument.body.setCssProps({
			'--wn-immersive-mobile-dock-width': '',
			'--wn-immersive-mobile-viewport-top': '',
			'--wn-immersive-mobile-viewport-left': '',
			'--wn-immersive-mobile-viewport-width': '',
			'--wn-immersive-mobile-viewport-height': '',
			'--wn-immersive-mobile-keyboard-inset': '',
			'--wn-immersive-mobile-topbar-height': ''
		});
	}

	public async teardownAsync(): Promise<void> {
		this.isDisposed = true;
		this.isMounted = false;
		this.sessionGeneration++;
		this.dirGeneration++;
		this.auxGeneration++;
		this.cancelActiveGesture();
		this.beginRetireAuxContentSync();
		const pendingDir = this.dirOperationQueue;
		const pendingAux = this.auxOperationQueue;
		const pendingSave = this.pendingSavePromise;
		const pendingRetired = Array.from(this.pendingRetiringRefPromises);
		await Promise.allSettled([pendingDir, pendingAux, pendingSave, ...pendingRetired]);
		await this.flushRetiredReferenceLeavesAsync();
		this.unmountSync();
	}
}
