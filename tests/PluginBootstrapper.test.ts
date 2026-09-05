import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

vi.mock('../src/core/CommandManager', () => ({
	CommandManager: class CommandManager {
		constructor(public plugin: unknown) {}
	}
}));

vi.mock('../src/core/ViewManager', () => ({
	ViewManager: class ViewManager {
		constructor(public plugin: unknown) {}
	}
}));

vi.mock('../src/core/MenuManager', () => ({
	MenuManager: class MenuManager {
		constructor(public plugin: unknown) {}
	}
}));

vi.mock('../src/ui/ImmersiveModeManager', () => ({
	ImmersiveModeManager: class ImmersiveModeManager {
		constructor(public app: unknown, public plugin: unknown) {}
	}
}));

const mockObsStart = vi.fn();
const mockObsStop = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/services/ObsServer', () => ({
	ObsOverlayServer: class ObsOverlayServer {
		start = mockObsStart;
		stop = mockObsStop;
		constructor(public plugin: unknown, public port: number) {}
	}
}));

const mockFloatingStatsLoad = vi.fn();
const mockFloatingStatsUpdate = vi.fn();
const mockFloatingStatsUnload = vi.fn();
vi.mock('../src/ui/MobileFloatingStats', () => ({
	MobileFloatingStats: class MobileFloatingStats {
		load = mockFloatingStatsLoad;
		update = mockFloatingStatsUpdate;
		unload = mockFloatingStatsUnload;
		constructor(public app: unknown, public plugin: unknown) {}
	}
}));

import { PluginBootstrapper, type BootstrapperHost } from '../src/core/PluginBootstrapper';
import { ServiceRegistry, type ServiceMap } from '../src/core/ServiceRegistry';
import { DEFAULT_SETTINGS, PLATFORM_DELAYS } from '../src/constants';
import { ChapterSorter } from '../src/services/ChapterSorter';
import { ObsOverlayServer } from '../src/services/ObsServer';
import { MobileFloatingStats } from '../src/ui/MobileFloatingStats';
import type { HistoryDataManager } from '../src/services/HistoryDataManager';
import type { SettingsManager } from '../src/core/SettingsManager';
import type { StickyNoteDataManager } from '../src/services/StickyNoteDataManager';
import type { ChapterMergeManager } from '../src/services/ChapterMergeManager';
import type { HomepageManager } from '../src/services/HomepageManager';
import type { FloatingStickyNote } from '../src/ui/StickyNote';
import type { FileExplorerPatcher } from '../src/services/FileExplorerPatcher';
import type { CacheManager } from '../src/services/CacheManager';
import type { CharacterManager } from '../src/services/CharacterManager';
import type { LoreSyncService } from '../src/services/LoreSyncService';
import type { AdaptiveDebounceManager } from '../src/services/AdaptiveDebounceManager';
import type { FileEventManager } from '../src/services/FileEventManager';
import type { StatisticsManager } from '../src/services/StatisticsManager';
import type { WorkerManager } from '../src/services/WorkerManager';
import type { MarkdownPostProcessor } from '../src/services/MarkdownPostProcessor';
import type { TypographyManager } from '../src/services/TypographyManager';
import type { CommandManager } from '../src/core/CommandManager';
import type { ViewManager } from '../src/core/ViewManager';
import type { MenuManager } from '../src/core/MenuManager';

