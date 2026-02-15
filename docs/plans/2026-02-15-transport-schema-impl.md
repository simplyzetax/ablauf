# Transport Schema Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce a constrained Zod subset (`TransportSchema`) that only exposes SuperJSON-compatible types, enforced at compile time via a callback in `defineWorkflow()` and at runtime via schema validation.

**Architecture:** New `serializable.ts` module in `packages/workflows/src/` containing the `TransportSchema` type, `t` runtime object, `validateSchema()` recursive walker, and `serializable()` wrapper. `defineWorkflow()` changes from accepting an options object to accepting a callback `(t: TransportSchema) => options`. `BaseWorkflow` users import `t` directly.

**Tech Stack:** TypeScript, Zod (schema introspection via `_def.typeName`), SuperJSON (the serialization layer this constrains to)

---

### Task 1: Add `INVALID_SCHEMA` Error Code and `InvalidSchemaError` Class

**Files:**
- Modify: `packages/workflows/src/errors.ts`

**Step 1: Add `INVALID_SCHEMA` to the `ErrorCode` union type**

In `packages/workflows/src/errors.ts`, add `'INVALID_SCHEMA'` to the `ErrorCode` type union:

```typescript
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
	| 'INTERNAL_ERROR'
	| 'INVALID_SCHEMA';
```

**Step 2: Add the catalog entry**

Add to `WORKFLOW_ERROR_CATALOG`:

```typescript
INVALID_SCHEMA: { status: 400, message: 'Schema contains unsupported types' },
```

**Step 3: Add the `InvalidSchemaError` class**

Add after the other error classes:

```typescript
/**
 * Thrown when a workflow schema uses Zod types that are not compatible with
 * SuperJSON serialization (e.g., `z.function()`, `z.promise()`, `z.symbol()`).
 *
 * Error code: `INVALID_SCHEMA` | HTTP status: `400`
 *
 * @example
 * ```ts
 * // This would throw InvalidSchemaError at workflow registration time:
 * defineWorkflow((t) => ({
 *   type: "bad",
 *   input: z.object({ cb: z.function() }), // smuggled past `t`
 *   run: async () => {},
 * }));
 * ```
 */
export class InvalidSchemaError extends WorkflowError {
	constructor(path: string, typeName: string) {
		super(
			createErrorInit(
				'INVALID_SCHEMA',
				'validation',
				`Unsupported Zod type "${typeName}" at path "${path}". Only SuperJSON-compatible types are allowed in workflow schemas. See: https://ablauf.dev/docs/workflows/transport-types`,
				{ path, typeName },
			),
		);
	}
}
```

**Step 4: Run type check**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/freetown-v2 && bun run check-types`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/workflows/src/errors.ts
git commit -m "feat: add InvalidSchemaError for unsupported Zod types"
```

---

### Task 2: Create `serializable.ts` — Core Module

**Files:**
- Create: `packages/workflows/src/serializable.ts`

**Step 1: Create the full `serializable.ts` module**

Create `packages/workflows/src/serializable.ts` with:

1. `ALLOWED_TYPES` set of `ZodFirstPartyTypeKind` values
2. `validateSchema(schema, path)` recursive walker
3. `TransportSchema` type — `Pick<typeof z, ...>` plus `url()`, `any()`, `unknown()`
4. `SerializableSchema<T>` branded type
5. `t` runtime object
6. `serializable()` wrapper function

```typescript
import { z } from 'zod';
import { InvalidSchemaError } from './errors';

// ── Allowed Zod type names ────────────────────────────────────────────

/**
 * Set of Zod internal type names that are compatible with SuperJSON serialization.
 * Used by {@link validateSchema} to recursively check schemas at registration time.
 */
const ALLOWED_TYPES = new Set([
	// Primitives
	'ZodString',
	'ZodNumber',
	'ZodBoolean',
	'ZodNull',
	'ZodUndefined',
	'ZodBigInt',
	// Rich types
	'ZodDate',
	'ZodMap',
	'ZodSet',
	// Structural
	'ZodObject',
	'ZodArray',
	'ZodTuple',
	'ZodRecord',
	// Combinators
	'ZodLiteral',
	'ZodEnum',
	'ZodNativeEnum',
	'ZodUnion',
	'ZodDiscriminatedUnion',
	'ZodIntersection',
	'ZodOptional',
	'ZodNullable',
	'ZodDefault',
	// Wrappers
	'ZodEffects',
	'ZodLazy',
	'ZodBranded',
	'ZodPipeline',
	// Escape hatches
	'ZodAny',
	'ZodUnknown',
]);

