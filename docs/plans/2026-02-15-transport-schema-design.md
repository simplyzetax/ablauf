# Transport Schema — SuperJSON-Safe Zod Types

## Summary

Introduce a constrained Zod subset (`TransportSchema`) that only exposes types compatible with SuperJSON serialization. This ensures workflow data that crosses transport boundaries (payloads, events, SSE updates) is guaranteed to serialize/deserialize correctly through SuperJSON and SQLite storage.

## Motivation

Currently, workflow authors can use any Zod schema for `input`, `events`, and `sseUpdates`. If a schema produces values that SuperJSON can't handle (e.g., functions, promises, symbols), serialization fails silently at runtime. There's no compile-time or registration-time feedback.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Goal** | Type safety + docs + runtime validation | Full protection at every layer |
| **Supported types** | Conservative + URL | `RegExp`, `Error`, `NaN`, `Infinity` are unusual for workflow data |
| **API surface** | Constrained `t` namespace via callback | Users can't even see unsupported types in autocomplete |
| **Enforcement scope** | Schema-defined boundaries only | `input`, `events`, `sseUpdates` — not `step.do<T>` results |
| **Type strictness** | Compile error for unsupported types | `defineWorkflow` callback supplies constrained `t`; `BaseWorkflow` imports `t` directly |
| **`any`/`unknown`** | Allowed with warnings | `@deprecated` JSDoc + `console.warn` at schema creation time |

## Supported Types

### Primitives
- `t.string()` — `string`
- `t.number()` — `number`
- `t.boolean()` — `boolean`
- `t.null()` — `null`
- `t.undefined()` — `undefined`
- `t.bigint()` — `bigint`

### Rich Types
- `t.date()` — `Date`
- `t.map(key, value)` — `Map<K, V>`
- `t.set(value)` — `Set<T>`
- `t.url()` — `URL` (custom helper, implemented via `z.instanceof(URL)`)

### Structural
- `t.object(shape)` — plain objects
- `t.array(item)` — arrays
- `t.tuple(items)` — tuples
- `t.record(key, value)` — records

### Combinators
- `t.literal(value)` — literal types
- `t.enum(values)` — string enums
- `t.nativeEnum(enum)` — TypeScript enums
- `t.union(options)` — union types
- `t.discriminatedUnion(discriminator, options)` — discriminated unions
- `t.intersection(left, right)` — intersection types
- `t.optional()` — optional wrapper
- `t.nullable()` — nullable wrapper
- `t.lazy(getter)` — recursive schemas

### Escape Hatches (with warnings)
- `t.any()` — bypasses type safety, runtime value must be SuperJSON-compatible
- `t.unknown()` — bypasses type safety, runtime value must be SuperJSON-compatible

### Explicitly Excluded
- `z.function()` — not serializable
- `z.promise()` — not serializable
- `z.instanceof()` — not serializable (except `URL` via `t.url()`)
- `z.symbol()` — not supported by SuperJSON
- `z.void()` — not meaningful for transport
- `z.never()` — not meaningful for transport

## Architecture

### New File: `packages/workflows/src/serializable.ts`

This file contains all transport schema logic:

```
serializable.ts
├── TransportSchema type      — Pick<typeof z, ...> + url() + any() + unknown()
├── SerializableSchema<T>     — branded z.ZodType for type enforcement
├── t object                  — runtime constrained Zod namespace
├── serializable(schema)      — wraps + validates existing Zod schemas
├── validateSchema(schema)    — recursive schema walker
├── ALLOWED_TYPES             — Set of allowed ZodFirstPartyTypeKind values
└── url() helper              — z.instanceof(URL) with special-case validation
```

### TransportSchema Type

