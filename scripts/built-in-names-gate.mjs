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
 *    a hard-coded exception list, which would be the second list this gate exists to remove. Status
 *    attaches per **accessor**, not per tag, because a tag can be split: one registry's `lookup` can
 *    resolve while its `enumerate` does not exist. At `0.1.0` no tag is split and every accessor is
 *    `present` — the mechanism is there for the next one that is not.
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
import { join, resolve, sep } from "node:path";
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

/**
 * Where the OpenLogo standard library lives (ADR-0012). A `reason: "library"` carve-out claims the
 * name is OpenLogo **source** rather than a primitive, so its `source` must be a file under here —
 * pointing it at any other existing file would satisfy a bare existence check while proving nothing.
 */
export const STDLIB_DIR = "stdlib";

/**
 * The closed vocabulary of positions that make a contextual word structural
 * (`spec/grammar.md:380`): the `is`-predicate, and the heritage `value of … for key` reader. A
 * position outside this set is a typo or an invention, and either way the carve-out stops meaning
 * anything.
 */
export const CONTEXTUAL_POSITIONS = ["is-predicate", "value-of-reader"];

/**
 * Is `source` a file **inside** `stdlib/`, with a `.logo` extension?
 *
 * Containment, not a prefix test. `stdlib/../spec/examples/01-movement.logo` starts with `stdlib/`,
 * ends `.logo`, and exists — and the first version of this check passed it. That version was itself
 * a round-1 fix for "any file that exists"; replacing it with "any file whose *string* starts with
 * the right thing" inherited the same reasoning and so reproduced the same defect one step in. The
 * path is normalized and its containment asserted, rather than its spelling inspected.
 */
