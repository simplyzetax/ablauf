import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { t, serializable, validateSchema, InvalidSchemaError, defineWorkflow } from '@der-ablauf/workflows';

// ---------------------------------------------------------------------------
// validateSchema() — allowed primitive types
// ---------------------------------------------------------------------------

describe('validateSchema', () => {
	describe('allowed primitive types pass validation', () => {
		const primitives = [
			['z.string()', z.string()],
			['z.number()', z.number()],
			['z.boolean()', z.boolean()],
			['z.null()', z.null()],
			['z.undefined()', z.undefined()],
			['z.bigint()', z.bigint()],
			['z.date()', z.date()],
			['z.any()', z.any()],
			['z.unknown()', z.unknown()],
		] as const;

		for (const [label, schema] of primitives) {
			it(`${label} passes`, () => {
				expect(() => validateSchema(schema)).not.toThrow();
			});
		}
	});

	// -----------------------------------------------------------------------
	// Allowed structural types
	// -----------------------------------------------------------------------

	describe('allowed structural types pass validation', () => {
		it('z.object({ a: z.string() })', () => {
			expect(() => validateSchema(z.object({ a: z.string() }))).not.toThrow();
		});

		it('z.array(z.number())', () => {
			expect(() => validateSchema(z.array(z.number()))).not.toThrow();
		});

		it('z.map(z.string(), z.number())', () => {
			expect(() => validateSchema(z.map(z.string(), z.number()))).not.toThrow();
		});

		it('z.set(z.string())', () => {
			expect(() => validateSchema(z.set(z.string()))).not.toThrow();
		});

		it('z.tuple([z.string(), z.number()])', () => {
			expect(() => validateSchema(z.tuple([z.string(), z.number()]))).not.toThrow();
		});

		it('z.record(z.string(), z.number())', () => {
			expect(() => validateSchema(z.record(z.string(), z.number()))).not.toThrow();
		});
	});

	// -----------------------------------------------------------------------
	// Allowed combinator types
	// -----------------------------------------------------------------------

	describe('allowed combinator types pass validation', () => {
		it('z.literal("hello")', () => {
			expect(() => validateSchema(z.literal('hello'))).not.toThrow();
		});

		it('z.enum(["a", "b"])', () => {
			expect(() => validateSchema(z.enum(['a', 'b']))).not.toThrow();
		});

		it('z.union([z.string(), z.number()])', () => {
			expect(() => validateSchema(z.union([z.string(), z.number()]))).not.toThrow();
		});

		it('z.discriminatedUnion(...)', () => {
			expect(() =>
				validateSchema(
					z.discriminatedUnion('type', [
						z.object({ type: z.literal('a'), value: z.string() }),
						z.object({ type: z.literal('b'), value: z.number() }),
					]),
				),
			).not.toThrow();
		});

		it('z.intersection(...)', () => {
			expect(() => validateSchema(z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })))).not.toThrow();
		});

		it('z.string().optional()', () => {
			expect(() => validateSchema(z.string().optional())).not.toThrow();
		});

		it('z.string().nullable()', () => {
			expect(() => validateSchema(z.string().nullable())).not.toThrow();
		});

		it('z.string().default("x")', () => {
			expect(() => validateSchema(z.string().default('x'))).not.toThrow();
		});

		it('z.lazy(() => z.string())', () => {
			expect(() => validateSchema(z.lazy(() => z.string()))).not.toThrow();
		});

		it('z.string().pipe(z.string())', () => {
			expect(() => validateSchema(z.string().pipe(z.string()))).not.toThrow();
		});
	});

	// -----------------------------------------------------------------------
	// Deeply nested schemas pass
	// -----------------------------------------------------------------------

	describe('deeply nested schemas pass', () => {
		it('object with nested objects, arrays, maps, sets, dates', () => {
			const schema = z.object({
				user: z.object({
					name: z.string(),
					tags: z.array(z.string()),
					metadata: z.map(z.string(), z.number()),
					roles: z.set(z.string()),
					createdAt: z.date(),
					profile: z.object({
						bio: z.string().optional(),
						scores: z.array(z.number()),
					}),
				}),
			});

			expect(() => validateSchema(schema)).not.toThrow();
		});
	});

	// -----------------------------------------------------------------------
	// Unsupported types throw InvalidSchemaError
	// -----------------------------------------------------------------------

	describe('unsupported types throw InvalidSchemaError', () => {
		const unsupported = [
			['z.function()', z.function()],
			['z.promise(z.string())', z.promise(z.string())],
			['z.symbol()', z.symbol()],
			['z.void()', z.void()],
			['z.never()', z.never()],
		] as const;

		for (const [label, schema] of unsupported) {
			it(`${label} throws InvalidSchemaError`, () => {
				expect(() => validateSchema(schema)).toThrow(InvalidSchemaError);
			});
		}
	});

	// -----------------------------------------------------------------------
	// Error paths are correct
	// -----------------------------------------------------------------------

	describe('error paths are correct', () => {
		it('root path for top-level unsupported type', () => {
			try {
				validateSchema(z.function());
				expect.unreachable('should have thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(InvalidSchemaError);
				expect((e as InvalidSchemaError).details?.path).toBe('root');
			}
		});

		it('nested object path: root.a.b', () => {
			try {
				validateSchema(z.object({ a: z.object({ b: z.function() }) }));
				expect.unreachable('should have thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(InvalidSchemaError);
				expect((e as InvalidSchemaError).details?.path).toBe('root.a.b');
			}
		});

		it('array path: root[]', () => {
			try {
				validateSchema(z.array(z.function()));
				expect.unreachable('should have thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(InvalidSchemaError);
				expect((e as InvalidSchemaError).details?.path).toBe('root[]');
			}
		});

		it('map value path: root<value>', () => {
			try {
				validateSchema(z.map(z.string(), z.function()));
				expect.unreachable('should have thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(InvalidSchemaError);
				expect((e as InvalidSchemaError).details?.path).toBe('root<value>');
			}
		});

		it('union option path: root|1', () => {
			try {
				validateSchema(z.union([z.string(), z.function()]));
				expect.unreachable('should have thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(InvalidSchemaError);
				expect((e as InvalidSchemaError).details?.path).toBe('root|1');
			}
		});
	});
});

// ---------------------------------------------------------------------------
// t namespace
// ---------------------------------------------------------------------------

describe('t namespace', () => {
	describe('all expected methods exist', () => {
		const expectedMethods = [
			'string',
			'number',
			'boolean',
			'bigint',
			'null',
			'undefined',
			'date',
			'map',
			'set',
			'object',
			'array',
			'tuple',
			'record',
			'literal',
			'enum',
			'nativeEnum',
			'union',
			'discriminatedUnion',
			'intersection',
			'optional',
			'nullable',
			'lazy',
			'url',
			'any',
			'unknown',
		];

		for (const method of expectedMethods) {
			it(`t.${method} exists and is a function`, () => {
				expect(typeof (t as Record<string, unknown>)[method]).toBe('function');
			});
		}
	});

	it('t.url() creates a URL schema that accepts URL instances', () => {
		const schema = t.url();
		const result = schema.safeParse(new URL('https://example.com'));
		expect(result.success).toBe(true);
	});

	it('t.url() rejects plain strings', () => {
		const schema = t.url();
		const result = schema.safeParse('https://example.com');
		expect(result.success).toBe(false);
	});

	it('t.any() logs a console.warn', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		t.any();
		expect(warnSpy).toHaveBeenCalledOnce();
		expect(warnSpy.mock.calls[0][0]).toContain('t.any()');
		warnSpy.mockRestore();
	});

	it('t.unknown() logs a console.warn', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		t.unknown();
		expect(warnSpy).toHaveBeenCalledOnce();
		expect(warnSpy.mock.calls[0][0]).toContain('t.unknown()');
		warnSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// serializable()
// ---------------------------------------------------------------------------

describe('serializable', () => {
	it('returns the same schema (branded)', () => {
		const schema = z.object({ name: z.string() });
		const branded = serializable(schema);
		expect(branded).toBe(schema);
	});

	it('throws InvalidSchemaError on unsupported types', () => {
		expect(() => serializable(z.object({ cb: z.function() }))).toThrow(InvalidSchemaError);
	});
});

// ---------------------------------------------------------------------------
// defineWorkflow callback integration
// ---------------------------------------------------------------------------

describe('defineWorkflow callback integration', () => {
	it('accepts callback with t and creates correct workflow class', () => {
		const MyWorkflow = defineWorkflow((t) => ({
			type: 'test-serializable' as const,
			input: t.object({ name: t.string(), createdAt: t.date() }),
			run: async (step, payload) => {
				return { greeting: `Hello, ${payload.name}!` };
			},
		}));

		expect(MyWorkflow.type).toBe('test-serializable');
	});

	it('accepts callback with events and sseUpdates', () => {
		const MyWorkflow = defineWorkflow((t) => ({
			type: 'test-with-events' as const,
			input: t.object({ name: t.string() }),
			events: {
				approval: t.object({ approved: t.boolean() }),
			},
			sseUpdates: {
				progress: t.object({ percent: t.number() }),
			},
			run: async (step, payload, sse) => {
				sse.sendEvent('progress', { percent: 50 });
				const approval = await step.waitForEvent('approval');
				return { approved: approval.approved };
			},
		}));

		expect(MyWorkflow.type).toBe('test-with-events');
	});

	it('rejects schemas with unsupported types at registration', () => {
		expect(() =>
			defineWorkflow((_t) => ({
				type: 'test-bad' as const,
				input: z.object({ fn: z.function() }), // smuggled past t
				run: async () => ({}),
			})),
		).toThrow(InvalidSchemaError);
	});

	it('rejects unsupported event schemas at registration', () => {
		expect(() =>
			defineWorkflow((_t) => ({
				type: 'test-bad-event' as const,
				input: t.object({ name: t.string() }),
				events: {
					badEvent: z.object({ cb: z.function() }), // smuggled past t
				},
				run: async () => ({}),
			})),
		).toThrow(InvalidSchemaError);
	});
});
