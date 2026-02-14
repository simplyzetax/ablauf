import { useSyncExternalStore } from 'react';

interface ConnectionState {
	status: 'connected' | 'disconnected' | 'error';
	lastSuccess: number | null;
	error: string | null;
}

let state: ConnectionState = {
	status: 'disconnected',
	lastSuccess: null,
	error: null,
};

const listeners = new Set<() => void>();

function emit() {
	listeners.forEach((l) => l());
}

export function reportSuccess() {
	state = { status: 'connected', lastSuccess: Date.now(), error: null };
	emit();
}

export function reportError(error: string) {
	state = { ...state, status: 'error', error };
	emit();
}

export function useConnectionStatus(): ConnectionState {
	return useSyncExternalStore(
		(cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		() => state,
		() => state,
	);
}