// ── Schema validator ──────────────────────────────────────────────────

/**
 * Recursively validates that a Zod schema only uses SuperJSON-compatible types.
 *
 * Walks the schema's internal `_def.typeName` tree and throws
 * {@link InvalidSchemaError} with the full path on the first unsupported type.
 *
 * @param schema - The Zod schema to validate.
 * @param path - Dot-separated path for error reporting (defaults to `"root"`).
 * @throws {@link InvalidSchemaError} If any node uses an unsupported Zod type.
 *
 * @internal
 */
export function validateSchema(schema: z.ZodType, path = 'root'): void {
	const def = schema._def as Record<string, unknown>;
	const typeName = def.typeName as string;

	if (!ALLOWED_TYPES.has(typeName)) {
		throw new InvalidSchemaError(path, typeName);
	}

	switch (typeName) {
		case 'ZodObject': {
			const shape = typeof def.shape === 'function' ? (def.shape as () => Record<string, z.ZodType>)() : (def.shape as Record<string, z.ZodType>);
			for (const [key, value] of Object.entries(shape)) {
				validateSchema(value, `${path}.${key}`);
			}
			break;
		}
		case 'ZodArray':
			validateSchema(def.type as z.ZodType, `${path}[]`);
			break;
		case 'ZodMap':
			validateSchema(def.keyType as z.ZodType, `${path}<key>`);
			validateSchema(def.valueType as z.ZodType, `${path}<value>`);
			break;
		case 'ZodSet':
			validateSchema(def.valueType as z.ZodType, `${path}<item>`);
			break;
		case 'ZodOptional':
		case 'ZodNullable':
		case 'ZodDefault':
		case 'ZodBranded':
			validateSchema(def.innerType as z.ZodType, path);
			break;
		case 'ZodUnion':
		case 'ZodDiscriminatedUnion': {
			const options = def.options as z.ZodType[];
			for (let i = 0; i < options.length; i++) {
				validateSchema(options[i], `${path}|${i}`);
			}
			break;
		}
		case 'ZodIntersection':
			validateSchema(def.left as z.ZodType, `${path}&left`);
			validateSchema(def.right as z.ZodType, `${path}&right`);
			break;
		case 'ZodTuple': {
			const items = def.items as z.ZodType[];
			for (let i = 0; i < items.length; i++) {
				validateSchema(items[i], `${path}[${i}]`);
			}
			if (def.rest) {
				validateSchema(def.rest as z.ZodType, `${path}[...rest]`);
			}
			break;
		}
		case 'ZodRecord':
			validateSchema(def.keyType as z.ZodType, `${path}{key}`);
			validateSchema(def.valueType as z.ZodType, `${path}{value}`);
			break;
		case 'ZodEffects':
			validateSchema(def.schema as z.ZodType, path);
			break;
		case 'ZodLazy':
			validateSchema((def.getter as () => z.ZodType)(), path);
			break;
		case 'ZodPipeline':
			validateSchema(def.in as z.ZodType, path);
			break;
		// Primitives, literals, enums, any, unknown — no children to recurse
	}
}

// ── Branded schema type ───────────────────────────────────────────────

declare const SERIALIZABLE_BRAND: unique symbol;

/**
 * A Zod schema that has been validated to only use SuperJSON-compatible types.
 *
 * Created by wrapping a standard Zod schema with {@link serializable}, or by
 * using the constrained {@link t} namespace inside a `defineWorkflow()` callback.
 *
 * @typeParam T - The inferred TypeScript type of the schema.
 */
export type SerializableSchema<T = unknown> = z.ZodType<T> & {
	[SERIALIZABLE_BRAND]: true;
};

// ── TransportSchema type ──────────────────────────────────────────────

