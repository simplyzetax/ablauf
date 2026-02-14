import { createFileRoute } from '@tanstack/react-router';
import { useFumadocsLoader } from 'fumadocs-core/source/client';
import browserCollections from 'fumadocs-mdx:collections/browser';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import { Suspense } from 'react';
import { APIPage } from '@/components/api-page';
import { CopyMarkdownButton } from '@/components/copy-markdown-button';
import { baseOptions } from '@/lib/layout.shared';
import { getMDXComponents } from '@/mdx-components';
import { pageLoader, type DocsPageLoaderData } from '@/src/server/docs-loader.server';

const clientLoader = browserCollections.docs.createClientLoader({
	component({ toc, frontmatter, default: MDX }, props: { markdownUrl: string }) {
		return (
			<DocsPage toc={toc} full={frontmatter.full}>
				<DocsTitle>{frontmatter.title}</DocsTitle>
				<DocsDescription>{frontmatter.description}</DocsDescription>
				<CopyMarkdownButton markdownUrl={props.markdownUrl} />
				<DocsBody>
					<MDX components={getMDXComponents()} />
				</DocsBody>
			</DocsPage>
		);
	},
});

export const Route = createFileRoute('/docs/$')({
	loader: async ({ params }) => {
		const slugs = params._splat?.split('/') ?? [];
		const data = (await pageLoader({ data: slugs })) as DocsPageLoaderData;
		if (data.kind === 'mdx') {
			await clientLoader.preload(data.path);
		}

		return data;
	},
	component: DocsPageRoute,
	head: ({ loaderData }) => ({
		meta: (loaderData as DocsPageLoaderData | undefined)
			? [
					{ title: `${(loaderData as DocsPageLoaderData).title} | Ablauf` },
					...((loaderData as DocsPageLoaderData).description
						? [{ name: 'description', content: (loaderData as DocsPageLoaderData).description }]
						: []),
				]
			: [],
	}),
});

function DocsPageRoute() {
	const data = useFumadocsLoader(Route.useLoaderData() as DocsPageLoaderData | undefined);
	if (!data) return null;

	return (
		<DocsLayout {...baseOptions()} tree={data.pageTree as any}>
			{data.kind === 'openapi' ? (
				<DocsPage full>
					<DocsTitle>{data.title}</DocsTitle>
					<DocsDescription>{data.description}</DocsDescription>
					<DocsBody>
						<APIPage {...(data.apiPageProps as any)} />
					</DocsBody>
				</DocsPage>
			) : (
				<Suspense>{clientLoader.useContent(data.path, { markdownUrl: `/docs/mdx/${data.slug}` })}</Suspense>
			)}
		</DocsLayout>
	);
}
