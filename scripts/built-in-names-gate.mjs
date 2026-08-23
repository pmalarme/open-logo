/**
 * Logic module for the **built-in names** Definition-of-Done gate (issue #841, epic #834).
 * Extracted so tests can import it directly for 100% coverage, keeping
 * `scripts/check-built-in-names.mjs` a thin CLI shell — the same shape
 * `scripts/examples-gate.mjs` + `scripts/check-examples.mjs` and `scripts/markdown-examples-gate.mjs`
 * + `scripts/check-markdown-examples.mjs` already have. A CLI shell is exercised through a
 * subprocess, so it stays outside the loaded-module coverage set
 * [ADR-0009](../docs/adr/0009-test-layout.md) defines.
 *
 * **Why this exists.** `spec/grammar.md:414` versions the built-in names with the specification —
 * *"there is no second list to keep in step"* — and `spec/grammar.md:363` governs them with one
 * rule: a program may not **declare** a built-in name, and may **bind** a value to any name. Until
 * this gate there was no artifact stating what that set is, and nothing compared the spec to the
 * implementation. The result was the bug class ruling #833 exists to close: 45 built-in names were
 * free at `define`, spread across eight arity tables plus three Heritage registries, and no single
 * document would have revealed it.
 *
 * [ADR-0021](../docs/adr/0021-built-in-names-list-and-ci-gate.md) decides the direction:
 * **`spec/built-in-names.json` is authoritative** and CI asserts the implementation equals it,
 * exactly, in both directions. This module is that assertion.
 *
 * **The drift is demonstrated, not hypothetical.** `spec/tooling.md`'s C19 mirror had already
 * silently drifted to 43 words — it was missing `mod` — before issue #855 restored it, because a
 * keyword is a five-place edit and none of the five was machine-gated.
 *
 * ## What it checks
 *
 * 1. **`specVersion` matches `openlogo.version`** — the file ships *with* a spec version or the
 *    claim in ADR-0021 §1 is decorative.
 * 2. **Every accessor the file names resolves, per accessor** ({@link accessorFindings}).
 *    `present` must resolve as a public export of `@openlogo/parser`; `declared` must **not**, and
 *    fails the moment it does — that is what makes a not-yet-built accessor self-healing instead of
 *    a hard-coded exception list, which would be the second list this gate exists to remove.
 * 3. **Entry equality in both directions** ({@link entryFindings}, {@link implementationFindings}).
 *    Structured entries, never a flat name set: `registries` is compared **set-equal** against the
 *    tags whose `lookup` actually answers yes, and `category`/`profile` are re-derived from that
 *    membership under the file's stated precedence and compared. Comparing names alone would accept
 *    `mod` implemented as a primitive, `forward` filed under the wrong profile, or a name that
 *    quietly lost one of its two registrations.
 * 4. **Alias edges** ({@link aliasFindings}). A Heritage alias is checked against the edge the
 *    implementation actually resolves (`canonicalOfHeritageAlias`). The five Turtle & Rendering
 *    one-word spellings have **no** canonical accessor anywhere — they are independent arity entries
 *    bound to one primitive — so the strongest available check is that the target is a real entry of
 *    equal arity. ADR-0021 §3 states that limit; it is reported, not hidden.
 * 5. **Carve-outs** ({@link carveOutFindings}). Every `reason: "library"` entry names a real
 *    `stdlib/*.logo` file, every `contextual-keyword` records the positions that make it structural,
 *    and no excluded name also appears in `names`. Deleting `stdlib/geometry/polygon.logo`, or
 *    "helpfully" promoting `polygon` to a built-in, fails the build.
 * 6. **No unregistered profile** ({@link profileInventoryFindings},
 *    {@link profileCoverageFindings}). The profile inventory is tied across three surfaces —
 *    `spec/conformance.md`'s sections (the normative inventory), the manifest's id map, and the
 *    checker's `OL_CHECK_PROFILES` — and then every profile either has at least one `primitive`
 *    entry backed by a real registry, or is declared in `profilesWithoutPrimitives` **with a
 *    reason**; a declared-empty profile that later ships a primitive fails too. Enumerating
 *    profiles from the implementation alone would leave a profile the spec adds and the checker has
 *    never heard of invisible. This is the clause that would have caught Tutor (AI) having
 *    no registry at all, and it is why the gate is not a plain diff of whatever tables exist: a
 *    missing table must be a failure, not an empty set that trivially matches.
 * 7. **Prose drift, across BOTH hand-maintained lists** ({@link proseFindings}). `spec/grammar.md`'s
 *    normative keyword block, `spec/tooling.md`'s C19 mirror, **and** `spec/tooling.md`'s `keyword`
 *    token-class enumeration. Gating only the first would leave the newer list unguarded, which is
 *    the exact defect family this epic exists to close.
 *
 * ## Why the token-class list is gated rather than derived
 *
 * `spec/grammar.md:378` states that the `keyword` **token class** and the keyword **list** are
 * "different sets on purpose, and neither one determines the other". Measured against shipped
 * output, the class omits four keywords (`and`/`or`/`not`/`mod` are `operator`), adds four words
 * that are not built-in names at all (`empty`/`member`/`of`/`a`), and adds the profile words. Issue
 * #855 tried two derivations and both were falsified by measurement: a **positional** rule is
 * refuted by `local end`, `export end` and `:p.end` all emitting `keyword`, and *"the keyword list
 * minus four"* re-derives paint from the declaration list, which `:378` forbids. So it is an
 * enumeration — and an enumeration needs a gate. The file records only the **deltas**, and this
 * module computes the membership from them, so there is still no second list to keep in step.
 *
 * ## Fail-closed
 *
 * Every prose anchor, accessor kind and status value is validated before use. An anchor that stops
 * matching, a kind this module does not know, or a status outside the closed vocabulary is a
 * **finding**, never a silent skip — a gate that quietly checks nothing is worse than no gate,
 * because it also removes the human who was checking.
 *
 * **`spec/` is maintainer-owned** (AGENTS.md), so this gate must never add markers, tags or
 * annotations to the documents it reads — the same constraint that keeps
 * `scripts/examples-profiles.json` out of `spec/examples/`. It anchors on the prose that is already
 * there.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as parserApi from "@openlogo/parser";

/** The authoritative list (ADR-0021 §1). Under `spec/`, so maintainer-owned via `CODEOWNERS`. */
export const MANIFEST_PATH = join("spec", "built-in-names.json");

