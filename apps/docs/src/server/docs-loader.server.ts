import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import type { PageData } from 'fumadocs-core/source';
import { source } from '@/lib/source.server';

export type DocsPageLoaderData =
	| {
			kind: 'openapi';
			title?: string;
			description?: string;
			pageTree: { [key: string]: {} };
			apiPageProps: { [key: string]: {} };
	  }
	| {
			kind: 'mdx';
			title?: string;
			description?: string;
			pageTree: { [key: string]: {} };
			path: string;
			slug: string;
	  };

export const docsLayoutLoader = createServerFn({ method: 'GET' }).handler(async () => ({
	pageTree: (await source.serializePageTree(source.getPageTree())) as unknown as { [key: string]: {} },
}));

export const pageLoader = createServerFn({ method: 'GET' })
	.inputValidator((slugs: string[]) => slugs)
	.handler(async ({ data: slugs }): Promise<DocsPageLoaderData> => {
		const page = source.getPage(slugs);
		if (!page) throw notFound();

		const pageTree = (await source.serializePageTree(source.getPageTree())) as unknown as { [key: string]: {} };
		if (page.data.type === 'openapi') {
			// Cast needed: multiple() narrows to PageData & { type: "openapi" } which doesn't
			// include OpenAPIPageData's getAPIPageProps due to bun's duplicate fumadocs-core resolution
			const data = page.data as PageData & { type: 'openapi'; getAPIPageProps: () => unknown };
			return {
				kind: 'openapi',
				title: data.title,
				description: data.description,
				pageTree,
				apiPageProps: JSON.parse(JSON.stringify(data.getAPIPageProps())) as { [key: string]: {} },
			};
		}

		return {
			kind: 'mdx',
			title: page.data.title,
			description: page.data.description,
			pageTree,
			path: page.path,
			slug: slugs.join('/'),
		};
	});
