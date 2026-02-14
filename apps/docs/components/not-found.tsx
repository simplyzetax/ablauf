import { Link } from '@tanstack/react-router';

export function NotFound() {
	return (
		<main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-6 text-center">
			<p className="text-sm font-medium text-fd-muted-foreground">404</p>
			<h1 className="mt-2 text-3xl font-bold tracking-tight">Page not found</h1>
			<p className="mt-2 text-fd-muted-foreground">The page you requested does not exist.</p>
			<Link
				to="/"
				className="mt-6 rounded-lg bg-fd-primary px-4 py-2 text-sm font-semibold text-fd-primary-foreground transition-opacity hover:opacity-90"
			>
				Back Home
			</Link>
		</main>
	);
}
