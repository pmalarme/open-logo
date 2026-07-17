// Verify the runnable spec examples are present and non-empty. Once the parser and runtime
// land, this gate will parse and execute each example; for the M0 skeleton it guards against
// missing or empty `spec/examples/*.logo` so the DoD `examples` gate is meaningful from day one.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join("spec", "examples");
const files = readdirSync(dir).filter((f) => f.endsWith(".logo"));

if (files.length === 0) {
  console.error(`examples: no .logo files found in ${dir}`);
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const text = readFileSync(join(dir, file), "utf8").trim();
  if (text.length === 0) {
    console.error(`examples: ${file} is empty`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`examples: ${failures} empty example(s) found`);
  process.exit(1);
}

console.log(`examples: ${files.length} .logo example(s) present and non-empty`);
