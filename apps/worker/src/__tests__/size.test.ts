import { describe, it, expect } from 'vitest';
import { parseSize, InvalidSizeError } from '@der-ablauf/workflows';

describe('parseSize', () => {
	it('parses all valid size formats', () => {
		expect(parseSize('100b')).toBe(100);
		expect(parseSize('512kb')).toBe(512 * 1024);
		expect(parseSize('64mb')).toBe(64 * 1024 * 1024);
		expect(parseSize('1gb')).toBe(1024 * 1024 * 1024);
	});

	it('throws InvalidSizeError on invalid formats', () => {
		const badInputs = ['5x', '', 'abc', '-1mb', '1.5gb', 'mb', 'b5', '5MB', '1GB', '64 MB'];
		for (const input of badInputs) {
			expect(() => parseSize(input), `Expected "${input}" to throw`).toThrow(InvalidSizeError);
		}
	});

	it('handles boundary values', () => {
		expect(parseSize('0b')).toBe(0);
		expect(parseSize('0mb')).toBe(0);
		expect(parseSize('999gb')).toBe(999 * 1024 * 1024 * 1024);
	});
});
