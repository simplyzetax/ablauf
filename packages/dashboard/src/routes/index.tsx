import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Ablauf Dashboard</h1>
      <p className="mt-2 text-zinc-500">Workflow list will go here.</p>
    </div>
  );
}
