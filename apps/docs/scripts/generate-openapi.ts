import { OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { dashboardRouter } from '../../../packages/workflows/src/dashboard';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const generator = new OpenAPIGenerator({
	schemaConverters: [new ZodToJsonSchemaConverter()],
});

const spec = await generator.generate(dashboardRouter, {
	info: {
		title: 'Ablauf Dashboard API',
		version: '1.0.0',
		description: 'REST API for managing and observing durable workflow instances powered by Ablauf.',
	},
	servers: [
		{ url: 'https://ablauf-worker.zetax.workers.dev/__ablauf', description: 'Demo server' },
		{ url: 'http://localhost:8787/__ablauf', description: 'Local dev server' },
	],
});

const outPath = resolve(dirname(fileURLToPath(import.meta.url)), '../openapi.json');
writeFileSync(outPath, JSON.stringify(spec, null, 2));
console.log('[openapi] generated', outPath);
