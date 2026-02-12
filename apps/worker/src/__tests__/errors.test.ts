import { describe, it, expect } from "vitest";
import {
  WorkflowError,
  WorkflowNotFoundError,
  WorkflowAlreadyExistsError,
  WorkflowTypeUnknownError,
  PayloadValidationError,
  EventValidationError,
  StepFailedError,
  StepRetryExhaustedError,
  EventTimeoutError,
  WorkflowNotRunningError,
} from "@ablauf/workflows";

describe("WorkflowError", () => {
  it("has correct properties", () => {
    const err = new WorkflowNotFoundError("wf-123");
    expect(err).toBeInstanceOf(WorkflowError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("WORKFLOW_NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.source).toBe("api");
    expect(err.message).toBe('Workflow "wf-123" not found');
  });

  it("WorkflowAlreadyExistsError has correct properties", () => {
    const err = new WorkflowAlreadyExistsError("wf-123");
    expect(err.code).toBe("WORKFLOW_ALREADY_EXISTS");
    expect(err.status).toBe(409);
    expect(err.source).toBe("engine");
  });

  it("WorkflowTypeUnknownError has correct properties", () => {
    const err = new WorkflowTypeUnknownError("bad-type");
    expect(err.code).toBe("WORKFLOW_TYPE_UNKNOWN");
    expect(err.status).toBe(400);
    expect(err.source).toBe("api");
  });

  it("PayloadValidationError includes Zod issues in details", () => {
    const issues = [{ path: ["name"], message: "Required" }];
    const err = new PayloadValidationError("Invalid input", issues);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.status).toBe(400);
    expect(err.source).toBe("validation");
    expect(err.details).toEqual({ issues });
  });

  it("EventValidationError includes event name and issues", () => {
    const issues = [{ path: ["approved"], message: "Expected boolean" }];
    const err = new EventValidationError("approval", issues);
    expect(err.code).toBe("EVENT_INVALID");
    expect(err.status).toBe(400);
    expect(err.source).toBe("validation");
    expect(err.details).toEqual({ event: "approval", issues });
  });

  it("StepFailedError has step name in details", () => {
    const err = new StepFailedError("my-step", "something broke");
    expect(err.code).toBe("STEP_FAILED");
    expect(err.status).toBe(500);
    expect(err.source).toBe("step");
    expect(err.details).toEqual({ step: "my-step" });
  });

  it("StepRetryExhaustedError has attempts in details", () => {
    const err = new StepRetryExhaustedError("my-step", 3, "still broken");
    expect(err.code).toBe("STEP_RETRY_EXHAUSTED");
    expect(err.status).toBe(500);
    expect(err.source).toBe("step");
    expect(err.details).toEqual({ step: "my-step", attempts: 3 });
  });

  it("EventTimeoutError has correct properties", () => {
    const err = new EventTimeoutError("approval");
    expect(err.code).toBe("EVENT_TIMEOUT");
    expect(err.status).toBe(408);
    expect(err.source).toBe("engine");
  });

  it("WorkflowNotRunningError includes current status", () => {
    const err = new WorkflowNotRunningError("wf-123", "paused");
    expect(err.code).toBe("WORKFLOW_NOT_RUNNING");
    expect(err.status).toBe(409);
    expect(err.source).toBe("engine");
    expect(err.details).toEqual({ workflowId: "wf-123", currentStatus: "paused" });
  });
});

describe("WorkflowError serialization", () => {
  it("round-trips through toJSON/fromSerialized", () => {
    const original = new WorkflowNotFoundError("wf-456");
    const serialized = new Error(JSON.stringify(original.toJSON()));
    const restored = WorkflowError.fromSerialized(serialized);

    expect(restored).toBeInstanceOf(WorkflowError);
    expect(restored.code).toBe("WORKFLOW_NOT_FOUND");
    expect(restored.status).toBe(404);
    expect(restored.source).toBe("api");
    expect(restored.message).toBe('Workflow "wf-456" not found');
  });

  it("round-trips PayloadValidationError with details", () => {
    const issues = [{ path: ["email"], message: "Required" }];
    const original = new PayloadValidationError("Invalid input", issues);
    const serialized = new Error(JSON.stringify(original.toJSON()));
    const restored = WorkflowError.fromSerialized(serialized);

    expect(restored.code).toBe("VALIDATION_ERROR");
    expect(restored.details).toEqual({ issues });
  });

  it("returns generic WorkflowError for non-workflow errors", () => {
    const plain = new Error("random failure");
    const restored = WorkflowError.fromSerialized(plain);

    expect(restored).toBeInstanceOf(WorkflowError);
    expect(restored.code).toBe("INTERNAL_ERROR");
    expect(restored.status).toBe(500);
  });
});
