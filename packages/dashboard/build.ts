// Build script for creating a standalone binary
// Primary distribution: npx @ablauf/dashboard / bunx @ablauf/dashboard
// Experimental: bun build --compile for single binary

import { $ } from "bun";

console.log("Building Ablauf Dashboard...");

// Step 1: Build the Vite/TanStack Start app
await $`bun run build`;

// Step 2: Attempt to compile CLI to standalone binary
console.log("Compiling standalone binary...");
await $`bun build --compile src/cli.ts --outfile ablauf-dashboard`;

console.log("Done! Binary: ./ablauf-dashboard");
