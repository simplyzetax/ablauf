/// <reference types="vite/client" />

declare global {
	interface Window {
		/** Runtime configuration injected by the production server (`serve.ts`). */
		__ABLAUF_CONFIG__?: { apiUrl: string };
	}
}

/**
 * Returns the base worker URL for API requests.
 *
 * Resolution order:
 * 1. `window.__ABLAUF_CONFIG__.apiUrl` — injected at runtime by `serve.ts` (production)
 * 2. `process.env.VITE_ABLAUF_API_URL` — available during SSR in production
 * 3. `import.meta.env.VITE_ABLAUF_API_URL` — replaced by Vite at dev transform-time
 * 4. `http://localhost:8787` — local development fallback
 */
export function getApiUrl(): string {
	// Production client: injected into HTML by serve.ts
	if (typeof window !== 'undefined' && window.__ABLAUF_CONFIG__?.apiUrl) {
		return window.__ABLAUF_CONFIG__.apiUrl;
	}

	// SSR in production: process.env is set by serve.ts before the server starts
	if (typeof process !== 'undefined' && process.env?.VITE_ABLAUF_API_URL) {
		return process.env.VITE_ABLAUF_API_URL;
	}

	// Dev mode: Vite replaces import.meta.env.VITE_* at transform-time
	return import.meta.env.VITE_ABLAUF_API_URL ?? 'http://localhost:8787';
}