/** The normative keyword list's home. */
export const GRAMMAR_PATH = join("spec", "grammar.md");

/** Carries both hand-maintained lists this gate covers: the C19 mirror and the token class. */
export const TOOLING_PATH = join("spec", "tooling.md");

/**
 * The normative inventory of what profiles exist and what each ships (ADR-0021 §3 clause 2). The
 * gate reads it; it never writes to `spec/`.
 */
export const CONFORMANCE_PATH = join("spec", "conformance.md");

/**
 * The closed per-accessor status vocabulary (ADR-0021 §2). `present` must resolve; `declared` is
 * decided-but-not-yet-created and must **not** resolve.
 */
export const ACCESSOR_STATUSES = ["present", "declared"];

/**
 * How an accessor is adapted to each of the two roles. The eight `*PrimitiveArity` functions are
 * lookups only (`arity`), `OL_KEYWORDS` is an `array` and `OL_PROFILE_KEYWORDS` a `record`, so
 * neither is a callable predicate and the lookup side scans them. A `profile-enumerator` is called
 * with the registry's own `profile` — `profilePrimitiveNames(profile)` (issue #874) is one derived
 * accessor over the whole profile-keyed registry rather than nine hand-written per-profile
 * functions, so a profile that gains a table becomes enumerable here with no edit.
 */
export const ACCESSOR_KINDS = [
  "array",
  "record",
  "arity",
  "enumerator",
  "profile-enumerator",
];

/** The two `category` values (ADR-0021 §2): the implementation's organizing split, not a paint. */
export const CATEGORIES = ["keyword", "primitive"];

/** Default filesystem port, so tests can drive every branch without touching disk. */
export const REAL_IO = {
  readText: (path) => readFileSync(path, "utf8"),
  exists: (path) => existsSync(path),
};

/** Read and parse the authoritative list. */
export function loadManifest(manifestPath = MANIFEST_PATH, io = REAL_IO) {
  return JSON.parse(io.readText(manifestPath));
}

/**
 * Resolve `accessor` as a public export of `@openlogo/parser`. Returns `undefined` when the export
 * does not exist — which is drift for a `present` accessor and the expected state for a `declared`
 * one.
 */
export function resolveAccessor(api, accessor) {
  return api[accessor];
}

/**
 * Check that every accessor the file names resolves exactly as its `status` claims, and that the
 * file's own vocabulary (`kind`, `status`, `category`) stays inside the closed sets above.
 *
 * Per accessor, not per tag: at `0.1.0` one tag is **split** — `tutor-primitive`'s `lookup`
 * resolves while its `enumerate` does not exist yet. A per-tag status could not express that, and
 * either reading of it fails: call the tag `declared` and a resolving lookup reads as drift; call it
 * `present` and a missing enumerator goes unnoticed.
 */
