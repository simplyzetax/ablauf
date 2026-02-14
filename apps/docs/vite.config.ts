import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import mdx from 'fumadocs-mdx/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
	server: {
		port: 3000,
	},
	plugins: [
		mdx(await import('./source.config')),
		tailwindcss(),
		tsconfigPaths({
			projects: ['./tsconfig.json'],
		}),
		cloudflare({
			viteEnvironment: { name: 'ssr' },
		}),
		tanstackStart({
			target: 'cloudflare-module',
			customViteReactPlugin: true,
		}),
		react(),
	],
});
