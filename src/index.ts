import { Hono } from "hono";
import { TestWorkflow } from "./dos/test-workflow";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
	const { result } = await TestWorkflow.create({
		id: "test",
		payload: { name: "World" },
	});
	return c.json(result);
});

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;
export { TestWorkflow } from "./dos/test-workflow";
export { WorkflowRunner } from "./dos/workflow-runner";
