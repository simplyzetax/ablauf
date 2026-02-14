/**
 * Thrown by `step.sleep()` and retry scheduling to suspend execution until a Durable Object alarm fires.
 *
 * Not an `Error` subclass — caught by the workflow runner to set a DO alarm
 * rather than propagating as a failure.
 */
export class SleepInterrupt {
	readonly _tag = 'SleepInterrupt';
	constructor(
		/** Name of the step that triggered the sleep. */
		public readonly stepName: string,
		/** Unix timestamp (ms) when execution should resume. */
		public readonly wakeAt: number,
	) {}
}

/**
 * Thrown by `step.waitForEvent()` to suspend execution until an external event is delivered.
 *
 * Not an `Error` subclass — caught by the workflow runner to set a DO alarm
 * for the optional timeout.
 */
export class WaitInterrupt {
	readonly _tag = 'WaitInterrupt';
	constructor(
		/** Name of the event being waited for. */
		public readonly stepName: string,
		/** Unix timestamp (ms) for the timeout, or `null` if no timeout is set. */
		public readonly timeoutAt: number | null,
	) {}
}

/**
 * Thrown when a workflow detects it has been paused and should stop execution.
 *
 * Not an `Error` subclass — caught by the workflow runner to set the `"paused"` status.
 */
export class PauseInterrupt {
	readonly _tag = 'PauseInterrupt';
}

/**
 * Type guard that checks whether a thrown value is one of the interrupt classes.
 *
 * Used by the workflow runner to distinguish flow-control interrupts from real errors.
 */
export function isInterrupt(e: unknown): e is SleepInterrupt | WaitInterrupt | PauseInterrupt {
	return e instanceof SleepInterrupt || e instanceof WaitInterrupt || e instanceof PauseInterrupt;
}
