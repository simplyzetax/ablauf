import { HTTPException } from "hono/http-exception";
import type {
  ContentfulStatusCode
} from "hono/utils/http-status";

/** Union of all recognized error codes for discriminating {@link WorkflowError} instances. */
export type ErrorCode =
  | "WORKFLOW_NOT_FOUND"
  | "WORKFLOW_ALREADY_EXISTS"
  | "WORKFLOW_TYPE_UNKNOWN"
  | "VALIDATION_ERROR"
  | "STEP_FAILED"
  | "STEP_RETRY_EXHAUSTED"
  | "EVENT_TIMEOUT"
  | "UPDATE_TIMEOUT"
  | "EVENT_INVALID"
  | "WORKFLOW_NOT_RUNNING"
  | "OBSERVABILITY_DISABLED"
  | "INTERNAL_ERROR";

/**
 * Identifies where an error originated.
 *
 * - `"api"` — Request-level errors (bad input, not found).
 * - `"engine"` — Workflow lifecycle errors (already exists, not running, timeout).
 * - `"step"` — Step execution errors (failed, retries exhausted).
 * - `"validation"` — Schema validation errors (payload, event, duration).
 */
export type ErrorSource = "api" | "engine" | "step" | "validation";

const VALID_ERROR_CODES: readonly ErrorCode[] = [
  "WORKFLOW_NOT_FOUND",
  "WORKFLOW_ALREADY_EXISTS",
  "WORKFLOW_TYPE_UNKNOWN",
  "VALIDATION_ERROR",
  "STEP_FAILED",
  "STEP_RETRY_EXHAUSTED",
  "EVENT_TIMEOUT",
  "UPDATE_TIMEOUT",
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

/**
 * Base error class for all Ablauf workflow errors.
 *
 * Extends Hono's `HTTPException` so errors thrown in route handlers are
 * automatically formatted by the centralized `app.onError` handler.
 * Errors crossing DO RPC boundaries are serialized via `toJSON()` and
 * reconstructed via `fromSerialized()`.
 */
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

  /** Serialize to a plain object for JSON transport across DO RPC boundaries. */
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

/**
 * Thrown when a workflow with the given ID is not found.
 *
 * Error code: `WORKFLOW_NOT_FOUND` | HTTP status: `404`
 */
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

/**
 * Thrown when attempting to create a workflow whose ID already exists.
 *
 * Error code: `WORKFLOW_ALREADY_EXISTS` | HTTP status: `409`
 */
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

/**
 * Thrown when the requested workflow type is not registered.
 *
 * Error code: `WORKFLOW_TYPE_UNKNOWN` | HTTP status: `400`
 */
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

/**
 * Thrown when the input payload fails Zod schema validation.
 *
 * Error code: `VALIDATION_ERROR` | HTTP status: `400`
 */
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

/**
 * Thrown when an event payload fails Zod schema validation.
 *
 * Error code: `EVENT_INVALID` | HTTP status: `400`
 */
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

/**
 * Thrown when a workflow step execution fails.
 *
 * Error code: `STEP_FAILED` | HTTP status: `500`
 */
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

/**
 * Thrown when a step has exhausted all configured retry attempts.
 *
 * Error code: `STEP_RETRY_EXHAUSTED` | HTTP status: `500`
 */
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

/**
 * Thrown when `step.waitForEvent()` times out before the event arrives.
 *
 * Error code: `EVENT_TIMEOUT` | HTTP status: `408`
 */
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

/**
 * Thrown when `waitForUpdate()` times out before an SSE update is received.
 *
 * Error code: `UPDATE_TIMEOUT` | HTTP status: `408`
 */
export class UpdateTimeoutError extends WorkflowError {
  constructor(updateName: string, timeout: string) {
    super({
      code: "UPDATE_TIMEOUT",
      message: `Update "${updateName}" timed out after ${timeout}`,
      status: 408,
      source: "engine",
      details: { update: updateName, timeout },
    });
  }
}

/**
 * Thrown when an action requires the workflow to be running but it is not.
 *
 * Error code: `WORKFLOW_NOT_RUNNING` | HTTP status: `409`
 */
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

/**
 * Thrown when two steps within the same workflow share the same name.
 *
 * Error code: `VALIDATION_ERROR` | HTTP status: `400`
 */
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

/**
 * Thrown when a duration string can't be parsed (e.g., not matching `"30s"`, `"5m"`, `"1h"`).
 *
 * Error code: `VALIDATION_ERROR` | HTTP status: `400`
 */
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

/**
 * Thrown when listing or indexing features are called but observability is disabled.
 *
 * Error code: `OBSERVABILITY_DISABLED` | HTTP status: `400`
 */
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

/**
 * Extract Zod validation issues from an unknown error value.
 * Returns the `issues` array from a `ZodError`, or a single synthetic issue otherwise.
 */
export function extractZodIssues(e: unknown): unknown[] {
  return e instanceof Error && "issues" in e
    ? (e as { issues: unknown[] }).issues
    : [{ message: String(e) }];
}
