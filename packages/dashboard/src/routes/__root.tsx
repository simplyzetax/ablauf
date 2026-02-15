/// <reference types="vite/client" />
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import appCss from '~/styles.css?url';

export const Route = createRootRoute({
	head: () => ({
		meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Ablauf Dashboard' }],
		links: [{ rel: 'stylesheet', href: appCss }],
	}),
	component: RootComponent,
});

function RootComponent() {
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						staleTime: 2000,
						retry: 1,
					},
				},
			}),
	);

	return (
		<QueryClientProvider client={queryClient}>
			<RootDocument>
				<div className="min-h-screen">
					<Outlet />
				</div>
			</RootDocument>
		</QueryClientProvider>
	);
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	return (
		<html lang="en" className="dark">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}
