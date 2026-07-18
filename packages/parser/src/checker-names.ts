/**
 * The checker's reusable visible-name model (issue #117 — the checker-rule LEAD deliverable
 * every sibling rule slice, #111/#112/#113/#115, plugs into for name/form visibility). It
 * assembles the candidate set of names a call site's callee may legitimately be: Core primitive
 * names, callable reserved words (a learner typo of a keyword such as `repeat` is still worth
 * suggesting), and every user-declared procedure name in the program — gated on the active
 * conformance profile set exactly as `spec/tooling.md:175-176` requires ("MUST use the active
 * conformance profile set when deciding which primitives and profile block-heads are
 * available"), never a hardcoded "every optional profile active".
 *
 * Only Core Language contributes a name table today; optional-profile primitive/block-head
 * tables (Turtle & Rendering, Data, …) do not exist yet in this package, so this function is
 * intentionally written to *gate* on `profiles` rather than to assume Core is always present —
 * see the module's own unit test for the gating shape. A future profile slice registers its own
 * name table here, following the same `if (active.has(<profile>)) { … }` shape.
 */

import type { CheckProfile } from "./check.js";
import type { ProgramNode } from "./ast.js";
import { walk } from "./ast.js";
import { OL_RESERVED_WORDS } from "./reserved.js";
import { corePrimitiveNames } from "./signatures.js";

/**
 * Every name visible to a call site in `program` under the active `profiles`, lowercased to
 * OpenLogo's canonical spelling (identifiers are case-insensitive). Includes Core primitives and
 * reserved structural words only when `"core-language"` is active, plus every procedure declared
 * anywhere in `program` (declaration order and position do not matter — OpenLogo procedures are
 * available program-wide, not just after their `define`).
 */
export function collectVisibleNames(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): ReadonlySet<string> {
  const active = new Set(profiles);
  const names = new Set<string>();

  if (active.has("core-language")) {
    for (const name of corePrimitiveNames()) {
      names.add(name);
    }
    for (const word of OL_RESERVED_WORDS) {
      names.add(word);
    }
  }

  // Future optional-profile primitive/block-head tables register here, gated the same way,
  // e.g. `if (active.has("turtle-rendering")) { for (const name of turtlePrimitiveNames()) ... }`
  // once that table exists (see issue #117's follow-up issue).

  walk(program, (node) => {
    if (node.kind === "ProcedureDef") {
      names.add(node.name.name.toLowerCase());
    }
  });

  return names;
}
