/**
 * Logic module for the `examples` Definition-of-Done gate (issue #283). Extracted so tests can
 * import it directly for 100% coverage, keeping `scripts/check-examples.mjs` a thin CLI shell —
 * the same split `scripts/harness/index.mjs` + `scripts/conformance.mjs` uses (docs/adr/0009).
 *
 * Earlier, this gate only checked that each `spec/examples/*.logo` file was present and
 * non-empty — it never parsed or ran them, so a file that fails to parse (e.g. the Heritage
 * `to … end` form, which is not yet implemented) was silently reported as passing.
 *
 * This module actually PARSES and EXECUTES each example through `@openlogo/parser` +
 * `@openlogo/runtime`'s public `execute()` — the same entry point the conformance harness uses
 * (`scripts/harness/index.mjs`). An example whose every required profile is already implemented
 * (see {@link IMPLEMENTED_PROFILES}) must produce zero error-severity `ol-*` diagnostics and must
 * not throw, or the gate fails. An example that needs a profile not yet implemented is SKIPPED
 * with a visible notice — it is never silently counted as a pass.
 *
 * The profile manifest (`scripts/examples-profiles.json`) is owned here, not under `spec/` —
 * `spec/` is maintainer-owned (AGENTS.md), so this gate must never add tags/headers to the
 * `.logo` files themselves.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execute } from "@openlogo/runtime";

export const EXAMPLES_DIR = join("spec", "examples");
export const MANIFEST_PATH = join("scripts", "examples-profiles.json");

/**
 * Profiles with real conformance fixtures today (`tests/conformance/<profile>/`) — i.e. the
 * spec's profile DAG (`spec/conformance.md`) nodes that are actually implemented, not just
 * planned. Update this list only alongside a milestone that lands a new profile's conformance
 * fixtures (see `tests/conformance/README.md`); keeping it in lockstep is what lets this gate
 * SKIP (rather than wrongly fail or wrongly pass) an example that needs a profile not yet built.
 */
export const IMPLEMENTED_PROFILES = ["core-language", "turtle-rendering"];

/** Load the filename -> required-profile-id[] manifest from `manifestPath`. */
export function loadManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

/** True when every profile in `requiredProfiles` is already implemented. */
export function isRunnable(requiredProfiles, implementedProfiles) {
  return requiredProfiles.every((profile) =>
    implementedProfiles.includes(profile),
  );
}

/**
 * Parse+execute `source` (document label `name`) via `@openlogo/runtime`'s `execute()` and
 * classify the result. `execute()` is not expected to throw for a well-formed program, but a gate
 * must never itself crash on an unexpected internal error — an unexpected throw is reported as a
 * failure rather than propagated.
 *
 * @returns `{ status: "pass" }`, or `{ status: "fail", reason }` when execution produced one or
 *   more error-severity diagnostics (joined into `reason`) or threw.
 */
export function classifyExample(source, name) {
  let result;
  try {
    result = execute(source, name);
  } catch (err) {
    return { status: "fail", reason: `threw: ${err.message}` };
  }
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (errors.length === 0) {
    return { status: "pass" };
  }
  return {
    status: "fail",
    reason: errors.map((d) => `${d.code}: ${d.message}`).join("; "),
  };
}

/**
 * Run the full examples gate over every `.logo` file in `dir`, using `manifest` (default: read
 * from `manifestPath`) to determine each file's required profiles. Never calls `process.exit` —
 * the CLI shell (`check-examples.mjs`) does that from the returned `ok` flag.
 *
 * @returns `{ ok, ran, skipped, failed, lines }` — `lines` is the printable report (one
 *   `PASS`/`FAIL`/`SKIP` line per example plus a trailing summary line); `ok` is `false` when any
 *   example failed or the manifest/directory itself is invalid.
 */
export function runExamplesGate({
  dir = EXAMPLES_DIR,
  manifestPath = MANIFEST_PATH,
  manifest,
  implementedProfiles = IMPLEMENTED_PROFILES,
} = {}) {
  const lines = [];

  if (!existsSync(dir)) {
    lines.push(`examples: directory ${dir} does not exist`);
    return { ok: false, ran: 0, skipped: 0, failed: 0, lines };
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".logo"))
    .sort();

  if (files.length === 0) {
    lines.push(`examples: no .logo files found in ${dir}`);
    return { ok: false, ran: 0, skipped: 0, failed: 0, lines };
  }

  const resolvedManifest = manifest ?? loadManifest(manifestPath);

  let ran = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const requiredProfiles = resolvedManifest[file];
    if (requiredProfiles === undefined) {
      failed += 1;
      lines.push(
        `FAIL ${file}: no entry in the profile manifest (${manifestPath}) — every example must declare its required profile(s)`,
      );
      continue;
    }

    if (!isRunnable(requiredProfiles, implementedProfiles)) {
      const missing = requiredProfiles.filter(
        (profile) => !implementedProfiles.includes(profile),
      );
      skipped += 1;
      lines.push(
        `SKIP ${file} (requires ${missing.join(", ")} — not yet implemented)`,
      );
      continue;
    }

    const source = readFileSync(join(dir, file), "utf8");
    ran += 1;
    const outcome = classifyExample(source, file);
    if (outcome.status === "pass") {
      lines.push(`PASS ${file}`);
    } else {
      failed += 1;
      lines.push(`FAIL ${file}: ${outcome.reason}`);
    }
  }

  lines.push(
    `examples: ran ${ran}, skipped ${skipped}, failed ${failed} (of ${files.length} total)`,
  );

  return { ok: failed === 0, ran, skipped, failed, lines };
}

/** Parse CLI arguments: `--dir=<path>` and `--manifest=<path>` override the defaults (used by the
 * subprocess regression test to point the CLI at isolated temp fixtures instead of the real
 * `spec/examples/` corpus). */
export function parseArgs(argv) {
  let dir;
  let manifestPath;
  for (const arg of argv) {
    if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
    } else if (arg.startsWith("--manifest=")) {
      manifestPath = arg.slice("--manifest=".length);
    }
  }
  return { dir, manifestPath };
}
