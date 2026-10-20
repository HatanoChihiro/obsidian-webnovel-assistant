import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from 'obsidian';
import { ImmersiveTypewriterQuickModal, type ImmersiveTypewriterQuickPlugin } from '../src/ui/ImmersiveTypewriterQuickModal';
import { Logger } from '../src/utils/Logger';

type MockSlider = {
	min: number;
	max: number;
	step: number;
	value: number;
	hasDynamicTooltip: boolean;
	changeHandler?: (val: number) => Promise<void> | void;
};

type MockSettingInstance = {
	name?: string;
	desc?: string;
	isHeading?: boolean;
	slider?: MockSlider;
};

const settingInstances: MockSettingInstance[] = [];

vi.mock('obsidian', () => {
	class MockModal {
		app: unknown;
		containerEl: {
			addClass: ReturnType<typeof vi.fn>;
			ownerDocument: {
				body: {
					classList: { contains: ReturnType<typeof vi.fn> };
					setCssProps: ReturnType<typeof vi.fn>;
					style: { setProperty: ReturnType<typeof vi.fn> };
				};
			};
		};
		modalEl: {
			addClass: ReturnType<typeof vi.fn>;
		};
		contentEl: {
			empty: ReturnType<typeof vi.fn>;
		};
		constructor(app: unknown) {
			this.app = app;
			this.containerEl = {
				addClass: vi.fn(),
				ownerDocument: {
					body: {
						classList: { contains: vi.fn().mockReturnValue(true) },
						setCssProps: vi.fn(),
						style: { setProperty: vi.fn() }
					}
				}
			};
			this.modalEl = {
				addClass: vi.fn()
			};
			this.contentEl = {
				empty: vi.fn()
			};
		}
		open() {
			(this as unknown as { onOpen?: () => void }).onOpen?.();
		}
		close() {
			(this as unknown as { onClose?: () => void }).onClose?.();
		}
	}

	class MockSetting {
		instance: MockSettingInstance;
		constructor(public containerEl: unknown) {
			this.instance = {};
			settingInstances.push(this.instance);
		}
		setName(name: string) {
			this.instance.name = name;
			return this;
		}
		setDesc(desc: string) {
			this.instance.desc = desc;
			return this;
		}
		setHeading() {
			this.instance.isHeading = true;
			return this;
		}
		addSlider(cb: (slider: unknown) => unknown) {
			const sliderObj: MockSlider = {
				min: 0,
				max: 0,
				step: 0,
				value: 0,
				hasDynamicTooltip: false
			};
			const sliderComp = {
				setLimits: (min: number, max: number, step: number) => {
					sliderObj.min = min;
					sliderObj.max = max;
					sliderObj.step = step;
					return sliderComp;
				},
				setValue: (val: number) => {
					sliderObj.value = val;
					return sliderComp;
				},
				setDynamicTooltip: () => {
					sliderObj.hasDynamicTooltip = true;
					return sliderComp;
				},
				onChange: (handler: (val: number) => Promise<void> | void) => {
					sliderObj.changeHandler = handler;
					return sliderComp;
				}
			};
			cb(sliderComp);
			this.instance.slider = sliderObj;
			return this;
		}
	}

	return {
		Modal: MockModal,
		Setting: MockSetting
	};
});

