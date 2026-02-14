import Link from 'next/link';

const categories = [
	{
		title: 'Workflows',
		description: 'Define durable workflows with steps, retries, typed events, and real-time updates.',
		href: '/docs/workflows',
		icon: (
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth={2}
				strokeLinecap="round"
				strokeLinejoin="round"
				className="size-5"
			>
				<path d="M12 3v6" />
				<circle cx={12} cy={12} r={3} />
				<path d="M12 15v6" />
				<path d="M5.2 5.2l4.2 4.2" />
				<path d="M14.6 14.6l4.2 4.2" />
				<path d="M18.8 5.2l-4.2 4.2" />
				<path d="M5.2 18.8l4.2-4.2" />
			</svg>
		),
	},
	{
		title: 'Server',
		description: 'Orchestrate workflows in your Cloudflare Worker with the Ablauf class.',
		href: '/docs/server',
		icon: (
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth={2}
				strokeLinecap="round"
				strokeLinejoin="round"
				className="size-5"
			>
				<rect x={2} y={2} width={20} height={8} rx={2} />
				<rect x={2} y={14} width={20} height={8} rx={2} />
				<path d="M6 6h.01" />
				<path d="M6 18h.01" />
			</svg>
		),
	},
	{
		title: 'Client',
		description: 'Connect your frontend to workflows with the type-safe browser client.',
		href: '/docs/client',
		icon: (
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth={2}
				strokeLinecap="round"
				strokeLinejoin="round"
				className="size-5"
			>
				<rect x={2} y={3} width={20} height={14} rx={2} />
				<path d="M8 21h8" />
				<path d="M12 17v4" />
			</svg>
		),
	},
	{
		title: 'Dashboard',
		description: 'Monitor, debug, and inspect your workflows with the built-in dashboard.',
		href: '/docs/dashboard',
		icon: (
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth={2}
				strokeLinecap="round"
				strokeLinejoin="round"
				className="size-5"
			>
				<path d="M3 3v18h18" />
				<path d="M7 16l4-8 4 4 4-6" />
			</svg>
		),
	},
];

export default function DocsLandingPage() {
	return (
		<main className="mx-auto w-full max-w-4xl px-6 py-16">
			<div className="mb-12">
				<h1 className="text-3xl font-bold tracking-tight">Documentation</h1>
				<p className="mt-2 text-fd-muted-foreground">Everything you need to build durable workflows on Cloudflare Workers.</p>
			</div>
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				{categories.map((category) => (
					<Link
						key={category.href}
						href={category.href}
						className="group rounded-xl border border-fd-border bg-fd-card p-6 transition-colors hover:border-fd-primary/50 hover:bg-fd-accent"
					>
						<div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary">{category.icon}</div>
						<h2 className="text-lg font-semibold">{category.title}</h2>
						<p className="mt-1 text-sm text-fd-muted-foreground">{category.description}</p>
					</Link>
				))}
			</div>
		</main>
	);
}
