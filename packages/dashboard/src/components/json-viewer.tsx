interface JsonViewerProps {
  label: string;
  data: unknown;
}

export function JsonViewer({ label, data }: JsonViewerProps) {
  return (
    <details>
      <summary className="cursor-pointer text-sm text-zinc-500">
        {label}
      </summary>
      {data == null ? (
        <p className="mt-1 text-xs italic text-zinc-400">(empty)</p>
      ) : (
        <pre className="mt-1 overflow-auto rounded bg-zinc-50 p-3 text-xs">
          <code>{JSON.stringify(data, null, 2)}</code>
        </pre>
      )}
    </details>
  );
}
