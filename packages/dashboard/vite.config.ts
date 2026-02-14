import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
	server: {
		port: Number(process.env.PORT) || 4100,
		watch: {
			ignored: ['**/routeTree.gen.ts'],
		},
	},
	plugins: [tailwindcss(), tsconfigPaths(), tanstackStart(), viteReact()],
});
