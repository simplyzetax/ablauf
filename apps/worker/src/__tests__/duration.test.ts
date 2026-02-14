import { describe, it, expect } from 'vitest';
import { parseDuration, InvalidDurationError } from '@der-ablauf/workflows';

describe('parseDuration', () => {
	it('parses all valid duration formats', () => {
		expect(parseDuration('500ms')).toBe(500);
		expect(parseDuration('1s')).toBe(1000);
		expect(parseDuration('30s')).toBe(30000);
		expect(parseDuration('5m')).toBe(300000);
		expect(parseDuration('1h')).toBe(3600000);
		expect(parseDuration('7d')).toBe(604800000);
	});

	it('throws InvalidDurationError on invalid formats', () => {
		const badInputs = ['5x', '', 'abc', '-1s', '1.5h', 'ms', 's5', '5S', '1H'];
		for (const input of badInputs) {
			expect(() => parseDuration(input), `Expected "${input}" to throw`).toThrow(InvalidDurationError);
		}
	});

	it('handles boundary values', () => {
		expect(parseDuration('0s')).toBe(0);
		expect(parseDuration('0ms')).toBe(0);
		expect(parseDuration('999d')).toBe(999 * 24 * 60 * 60 * 1000);
	});
});