export function isStdlibSource(source) {
  if (typeof source !== "string" || !source.endsWith(".logo")) {
    return false;
  }
  const root = resolve(STDLIB_DIR);
  const target = resolve(source);
  return target.startsWith(root + sep) && target.length > root.length + 1;
}

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
 * Per accessor, not per tag, because a tag can be **split** — one registry's `lookup` resolving
 * while its `enumerate` does not exist. A per-tag status could not express that, and either reading
 * of it fails: call the tag `declared` and a resolving lookup reads as drift; call it `present` and
 * a missing enumerator goes unnoticed. At `0.1.0` no tag is split and every accessor is `present`;
 * ADR-0021 recorded ten as `declared` at its own date, and #837/#838/#874 closed all ten before
 * this gate landed.
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
      // Checked before `status`, because a status is a claim ABOUT an accessor and an entry with no
      // accessor name has nothing to claim. Measured: `{ kind, status: "declared" }` with no
      // `accessor` reported zero findings and silently disabled that whole direction — `resolveAccessor`
      // reads `api[undefined]`, which is `undefined`, which is exactly what a `declared` accessor is
      // supposed to look like. Invariants 4 and 5 both depend on this.
      if (typeof spec.accessor !== "string" || spec.accessor.length === 0) {
        findings.push(
          `registry ${tag}.${role}: no accessor named — a status is a claim about an accessor, so an entry with no name silently disables this direction`,
        );
        continue;
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
 * Alias edges, checked **against the edge the implementation actually resolves, in both
 * directions**.
 *
 * `aliasOf` is an edge rather than a parallel list precisely so it cannot drift from its target,
 * but an edge is only as good as the accessor that can confirm it. Two registries carry edges and
 * each names its own resolver in the manifest: `heritageAliasNames`/`canonicalOfHeritageAlias` for
 * the 13 Heritage short spellings, and `turtleAliasNames`/`canonicalOfTurtleAlias` for the five
 * Turtle & Rendering one-word spellings.
 *
 * **The turtle accessor did not exist before this slice**, and its absence made the check
 * decorative on the ADR's own worked example: with only "the target is an entry of equal arity"
 * available, `setxy → distance` and `setxy → towards` both passed. `spec/commands.md` gives those
 * five as alias spellings, so ADR-0021 §3 requires the map — **consumed by the resolver, so it
 * cannot drift** — as part of the public-API addition §4 already asks of #841.
 *
 * Both directions matter. An entry claiming an edge the implementation does not resolve is drift;
 * so is an entry silently dropping an edge the implementation still has, which the forward loop
 * cannot see because `aliasOf` is optional.
 */
export function aliasFindings(manifest, api) {
  const findings = [];
  const byName = new Map(manifest.names.map((entry) => [entry.name, entry]));
  // tag -> the accessor that resolves an edge in that registry, from the manifest's own data.
  const edgeTags = Object.entries(manifest.registries)
    .filter(([, registry]) => registry.canonicalAccessor !== undefined)
    .map(([tag]) => tag);

  for (const entry of manifest.names) {
    const carrying = entry.registries.filter((tag) => edgeTags.includes(tag));
    if (entry.aliasOf === undefined) {
      continue;
    }
    if (carrying.length === 0) {
      // Measured: `define.aliasOf = "end"` used to pass, because a keyword registry has no arity
      // lookup and the check simply skipped it. An alias edge on a registry that carries no edges
      // is meaningless, and meaningless is not the same as absent.
      findings.push(
        `${entry.name}: records aliasOf "${entry.aliasOf}" but none of its registries (${entry.registries.join(", ")}) carries alias edges`,
      );
      continue;
    }
    if (carrying.length > 1) {
      // No entry carries two edge registries at `0.1.0`, and none should: the verdict below would
      // otherwise depend on the order of `registries[]`, so a cosmetic reorder could flip the gate.
      findings.push(
        `${entry.name}: is in ${carrying.length} registries that each carry alias edges (${carrying.join(", ")}) — one name has one canonical, so this is ambiguous rather than merely unusual`,
      );
      continue;
    }
    if (byName.get(entry.aliasOf) === undefined) {
      findings.push(
        `${entry.name}: aliasOf "${entry.aliasOf}" is not an entry in ${MANIFEST_PATH}`,
      );
      continue;
    }
    const accessorName = manifest.registries[carrying[0]].canonicalAccessor;
    const resolveEdge = resolveAccessor(api, accessorName);
    if (resolveEdge === undefined) {
      findings.push(
        `${entry.name}: ${accessorName} is not exported from @openlogo/parser, so its alias edge cannot be verified`,
      );
      continue;
    }
    const canonical = resolveEdge(entry.name);
    if (canonical !== entry.aliasOf) {
      findings.push(
        `${entry.name}: aliasOf "${entry.aliasOf}" but ${accessorName} resolves ${JSON.stringify(canonical)}`,
      );
      continue;
    }
    // The registry's two accessors must also agree with each other. Measured: making
    // `turtleAliasNames()` omit `setxy` while `canonicalOfTurtleAlias("setxy")` still resolved left
    // the gate green, because the forward loop asks only the resolver and the reverse loop walks
    // only the enumerator. A gate that reads one side of a two-sided contract certifies half of it.
    const enumerator = manifest.registries[carrying[0]].aliasEnumerator;
    const names = resolveAccessor(api, enumerator);
    if (names !== undefined && !names().includes(entry.name)) {
      findings.push(
        `${entry.name}: ${accessorName} resolves its edge but ${enumerator} does not list it — the registry's two accessors disagree`,
      );
    }
  }

  // The other direction. `aliasOf` is optional, so an entry that simply drops its edge is invisible
  // to the loop above: measured, deleting ALL 18 edges left the gate green while the implementation
  // still resolved every one of them. An edge the implementation has and the list does not is drift
  // in exactly the same way as the reverse.
  for (const [tag, registry] of Object.entries(manifest.registries)) {
    if (registry.canonicalAccessor === undefined) {
      continue;
    }
    const names = resolveAccessor(api, registry.aliasEnumerator);
    const resolve = resolveAccessor(api, registry.canonicalAccessor);
    if (names === undefined || resolve === undefined) {
      findings.push(
        `registry ${tag}: names ${registry.aliasEnumerator} / ${registry.canonicalAccessor} for its alias edges, and at least one is not exported from @openlogo/parser`,
      );
      continue;
    }
    for (const name of names()) {
      const entry = byName.get(name);
      if (entry === undefined) {
        findings.push(
          `${name}: ${registry.aliasEnumerator} lists it as an alias of "${resolve(name)}" but it has no entry in ${MANIFEST_PATH}`,
        );
        continue;
      }
      if (entry.aliasOf === undefined) {
        findings.push(
          `${name}: ${registry.canonicalAccessor} resolves it to "${resolve(name)}" but its entry records no aliasOf — a dropped edge is drift, not an absent one`,
        );
      }
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
    if (entry.reason !== "library" && entry.source !== undefined) {
      // Measured: relabelling `arc` from `library` to `contextual-keyword` kept its `source` and
      // stopped it being existence-checked, so a carve-out could escape clause 3 by changing one
      // word. A `source` that nothing checks is worse than no `source`.
      findings.push(
        `excluded ${entry.name}: reason "${entry.reason}" carries a source (${entry.source}) that nothing checks — only a "library" carve-out has one`,
      );
    }
    switch (entry.reason) {
      case "library":
        if (!isStdlibSource(entry.source)) {
          findings.push(
            `excluded ${entry.name}: reason "library" names ${JSON.stringify(entry.source)}, which is not a ${STDLIB_DIR}/*.logo path — the carve-out is that the name is OpenLogo SOURCE (ADR-0012), so any other file would prove nothing`,
          );
        } else if (!io.exists(entry.source)) {
          findings.push(
            `excluded ${entry.name}: reason "library" names ${entry.source}, which does not exist — the carve-out only holds while the OpenLogo source does`,
          );
        }
        break;
      case "contextual-keyword": {
        if (!Array.isArray(entry.positions) || entry.positions.length === 0) {
          findings.push(
            `excluded ${entry.name}: reason "contextual-keyword" records no positions — the positions are what make the word structural without OpenLogo owning the name`,
          );
          break;
        }
        const unknown = entry.positions.filter(
          (position) => !CONTEXTUAL_POSITIONS.includes(position),
        );
        if (unknown.length > 0) {
          findings.push(
            `excluded ${entry.name}: position(s) ${unknown.join(", ")} are outside the closed vocabulary [${CONTEXTUAL_POSITIONS.join(", ")}]`,
          );
        }
        break;
      }
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
  // The FIRST fence after the anchor, whatever its info string — not the next ```logo anywhere
  // below. Issue #888 re-fenced this block from ```logo to ```text (it is a word list, not a
  // runnable program), and an info-string-specific search silently walked past it to the next
  // ```logo block twenty lines further down and compared the wrong text. Searching for a specific
  // info string is a guess about the document; "the block immediately after the sentence that
  // introduces it" is the structure.
  const open = lines.findIndex(
    (line, index) => index > anchor && line.startsWith("```"),
  );
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
    findings.push(...tokenClassFindings(manifest, coreKeywords, row));
  }

  return findings;
}

/**
 * The `keyword` **token-class** row, compared by **set equality with polarity** rather than by
 * "every expected word appears somewhere".
 *
 * The one-directional form was green against five separate mutations — flipping
 * `addsProfileKeywords` off, deleting `mod` from the omissions, deleting `a` from the additions,
 * **adding `polygon` to the enumeration**, and rewriting "are **not** in this class" to "are in this
 * class". A membership check that cannot see an *extra* member is not a membership check.
 *
 * So the row is split at its exclusion clause, whose anchors the manifest declares:
 *
 * - the **enumeration segment** before it must name **exactly** the computed membership;
 * - the words inside the **exclusion clause** must be **exactly** `omitsKeywords`;
 * - the clause's negative polarity must still be stated, or an omission reads as an inclusion.
 *
 * The row defers to the profile documents for the block-head *names* rather than restating them
 * (`spec/grammar.md:414` — no second list to keep in step), so the manifest records which profile
 * words the row names **individually** and the rest are carried by the declared clause. That keeps
 * set equality exact without duplicating a third list.
 */
export function tokenClassFindings(manifest, coreKeywords, row) {
  const findings = [];
  const deltas = manifest.tokenClassKeyword;
  const omitted = deltas.omitsKeywords;
  const strayOmission = omitted.filter((word) => !coreKeywords.includes(word));
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

  const anchors = deltas.rowAnchors;
  const start = row.indexOf(anchors.exclusionClause);
  if (start === -1) {
    findings.push(
      `${TOOLING_PATH}: the \`keyword\` token-class row no longer carries "${anchors.exclusionClause}" — the clause this gate splits the enumeration on has moved`,
    );
    return findings;
  }
  const polarity = row.indexOf(anchors.exclusionPolarity, start);
  if (polarity === -1) {
    findings.push(
      `${TOOLING_PATH}: the \`keyword\` token-class row's exclusion clause no longer says "${anchors.exclusionPolarity}" — without the negative polarity an omission reads as an inclusion`,
    );
    return findings;
  }

  // Drop the leading `| `keyword` |` cell so the class's own name is not read as a member.
  const cellStart = row.indexOf("|", 1) + 1;
  const enumerated = new Set(backtickedWords(row.slice(cellStart, start)));
  const excludedWords = new Set(backtickedWords(row.slice(start, polarity)));

  const named = deltas.addsProfileKeywords
    ? deltas.addsProfileKeywordsNamedIndividually
    : [];
  const expected = new Set([
    ...coreKeywords.filter((word) => !omitted.includes(word)),
    ...deltas.addsExcluded,
    ...named,
  ]);

  const missing = [...expected].filter((word) => !enumerated.has(word));
  const extra = [...enumerated].filter((word) => !expected.has(word));
  if (missing.length > 0) {
    findings.push(
      `${TOOLING_PATH}: the \`keyword\` token-class row does not name ${missing.join(", ")} — the class is an enumeration, so every member has to appear in it`,
    );
  }
  if (extra.length > 0) {
    findings.push(
      `${TOOLING_PATH}: the \`keyword\` token-class row names ${extra.join(", ")}, which ${MANIFEST_PATH} does not put in the class — an enumeration is wrong when it says too much, not only when it says too little`,
    );
  }

  const unexcluded = omitted.filter((word) => !excludedWords.has(word));
  const overexcluded = [...excludedWords].filter(
    (word) => !omitted.includes(word),
  );
  if (unexcluded.length > 0) {
    findings.push(
      `${TOOLING_PATH}: the row's exclusion clause does not name ${unexcluded.join(", ")} — an omission the row never mentions is indistinguishable from a forgotten member`,
    );
  }
  if (overexcluded.length > 0) {
    findings.push(
      `${TOOLING_PATH}: the row's exclusion clause names ${overexcluded.join(", ")}, which ${MANIFEST_PATH} does not omit from the class`,
    );
  }

  if (deltas.addsProfileKeywords && !row.includes(anchors.profileClause)) {
    const deferred = manifest.names.filter(
      (entry) =>
        entry.registries.includes("profile-reserved") &&
        !named.includes(entry.name),
    ).length;
    findings.push(
      `${TOOLING_PATH}: the \`keyword\` token-class row no longer carries "${anchors.profileClause}" — the clause that admits the ${deferred} profile words it does not name individually`,
    );
  }

  // The tail after the exclusion clause is read by neither segment above, and it carries two claims
  // that restate data this file already holds. Both were measured green while contradicting it: the
  // delta counts ("omits four … adds four …") survived a fifth omission, and the independence
  // sentence survived being inverted to "derived from". Restating a number the manifest computes is
  // the second-list problem this gate exists to remove, so the expected sentences are BUILT from
  // the data rather than declared alongside it.
  const expectedDeltas = anchors.deltaSentence
    .replace("{omits}", numberWord(omitted.length))
    .replace("{adds}", numberWord(deltas.addsExcluded.length));
  if (!row.includes(expectedDeltas)) {
    findings.push(
      `${TOOLING_PATH}: the \`keyword\` token-class row does not say "${expectedDeltas}" — it states the deltas in prose, and the count it states must be the count ${MANIFEST_PATH} holds`,
    );
  }
  if (!row.includes(anchors.independenceClause)) {
    findings.push(
      `${TOOLING_PATH}: the \`keyword\` token-class row no longer says "${anchors.independenceClause}" — that the class is NOT derived from the keyword list is what \`spec/grammar.md:378\` establishes and what this whole file is premised on`,
    );
  }

  return findings;
}

/**
 * The English word for a small count, because `spec/tooling.md` spells its counts out. Falls back
 * to digits above twelve, which is past anything the deltas can plausibly reach — and would be a
 * visible prose change rather than a silent one.
 */
export function numberWord(count) {
  return (
    [
      "zero",
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
      "eleven",
      "twelve",
    ][count] ?? String(count)
  );
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

/**
 * The file's own prose must be present. Small, but it is the part a reader relies on to understand
 * what the data means, and blanking it left the gate green — a manifest that validates 148 entries
 * and not its own contract statement is asserting the wrong things about itself.
 */
export function narrativeFindings(manifest) {
  const findings = [];
  if (typeof manifest.about !== "string" || manifest.about.length === 0) {
    findings.push(
      `${MANIFEST_PATH}: no \`about\` — the file is normative, so what it claims to be is part of the contract`,
    );
  }
  for (const key of [
    "unconditional",
    "precedence",
    "bothDirections",
    "accessorStatus",
    "derivedEnumeration",
  ]) {
    const value = manifest.invariants?.[key];
    if (typeof value !== "string" || value.length === 0) {
      findings.push(
        `${MANIFEST_PATH}: invariants.${key} is missing or empty — ADR-0021 §2's invariants are the normative part, and an unstated one cannot be reviewed`,
      );
    }
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
    ...narrativeFindings(resolved),
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
