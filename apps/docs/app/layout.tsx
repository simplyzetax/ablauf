import "./global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: {
		template: "%s | Ablauf",
		default: "Ablauf — Durable Workflows for Cloudflare Workers",
	},
	description:
		"Build durable, replay-safe workflows on Cloudflare Workers. Steps, retries, events, and real-time updates — all powered by Durable Objects.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body>
				<RootProvider>{children}</RootProvider>
			</body>
		</html>
	);
}
