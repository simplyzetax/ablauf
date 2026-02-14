import { HTTPException } from 'hono/http-exception';

/** Union of all recognized error codes for discriminating {@link WorkflowError} instances. */
export type ErrorCode =
	| 'WORKFLOW_NOT_FOUND'
	| 'WORKFLOW_ALREADY_EXISTS'
	| 'WORKFLOW_TYPE_UNKNOWN'
	| 'VALIDATION_ERROR'
	| 'STEP_FAILED'
	| 'STEP_RETRY_EXHAUSTED'
	| 'EVENT_TIMEOUT'
	| 'UPDATE_TIMEOUT'
	| 'EVENT_INVALID'
	| 'WORKFLOW_NOT_RUNNING'
	| 'RESOURCE_NOT_FOUND'
	| 'OBSERVABILITY_DISABLED'
	| 'INTERNAL_ERROR';

/**
 * Identifies where an error originated.
 */
export type ErrorSource = 'api' | 'engine' | 'step' | 'validation';

export type WorkflowErrorStatus = 400 | 401 | 403 | 404 | 408 | 409 | 422 | 500 | 502 | 503;

export type WorkflowErrorCatalogEntry = {
	status: WorkflowErrorStatus;
	message: string;
};

/**
 * Canonical status/message catalog for all public error codes.
 *
 * Use this as the single source of truth when wiring transport-layer handlers
 * (oRPC, Hono, etc).
 */
export const WORKFLOW_ERROR_CATALOG = {
	WORKFLOW_NOT_FOUND: { status: 404, message: 'Workflow not found' },
	WORKFLOW_ALREADY_EXISTS: { status: 409, message: 'Workflow already exists' },
	WORKFLOW_TYPE_UNKNOWN: { status: 400, message: 'Workflow type is unknown' },
	VALIDATION_ERROR: { status: 400, message: 'Validation failed' },
	STEP_FAILED: { status: 500, message: 'Workflow step failed' },
	STEP_RETRY_EXHAUSTED: { status: 500, message: 'Workflow step retries exhausted' },
	EVENT_TIMEOUT: { status: 408, message: 'Workflow event timed out' },
	UPDATE_TIMEOUT: { status: 408, message: 'Workflow update timed out' },
	EVENT_INVALID: { status: 400, message: 'Workflow event is invalid' },
	WORKFLOW_NOT_RUNNING: { status: 409, message: 'Workflow is not running' },
	RESOURCE_NOT_FOUND: { status: 404, message: 'Resource not found' },
	OBSERVABILITY_DISABLED: { status: 400, message: 'Observability is disabled' },
	INTERNAL_ERROR: { status: 500, message: 'An unexpected error occurred' },
} as const satisfies Record<ErrorCode, WorkflowErrorCatalogEntry>;

const VALID_ERROR_SOURCES: readonly ErrorSource[] = ['api', 'engine', 'step', 'validation'] as const;

function isErrorCode(value: unknown): value is ErrorCode {
	return typeof value === 'string' && value in WORKFLOW_ERROR_CATALOG;
}

const VALID_WORKFLOW_STATUSES = new Set<WorkflowErrorStatus>(
	Object.values(WORKFLOW_ERROR_CATALOG).map((entry) => entry.status) as WorkflowErrorStatus[],
);

function isWorkflowErrorStatus(value: unknown): value is WorkflowErrorStatus {
	return typeof value === 'number' && VALID_WORKFLOW_STATUSES.has(value as WorkflowErrorStatus);
}

function createErrorInit(code: ErrorCode, source: ErrorSource, message: string, details?: Record<string, unknown>) {
	return {
		code,
		source,
		message,
		status: WORKFLOW_ERROR_CATALOG[code].status,
		details,
	};
}

/**
 * Framework-agnostic domain error for Ablauf.
 */
export class WorkflowError extends Error {
	public readonly code: ErrorCode;
	public readonly status: WorkflowErrorStatus;
	public readonly source: ErrorSource;
	public readonly details?: Record<string, unknown>;