export function accessorFindings(manifest, api) {
  const findings = [];
  for (const [tag, registry] of Object.entries(manifest.registries)) {
    if (!CATEGORIES.includes(registry.category)) {
      findings.push(
        `registry ${tag}: category ${JSON.stringify(registry.category)} is outside the closed vocabulary [${CATEGORIES.join(", ")}]`,
      );
    }
    for (const role of ["lookup", "enumerate"]) {
      const spec = registry[role];
      if (spec === undefined) {
        findings.push(
          `registry ${tag}: no ${role} accessor — each tag must name both, because the two comparison directions need different shapes`,
        );
        continue;
      }
      if (!ACCESSOR_KINDS.includes(spec.kind)) {
        findings.push(
          `registry ${tag}.${role}: kind ${JSON.stringify(spec.kind)} is outside the closed vocabulary [${ACCESSOR_KINDS.join(", ")}]`,
        );
      }
      if (!ACCESSOR_STATUSES.includes(spec.status)) {
        findings.push(
          `registry ${tag}.${role}: status ${JSON.stringify(spec.status)} is outside the closed vocabulary [${ACCESSOR_STATUSES.join(", ")}]`,
        );
        continue;
      }
      const resolved = resolveAccessor(api, spec.accessor);
      if (spec.status === "present" && resolved === undefined) {
        findings.push(
          `registry ${tag}.${role}: ${spec.accessor} is declared "present" but is not exported from @openlogo/parser`,
        );
      }
      if (spec.status === "declared" && resolved !== undefined) {
        findings.push(
          `registry ${tag}.${role}: ${spec.accessor} is declared "declared" (decided, not yet created) but now resolves — flip its status to "present" in ${MANIFEST_PATH}`,
        );
      }
      if (role === "enumerate" && spec.kind === "arity") {
        findings.push(
          `registry ${tag}.enumerate: ${spec.accessor} is an arity lookup and cannot enumerate — naming it here would satisfy the per-name direction while leaving the whole-list direction unreachable`,
        );
      }
    }
  }
  return findings;
}

/**
 * Ask a registry's **lookup** accessor whether it holds `name`.
 *
 * @returns `true`/`false`, or `null` when the answer is unavailable — the accessor is `declared`,
 *   so the file itself says it does not exist yet. `null` is propagated rather than coerced to
 *   `false`, so an unreachable direction is reported as unreachable instead of silently reading as
 *   "the implementation does not have it".
 */
export function registryHas(registry, api, name) {
  const spec = registry.lookup;
  if (spec.status !== "present") {
    return null;
  }
  const accessor = resolveAccessor(api, spec.accessor);
  if (accessor === undefined) {
    return null;
  }
  switch (spec.kind) {
    case "array":
      return accessor.includes(name);
    case "record":
      return Object.values(accessor).some((words) => words.includes(name));
    case "arity":
      return accessor(name) !== undefined;
    case "profile-enumerator":
      return accessor(registry.profile).includes(name);
    default:
      return accessor().includes(name);
  }
}

/** The names an `enumerate` accessor yields, given its kind. */
function enumeratedNames(spec, accessor, profile) {
  switch (spec.kind) {
    case "array":
      return accessor;
    case "profile-enumerator":
      return accessor(profile);
    default:
      return accessor();
  }
}

/**
 * Enumerate a registry's members through its **enumerate** accessor.
 *
 * @returns a `Map` of name -> owning profile, or `null` when the registry cannot enumerate yet.
 *   A `record` accessor supplies the profile from its own key — `OL_PROFILE_KEYWORDS` is keyed by
 *   profile, so it must be flattened per key rather than concatenated blindly; every other kind
 *   uses the registry's single `profile`, which a `profile-enumerator` also takes as its argument.
 */
export function registryMembers(registry, api) {
  const spec = registry.enumerate;
  if (spec.status !== "present") {
    return null;
  }
  const accessor = resolveAccessor(api, spec.accessor);
  if (accessor === undefined) {
    return null;
  }
  const members = new Map();
  if (spec.kind === "record") {
    for (const [profile, words] of Object.entries(accessor)) {
      for (const word of words) {
        members.set(word, profile);
      }
    }
    return members;
  }
  for (const name of enumeratedNames(spec, accessor, registry.profile)) {
    members.set(name, registry.profile);
  }
  return members;
}

/**
 * Re-derive `category` and `profile` from a name's registry membership under the file's stated
 * precedence: **`keyword` before `primitive`**, running in the key order of `registries`.
 *
 * That precedence is not a convention this gate invents — it mirrors the one the checker already
 * applies, and it is what files `to` under `core-language` rather than `heritage` even though `to`
 * is in a Heritage registry too. Six names at `0.1.0` are reachable from two registries, and a
 * single-valued summary cannot express that, which is why the full membership stays in `registries`
 * and only the summary is derived here.
 */
export function deriveSummary(manifest, tags, profileByTag) {
  const ordered = Object.keys(manifest.registries).filter((tag) =>
    tags.includes(tag),
  );
  const winner =
    ordered.find((tag) => manifest.registries[tag].category === "keyword") ??
    ordered[0];
  return {
    category: manifest.registries[winner].category,
    profile: profileByTag.get(winner) ?? manifest.registries[winner].profile,
  };
}

/**
 * The **file -> implementation** direction, entry by entry: every tag an entry claims must answer
 * yes, the claimed set must be **set-equal** to the tags that actually answer yes, and the derived
 * `category`/`profile` must match what the entry records.
 *
 * Set equality is the load-bearing part. Drop `thing` from `corePrimitiveArity`, or `make` from
 * `heritageFormHeadNames()`, and a precedence-based check would still see a matching keyword entry
 * and report green.
 */
