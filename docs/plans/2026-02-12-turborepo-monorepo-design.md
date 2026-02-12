# Turborepo Monorepo Conversion Design

## Overview

Convert the single-package project into a Turborepo monorepo called `ablauf`. Extract the workflow engine into a publishable package (`@ablauf/workflows`), keep the Cloudflare Worker as a thin HTTP demo app (`@ablauf/worker`), and add an echo workflow demo.

## Structure

```
ablauf/
├── apps/
│   └── worker/                    # @ablauf/worker (demo app)
│       ├── src/
│       │   ├── __tests__/         # Integration tests (vitest-pool-workers)
│       │   │   ├── errors.test.ts
│       │   │   ├── workflow-runner.test.ts
│       │   │   └── env.d.ts
│       │   └── index.ts           # Hono routes + DO re-export
│       ├── drizzle/               # Migrations (wrangler-coupled)
│       ├── wrangler.jsonc
│       ├── vitest.config.ts
│       ├── drizzle.config.ts
│       ├── worker-configuration.d.ts
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   └── workflows/                 # @ablauf/workflows (published to npm)
│       ├── src/
│       │   ├── engine/
│       │   │   ├── base-workflow.ts
│       │   │   ├── duration.ts
│       │   │   ├── interrupts.ts
│       │   │   ├── step.ts
│       │   │   ├── types.ts
│       │   │   └── workflow-runner.ts
│       │   ├── db/
│       │   │   └── schema.ts
│       │   ├── errors.ts
│       │   └── index.ts           # Barrel export
│       ├── tsconfig.json
│       └── package.json
├── turbo.json
├── package.json                   # Root: workspaces config
├── tsconfig.base.json             # Shared TS options
└── .gitignore
```

## Consumer-Facing API

The package is designed for Cloudflare Workers users. Two main exports:

### createWorkflowRunner(workflows)

Factory that returns a Durable Object class with the given workflows baked into its registry. Consumers re-export this from their worker entry point (required by Cloudflare for DO bindings).

```typescript
import { createWorkflowRunner } from '@ablauf/workflows';
import { MyWorkflow } from './workflows/my-workflow';

// Create and export the DO class
export const WorkflowRunner = createWorkflowRunner([MyWorkflow]);
```

### Ablauf client class

Client that wraps a DO namespace binding to provide type-safe workflow operations. Consumers pass their DO binding to the constructor.

```typescript
import { Ablauf } from '@ablauf/workflows';

export default {
  async fetch(req: Request, env: Env) {
    const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

    // Create a workflow
    await ablauf.create(MyWorkflow, { id: 'order-123', payload: { items: [...] } });

    // Get status
    const status = await ablauf.status('order-123');

    // Send event (type-safe per workflow's event schema)
    await ablauf.sendEvent(MyWorkflow, { id: 'order-123', event: 'approval', payload: { approved: true } });

    // Lifecycle control
    await ablauf.pause('order-123');
    await ablauf.resume('order-123');
    await ablauf.terminate('order-123');
  }
};
```

### Key changes from current architecture

1. **`BaseWorkflow` static methods removed** — `create()`, `sendEvent()`, `status()`, `pause()`, `resume()`, `terminate()` move to the `Ablauf` client class. BaseWorkflow becomes purely about defining workflow logic (`run()` method, schemas, defaults).

2. **Registry is no longer a static module** — `createWorkflowRunner()` builds the registry from the workflows array and bakes it into the DO class closure.

3. **No hardcoded binding names** — The consumer passes their binding to `new Ablauf(binding)`. The package never touches `env` directly.

4. **Workflow definitions live with the consumer** — The package exports `BaseWorkflow` for extending. Demo workflows (echo, test, failing-step) move to `apps/worker` since they're not part of the published package.

## Package Boundaries

### @ablauf/workflows (packages/workflows)

Exports:
- `createWorkflowRunner(workflows)` — DO class factory
- `Ablauf` — Client class wrapping DO binding
- `BaseWorkflow` — Abstract base class for defining workflows
- All types: `Step`, `WorkflowClass`, `WorkflowStatus`, `RetryConfig`, etc.
- All error classes: `WorkflowError`, `WorkflowNotFoundError`, etc.
- DB schema (for consumer migrations)
- Duration parser, interrupts

Dependencies: `hono`, `drizzle-orm`, `zod`

Ships TypeScript source directly (no build step) since all consumers use wrangler/esbuild.

### @ablauf/worker (apps/worker)

Owns:
- Hono HTTP routes
- Wrangler config + DO bindings
- Drizzle migrations + config
- Workflow definitions: EchoWorkflow, TestWorkflow, FailingStepWorkflow
- Registry setup via `createWorkflowRunner()`
- Integration tests (vitest-pool-workers)
- worker-configuration.d.ts

Dependencies: `@ablauf/workflows` (workspace), plus dev deps for wrangler, vitest, drizzle-kit

## Echo Workflow

**File**: `apps/worker/src/workflows/echo-workflow.ts`

- Input schema: `{ message: string }` (Zod)
- No events
- Single `step.do("echo", ...)` returning `{ original, echoed, timestamp }`

**Demo route** in `apps/worker/src/index.ts`:
```
POST /echo
Body: { "message": "hello" }
Response: { "original": "hello", "echoed": "hello", "timestamp": 1739347200000 }
```

Creates the workflow, polls for completion (synchronous single-step), returns result inline.

## Turborepo Configuration

### turbo.json

Tasks:
- `check-types`: `tsc --noEmit` in each workspace
- `test`: depends on `check-types`, runs vitest
- `dev`: persistent, runs `wrangler dev`

No `build` task needed — wrangler bundles TS source at deploy time.

### Package configs

**@ablauf/workflows package.json**:
- `exports`: points to `./src/index.ts`
- `types`: points to `./src/index.ts`
- `scripts.check-types`: `tsc --noEmit`
- No build script

**@ablauf/worker package.json**:
- `scripts.dev`: `wrangler dev`
- `scripts.deploy`: `wrangler deploy`
- `scripts.test`: `vitest run`
- `scripts.check-types`: `tsc --noEmit`

### Shared tsconfig

`tsconfig.base.json` at root with shared compiler options (ES2024, strict, bundler resolution). Each workspace extends it.

## Rename

All references to "durable-workflows" renamed to "ablauf":
- Root package name: `ablauf`
- Package names: `@ablauf/workflows`, `@ablauf/worker`
- README, AGENTS.md, any internal references

## Test Strategy

- Integration tests stay in `apps/worker` (need vitest-pool-workers + wrangler)
- Error unit tests stay in `apps/worker` (they also use the pool-workers setup)
- Tests import from `@ablauf/workflows` like any consumer would
- Tests updated to use new `Ablauf` client + `createWorkflowRunner` API
- Existing test behavior preserved

## Dependencies

Root:
- `turbo` (devDep)
- `typescript` (devDep)

@ablauf/workflows:
- `hono`, `drizzle-orm`, `zod` (deps)

@ablauf/worker:
- `@ablauf/workflows` (workspace dep)
- `@cloudflare/vitest-pool-workers`, `wrangler`, `vitest`, `drizzle-kit` (devDeps)
- `@types/node` (devDep)
