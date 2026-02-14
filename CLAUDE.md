# Ablauf

Durable workflow engine for Cloudflare Workers, powered by Durable Objects.

## Commands

```bash
bun install              # install dependencies
bun run test             # type-check + test (all packages)
bun run check-types      # type-check only
bun run dev              # start worker dev server
```

Tests run via `vitest` with `@cloudflare/vitest-pool-workers` (executes inside workerd). Turbo runs `check-types` before `test` automatically.

## Project Structure

Turborepo monorepo with bun workspaces:

```
packages/workflows/     # @der-ablauf/workflows — core engine (the library)
  src/
    client.ts           # Ablauf class — main API for consumers
    dashboard.ts        # oRPC router for dashboard API
    errors.ts           # ALL error classes (centralized)
    index.ts            # public API exports
    engine/
      workflow-runner.ts  # Durable Object class (WorkflowRunner)
      step.ts             # StepContext — step.do(), step.sleep(), step.waitForEvent()
      sse.ts              # SSE live-update context
      interrupts.ts       # SleepInterrupt, WaitInterrupt, PauseInterrupt
      duration.ts         # parseDuration("5s") → ms
      shard.ts            # FNV-1a hash for index sharding
      index-listing.ts    # shared shard query + dedup logic
      define-workflow.ts  # defineWorkflow() functional API
      base-workflow.ts    # BaseWorkflow abstract class
      types.ts            # all TypeScript types/interfaces
    db/schema.ts        # Drizzle ORM schema (SQLite in DO storage)

packages/client/        # @der-ablauf/client — oRPC browser client
packages/dashboard/     # @der-ablauf/dashboard — React dashboard UI (TanStack Router + React Query)
apps/worker/            # @der-ablauf/worker — demo Cloudflare Worker with example workflows
  src/
    index.ts            # Hono app with centralized error handler
    workflows/          # example workflow definitions
    __tests__/          # vitest tests (run in workerd)
```

## Error Handling — CRITICAL

All errors MUST use the centralized error system in `packages/workflows/src/errors.ts`. **Never throw generic `new Error()`** in engine or API code.

### The error hierarchy

```
WorkflowError (extends Hono HTTPException)
├── WorkflowNotFoundError        (404, "api")
├── ResourceNotFoundError        (404, "api")
├── WorkflowAlreadyExistsError   (409, "engine")
├── WorkflowTypeUnknownError     (400, "api")
├── PayloadValidationError       (400, "validation")
├── EventValidationError         (400, "validation")
├── StepFailedError              (500, "step")
├── StepRetryExhaustedError      (500, "step")
├── EventTimeoutError            (408, "engine")
├── WorkflowNotRunningError      (409, "engine")
├── DuplicateStepError           (400, "engine")
├── InvalidDurationError         (400, "validation")
└── ObservabilityDisabledError   (400, "api")
```

### Rules

1. **Always throw a WorkflowError subclass**, never `new Error(...)`. Every error needs a `code`, `status`, `source`, and `message`.
2. **In Hono route handlers**, throw errors — don't return `c.json({ error: ... })`. The centralized `app.onError` handler formats all `WorkflowError` instances into the standard JSON shape:
   ```json
   { "error": { "code": "...", "message": "...", "status": 400, "source": "..." } }
   ```
3. **Across DO RPC boundaries**, errors are serialized via `toJSON()` and reconstructed via `WorkflowError.fromSerialized()`. Use `err.code` to discriminate, never `instanceof` subclass checks on deserialized errors.
4. **Adding a new error**: create a subclass of `WorkflowError` in `errors.ts`, add its code to the `ErrorCode` union type and `VALID_ERROR_CODES` array, then export it from `index.ts`.

### Error sources

- `"api"` — request-level errors (bad input, not found)
- `"engine"` — workflow lifecycle errors (already exists, not running, timeout)
- `"step"` — step execution errors (failed, retries exhausted)
- `"validation"` — schema validation errors (payload, event, duration)

## Workflow Definition

Two equivalent patterns — class-based and functional:

```typescript
// Class-based
class MyWorkflow extends BaseWorkflow<Payload, Result, Events, SSE> {
  static type = "my-workflow" as const;
  static inputSchema = z.object({ ... });
  static events = { ... };
  async run(step, payload, sse) { ... }
}

// Functional (less boilerplate)
const MyWorkflow = defineWorkflow({
  type: "my-workflow",
  input: z.object({ ... }),
  events: { ... },
  run: async (step, payload, sse) => { ... },
});
```

## Architecture Patterns

- **Replay-based execution**: workflows replay from the beginning on every wake-up. Completed steps return cached results from SQLite. New steps execute and persist.
- **Interrupt-driven flow control**: `step.sleep()`, `step.waitForEvent()`, and pause all throw interrupt classes (not Error subclasses). The runner catches these and sets DO alarms.
- **Shard-based indexing**: workflow instances are listed via index shards (`__index:{type}:{shard}`). Use `listIndexEntries()` from `engine/index-listing.ts` for querying — don't duplicate the shard traversal logic.

## Code Conventions

- TypeScript strict mode, tabs for indentation
- Zod for all runtime validation (input schemas, event schemas, SSE schemas)
- Drizzle ORM for SQLite schema in Durable Objects
- oRPC for type-safe dashboard API (server + client share types via `RouterClient<typeof dashboardRouter>`)
- Hono for HTTP routing in the worker
- No `console.log` in library code (packages/workflows); acceptable in CLI tools (dashboard/cli.ts)
- Empty catch blocks are OK only for best-effort operations (SSE writer cleanup, index updates) — always add a comment explaining why
- Keep `packages/workflows/src/index.ts` as the single public API surface — if you add something, export it there
- ALWAYS update the documentation in apps/docs when you make changes to the code and the code touches things mentioned in the documentation.

## Testing

- Tests live in `apps/worker/src/__tests__/`
- Tests run inside workerd via `@cloudflare/vitest-pool-workers`
- Each test gets real Durable Object instances — tests exercise the full stack
- Test workflows live in `apps/worker/src/workflows/` (e.g., `test-workflow.ts`, `failing-step-workflow.ts`)
- Always run `bun run test` before claiming work is done