export function entryFindings(manifest, api) {
  const findings = [];
  const seen = new Set();
  const knownTags = Object.keys(manifest.registries);
  // Enumerated once per tag rather than once per name-and-tag: the members are the same for every
  // entry, and the per-name form made 148 x 14 enumerator calls to answer one question each.
  const membersByTag = new Map(
    Object.entries(manifest.registries).map(([tag, registry]) => [
      tag,
      registryMembers(registry, api),
    ]),
  );
  for (const entry of manifest.names) {
    if (seen.has(entry.name)) {
      findings.push(
        `${entry.name}: listed twice in names — a name is filed once, with its full membership in \`registries\``,
      );
      continue;
    }
    seen.add(entry.name);

    const unknown = entry.registries.filter((tag) => !knownTags.includes(tag));
    if (unknown.length > 0) {
      findings.push(
        `${entry.name}: names registry tag(s) ${unknown.join(", ")} that ${MANIFEST_PATH} does not define`,
      );
      continue;
    }

    const actual = [];
    const profileByTag = new Map();
    const unreachable = [];
    for (const [tag, registry] of Object.entries(manifest.registries)) {
      const held = registryHas(registry, api, entry.name);
      if (held === null) {
        unreachable.push(tag);
        continue;
      }
      if (held) {
        actual.push(tag);
        const members = membersByTag.get(tag);
        profileByTag.set(tag, members?.get(entry.name) ?? registry.profile);
      }
    }

    const claimed = entry.registries.filter(
      (tag) => !unreachable.includes(tag),
    );
    const missing = claimed.filter((tag) => !actual.includes(tag));
    const extra = actual.filter((tag) => !entry.registries.includes(tag));
    if (missing.length > 0) {
      findings.push(
        `${entry.name}: claims registry ${missing.join(", ")} but the implementation's lookup says no`,
      );
    }
    if (extra.length > 0) {
      findings.push(
        `${entry.name}: the implementation also holds it in ${extra.join(", ")}, which the entry does not record — a second registration that is not written down is one that can be lost unnoticed`,
      );
    }
    if (missing.length > 0 || extra.length > 0) {
      continue;
    }

    const summary = deriveSummary(manifest, entry.registries, profileByTag);
    if (entry.category !== summary.category) {
      findings.push(
        `${entry.name}: category "${entry.category}" but its registries derive "${summary.category}"`,
      );
    }
    if (entry.profile !== summary.profile) {
      findings.push(
        `${entry.name}: profile "${entry.profile}" but its precedence-winning registry owns "${summary.profile}"`,
      );
    }
  }
  return findings;
}

/**
 * The **implementation -> file** direction: every name any registry enumerates must have an entry
 * that records that registry.
 *
 * A registry whose enumerator is still `declared` cannot be walked, so names reachable only through
 * it are invisible in this direction. That is reported explicitly in the run summary rather than
 * passed over — an unreachable direction is a real limit of the gate, not a clean result.
 */
export function implementationFindings(manifest, api) {
  const findings = [];
  const byName = new Map(manifest.names.map((entry) => [entry.name, entry]));
  const excluded = new Set(manifest.excluded.map((entry) => entry.name));
  for (const [tag, registry] of Object.entries(manifest.registries)) {
    const members = registryMembers(registry, api);
    if (members === null) {
      continue;
    }
    for (const [name, profile] of members) {
      const entry = byName.get(name);
      if (entry === undefined) {
        findings.push(
          excluded.has(name)
            ? `${name}: the implementation registers it in ${tag}, but ${MANIFEST_PATH} excludes it as ${JSON.stringify(manifest.excluded.find((candidate) => candidate.name === name).reason)} — a carve-out and a registration cannot both be true`
            : `${name}: the implementation registers it in ${tag} (profile ${profile}) but it is absent from ${MANIFEST_PATH}`,
        );
        continue;
      }
      if (!entry.registries.includes(tag)) {
        findings.push(
          `${name}: the implementation registers it in ${tag} but its entry records only ${entry.registries.join(", ")}`,
        );
      }
    }
  }
  return findings;
}

/**
 * The whole profile-keyed registry, swept **profile by profile** rather than tag by tag.
 *
 * {@link implementationFindings} walks the registries the manifest names, so it can only see a
 * profile that already has a tag. This walks `OL_CHECK_PROFILES` instead, which is what makes the
 * gate cover a **tenth** profile the moment `PROFILE_PRIMITIVES` gains its entry — with no manifest
 * edit at all, and with `tsc` forcing that entry because the registry is a mapped type over
 * `CheckProfile` (issue #874). A gate that detects drift is good; one that cannot drift is better.
 *
 * It also pins the `profile` a name is filed under against the profile whose table actually holds
 * it, which no per-name lookup can do: `corePrimitiveArity("forward")` is `undefined` either way.
 */
