import { describe, it, expect } from 'vitest';
import {
	asWorkflowError,
	createInternalWorkflowError,
	pickORPCErrors,
	toHonoError,
	toWorkflowErrorResponse,
	WORKFLOW_ERROR_CATALOG,
	WorkflowError,
	WorkflowNotFoundError,
	WorkflowAlreadyExistsError,
	WorkflowTypeUnknownError,
	PayloadValidationError,
	EventValidationError,
	StepFailedError,
	StepRetryExhaustedError,
	EventTimeoutError,
	UpdateTimeoutError,
	WorkflowNotRunningError,
} from '@der-ablauf/workflows';

describe('WorkflowError', () => {
	it('has correct properties', () => {
		const err = new WorkflowNotFoundError('wf-123');
		expect(err).toBeInstanceOf(WorkflowError);
		expect(err).toBeInstanceOf(Error);
		expect(err.code).toBe('WORKFLOW_NOT_FOUND');
		expect(err.status).toBe(404);
		expect(err.source).toBe('api');
		expect(err.message).toBe('Workflow "wf-123" not found');
	});

	it('WorkflowAlreadyExistsError has correct properties', () => {
		const err = new WorkflowAlreadyExistsError('wf-123');
		expect(err.code).toBe('WORKFLOW_ALREADY_EXISTS');
		expect(err.status).toBe(409);
		expect(err.source).toBe('engine');
	});

	it('WorkflowTypeUnknownError has correct properties', () => {
		const err = new WorkflowTypeUnknownError('bad-type');
		expect(err.code).toBe('WORKFLOW_TYPE_UNKNOWN');
		expect(err.status).toBe(400);
		expect(err.source).toBe('api');
	});

	it('PayloadValidationError includes Zod issues in details', () => {
		const issues = [{ path: ['name'], message: 'Required' }];
		const err = new PayloadValidationError('Invalid input', issues);
		expect(err.code).toBe('VALIDATION_ERROR');
		expect(err.status).toBe(400);
		expect(err.source).toBe('validation');
		expect(err.details).toEqual({ issues });
	});

	it('EventValidationError includes event name and issues', () => {
		const issues = [{ path: ['approved'], message: 'Expected boolean' }];
		const err = new EventValidationError('approval', issues);
		expect(err.code).toBe('EVENT_INVALID');
		expect(err.status).toBe(400);
		expect(err.source).toBe('validation');
		expect(err.details).toEqual({ event: 'approval', issues });
	});

	it('StepFailedError has step name in details', () => {
		const err = new StepFailedError('my-step', 'something broke');
		expect(err.code).toBe('STEP_FAILED');
		expect(err.status).toBe(500);
		expect(err.source).toBe('step');
		expect(err.details).toEqual({ step: 'my-step' });
	});

	it('StepRetryExhaustedError has attempts in details', () => {
		const err = new StepRetryExhaustedError('my-step', 3, 'still broken');
		expect(err.code).toBe('STEP_RETRY_EXHAUSTED');
		expect(err.status).toBe(500);
		expect(err.source).toBe('step');
		expect(err.details).toEqual({ step: 'my-step', attempts: 3 });
	});

	it('EventTimeoutError has correct properties', () => {
		const err = new EventTimeoutError('approval');
		expect(err.code).toBe('EVENT_TIMEOUT');
		expect(err.status).toBe(408);
		expect(err.source).toBe('engine');
	});

	it('UpdateTimeoutError has correct properties', () => {
		const err = new UpdateTimeoutError('done', '10s');
		expect(err.code).toBe('UPDATE_TIMEOUT');
		expect(err.status).toBe(408);
		expect(err.source).toBe('engine');
		expect(err.details).toEqual({ update: 'done', timeout: '10s' });
	});

	it('WorkflowNotRunningError includes current status', () => {
		const err = new WorkflowNotRunningError('wf-123', 'paused');
		expect(err.code).toBe('WORKFLOW_NOT_RUNNING');
		expect(err.status).toBe(409);
		expect(err.source).toBe('engine');
		expect(err.details).toEqual({ workflowId: 'wf-123', currentStatus: 'paused' });
	});
});

describe('WorkflowError serialization', () => {
	it('round-trips through toJSON/fromSerialized', () => {
		const original = new WorkflowNotFoundError('wf-456');
		const serialized = new Error(JSON.stringify(original.toJSON()));
		const restored = WorkflowError.fromSerialized(serialized);

		expect(restored).toBeInstanceOf(WorkflowError);
		expect(restored.code).toBe('WORKFLOW_NOT_FOUND');
		expect(restored.status).toBe(404);
		expect(restored.source).toBe('api');
		expect(restored.message).toBe('Workflow "wf-456" not found');
	});

	it('round-trips PayloadValidationError with details', () => {
		const issues = [{ path: ['email'], message: 'Required' }];
		const original = new PayloadValidationError('Invalid input', issues);
		const serialized = new Error(JSON.stringify(original.toJSON()));
		const restored = WorkflowError.fromSerialized(serialized);

		expect(restored.code).toBe('VALIDATION_ERROR');
		expect(restored.details).toEqual({ issues });
	});

	it('returns generic WorkflowError for non-workflow errors', () => {
		const plain = new Error('random failure');
		const restored = WorkflowError.fromSerialized(plain);

		expect(restored).toBeInstanceOf(WorkflowError);
		expect(restored.code).toBe('INTERNAL_ERROR');
		expect(restored.status).toBe(500);
	});
});

describe('Workflow error adapters', () => {
	it('maps domain errors to Hono HTTPException', () => {
		const err = new WorkflowNotFoundError('wf-1');
		const honoErr = toHonoError(err);
		expect(honoErr.status).toBe(404);
		expect(honoErr.message).toContain('Workflow "wf-1" not found');
	});

	it('builds consistent JSON error responses', () => {
		const err = new WorkflowAlreadyExistsError('wf-2');
		const body = toWorkflowErrorResponse(err);
		expect(body).toEqual({
			error: {
				__workflowError: true,
				code: 'WORKFLOW_ALREADY_EXISTS',
				message: 'Workflow "wf-2" already exists',
				status: 409,
				source: 'engine',
			},
		});
	});

	it('normalizes unknown errors into INTERNAL_ERROR by default', () => {
		const err = asWorkflowError(new Error('boom'));
		expect(err).toBeTruthy();
		expect(err?.code).toBe('INTERNAL_ERROR');
	});

	it('allows filtering internal errors during normalization', () => {
		const err = asWorkflowError(new Error('boom'), { includeInternal: false });
		expect(err).toBeNull();
	});

	it('uses the catalog as oRPC error source of truth', () => {
		const map = pickORPCErrors(['WORKFLOW_NOT_FOUND', 'INTERNAL_ERROR'] as const);
		expect(map.WORKFLOW_NOT_FOUND.status).toBe(WORKFLOW_ERROR_CATALOG.WORKFLOW_NOT_FOUND.status);
		expect(map.INTERNAL_ERROR.message).toBe(WORKFLOW_ERROR_CATALOG.INTERNAL_ERROR.message);
	});

	it('creates default internal errors with canonical defaults', () => {
		const err = createInternalWorkflowError();
		expect(err.code).toBe('INTERNAL_ERROR');
		expect(err.status).toBe(500);
		expect(err.message).toBe(WORKFLOW_ERROR_CATALOG.INTERNAL_ERROR.message);
	});
});
