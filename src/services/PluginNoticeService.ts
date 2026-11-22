import { Notice } from 'obsidian';

// This module is private to the plugin bundle; native and other plugins' notices are untouched.
let noticesEnabled: () => boolean = () => false;

/** Bind the current plugin settings and release the captured host on unload. */
export function configurePluginNotices(isEnabled: () => boolean): () => void {
	noticesEnabled = isEnabled;
	return () => {
		if (noticesEnabled === isEnabled) noticesEnabled = () => false;
	};
}

/** Keep the native Notice instance for progress cleanup and clickable messages. */
export function showPluginNotice(message: string | DocumentFragment, duration?: number): Notice | undefined {
	if (!noticesEnabled()) return undefined;
	return duration === undefined ? new Notice(message) : new Notice(message, duration);
}