export function profilePrimitiveSweepFindings(manifest, api) {
  const findings = [];
  const enumerate = resolveAccessor(api, "profilePrimitiveNames");
  if (enumerate === undefined) {
    return [
      "profilePrimitiveNames is not exported from @openlogo/parser, so the profile-keyed registry cannot be swept at all — every primitive tag's enumerate direction is unreachable",
    ];
  }
  const byName = new Map(manifest.names.map((entry) => [entry.name, entry]));
  for (const profile of api.OL_CHECK_PROFILES) {
    for (const name of enumerate(profile)) {
      const entry = byName.get(name);
      if (entry === undefined) {
        findings.push(
          `${name}: the ${profile} primitive registry holds it but it is absent from ${MANIFEST_PATH}`,
        );
        continue;
      }
      if (entry.profile !== profile) {
        findings.push(
          `${name}: filed under profile "${entry.profile}" but it is the ${profile} registry that holds it`,
        );
      }
    }
  }
  return findings;
}

/**
 * Alias edges. `aliasOf` is an edge rather than a parallel list precisely so it cannot drift from
 * its target — but only the Heritage half is verifiable against the implementation today.
 *
 * - **Heritage**: `canonicalOfHeritageAlias` exposes the edge the implementation actually resolves,
 *   so the recorded target is compared against it exactly.
 * - **Turtle & Rendering**: `setxy`/`setbg`/`setcolor`/`seth`/`setwidth` are independent arity
 *   entries bound to one primitive, with **no** canonical accessor anywhere and no resolution at
 *   all — which is precisely why they split at the call site. The strongest available check is that
 *   the target is a real entry sharing the alias's registry and arity. ADR-0021 §3 records this
 *   limit and names the enumerable canonical map that would close it.
 */
export function aliasFindings(manifest, api) {
  const findings = [];
  const byName = new Map(manifest.names.map((entry) => [entry.name, entry]));
  for (const entry of manifest.names) {
    if (entry.aliasOf === undefined) {
      continue;
    }
    const target = byName.get(entry.aliasOf);
    if (target === undefined) {
      findings.push(
        `${entry.name}: aliasOf "${entry.aliasOf}" is not an entry in ${MANIFEST_PATH}`,
      );
      continue;
    }
    if (entry.registries.includes("heritage-alias")) {
      const canonical = api.canonicalOfHeritageAlias(entry.name);
      if (canonical !== entry.aliasOf) {
        findings.push(
          `${entry.name}: aliasOf "${entry.aliasOf}" but canonicalOfHeritageAlias resolves ${JSON.stringify(canonical)}`,
        );
      }
      continue;
    }
    const shared = entry.registries.filter((tag) =>
      target.registries.includes(tag),
    );
    if (shared.length === 0) {
      findings.push(
        `${entry.name}: aliasOf "${entry.aliasOf}" but the two share no registry, so the edge cannot be checked at all`,
      );
      continue;
    }
    const spec = manifest.registries[shared[0]].lookup;
    if (spec.kind !== "arity") {
      continue;
    }
    const accessor = resolveAccessor(api, spec.accessor);
    const aliasArity = accessor(entry.name);
    const targetArity = accessor(entry.aliasOf);
    if (aliasArity !== targetArity) {
      findings.push(
        `${entry.name}: arity ${aliasArity} but its aliasOf target "${entry.aliasOf}" has arity ${targetArity}`,
      );
    }
  }
  return findings;
}

/**
 * The deliberate omissions, as data with reasons. Every one of them looks like an oversight to
 * anyone doing a "completeness" pass, which is exactly why the reasoning has to be machine-checked
 * rather than left in a comment.
 */
export function carveOutFindings(manifest, io) {
  const findings = [];
  const listed = new Set(manifest.names.map((entry) => entry.name));
  const seen = new Set();
  for (const entry of manifest.excluded) {
    if (seen.has(entry.name)) {
      findings.push(`excluded ${entry.name}: listed twice`);
      continue;
    }
    seen.add(entry.name);
    if (listed.has(entry.name)) {
      findings.push(
        `excluded ${entry.name}: also appears in names — a name is either a built-in name or a deliberate omission, never both`,
      );
    }
    if (typeof entry.rationale !== "string" || entry.rationale.length === 0) {
      findings.push(
        `excluded ${entry.name}: no rationale — a carve-out with no stated reason is indistinguishable from an oversight`,
      );
    }
    switch (entry.reason) {
      case "library":
        if (!io.exists(entry.source)) {
          findings.push(
            `excluded ${entry.name}: reason "library" names ${entry.source}, which does not exist — the carve-out only holds while the OpenLogo source does`,
          );
        }
        break;
      case "contextual-keyword":
        if (!Array.isArray(entry.positions) || entry.positions.length === 0) {
          findings.push(
            `excluded ${entry.name}: reason "contextual-keyword" records no positions — the positions are what make the word structural without OpenLogo owning the name`,
          );
        }
        break;
      default:
        findings.push(
          `excluded ${entry.name}: reason ${JSON.stringify(entry.reason)} is outside the closed vocabulary [library, contextual-keyword]`,
        );
    }
  }
  return findings;
}

