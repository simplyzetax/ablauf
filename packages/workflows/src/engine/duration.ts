import { InvalidDurationError } from '../errors';

/** Multipliers from duration unit to milliseconds. */
const UNITS: Record<string, number> = {
	ms: 1,
	s: 1000,
	m: 60 * 1000,
	h: 60 * 60 * 1000,
	d: 24 * 60 * 60 * 1000,
};

/**
 * Parse a human-readable duration string into milliseconds.
 *
 * Supported formats: `"500ms"`, `"30s"`, `"5m"`, `"1h"`, `"7d"`.
 *
 * @param duration - Duration string to parse.
 * @returns Duration in milliseconds.
 * @throws {@link InvalidDurationError} When the string doesn't match a supported format.
 *
 * @example
 * ```ts
 * parseDuration("30s");  // 30000
 * parseDuration("5m");   // 300000
 * parseDuration("500ms"); // 500
 * ```
 */
export function parseDuration(duration: string): number {
	const match = duration.match(/^(\d+)\s*(ms|s|m|h|d)$/);
	if (!match) {
		throw new InvalidDurationError(duration);
	}
	return parseInt(match[1], 10) * UNITS[match[2]];
}
