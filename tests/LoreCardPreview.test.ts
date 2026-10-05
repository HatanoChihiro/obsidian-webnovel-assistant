import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createMockDom, flushMicrotasks, type MockElement } from './mocks/dom';

const isMobileMock = vi.hoisted(() => vi.fn(() => false));
const buildCardDOMMock = vi.hoisted(() => vi.fn());

vi.mock('../src/utils/platform', () => ({
	isMobile: isMobileMock,
	getPlatformTier: () => (isMobileMock() ? 'mobile' : 'desktop')
}));

vi.mock('../src/ui/components/LoreCardRenderer', () => ({
	LoreCardRenderer: { buildCardDOM: buildCardDOMMock }
}));

vi.mock('obsidian', () => ({
	Component: class {
		private loaded = false;
		private children: { unload: () => void }[] = [];
		private cleanups: (() => void)[] = [];

		load(): void {
			this.loaded = true;
		}

		addChild(child: { unload: () => void }): void {
			this.children.push(child);
		}

		register(cb: () => void): void {
			this.cleanups.push(cb);
		}

		unload(): void {
			if (!this.loaded) return;
			this.loaded = false;
			for (const child of this.children) {
				child.unload();
			}
			for (const cleanup of this.cleanups) {
				cleanup();
			}
			this.onunload();
		}

		onunload(): void {}
	},
	setIcon: vi.fn(),
	Notice: vi.fn()
}));

vi.mock('../src/i18n', () => ({
	t: (key: string) => key,
	getLocale: () => 'zh'
}));

import { Component } from 'obsidian';
import { LoreCardPreview } from '../src/ui/components/LoreCardPreview';
import { LoreBoardRenderer } from '../src/ui/components/LoreBoardRenderer';

let rafQueue: FrameRequestCallback[] = [];

interface Harness {
	preview: LoreCardPreview;
	target: MockElement;
	body: MockElement;
	document: ReturnType<typeof createMockDom>['document'];
}

function setupMockOwnerWindow(dom: ReturnType<typeof createMockDom>) {
	const ownerWindow = {
		setTimeout: (handler: () => void, timeout?: number) => globalThis.setTimeout(handler, timeout) as unknown as number,
		clearTimeout: (id: number) => globalThis.clearTimeout(id),
		requestAnimationFrame: (handler: FrameRequestCallback) => {
			rafQueue.push(handler);
			return rafQueue.length;
		},
		cancelAnimationFrame: vi.fn(),
		innerWidth: 1200,
		innerHeight: 800,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	};
	(dom.document as unknown as { defaultView: unknown }).defaultView = ownerWindow;
	return ownerWindow;
}

function createHarness(options: {
	masterEnabled?: boolean;
	previewEnabled?: boolean;
	mobile?: boolean;
	scrollHeight?: number;
	persistent?: boolean;
	maxCount?: number;
} = {}): Harness {
	const dom = createMockDom();
	setupMockOwnerWindow(dom);

	isMobileMock.mockReturnValue(Boolean(options.mobile));

	// 模拟卡片 DOM：wrapper > card > (header + body)
	const target = dom.body.createDiv({ cls: 'wn-lore-card-wrapper' });
	const card = target.createDiv({ cls: 'wn-lore-card' });
	card.createDiv({ cls: 'wn-lore-card-header' });
	const cardBody = card.createDiv({ cls: 'wn-lore-card-body' });
	cardBody.clientHeight = 100;
	cardBody.scrollHeight = options.scrollHeight ?? 400;
	cardBody.clientWidth = 200;
	cardBody.scrollWidth = 200;

	const plugin = {
		app: {},
		settings: {
			lorePopoverCollapse: false,
			loreCardPreviewEnabled: options.masterEnabled ?? true,
			loreCardHoverPreview: options.previewEnabled ?? true,
			loreCardPreviewPersistent: options.persistent ?? false,
			loreCardPreviewMaxCount: options.maxCount ?? 3
		},
		characterManager: {}
	};

	const preview = LoreCardPreview.attach(target as unknown as HTMLElement, {
		file: { path: '设定/人物.md', basename: '人物' },
		heading: '女主角'
	} as never, plugin as never);

	return { preview, target, body: dom.body, document: dom.document };
}

