import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';
import { Logger } from '../src/utils/Logger';

function createPlugin(debugMode: boolean): WebNovelAssistantPlugin {
	return { settings: { debugMode } } as unknown as WebNovelAssistantPlugin;
}

describe('Logger', () => {
	beforeEach(() => {
		vi.stubGlobal('window', { console });
		vi.spyOn(console, 'info').mockImplementation(() => undefined);
	});

	afterEach(() => {
		Logger.initialize(createPlugin(false));
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('handles a plugin whose settings have not loaded yet', () => {
		Logger.initialize({} as unknown as WebNovelAssistantPlugin);

		expect(() => Logger.info('test log')).not.toThrow();
		expect(console.info).not.toHaveBeenCalled();
	});

	it('outputs info when debug mode is enabled', () => {
		Logger.initialize(createPlugin(true));

		Logger.info('test log');

		expect(console.info).toHaveBeenCalledWith('test log');
	});

	it('does not output info when debug mode is disabled', () => {
		Logger.initialize(createPlugin(false));

		Logger.info('test log');

		expect(console.info).not.toHaveBeenCalled();
	});
});
