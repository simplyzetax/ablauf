// Build script for creating a standalone binary
// Usage: bun run compile
//
// Step 1: Build the TanStack Start app (Vite) → dist/
// Step 2: Generate an asset map that inlines client files
// Step 3: Compile the production server into a standalone Bun binary

import { $, Glob } from 'bun';
import { readFileSync } from 'node:fs';

console.log('Building Ablauf Dashboard...');

// Step 1: Build the Vite/TanStack Start app
await $`bun run build`;

// Step 2: Generate an inline asset map for the binary
const assets: Record<string, { content: string; type: string }> = {};
const contentTypes: Record<string, string> = {
	'.js': 'application/javascript',
	'.css': 'text/css',
	'.html': 'text/html',
	'.json': 'application/json',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
};

for (const file of new Glob('dist/client/**/*').scanSync('.')) {
	const ext = file.slice(file.lastIndexOf('.'));
	const webPath = '/' + file.replace('dist/client/', '');
	const content = readFileSync(file).toString('base64');
	assets[webPath] = { content, type: contentTypes[ext] ?? 'application/octet-stream' };
}

const assetMapPath = 'dist/_asset-map.json';
await Bun.write(assetMapPath, JSON.stringify(assets));
console.log(`Generated asset map with ${Object.keys(assets).length} files`);

// Step 3: Compile production server into standalone binary
console.log('Compiling standalone binary...');
await $`bun build --compile src/serve.ts --outfile ablauf-dashboard`;

console.log('Done! Binary: ./ablauf-dashboard');
console.log('Usage: ./ablauf-dashboard --url <worker-url> [--port <port>]');
