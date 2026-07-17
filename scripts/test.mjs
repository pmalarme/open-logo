// Unit-test gate (Definition of Done §3). Runs the smoke/unit tests with Node's
// built-in test runner (`node:test` + `node:assert`) directly over the TypeScript
// sources — no build step and no extra dependency (KISS). Node strips the types
// natively via `--experimental-strip-types` (stable/default on Node >=22.18; the
// flag also enables it on 22.6+). The tests import their package's contract
// registries with explicit `.ts` specifiers and are excluded from both the emit
// build and the type-check program (see the `exclude` in each package's tsconfig
// and in tsconfig.typecheck.json), so they run only here.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

function findTests(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...findTests(path));
    else if (/\.test\.ts$/.test(entry.name)) out.push(path);
  }
  return out;
}

const tests = findTests("packages");
if (tests.length === 0) {
  console.log("test: no unit tests yet — gate wired, nothing to run (M0).");
  process.exit(0);
}

const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", ...tests], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
