export class SleepInterrupt {
	readonly _tag = "SleepInterrupt";
	constructor(
		public readonly stepName: string,
		public readonly wakeAt: number,
	) {}
}

export class WaitInterrupt {
	readonly _tag = "WaitInterrupt";
	constructor(
		public readonly stepName: string,
		public readonly timeoutAt: number | null,
	) {}
}

export class PauseInterrupt {
	readonly _tag = "PauseInterrupt";
}

export function isInterrupt(e: unknown): e is SleepInterrupt | WaitInterrupt | PauseInterrupt {
	return e instanceof SleepInterrupt || e instanceof WaitInterrupt || e instanceof PauseInterrupt;
}
