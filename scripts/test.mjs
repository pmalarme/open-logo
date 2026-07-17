// Unit-test gate (Definition of Done §3). The test runner is a deferred ADR sub-decision
// (docs/adr/0001-tech-stack.md), so for M0 this discovers plain-JS test files and runs
// them with Node's built-in runner, exiting 0 when there are none yet. @testing replaces
// this when the runner is chosen.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

function findTests(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...findTests(path));
    else if (/\.test\.(js|mjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const tests = findTests("packages");
if (tests.length === 0) {
  console.log("test: no unit tests yet — gate wired, nothing to run (M0).");
  process.exit(0);
}

const result = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
process.exit(result.status ?? 1);