describe('ImmersiveTypewriterQuickModal', () => {
	let mockApp: App;
	let mockPlugin: ImmersiveTypewriterQuickPlugin;
	let updateOptionsSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		settingInstances.length = 0;
		updateOptionsSpy = vi.fn();
		mockApp = {
			workspace: {
				updateOptions: updateOptionsSpy
			}
		} as unknown as App;

		mockPlugin = {
			settings: {
				immersive: {
					typewriterEnabled: true,
					typewriterCenterOffset: 0,
					typewriterUnfocusedOpacity: 0.4
				}
			},
			saveSettings: vi.fn().mockResolvedValue(undefined)
		};
	});

	it('configures corner modal classes and heading on open', () => {
		const modal = new ImmersiveTypewriterQuickModal(mockApp, mockPlugin);
		modal.open();

		expect(modal.containerEl.addClass).toHaveBeenCalledWith('wn-corner-modal-container');
		expect(modal.modalEl.addClass).toHaveBeenCalledWith('wn-corner-modal');
		expect(modal.modalEl.addClass).toHaveBeenCalledWith('wn-immersive-typewriter-modal');
		expect(settingInstances[0].isHeading).toBe(true);
	});

	it('configures center offset slider limits, default, ?? 0 preservation, and live % update', async () => {
		mockPlugin.settings.immersive.typewriterCenterOffset = 0;
		const modal = new ImmersiveTypewriterQuickModal(mockApp, mockPlugin);
		modal.open();

		const offsetSetting = settingInstances[1];
		expect(offsetSetting).toBeDefined();
		expect(offsetSetting.desc).toBe('0%');

		const slider = offsetSetting.slider!;
		expect(slider.min).toBe(-30);
		expect(slider.max).toBe(30);
		expect(slider.step).toBe(1);
		expect(slider.value).toBe(0);
		expect(slider.hasDynamicTooltip).toBe(true);

		// Trigger change
		await slider.changeHandler?.(15);
		expect(mockPlugin.settings.immersive.typewriterCenterOffset).toBe(15);
		expect(offsetSetting.desc).toBe('15%');
		expect(updateOptionsSpy).toHaveBeenCalledTimes(1);
		expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it('configures unfocused opacity slider limits, default, ?? 1 preservation, live % and CSS property', async () => {
		mockPlugin.settings.immersive.typewriterUnfocusedOpacity = 1.0;
		const modal = new ImmersiveTypewriterQuickModal(mockApp, mockPlugin);
		modal.open();

		const opacitySetting = settingInstances[2];
		expect(opacitySetting).toBeDefined();
		expect(opacitySetting.desc).toBe('100%');

		const slider = opacitySetting.slider!;
		expect(slider.min).toBe(0.1);
		expect(slider.max).toBe(1.0);
		expect(slider.step).toBe(0.05);
		expect(slider.value).toBe(1.0);
		expect(slider.hasDynamicTooltip).toBe(true);

		// Trigger change to 0.45
		await slider.changeHandler?.(0.45);
		expect(mockPlugin.settings.immersive.typewriterUnfocusedOpacity).toBe(0.45);
		expect(opacitySetting.desc).toBe('45%');
		expect(updateOptionsSpy).toHaveBeenCalledTimes(1);
		expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(modal.containerEl.ownerDocument.body.setCssProps).toHaveBeenCalledWith({
			'--wn-typewriter-opacity': '0.45'
		});
	});

	it('uses fallback defaults 0 and 0.4 when settings values are undefined', () => {
		Object.assign(mockPlugin.settings.immersive, {
			typewriterCenterOffset: undefined,
			typewriterUnfocusedOpacity: undefined
		});

		const modal = new ImmersiveTypewriterQuickModal(mockApp, mockPlugin);
		modal.open();

		expect(settingInstances[1].slider!.value).toBe(0);
		expect(settingInstances[1].desc).toBe('0%');
		expect(settingInstances[2].slider!.value).toBe(0.4);
		expect(settingInstances[2].desc).toBe('40%');
	});

	it('catches saveSettings errors with Logger.error without throwing', async () => {
		const loggerErrorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => {});
		const saveError = new Error('Disk write failed');
		mockPlugin.saveSettings = vi.fn().mockRejectedValue(saveError);

		const modal = new ImmersiveTypewriterQuickModal(mockApp, mockPlugin);
		modal.open();

		const offsetSlider = settingInstances[1].slider!;
		await expect(offsetSlider.changeHandler?.(5)).resolves.not.toThrow();

		expect(loggerErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining('[ImmersiveTypewriterQuickModal]'),
			saveError
		);
		loggerErrorSpy.mockRestore();
	});

	it('does not apply immersive opacity after typewriter mode is disabled', async () => {
		mockPlugin.settings.immersive.typewriterEnabled = false;
		const modal = new ImmersiveTypewriterQuickModal(mockApp, mockPlugin);
		modal.open();
		await settingInstances[2].slider?.changeHandler?.(0.6);
		expect(modal.containerEl.ownerDocument.body.setCssProps).not.toHaveBeenCalled();
		expect(mockPlugin.saveSettings).toHaveBeenCalled();
	});

	it('empties contentEl and invokes onClose option callback on close', () => {
		const onCloseSpy = vi.fn();
		const modal = new ImmersiveTypewriterQuickModal(mockApp, mockPlugin, { onClose: onCloseSpy });
		modal.open();
		modal.close();

		expect(modal.contentEl.empty).toHaveBeenCalled();
		expect(onCloseSpy).toHaveBeenCalledTimes(1);
	});
});
