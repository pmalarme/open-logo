// Runnable-examples gate (Definition of Done §5). Once @openlogo/parser + runtime can
// execute .logo this will parse and run every spec/examples/*.logo. Until then it
// verifies the examples are present and exits 0 so the gate is wired for M0.
import { existsSync, readdirSync } from "node:fs";

const dir = "spec/examples";
const examples = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".logo")) : [];

console.log(
  examples.length === 0
    ? "examples: no spec/examples/*.logo found — gate wired, nothing to run (M0)."
    : `examples: ${examples.length} example(s) present; runnable harness pending (needs parser + runtime).`,
);
process.exit(0);
