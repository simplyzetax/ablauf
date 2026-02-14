import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
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
			return {
				kind: 'openapi',
				title: page.data.title,
				description: page.data.description,
				pageTree,
				apiPageProps: JSON.parse(JSON.stringify(page.data.getAPIPageProps())) as { [key: string]: {} },
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
