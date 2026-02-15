import { InvalidSizeError } from '../errors';

/** Multipliers from size unit to bytes. */
const UNITS: Record<string, number> = {
	b: 1,
	kb: 1024,
	mb: 1024 * 1024,
	gb: 1024 * 1024 * 1024,
};

/**
 * Parse a human-readable size string into bytes.
 *
 * Supported formats: `"100b"`, `"512kb"`, `"64mb"`, `"1gb"`.
 *
 * @param size - Size string to parse.
 * @returns Size in bytes.
 * @throws {@link InvalidSizeError} When the string doesn't match a supported format.
 *
 * @example
 * ```ts
 * parseSize("64mb");   // 67108864
 * parseSize("512kb");  // 524288
 * parseSize("1gb");    // 1073741824
 * ```
 */
export function parseSize(size: string): number {
	const match = size.match(/^(\d+)\s*(b|kb|mb|gb)$/);
	if (!match) {
		throw new InvalidSizeError(size);
	}
	return parseInt(match[1], 10) * UNITS[match[2]];
}
