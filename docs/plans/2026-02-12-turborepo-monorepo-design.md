# Turborepo Monorepo Conversion Design

## Overview

Convert the single-package `ablauf` project into a Turborepo monorepo. Extract the workflow engine into a publishable package, keep the Cloudflare Worker as a thin HTTP app, and add an echo workflow demo.

## Structure

```
ablauf/
├── apps/
│   └── worker/                    # @ablauf/worker
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
│       │   ├── workflows/
│       │   │   ├── echo-workflow.ts
│       │   │   ├── test-workflow.ts
│       │   │   ├── failing-step-workflow.ts
│       │   │   └── registry.ts
│       │   └── index.ts           # Barrel export
│       ├── tsconfig.json
│       └── package.json
├── turbo.json
├── package.json                   # Root: workspaces config
├── tsconfig.base.json             # Shared TS options
└── .gitignore
```

## Package Boundaries

### @ablauf/workflows (packages/workflows)

Exports:
- `WorkflowRunner` DO class
- `BaseWorkflow` abstract class
- All types: `Step`, `WorkflowClass`, `WorkflowStatus`, `RetryConfig`, etc.
- All error classes: `WorkflowError`, `WorkflowNotFoundError`, etc.
- DB schema (for consumer migrations)
- `registry` and workflow definitions
- Duration parser, interrupts

Dependencies: `hono`, `drizzle-orm`, `zod`

Published to npm targeting Cloudflare Workers users. Ships TypeScript source directly (no build step) since all consumers use wrangler/esbuild which handles TS natively.

### @ablauf/worker (apps/worker)

Owns:
- Hono HTTP routes
- Wrangler config + DO bindings
- Drizzle migrations + config
- Integration tests (vitest-pool-workers)
- worker-configuration.d.ts

Dependencies: `@ablauf/workflows` (workspace), plus dev deps for wrangler, vitest, drizzle-kit

## Echo Workflow

**File**: `packages/workflows/src/workflows/echo-workflow.ts`

- Input schema: `{ message: string }` (Zod)
- No events
- Single `step.do("echo", ...)` returning `{ original, echoed, timestamp }`
- Registered in registry as `"echo"`

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
- Existing test behavior preserved exactly

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
