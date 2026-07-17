// Conformance gate (Definition of Done §4). The stack-neutral fixtures under
// tests/conformance/ are authored by @testing as features land, run by profile along
// the spec DAG (see .github/skills/shared/conformance-fixture/SKILL.md and
// .github/skills/devops/ci-pipeline/SKILL.md). Until fixtures exist this exits 0 so the
// gate is wired without blocking the empty M0 skeleton.
import { existsSync, readdirSync } from "node:fs";

const dir = "tests/conformance";
const fixtures = existsSync(dir)
  ? readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".json"))
  : [];

if (fixtures.length === 0) {
  console.log("conformance: no fixtures yet — gate wired, nothing to run (M0).");
  process.exit(0);
}

// TODO(@testing): run the profile-DAG fixture harness here once it lands.
console.log(`conformance: found ${fixtures.length} fixture(s); harness pending.`);
process.exit(0);
