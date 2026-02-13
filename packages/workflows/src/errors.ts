import { HTTPException } from "hono/http-exception";
import type {
  ContentfulStatusCode
} from "hono/utils/http-status";

export type ErrorCode =
  | "WORKFLOW_NOT_FOUND"
  | "WORKFLOW_ALREADY_EXISTS"
  | "WORKFLOW_TYPE_UNKNOWN"
  | "VALIDATION_ERROR"
  | "STEP_FAILED"
  | "STEP_RETRY_EXHAUSTED"
  | "EVENT_TIMEOUT"
  | "EVENT_INVALID"
  | "WORKFLOW_NOT_RUNNING"
  | "OBSERVABILITY_DISABLED"
  | "INTERNAL_ERROR";

export type ErrorSource = "api" | "engine" | "step" | "validation";

const VALID_ERROR_CODES: readonly ErrorCode[] = [
  "WORKFLOW_NOT_FOUND",
  "WORKFLOW_ALREADY_EXISTS",
  "WORKFLOW_TYPE_UNKNOWN",
  "VALIDATION_ERROR",
  "STEP_FAILED",
  "STEP_RETRY_EXHAUSTED",
  "EVENT_TIMEOUT",
  "EVENT_INVALID",
  "WORKFLOW_NOT_RUNNING",
  "OBSERVABILITY_DISABLED",
  "INTERNAL_ERROR",
] as const;

const VALID_ERROR_SOURCES: readonly ErrorSource[] = [
  "api",
  "engine",
  "step",
  "validation",
] as const;

const VALID_HTTP_STATUSES = new Set([400, 401, 403, 404, 408, 409, 422, 500, 502, 503]);

export class WorkflowError extends HTTPException {
  public readonly code: ErrorCode;
  public readonly source: ErrorSource;
  public readonly details?: Record<string, unknown>;

  constructor(opts: {
    code: ErrorCode;
    message: string;
    status: ContentfulStatusCode;
    source: ErrorSource;
    details?: Record<string, unknown>;
  }) {
    super(opts.status, { message: opts.message });
    this.name = this.constructor.name;
    this.code = opts.code;
    this.source = opts.source;
    this.details = opts.details;
  }

  toJSON() {
    return {
      __workflowError: true,
      code: this.code,
      message: this.message,
      status: this.status,
      source: this.source,
      ...(this.details && { details: this.details }),
    };
  }

  /**
   * Reconstruct a `WorkflowError` from an unknown thrown value (typically
   * one that crossed a Durable Object RPC boundary as a serialized JSON
   * string).
   *
   * **Important:** The returned instance is always the base `WorkflowError`
   * class, never a subclass such as `WorkflowNotFoundError`. Consumers
   * should therefore discriminate on `err.code` (e.g.
   * `err.code === "WORKFLOW_NOT_FOUND"`) rather than using `instanceof`
   * checks against subclass constructors.
   */
  static fromSerialized(e: unknown): WorkflowError {
    if (e instanceof WorkflowError) return e;

    const message = e instanceof Error ? e.message : String(e);

    try {
      const parsed = JSON.parse(message);
      if (
        parsed?.__workflowError &&
        typeof parsed.message === "string" &&
        (VALID_ERROR_CODES as readonly string[]).includes(parsed.code) &&
        (VALID_ERROR_SOURCES as readonly string[]).includes(parsed.source) &&
        VALID_HTTP_STATUSES.has(parsed.status)
      ) {
        return new WorkflowError({
          code: parsed.code,
          message: parsed.message,
          status: parsed.status,
          source: parsed.source,
          details: parsed.details,
        });
      }
    } catch {
      // Not a serialized WorkflowError
    }

    return new WorkflowError({
      code: "INTERNAL_ERROR",
      message,
      status: 500,
      source: "api",
    });
  }
}

export class WorkflowNotFoundError extends WorkflowError {
  constructor(workflowId: string) {
    super({
      code: "WORKFLOW_NOT_FOUND",
      message: `Workflow "${workflowId}" not found`,
      status: 404,
      source: "api",
    });
  }
}

export class WorkflowAlreadyExistsError extends WorkflowError {
  constructor(workflowId: string) {
    super({
      code: "WORKFLOW_ALREADY_EXISTS",
      message: `Workflow "${workflowId}" already exists`,
      status: 409,
      source: "engine",
    });
  }
}

export class WorkflowTypeUnknownError extends WorkflowError {
  constructor(workflowType: string) {
    super({
      code: "WORKFLOW_TYPE_UNKNOWN",
      message: `Unknown workflow type: "${workflowType}"`,
      status: 400,
      source: "api",
    });
  }
}

export class PayloadValidationError extends WorkflowError {
  constructor(message: string, issues: unknown[]) {
    super({
      code: "VALIDATION_ERROR",
      message,
      status: 400,
      source: "validation",
      details: { issues },
    });
  }
}

export class EventValidationError extends WorkflowError {
  constructor(eventName: string, issues: unknown[]) {
    super({
      code: "EVENT_INVALID",
      message: `Invalid payload for event "${eventName}"`,
      status: 400,
      source: "validation",
      details: { event: eventName, issues },
    });
  }
}

export class StepFailedError extends WorkflowError {
  constructor(stepName: string, cause: string) {
    super({
      code: "STEP_FAILED",
      message: `Step "${stepName}" failed: ${cause}`,
      status: 500,
      source: "step",
      details: { step: stepName },
    });
  }
}

export class StepRetryExhaustedError extends WorkflowError {
  constructor(stepName: string, attempts: number, cause: string) {
    super({
      code: "STEP_RETRY_EXHAUSTED",
      message: `Step "${stepName}" failed after ${attempts} attempts: ${cause}`,
      status: 500,
      source: "step",
      details: { step: stepName, attempts },
    });
  }
}

export class EventTimeoutError extends WorkflowError {
  constructor(eventName: string) {
    super({
      code: "EVENT_TIMEOUT",
      message: `Event "${eventName}" timed out`,
      status: 408,
      source: "engine",
    });
  }
}

export class WorkflowNotRunningError extends WorkflowError {
  constructor(workflowId: string, currentStatus: string) {
    super({
      code: "WORKFLOW_NOT_RUNNING",
      message: `Workflow "${workflowId}" is not running (status: ${currentStatus})`,
      status: 409,
      source: "engine",
      details: { workflowId, currentStatus },
    });
  }
}

export class DuplicateStepError extends WorkflowError {
  constructor(stepName: string, method: string) {
    super({
      code: "VALIDATION_ERROR",
      message: `Duplicate step name "${stepName}" in ${method}(). Each step must have a unique name.`,
      status: 400,
      source: "engine",
      details: { step: stepName, method },
    });
  }
}

export class InvalidDurationError extends WorkflowError {
  constructor(duration: string) {
    super({
      code: "VALIDATION_ERROR",
      message: `Invalid duration: "${duration}". Use format like "30s", "5m", "24h", "7d".`,
      status: 400,
      source: "validation",
    });
  }
}

export class ObservabilityDisabledError extends WorkflowError {
  constructor() {
    super({
      code: "OBSERVABILITY_DISABLED",
      message: "Observability is disabled. Enable it in AblaufConfig to use listing and indexing features.",
      status: 400,
      source: "api",
    });
  }
}

export function extractZodIssues(e: unknown): unknown[] {
  return e instanceof Error && "issues" in e
    ? (e as { issues: unknown[] }).issues
    : [{ message: String(e) }];
}
