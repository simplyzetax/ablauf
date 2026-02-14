import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		deps: {
			optimizer: {
				ssr: {
					enabled: true,
					include: ['@der-ablauf/workflows', '@der-ablauf/client', '@orpc/server'],
					esbuildOptions: {
						loader: {
							'.sql': 'text',
						},
					},
				},
			},
		},
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
				isolatedStorage: false,
				singleWorker: false,
			},
		},
	},
});