/**
 * Constrained subset of Zod that only exposes types compatible with SuperJSON
 * serialization. This is the type of the `t` parameter in `defineWorkflow()` callbacks
 * and the exported `t` object for `BaseWorkflow` usage.
 *
 * **Why constrained?** All workflow data (payloads, events, SSE updates) is serialized
 * via SuperJSON for durable storage in SQLite and transport across Durable Object RPC
 * boundaries. Using unsupported types (functions, promises, symbols) would cause silent
 * runtime failures. This constrained namespace makes invalid types a compile error.
 *
 * @see {@link https://ablauf.dev/docs/workflows/transport-types | Supported Transport Types}
 */
export type TransportSchema = Pick<
	typeof z,
	// Primitives
	| 'string'
	| 'number'
	| 'boolean'
	| 'bigint'
	// Rich types
	| 'date'
	| 'map'
	| 'set'
	// Structural
	| 'object'
	| 'array'
	| 'tuple'
	| 'record'
	// Combinators
	| 'literal'
	| 'enum'
	| 'nativeEnum'
	| 'union'
	| 'discriminatedUnion'
	| 'intersection'
	| 'optional'
	| 'nullable'
	| 'lazy'
> & {
	/** Zod schema for `null` values. */
	null: typeof z.null;
	/** Zod schema for `undefined` values. */
	undefined: typeof z.undefined;

	/**
	 * Schema for `URL` objects. SuperJSON natively handles URL serialization.
	 *
	 * @example
	 * ```ts
	 * defineWorkflow((t) => ({
	 *   type: "fetch-page",
	 *   input: t.object({ endpoint: t.url() }),
	 *   run: async (step, payload) => {
	 *     // payload.endpoint is a URL instance
	 *   },
	 * }));
	 * ```
	 */
	url: () => z.ZodType<URL>;

	/**
	 * @deprecated WARNING: Bypasses transport type safety. The runtime value must be
	 * SuperJSON-compatible or serialization will fail silently. Prefer explicit types
	 * like `t.object()`, `t.string()`, `t.union()`, etc.
	 */
	any: typeof z.any;

	/**
	 * @deprecated WARNING: Bypasses transport type safety. The runtime value must be
	 * SuperJSON-compatible or serialization will fail silently. Prefer explicit types
	 * like `t.object()`, `t.string()`, `t.union()`, etc.
	 */
	unknown: typeof z.unknown;
};

// ── Allowed keys for Pick ─────────────────────────────────────────────

const ALLOWED_KEYS = [
	'string',
	'number',
	'boolean',
	'bigint',
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
] as const;

function pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
	const result = {} as Pick<T, K>;
	for (const key of keys) {
		result[key] = obj[key];
	}
	return result;
}

// ── Runtime `t` object ────────────────────────────────────────────────

/**
 * Constrained Zod namespace that only exposes SuperJSON-compatible types.
 *
 * Use this inside `defineWorkflow()` callbacks (where it's provided as the `t` parameter)
 * or import it directly for `BaseWorkflow` static properties.
 *
 * @example
 * ```ts
 * import { t, BaseWorkflow } from '@der-ablauf/workflows';
 *
 * class MyWorkflow extends BaseWorkflow<...> {
 *   static type = "my-workflow" as const;
 *   static inputSchema = t.object({ name: t.string(), createdAt: t.date() });
 * }
 * ```
 *
 * @see {@link TransportSchema} for the full list of available types.
 */
export const t: TransportSchema = {
	...pick(z, ALLOWED_KEYS),
	null: z.null,
	undefined: z.undefined,
	url: () => z.instanceof(URL),
	any: (...args: Parameters<typeof z.any>) => {
		console.warn(
			'[@der-ablauf/workflows] t.any() bypasses transport type safety. ' +
				'The actual runtime value must be SuperJSON-compatible or serialization will fail.',
		);
		return z.any(...args);
	},
	unknown: (...args: Parameters<typeof z.unknown>) => {
		console.warn(
			'[@der-ablauf/workflows] t.unknown() bypasses transport type safety. ' +
				'The actual runtime value must be SuperJSON-compatible or serialization will fail.',
		);
		return z.unknown(...args);
	},
} as TransportSchema;

// ── serializable() wrapper ────────────────────────────────────────────

