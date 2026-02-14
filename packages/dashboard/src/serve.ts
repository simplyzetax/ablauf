#!/usr/bin/env bun

import path from "node:path";

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
	const idx = args.indexOf(`--${name}`);
	return idx !== -1 ? args[idx + 1] : undefined;
}

const url = getArg("url");
const port = Number(getArg("port") ?? "4100");

if (!url) {
	console.error("Usage: ablauf-dashboard --url <worker-url> [--port <port>]");
	console.error("");
	console.error("  --url   Worker URL (required), e.g. http://localhost:8787");
	console.error("  --port  Dashboard port (default: 4100)");
	process.exit(1);
}

process.env.VITE_ABLAUF_API_URL = url;

// Try loading inlined asset map (compiled binary), fall back to filesystem
let assetMap: Record<string, { content: string; type: string }> | null = null;
const assetMapPath = path.join(import.meta.dir, "..", "dist", "_asset-map.json");
try {
	const file = Bun.file(assetMapPath);
	if (await file.exists()) {
		assetMap = await file.json();
	}
} catch {
	// No asset map — serve from filesystem
}

const clientDir = path.join(import.meta.dir, "..", "dist", "client");

const contentTypes: Record<string, string> = {
	".js": "application/javascript",
	".css": "text/css",
	".html": "text/html",
	".json": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
};

// Import the TanStack Start SSR server
const { default: server } = await import("../dist/server/server.js");

Bun.serve({
	port,
	async fetch(req) {
		const reqUrl = new URL(req.url);
		const pathname = reqUrl.pathname;

		// Serve static client assets
		if (pathname.startsWith("/assets/") || pathname === "/favicon.ico") {
			// Try inlined assets first (compiled binary)
			if (assetMap && assetMap[pathname]) {
				const asset = assetMap[pathname];
				return new Response(Buffer.from(asset.content, "base64"), {
					headers: {
						"Content-Type": asset.type,
						"Cache-Control": pathname.startsWith("/assets/")
							? "public, max-age=31536000, immutable"
							: "no-cache",
					},
				});
			}

			// Fall back to filesystem (npm package mode)
			const filePath = path.join(clientDir, pathname);
			const file = Bun.file(filePath);
			if (await file.exists()) {
				const ext = path.extname(filePath);
				return new Response(file, {
					headers: {
						"Content-Type": contentTypes[ext] ?? "application/octet-stream",
						"Cache-Control": pathname.startsWith("/assets/")
							? "public, max-age=31536000, immutable"
							: "no-cache",
					},
				});
			}
		}

		// Fall through to TanStack Start SSR handler
		return server.fetch(req);
	},
});

console.log(`Ablauf Dashboard running at http://localhost:${port}`);
console.log(`  Worker: ${url}`);
