# Ablauf

Durable workflow engine for Cloudflare Workers, powered by Durable Objects.

## Packages

- **`@der-ablauf/workflows`** — Core engine: workflow runner, step context, error handling, types
- **`@der-ablauf/worker`** — Demo Cloudflare Worker with example workflows

## Development

```bash
bun install
bun run test        # run all tests
bun run check-types # type-check all packages
bun run dev         # start worker dev server
```

## Ideas

- [ ] Run each step in a dynamic worker loader (toggle via flag)
- [ ] Users can provide their own custom errors in main the Ablauf configuration (maybe)
