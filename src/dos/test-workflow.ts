import { WorkflowRunner } from "./workflow-runner";

interface TestWorkflowPayload {
    name: string;
}

interface TestWorkflowResult {
    message: string;
}

export class TestWorkflow extends WorkflowRunner<TestWorkflowPayload, TestWorkflowResult> {
    async run(payload: TestWorkflowPayload): Promise<TestWorkflowResult> {
        console.log(`Hello, ${payload.name}!`);

        return { message: `Hello, ${payload.name}!` };
    }
} 