import { EventValidationError, UpdateTimeoutError, WorkflowNotRunningError, extractZodIssues } from './errors';
import { parseDuration } from './engine/duration';
import type { WorkflowClass, WorkflowRunnerStub, WorkflowStatusResponseFor, WorkflowEventProps, WorkflowEvents } from './engine/types';
import SuperJSON from 'superjson';

/**
 * Handle for interacting with a specific workflow instance.
 *
 * Provides typed methods for querying status, sending events, controlling
 * lifecycle (pause/resume/terminate), and waiting for real-time updates.
 *
 * Obtained via `ablauf.create()` or `ablauf.get()`.
 *
 * @typeParam Payload - Input payload type.
 * @typeParam Result - Return type of the workflow.
 * @typeParam Events - Map of event names to payload types.
 * @typeParam Type - String literal workflow type identifier.
 * @typeParam SSEUpdates - Map of SSE update names to data types.
 */
export class WorkflowHandle<
	Payload = unknown,
	Result = unknown,
	Events extends object = WorkflowEvents,
	Type extends string = string,
	SSEUpdates extends object = {},
> {
	constructor(
		private rpcStub: WorkflowRunnerStub,
		private rawStub: DurableObjectStub,
		private workflow: WorkflowClass<Payload, Result, Events, Type, SSEUpdates>,
		private _id: string,
	) {}

	/** @internal — access the low-level RPC stub (for testing and advanced use). */
	get _rpc(): WorkflowRunnerStub {
		return this.rpcStub;
	}

	/**
	 * Get the current status of this workflow instance.
	 *
	 * @returns A typed status response with inferred payload, result, and type.
	 */
	async getStatus(): Promise<WorkflowStatusResponseFor<Payload, Result, Type>> {
		return this.rpcStub.getStatus() as Promise<WorkflowStatusResponseFor<Payload, Result, Type>>;
	}

	/**
	 * Send a typed event to this workflow instance.
	 *
	 * The event name and payload are validated against the workflow's event schemas
	 * before delivery to the Durable Object.
	 *
	 * @param props - The event name and payload.
	 * @throws {EventValidationError} If the event name is unknown or the payload fails validation.
	 * @throws {WorkflowNotRunningError} If the workflow is not waiting for this event.
	 *
	 * @example
	 * ```ts
	 * const order = ablauf.get(OrderWorkflow, { id: 'order-123' });
	 * await order.sendEvent({
	 *   event: 'payment-received',
	 *   payload: { amount: 99.99 },
	 * });
	 * ```
	 */
	async sendEvent(props: WorkflowEventProps<Events>): Promise<void> {
		const schema = this.workflow.events[props.event];
		if (!schema) {
			throw new EventValidationError(props.event, [
				{ message: `Unknown event "${props.event}" for workflow type "${this.workflow.type}"` },
			]);
		}
		let payload: unknown;
		try {
			payload = schema.parse(props.payload);
		} catch (e) {
			const issues = extractZodIssues(e);
			throw new EventValidationError(props.event, issues);
		}
		await this.rpcStub.deliverEvent({ event: props.event, payload });
	}

	/**
	 * Pause this workflow. It will finish its current step, then suspend.
	 */
	async pause(): Promise<void> {
		await this.rpcStub.pause();
	}

	/**
	 * Resume this workflow. Replays execution history and continues from where it stopped.
	 */
	async resume(): Promise<void> {
		await this.rpcStub.resume();
	}

	/**
	 * Permanently terminate this workflow. It cannot be resumed after termination.
	 */
	async terminate(): Promise<void> {
		await this.rpcStub.terminate();
	}

	/**
	 * Wait for a specific SSE update from this workflow.
	 *
	 * Connects to the workflow's WebSocket stream and resolves when the named update
	 * arrives, or rejects if the timeout expires or the workflow stops running.
	 *
	 * @param props - Options including the update name and optional timeout.
	 * @param props.update - The SSE update event name to wait for.
	 * @param props.timeout - Optional timeout as a duration string (e.g., `"30s"`, `"5m"`).
	 * @returns The typed data payload of the matched SSE update event.
	 * @throws {UpdateTimeoutError} If the timeout expires before the update arrives.
	 * @throws {WorkflowNotRunningError} If the workflow completes or errors before the update.
	 *
	 * @example
	 * ```ts
	 * const order = ablauf.get(OrderWorkflow, { id: 'order-123' });
	 * const progress = await order.waitForUpdate({
	 *   update: 'progress',
	 *   timeout: '30s',
	 * });
	 * ```
	 */
	async waitForUpdate<K extends Extract<keyof SSEUpdates, string>>(props: { update: K; timeout?: string }): Promise<SSEUpdates[K]> {
		const resp = await this.rawStub.fetch('http://fake-host/ws', {
			headers: { Upgrade: 'websocket' },
		});

		const ws = resp.webSocket;
		if (!ws) {
			throw new WorkflowNotRunningError(this._id, 'WebSocket upgrade failed');
		}
		ws.accept();

		const timeoutMs = props.timeout ? parseDuration(props.timeout) : null;

		return new Promise<SSEUpdates[K]>((resolve, reject) => {
			let timer: ReturnType<typeof setTimeout> | null = null;

			const cleanup = () => {
				if (timer) clearTimeout(timer);
				try {
					ws.close();
				} catch {
					/* already closed */
				}
			};

			ws.addEventListener('message', (evt) => {
				try {
					const parsed = JSON.parse(evt.data as string);
					if (parsed.event === 'close') {
						cleanup();
						this.rpcStub
							.getStatus()
							.then((status) => {
								reject(new WorkflowNotRunningError(this._id, status.status));
							})
							.catch(reject);
						return;
					}
					if (parsed.event === props.update) {
						cleanup();
						resolve(SuperJSON.parse(parsed.data) as SSEUpdates[K]);
					}
				} catch {
					// Malformed message, skip
				}
			});

			ws.addEventListener('close', () => {
				cleanup();
				this.rpcStub
					.getStatus()
					.then((status) => {
						reject(new WorkflowNotRunningError(this._id, status.status));
					})
					.catch(reject);
			});

			ws.addEventListener('error', () => {
				cleanup();
				reject(new WorkflowNotRunningError(this._id, 'WebSocket error'));
			});

			if (timeoutMs !== null) {
				timer = setTimeout(() => {
					cleanup();
					reject(new UpdateTimeoutError(String(props.update), props.timeout ?? `${timeoutMs}ms`));
				}, timeoutMs);
			}
		});
	}
}