/**
 * No unregistered profile. Every profile the checker knows must either ship at least one
 * `primitive` entry backed by a real registry, or be declared empty **with a reason**.
 *
 * This is the clause that catches a profile shipping a normative command that no registry knows —
 * the state Tutor (AI) was in, where `challenge` was in none of the arity tables while being
 * normative in `spec/conformance.md`. It is also why the gate is not a plain diff of whatever tables
 * happen to exist: a missing table must be a failure, not an empty set that trivially matches.
 */
export function profileCoverageFindings(manifest, api) {
  const findings = [];
  const declaredEmpty = manifest.profilesWithoutPrimitives ?? {};
  const withPrimitives = new Set(
    manifest.names
      .filter((entry) => entry.category === "primitive")
      .map((entry) => entry.profile),
  );
  for (const profile of api.OL_CHECK_PROFILES) {
    const reason = declaredEmpty[profile];
    if (withPrimitives.has(profile)) {
      if (reason !== undefined) {
        findings.push(
          `profile ${profile}: declared to ship no primitives, but ${MANIFEST_PATH} lists at least one — remove the declaration`,
        );
      }
      continue;
    }
    if (typeof reason !== "string" || reason.length === 0) {
      findings.push(
        `profile ${profile}: ships no primitive entry and is not declared in profilesWithoutPrimitives with a reason`,
      );
    }
  }
  for (const profile of Object.keys(declaredEmpty)) {
    if (!api.OL_CHECK_PROFILES.includes(profile)) {
      findings.push(
        `profilesWithoutPrimitives names ${profile}, which is not a profile the checker knows`,
      );
    }
  }
  return findings;
}

/** Every `` `word` `` in `text` whose content is a bare lowercase identifier, in order. */
export function backtickedWords(text) {
  const words = [];
  for (const match of text.matchAll(/`([a-z_?]+)`/g)) {
    words.push(match[1]);
  }
  return words;
}

/**
 * The normative keyword block: the fenced `logo` block that follows `spec/grammar.md`'s
 * "The normative OpenLogo keyword list is:" line.
 *
 * Anchored on the prose that is already there, because `spec/` is maintainer-owned and this gate
 * must never annotate the documents it reads. A missing anchor is a finding, not a skip.
 */
export function extractGrammarKeywordBlock(text) {
  const lines = text.split(/\r?\n/);
  const anchor = lines.findIndex((line) =>
    line.includes("The normative OpenLogo keyword list is:"),
  );
  if (anchor === -1) {
    return null;
  }
  const open = lines.indexOf("```logo", anchor);
  if (open === -1) {
    return null;
  }
  const close = lines.indexOf("```", open + 1);
  if (close === -1) {
    return null;
  }
  return lines
    .slice(open + 1, close)
    .join(" ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/**
 * The C19 mirror: the paragraph that follows `spec/tooling.md`'s "this is the C19 registry repeated"
 * sentence. This is the list that had already silently drifted to 43 words.
 */
export function extractToolingC19Mirror(text) {
  const lines = text.split(/\r?\n/);
  const anchor = lines.findIndex((line) =>
    line.includes("this is the C19 registry repeated"),
  );
  if (anchor === -1) {
    return null;
  }
  let start = anchor;
  while (start < lines.length && lines[start].trim() !== "") {
    start += 1;
  }
  const paragraph = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "") {
      break;
    }
    paragraph.push(lines[index]);
  }
  if (paragraph.length === 0) {
    return null;
  }
  return backtickedWords(paragraph.join(" "));
}

/** The `keyword` row of `spec/tooling.md`'s token-class table — the second hand-maintained list. */
export function extractToolingKeywordRow(text) {
  const row = text
    .split(/\r?\n/)
    .find((line) => line.startsWith("| `keyword` |"));
  return row ?? null;
}

/**
 * Both hand-maintained lists in `spec/tooling.md`, plus `spec/grammar.md`'s normative block.
 *
 * The C19 mirror is compared to the grammar block **in order** — `spec/grammar.md` is the normative
 * source and the mirror is byte-order-identical to it — while the manifest is compared as a **set**,
 * because `names` is sorted alphabetically for readable diffs and the prose is in the grammar's
 * teaching order.
 *
 * The token-class row is checked against the membership computed from the file's declared deltas,
 * so adding a keyword and forgetting the row fails here. The four omitted word-operators must also
 * be named in the row: they are there as an explicit exclusion, and a fifth word-spelled operator
 * added without updating that sentence would otherwise slip through.
 */
