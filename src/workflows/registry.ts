import type { WorkflowClass } from "../engine/types";
import { TestWorkflow } from "./test-workflow";
import { FailingStepWorkflow } from "./failing-step-workflow";

export const registry: Record<string, WorkflowClass> = {
	test: TestWorkflow as unknown as WorkflowClass,
	"failing-step": FailingStepWorkflow as unknown as WorkflowClass,
};
