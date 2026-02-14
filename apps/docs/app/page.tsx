import Link from 'next/link';

export default function HomePage() {
	return (
		<main className="flex min-h-screen flex-col items-center justify-center bg-fd-background text-fd-foreground">
			<div className="mx-auto max-w-2xl text-center px-6">
				<h1 className="text-5xl font-extrabold tracking-tight sm:text-6xl">
					<span className="text-fd-primary">Ablauf</span>
				</h1>
				<p className="mt-4 text-lg text-fd-muted-foreground">
					Durable workflows for Cloudflare Workers.
					<br />
					Steps that survive restarts. Retries that actually retry.
					<br />
					Events that wait patiently. All on the edge.
				</p>
				<div className="mt-8 flex gap-4 justify-center">
					<Link
						href="/docs"
						className="rounded-lg bg-fd-primary px-6 py-3 font-semibold text-fd-primary-foreground transition-colors hover:opacity-90"
					>
						Read the Docs
					</Link>
					<Link
						href="/docs/workflows/getting-started"
						className="rounded-lg border border-fd-border px-6 py-3 font-semibold transition-colors hover:bg-fd-accent"
					>
						Get Started
					</Link>
				</div>
				<p className="mt-12 text-sm text-fd-muted-foreground">npm install @der-ablauf/workflows</p>
			</div>
		</main>
	);
}
