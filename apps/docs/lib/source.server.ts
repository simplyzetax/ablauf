import { docs } from 'fumadocs-mdx:collections/server';
import { loader, multiple, type LoaderPlugin } from 'fumadocs-core/source';
import { openapiPlugin, openapiSource } from 'fumadocs-openapi/server';
import { openapi } from '@/lib/openapi';

export const source = loader(
	multiple({
		docs: docs.toFumadocsSource(),
		openapi: await openapiSource(openapi, {
			baseDir: 'dashboard',
		}),
	}),
	{
		baseUrl: '/docs',
		// Cast needed: bun resolves two virtual copies of fumadocs-core (different optional peer dep contexts)
		// causing fumadocs-openapi's LoaderPlugin to be incompatible with this module's LoaderPlugin
		plugins: [openapiPlugin() as unknown as LoaderPlugin],
	},
);