```typescript
export type TransportSchema = Pick<typeof z,
  | 'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'bigint'
  | 'date' | 'map' | 'set'
  | 'object' | 'array' | 'tuple' | 'record'
  | 'literal' | 'enum' | 'nativeEnum'
  | 'union' | 'discriminatedUnion' | 'intersection'
  | 'optional' | 'nullable' | 'lazy'
> & {
  /** URL object — serialized/deserialized by SuperJSON */
  url: () => z.ZodType<URL>;

  /**
   * @deprecated WARNING: Bypasses transport type safety. The runtime value
   * must be SuperJSON-compatible or serialization will fail silently.
   * Prefer explicit types like t.object(), t.string(), t.union(), etc.
   */
  any: typeof z.any;

  /**
   * @deprecated WARNING: Bypasses transport type safety. The runtime value
   * must be SuperJSON-compatible or serialization will fail silently.
   * Prefer explicit types like t.object(), t.string(), t.union(), etc.
   */
  unknown: typeof z.unknown;
};
```

### Runtime `t` Object

```typescript
const t: TransportSchema = {
  // Spread all allowed Zod methods
  ...pick(z, ALLOWED_KEYS),

  // Custom URL helper
  url: () => z.instanceof(URL),

  // Escape hatches with console warnings
  any: () => {
    console.warn(
      "[@der-ablauf/workflows] t.any() bypasses transport type safety. " +
      "The actual runtime value must be SuperJSON-compatible or serialization will fail."
    );
    return z.any();
  },
  unknown: () => {
    console.warn(
      "[@der-ablauf/workflows] t.unknown() bypasses transport type safety. " +
      "The actual runtime value must be SuperJSON-compatible or serialization will fail."
    );
    return z.unknown();
  },
};
```

### Branded Schema Type

```typescript
declare const SERIALIZABLE_BRAND: unique symbol;

export type SerializableSchema<T = unknown> = z.ZodType<T> & {
  [SERIALIZABLE_BRAND]: true;
};
```

### `serializable()` Wrapper

For users with pre-existing Zod schemas or `BaseWorkflow` usage:

```typescript
export function serializable<T>(schema: z.ZodType<T>): SerializableSchema<T> {
  validateSchema(schema);
  return schema as SerializableSchema<T>;
}
```

### Schema Validator

Recursively walks a Zod schema's `_def.typeName` tree, throwing `InvalidSchemaError` with the full path on unsupported types:

```typescript
const ALLOWED_TYPES = new Set([
  "ZodString", "ZodNumber", "ZodBoolean", "ZodNull", "ZodUndefined",
  "ZodBigInt", "ZodDate", "ZodMap", "ZodSet",
  "ZodObject", "ZodArray", "ZodTuple", "ZodRecord",
  "ZodLiteral", "ZodEnum", "ZodNativeEnum",
  "ZodUnion", "ZodDiscriminatedUnion", "ZodIntersection",
  "ZodOptional", "ZodNullable", "ZodDefault", "ZodEffects",
  "ZodLazy", "ZodBranded", "ZodPipeline",
  "ZodAny", "ZodUnknown",
]);

function validateSchema(schema: z.ZodType, path = "root"): void {
  const typeName = schema._def.typeName as string;

  if (!ALLOWED_TYPES.has(typeName)) {
    throw new InvalidSchemaError(path, typeName);
  }

  // Recurse into children based on type
  // (ZodObject → shape, ZodArray → type, ZodMap → keyType/valueType, etc.)
}
```

## Integration Points

### `defineWorkflow()` — Callback Pattern

```typescript
export function defineWorkflow<...>(
  factory: (t: TransportSchema) => {
    type: Type;
    input: z.ZodType<Input>;
    events?: Record<string, z.ZodType>;
    sseUpdates?: Record<string, z.ZodType>;
    run: (...) => Promise<Result>;
  }
): WorkflowDefinition<...> {
  const config = factory(t);       // supply constrained t
  validateSchema(config.input);     // runtime safety net
  if (config.events) {
    for (const [key, schema] of Object.entries(config.events)) {
      validateSchema(schema, `events.${key}`);
    }
  }
  if (config.sseUpdates) {
    for (const [key, schema] of Object.entries(config.sseUpdates)) {
      validateSchema(schema, `sseUpdates.${key}`);
    }
  }
  // ... rest of defineWorkflow logic
}
```

