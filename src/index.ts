import { Hono } from "hono";
import { WorkflowRunner } from "./dos/workflow-runner";

const app = new Hono<{ Bindings: Env }>();

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;
export { WorkflowRunner };