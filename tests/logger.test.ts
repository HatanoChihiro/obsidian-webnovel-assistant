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

	it('releases plugin reference only when called with matching owner', () => {
		const ownerPlugin = createPlugin(true);
		const otherPlugin = createPlugin(true);

		Logger.initialize(ownerPlugin);

		// Non-matching owner must not release logger
		Logger.release(otherPlugin);
		Logger.info('message from active owner');
		expect(console.info).toHaveBeenCalledWith('message from active owner');

		// Matching owner releases reference
		vi.clearAllMocks();
		Logger.release(ownerPlugin);
		Logger.info('message after release');
		expect(console.info).not.toHaveBeenCalled();
	});
});
