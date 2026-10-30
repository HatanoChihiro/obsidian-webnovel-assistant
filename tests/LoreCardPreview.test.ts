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
	setTooltip: vi.fn(),
	Notice: vi.fn()
}));

vi.mock('../src/i18n', () => ({
	t: (key: string) => key,
	getLocale: () => 'zh'
}));

import { Component } from 'obsidian';
import { LoreCardPreview } from '../src/ui/components/LoreCardPreview';
import { LoreBoardRenderer } from '../src/ui/components/LoreBoardRenderer';

function isPreviewOpen(preview: LoreCardPreview): boolean {
	return preview['panelEl'] !== null;
}

let rafQueue: FrameRequestCallback[] = [];

interface Harness {
	preview: LoreCardPreview;
	target: MockElement;
	body: MockElement;
	document: ReturnType<typeof createMockDom>['document'];
	window: ReturnType<typeof setupMockOwnerWindow>;
}

function setupMockOwnerWindow(dom: ReturnType<typeof createMockDom>) {
	const listeners = new Map<string, Set<(event: unknown) => void>>();
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
		addEventListener: (type: string, listener: (event: unknown) => void) => {
			const set = listeners.get(type) ?? new Set<(event: unknown) => void>();
			set.add(listener);
			listeners.set(type, set);
		},
		removeEventListener: (type: string, listener: (event: unknown) => void) => {
			listeners.get(type)?.delete(listener);
		},
		dispatchEvent: (type: string, event?: unknown) => {
			for (const listener of Array.from(listeners.get(type) ?? [])) {
				listener(event ?? { type });
			}
		}
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
	const ownerWindow = setupMockOwnerWindow(dom);

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

	return { preview, target, body: dom.body, document: dom.document, window: ownerWindow };
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

			expect(isPreviewOpen(first.preview)).toBe(false);
			expect(isPreviewOpen(second.preview)).toBe(true);
			expect(isPreviewOpen(third.preview)).toBe(true);
			expect(findPanel(first.body)).toBeNull();
			expect(findPanel(third.body)).not.toBeNull();
		});

		it('数量上限下限保护：非法配置（0）回退到下限 1', async () => {
			const h1 = createHarness({ persistent: true, maxCount: 0 });
			const h2 = createHarness({ persistent: true, maxCount: 0 });

			h1.preview.open();
			await flushMicrotasks();
			expect(isPreviewOpen(h1.preview)).toBe(true);

			h2.preview.open();
			await flushMicrotasks();
			// 非法值被夹到下限 1：打开第二个时第一个被淘汰
			expect(isPreviewOpen(h1.preview)).toBe(false);
			expect(isPreviewOpen(h2.preview)).toBe(true);
		});

		it('点击另一张卡片的展开按钮时，先前打开的面板不被当作“点击外部”关闭', async () => {
			const h1 = createHarness({ persistent: true, maxCount: 3 });
			const h2 = createHarness({ persistent: true, maxCount: 3 });

			h1.preview.open();
			await flushMicrotasks();
			expect(isPreviewOpen(h1.preview)).toBe(true);

			// 模拟点击第二张卡片的展开按钮：mousedown 落在 h2 的卡片容器上
			(h1.document as unknown as { dispatchEvent: (type: string, event?: unknown) => void })
				.dispatchEvent('mousedown', { type: 'mousedown', target: h2.target });

			// h1 的面板不应被关闭
			expect(isPreviewOpen(h1.preview)).toBe(true);

			h2.preview.open();
			await flushMicrotasks();

			// 两个面板同时常驻（上限 3）
			expect(isPreviewOpen(h1.preview)).toBe(true);
			expect(isPreviewOpen(h2.preview)).toBe(true);
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
			expect(isPreviewOpen(h1.preview)).toBe(true);
			expect(isPreviewOpen(h2.preview)).toBe(true);

			const blank = h1.body.createDiv({ cls: 'blank-area' });
			// 两个 harness 各自持有独立文档，需分别派发同一语义的点击
			dispatchOnAll('mousedown', { type: 'mousedown', target: blank }, [h1.document, h2.document]);

			expect(isPreviewOpen(h1.preview)).toBe(false);
			expect(isPreviewOpen(h2.preview)).toBe(false);
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
			expect(isPreviewOpen(h1.preview)).toBe(true);
			expect(isPreviewOpen(h2.preview)).toBe(true);
			expect(isPreviewOpen(h3.preview)).toBe(true);

			// 点击第二个面板的关闭按钮
			const closeBtn = findPanel(h2.body)?.querySelector('.wn-lore-preview-close');
			expect(closeBtn).not.toBeNull();
			simulateClick(h2.document, closeBtn as MockElement, [h1.document, h2.document, h3.document]);

			expect(isPreviewOpen(h2.preview)).toBe(false);
			expect(isPreviewOpen(h1.preview)).toBe(true);
			expect(isPreviewOpen(h3.preview)).toBe(true);
		});

		it('Esc 仅在焦点位于面板内时关闭，避免编辑器内误关', async () => {
			const h1 = createHarness({ persistent: true, maxCount: 3 });
			const doc = h1.document as unknown as {
				activeElement: unknown;
				dispatchEvent: (type: string, event?: unknown) => void;
			};

			h1.preview.open();
			await flushMicrotasks();
			expect(isPreviewOpen(h1.preview)).toBe(true);

			// 焦点在编辑器（面板外）时按 Esc：不关闭
			doc.activeElement = h1.body.createDiv({ cls: 'editor' });
			doc.dispatchEvent('keydown', { type: 'keydown', key: 'Escape', preventDefault: vi.fn() });
			expect(isPreviewOpen(h1.preview)).toBe(true);

			// 焦点在面板内时按 Esc：关闭
			doc.activeElement = findPanel(h1.body);
			doc.dispatchEvent('keydown', { type: 'keydown', key: 'Escape', preventDefault: vi.fn() });
			expect(isPreviewOpen(h1.preview)).toBe(false);
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
			expect(isPreviewOpen(harnesses[0].preview)).toBe(true);
			expect(isPreviewOpen(harnesses[2].preview)).toBe(true);

			harnesses[3].preview.open();
			await flushMicrotasks();
			expect(isPreviewOpen(harnesses[0].preview)).toBe(false);
			expect(isPreviewOpen(harnesses[3].preview)).toBe(true);
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
			expect(isPreviewOpen(preview)).toBe(false);
		});

		it('总开关关闭时 closeAll 关闭所有已打开和常驻的预览面板', async () => {
			const h1 = createHarness({ persistent: true });
			const h2 = createHarness({ persistent: true });

			h1.preview.open();
			await flushMicrotasks();
			h2.preview.open();
			await flushMicrotasks();

			expect(isPreviewOpen(h1.preview)).toBe(true);
			expect(isPreviewOpen(h2.preview)).toBe(true);

			LoreCardPreview.closeAll();

			expect(isPreviewOpen(h1.preview)).toBe(false);
			expect(isPreviewOpen(h2.preview)).toBe(false);
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
			const batchReads = new Set<Map<unknown, unknown>>();
			buildCardDOMMock.mockImplementationOnce(async (...args: unknown[]) => {
				const reads = args[5] as Map<unknown, unknown>;
				reads.set('retained-file', 'snapshot');
				batchReads.add(reads);
			});
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
			expect(batchReads.size).toBe(1);
			for (const reads of batchReads) expect(reads.size).toBe(0);
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
				}),
				expect.any(Map)
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
				}),
				expect.any(Map)
			);
		});
	});

	describe('置顶与拖拽', () => {
		async function openPanel(harness: Harness): Promise<MockElement> {
			harness.preview.open();
			await flushMicrotasks();
			const panel = findPanel(harness.body);
			expect(panel).not.toBeNull();
			return panel as MockElement;
		}

		/** 点击面板标题栏的置顶按钮 */
		function clickPin(harness: Harness, panel: MockElement): MockElement {
			const pin = panel.querySelector('.wn-lore-preview-pin');
			expect(pin).not.toBeNull();
			simulateClick(harness.document, pin as MockElement, [harness.document]);
			return pin as MockElement;
		}

		/** 在标题栏上模拟一次指针拖拽 */
		function dragPanel(harness: Harness, panel: MockElement, dx: number, dy: number): void {
			const header = panel.querySelector('.wn-lore-preview-header');
			expect(header).not.toBeNull();
			const preventDefault = vi.fn();
			(header as MockElement).dispatchEvent('pointerdown', {
				type: 'pointerdown', button: 0, pointerId: 1,
				clientX: 100, clientY: 100, target: header, preventDefault
			});
			harness.document.dispatchEvent('pointermove', {
				type: 'pointermove', pointerId: 1,
				clientX: 100 + dx, clientY: 100 + dy, target: header, preventDefault
			});
			harness.document.dispatchEvent('pointerup', {
				type: 'pointerup', pointerId: 1,
				clientX: 100 + dx, clientY: 100 + dy, target: header, preventDefault
			});
		}

		/** 在标题栏上模拟一次点击（未超过拖拽阈值） */
		function clickHeader(harness: Harness, panel: MockElement, clientX = 100, clientY = 100): void {
			const header = panel.querySelector('.wn-lore-preview-header');
			expect(header).not.toBeNull();
			const preventDefault = vi.fn();
			(header as MockElement).dispatchEvent('pointerdown', {
				type: 'pointerdown', button: 0, pointerId: 1,
				clientX, clientY, target: header, preventDefault
			});
			harness.document.dispatchEvent('pointerup', {
				type: 'pointerup', pointerId: 1,
				clientX, clientY, target: header, preventDefault
			});
		}

		/** 模拟指针被意外取消（如手势识别或窗口失焦触发 pointercancel） */
		function cancelPointer(harness: Harness, panel: MockElement, clientX = 100, clientY = 100): void {
			const header = panel.querySelector('.wn-lore-preview-header');
			expect(header).not.toBeNull();
			const preventDefault = vi.fn();
			(header as MockElement).dispatchEvent('pointerdown', {
				type: 'pointerdown', button: 0, pointerId: 1,
				clientX, clientY, target: header, preventDefault
			});
			harness.document.dispatchEvent('pointercancel', {
				type: 'pointercancel', pointerId: 1,
				clientX, clientY, target: header, preventDefault
			});
		}

		/** 让 mock 面板的 getBoundingClientRect 真实反映其 CSS 样式中的尺寸与位置，便于验证实际边界 */
		function bindDynamicPanelRect(panel: MockElement): void {
			panel.getBoundingClientRect = () => {
				const left = Number.parseFloat(panel.style.left) || 0;
				const top = Number.parseFloat(panel.style.top) || 0;
				const width = Number.parseFloat(panel.style.width) || 200;
				const height = Number.parseFloat(panel.style.maxHeight) || 200;
				return { left, top, width, height, right: left + width, bottom: top + height };
			};
		}

		it('置顶后鼠标移开与点击面板外都不关闭，Esc 才关闭', async () => {
			const harness = createHarness();
			const panel = await openPanel(harness);

			const pin = clickPin(harness, panel);
			expect(pin.hasClass('is-active')).toBe(true);
			expect(pin.getAttribute('aria-pressed')).toBe('true');
			expect(panel.hasClass('is-pinned')).toBe(true);

			harness.target.dispatchEvent?.('mouseleave');
			vi.advanceTimersByTime(5000);
			expect(isPreviewOpen(harness.preview)).toBe(true);

			const blank = harness.body.createDiv({ cls: 'blank-area' });
			dispatchOnAll('mousedown', { type: 'mousedown', target: blank }, [harness.document]);
			expect(isPreviewOpen(harness.preview)).toBe(true);

			(harness.document as unknown as { activeElement: unknown }).activeElement = panel;
			harness.document.dispatchEvent('keydown', { type: 'keydown', key: 'Escape', preventDefault: vi.fn() });
			expect(isPreviewOpen(harness.preview)).toBe(false);
		});

		it('未置顶时点击面板外仍按原规则关闭', async () => {
			const harness = createHarness();
			const panel = await openPanel(harness);

			expect(panel.hasClass('is-pinned')).toBe(false);
			const blank = harness.body.createDiv({ cls: 'blank-area' });
			dispatchOnAll('mousedown', { type: 'mousedown', target: blank }, [harness.document]);
			expect(isPreviewOpen(harness.preview)).toBe(false);
		});

		it('拖拽标题栏可移动面板，且拖拽后外部滚动不再把它拉回锚点', async () => {
			const harness = createHarness();
			const panel = await openPanel(harness);
			clickPin(harness, panel);

			const initialLeft = panel.style.left;
			const initialTop = panel.style.top;

			dragPanel(harness, panel, 120, 80);
			expect(panel.style.left).not.toBe(initialLeft);
			expect(panel.style.top).not.toBe(initialTop);
			expect(panel.hasClass('is-dragging')).toBe(false);

			const draggedLeft = panel.style.left;
			const draggedTop = panel.style.top;
			harness.document.dispatchEvent('scroll', { type: 'scroll', target: harness.body });
			flushRaf();

			expect(panel.style.left).toBe(draggedLeft);
			expect(panel.style.top).toBe(draggedTop);
			expect(isPreviewOpen(harness.preview)).toBe(true);
		});

		it('位移小于拖拽阈值时视为点击，不改变面板位置', async () => {
			const harness = createHarness();
			const panel = await openPanel(harness);
			const initialLeft = panel.style.left;
			const initialTop = panel.style.top;

			dragPanel(harness, panel, 2, 2);
			expect(panel.style.left).toBe(initialLeft);
			expect(panel.style.top).toBe(initialTop);
		});

		it('取消置顶后回到跟随锚点的默认定位', async () => {
			const harness = createHarness();
			const panel = await openPanel(harness);
			const defaultLeft = panel.style.left;
			const defaultTop = panel.style.top;

			clickPin(harness, panel);
			dragPanel(harness, panel, 120, 80);
			expect(panel.style.left).not.toBe(defaultLeft);

			clickPin(harness, panel);
			expect(panel.hasClass('is-pinned')).toBe(false);
			expect(panel.style.left).toBe(defaultLeft);
			expect(panel.style.top).toBe(defaultTop);
		});

		it('双击标题栏复位到卡片旁（保持置顶）', async () => {
			const harness = createHarness();
			const panel = await openPanel(harness);
			const defaultLeft = panel.style.left;

			clickPin(harness, panel);
			dragPanel(harness, panel, 120, 80);
			expect(panel.style.left).not.toBe(defaultLeft);

			const header = panel.querySelector('.wn-lore-preview-header') as MockElement;
			header.dispatchEvent('dblclick', {
				type: 'dblclick', target: header, preventDefault: vi.fn()
			});

			expect(panel.style.left).toBe(defaultLeft);
			expect(panel.hasClass('is-pinned')).toBe(true);
		});

		it('连续两次真实点击标题栏（浏览器 dblclick 被吞掉时）复位并保持置顶', async () => {
			const harness = createHarness();
			const panel = await openPanel(harness);
			const defaultLeft = panel.style.left;

			clickPin(harness, panel);
			dragPanel(harness, panel, 120, 80);
			expect(panel.style.left).not.toBe(defaultLeft);

			// 第一次点击：未拖拽，记录为候选点击，不应立即复位
			clickHeader(harness, panel, 100, 100);
			expect(panel.style.left).not.toBe(defaultLeft);

			// 第二次点击（双击判定窗口内且未位移）：由标题栏内部的双击降级判定复位并保持置顶
			clickHeader(harness, panel, 100, 100);
			expect(panel.style.left).toBe(defaultLeft);
			expect(panel.hasClass('is-pinned')).toBe(true);
		});

		it('拖拽完成后立即在原起点点击不应误判为双击复位', async () => {
			const harness = createHarness();
			const panel = await openPanel(harness);
			const defaultLeft = panel.style.left;

			clickPin(harness, panel);
			dragPanel(harness, panel, 120, 80);
			const draggedLeft = panel.style.left;
			expect(draggedLeft).not.toBe(defaultLeft);

			// 拖拽完成后在起始坐标按下并释放，不应将已完成的拖拽计入双击
			clickHeader(harness, panel, 100, 100);
			expect(panel.style.left).toBe(draggedLeft);
		});

		it('指针取消（pointercancel）应清除双击候选状态', async () => {
			const harness = createHarness();
			const panel = await openPanel(harness);
			const defaultLeft = panel.style.left;

			clickPin(harness, panel);
			dragPanel(harness, panel, 120, 80);
			const draggedLeft = panel.style.left;

			// 产生一次被取消的指针事件
			cancelPointer(harness, panel, 100, 100);
			// 随后单独一次点击不应与被取消的指针合成双击
			clickHeader(harness, panel, 100, 100);
			expect(panel.style.left).toBe(draggedLeft);
		});

		it('关闭并重新打开面板应清除双击候选状态', async () => {
			const harness = createHarness();
			const panel = await openPanel(harness);

			// 在第一次打开时点击一次标题栏
			clickHeader(harness, panel, 100, 100);
			harness.preview.close();

			// 重新打开并拖拽
			const reopened = await openPanel(harness);
			const defaultLeft = reopened.style.left;
			dragPanel(harness, reopened, 120, 80);
			const draggedLeft = reopened.style.left;
			expect(draggedLeft).not.toBe(defaultLeft);

			// 重新打开后的单次点击不应与关闭前的点击合成双击
			clickHeader(harness, reopened, 100, 100);
			expect(reopened.style.left).toBe(draggedLeft);
		});

		it('置顶按钮仅保留 aria-label，不设置 HTML title 属性', async () => {
			const harness = createHarness();
			const panel = await openPanel(harness);
			const pin = panel.querySelector('.wn-lore-preview-pin') as MockElement;
			expect(pin).not.toBeNull();

			// 默认未置顶
			expect(pin.title).toBe('');
			expect(pin.getAttribute('title')).toBeUndefined();
			expect(pin.getAttribute('aria-label')).toBe('corkboard.lore-preview-pin');
			expect(pin.getAttribute('aria-pressed')).toBe('false');

			// 切换为置顶
			clickPin(harness, panel);
			expect(pin.title).toBe('');
			expect(pin.getAttribute('title')).toBeUndefined();
			expect(pin.getAttribute('aria-label')).toBe('corkboard.lore-preview-unpin');
			expect(pin.getAttribute('aria-pressed')).toBe('true');

			// 键盘交互（Space / Enter）切换
			pin.dispatchEvent('keydown', { key: ' ', preventDefault: vi.fn() });
			expect(panel.hasClass('is-pinned')).toBe(false);
			expect(pin.getAttribute('aria-label')).toBe('corkboard.lore-preview-pin');
			expect(pin.getAttribute('aria-pressed')).toBe('false');
			expect(pin.title).toBe('');
		});

		it('拖拽置顶长面板后视口收缩应重算宽高上限并约束在视口内，视口重新变大不丢失手动摆放位置', async () => {
			const harness = createHarness();
			const panel = await openPanel(harness);
			bindDynamicPanelRect(panel);
			clickPin(harness, panel);

			// 初始视口 1200x800 下，面板最大高度为 624px (800 * 0.78)
			expect(panel.style.maxHeight).toBe('624px');
			expect(panel.style.width).toBe('680px');

			// 手动拖拽面板至 (66, 50)
			dragPanel(harness, panel, 50, -260);
			const manuallyPlacedLeft = Number.parseFloat(panel.style.left);
			const manuallyPlacedTop = Number.parseFloat(panel.style.top);
			expect(manuallyPlacedLeft).toBe(66);
			expect(manuallyPlacedTop).toBe(50);

			// 视口急剧收缩为 800x300
			harness.window.innerWidth = 800;
			harness.window.innerHeight = 300;
			harness.window.dispatchEvent('resize');
			flushRaf();

			// 300 视口下 maxHeight 应重算为 234px (300 * 0.78 = 234)，width 上限为 680px (800 - 32 >= 680)
			expect(panel.style.maxHeight).toBe('234px');
			expect(panel.style.width).toBe('680px');

			// 面板必须完全约束在视口内：bottom <= 300, right <= 800
			const rect = panel.getBoundingClientRect();
			expect(rect.top).toBeGreaterThanOrEqual(8);
			expect(rect.bottom).toBeLessThanOrEqual(300);
			expect(rect.left).toBeGreaterThanOrEqual(8);
			expect(rect.right).toBeLessThanOrEqual(800);

			// 视口重新变大回 1200x800
			harness.window.innerWidth = 1200;
			harness.window.innerHeight = 800;
			harness.window.dispatchEvent('resize');
			flushRaf();

			// 宽高上限重新变大，且未重置回卡片锚点，保留了手动摆放的坐标
			expect(panel.style.maxHeight).toBe('624px');
			expect(panel.style.width).toBe('680px');
			expect(Number.parseFloat(panel.style.left)).toBe(manuallyPlacedLeft);
			expect(Number.parseFloat(panel.style.top)).toBe(manuallyPlacedTop);
		});

		it('常驻模式下已拖拽的未置顶面板在视口收缩时也应重算尺寸并约束在视口内', async () => {
			const harness = createHarness({ persistent: true });
			const panel = await openPanel(harness);
			bindDynamicPanelRect(panel);

			// 初始视口 1200x800
			expect(panel.style.maxHeight).toBe('624px');

			// 拖拽面板使其 detached
			dragPanel(harness, panel, 100, 50);

			// 视口收缩为 500x300
			harness.window.innerWidth = 500;
			harness.window.innerHeight = 300;
			harness.window.dispatchEvent('resize');
			flushRaf();

			expect(panel.style.maxHeight).toBe('234px');
			expect(panel.style.width).toBe('468px');
			const rect = panel.getBoundingClientRect();
			expect(rect.bottom).toBeLessThanOrEqual(300);
			expect(rect.right).toBeLessThanOrEqual(500);
		});

		it('未拖拽的常驻面板在视口变化时跟随锚点卡片正常重新定位', async () => {
			const harness = createHarness({ persistent: true });
			const panel = await openPanel(harness);

			// 改变视口尺寸
			harness.window.innerWidth = 800;
			harness.window.innerHeight = 600;
			harness.window.dispatchEvent('resize');
			flushRaf();

			// 重新定位并更新尺寸
			expect(panel.style.maxHeight).toBe('468px'); // 600 * 0.78 = 468
			expect(panel.style.top).toBe('310px'); // 正常跟随卡片下方
		});

		it('常驻数量上限淘汰时跳过置顶面板', async () => {
			const pinned = createHarness({ persistent: true, maxCount: 2 });
			const middle = createHarness({ persistent: true, maxCount: 2 });
			const newest = createHarness({ persistent: true, maxCount: 2 });

			const pinnedPanel = await openPanel(pinned);
			clickPin(pinned, pinnedPanel);
			await openPanel(middle);
			await openPanel(newest);

			expect(isPreviewOpen(pinned.preview)).toBe(true);
			expect(isPreviewOpen(middle.preview)).toBe(false);
			expect(isPreviewOpen(newest.preview)).toBe(true);
		});

		it('面板关闭后置顶状态重置，重新打开回到默认行为', async () => {
			const harness = createHarness();
			const panel = await openPanel(harness);
			clickPin(harness, panel);
			expect(panel.hasClass('is-pinned')).toBe(true);

			harness.preview.close();
			expect(isPreviewOpen(harness.preview)).toBe(false);

			const reopened = await openPanel(harness);
			expect(reopened.hasClass('is-pinned')).toBe(false);
			expect(reopened.querySelector('.wn-lore-preview-pin')?.hasClass('is-active')).toBe(false);
		});
	});

	describe('LoreBoardRenderer.renderTable 文件选项卡', () => {
		interface TableLoreFile {
			path: string;
			basename: string;
			headings: string[];
		}

		function buildTableFixture(options: { activeFile?: string; loreFiles?: TableLoreFile[] } = {}) {
			const dom = createMockDom();
			setupMockOwnerWindow(dom);
			const container = dom.body.createDiv('board-container');
			const loreFiles = options.loreFiles ?? [
				{ path: '设定/人物.md', basename: '人物', headings: ['女主角', '男主角'] },
				{ path: '设定/势力.md', basename: '势力', headings: ['宗门'] }
			];

			const entryByName = new Map<string, { heading: string; file: Record<string, unknown> }>();
			const cacheByPath = new Map<string, unknown>();
			for (const file of loreFiles) {
				const fileRef = { path: file.path, basename: file.basename, parent: null };
				cacheByPath.set(file.path, { headings: file.headings.map(heading => ({ level: 2, heading })) });
				for (const heading of file.headings) entryByName.set(heading, { heading, file: fileRef });
			}

			const chapterLore: Record<string, string[]> = {
				'正文/第一章.md': ['女主角×2', '宗门×1'],
				'正文/第二章.md': ['男主角×3', '宗门×2']
			};
			const chapterFiles = Object.keys(chapterLore).map(path => ({ path, basename: path.replace(/^.*\//, '').replace(/\.md$/, '') }));
			for (const chapter of chapterFiles) {
				cacheByPath.set(chapter.path, { frontmatter: { lore: chapterLore[chapter.path] } });
			}

			const settings = {
				loreBoardLayout: 'table',
				loreBoardActiveFile: options.activeFile ?? '',
				lorePopoverCollapse: false,
				loreCardPreviewEnabled: false,
				loreCardHoverPreview: false,
				loreCardPreviewPersistent: false,
				loreCardPreviewMaxCount: 3
			};
			const saveSettings = vi.fn(async () => undefined);
			const plugin = {
				characterManager: {
					ensureInitialized: vi.fn(async () => undefined),
					getCharactersForBook: vi.fn(() => ['女主角', '男主角', '宗门']),
					getCharacterFile: vi.fn((_book: string, name: string) => entryByName.get(name) ?? null),
					findLoreFolder: vi.fn(() => null),
					getBookPathForFile: vi.fn(() => ''),
					getEffectiveLoreFiles: vi.fn(() => chapterFiles),
					getLoreEntriesInFileOrder: vi.fn(() => Array.from(entryByName.values())),
					moveLoreItem: vi.fn(),
					rebuildCache: vi.fn(),
					getLoreContent: vi.fn(),
					updateLoreContent: vi.fn()
				},
				relationGraphManager: { buildGraphData: vi.fn(async () => ({ edges: [] })) },
				settings,
				saveSettings
			};
			const app = {
				metadataCache: {
					getFileCache: vi.fn((file: { path: string }) => cacheByPath.get(file.path) ?? null)
				}
			};

			const render = async () => {
				const ownerComponent = new Component();
				ownerComponent.load();
				createdOwners.push(ownerComponent);
				await LoreBoardRenderer.render({
					ownerComponent: ownerComponent as unknown as import('obsidian').Component,
					app: app as unknown as import('obsidian').App,
					plugin: plugin as unknown as import('../src/ui/components/LoreBoardRenderer').LoreBoardPlugin,
					container: container as unknown as HTMLElement,
					files: chapterFiles as unknown as import('obsidian').TFile[],
					currentBookPath: '/'
				});
			};

			return { container, settings, saveSettings, render, loreFiles };
		}

		it('表格模式渲染文件选项卡：全部 + 各设定文件（带条数徽标）', async () => {
			const fixture = buildTableFixture();
			await fixture.render();

			const tabs = fixture.container.querySelectorAll('.wn-lore-file-tab');
			expect(tabs).toHaveLength(3);
			expect(tabs[0].hasClass('is-active')).toBe(true);

			const labels = fixture.container.querySelectorAll('.wn-lore-file-tab-label').map(label => label.textContent);
			expect(labels).toEqual(['lore.tab-all', '人物', '势力']);

			const counts = fixture.container.querySelectorAll('.wn-lore-file-tab-count').map(count => count.textContent);
			expect(counts).toEqual(['3', '2', '1']);

			const rows = fixture.container.querySelectorAll('.wn-lore-board-group');
			expect(rows).toHaveLength(3);
			expect(rows.every(row => row.hidden === false)).toBe(true);
		});

		it('点击文件选项卡按所属文件过滤表格行，并持久化到设置', async () => {
			const fixture = buildTableFixture();
			await fixture.render();

			const rows = fixture.container.querySelectorAll('.wn-lore-board-group');
			const tabs = fixture.container.querySelectorAll('.wn-lore-file-tab');
			const clickTab = (tab: MockElement) => {
				const handler = tab.onclick as ((event: MouseEvent) => void) | undefined;
				handler?.({} as MouseEvent);
			};
			// 行顺序按出现次数降序：男主角(人物) / 宗门(势力) / 女主角(人物)
			clickTab(tabs[2]);
			await flushMicrotasks(1);

			expect(rows.map(row => row.hidden)).toEqual([true, false, true]);
			expect(fixture.settings.loreBoardActiveFile).toBe('设定/势力.md');
			expect(fixture.saveSettings).toHaveBeenCalledTimes(1);
			expect(tabs[2].hasClass('is-active')).toBe(true);
			expect(tabs[0].hasClass('is-active')).toBe(false);

			clickTab(tabs[0]);
			await flushMicrotasks(1);
			expect(rows.every(row => row.hidden === false)).toBe(true);
			expect(fixture.settings.loreBoardActiveFile).toBeUndefined();
			expect(tabs[0].hasClass('is-active')).toBe(true);
		});

		it('打开看板时沿用上次选择的设定文件，并过滤表格行', async () => {
			const fixture = buildTableFixture({ activeFile: '设定/人物.md' });
			await fixture.render();

			const tabs = fixture.container.querySelectorAll('.wn-lore-file-tab');
			const rows = fixture.container.querySelectorAll('.wn-lore-board-group');
			expect(tabs).toHaveLength(3);
			expect(tabs[1].hasClass('is-active')).toBe(true);
			expect(rows.map(row => row.hidden)).toEqual([false, true, false]);
		});

		it('仅有一个设定文件时不渲染选项卡，全部行保持可见', async () => {
			const fixture = buildTableFixture({ loreFiles: [{ path: '设定/人物.md', basename: '人物', headings: ['女主角', '男主角'] }] });
			await fixture.render();

			expect(fixture.container.querySelectorAll('.wn-lore-file-tab')).toHaveLength(0);
			const rows = fixture.container.querySelectorAll('.wn-lore-board-group');
			expect(rows).toHaveLength(3);
			expect(rows.every(row => row.hidden === false)).toBe(true);
		});
	});
});
