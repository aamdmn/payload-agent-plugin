/*
 * Tiny pub/sub backing the Dynamic Island silent banner + side mute switch.
 * Ported from caltext's chat-demo-animation store. Module-level so the switch
 * (rendered by IPhoneMock) and the banner stay in sync without prop drilling.
 */
let muted = true;
const listeners = new Set<(next: boolean) => void>();

export function isDemoMuted() {
	return muted;
}

export function toggleDemoMute() {
	muted = !muted;
	for (const listener of listeners) {
		listener(muted);
	}
	return muted;
}

export function onDemoMuteChange(listener: (next: boolean) => void) {
	listeners.add(listener);

	return () => {
		listeners.delete(listener);
	};
}
