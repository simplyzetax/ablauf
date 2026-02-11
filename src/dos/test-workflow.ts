import { env } from "cloudflare:workers";
import { WorkflowRunner, type WorkflowRunnerProps } from "./workflow-runner";

interface TestWorkflowPayload {
    name: string;
}

interface TestWorkflowResult {
    message: string;
}

export class TestWorkflow extends WorkflowRunner<TestWorkflowPayload, TestWorkflowResult> {
    static async create(props: WorkflowRunnerProps<TestWorkflowPayload>) {
        const stub = env.TEST_WORKFLOW.getByName(props.id);
        const result = await stub.initialize(props);
        return { stub, result };
    }

    async run(payload: TestWorkflowPayload): Promise<TestWorkflowResult> {
        console.log(`Hello, ${payload.name}!`);

        return { message: `Hello, ${payload.name}!` };
    }
} 