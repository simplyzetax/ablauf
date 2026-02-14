# Vitest Pool Workers Testing Design

Replace HTTP endpoint testing with `@cloudflare/vitest-pool-workers` to test the `WorkflowRunner` Durable Object directly via RPC stubs in the real `workerd` runtime.

## Infrastructure

**Dependencies:** `vitest`, `@cloudflare/vitest-pool-workers` (devDependencies)

**Config:** `vitest.config.ts` at project root:

- Uses `defineWorkersConfig` from `@cloudflare/vitest-pool-workers/config`
- Points to `./wrangler.jsonc` for bindings/DO config
- `isolatedStorage: true` for clean state per test
- `singleWorker: true` so DO stubs resolve within the same worker

**TypeScript:** Add `@cloudflare/vitest-pool-workers` to `tsconfig.json` types so `cloudflare:test` resolves.

**Test file:** `src/__tests__/workflow-runner.test.ts`

**Test helper:** `FailingStepWorkflow` defined in test file and registered in registry for retry tests. Throws N times then succeeds.

## Approach

- Get DO stubs via `env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName(id))` from `cloudflare:test`
- Call RPC methods directly: `initialize`, `getStatus`, `alarm`, `deliverEvent`, `pause`, `resume`, `terminate`
- Advance time-based flows by calling `alarm()` manually (deterministic, fast)
- Each test uses a unique DO name for isolation

## Test Scenarios

### 1. Happy path

- Initialize with `{ type: "test", id, payload: { name: "Alice" } }`
- Assert status `sleeping`, step "greet" completed with `"Hello, Alice!"`
- Call `alarm()` to advance past sleep
- Assert status `waiting`
- `deliverEvent({ event: "approval", payload: { approved: true } })`
- Assert status `completed`, result `{ message: "Alice was approved", greeting: "Hello, Alice!" }`

### 2. Rejection path

- Same as happy path but deliver `{ approved: false }`
- Assert result `{ message: "Alice was rejected", greeting: "Hello, Alice!" }`

### 3. Pause/resume

- Initialize, verify sleeping
- `pause()`, assert status `paused`
- `resume()`, replay re-hits sleep interrupt, still sleeping
- `alarm()`, assert waiting
- Deliver event, assert completed

### 4. Terminate

- Initialize, `terminate()`, assert status `terminated`

### 5. Event timeout

- Initialize, `alarm()` past sleep, assert waiting
- `alarm()` again (timeout fires), assert approval step failed with timeout error

### 6. Step retry with backoff

- Register `FailingStepWorkflow` (throws twice, succeeds on third, limit 3)
- Initialize, assert sleeping (first failure scheduled retry)
- `alarm()`, assert sleeping (second failure scheduled retry)
- `alarm()`, assert completed (third attempt succeeds)

### 7. Idempotent initialize

- Call `initialize()` twice with same params
- `getStatus()` returns valid state, no errors

### 8. Unknown workflow type

- Initialize with `type: "nonexistent"`
- Assert status `errored` with error message about unknown type

## Implementation Steps

1. Install `vitest` and `@cloudflare/vitest-pool-workers`
2. Create `vitest.config.ts`
3. Update `tsconfig.json` types
4. Add `"test": "vitest"` script to `package.json`
5. Create `FailingStepWorkflow` + register it
6. Write all 8 test scenarios
7. Run and verify all pass
