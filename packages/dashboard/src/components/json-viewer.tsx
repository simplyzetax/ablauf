import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible';
import { ChevronRight } from 'lucide-react';
import { cn } from '~/lib/utils';

interface JsonViewerProps {
	/** Section label displayed in the trigger. */
	label: string;
	/** Data to render as syntax-highlighted JSON. */
	data: unknown;
}

/** Syntax-highlighted JSON rendering. */
function colorizeJson(json: string): (string | { text: string; className: string })[] {
	const parts: (string | { text: string; className: string })[] = [];
	const regex = /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(null|undefined)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)/g;
	let lastIndex = 0;
	let match;

	while ((match = regex.exec(json)) !== null) {
		if (match.index > lastIndex) {
			parts.push(json.slice(lastIndex, match.index));
		}
		if (match[1]) {
			parts.push({ text: match[1], className: 'text-zinc-200' });
			parts.push(':');
		} else if (match[2]) {
			parts.push({ text: match[2], className: 'text-emerald-400' });
		} else if (match[3]) {
			parts.push({ text: match[3], className: 'text-zinc-500' });
		} else if (match[4]) {
			parts.push({ text: match[4], className: 'text-blue-400' });
		} else if (match[5]) {
			parts.push({ text: match[5], className: 'text-amber-400' });
		}
		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < json.length) {
		parts.push(json.slice(lastIndex));
	}
	return parts;
}

/** Collapsible JSON viewer with syntax highlighting. */
export function JsonViewer({ label, data }: JsonViewerProps) {
	const [open, setOpen] = useState(false);

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
				<ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
				{label}
			</CollapsibleTrigger>
			<CollapsibleContent>
				{data == null ? (
					<p className="mt-2 text-xs italic text-muted-foreground/60">(empty)</p>
				) : (
					<pre className="mt-2 overflow-auto rounded-sm bg-background p-3 text-xs leading-relaxed">
						<code>
							{colorizeJson(JSON.stringify(data, null, 2)).map((part, i) =>
								typeof part === 'string' ? (
									<span key={i} className="text-zinc-500">
										{part}
									</span>
								) : (
									<span key={i} className={part.className}>
										{part.text}
									</span>
								),
							)}
						</code>
					</pre>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