describe('PluginBootstrapper', () => {
	let registry: ServiceRegistry;
	let mockPlugin: BootstrapperHost;

	let layoutReadyCallbacks: (() => void)[];
	let registeredCleanups: (() => unknown)[];
	let workspaceEventHandlers: Record<string, ((...args: unknown[]) => unknown)[]>;
	let mockCacheManager: {
		buildFolderCache: ReturnType<typeof vi.fn>;
		saveCache?: ReturnType<typeof vi.fn>;
		loadCache?: ReturnType<typeof vi.fn>;
	};
	let mockFileExplorerPatcher: {
		enable: ReturnType<typeof vi.fn>;
		refreshFolderCounts: ReturnType<typeof vi.fn>;
		disable: ReturnType<typeof vi.fn>;
		destroy: ReturnType<typeof vi.fn>;
	};
	let mockAdaptiveDebounceManager: {
		debounce: ReturnType<typeof vi.fn>;
		debounceFixed: ReturnType<typeof vi.fn>;
	};
	let mockEditorTracker: {
		handleEditorChange: ReturnType<typeof vi.fn>;
		handleFileChange: ReturnType<typeof vi.fn>;
		updateWordCount: ReturnType<typeof vi.fn>;
	};
	let mockClassListRemove: ReturnType<typeof vi.fn>;

	beforeAll(() => {
		vi.stubGlobal('window', {
			moment: Object.assign(() => ({ format: () => '2026-08-20' }), {
				locale: () => 'zh-cn'
			}),
			setTimeout: (fn: (...args: unknown[]) => void, ms?: number) => setTimeout(fn, ms),
			clearTimeout: (id: NodeJS.Timeout | number) => clearTimeout(id),
			setInterval: (fn: (...args: unknown[]) => void, ms?: number) => setInterval(fn, ms),
			clearInterval: (id: NodeJS.Timeout | number) => clearInterval(id)
		});
		vi.stubGlobal('navigator', {
			language: 'zh-CN',
			languages: ['zh-CN', 'en']
		});
	});

	afterAll(() => {
		vi.unstubAllGlobals();
	});

	const EXPECTED_CONSTRUCTOR_SERVICES: readonly (keyof ServiceMap)[] = [
		'CacheManager',
		'AdaptiveDebounceManager',
		'SettingsManager',
		'CharacterManager',
		'LoreSyncService',
		'HistoryDataManager',
		'StickyNoteDataManager',
		'ChapterMergeManager',
		'FileExplorerPatcher',
		'WordCounter',
		'ImmersiveModeManager',
		'CommandManager',
		'ViewManager',
		'MenuManager',
		'StatisticsManager',
		'WorkerManager',
		'MarkdownPostProcessor',
		'HomepageManager'
	];

	const EXPECTED_CORE_RUNTIME_SERVICES: readonly (keyof ServiceMap)[] = [
		'EditorTracker',
		'StyleManager',
		'FileEventManager'
	];

	const EXPECTED_FEATURE_SERVICES: readonly (keyof ServiceMap)[] = [
		'ForeshadowingManager',
		'TaskManager',
		'TimelineManager',
		'RelationGraphManager',
		'TypographyManager',
		'ProofreadingManager'
	];

	beforeEach(() => {
		registry = new ServiceRegistry();
		layoutReadyCallbacks = [];
		registeredCleanups = [];
		workspaceEventHandlers = {};

		mockClassListRemove = vi.fn();
		vi.stubGlobal('activeDocument', {
			body: {
				classList: {
					remove: mockClassListRemove,
					add: vi.fn(),
					contains: vi.fn()
				},
				getElementsByClassName: vi.fn(() => [])
			}
		});

		mockCacheManager = {
			buildFolderCache: vi.fn().mockResolvedValue(undefined),
			saveCache: vi.fn().mockResolvedValue(undefined)
		};
		mockFileExplorerPatcher = {
			enable: vi.fn(),
			refreshFolderCounts: vi.fn(),
			disable: vi.fn(),
			destroy: vi.fn()
		};
		mockAdaptiveDebounceManager = {
			debounce: vi.fn((_key: string, callback: () => void) => callback()),
			debounceFixed: vi.fn((_key: string, callback: () => void, _delay: number) => callback())
		};
		mockEditorTracker = {
			handleEditorChange: vi.fn(),
			handleFileChange: vi.fn().mockResolvedValue(undefined),
			updateWordCount: vi.fn()
		};

		mockPlugin = {
			app: {
				vault: {
					adapter: {
						exists: vi.fn().mockResolvedValue(false),
						read: vi.fn().mockResolvedValue(''),
						write: vi.fn().mockResolvedValue(undefined),
						remove: vi.fn().mockResolvedValue(undefined)
					}
				},
				workspace: {
					on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
						if (!workspaceEventHandlers[event]) {
							workspaceEventHandlers[event] = [];
						}
						workspaceEventHandlers[event].push(handler);
						return { event, handler };
					}),
					onLayoutReady: vi.fn((cb: () => void) => {
						layoutReadyCallbacks.push(cb);
					})
				}
			},
			manifest: {
				dir: 'plugins/test-plugin',
				id: 'test-plugin'
			},
			settings: {
				...DEFAULT_SETTINGS,
				eyeCareEnabled: false,
				eyeCareColor: '#E8F5E9',
				workspaceFolders: []
			},
			cacheManager: mockCacheManager,
			fileExplorerPatcher: mockFileExplorerPatcher,
			adaptiveDebounceManager: mockAdaptiveDebounceManager,
			editorTracker: mockEditorTracker,
			register: vi.fn((cb: () => unknown) => {
				registeredCleanups.push(cb);
			}),
			registerEvent: vi.fn(),
			registerInterval: vi.fn((id: number) => id),
			addRibbonIcon: vi.fn(),
			createStickyNote: vi.fn().mockResolvedValue(undefined),
			refreshFolderCounts: vi.fn(),
			refreshStatusViews: vi.fn(),
			registerSettingsTab: vi.fn(),
			registerWordCountGutter: vi.fn(),
			registerEditorExtensions: vi.fn(),
			registerEditorContextMenu: vi.fn(),
			setupHomepage: vi.fn(),
			setupModalObserver: vi.fn(),
			loadFloatingNotes: vi.fn().mockResolvedValue(undefined),
			registerCommonRibbonIcons: vi.fn(),
			loadSettings: vi.fn().mockResolvedValue(undefined),
			saveSettings: vi.fn().mockResolvedValue(undefined),
			obsServer: null,
			mobileFloatingStats: null,
			activeNotes: [],
			isUnloading: false,
			isTracking: false,
			isLayoutReady: false,
			lastEditTime: 0
		} as unknown as BootstrapperHost;

		mockObsStart.mockClear();
		mockObsStop.mockClear();
		mockFloatingStatsLoad.mockClear();
		mockFloatingStatsUpdate.mockClear();
		mockFloatingStatsUnload.mockClear();
	});

	it('should register constructor-stage services in exact order', () => {
		const registerSpy = vi.spyOn(registry, 'register');
		const bootstrapper = new PluginBootstrapper(mockPlugin, registry);

		bootstrapper.registerConstructorServices();

		const registeredKeys = registerSpy.mock.calls.map(([key]) => key);
		expect(registeredKeys).toEqual(EXPECTED_CONSTRUCTOR_SERVICES);
		for (const key of EXPECTED_CONSTRUCTOR_SERVICES) {
			expect(registry.has(key)).toBe(true);
		}
		for (const key of EXPECTED_CORE_RUNTIME_SERVICES) {
			expect(registry.has(key)).toBe(false);
		}
		for (const key of EXPECTED_FEATURE_SERVICES) {
			expect(registry.has(key)).toBe(false);
		}
	});

	it('should register core runtime services in exact order and keep feature services absent', () => {
		const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
		bootstrapper.registerConstructorServices();

		for (const key of EXPECTED_CORE_RUNTIME_SERVICES) {
			expect(registry.has(key)).toBe(false);
		}
		for (const key of EXPECTED_FEATURE_SERVICES) {
			expect(registry.has(key)).toBe(false);
		}

		const registerSpy = vi.spyOn(registry, 'register');
		bootstrapper.registerCoreRuntimeServices();

		const coreRegisteredKeys = registerSpy.mock.calls.map(([key]) => key);
		expect(coreRegisteredKeys).toEqual(EXPECTED_CORE_RUNTIME_SERVICES);
		for (const key of EXPECTED_CORE_RUNTIME_SERVICES) {
			expect(registry.has(key)).toBe(true);
		}
		for (const key of EXPECTED_FEATURE_SERVICES) {
			expect(registry.has(key)).toBe(false);
		}
	});

	it('should register feature services in exact order after core setup', () => {
		const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
		bootstrapper.registerConstructorServices();
		bootstrapper.registerCoreRuntimeServices();

		for (const key of EXPECTED_FEATURE_SERVICES) {
			expect(registry.has(key)).toBe(false);
		}

		const registerSpy = vi.spyOn(registry, 'register');
		bootstrapper.registerFeatureServices();

		const featureRegisteredKeys = registerSpy.mock.calls.map(([key]) => key);
		expect(featureRegisteredKeys).toEqual(EXPECTED_FEATURE_SERVICES);
		for (const key of EXPECTED_FEATURE_SERVICES) {
			expect(registry.has(key)).toBe(true);
		}

		// Verify all services are now registered
		for (const key of EXPECTED_CONSTRUCTOR_SERVICES) {
			expect(registry.has(key)).toBe(true);
		}
		for (const key of EXPECTED_CORE_RUNTIME_SERVICES) {
			expect(registry.has(key)).toBe(true);
		}
		for (const key of EXPECTED_FEATURE_SERVICES) {
			expect(registry.has(key)).toBe(true);
		}
	});

	it('should register ProofreadingManager and keep it accessible from ServiceRegistry', () => {
		const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
		bootstrapper.registerConstructorServices();
		bootstrapper.registerCoreRuntimeServices();
		bootstrapper.registerFeatureServices();

		const proofreadingManager = registry.get('ProofreadingManager');
		expect(proofreadingManager).toBeDefined();
		expect(typeof proofreadingManager.scan).toBe('function');
		expect(typeof proofreadingManager.enable).toBe('function');
		expect(typeof proofreadingManager.disable).toBe('function');
	});

	describe('Platform Features Assembly', () => {
		describe('setupMobileFeatures', () => {
			it('should schedule delayed cache build with MOBILE_EXPLORER_DELAY and register cleanup when showExplorerCounts is true', () => {
				const setTimeoutSpy = vi.fn((callback: () => void, _delay?: number) => {
					callback();
					return 101;
				});
				const clearTimeoutSpy = vi.fn();
				vi.stubGlobal('window', {
					moment: Object.assign(() => ({ format: () => '2026-08-20' }), {
						locale: () => 'zh-cn'
					}),
					setTimeout: setTimeoutSpy,
					clearTimeout: clearTimeoutSpy,
					setInterval: vi.fn(),
					clearInterval: vi.fn()
				});

				mockPlugin.settings.showExplorerCounts = true;
				const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
				bootstrapper.setupMobileFeatures();

				expect(layoutReadyCallbacks.length).toBeGreaterThan(0);
				layoutReadyCallbacks.forEach(cb => cb());

				expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), PLATFORM_DELAYS.MOBILE_EXPLORER_DELAY);
				expect(mockCacheManager.buildFolderCache).toHaveBeenCalled();
				expect(mockPlugin.register).toHaveBeenCalled();

				registeredCleanups.forEach(cleanup => cleanup());
				expect(clearTimeoutSpy).toHaveBeenCalledWith(101);
			});

			it('should not schedule delayed cache build when showExplorerCounts is false', () => {
				const setTimeoutSpy = vi.fn();
				vi.stubGlobal('window', {
					moment: Object.assign(() => ({ format: () => '2026-08-20' }), {
						locale: () => 'zh-cn'
					}),
					setTimeout: setTimeoutSpy,
					clearTimeout: vi.fn(),
					setInterval: vi.fn(),
					clearInterval: vi.fn()
				});

				mockPlugin.settings.showExplorerCounts = false;
				const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
				bootstrapper.setupMobileFeatures();

				layoutReadyCallbacks.forEach(cb => cb());
				expect(setTimeoutSpy).not.toHaveBeenCalled();
				expect(mockCacheManager.buildFolderCache).not.toHaveBeenCalled();
			});

			it('should register layout-change event and trigger debounced refreshFolderCounts', () => {
				mockPlugin.settings.showExplorerCounts = true;
				const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
				bootstrapper.setupMobileFeatures();

				expect(mockPlugin.registerEvent).toHaveBeenCalled();
				const layoutChangeHandlers = workspaceEventHandlers['layout-change'];
				expect(layoutChangeHandlers).toBeDefined();
				expect(layoutChangeHandlers.length).toBeGreaterThan(0);

				layoutChangeHandlers[0]();
				expect(mockAdaptiveDebounceManager.debounceFixed).toHaveBeenCalledWith(
					'mobile-folder-refresh',
					expect.any(Function),
					300
				);
				expect(mockPlugin.refreshFolderCounts).toHaveBeenCalled();
			});

			it('should configure custom rules and enable file explorer patcher on layout ready when smart chapter sort is enabled', () => {
				mockPlugin.settings.enableSmartChapterSort = true;
				mockPlugin.settings.chapterNamingRules = [{ name: 'Standard', pattern: '^第(\\d+)章', enabled: true }];
				const setCustomRulesSpy = vi.spyOn(ChapterSorter, 'setCustomRules');

				const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
				bootstrapper.setupMobileFeatures();

				expect(setCustomRulesSpy).toHaveBeenCalledWith(mockPlugin.settings.chapterNamingRules);
				layoutReadyCallbacks.forEach(cb => cb());
				expect(mockFileExplorerPatcher.enable).toHaveBeenCalled();
			});
		});

		describe('setupTabletFeatures', () => {
			it('should schedule delayed cache build with TABLET_EXPLORER_DELAY and register cleanup when showExplorerCounts is true', () => {
				const setTimeoutSpy = vi.fn((callback: () => void, _delay?: number) => {
					callback();
					return 202;
				});
				const clearTimeoutSpy = vi.fn();
				vi.stubGlobal('window', {
					moment: Object.assign(() => ({ format: () => '2026-08-20' }), {
						locale: () => 'zh-cn'
					}),
					setTimeout: setTimeoutSpy,
					clearTimeout: clearTimeoutSpy,
					setInterval: vi.fn(),
					clearInterval: vi.fn()
				});

				mockPlugin.settings.showExplorerCounts = true;
				const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
				bootstrapper.setupTabletFeatures();

				layoutReadyCallbacks.forEach(cb => cb());

				expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), PLATFORM_DELAYS.TABLET_EXPLORER_DELAY);
				expect(mockCacheManager.buildFolderCache).toHaveBeenCalled();
				expect(mockPlugin.register).toHaveBeenCalled();

				registeredCleanups.forEach(cleanup => cleanup());
				expect(clearTimeoutSpy).toHaveBeenCalledWith(202);
			});

			it('should not schedule delayed cache or register layout-change event when showExplorerCounts is false', () => {
				const setTimeoutSpy = vi.fn();
				vi.stubGlobal('window', {
					moment: Object.assign(() => ({ format: () => '2026-08-20' }), {
						locale: () => 'zh-cn'
					}),
					setTimeout: setTimeoutSpy,
					clearTimeout: vi.fn(),
					setInterval: vi.fn(),
					clearInterval: vi.fn()
				});

				mockPlugin.settings.showExplorerCounts = false;
				const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
				bootstrapper.setupTabletFeatures();

				layoutReadyCallbacks.forEach(cb => cb());
				expect(setTimeoutSpy).not.toHaveBeenCalled();
				expect(workspaceEventHandlers['layout-change']).toBeUndefined();
			});

			it('should register layout-change event with tablet-folder-refresh debounce key', () => {
				mockPlugin.settings.showExplorerCounts = true;
				const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
				bootstrapper.setupTabletFeatures();

				const layoutChangeHandlers = workspaceEventHandlers['layout-change'];
				expect(layoutChangeHandlers).toBeDefined();

				layoutChangeHandlers[0]();
				expect(mockAdaptiveDebounceManager.debounceFixed).toHaveBeenCalledWith(
					'tablet-folder-refresh',
					expect.any(Function),
					300
				);
				expect(mockPlugin.refreshFolderCounts).toHaveBeenCalled();
			});
		});

		describe('setupDesktopFeatures', () => {
			it('should schedule delayed cache build with DESKTOP_EXPLORER_DELAY and register cleanup', () => {
				const setTimeoutSpy = vi.fn((callback: () => void, _delay?: number) => {
					callback();
					return 303;
				});
				const clearTimeoutSpy = vi.fn();
				vi.stubGlobal('window', {
					moment: Object.assign(() => ({ format: () => '2026-08-20' }), {
						locale: () => 'zh-cn'
					}),
					setTimeout: setTimeoutSpy,
					clearTimeout: clearTimeoutSpy,
					setInterval: vi.fn(),
					clearInterval: vi.fn()
				});

				const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
				bootstrapper.setupDesktopFeatures();

				layoutReadyCallbacks.forEach(cb => cb());

				expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), PLATFORM_DELAYS.DESKTOP_EXPLORER_DELAY);
				expect(mockCacheManager.buildFolderCache).toHaveBeenCalled();
				expect(mockPlugin.register).toHaveBeenCalled();

				registeredCleanups.forEach(cleanup => cleanup());
				expect(clearTimeoutSpy).toHaveBeenCalledWith(303);
			});

			it('should register sticky-note ribbon icon and invoke createStickyNote on click', () => {
				const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
				bootstrapper.setupDesktopFeatures();

				expect(mockPlugin.addRibbonIcon).toHaveBeenCalledWith(
					'sticky-note',
					expect.any(String),
					expect.any(Function)
				);

				const ribbonCalls = vi.mocked(mockPlugin.addRibbonIcon).mock.calls;
				expect(ribbonCalls.length).toBe(1);
				const callback = ribbonCalls[0][2];
				callback({} as MouseEvent);
				expect(mockPlugin.createStickyNote).toHaveBeenCalledWith({
					content: '',
					title: expect.any(String)
				});
			});

			it('should create, assign, and start ObsOverlayServer when obs.enableObs is true', () => {
				mockPlugin.settings.obs.enableObs = true;
				mockPlugin.settings.obs.obsPort = 8080;

				const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
				bootstrapper.setupDesktopFeatures();

				expect(mockPlugin.obsServer).toBeInstanceOf(ObsOverlayServer);
				expect(mockObsStart).toHaveBeenCalled();
			});

			it('should not create ObsOverlayServer when obs.enableObs is false', () => {
				mockPlugin.settings.obs.enableObs = false;

				const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
				bootstrapper.setupDesktopFeatures();

				expect(mockPlugin.obsServer).toBeNull();
				expect(mockObsStart).not.toHaveBeenCalled();
			});

			it('should configure custom rules and enable file explorer patcher on layout ready when enableSmartChapterSort is true', () => {
				mockPlugin.settings.enableSmartChapterSort = true;
				mockPlugin.settings.chapterNamingRules = [{ name: 'Standard', pattern: '^第(\\d+)章', enabled: true }];
				const setCustomRulesSpy = vi.spyOn(ChapterSorter, 'setCustomRules');

				const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
				bootstrapper.setupDesktopFeatures();

				expect(setCustomRulesSpy).toHaveBeenCalledWith(mockPlugin.settings.chapterNamingRules);
				layoutReadyCallbacks.forEach(cb => cb());
				expect(mockFileExplorerPatcher.enable).toHaveBeenCalled();
			});
		});

		describe('shared floating stats behavior', () => {
			it('should instantiate MobileFloatingStats, load on layout ready, and register event/interval listeners owned by plugin', () => {
				let intervalCallback: (() => void) | null = null;
				const setIntervalSpy = vi.fn((callback: () => void, _interval?: number) => {
					intervalCallback = callback;
					return 404;
				});
				vi.stubGlobal('window', {
					moment: Object.assign(() => ({ format: () => '2026-08-20' }), {
						locale: () => 'zh-cn'
					}),
					setTimeout: vi.fn(),
					clearTimeout: vi.fn(),
					setInterval: setIntervalSpy,
					clearInterval: vi.fn()
				});

				mockPlugin.settings.showMobileFloatingStats = true;
				mockPlugin.isTracking = true;

				const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
				bootstrapper.setupMobileFeatures();

				expect(mockPlugin.mobileFloatingStats).toBeInstanceOf(MobileFloatingStats);

				layoutReadyCallbacks.forEach(cb => cb());
				expect(mockFloatingStatsLoad).toHaveBeenCalled();

				// Check editor-change event
				expect(workspaceEventHandlers['editor-change']).toBeDefined();
				workspaceEventHandlers['editor-change'][0]();
				expect(mockAdaptiveDebounceManager.debounce).toHaveBeenCalledWith(
					'mobile-stats-update',
					expect.any(Function)
				);
				expect(mockFloatingStatsUpdate).toHaveBeenCalled();

				// Check workbench-book-changed event
				mockFloatingStatsUpdate.mockClear();
				expect(workspaceEventHandlers['webnovel-workbench-book-changed']).toBeDefined();
				workspaceEventHandlers['webnovel-workbench-book-changed'][0]();
				expect(mockPlugin.refreshStatusViews).toHaveBeenCalled();
				expect(mockEditorTracker.handleFileChange).toHaveBeenCalled();

				// Check active-leaf-change event
				expect(workspaceEventHandlers['active-leaf-change']).toBeDefined();
				workspaceEventHandlers['active-leaf-change'][0]();
				expect(mockFloatingStatsUpdate).toHaveBeenCalled();

				// Check 1s interval registration
				expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
				expect(mockPlugin.registerInterval).toHaveBeenCalledWith(404);

				// When tracking is active, interval callback updates stats
				mockFloatingStatsUpdate.mockClear();
				(intervalCallback as (() => void) | null)?.();
				expect(mockFloatingStatsUpdate).toHaveBeenCalled();

				// When tracking is inactive, interval callback does not update stats
				mockPlugin.isTracking = false;
				mockFloatingStatsUpdate.mockClear();
				(intervalCallback as (() => void) | null)?.();
				expect(mockFloatingStatsUpdate).not.toHaveBeenCalled();
			});

			it('should not instantiate MobileFloatingStats when showMobileFloatingStats is false', () => {
				mockPlugin.settings.showMobileFloatingStats = false;

				const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
				bootstrapper.setupMobileFeatures();

				expect(mockPlugin.mobileFloatingStats).toBeNull();
				expect(mockFloatingStatsLoad).not.toHaveBeenCalled();
			});
		});
	});

	describe('shutdown', () => {
		let mockHistoryManager: { flush: ReturnType<typeof vi.fn> };
		let mockSettingsManager: { flush: ReturnType<typeof vi.fn> };
		let mockStickyNoteManager: {
			saveNotes: ReturnType<typeof vi.fn>;
			getNotes: ReturnType<typeof vi.fn>;
			updateNote: ReturnType<typeof vi.fn>;
		};
		let mockChapterMergeManager: { flush: ReturnType<typeof vi.fn> };
		let mockHomepageManager: { cleanup: ReturnType<typeof vi.fn> };
		let mockObsServerInstance: { stop: ReturnType<typeof vi.fn> };
		let mockMobileStatsInstance: { unload: ReturnType<typeof vi.fn> };
		let mockDomElements: {
			remove: ReturnType<typeof vi.fn>;
		}[];
		let mockNote1: { state: { id: string; isEditing: boolean; content: string }; textareaEl: { value: string }; destroy: ReturnType<typeof vi.fn> };
		let mockNote2: { state: { id: string; isEditing: boolean; content: string }; destroy: ReturnType<typeof vi.fn> };

		beforeEach(() => {
			mockHistoryManager = { flush: vi.fn().mockResolvedValue(undefined) };
			mockSettingsManager = { flush: vi.fn().mockResolvedValue(undefined) };
			mockStickyNoteManager = {
				saveNotes: vi.fn().mockResolvedValue(undefined),
				getNotes: vi.fn().mockReturnValue([{ id: 'note-1', content: 'new-content' }, { id: 'note-2', content: 'view-only' }]),
				updateNote: vi.fn()
			};
			mockChapterMergeManager = { flush: vi.fn().mockResolvedValue(undefined) };
			mockHomepageManager = { cleanup: vi.fn() };
			mockCacheManager.saveCache = vi.fn().mockResolvedValue(undefined);

			registry.register('HomepageManager', mockHomepageManager as unknown as HomepageManager);
			registry.register('FileExplorerPatcher', mockFileExplorerPatcher as unknown as FileExplorerPatcher);

			mockObsServerInstance = { stop: vi.fn().mockResolvedValue(undefined) };
			mockMobileStatsInstance = { unload: vi.fn() };

			mockDomElements = [
				{
					remove: vi.fn()
				},
				{
					remove: vi.fn()
				}
			];
			(activeDocument.body as unknown as { getElementsByClassName: ReturnType<typeof vi.fn> }).getElementsByClassName = vi.fn((cls: string) => {
				return cls === 'my-floating-sticky-note' ? mockDomElements : [];
			});

			mockNote1 = {
				state: { id: 'note-1', isEditing: true, content: 'old' },
				textareaEl: { value: 'new-content' },
				destroy: vi.fn()
			};
			mockNote2 = {
				state: { id: 'note-2', isEditing: false, content: 'view-only' },
				destroy: vi.fn()
			};

			mockPlugin.historyManager = mockHistoryManager as unknown as HistoryDataManager;
			mockPlugin.settingsManager = mockSettingsManager as unknown as SettingsManager;
			mockPlugin.stickyNoteManager = mockStickyNoteManager as unknown as StickyNoteDataManager;
			mockPlugin.chapterMergeManager = mockChapterMergeManager as unknown as ChapterMergeManager;
			mockPlugin.obsServer = mockObsServerInstance as unknown as ObsOverlayServer;
			mockPlugin.mobileFloatingStats = mockMobileStatsInstance as unknown as MobileFloatingStats;
			mockPlugin.activeNotes = [mockNote1, mockNote2] as unknown as FloatingStickyNote[];
			mockPlugin.isUnloading = false;
		});

		it('should perform synchronous visual cleanup immediately before awaiting asynchronous teardown', () => {
			const bootstrapper = new PluginBootstrapper(mockPlugin, registry);

			// Call shutdown without await to verify synchronous turn
			const shutdownPromise = bootstrapper.shutdown();

			expect(mockPlugin.isUnloading).toBe(true);
			expect(mockClassListRemove).toHaveBeenCalledWith(
				'webnovel-notes-hidden',
				'webnovel-custom-dragging',
				'webnovel-eye-care-enabled',
				'immersive-mode-active',
				'immersive-hide-properties'
			);
			expect(mockDomElements[0].remove).toHaveBeenCalled();
			expect(mockDomElements[1].remove).toHaveBeenCalled();

			expect(mockMobileStatsInstance.unload).toHaveBeenCalled();
			expect(mockPlugin.mobileFloatingStats).toBeNull();

			expect(mockNote1.state.content).toBe('new-content');
			expect(mockStickyNoteManager.updateNote).toHaveBeenCalledWith(mockNote1.state);
			expect(mockNote1.destroy).toHaveBeenCalled();
			expect(mockStickyNoteManager.updateNote).toHaveBeenCalledWith(mockNote2.state);
			expect(mockNote2.destroy).toHaveBeenCalled();
			expect(mockPlugin.activeNotes).toEqual([]);

			expect(mockHomepageManager.cleanup).toHaveBeenCalled();
			expect(mockFileExplorerPatcher.destroy).toHaveBeenCalledTimes(1);

			expect(mockPlugin.obsServer).toBeNull();

			return shutdownPromise;
		});

		it('should coordinate teardown in exact order and settle all persistence promises before destroyAll', async () => {
			const createDeferred = <T = void>() => {
				let resolve!: (value: T | PromiseLike<T>) => void;
				let reject!: (reason?: unknown) => void;
				const promise = new Promise<T>((res, rej) => {
					resolve = res;
					reject = rej;
				});
				return { promise, resolve, reject };
			};

			const obsGate = createDeferred<void>();
			const historyGate = createDeferred<void>();
			const settingsGate = createDeferred<void>();
			const stickyGate = createDeferred<void>();
			const cacheGate = createDeferred<void>();
			const chapterMergeGate = createDeferred<void>();

			const executionOrder: string[] = [];

			mockFileExplorerPatcher.destroy.mockImplementation(() => {
				executionOrder.push('fileExplorer.destroy');
			});
			mockObsServerInstance.stop.mockImplementation(async () => {
				executionOrder.push('obs.stop:start');
				await obsGate.promise;
				executionOrder.push('obs.stop:done');
			});
			mockHistoryManager.flush.mockImplementation(async () => {
				executionOrder.push('history.flush:start');
				await historyGate.promise;
				executionOrder.push('history.flush:done');
			});
			mockSettingsManager.flush.mockImplementation(async () => {
				executionOrder.push('settings.flush:start');
				await settingsGate.promise;
				executionOrder.push('settings.flush:done');
			});
			mockStickyNoteManager.saveNotes.mockImplementation(async () => {
				executionOrder.push('sticky.saveNotes:start');
				await stickyGate.promise;
				executionOrder.push('sticky.saveNotes:done');
			});
			mockCacheManager.saveCache!.mockImplementation(async () => {
				executionOrder.push('cache.saveCache:start');
				await cacheGate.promise;
				executionOrder.push('cache.saveCache:done');
			});
			mockChapterMergeManager.flush.mockImplementation(async () => {
				executionOrder.push('chapterMerge.flush:start');
				await chapterMergeGate.promise;
				executionOrder.push('chapterMerge.flush:done');
			});

			const destroyAllSpy = vi.spyOn(registry, 'destroyAll').mockImplementation(async () => {
				executionOrder.push('registry.destroyAll');
			});

			const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
			const shutdownPromise = bootstrapper.shutdown();

			// Assert destroy was called synchronously before any deferred promise resolves
			expect(mockFileExplorerPatcher.destroy).toHaveBeenCalledTimes(1);
			expect(executionOrder).toContain('fileExplorer.destroy');

			// Microtask tick to ensure shutdown reached the pending gates
			await Promise.resolve();

			expect(mockObsServerInstance.stop).toHaveBeenCalledTimes(1);
			expect(mockHistoryManager.flush).toHaveBeenCalledTimes(1);
			expect(mockSettingsManager.flush).toHaveBeenCalledTimes(1);
			expect(mockStickyNoteManager.saveNotes).toHaveBeenCalledWith(mockStickyNoteManager.getNotes());
			expect(mockCacheManager.saveCache).toHaveBeenCalledTimes(1);
			expect(mockChapterMergeManager.flush).toHaveBeenCalledTimes(1);

			// Assert destroyAll has NOT run while promises remain pending
			expect(destroyAllSpy).not.toHaveBeenCalled();

			// Resolve all gates, including a rejection case to ensure failure isolation during allSettled
			obsGate.reject(new Error('OBS stop failed'));
			historyGate.resolve();
			settingsGate.resolve();
			stickyGate.resolve();
			cacheGate.resolve();
			chapterMergeGate.resolve();

			await shutdownPromise;

			expect(destroyAllSpy).toHaveBeenCalledTimes(1);

			// Ensure synchronous destroy and all persistence/stop operations ran before destroyAll
			const destroyIndex = executionOrder.indexOf('fileExplorer.destroy');
			const destroyAllIndex = executionOrder.indexOf('registry.destroyAll');
			expect(destroyIndex).toBeGreaterThan(-1);
			expect(destroyAllIndex).toBeGreaterThan(-1);
			expect(destroyIndex).toBeLessThan(destroyAllIndex);
			expect(executionOrder.indexOf('obs.stop:start')).toBeLessThan(destroyAllIndex);
			expect(executionOrder.indexOf('history.flush:done')).toBeLessThan(destroyAllIndex);
			expect(executionOrder.indexOf('settings.flush:done')).toBeLessThan(destroyAllIndex);
			expect(executionOrder.indexOf('sticky.saveNotes:done')).toBeLessThan(destroyAllIndex);
			expect(executionOrder.indexOf('cache.saveCache:done')).toBeLessThan(destroyAllIndex);
			expect(executionOrder.indexOf('chapterMerge.flush:done')).toBeLessThan(destroyAllIndex);
		});

		it('should be idempotent on repeated shutdown calls and not issue a second explicit early destroy', async () => {
			const destroyAllSpy = vi.spyOn(registry, 'destroyAll').mockResolvedValue(undefined);
			const bootstrapper = new PluginBootstrapper(mockPlugin, registry);

			const p1 = bootstrapper.shutdown();
			const p2 = bootstrapper.shutdown();
			const p3 = bootstrapper.shutdown();

			expect(p1).toBe(p2);
			expect(p2).toBe(p3);
			expect(mockFileExplorerPatcher.destroy).toHaveBeenCalledTimes(1);

			await p1;

			// Repeated call after completion
			const p4 = bootstrapper.shutdown();
			expect(p4).toBe(p1);
			await p4;

			expect(mockFileExplorerPatcher.destroy).toHaveBeenCalledTimes(1);
			expect(mockObsServerInstance.stop).toHaveBeenCalledTimes(1);
			expect(mockMobileStatsInstance.unload).toHaveBeenCalledTimes(1);
			expect(mockHomepageManager.cleanup).toHaveBeenCalledTimes(1);
			expect(mockHistoryManager.flush).toHaveBeenCalledTimes(1);
			expect(mockSettingsManager.flush).toHaveBeenCalledTimes(1);
			expect(mockStickyNoteManager.saveNotes).toHaveBeenCalledTimes(1);
			expect(mockCacheManager.saveCache).toHaveBeenCalledTimes(1);
			expect(mockChapterMergeManager.flush).toHaveBeenCalledTimes(1);
			expect(destroyAllSpy).toHaveBeenCalledTimes(1);
		});

		it('should ensure synchronous terminal destroy occurs before deferred persistence and later registry destroyAll runs', async () => {
			const executionOrder: string[] = [];
			let destroyCalls = 0;

			const mockPatcher = {
				enable: vi.fn(),
				refreshFolderCounts: vi.fn(),
				disable: vi.fn(),
				destroy: vi.fn(() => {
					destroyCalls++;
					executionOrder.push(`patcher.destroy:${destroyCalls}`);
				})
			};

			registry.register('FileExplorerPatcher', mockPatcher as unknown as FileExplorerPatcher);

			const bootstrapper = new PluginBootstrapper(mockPlugin, registry);

			expect(mockPatcher.destroy).not.toHaveBeenCalled();

			const shutdownPromise = bootstrapper.shutdown();

			// Synchronously before persistence completes, destroy was called once
			expect(mockPatcher.destroy).toHaveBeenCalledTimes(1);
			expect(executionOrder).toEqual(['patcher.destroy:1']);

			await shutdownPromise;

			// After persistence settles, registry.destroyAll invokes destroy on services in registry
			expect(mockPatcher.destroy).toHaveBeenCalledTimes(2);
			expect(executionOrder).toEqual(['patcher.destroy:1', 'patcher.destroy:2']);

			// Repeated shutdown should not call explicit early destroy again
			await bootstrapper.shutdown();
			expect(mockPatcher.destroy).toHaveBeenCalledTimes(2);
		});

		it('should be resilient to individual persistence failures and still execute registry.destroyAll', async () => {
			mockHistoryManager.flush.mockRejectedValue(new Error('History flush disk error'));
			mockSettingsManager.flush.mockRejectedValue(new Error('Settings flush disk error'));
			mockStickyNoteManager.saveNotes.mockRejectedValue(new Error('Sticky save error'));
			mockCacheManager.saveCache!.mockRejectedValue(new Error('Cache save error'));
			mockChapterMergeManager.flush.mockRejectedValue(new Error('Chapter merge flush error'));
			mockObsServerInstance.stop.mockRejectedValue(new Error('OBS stop network error'));

			const destroyAllSpy = vi.spyOn(registry, 'destroyAll').mockResolvedValue(undefined);
			const bootstrapper = new PluginBootstrapper(mockPlugin, registry);

			await expect(bootstrapper.shutdown()).resolves.toBeUndefined();

			expect(mockHistoryManager.flush).toHaveBeenCalled();
			expect(mockSettingsManager.flush).toHaveBeenCalled();
			expect(mockStickyNoteManager.saveNotes).toHaveBeenCalled();
			expect(mockCacheManager.saveCache).toHaveBeenCalled();
			expect(mockChapterMergeManager.flush).toHaveBeenCalled();
			expect(destroyAllSpy).toHaveBeenCalledTimes(1);
		});

		it('should handle synchronous throw in history flush without preventing destroyAll', async () => {
			mockHistoryManager.flush.mockImplementation(() => {
				throw new Error('Sync error in history flush');
			});

			const destroyAllSpy = vi.spyOn(registry, 'destroyAll').mockResolvedValue(undefined);
			const bootstrapper = new PluginBootstrapper(mockPlugin, registry);

			await expect(bootstrapper.shutdown()).resolves.toBeUndefined();

			expect(mockSettingsManager.flush).toHaveBeenCalled();
			expect(mockCacheManager.saveCache).toHaveBeenCalled();
			expect(destroyAllSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('bootstrap and rollback', () => {
		it('should rollback cleanly on startup failure, await destroyAll, skip normal persistence, and keep later shutdown idempotent', async () => {
			const createDeferred = <T = void>() => {
				let resolve!: (value: T | PromiseLike<T>) => void;
				let reject!: (reason?: unknown) => void;
				const promise = new Promise<T>((res, rej) => {
					resolve = res;
					reject = rej;
				});
				return { promise, resolve, reject };
			};

			const mockHistoryManager = { flush: vi.fn().mockResolvedValue(undefined), loadHistory: vi.fn().mockResolvedValue(undefined) };
			const mockSettingsManager = { flush: vi.fn().mockResolvedValue(undefined), loadSettings: vi.fn().mockResolvedValue(mockPlugin.settings) };
			const mockStickyNoteManager = {
				saveNotes: vi.fn().mockResolvedValue(undefined),
				getNotes: vi.fn().mockReturnValue([]),
				updateNote: vi.fn()
			};
			const mockChapterMergeManager = { flush: vi.fn().mockResolvedValue(undefined) };
			const mockHomepageManager = { cleanup: vi.fn() };
			mockCacheManager.saveCache = vi.fn().mockResolvedValue(undefined);
			mockCacheManager.loadCache = vi.fn().mockResolvedValue(undefined);

			registry.register('HomepageManager', mockHomepageManager as unknown as HomepageManager);
			registry.register('FileExplorerPatcher', mockFileExplorerPatcher as unknown as FileExplorerPatcher);

			mockPlugin.historyManager = mockHistoryManager as unknown as HistoryDataManager;
			mockPlugin.settingsManager = mockSettingsManager as unknown as SettingsManager;
			mockPlugin.stickyNoteManager = mockStickyNoteManager as unknown as StickyNoteDataManager;
			mockPlugin.chapterMergeManager = mockChapterMergeManager as unknown as ChapterMergeManager;
			mockPlugin.cacheManager = mockCacheManager as unknown as CacheManager;

			const startupError = new Error('Startup failure after initial loading');

			mockPlugin.loreSyncService = { initialize: vi.fn() } as unknown as LoreSyncService;
			mockPlugin.characterManager = { initialize: vi.fn().mockResolvedValue(undefined) } as unknown as CharacterManager;
			mockPlugin.fileEventManager = {
				setup: vi.fn(() => {
					throw startupError;
				})
			} as unknown as FileEventManager;
			mockPlugin.statisticsManager = { setup: vi.fn() } as unknown as StatisticsManager;
			mockPlugin.workerManager = { setup: vi.fn() } as unknown as WorkerManager;
			mockPlugin.markdownPostProcessor = { getProcessor: vi.fn() } as unknown as MarkdownPostProcessor;
			mockPlugin.typographyManager = { updateTypography: vi.fn() } as unknown as TypographyManager;
			mockPlugin.commandManager = { registerAllCommands: vi.fn() } as unknown as CommandManager;
			mockPlugin.viewManager = { registerAllViews: vi.fn() } as unknown as ViewManager;
			mockPlugin.menuManager = { registerAllMenus: vi.fn() } as unknown as MenuManager;
			mockPlugin.addStatusBarItem = vi.fn().mockReturnValue({});

			const destroyGate = createDeferred<void>();
			const destroyStarted = createDeferred<void>();
			let destroyAllResolved = false;
			const destroyAll = registry.destroyAll.bind(registry);
			const destroyAllSpy = vi.spyOn(registry, 'destroyAll').mockImplementation(async () => {
				destroyStarted.resolve();
				await destroyGate.promise;
				await destroyAll();
				destroyAllResolved = true;
			});

			const bootstrapper = new PluginBootstrapper(mockPlugin, registry);

			const bootstrapPromise = bootstrapper.bootstrap();

			await destroyStarted.promise;
			expect(destroyAllSpy).toHaveBeenCalledTimes(1);
			expect(destroyAllResolved).toBe(false);

			destroyGate.resolve();

			let caughtError: unknown;
			try {
				await bootstrapPromise;
			} catch (err) {
				caughtError = err;
			}
			expect(caughtError).toBe(startupError);
			expect(destroyAllResolved).toBe(true);
			expect(registry.has('HomepageManager')).toBe(false);
			expect(registry.has('FileExplorerPatcher')).toBe(false);

			expect(mockHistoryManager.flush).not.toHaveBeenCalled();
			expect(mockSettingsManager.flush).not.toHaveBeenCalled();
			expect(mockStickyNoteManager.saveNotes).not.toHaveBeenCalled();
			expect(mockCacheManager.saveCache).not.toHaveBeenCalled();
			expect(mockChapterMergeManager.flush).not.toHaveBeenCalled();

			expect(destroyAllSpy).toHaveBeenCalledTimes(1);

			await bootstrapper.shutdown();
			expect(destroyAllSpy).toHaveBeenCalledTimes(1);
			expect(mockHistoryManager.flush).not.toHaveBeenCalled();
			expect(mockSettingsManager.flush).not.toHaveBeenCalled();
			expect(mockStickyNoteManager.saveNotes).not.toHaveBeenCalled();
			expect(mockCacheManager.saveCache).not.toHaveBeenCalled();
			expect(mockChapterMergeManager.flush).not.toHaveBeenCalled();
		});

		it('should preserve and reject with the original startup error even if rollback cleanup throws', async () => {
			const startupError = new Error('Original startup crash');
			const rollbackError = new Error('Rollback cleanup crash');
			const cleanup = vi.fn(() => {
				throw rollbackError;
			});

			mockPlugin.loadSettings = vi.fn().mockRejectedValue(startupError);
			registry.register('HomepageManager', { cleanup } as unknown as HomepageManager);

			const bootstrapper = new PluginBootstrapper(mockPlugin, registry);

			let caughtError: unknown;
			try {
				await bootstrapper.bootstrap();
			} catch (err) {
				caughtError = err;
			}

			expect(caughtError).toBe(startupError);
			expect(cleanup).toHaveBeenCalledTimes(1);
		});
	});

	describe('Immediate Layout Ready', () => {
		it('should not fail if onLayoutReady executes synchronously (ProofreadingManager is ready)', async () => {
			let proofreadingInitializeSpy: unknown;
			let characterInitializeSpy: unknown;

			let callCount = 0;
			mockPlugin.app.workspace.onLayoutReady = vi.fn((cb: () => void) => {
				callCount++;
				if (callCount === 1) {
					if (registry.has('ProofreadingManager')) {
						const pm = registry.get('ProofreadingManager') as { initialize: (...args: unknown[]) => unknown };
						proofreadingInitializeSpy = vi.spyOn(pm, 'initialize').mockResolvedValue(undefined);
					}
					if (registry.has('CharacterManager')) {
						const cm = registry.get('CharacterManager') as { initialize: (...args: unknown[]) => unknown };
						characterInitializeSpy = vi.spyOn(cm, 'initialize').mockResolvedValue(undefined);
					}
					cb();
				} else {
					layoutReadyCallbacks.push(cb);
				}
			});

			Object.defineProperty(mockPlugin, 'proofreadingManager', {
				get: () => registry.get('ProofreadingManager'),
				configurable: true
			});
			Object.defineProperty(mockPlugin, 'characterManager', {
				get: () => registry.get('CharacterManager'),
				configurable: true
			});

			mockPlugin.historyManager = { loadHistory: vi.fn().mockResolvedValue(undefined) } as unknown as HistoryDataManager;
			mockPlugin.cacheManager.loadCache = vi.fn().mockResolvedValue(undefined);

			mockPlugin.loreSyncService = { initialize: vi.fn() } as unknown as LoreSyncService;
			mockPlugin.fileEventManager = { setup: vi.fn() } as unknown as FileEventManager;
			mockPlugin.statisticsManager = { setup: vi.fn() } as unknown as StatisticsManager;
			mockPlugin.workerManager = { setup: vi.fn() } as unknown as WorkerManager;
			mockPlugin.markdownPostProcessor = { getProcessor: vi.fn() } as unknown as MarkdownPostProcessor;
			mockPlugin.typographyManager = { updateTypography: vi.fn() } as unknown as TypographyManager;
			mockPlugin.commandManager = { registerAllCommands: vi.fn() } as unknown as CommandManager;
			mockPlugin.viewManager = { registerAllViews: vi.fn() } as unknown as ViewManager;
			mockPlugin.menuManager = { registerAllMenus: vi.fn() } as unknown as MenuManager;
			mockPlugin.registerMarkdownPostProcessor = vi.fn();
			mockPlugin.addStatusBarItem = vi.fn().mockReturnValue({});
			Object.assign(mockPlugin.app, {
				metadataCache: { on: vi.fn(() => ({})) }
			});

			const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
			bootstrapper.registerConstructorServices();

			await expect(bootstrapper.bootstrap()).resolves.toBeUndefined();

			expect(proofreadingInitializeSpy).toBeDefined();
			expect(proofreadingInitializeSpy).toHaveBeenCalledTimes(1);

			expect(characterInitializeSpy).toBeDefined();
			expect(characterInitializeSpy).toHaveBeenCalledTimes(1);

			expect(registry.has('ProofreadingManager')).toBe(true);
		});
	});

	describe('editor-change activity tracking', () => {
		it('should synchronously refresh lastEditTime on editor-change even before debounced callback runs', async () => {
			let debouncedCallback: (() => void) | null = null;
			mockAdaptiveDebounceManager.debounce = vi.fn((key: string, callback: () => void) => {
				if (key === 'editor-update') {
					debouncedCallback = callback;
				}
			});

			mockPlugin.lastEditTime = 1000;
			const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
			bootstrapper.registerConstructorServices();

			mockPlugin.historyManager = { loadHistory: vi.fn().mockResolvedValue(undefined) } as unknown as HistoryDataManager;
			mockPlugin.cacheManager.loadCache = vi.fn().mockResolvedValue(undefined);
			mockPlugin.loreSyncService = { initialize: vi.fn() } as unknown as LoreSyncService;
			mockPlugin.fileEventManager = { setup: vi.fn() } as unknown as FileEventManager;
			mockPlugin.statisticsManager = { setup: vi.fn() } as unknown as StatisticsManager;
			mockPlugin.workerManager = { setup: vi.fn() } as unknown as WorkerManager;
			mockPlugin.markdownPostProcessor = { getProcessor: vi.fn() } as unknown as MarkdownPostProcessor;
			mockPlugin.typographyManager = { updateTypography: vi.fn() } as unknown as TypographyManager;
			mockPlugin.commandManager = { registerAllCommands: vi.fn() } as unknown as CommandManager;
			mockPlugin.viewManager = { registerAllViews: vi.fn() } as unknown as ViewManager;
			mockPlugin.menuManager = { registerAllMenus: vi.fn() } as unknown as MenuManager;
			mockPlugin.registerMarkdownPostProcessor = vi.fn();
			mockPlugin.addStatusBarItem = vi.fn().mockReturnValue({});
			Object.assign(mockPlugin.app, {
				metadataCache: { on: vi.fn(() => ({})) }
			});

			await bootstrapper.bootstrap();

			const editorChangeHandlers = workspaceEventHandlers['editor-change'];
			expect(editorChangeHandlers).toBeDefined();
			expect(editorChangeHandlers.length).toBeGreaterThan(0);

			const beforeTime = Date.now();
			// Trigger editor-change synchronously
			editorChangeHandlers[0]();

			// 1. lastEditTime must be refreshed synchronously immediately
			expect(mockPlugin.lastEditTime).toBeGreaterThanOrEqual(beforeTime);

			// 2. EditorTracker.handleEditorChange has NOT run because debounce callback was captured and not yet invoked
			expect(mockEditorTracker.handleEditorChange).not.toHaveBeenCalled();

			// 3. When debounce callback eventually runs, EditorTracker.handleEditorChange is executed
			expect(debouncedCallback).not.toBeNull();
			debouncedCallback!();
			expect(mockEditorTracker.handleEditorChange).toHaveBeenCalledTimes(1);
		});
	});

	describe('webnovel:tasks-changed event wiring', () => {
		it('should trigger immediate status refresh and homepage refresh when tasks change', async () => {
			const mockHomepageManager = { refreshHomepageViews: vi.fn() };
			mockPlugin.homepageManager = mockHomepageManager as unknown as HomepageManager;
			mockPlugin.settings.enableHomepage = true;

			const bootstrapper = new PluginBootstrapper(mockPlugin, registry);
			bootstrapper.registerConstructorServices();

			mockPlugin.historyManager = { loadHistory: vi.fn().mockResolvedValue(undefined) } as unknown as HistoryDataManager;
			mockPlugin.cacheManager.loadCache = vi.fn().mockResolvedValue(undefined);
			mockPlugin.loreSyncService = { initialize: vi.fn() } as unknown as LoreSyncService;
			mockPlugin.fileEventManager = { setup: vi.fn() } as unknown as FileEventManager;
			mockPlugin.statisticsManager = { setup: vi.fn() } as unknown as StatisticsManager;
			mockPlugin.workerManager = { setup: vi.fn() } as unknown as WorkerManager;
			mockPlugin.markdownPostProcessor = { getProcessor: vi.fn() } as unknown as MarkdownPostProcessor;
			mockPlugin.typographyManager = { updateTypography: vi.fn() } as unknown as TypographyManager;
			mockPlugin.commandManager = { registerAllCommands: vi.fn() } as unknown as CommandManager;
			mockPlugin.viewManager = { registerAllViews: vi.fn() } as unknown as ViewManager;
			mockPlugin.menuManager = { registerAllMenus: vi.fn() } as unknown as MenuManager;
			mockPlugin.registerMarkdownPostProcessor = vi.fn();
			mockPlugin.addStatusBarItem = vi.fn().mockReturnValue({});
			Object.assign(mockPlugin.app, {
				metadataCache: { on: vi.fn(() => ({})) }
			});

			await bootstrapper.bootstrap();

			const taskChangedHandlers = workspaceEventHandlers['webnovel:tasks-changed'];
			expect(taskChangedHandlers).toBeDefined();
			expect(taskChangedHandlers.length).toBeGreaterThan(0);

			taskChangedHandlers[0]();

			expect(mockPlugin.refreshStatusViews).toHaveBeenCalledWith(false, true);
			expect(mockHomepageManager.refreshHomepageViews).toHaveBeenCalledTimes(1);
		});
	});
});