export function proseFindings(manifest, io) {
  const findings = [];
  const grammarWords = extractGrammarKeywordBlock(io.readText(GRAMMAR_PATH));
  if (grammarWords === null) {
    findings.push(
      `${GRAMMAR_PATH}: could not find the fenced keyword block after "The normative OpenLogo keyword list is:" — the anchor this gate reads has moved`,
    );
  }

  const toolingText = io.readText(TOOLING_PATH);
  const mirrorWords = extractToolingC19Mirror(toolingText);
  if (mirrorWords === null) {
    findings.push(
      `${TOOLING_PATH}: could not find the C19 mirror paragraph after "this is the C19 registry repeated" — the anchor this gate reads has moved`,
    );
  }

  const row = extractToolingKeywordRow(toolingText);
  if (row === null) {
    findings.push(
      `${TOOLING_PATH}: could not find the \`keyword\` token-class row — the anchor this gate reads has moved`,
    );
  }

  const coreKeywords = manifest.names
    .filter((entry) => entry.registries.includes("reserved"))
    .map((entry) => entry.name);

  if (grammarWords !== null) {
    const missing = coreKeywords.filter((word) => !grammarWords.includes(word));
    const extra = grammarWords.filter((word) => !coreKeywords.includes(word));
    if (missing.length > 0) {
      findings.push(
        `${GRAMMAR_PATH}: keyword block is missing ${missing.join(", ")} — present in ${MANIFEST_PATH}`,
      );
    }
    if (extra.length > 0) {
      findings.push(
        `${GRAMMAR_PATH}: keyword block lists ${extra.join(", ")}, absent from ${MANIFEST_PATH}`,
      );
    }
  }

  if (grammarWords !== null && mirrorWords !== null) {
    if (grammarWords.join(" ") !== mirrorWords.join(" ")) {
      findings.push(
        `${TOOLING_PATH}: the C19 mirror (${mirrorWords.length} words) is not byte-order-identical to ${GRAMMAR_PATH}'s normative block (${grammarWords.length} words) — it mirrors that list and must not diverge from it`,
      );
    }
  }

  if (row !== null) {
    const deltas = manifest.tokenClassKeyword;
    const omitted = deltas.omitsKeywords;
    const strayOmission = omitted.filter(
      (word) => !coreKeywords.includes(word),
    );
    if (strayOmission.length > 0) {
      findings.push(
        `${MANIFEST_PATH}: tokenClassKeyword.omitsKeywords names ${strayOmission.join(", ")}, which is not a keyword — a delta can only omit something the list holds`,
      );
    }
    const contextual = new Set(
      manifest.excluded
        .filter((entry) => entry.reason === "contextual-keyword")
        .map((entry) => entry.name),
    );
    const strayAddition = deltas.addsExcluded.filter(
      (word) => !contextual.has(word),
    );
    if (strayAddition.length > 0) {
      findings.push(
        `${MANIFEST_PATH}: tokenClassKeyword.addsExcluded names ${strayAddition.join(", ")}, which is not an excluded contextual keyword`,
      );
    }

    const profileWords = deltas.addsProfileKeywords
      ? manifest.names
          .filter((entry) => entry.registries.includes("profile-reserved"))
          .map((entry) => entry.name)
      : [];
    if (deltas.addsProfileKeywords) {
      // The row defers to the profile documents for the block-head NAMES rather than restating
      // them, so requiring each one to appear would create a third list to keep in step — exactly
      // what `spec/grammar.md:414` warns against. What the gate can assert without duplicating
      // anything is that the clause is still there and still says what the manifest records: a
      // reworded or deleted clause is a finding.
      const phrase = deltas.addsProfileKeywordsPhrase;
      if (typeof phrase !== "string" || phrase.length === 0) {
        findings.push(
          `${MANIFEST_PATH}: tokenClassKeyword.addsProfileKeywords is true but no addsProfileKeywordsPhrase records the clause the row must carry`,
        );
      } else if (!row.includes(phrase)) {
        findings.push(
          `${TOOLING_PATH}: the \`keyword\` token-class row no longer carries "${phrase}" — the clause that admits the ${profileWords.length} profile words into the class`,
        );
      }
    }
    const members = [
      ...coreKeywords.filter((word) => !omitted.includes(word)),
      ...deltas.addsExcluded,
    ];
    const rowWords = new Set(backtickedWords(row));
    const unnamed = members.filter((word) => !rowWords.has(word));
    if (unnamed.length > 0) {
      findings.push(
        `${TOOLING_PATH}: the \`keyword\` token-class row does not name ${unnamed.join(", ")} — the class is an enumeration, so every member has to appear in it`,
      );
    }
    const unexcluded = omitted.filter((word) => !rowWords.has(word));
    if (unexcluded.length > 0) {
      findings.push(
        `${TOOLING_PATH}: the \`keyword\` token-class row does not name ${unexcluded.join(", ")} as excluded from the class — an omission the row never mentions is indistinguishable from a forgotten member`,
      );
    }
  }

  return findings;
}

/**
 * The profile sections of `spec/conformance.md`: every `###` heading between the "Required
 * profiles" and "Feature to profile table" headings, which is the region covering the required and
 * optional profile sections. Anchored on the existing headings, fail-closed if either moves.
 */
export function extractConformanceProfiles(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf("## Required profiles");
  const end = lines.indexOf("## Feature to profile table");
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  return lines
    .slice(start, end)
    .filter((line) => line.startsWith("### "))
    .map((line) => line.slice(4).trim());
}

