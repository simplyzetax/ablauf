import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/tanstack';
import appCss from '@/src/styles/app.css?url';

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: 'Ablauf — Durable Workflows for Cloudflare Workers' },
			{
				name: 'description',
				content:
					'Build durable, replay-safe workflows on Cloudflare Workers. Steps, retries, events, and real-time updates — all powered by Durable Objects.',
			},
		],
		links: [{ rel: 'stylesheet', href: appCss }],
	}),
	component: RootComponent,
});

function RootComponent() {
	return (
		<RootDocument>
			<Outlet />
		</RootDocument>
	);
}

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="antialiased">
				<RootProvider>{children}</RootProvider>
				<Scripts />
			</body>
		</html>
	);
}
