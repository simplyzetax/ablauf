import { Hono } from "hono";
import { WorkflowRunner } from "./dos/workflow-runner";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
	const { result } = await WorkflowRunner.create(c.env.TEST_WORKFLOW, {
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
