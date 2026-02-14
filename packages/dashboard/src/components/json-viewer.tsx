interface JsonViewerProps {
	label: string;
	data: unknown;
}

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
			// Key
			parts.push({ text: match[1], className: 'text-zinc-200' });
			parts.push(':');
		} else if (match[2]) {
			// String value
			parts.push({ text: match[2], className: 'text-emerald-400' });
		} else if (match[3]) {
			// null/undefined
			parts.push({ text: match[3], className: 'text-zinc-500' });
		} else if (match[4]) {
			// Number
			parts.push({ text: match[4], className: 'text-blue-400' });
		} else if (match[5]) {
			// Boolean
			parts.push({ text: match[5], className: 'text-yellow-400' });
		}
		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < json.length) {
		parts.push(json.slice(lastIndex));
	}
	return parts;
}

export function JsonViewer({ label, data }: JsonViewerProps) {
	return (
		<details>
			<summary className="cursor-pointer text-sm text-zinc-400 transition-colors hover:text-zinc-300">{label}</summary>
			{data == null ? (
				<p className="mt-2 text-xs italic text-zinc-600">(empty)</p>
			) : (
				<pre className="mt-2 overflow-auto rounded-lg bg-surface-0 p-3 text-xs leading-relaxed">
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
		</details>
	);
}
