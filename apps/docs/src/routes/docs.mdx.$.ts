import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/docs/mdx/$')({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const { source } = await import('@/lib/source.server');
				const slug = params._splat?.split('/').filter(Boolean) ?? [];
				if (slug.length === 0) {
					return new Response('Not found', { status: 404 });
				}

				const page = source.getPage(slug);
				if (!page || page.data.type === 'openapi') {
					return new Response('Not found', { status: 404 });
				}

				const text = await page.data.getText('processed');
				const content = `# ${page.data.title}\n\n${text}`;

				return new Response(content, {
					headers: { 'Content-Type': 'text/plain; charset=utf-8' },
				});
			},
		},
	},
});
