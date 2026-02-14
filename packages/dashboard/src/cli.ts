#!/usr/bin/env node

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
	const idx = args.indexOf(`--${name}`);
	return idx !== -1 ? args[idx + 1] : undefined;
}

const url = getArg('url');
const port = getArg('port') ?? '4100';

if (!url) {
	console.error('Usage: ablauf-dashboard --url <worker-url> [--port <port>]');
	console.error('');
	console.error('  --url   Worker URL (required), e.g. http://localhost:8787');
	console.error('  --port  Dashboard port (default: 4100)');
	process.exit(1);
}

process.env.VITE_ABLAUF_API_URL = url;
process.env.PORT = port;

console.log('Starting Ablauf Dashboard');
console.log(`  Worker: ${url}`);
console.log(`  Port:   ${port}`);
console.log();

const { createServer } = await import('vite');

const server = await createServer({
	configFile: new URL('../vite.config.ts', import.meta.url).pathname,
	server: { port: Number(port), open: true },
});

await server.listen();
server.printUrls();