/**
 * Tie the profile inventory across all three surfaces: `spec/conformance.md`'s sections (the
 * normative inventory), the manifest's id map, and the checker's `OL_CHECK_PROFILES`.
 *
 * Without this, {@link profileCoverageFindings} would enumerate profiles from the *implementation*,
 * so a profile the spec adds and the checker has never heard of would be invisible — the gate would
 * cover twelve profiles because twelve ids happen to exist, which is the same shape as diffing
 * whatever tables happen to exist.
 */
export function profileInventoryFindings(manifest, api, io) {
  const findings = [];
  const sections = extractConformanceProfiles(io.readText(CONFORMANCE_PATH));
  if (sections === null) {
    findings.push(
      `${CONFORMANCE_PATH}: could not find the profile sections between "## Required profiles" and "## Feature to profile table" — the anchor this gate reads has moved`,
    );
  }
  const ids = manifest.profiles.ids;
  if (sections !== null) {
    const named = Object.values(ids);
    const unmapped = sections.filter((section) => !named.includes(section));
    const phantom = named.filter((name) => !sections.includes(name));
    if (unmapped.length > 0) {
      findings.push(
        `${CONFORMANCE_PATH}: profile section(s) ${unmapped.join(", ")} have no id in ${MANIFEST_PATH} — a profile the spec ships and the gate has never heard of is unchecked`,
      );
    }
    if (phantom.length > 0) {
      findings.push(
        `${MANIFEST_PATH}: profile name(s) ${phantom.join(", ")} have no section in ${CONFORMANCE_PATH}`,
      );
    }
  }
  const unknown = Object.keys(ids).filter(
    (id) => !api.OL_CHECK_PROFILES.includes(id),
  );
  const unlisted = api.OL_CHECK_PROFILES.filter((id) => ids[id] === undefined);
  if (unknown.length > 0) {
    findings.push(
      `${MANIFEST_PATH}: profile id(s) ${unknown.join(", ")} are not in the checker's OL_CHECK_PROFILES`,
    );
  }
  if (unlisted.length > 0) {
    findings.push(
      `${MANIFEST_PATH}: the checker knows profile(s) ${unlisted.join(", ")} that the manifest does not map to a ${CONFORMANCE_PATH} section`,
    );
  }
  return findings;
}

/** `specVersion` must match `openlogo.version`, or "ships with every spec version" is decorative. */
export function versionFindings(manifest, api) {
  if (manifest.specVersion === api.OPENLOGO_VERSION) {
    return [];
  }
  return [
    `specVersion "${manifest.specVersion}" does not match openlogo.version "${api.OPENLOGO_VERSION}" — the list is versioned WITH the specification`,
  ];
}

/**
 * Run every check and build the printable report. Never calls `process.exit` — the CLI shell
 * (`check-built-in-names.mjs`) does that from the returned `ok` flag.
 *
 * @returns `{ ok, findings, lines }`.
 */
export function runBuiltInNamesGate({
  manifestPath = MANIFEST_PATH,
  manifest,
  api = parserApi,
  io = REAL_IO,
} = {}) {
  const lines = [];
  let resolved = manifest;
  if (resolved === undefined) {
    if (!io.exists(manifestPath)) {
      lines.push(
        `built-in-names: ${manifestPath} does not exist — it is the authoritative source (ADR-0021)`,
      );
      return { ok: false, findings: lines.slice(), lines };
    }
    resolved = loadManifest(manifestPath, io);
  }

  const findings = [
    ...versionFindings(resolved, api),
    ...accessorFindings(resolved, api),
    ...entryFindings(resolved, api),
    ...implementationFindings(resolved, api),
    ...profilePrimitiveSweepFindings(resolved, api),
    ...aliasFindings(resolved, api),
    ...carveOutFindings(resolved, io),
    ...profileInventoryFindings(resolved, api, io),
    ...profileCoverageFindings(resolved, api),
    ...proseFindings(resolved, io),
  ];

  const unenumerable = Object.entries(resolved.registries)
    .filter(([, registry]) => registry.enumerate.status !== "present")
    .map(([tag]) => tag);

  for (const finding of findings) {
    lines.push(`FAIL ${finding}`);
  }
  lines.push(
    `built-in-names: ${resolved.names.length} names, ${resolved.excluded.length} carve-outs, ${Object.keys(resolved.registries).length} registries, spec version ${resolved.specVersion} — ${findings.length} finding(s)`,
  );
  if (unenumerable.length > 0) {
    lines.push(
      `built-in-names: NOTE ${unenumerable.join(", ")} cannot be enumerated yet, so the implementation->file direction is unchecked for names reachable only through them`,
    );
  }
  return { ok: findings.length === 0, findings, lines };
}

/** Parse argv for the CLI shell. `--manifest <path>` overrides the authoritative list's location. */
export function parseArgs(argv) {
  const options = {};
  const index = argv.indexOf("--manifest");
  if (index !== -1 && argv[index + 1] !== undefined) {
    options.manifestPath = argv[index + 1];
  }
  return options;
}
