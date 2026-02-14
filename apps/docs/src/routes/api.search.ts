import { createFileRoute } from '@tanstack/react-router';
import { createFromSource } from 'fumadocs-core/search/server';

let searchServerPromise: Promise<ReturnType<typeof createFromSource>> | undefined;

async function getSearchServer() {
	searchServerPromise ??= (async () => {
		const { source } = await import('@/lib/source.server');
		return createFromSource(source, {
			language: 'english',
		});
	})();
	return searchServerPromise;
}

export const Route = createFileRoute('/api/search')({
	server: {
		handlers: {
			GET: async ({ request }) => (await getSearchServer()).GET(request),
		},
	},
});
