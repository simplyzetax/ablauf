import type { WorkflowClass } from "../engine/types";
import { TestWorkflow } from "./test-workflow";

export const registry: Record<string, WorkflowClass> = {
	test: TestWorkflow as unknown as WorkflowClass,
};