	constructor(opts: {
		code: ErrorCode;
		message: string;
		status: WorkflowErrorStatus;
		source: ErrorSource;
		details?: Record<string, unknown>;
	}) {
		super(opts.message);
		this.name = this.constructor.name;
		this.code = opts.code;
		this.status = opts.status;
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
	 * Reconstruct a `WorkflowError` from unknown thrown values, including
	 * serialized errors crossing Durable Object RPC boundaries.
	 */
	static fromSerialized(e: unknown): WorkflowError {
		if (e instanceof WorkflowError) return e;

		const message = e instanceof Error ? e.message : String(e);

		try {
			const parsed: unknown = JSON.parse(message);
			if (typeof parsed !== 'object' || parsed === null) {
				throw new Error('Invalid serialized WorkflowError payload');
			}

			const candidate = parsed as Record<string, unknown>;
			const code = candidate.code;
			const source = candidate.source;
			const status = candidate.status;
			const parsedMessage = candidate.message;
			const detailsRaw = candidate.details;
			if (
				candidate.__workflowError &&
				typeof parsedMessage === 'string' &&
				isErrorCode(code) &&
				(VALID_ERROR_SOURCES as readonly string[]).includes(String(source)) &&
				isWorkflowErrorStatus(status) &&
				status === WORKFLOW_ERROR_CATALOG[code].status
			) {
				const details = detailsRaw && typeof detailsRaw === 'object' ? (detailsRaw as Record<string, unknown>) : undefined;
				return new WorkflowError({
					code,
					message: parsedMessage,
					status,
					source: source as ErrorSource,
					details,
				});
			}
		} catch {
			// Not a serialized WorkflowError
		}

		return createInternalWorkflowError(message);
	}
}

/**
 * Normalize unknown throwables into a WorkflowError when possible.
 *
 * - WorkflowError instances pass through unchanged.
 * - Serialized DO errors are reconstructed.
 * - Unknown non-Error values return null.
 */
export function asWorkflowError(error: unknown, opts?: { includeInternal?: boolean }): WorkflowError | null {
	const includeInternal = opts?.includeInternal ?? true;

	if (error instanceof WorkflowError) {
		if (!includeInternal && error.code === 'INTERNAL_ERROR') return null;
		return error;
	}

	if (!(error instanceof Error)) {
		return null;
	}

	const restored = WorkflowError.fromSerialized(error);
	if (!includeInternal && restored.code === 'INTERNAL_ERROR') {
		return null;
	}
	return restored;
}

/**
 * Create a generic INTERNAL_ERROR WorkflowError.
 */
export function createInternalWorkflowError(message: string = WORKFLOW_ERROR_CATALOG.INTERNAL_ERROR.message): WorkflowError {
	return new WorkflowError(createErrorInit('INTERNAL_ERROR', 'api', message));
}

/**
 * Convert a domain WorkflowError into an HTTPException for Hono boundaries.
 */
export function toHonoError(error: WorkflowError): HTTPException {
	return new HTTPException(error.status, { message: error.message, cause: error });
}

export function toWorkflowErrorResponse(error: WorkflowError) {
	return {
		error: error.toJSON(),
	};
}

type ORPCErrorDef<K extends ErrorCode> = {
	status: (typeof WORKFLOW_ERROR_CATALOG)[K]['status'];
	message: (typeof WORKFLOW_ERROR_CATALOG)[K]['message'];
};

type ORPCErrorMap<Codes extends readonly ErrorCode[]> = {
	[K in Codes[number]]: ORPCErrorDef<K>;
};

/**
 * Select a typed oRPC error map from the canonical catalog.
 */
export function pickORPCErrors<const Codes extends readonly ErrorCode[]>(codes: Codes): ORPCErrorMap<Codes> {
	return Object.fromEntries(codes.map((code) => [code, WORKFLOW_ERROR_CATALOG[code]])) as ORPCErrorMap<Codes>;
}

export class WorkflowNotFoundError extends WorkflowError {
	constructor(workflowId: string) {
		super(createErrorInit('WORKFLOW_NOT_FOUND', 'api', `Workflow "${workflowId}" not found`));
	}
}

/**
 * Thrown when attempting to create a workflow whose ID already exists.
 *
 * Error code: `WORKFLOW_ALREADY_EXISTS` | HTTP status: `409`
 */
export class WorkflowAlreadyExistsError extends WorkflowError {
	constructor(workflowId: string) {
		super(createErrorInit('WORKFLOW_ALREADY_EXISTS', 'engine', `Workflow "${workflowId}" already exists`));
	}
}

/**
 * Thrown when the requested workflow type is not registered.
 *
 * Error code: `WORKFLOW_TYPE_UNKNOWN` | HTTP status: `400`
 */
export class WorkflowTypeUnknownError extends WorkflowError {
	constructor(workflowType: string) {
		super(createErrorInit('WORKFLOW_TYPE_UNKNOWN', 'api', `Unknown workflow type: "${workflowType}"`));
	}
}

/**
 * Thrown when the input payload fails Zod schema validation.
 *
 * Error code: `VALIDATION_ERROR` | HTTP status: `400`
 */
export class PayloadValidationError extends WorkflowError {
	constructor(message: string, issues: unknown[]) {
		super(createErrorInit('VALIDATION_ERROR', 'validation', message, { issues }));
	}
}

/**
 * Thrown when an event payload fails Zod schema validation.
 *
 * Error code: `EVENT_INVALID` | HTTP status: `400`
 */
export class EventValidationError extends WorkflowError {
	constructor(eventName: string, issues: unknown[]) {
		super(
			createErrorInit('EVENT_INVALID', 'validation', `Invalid payload for event "${eventName}"`, {
				event: eventName,
				issues,
			}),
		);
	}
}

/**
 * Thrown when a workflow step execution fails.
 *
 * Error code: `STEP_FAILED` | HTTP status: `500`
 */
export class StepFailedError extends WorkflowError {
	constructor(stepName: string, cause: string) {
		super(createErrorInit('STEP_FAILED', 'step', `Step "${stepName}" failed: ${cause}`, { step: stepName }));
	}
}

/**
 * Thrown when a step has exhausted all configured retry attempts.
 *
 * Error code: `STEP_RETRY_EXHAUSTED` | HTTP status: `500`
 */
export class StepRetryExhaustedError extends WorkflowError {
	constructor(stepName: string, attempts: number, cause: string) {
		super(
			createErrorInit('STEP_RETRY_EXHAUSTED', 'step', `Step "${stepName}" failed after ${attempts} attempts: ${cause}`, {
				step: stepName,
				attempts,
			}),
		);
	}
}

/**
 * Thrown when `step.waitForEvent()` times out before the event arrives.
 *
 * Error code: `EVENT_TIMEOUT` | HTTP status: `408`
 */
export class EventTimeoutError extends WorkflowError {
	constructor(eventName: string) {
		super(createErrorInit('EVENT_TIMEOUT', 'engine', `Event "${eventName}" timed out`));
	}
}

/**
 * Thrown when `waitForUpdate()` times out before an SSE update is received.
 *
 * Error code: `UPDATE_TIMEOUT` | HTTP status: `408`
 */
export class UpdateTimeoutError extends WorkflowError {
	constructor(updateName: string, timeout: string) {
		super(
			createErrorInit('UPDATE_TIMEOUT', 'engine', `Update "${updateName}" timed out after ${timeout}`, {
				update: updateName,
				timeout,
			}),
		);
	}
}

/**
 * Thrown when an action requires the workflow to be running but it is not.
 *
 * Error code: `WORKFLOW_NOT_RUNNING` | HTTP status: `409`
 */
export class WorkflowNotRunningError extends WorkflowError {
	constructor(workflowId: string, currentStatus: string) {
		super(
			createErrorInit('WORKFLOW_NOT_RUNNING', 'engine', `Workflow "${workflowId}" is not running (status: ${currentStatus})`, {
				workflowId,
				currentStatus,
			}),
		);
	}
}

/**
 * Thrown when two steps within the same workflow share the same name.
 *
 * Error code: `VALIDATION_ERROR` | HTTP status: `400`
 */
export class DuplicateStepError extends WorkflowError {
	constructor(stepName: string, method: string) {
		super(
			createErrorInit(
				'VALIDATION_ERROR',
				'engine',
				`Duplicate step name "${stepName}" in ${method}(). Each step must have a unique name.`,
				{ step: stepName, method },
			),
		);
	}
}

/**
 * Thrown when a duration string can't be parsed (e.g., not matching `"30s"`, `"5m"`, `"1h"`).
 *
 * Error code: `VALIDATION_ERROR` | HTTP status: `400`
 */
export class InvalidDurationError extends WorkflowError {
	constructor(duration: string) {
		super(createErrorInit('VALIDATION_ERROR', 'validation', `Invalid duration: "${duration}". Use format like "30s", "5m", "24h", "7d".`));
	}
}

/**
 * Thrown when a requested resource (other than a workflow instance) is not found.
 *
 * Error code: `RESOURCE_NOT_FOUND` | HTTP status: `404`
 */
export class ResourceNotFoundError extends WorkflowError {
	constructor(resource: string, id?: string) {
		super(
			createErrorInit(
				'RESOURCE_NOT_FOUND',
				'api',
				id ? `${resource} "${id}" not found` : `${resource} not found`,
				id ? { resource, id } : { resource },
			),
		);
	}
}

/**
 * Thrown when listing or indexing features are called but observability is disabled.
 *
 * Error code: `OBSERVABILITY_DISABLED` | HTTP status: `400`
 */
export class ObservabilityDisabledError extends WorkflowError {
	constructor() {
		super(
			createErrorInit(
				'OBSERVABILITY_DISABLED',
				'api',
				'Observability is disabled. Enable it in AblaufConfig to use listing and indexing features.',
			),
		);
	}
}

/**
 * Extract Zod validation issues from an unknown error value.
 * Returns the `issues` array from a `ZodError`, or a single synthetic issue otherwise.
 */
export function extractZodIssues(e: unknown): unknown[] {
	return e instanceof Error && 'issues' in e ? (e as { issues: unknown[] }).issues : [{ message: String(e) }];
}
