import { z } from 'zod';
import { InvalidSchemaError } from './errors';

// -- Allowed Zod type names ------------------------------------------------

/**
 * Set of Zod internal type names that are compatible with SuperJSON serialization.
 * Used by {@link validateSchema} to recursively check schemas at registration time.
 *
 * These correspond to Zod v4's `_def.type` values (lowercase strings).
 */
const ALLOWED_TYPES = new Set([
	// Primitives
	'string',
	'number',
	'boolean',
	'null',
	'undefined',
	'bigint',
	// Rich types
	'date',
	'map',
	'set',
	// Structural
	'object',
	'array',
	'tuple',
	'record',
	// Combinators
	'literal',
	'enum',
	'union',
	'intersection',
	'optional',
	'nullable',
	'default',
	// Wrappers
	'pipe',
	'lazy',
	'custom',
	// Escape hatches
	'any',
	'unknown',
]);

// -- Schema validator -------------------------------------------------------

/**
 * Recursively validates that a Zod schema only uses SuperJSON-compatible types.
 *
 * Walks the schema's internal `_def.type` tree and throws
 * {@link InvalidSchemaError} with the full path on the first unsupported type.
 *
 * @param schema - The Zod schema to validate.
 * @param path - Dot-separated path for error reporting (defaults to `"root"`).
 * @throws {@link InvalidSchemaError} If any node uses an unsupported Zod type.
 *
 * @internal
 */
export function validateSchema(schema: z.ZodType, path = 'root'): void {
	const def = schema._def as unknown as Record<string, unknown>;
	const typeName = def.type as string;

	if (!ALLOWED_TYPES.has(typeName)) {
		throw new InvalidSchemaError(path, typeName);
	}

	switch (typeName) {
		case 'object': {
			const shape = def.shape as Record<string, z.ZodType>;
			for (const [key, value] of Object.entries(shape)) {
				validateSchema(value, `${path}.${key}`);
			}
			break;
		}
		case 'array':
			validateSchema(def.element as z.ZodType, `${path}[]`);
			break;
		case 'map':
			validateSchema(def.keyType as z.ZodType, `${path}<key>`);
			validateSchema(def.valueType as z.ZodType, `${path}<value>`);
			break;
		case 'set':
			validateSchema(def.valueType as z.ZodType, `${path}<item>`);
			break;
		case 'optional':
		case 'nullable':
		case 'default':
			validateSchema(def.innerType as z.ZodType, path);
			break;
		case 'union': {
			const options = def.options as z.ZodType[];
			for (let i = 0; i < options.length; i++) {
				validateSchema(options[i], `${path}|${i}`);
			}
			break;
		}
		case 'intersection':
			validateSchema(def.left as z.ZodType, `${path}&left`);
			validateSchema(def.right as z.ZodType, `${path}&right`);
			break;
		case 'tuple': {
			const items = def.items as z.ZodType[];
			for (let i = 0; i < items.length; i++) {
				validateSchema(items[i], `${path}[${i}]`);
			}
			if (def.rest) {
				validateSchema(def.rest as z.ZodType, `${path}[...rest]`);
			}
			break;
		}
		case 'record':
			validateSchema(def.keyType as z.ZodType, `${path}{key}`);
			validateSchema(def.valueType as z.ZodType, `${path}{value}`);
			break;
		case 'pipe':
			validateSchema(def.in as z.ZodType, path);
			break;
		case 'lazy':
			validateSchema((def.getter as () => z.ZodType)(), path);
			break;
		// Primitives, literals, enums, any, unknown, custom — no children to recurse
	}
}

// -- Branded schema type ----------------------------------------------------

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

// -- TransportSchema type ---------------------------------------------------

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
	| 'null'
	| 'undefined'
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

// -- Allowed keys for Pick --------------------------------------------------

const ALLOWED_KEYS = [
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
] as const;

function pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
	const result = {} as Pick<T, K>;
	for (const key of keys) {
		result[key] = obj[key];
	}
	return result;
}

// -- Runtime `t` object -----------------------------------------------------

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

// -- serializable() wrapper -------------------------------------------------

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