function flushRaf(): void {
	const callbacks = rafQueue;
	rafQueue = [];
	for (const callback of callbacks) callback(0);
}

/** 在多个 harness 的独立文档上分别派发同一语义的事件 */
function dispatchOnAll(type: string, event: unknown, docs: Harness['document'][]): void {
	for (const doc of docs) {
		(doc as unknown as { dispatchEvent: (t: string, e?: unknown) => void }).dispatchEvent(type, event);
	}
}

/** 模拟真实点击：先 mousedown（触发全局“点击外部”判定），再触发目标元素的 click */
function simulateClick(doc: Harness['document'], el: MockElement, docs: Harness['document'][]): void {
	dispatchOnAll('mousedown', { type: 'mousedown', target: el }, docs);
	const click = (el as unknown as { onclick?: ((e: unknown) => unknown) | null }).onclick;
	if (typeof click === 'function') click({ target: el, stopPropagation: () => undefined });
}

function findPanel(body: MockElement): MockElement | null {
	return body.querySelector('.wn-lore-preview-panel');
}

describe('LoreCardPreview', () => {
	let createdOwners: Component[] = [];
	let attachSpy: MockInstance<typeof LoreCardPreview.attach>;

	beforeEach(() => {
		vi.useFakeTimers();
		rafQueue = [];
		createdOwners = [];
		attachSpy = vi.spyOn(LoreCardPreview, 'attach');
		buildCardDOMMock.mockReset();
		buildCardDOMMock.mockImplementation(async (container: MockElement) => {
			const card = container.createDiv({ cls: 'wn-lore-card is-preview' });
			card.createDiv({ cls: 'wn-lore-card-header' });
			const body = card.createDiv({ cls: 'wn-lore-card-body' });
			body.createDiv({ cls: 'wn-lore-markdown' });
			return undefined;
		});
	});

	afterEach(() => {
		for (const owner of createdOwners) {
			owner.unload();
		}
		createdOwners = [];
		for (const res of attachSpy?.mock?.results ?? []) {
			if (res.type === 'return' && res.value) {
				(res.value as LoreCardPreview).unload();
			}
		}
		LoreCardPreview.closeAll();
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('悬停延迟结束后弹出大预览面板，并以只读模式渲染卡片', async () => {
		const { target, body } = createHarness();
		expect(findPanel(body)).toBeNull();

		target.dispatchEvent?.('mouseenter');
		vi.advanceTimersByTime(399);
		expect(findPanel(body)).toBeNull();

		vi.advanceTimersByTime(1);
		await flushMicrotasks();

		const panel = findPanel(body);
		expect(panel).not.toBeNull();
		expect(panel?.hasClass('wn-lore-preview-panel')).toBe(true);
		expect(panel?.querySelector('.wn-lore-preview-header')).not.toBeNull();
		expect(buildCardDOMMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ heading: '女主角' }),
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ readOnly: true, hideImportanceButton: true })
		);
	});

	it('设置项关闭时不弹出悬停预览', async () => {
		const { target, body } = createHarness({ previewEnabled: false });

		target.dispatchEvent?.('mouseenter');
		vi.advanceTimersByTime(2000);
		await flushMicrotasks();

		expect(findPanel(body)).toBeNull();
		expect(buildCardDOMMock).not.toHaveBeenCalled();
	});

	it('移动端不响应悬停，但展开按钮仍可立即弹出', async () => {
		const { preview, target, body } = createHarness({ mobile: true });

		target.dispatchEvent?.('mouseenter');
		vi.advanceTimersByTime(2000);
		await flushMicrotasks();
		expect(findPanel(body)).toBeNull();

		preview.open();
		await flushMicrotasks();
		expect(findPanel(body)).not.toBeNull();
	});

	it('内容未溢出时同样弹出预览（已移除溢出判断）', async () => {
		const { target, body } = createHarness({ scrollHeight: 100 });

		target.dispatchEvent?.('mouseenter');
		vi.advanceTimersByTime(2000);
		await flushMicrotasks();

		expect(findPanel(body)).not.toBeNull();
		expect(buildCardDOMMock).toHaveBeenCalledTimes(1);
	});

	it('鼠标移出卡片后经过宽限期关闭面板', async () => {
		const { preview, target, body } = createHarness();

		preview.open();
		await flushMicrotasks();
		expect(findPanel(body)).not.toBeNull();

		target.dispatchEvent?.('mouseleave');
		vi.advanceTimersByTime(199);
		expect(findPanel(body)).not.toBeNull();

		vi.advanceTimersByTime(1);
		expect(findPanel(body)).toBeNull();
	});

	it('渲染完成前面板被关闭时不再挂载游离浮层', async () => {
		const holder: { resolve: (() => void) | null } = { resolve: null };
		buildCardDOMMock.mockImplementation(() => new Promise<void>((resolve) => {
			holder.resolve = () => resolve();
		}));

		const { preview, body } = createHarness();

		preview.open();
		await flushMicrotasks();
		preview.close();

		holder.resolve?.();
		await flushMicrotasks();

		expect(findPanel(body)).toBeNull();
	});

	it('卡片被看板重绘移除时关闭面板', async () => {
		const holder: { callback: MutationCallback | null } = { callback: null };
		vi.stubGlobal('MutationObserver', class {
			constructor(callback: MutationCallback) {
				holder.callback = callback;
			}
			observe(): void {}
			disconnect(): void {}
		});

		const { preview, target, body } = createHarness();
		preview.open();
		await flushMicrotasks();
		expect(findPanel(body)).not.toBeNull();

		// 模拟卡片被移除（isConnected 变为 false）
		Object.defineProperty(target, 'isConnected', { value: false, configurable: true });
		holder.callback?.(
			[{ removedNodes: [target] } as unknown as MutationRecord],
			{} as MutationObserver
		);

		expect(findPanel(body)).toBeNull();
		vi.unstubAllGlobals();
	});

	describe('常驻模式', () => {
		it('常驻时鼠标移开不关闭，仅在手动关闭时消失', async () => {
			const { preview, target, body } = createHarness({ persistent: true });

			preview.open();
			await flushMicrotasks();
			expect(findPanel(body)).not.toBeNull();

			target.dispatchEvent?.('mouseleave');
			vi.advanceTimersByTime(5000);
			expect(findPanel(body)).not.toBeNull();

			// 面板自身的 mouseleave 同样不应关闭
			findPanel(body)?.dispatchEvent?.('mouseleave');
			vi.advanceTimersByTime(5000);
			expect(findPanel(body)).not.toBeNull();

			preview.close();
			expect(findPanel(body)).toBeNull();
		});

		it('非常驻时鼠标移开仍按宽限期自动关闭（行为未被破坏）', async () => {
			const { preview, target, body } = createHarness({ persistent: false });

			preview.open();
			await flushMicrotasks();
			target.dispatchEvent?.('mouseleave');
			vi.advanceTimersByTime(200);
			expect(findPanel(body)).toBeNull();
		});

		it('常驻不依赖悬停开关：悬停预览关闭时，展开按钮打开的面板同样常驻', async () => {
			const { preview, target, body } = createHarness({ persistent: true, previewEnabled: false });

			// 悬停被禁用
			target.dispatchEvent?.('mouseenter');
			vi.advanceTimersByTime(2000);
			await flushMicrotasks();
			expect(findPanel(body)).toBeNull();

			// 展开按钮仍可打开，且常驻
			preview.open();
			await flushMicrotasks();
			expect(findPanel(body)).not.toBeNull();

			target.dispatchEvent?.('mouseleave');
			vi.advanceTimersByTime(5000);
			expect(findPanel(body)).not.toBeNull();
		});

		it('常驻时窗口尺寸变化触发重新定位而非关闭', async () => {
			const { preview, target, body, document: doc } = createHarness({ persistent: true });
			const rectSpy = vi.fn(() => ({ top: 100, left: 100, right: 300, bottom: 300, width: 200, height: 200 }));
			(target as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = rectSpy;

			preview.open();
			await flushMicrotasks();
			expect(findPanel(body)).not.toBeNull();

			rectSpy.mockClear();
			// 通过文档级 scroll 监听触发（resize 与 scroll 走同一重定位路径）
			(doc as unknown as { dispatchEvent: (type: string, event?: unknown) => void })
				.dispatchEvent('scroll', { type: 'scroll', target: doc });
			flushRaf();

			expect(findPanel(body)).not.toBeNull();
			expect(rectSpy).toHaveBeenCalled();
		});

		it('常驻数量上限：超出后自动关闭最早打开的面板', async () => {
			const first = createHarness({ persistent: true, maxCount: 2 });
			const second = createHarness({ persistent: true, maxCount: 2 });
			const third = createHarness({ persistent: true, maxCount: 2 });

			first.preview.open();
			await flushMicrotasks();
			second.preview.open();
			await flushMicrotasks();
			third.preview.open();
			await flushMicrotasks();

			expect(first.preview.isOpen()).toBe(false);
			expect(second.preview.isOpen()).toBe(true);
			expect(third.preview.isOpen()).toBe(true);
			expect(findPanel(first.body)).toBeNull();
			expect(findPanel(third.body)).not.toBeNull();
		});

		it('数量上限下限保护：非法配置（0）回退到下限 1', async () => {
			const h1 = createHarness({ persistent: true, maxCount: 0 });
			const h2 = createHarness({ persistent: true, maxCount: 0 });

			h1.preview.open();
			await flushMicrotasks();
			expect(h1.preview.isOpen()).toBe(true);

			h2.preview.open();
			await flushMicrotasks();
			// 非法值被夹到下限 1：打开第二个时第一个被淘汰
			expect(h1.preview.isOpen()).toBe(false);
			expect(h2.preview.isOpen()).toBe(true);
		});

		it('点击另一张卡片的展开按钮时，先前打开的面板不被当作“点击外部”关闭', async () => {
			const h1 = createHarness({ persistent: true, maxCount: 3 });
			const h2 = createHarness({ persistent: true, maxCount: 3 });

			h1.preview.open();
			await flushMicrotasks();
			expect(h1.preview.isOpen()).toBe(true);

			// 模拟点击第二张卡片的展开按钮：mousedown 落在 h2 的卡片容器上
			(h1.document as unknown as { dispatchEvent: (type: string, event?: unknown) => void })
				.dispatchEvent('mousedown', { type: 'mousedown', target: h2.target });

			// h1 的面板不应被关闭
			expect(h1.preview.isOpen()).toBe(true);

			h2.preview.open();
			await flushMicrotasks();

			// 两个面板同时常驻（上限 3）
			expect(h1.preview.isOpen()).toBe(true);
			expect(h2.preview.isOpen()).toBe(true);
			expect(findPanel(h1.body)).not.toBeNull();
			expect(findPanel(h2.body)).not.toBeNull();
		});

		it('点击真正的空白处时，所有常驻面板都关闭', async () => {
			const h1 = createHarness({ persistent: true, maxCount: 3 });
			const h2 = createHarness({ persistent: true, maxCount: 3 });

			h1.preview.open();
			await flushMicrotasks();
			h2.preview.open();
			await flushMicrotasks();
			expect(h1.preview.isOpen()).toBe(true);
			expect(h2.preview.isOpen()).toBe(true);

			const blank = h1.body.createDiv({ cls: 'blank-area' });
			// 两个 harness 各自持有独立文档，需分别派发同一语义的点击
			dispatchOnAll('mousedown', { type: 'mousedown', target: blank }, [h1.document, h2.document]);

			expect(h1.preview.isOpen()).toBe(false);
			expect(h2.preview.isOpen()).toBe(false);
		});

		it('点击某个面板的关闭按钮，只关闭该面板，其它常驻面板不受影响', async () => {
			const h1 = createHarness({ persistent: true, maxCount: 3 });
			const h2 = createHarness({ persistent: true, maxCount: 3 });
			const h3 = createHarness({ persistent: true, maxCount: 3 });

			h1.preview.open();
			await flushMicrotasks();
			h2.preview.open();
			await flushMicrotasks();
			h3.preview.open();
			await flushMicrotasks();
			expect(h1.preview.isOpen()).toBe(true);
			expect(h2.preview.isOpen()).toBe(true);
			expect(h3.preview.isOpen()).toBe(true);

			// 点击第二个面板的关闭按钮
			const closeBtn = findPanel(h2.body)?.querySelector('.wn-lore-preview-close');
			expect(closeBtn).not.toBeNull();
			simulateClick(h2.document, closeBtn as MockElement, [h1.document, h2.document, h3.document]);

			expect(h2.preview.isOpen()).toBe(false);
			expect(h1.preview.isOpen()).toBe(true);
			expect(h3.preview.isOpen()).toBe(true);
		});

		it('Esc 仅在焦点位于面板内时关闭，避免编辑器内误关', async () => {
			const h1 = createHarness({ persistent: true, maxCount: 3 });
			const doc = h1.document as unknown as {
				activeElement: unknown;
				dispatchEvent: (type: string, event?: unknown) => void;
			};

			h1.preview.open();
			await flushMicrotasks();
			expect(h1.preview.isOpen()).toBe(true);

			// 焦点在编辑器（面板外）时按 Esc：不关闭
			doc.activeElement = h1.body.createDiv({ cls: 'editor' });
			doc.dispatchEvent('keydown', { type: 'keydown', key: 'Escape', preventDefault: vi.fn() });
			expect(h1.preview.isOpen()).toBe(true);

			// 焦点在面板内时按 Esc：关闭
			doc.activeElement = findPanel(h1.body);
			doc.dispatchEvent('keydown', { type: 'keydown', key: 'Escape', preventDefault: vi.fn() });
			expect(h1.preview.isOpen()).toBe(false);
		});

		it('数量上限默认值：设置项缺省时按 3 处理', async () => {
			const harnesses = [
				createHarness({ persistent: true, maxCount: undefined as unknown as number }),
				createHarness({ persistent: true, maxCount: undefined as unknown as number }),
				createHarness({ persistent: true, maxCount: undefined as unknown as number }),
				createHarness({ persistent: true, maxCount: undefined as unknown as number })
			];

			for (const h of harnesses.slice(0, 3)) {
				h.preview.open();
				await flushMicrotasks();
			}
			expect(harnesses[0].preview.isOpen()).toBe(true);
			expect(harnesses[2].preview.isOpen()).toBe(true);

			harnesses[3].preview.open();
			await flushMicrotasks();
			expect(harnesses[0].preview.isOpen()).toBe(false);
			expect(harnesses[3].preview.isOpen()).toBe(true);
		});
	});

	describe('总开关、生命周期与异步取消回归', () => {
		it('总开关关闭时禁用悬停触发与手动 open', async () => {
			const { preview, target, body } = createHarness({ masterEnabled: false });

			target.dispatchEvent?.('mouseenter');
			vi.advanceTimersByTime(2000);
			await flushMicrotasks();
			expect(findPanel(body)).toBeNull();

			preview.open();
			await flushMicrotasks();
			expect(findPanel(body)).toBeNull();
			expect(preview.isOpen()).toBe(false);
		});

		it('总开关关闭时 closeAll 关闭所有已打开和常驻的预览面板', async () => {
			const h1 = createHarness({ persistent: true });
			const h2 = createHarness({ persistent: true });

			h1.preview.open();
			await flushMicrotasks();
			h2.preview.open();
			await flushMicrotasks();

			expect(h1.preview.isOpen()).toBe(true);
			expect(h2.preview.isOpen()).toBe(true);

			LoreCardPreview.closeAll();

			expect(h1.preview.isOpen()).toBe(false);
			expect(h2.preview.isOpen()).toBe(false);
			expect(findPanel(h1.body)).toBeNull();
			expect(findPanel(h2.body)).toBeNull();
		});

		it('异步渲染期间 preview.unload() 取消挂载并释放内部组件', async () => {
			const holder: { resolve: (() => void) | null } = { resolve: null };
			buildCardDOMMock.mockImplementation(() => new Promise<void>((resolve) => {
				holder.resolve = () => resolve();
			}));

			const { preview, body } = createHarness();

			preview.open();
			await flushMicrotasks();
			preview.unload();

			holder.resolve?.();
			await flushMicrotasks();

			expect(findPanel(body)).toBeNull();
		});

		it('异步渲染期间总开关被禁用时取消挂载并释放内部组件', async () => {
			const holder: { resolve: (() => void) | null } = { resolve: null };
			buildCardDOMMock.mockImplementation(() => new Promise<void>((resolve) => {
				holder.resolve = () => resolve();
			}));

			const { preview, body } = createHarness();

			preview.open();
			await flushMicrotasks();
			(preview as unknown as { plugin: { settings: { loreCardPreviewEnabled: boolean } } }).plugin.settings.loreCardPreviewEnabled = false;

			holder.resolve?.();
			await flushMicrotasks();

			expect(findPanel(body)).toBeNull();
		});

		it('异步渲染期间卡片脱离文档时取消挂载', async () => {
			const holder: { resolve: (() => void) | null } = { resolve: null };
			buildCardDOMMock.mockImplementation(() => new Promise<void>((resolve) => {
				holder.resolve = () => resolve();
			}));

			const { preview, target, body } = createHarness();

			preview.open();
			await flushMicrotasks();
			target.remove();

			holder.resolve?.();
			await flushMicrotasks();

			expect(findPanel(body)).toBeNull();
		});

		it('卡片在离屏 buffer 中创建时不误判为销毁，挂载后正常预览，移出后结束生命周期', async () => {
			const dom = createMockDom();
			const holder: { callback: MutationCallback | null } = { callback: null };
			vi.stubGlobal('MutationObserver', class {
				constructor(callback: MutationCallback) {
					holder.callback = callback;
				}
				observe(): void {}
				disconnect(): void {}
			});

			const offscreenTarget = dom.body.createDiv({ cls: 'wn-lore-card-wrapper' });
			offscreenTarget.remove(); // 离屏 buffer 中未挂载到 document
			expect(offscreenTarget.isConnected).toBe(false);

			const plugin = {
				app: {},
				settings: {
					lorePopoverCollapse: false,
					loreCardPreviewEnabled: true,
					loreCardHoverPreview: true,
					loreCardPreviewPersistent: false,
					loreCardPreviewMaxCount: 3
				},
				characterManager: {}
			};

			const preview = LoreCardPreview.attach(offscreenTarget as unknown as HTMLElement, {
				file: { path: '设定/人物.md', basename: '人物' },
				heading: '女主角'
			} as never, plugin as never);

			// 离屏构建期间绝不误判为已销毁
			expect((preview as unknown as { isDisposed: boolean }).isDisposed).toBe(false);

			// 挂载到 live DOM
			dom.body.appendChild(offscreenTarget);
			offscreenTarget.isConnected = true;

			preview.open();
			await flushMicrotasks();
			expect(findPanel(dom.body)).not.toBeNull();

			// 从 DOM 中移除
			offscreenTarget.remove();
			expect(offscreenTarget.isConnected).toBe(false);
			holder.callback?.(
				[{ removedNodes: [offscreenTarget] } as unknown as MutationRecord],
				{} as MutationObserver
			);

			expect((preview as unknown as { isDisposed: boolean }).isDisposed).toBe(true);
			expect(findPanel(dom.body)).toBeNull();
			vi.unstubAllGlobals();
		});
	});

	describe('LoreBoardRenderer.renderCards 入口绑定与生命周期回归', () => {
		it('总开关启用时在卡片构建阶段绑定预览、设为 focusable 并注册到 boardComponent', async () => {
			buildCardDOMMock.mockClear();
			attachSpy.mockClear();
			const dom = createMockDom();
			setupMockOwnerWindow(dom);
			const container = dom.body.createDiv('board-container');
			const ownerComponent = new Component();
			ownerComponent.load();
			createdOwners.push(ownerComponent);

			const testFile = { path: '设定/人物.md', basename: '人物' };
			const testEntry = { heading: '女主角', file: testFile as unknown as import('obsidian').TFile };
			const mockPlugin = {
				characterManager: {
					getLoreEntriesInFileOrder: vi.fn(() => [testEntry]),
					findLoreFolder: vi.fn(() => null),
					getBookPathForFile: vi.fn(() => ''),
					getCharacterFile: vi.fn(),
					moveLoreItem: vi.fn(),
					rebuildCache: vi.fn(),
					getLoreContent: vi.fn(),
					updateLoreContent: vi.fn()
				},
				settings: {
					lorePopoverCollapse: false,
					loreCardPreviewEnabled: true,
					loreCardHoverPreview: true,
					loreCardPreviewPersistent: false,
					loreCardPreviewMaxCount: 3,
					loreBoardActiveFile: ''
				}
			};
			const mockApp = {
				metadataCache: {
					getFileCache: vi.fn(() => ({ headings: [{ level: 2, heading: '女主角' }] }))
				}
			};

			await LoreBoardRenderer.renderCards(
				container as unknown as HTMLElement,
				mockApp as unknown as import('obsidian').App,
				mockPlugin as unknown as import('../src/ui/components/LoreBoardRenderer').LoreBoardCardsPlugin,
				'/',
				['女主角'],
				undefined,
				undefined,
				ownerComponent
			);

			// 卡片 wrapper 应该已创建
			const wrapper = container.querySelector('.wn-lore-card-wrapper');
			expect(wrapper).not.toBeNull();

			// 验证卡片构建期间已调用 attach，无需测试自身手动补救创建
			expect(attachSpy).toHaveBeenCalledTimes(1);
			expect(attachSpy).toHaveBeenCalledWith(
				wrapper,
				testEntry,
				expect.objectContaining({
					app: mockApp,
					settings: mockPlugin.settings,
					characterManager: mockPlugin.characterManager
				})
			);

			// 验证 buildCardDOM 调用参数包含 focusable: true 和 onExpand 回调
			expect(buildCardDOMMock).toHaveBeenCalledWith(
				wrapper,
				testEntry,
				expect.anything(),
				ownerComponent,
				expect.objectContaining({
					focusable: true,
					onExpand: expect.any(Function)
				})
			);

			// 点击展开按钮前，直接派发 mouseenter 验证悬停预览可用
			expect(findPanel(dom.body)).toBeNull();
			wrapper?.dispatchEvent?.('mouseenter');
			vi.advanceTimersByTime(400);
			await flushMicrotasks();
			flushRaf();

			expect(findPanel(dom.body)).not.toBeNull();

			// ownerComponent 卸载后断言面板消失且监听不再响应
			ownerComponent.unload();
			expect(findPanel(dom.body)).toBeNull();

			wrapper?.dispatchEvent?.('mouseenter');
			vi.advanceTimersByTime(400);
			await flushMicrotasks();
			flushRaf();
			expect(findPanel(dom.body)).toBeNull();

			const attachedPreview = attachSpy.mock.results[0]?.value;
			expect((attachedPreview as unknown as { isDisposed: boolean }).isDisposed).toBe(true);
		});

		it('总开关禁用时不绑定预览，不传递 onExpand 且 focusable 为 false', async () => {
			buildCardDOMMock.mockClear();
			attachSpy.mockClear();
			const dom = createMockDom();
			setupMockOwnerWindow(dom);
			const container = dom.body.createDiv('board-container');
			const ownerComponent = new Component();
			ownerComponent.load();
			createdOwners.push(ownerComponent);

			const testFile = { path: '设定/人物.md', basename: '人物' };
			const testEntry = { heading: '女主角', file: testFile as unknown as import('obsidian').TFile };
			const mockPlugin = {
				characterManager: {
					getLoreEntriesInFileOrder: vi.fn(() => [testEntry]),
					findLoreFolder: vi.fn(() => null),
					getBookPathForFile: vi.fn(() => ''),
					getCharacterFile: vi.fn(),
					moveLoreItem: vi.fn(),
					rebuildCache: vi.fn(),
					getLoreContent: vi.fn(),
					updateLoreContent: vi.fn()
				},
				settings: {
					lorePopoverCollapse: false,
					loreCardPreviewEnabled: false,
					loreCardHoverPreview: true,
					loreCardPreviewPersistent: false,
					loreCardPreviewMaxCount: 3,
					loreBoardActiveFile: ''
				}
			};
			const mockApp = {
				metadataCache: {
					getFileCache: vi.fn(() => ({ headings: [{ level: 2, heading: '女主角' }] }))
				}
			};

			await LoreBoardRenderer.renderCards(
				container as unknown as HTMLElement,
				mockApp as unknown as import('obsidian').App,
				mockPlugin as unknown as import('../src/ui/components/LoreBoardRenderer').LoreBoardCardsPlugin,
				'/',
				['女主角'],
				undefined,
				undefined,
				ownerComponent
			);

			const wrapper = container.querySelector('.wn-lore-card-wrapper');
			expect(wrapper).not.toBeNull();

			// 总开关禁用时同时断言 attach 未调用
			expect(attachSpy).not.toHaveBeenCalled();

			expect(buildCardDOMMock).toHaveBeenCalledWith(
				wrapper,
				testEntry,
				expect.anything(),
				ownerComponent,
				expect.objectContaining({
					focusable: false,
					onExpand: undefined
				})
			);
		});
	});
});
