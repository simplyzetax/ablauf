import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
	return c.json({ status: "ok" });
});

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { WorkflowRunner } from "./engine/workflow-runner";