### `BaseWorkflow` — Direct Import

```typescript
import { t, BaseWorkflow } from "@der-ablauf/workflows";

class OrderWorkflow extends BaseWorkflow<...> {
  static type = "order" as const;
  static inputSchema = t.object({ items: t.array(t.string()), placedAt: t.date() });
  static events = { paid: t.object({ amount: t.number() }) };
}
```

Runtime validation runs when the engine registers the workflow class.

### `step.do<T>()` — Unconstrained

Step results remain unconstrained (no schema required). Documented as "must return SuperJSON-compatible values" with a link to the supported types list.

## Error Handling

### New Error Class

```typescript
export class InvalidSchemaError extends WorkflowError {
  constructor(path: string, typeName: string) {
    super({
      code: "invalid_schema",
      status: 400,
      source: "validation",
      message: `Unsupported Zod type "${typeName}" at path "${path}". Only SuperJSON-compatible types are allowed in workflow schemas.`,
    });
  }
}
```

Add `"invalid_schema"` to the `ErrorCode` union type and `VALID_ERROR_CODES` array.

## Three Layers of Protection

1. **Autocomplete** — IDE only shows valid types on `t` (unsupported methods don't exist on the type)
2. **Compile error** — calling `t.function()` etc. fails typecheck ("Property does not exist")
3. **Runtime validation** — `validateSchema()` catches bypass attempts (casting, external schemas) at workflow registration time

## Public API Exports

Add to `packages/workflows/src/index.ts`:

```typescript
export { t, serializable, type SerializableSchema, type TransportSchema } from "./serializable";
export { InvalidSchemaError } from "./errors";
```

## Testing Plan

New test file: `apps/worker/src/__tests__/serializable.test.ts`

1. **Each allowed type passes validation** — `t.string()`, `t.date()`, `t.map(t.string(), t.number())`, `t.url()`, etc.
2. **Nested schemas pass** — deeply nested objects/arrays with mixed allowed types
3. **Unsupported types throw `InvalidSchemaError`** — `z.function()`, `z.promise()`, `z.instanceof(RegExp)`, `z.symbol()`, `z.void()`, `z.never()`
4. **Error path is correct** — `z.object({ a: z.object({ b: z.function() }) })` reports path `"root.a.b"`
5. **`t.url()` works** — validates and round-trips through SuperJSON
6. **`t.any()` / `t.unknown()` pass with warnings** — validation succeeds, console.warn is emitted
7. **`defineWorkflow` callback** — e2e test that a workflow defined with `t` via the callback works through full execution cycle
8. **`defineWorkflow` rejects bad schemas at registration** — smuggled `z.function()` throws `InvalidSchemaError` immediately

## Documentation Updates

In `apps/docs/`:

- **API reference** — document `t` namespace with all available methods and examples
- **Guide: "Supported Transport Types"** — explain why the constraint exists (SuperJSON + SQLite storage), list all types with examples
- **Admonition for `t.any()` / `t.unknown()`** — warning callout that these bypass safety and shift responsibility to the developer
- **Migration note** — existing workflows using plain `z.` need to switch to `t.` (in `defineWorkflow` callback) or wrap with `serializable()` (for `BaseWorkflow`)

## Migration Path

Existing workflows:

```typescript
// Before
defineWorkflow({
  type: "my-workflow",
  input: z.object({ name: z.string() }),
  run: async (step, payload) => { ... },
});

// After
defineWorkflow((t) => ({
  type: "my-workflow",
  input: t.object({ name: t.string() }),
  run: async (step, payload) => { ... },
}));
```

This is a breaking change for `defineWorkflow`'s signature. Since this is pre-1.0, that's acceptable.
