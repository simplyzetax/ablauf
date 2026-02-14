import { createOpenAPI } from 'fumadocs-openapi/server';
// Imported at build time to avoid runtime filesystem reads (Cloudflare Workers has no fs access)
import openapiSpec from '../openapi.json';

export const openapi = createOpenAPI({
	// biome-ignore lint: JSON import types are too wide for OpenAPIV3 Document
	input: () => ({ './openapi.json': openapiSpec as any }),
});
