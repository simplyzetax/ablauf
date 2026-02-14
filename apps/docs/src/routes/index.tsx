import { createFileRoute, Link } from '@tanstack/react-router';
import { CodeBlock, CodeBlockTab, CodeBlockTabs, CodeBlockTabsList, CodeBlockTabsTrigger, Pre } from 'fumadocs-ui/components/codeblock';

export const Route = createFileRoute('/')({
	component: HomePage,
});

function HomePage() {
	return (
		<main className="flex min-h-screen flex-col items-center justify-center bg-fd-background text-fd-foreground">
			<div className="mx-auto max-w-2xl px-6 text-center">
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
				<div className="mt-8 flex justify-center gap-4">
					<Link
						to="/docs"
						className="rounded-lg bg-fd-primary px-6 py-3 font-semibold text-fd-primary-foreground transition-colors hover:opacity-90"
					>
						Read the Docs
					</Link>
					<Link
						to="/docs/$"
						params={{ _splat: 'workflows/getting-started' }}
						className="rounded-lg border border-fd-border px-6 py-3 font-semibold transition-colors hover:bg-fd-accent"
					>
						Get Started
					</Link>
				</div>
				<CodeBlockTabs defaultValue="bun" className="mt-12 text-left" id="package-manager">
					<CodeBlockTabsList>
						<CodeBlockTabsTrigger value="bun">bun</CodeBlockTabsTrigger>
						<CodeBlockTabsTrigger value="npm">npm</CodeBlockTabsTrigger>
						<CodeBlockTabsTrigger value="pnpm">pnpm</CodeBlockTabsTrigger>
						<CodeBlockTabsTrigger value="yarn">yarn</CodeBlockTabsTrigger>
					</CodeBlockTabsList>
					<CodeBlockTab value="bun">
						<CodeBlock>
							<Pre>
								<code className="ml-4">bun add @der-ablauf/workflows</code>
							</Pre>
						</CodeBlock>
					</CodeBlockTab>
					<CodeBlockTab value="npm">
						<CodeBlock>
							<Pre>
								<code className="ml-4">npm install @der-ablauf/workflows</code>
							</Pre>
						</CodeBlock>
					</CodeBlockTab>
					<CodeBlockTab value="pnpm">
						<CodeBlock>
							<Pre>
								<code className="ml-4">pnpm add @der-ablauf/workflows</code>
							</Pre>
						</CodeBlock>
					</CodeBlockTab>
					<CodeBlockTab value="yarn">
						<CodeBlock>
							<Pre>
								<code className="ml-4">yarn add @der-ablauf/workflows</code>
							</Pre>
						</CodeBlock>
					</CodeBlockTab>
				</CodeBlockTabs>
			</div>
		</main>
	);
}