/**
 * Validate that a Zod schema only uses SuperJSON-compatible types and brand it
 * for use in workflow definitions.
 *
 * Use this when you have a pre-existing Zod schema (e.g., shared across your app)
 * that you want to use as a workflow input, event, or SSE schema.
 *
 * @param schema - Any Zod schema to validate.
 * @returns The same schema, branded as {@link SerializableSchema}.
 * @throws {@link InvalidSchemaError} If the schema uses unsupported Zod types.
 *
 * @example
 * ```ts
 * import { serializable, BaseWorkflow } from '@der-ablauf/workflows';
 * import { z } from 'zod';
 *
 * // Reuse an existing Zod schema from elsewhere in your app
 * const userSchema = z.object({ name: z.string(), email: z.string() });
 *
 * class UserWorkflow extends BaseWorkflow<...> {
 *   static inputSchema = serializable(userSchema);
 * }
 * ```
 */
export function serializable<T>(schema: z.ZodType<T>): SerializableSchema<T> {
	validateSchema(schema);
	return schema as SerializableSchema<T>;
}
```

**Step 2: Run type check**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/freetown-v2 && bun run check-types`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/workflows/src/serializable.ts
git commit -m "feat: add TransportSchema constrained Zod subset for SuperJSON-safe types"
```

---

### Task 3: Export New Types from `index.ts`

**Files:**
- Modify: `packages/workflows/src/index.ts`

**Step 1: Add exports for `serializable.ts`**

Add a new section after the existing error exports:

```typescript
// Transport schema (SuperJSON-safe Zod subset)
export { t, serializable, validateSchema, type SerializableSchema, type TransportSchema } from './serializable';
```

**Step 2: Add `InvalidSchemaError` to the errors export block**

Add `InvalidSchemaError` to the existing errors export in `index.ts`.

**Step 3: Run type check**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/freetown-v2 && bun run check-types`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/workflows/src/index.ts
git commit -m "feat: export transport schema types and InvalidSchemaError"
```

---

### Task 4: Update `defineWorkflow()` to Accept Callback Pattern

**Files:**
- Modify: `packages/workflows/src/engine/define-workflow.ts`

**Step 1: Update `defineWorkflow` to accept both callback and options patterns**

Change the signature so `defineWorkflow` accepts a callback `(t: TransportSchema) => DefineWorkflowOptions<...>`. Import `t` and `validateSchema` from `../serializable`. Call `validateSchema()` on `input`, each event schema, and each SSE schema as a runtime safety net.

The function should:
1. Import `{ t, validateSchema }` from `'../serializable'`
2. Import `type { TransportSchema }` from `'../serializable'`
3. Accept `factory: (t: TransportSchema) => DefineWorkflowOptions<...>` as the parameter
4. Call `const options = factory(t)` to get the config
5. Call `validateSchema(options.input, 'input')` on the resolved input schema
6. Iterate `options.events` and call `validateSchema(schema, \`events.${key}\`)` for each
7. Iterate `options.sseUpdates` and call `validateSchema(schema, \`sseUpdates.${key}\`)` for each
8. Proceed with the existing class creation logic

Update the JSDoc examples to show the callback pattern. Update the `DefineWorkflowOptions` interface JSDoc to note schemas should use `t.*` methods.

**Step 2: Run type check**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/freetown-v2 && bun run check-types`
Expected: May have errors in example workflows that still use old API — that's expected, we fix those in Task 6.

**Step 3: Commit**

```bash
git add packages/workflows/src/engine/define-workflow.ts
git commit -m "feat: defineWorkflow accepts callback with constrained TransportSchema"
```

---

### Task 5: Add Runtime Validation to Workflow Registration

**Files:**
- Modify: `packages/workflows/src/engine/workflow-runner.ts` (the `createWorkflowRunner` factory)

**Step 1: Add schema validation at workflow registration time**

In the `createWorkflowRunner` function, after the workflow classes are registered in the map, iterate through each registered workflow and validate its schemas:

```typescript
import { validateSchema } from '../serializable';

// Inside createWorkflowRunner, after building the workflow map:
for (const [type, entry] of Object.entries(workflowMap)) {
	const WorkflowCls = Array.isArray(entry) ? entry[0] : entry;
	validateSchema(WorkflowCls.inputSchema, `${type}.input`);
	if (WorkflowCls.events) {
		for (const [eventName, schema] of Object.entries(WorkflowCls.events)) {
			validateSchema(schema as z.ZodType, `${type}.events.${eventName}`);
		}
	}
	if (WorkflowCls.sseUpdates) {
		for (const [updateName, schema] of Object.entries(WorkflowCls.sseUpdates)) {
			validateSchema(schema as z.ZodType, `${type}.sseUpdates.${updateName}`);
		}
	}
}
```

This catches `BaseWorkflow` subclasses that bypass `defineWorkflow`'s callback.

**Step 2: Run type check**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/freetown-v2 && bun run check-types`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/workflows/src/engine/workflow-runner.ts
git commit -m "feat: validate workflow schemas at registration time in createWorkflowRunner"
```

---

### Task 6: Migrate All Example Workflows to Callback Pattern

**Files:**
- Modify: `apps/worker/src/workflows/test-workflow.ts`
- Modify: `apps/worker/src/workflows/echo-workflow.ts`
- Modify: `apps/worker/src/workflows/failing-step-workflow.ts`
- Modify: `apps/worker/src/workflows/sse-workflow.ts`
- Modify: `apps/worker/src/workflows/duplicate-step-workflow.ts`
- Modify: `apps/worker/src/workflows/multi-step-workflow.ts`
- Modify: `apps/worker/src/workflows/replay-counter-workflow.ts`
- Modify: `apps/worker/src/workflows/backoff-config-workflow.ts`
- Modify: `apps/worker/src/workflows/no-schema-workflow.ts`
- Modify: `apps/worker/src/workflows/multi-event-workflow.ts`
- Modify: `apps/worker/src/workflows/benchmark-ablauf-workflow.ts`
- Modify: `apps/worker/src/workflows/oom-recovery-workflow.ts`
- Modify: `apps/worker/src/workflows/non-retriable-workflow.ts`
- Modify: `apps/worker/src/workflows/sleep-until-workflow.ts`

**Step 1: Migrate each workflow file**

For each workflow, change from the old pattern:

```typescript
import { z } from 'zod';
import { defineWorkflow } from '@der-ablauf/workflows';

export const MyWorkflow = defineWorkflow({
	type: 'my-workflow',
	input: z.object({ name: z.string() }),
	events: { approval: z.object({ approved: z.boolean() }) },
	run: async (step, payload) => { ... },
});
```

To the new callback pattern:

```typescript
import { defineWorkflow } from '@der-ablauf/workflows';

export const MyWorkflow = defineWorkflow((t) => ({
	type: 'my-workflow',
	input: t.object({ name: t.string() }),
	events: { approval: t.object({ approved: t.boolean() }) },
	run: async (step, payload) => { ... },
}));
```

Key changes per file:
- Remove `import { z } from 'zod'` (unless `z` is used for non-schema purposes like `z.infer`)
- Wrap the options object in `(t) => ({ ... })`
- Replace all `z.` calls in schemas with `t.`
- Keep `z.infer` type annotations if used — those still need `z` from zod

For `no-schema-workflow.ts`: if it uses `z.unknown()` as its input, use `t.unknown()` instead.

**Step 2: Run type check**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/freetown-v2 && bun run check-types`
Expected: PASS

**Step 3: Run all tests**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/freetown-v2 && bun run test`
Expected: All existing tests PASS

**Step 4: Commit**

```bash
git add apps/worker/src/workflows/
git commit -m "refactor: migrate all example workflows to defineWorkflow callback pattern"
```

---

### Task 7: Write Tests for `validateSchema()` and `serializable()`

**Files:**
- Create: `apps/worker/src/__tests__/serializable.test.ts`

**Step 1: Write the test file**

Create `apps/worker/src/__tests__/serializable.test.ts` with these test groups:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { t, serializable, validateSchema, InvalidSchemaError } from '@der-ablauf/workflows';

describe('validateSchema', () => {
	describe('allowed primitive types', () => {
		it.each([
			['string', z.string()],
			['number', z.number()],
			['boolean', z.boolean()],
			['null', z.null()],
			['undefined', z.undefined()],
			['bigint', z.bigint()],
			['date', z.date()],
			['any', z.any()],
			['unknown', z.unknown()],
		])('allows %s', (_name, schema) => {
			expect(() => validateSchema(schema)).not.toThrow();
		});
	});

	describe('allowed structural types', () => {
		it('allows object', () => {
			expect(() => validateSchema(z.object({ a: z.string() }))).not.toThrow();
		});

		it('allows array', () => {
			expect(() => validateSchema(z.array(z.number()))).not.toThrow();
		});

		it('allows map', () => {
			expect(() => validateSchema(z.map(z.string(), z.number()))).not.toThrow();
		});

		it('allows set', () => {
			expect(() => validateSchema(z.set(z.string()))).not.toThrow();
		});

		it('allows tuple', () => {
			expect(() => validateSchema(z.tuple([z.string(), z.number()]))).not.toThrow();
		});

		it('allows record', () => {
			expect(() => validateSchema(z.record(z.string(), z.number()))).not.toThrow();
		});
	});

	describe('allowed combinator types', () => {
		it('allows literal', () => {
			expect(() => validateSchema(z.literal('hello'))).not.toThrow();
		});

		it('allows enum', () => {
			expect(() => validateSchema(z.enum(['a', 'b']))).not.toThrow();
		});

		it('allows union', () => {
			expect(() => validateSchema(z.union([z.string(), z.number()]))).not.toThrow();
		});

		it('allows discriminatedUnion', () => {
			expect(() =>
				validateSchema(
					z.discriminatedUnion('type', [
						z.object({ type: z.literal('a'), value: z.string() }),
						z.object({ type: z.literal('b'), value: z.number() }),
					]),
				),
			).not.toThrow();
		});

		it('allows intersection', () => {
			expect(() => validateSchema(z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })))).not.toThrow();
		});

		it('allows optional', () => {
			expect(() => validateSchema(z.string().optional())).not.toThrow();
		});

		it('allows nullable', () => {
			expect(() => validateSchema(z.string().nullable())).not.toThrow();
		});

		it('allows default', () => {
			expect(() => validateSchema(z.string().default('hello'))).not.toThrow();
		});

		it('allows lazy', () => {
			expect(() => validateSchema(z.lazy(() => z.string()))).not.toThrow();
		});

		it('allows effects (transform/refine)', () => {
			expect(() => validateSchema(z.string().transform((s) => s.toUpperCase()))).not.toThrow();
		});
	});

	describe('deeply nested schemas', () => {
		it('validates deeply nested objects', () => {
			const schema = z.object({
				user: z.object({
					profile: z.object({
						name: z.string(),
						tags: z.array(z.string()),
						metadata: z.map(z.string(), z.date()),
					}),
				}),
			});
			expect(() => validateSchema(schema)).not.toThrow();
		});

		it('validates array of objects with maps', () => {
			const schema = z.array(
				z.object({
					id: z.string(),
					data: z.map(z.string(), z.set(z.number())),
				}),
			);
			expect(() => validateSchema(schema)).not.toThrow();
		});
	});

	describe('unsupported types throw InvalidSchemaError', () => {
		it('rejects function', () => {
			expect(() => validateSchema(z.function())).toThrow(InvalidSchemaError);
		});

		it('rejects promise', () => {
			expect(() => validateSchema(z.promise(z.string()))).toThrow(InvalidSchemaError);
		});

		it('rejects symbol', () => {
			expect(() => validateSchema(z.symbol())).toThrow(InvalidSchemaError);
		});

		it('rejects void', () => {
			expect(() => validateSchema(z.void())).toThrow(InvalidSchemaError);
		});

		it('rejects never', () => {
			expect(() => validateSchema(z.never())).toThrow(InvalidSchemaError);
		});

		it('rejects instanceof (non-URL)', () => {
			expect(() => validateSchema(z.instanceof(RegExp))).toThrow(InvalidSchemaError);
		});
	});

	describe('error paths are correct', () => {
		it('reports root path for top-level error', () => {
			try {
				validateSchema(z.function());
				expect.unreachable('should have thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(InvalidSchemaError);
				expect((e as InvalidSchemaError).details?.path).toBe('root');
			}
		});

		it('reports nested object path', () => {
			try {
				validateSchema(z.object({ a: z.object({ b: z.function() }) }));
				expect.unreachable('should have thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(InvalidSchemaError);
				expect((e as InvalidSchemaError).details?.path).toBe('root.a.b');
			}
		});

		it('reports array path', () => {
			try {
				validateSchema(z.array(z.function()));
				expect.unreachable('should have thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(InvalidSchemaError);
				expect((e as InvalidSchemaError).details?.path).toBe('root[]');
			}
		});

		it('reports map value path', () => {
			try {
				validateSchema(z.map(z.string(), z.function()));
				expect.unreachable('should have thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(InvalidSchemaError);
				expect((e as InvalidSchemaError).details?.path).toBe('root<value>');
			}
		});

		it('reports union option path', () => {
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

describe('t namespace', () => {
	it('exposes all allowed Zod methods', () => {
		expect(typeof t.string).toBe('function');
		expect(typeof t.number).toBe('function');
		expect(typeof t.boolean).toBe('function');
		expect(typeof t.date).toBe('function');
		expect(typeof t.bigint).toBe('function');
		expect(typeof t.object).toBe('function');
		expect(typeof t.array).toBe('function');
		expect(typeof t.map).toBe('function');
		expect(typeof t.set).toBe('function');
		expect(typeof t.tuple).toBe('function');
		expect(typeof t.record).toBe('function');
		expect(typeof t.literal).toBe('function');
		expect(typeof t.enum).toBe('function');
		expect(typeof t.union).toBe('function');
		expect(typeof t.optional).toBe('function');
		expect(typeof t.nullable).toBe('function');
		expect(typeof t.lazy).toBe('function');
		expect(typeof t.url).toBe('function');
		expect(typeof t.any).toBe('function');
		expect(typeof t.unknown).toBe('function');
	});

	it('t.url() creates a URL schema', () => {
		const schema = t.url();
		expect(schema.parse(new URL('https://example.com'))).toBeInstanceOf(URL);
		expect(() => schema.parse('not a url')).toThrow();
	});

	it('t.any() logs a warning', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		t.any();
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('t.any()'));
		warnSpy.mockRestore();
	});

	it('t.unknown() logs a warning', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		t.unknown();
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('t.unknown()'));
		warnSpy.mockRestore();
	});
});

describe('serializable()', () => {
	it('returns the same schema branded', () => {
		const schema = z.object({ name: z.string() });
		const branded = serializable(schema);
		expect(branded).toBe(schema);
	});

	it('throws on unsupported types', () => {
		expect(() => serializable(z.object({ fn: z.function() }))).toThrow(InvalidSchemaError);
	});
});
```

**Step 2: Run tests to verify they pass**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/freetown-v2 && bun run test`
Expected: All tests PASS (new + existing)

**Step 3: Commit**

```bash
git add apps/worker/src/__tests__/serializable.test.ts
git commit -m "test: add comprehensive tests for validateSchema, t namespace, and serializable()"
```

---

### Task 8: Write `defineWorkflow` Callback Integration Test

**Files:**
- Modify: `apps/worker/src/__tests__/serializable.test.ts`

**Step 1: Add integration tests**

Add a new `describe` block to `serializable.test.ts`:

```typescript
import { defineWorkflow } from '@der-ablauf/workflows';

describe('defineWorkflow callback integration', () => {
	it('accepts a callback with t parameter', () => {
		const MyWorkflow = defineWorkflow((t) => ({
			type: 'test-serializable',
			input: t.object({ name: t.string(), createdAt: t.date() }),
			run: async (step, payload) => {
				return { greeting: `Hello, ${payload.name}!` };
			},
		}));

		expect(MyWorkflow.type).toBe('test-serializable');
	});

	it('accepts callback with events and sseUpdates', () => {
		const MyWorkflow = defineWorkflow((t) => ({
			type: 'test-full',
			input: t.object({ id: t.string() }),
			events: {
				approved: t.object({ by: t.string() }),
			},
			sseUpdates: {
				progress: t.object({ percent: t.number() }),
			},
			run: async (step, payload, sse) => {
				return { done: true };
			},
		}));

		expect(MyWorkflow.type).toBe('test-full');
	});

	it('rejects schemas with unsupported types at registration', () => {
		expect(() =>
			defineWorkflow((t) => ({
				type: 'test-bad',
				// Bypass t by using z directly
				input: z.object({ fn: z.function() }),
				run: async () => ({}),
			})),
		).toThrow(InvalidSchemaError);
	});

	it('rejects unsupported event schemas at registration', () => {
		expect(() =>
			defineWorkflow((t) => ({
				type: 'test-bad-event',
				input: t.object({ id: t.string() }),
				events: {
					bad: z.object({ fn: z.function() }),
				},
				run: async () => ({}),
			})),
		).toThrow(InvalidSchemaError);
	});
});
```

**Step 2: Run tests**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/freetown-v2 && bun run test`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add apps/worker/src/__tests__/serializable.test.ts
git commit -m "test: add defineWorkflow callback integration tests"
```

---

### Task 9: Update Documentation — Functional API Page

**Files:**
- Modify: `apps/docs/content/docs/workflows/functional.mdx`

**Step 1: Update the functional API docs**

Update all code examples from the old pattern to the new callback pattern. Key changes:
- Replace `import { z } from 'zod'` with just `import { defineWorkflow } from '@der-ablauf/workflows'`
- Show `defineWorkflow((t) => ({...}))` pattern
- Replace `z.object()`, `z.string()` etc. with `t.object()`, `t.string()`
- Update the "Configuration Fields" section to note that schemas should use `t.*` methods
- Add a note about the `t` parameter and link to the transport types page
- Mention `serializable()` as an alternative for pre-existing schemas

**Step 2: Commit**

```bash
git add apps/docs/content/docs/workflows/functional.mdx
git commit -m "docs: update functional API docs for defineWorkflow callback pattern"
```

---

### Task 10: Update Documentation — Class-based API Page

**Files:**
- Modify: `apps/docs/content/docs/workflows/class-based.mdx`

**Step 1: Update the class-based API docs**

Update all code examples to use `t` instead of `z` for schemas:
- Add `import { t } from '@der-ablauf/workflows'` alongside `BaseWorkflow`
- Replace `z.object()`, `z.string()` etc. with `t.object()`, `t.string()` in static properties
- Keep `z.infer` for type annotations (those still need `z` from zod)
- Add a note about using `serializable()` for pre-existing Zod schemas
- Link to transport types page

**Step 2: Commit**

```bash
git add apps/docs/content/docs/workflows/class-based.mdx
git commit -m "docs: update class-based API docs to use t namespace"
```

---

### Task 11: Create New Documentation Page — Supported Transport Types

**Files:**
- Create: `apps/docs/content/docs/workflows/transport-types.mdx`

**Step 1: Create the transport types reference page**

Create a new doc page that covers:
- Why the constraint exists (SuperJSON + SQLite)
- Full list of supported types with examples
- The `t` namespace API reference
- `serializable()` function reference
- Warning callout for `t.any()` and `t.unknown()`
- Explicitly excluded types with rationale
- Migration guide from plain `z.` to `t.`

**Step 2: Commit**

```bash
git add apps/docs/content/docs/workflows/transport-types.mdx
git commit -m "docs: add Supported Transport Types reference page"
```

---

### Task 12: Update API Reference Page

**Files:**
- Modify: `apps/docs/content/docs/server/api-reference.mdx`

**Step 1: Add `InvalidSchemaError` to the error table and add `TransportSchema` section**

Add `InvalidSchemaError` to the error classes table:

```
| `InvalidSchemaError`         | `INVALID_SCHEMA`          | 400    | validation |
```

Add a new section for the `t` namespace and `serializable()` function, linking to the transport types page.

**Step 2: Commit**

```bash
git add apps/docs/content/docs/server/api-reference.mdx
git commit -m "docs: add InvalidSchemaError and TransportSchema to API reference"
```

---

### Task 13: Final Verification

**Step 1: Run type check**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/freetown-v2 && bun run check-types`
Expected: PASS

**Step 2: Run all tests**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/freetown-v2 && bun run test`
Expected: All tests PASS

**Step 3: Verify no regressions**

Check that all existing test files still pass without modification (other than workflow migration in Task 6).
