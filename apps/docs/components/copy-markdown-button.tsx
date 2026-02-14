"use client";

import { useState } from "react";

export function CopyMarkdownButton({ markdownUrl }: { markdownUrl: string }) {
	const [copied, setCopied] = useState(false);

	async function handleCopy() {
		const res = await fetch(markdownUrl);
		const text = await res.text();
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-secondary px-3 py-1.5 text-sm font-medium text-fd-secondary-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
		>
			{copied ? (
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth={2}
					strokeLinecap="round"
					strokeLinejoin="round"
					className="size-4"
				>
					<path d="M20 6L9 17l-5-5" />
				</svg>
			) : (
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth={2}
					strokeLinecap="round"
					strokeLinejoin="round"
					className="size-4"
				>
					<rect x={9} y={9} width={13} height={13} rx={2} />
					<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
				</svg>
			)}
			{copied ? "Copied!" : "Copy Markdown"}
		</button>
	);
}
