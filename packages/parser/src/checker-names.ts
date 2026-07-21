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
 * Core Language, Turtle & Rendering, and Educational each contribute a name table today (issue
 * #136 added Turtle & Rendering, sourced from `signatures.ts`'s `TURTLE_PRIMITIVE_ARITY`; issue
 * #331 added Educational's `explain`/`why`/`hint`/`debug` meta-commands the same way, sourced from
 * `EDUCATIONAL_PRIMITIVE_ARITY` — each profile's single source-of-truth table, so this module
 * never keeps a second, duplicate name list); later optional-profile primitive/block-head tables
 * (Data, Geometry, …) do not exist yet in this package, so this function is intentionally written
 * to *gate* on `profiles` rather than to assume any profile is always present — see the module's
 * own unit test for the gating shape. A future profile slice registers its own name table here,
 * following the same `if (active.has(<profile>)) { … }` shape.
 *
 * {@link isOptionalProfileName} is this module's companion export for `ol-unknown-command`'s
 * did-you-mean tie-break (`spec/error-model.md:145-146`: "prefer Core words over optional-profile
 * words" on a distance tie) — now that optional profiles (Turtle & Rendering, Educational)
 * contribute real candidates, a tie between a Core name and an optional-profile name is reachable
 * and MUST resolve in Core's favor, not by lexicographic order alone.
 */

import type { CheckProfile } from "./check.js";
import type { ProgramNode } from "./ast.js";
import { walk } from "./ast.js";
import { OL_RESERVED_WORDS } from "./reserved.js";
import {
  corePrimitiveNames,
  educationalPrimitiveNames,
  turtlePrimitiveNames,
} from "./signatures.js";

/**
 * Every canonical lowercase name contributed by an optional (non-Core) conformance profile's
 * primitive table — currently Turtle & Rendering's and Educational's. Computed once as a frozen
 * union so {@link isOptionalProfileName} stays a pure, allocation-free lookup; a future
 * optional-profile table (Data, Geometry, …) adds its `...someProfileNames()` spread here
 * alongside these, exactly mirroring how {@link collectVisibleNames} itself is extended one
 * profile at a time.
 */
const OPTIONAL_PROFILE_NAMES: ReadonlySet<string> = new Set([
  ...turtlePrimitiveNames(),
  ...educationalPrimitiveNames(),
]);

/**
 * Whether `name` (already lowercased) belongs to an optional conformance profile's primitive
 * table rather than Core Language. Used only for the did-you-mean tie-break — it answers "is this
 * candidate an optional-profile word?" independent of which profiles are currently active, since
 * a name only reaches the did-you-mean candidate set at all when its owning profile is active
 * (see {@link collectVisibleNames}).
 */
export function isOptionalProfileName(name: string): boolean {
  return OPTIONAL_PROFILE_NAMES.has(name);
}

/**
 * Every name visible to a call site in `program` under the active `profiles`, lowercased to
 * OpenLogo's canonical spelling (identifiers are case-insensitive). Includes Core primitives and
 * reserved structural words only when `"core-language"` is active, Turtle & Rendering primitives
 * only when `"turtle-rendering"` is active, the `explain`/`why`/`hint`/`debug` meta-commands only
 * when `"educational"` is active, plus every procedure declared anywhere in `program` (declaration
 * order and position do not matter — OpenLogo procedures are available program-wide, not just
 * after their `define`).
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

  if (active.has("turtle-rendering")) {
    for (const name of turtlePrimitiveNames()) {
      names.add(name);
    }
  }

  if (active.has("educational")) {
    for (const name of educationalPrimitiveNames()) {
      names.add(name);
    }
  }

  // Future optional-profile primitive/block-head tables (Data, Geometry, …) register here,
  // gated the same way, once their tables exist (see issue #117's follow-up issue).

  walk(program, (node) => {
    if (node.kind === "ProcedureDef") {
      names.add(node.name.name.toLowerCase());
    }
  });

  return names;
}
