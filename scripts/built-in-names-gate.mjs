/**
 * Logic module for the **built-in names** Definition-of-Done gate (issue #841, epic #834).
 * Extracted so tests can import it directly for 100% coverage, keeping
 * `scripts/check-built-in-names.mjs` a thin CLI shell — the same shape
 * `scripts/examples-gate.mjs` and `scripts/markdown-examples-gate.mjs` already have, and outside the
 * loaded-module coverage set [ADR-0009](../docs/adr/0009-test-layout.md) defines.
 *
 * **Why this exists.** `spec/grammar.md:414` versions the built-in names with the specification —
 * *"there is no second list to keep in step"* — and `:363` governs them with one rule: a program may
 * not **declare** a built-in name, and may **bind** a value to any name. Nothing stated what that
 * set is, and nothing compared the spec to the implementation.
 * [ADR-0021](../docs/adr/0021-built-in-names-list-and-ci-gate.md) makes
 * `spec/built-in-names.json` authoritative; this module is the assertion that the implementation
 * equals it.
 *
 * ## What this gate catches is recorded in `built-in-names-gate.test.mjs`, not here
 *
 * Every `INJECTED DRIFT:` test title names one drift this module detects, and the test either fires
 * or it does not. That is deliberate, and it is the outcome of this slice's review: across ten rounds
 * essentially every finding was *"a gate green while checking less than it claimed"* — and the claims
 * were in prose here, where **nothing recomputes them**. One paragraph described machinery this same
 * commit had replaced; another asserted a branch was unreachable, and it threw.
 *
 * **A claim that must be executable cannot overstate.** So the capability claims live in the test
 * names. Read them for what is covered; the comments below say only what the code does and why it is
 * shaped that way.
 *
 * ## Two constraints that are not claims
 *
 * **Fail closed.** A moved prose anchor, an accessor kind this module does not know, or a status
 * outside the closed vocabulary is a **finding**, never a silent skip: a gate that quietly checks
 * nothing is worse than no gate, because it also removes the human who was checking.
 *
 * **`spec/` is maintainer-owned** (AGENTS.md), so this gate must never add markers, tags or
 * annotations to the documents it reads — the same constraint that keeps
 * `scripts/examples-profiles.json` out of `spec/examples/`. It anchors on prose already there.
 *
 * ## The one limit worth stating in full
 *
 * `spec/tooling.md`'s `keyword` token-class row is **change-detected, not derived** — a content
 * fingerprint tells you it moved; **nothing verifies it is still true.** It cannot be derived:
 * `spec/grammar.md:378` says the token class and the keyword list are "different sets on purpose,
 * and neither one determines the other", and measurement agrees — the class omits the word-spelled
 * operators (`and`/`or`/`not`/`mod`), adds contextual words that are not built-in names at all
 * (`empty`/`member`/`of`/`a`), and adds the profile words. A positional rule is refuted by
 * `local end` / `export end` / `:p.end` all emitting `keyword`. Issue #841 records the three
 * mechanisms that tried for more and each overstated what it checked.
 *
 * `spec/tooling.md`'s C19 mirror, by contrast, **is** derived — compared word-for-word against
 * `spec/grammar.md`'s normative block, which is compared against this manifest.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
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
 * How an accessor is adapted to each of the two roles. The nine `*PrimitiveArity` functions are
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
 * Is `source` a `.logo` file the manifest may point a `library` carve-out at?
 *
 * The spelling is not inspected at all: {@link REAL_IO.isStdlibFile} resolves the real path,
 * requires it to be a real **file**, and requires it to remain beneath the real `stdlib/` root —
 * which a symlink escaping the directory does not, and a directory named `example.logo` is not. A
 * lexical prefix test is a containment test's clothes without its body.
 *
 * The extension is checked here because it is a statement about the manifest, not the filesystem.
 */
export function isStdlibSource(source, io) {
  return (
    typeof source === "string" &&
    // Case-SENSITIVE, deliberately. `realpathSync` does not canonicalise case on Windows, so a
    // case-insensitive extension test made the verdict depend on the host: `stdlib/x.LOGO` was
    // accepted here and rejected on CI's `ubuntu-latest`. A gate whose answer for a fixed manifest
    // changes with the filesystem is worse than one that is strict everywhere.
    source.endsWith(".logo") &&
    io.isStdlibFile(source)
  );
}

/**
 * The canonical spelling of an OpenLogo built-in name: lowercase ASCII, digits, `_`, and a trailing
 * `?`/`!` for the predicate and mutating spellings the spec allows.
 *
 * Both sides mutated *consistently* is the hole this closes. A manifest entry spelled `ABS` with an
 * implementation that also answers for `ABS` satisfies every membership comparison here — they
 * genuinely agree — while agreeing about a name `spec/grammar.md` does not permit. Agreement is not
 * correctness when both sides can move together.
 */
export function isCanonicalName(name) {
  return typeof name === "string" && /^[a-z_][a-z0-9_]*[?!]?$/.test(name);
}

/**
 * Does `source` define an OpenLogo procedure literally named `name`?
 *
 * The path check above proves a *file* exists; this binds the carve-out's `name` to it.
 *
 * Deliberately a lexical scan for the `define` header rather than a parse: this module reads `spec/`
 * and `stdlib/` as text and must not acquire a dependency on the runtime it is auditing. Tokenised
 * rather than matched with a regex built from manifest data, so a name carrying regex
 * metacharacters cannot change what is being asked. Anchored on the Core spelling
 * (`spec/grammar.md`), so a Heritage `to` header would not satisfy it — correct, because `stdlib/`
 * is Core-profile source.
 */
export function definesProcedure(text, name) {
  if (typeof text !== "string") {
    return false;
  }
  return codeOnly(text)
    .split("\n")
    .some((line) => {
      const words = line.trim().split(/\s+/);
      return words[0] === "define" && words[1] === name;
    });
}

/**
 * `source` with comments and string literals blanked out, newlines preserved.
 *
 * A single split on `"""` is not enough, because `spec/grammar.md:19` allows `\"` escapes inside a
 * literal and `:32` makes `#`, `//` and `/* *` + `/` comments — whose markers are literal *inside*
 * strings, and whose contents can therefore contain an unbalanced quote. Each construct has to be
 * recognised in the order the lexer would meet it, so the states below are mutually exclusive.
 */
export function codeOnly(source) {
  const normalised = source.replace(/\r\n/g, "\n");
  let out = "";
  let index = 0;
  const keepLayout = (text) => text.replace(/[^\n]/g, " ");
  while (index < normalised.length) {
    const rest = normalised.slice(index);
    const blockComment = /^\/\*[\s\S]*?(\*\/|$)/.exec(rest);
    const lineComment = /^(#|\/\/)[^\n]*/.exec(rest);
    const multiString = /^"""[\s\S]*?(?<!\\)(?:\\\\)*(?:"""|$)/.exec(rest);
    const singleString = /^"(?:[^"\\\n]|\\.)*("|$)/.exec(rest);
    const match =
      blockComment ?? lineComment ?? multiString ?? singleString ?? null;
    if (match === null) {
      out += normalised[index];
      index += 1;
      continue;
    }
    out += keepLayout(match[0]);
    index += match[0].length;
  }
  return out;
}

/** Default filesystem port, so tests can drive every branch without touching disk. */
export const REAL_IO = {
  readText: (path) => readFileSync(path, "utf8"),
  exists: (path) => existsSync(path),
  // Real-path containment, not a lexical one, and a real FILE, not merely an existing entry. A
  // directory named `stdlib/example.logo` and a symlink pointing out of `stdlib/` both satisfy
  // "exists" and both satisfy a string test; neither is OpenLogo source.
  isStdlibFile: (path) => {
    try {
      if (!statSync(path).isFile()) {
        return false;
      }
      // `startsWith(root + sep)` alone. A second `target.length > root.length + 1` clause looked
      // prudent and was unreachable — the caller has already required a `.logo` suffix, so `target`
      // can never be exactly `root + sep`. An unreachable clause inside a 100%-branch-covered file
      // is invisible to the coverage gate, which is how the round-2 unreachable `throw` survived.
      const root = realpathSync(STDLIB_DIR);
      return realpathSync(path).startsWith(root + sep);
    } catch {
      return false;
    }
  },
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
 * The shape each accessor `kind` must have when its status is `present`, and the human wording used
 * when it does not.
 *
 * A `status` says whether an export *should* exist; it says nothing about whether what came back is
 * usable, and the consumers here call what they are given.
 */
export const ACCESSOR_SHAPES = {
  array: "an array",
  record: "an object keyed by profile",
  arity: "a function",
  enumerator: "a function",
  "profile-enumerator": "a function",
};

/** Does `resolved` have the shape `kind` requires? */
export function hasAccessorShape(resolved, kind) {
  switch (kind) {
    case "array":
      return Array.isArray(resolved);
    case "record":
      return (
        typeof resolved === "object" &&
        resolved !== null &&
        !Array.isArray(resolved)
      );
    case "arity":
    case "enumerator":
    case "profile-enumerator":
      return typeof resolved === "function";
    default:
      // An unknown kind has no shape this module can verify, so nothing may be assumed usable.
      // Returning `true` here read as "fine" and let consumers call it: three of four registries
      // crashed on a one-character typo in `kind`, replacing `accessorFindings`' own correct
      // vocabulary finding with a stack trace.
      return false;
  }
}

/** How a resolved export reads in a finding. Only called for values that exist. */
export function describeAccessor(resolved) {
  if (resolved === null) {
    return "exported as null";
  }
  if (Array.isArray(resolved)) {
    return "an array";
  }
  return typeof resolved === "object" ? "an object" : `a ${typeof resolved}`;
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
  const profileNames = Object.keys(manifest.profiles.ids);
  for (const [tag, registry] of Object.entries(manifest.registries)) {
    if (!CATEGORIES.includes(registry.category)) {
      findings.push(
        `registry ${tag}: category ${JSON.stringify(registry.category)} is outside the closed vocabulary [${CATEGORIES.join(", ")}]`,
      );
    }
    // Validated directly, not incidentally. Most tags are caught through an entry whose derived
    // profile stops matching, but `heritage-form-head` and `heritage-worded-form-head` currently win
    // precedence for no entry, so nothing ever read their `profile` and any value passed.
    // A `record` registry is the one shape that legitimately has none: it supplies a profile per key.
    if (registry.profile === undefined) {
      if (registry.enumerate?.kind !== "record") {
        findings.push(
          `registry ${tag}: no profile, and its enumerate kind is not \`record\` — only a Record registry supplies a profile per key, so this tag has no profile source at all`,
        );
      }
    } else if (!profileNames.includes(registry.profile)) {
      findings.push(
        `registry ${tag}: profile ${JSON.stringify(registry.profile)} is not one of the ids in profiles.ids — \`invariants.precedence\` files a name under its precedence-winning registry's profile, so a tag no entry currently wins is still load-bearing for the next one`,
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
      // Checked before `status`, because a status is a claim ABOUT an accessor, and an entry with
      // no accessor name has nothing to claim: `resolveAccessor` would read `api[undefined]`, which
      // is indistinguishable from a `declared` accessor's expected absence.
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
      } else if (
        spec.status === "present" &&
        ACCESSOR_KINDS.includes(spec.kind) &&
        !hasAccessorShape(resolved, spec.kind)
      ) {
        // Skipped for an unknown `kind`, whose own vocabulary finding above is the actionable one —
        // but `hasAccessorShape` still answers `false` there, so consumers read it as unreachable
        // instead of calling it.
        findings.push(
          `registry ${tag}.${role}: ${spec.accessor} is declared "present" with kind ${JSON.stringify(spec.kind)}, but it is ${describeAccessor(resolved)} rather than ${ACCESSOR_SHAPES[spec.kind]}`,
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
  if (spec === undefined || spec.status !== "present") {
    return null;
  }
  const accessor = resolveAccessor(api, spec.accessor);
  // Shape, not just presence. An export of the wrong shape is unusable, and reading it as
  // unreachable here is what stops `accessorFindings` reporting it while the very next consumer
  // crashes on it — the findings list is an eager array literal, so a finding never guards a call.
  if (!hasAccessorShape(accessor, spec.kind)) {
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
  if (spec === undefined || spec.status !== "present") {
    return null;
  }
  const accessor = resolveAccessor(api, spec.accessor);
  if (!hasAccessorShape(accessor, spec.kind)) {
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

/** The names a sequence lists more than once, in first-appearance order. */
export function duplicatedNames(names) {
  return [
    ...new Set(names.filter((name, index) => names.indexOf(name) !== index)),
  ];
}

/**
 * Re-derive `category` and `profile` from a name's registry membership, under the two-level
 * precedence `invariants.precedence` states: `keyword` beats `primitive` by category, then the
 * earlier key in `registries` wins among tags of the same category.
 *
 * Only the summary is derived; the full membership stays on the entry, because six names at `0.1.0`
 * are reachable from two registries and one `category`/`profile` pair cannot express that.
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

    if (!isCanonicalName(entry.name)) {
      findings.push(
        `${entry.name}: is not a canonical OpenLogo name — spec/grammar.md:15's ASCII core form is \`[a-z_][a-z0-9_]*[?!]?\`, and built-in keywords and primitives are lowercase ASCII. A manifest and an implementation that agree on a non-canonical spelling agree about something the language does not allow`,
      );
    }
    const repeatedTags = duplicatedNames(entry.registries);
    if (repeatedTags.length > 0) {
      findings.push(
        `${entry.name}: records registry ${repeatedTags.join(", ")} more than once — ${entry.registries.length} entries, ${new Set(entry.registries).size} unique; the set comparison below cannot see the difference`,
      );
    }

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
 * A registry whose enumerator is still `declared` cannot be walked; the run summary reports that
 * direction as unreachable rather than passing over it.
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
 * One registry's `lookup` and `enumerate` compared on the same name.
 *
 * **Scope, because it is narrower than it looks.** For the nine primitive tags the two roles are one
 * source read twice — `PROFILE_PRIMITIVE_NAMES` is `[...tables.arity.keys()]` and `<X>PrimitiveArity`
 * reads that same Map (`packages/parser/src/signatures.ts`) — so no source edit can make them
 * disagree about *membership*. What differs is normalisation: the lookup lowercases its argument and
 * the enumerator does not.
 */
export function directionAgreementFindings(manifest, api) {
  const findings = [];
  const universe = [
    ...manifest.names.map((entry) => entry.name),
    ...manifest.excluded.map((entry) => entry.name),
  ];
  for (const [tag, registry] of Object.entries(manifest.registries)) {
    const members = registryMembers(registry, api);
    if (members === null) {
      continue;
    }
    for (const name of new Set([...universe, ...members.keys()])) {
      const held = registryHas(registry, api, name);
      if (held === null) {
        // Name-independent: the lookup direction is unreachable for this whole registry.
        break;
      }
      if (held === members.has(name)) {
        continue;
      }
      findings.push(
        `${name}: registry ${tag}'s lookup (${registry.lookup.accessor}) ${held ? "holds" : "does not hold"} it but its enumerator (${registry.enumerate.accessor}) ${members.has(name) ? "lists" : "does not list"} it — one registry's two directions disagree, and every other check here reads only one of them`,
      );
    }
  }
  return findings;
}

/**
 * The profile-keyed primitive registry, swept **profile by profile** over `OL_CHECK_PROFILES` rather
 * than tag by tag, so a tenth profile is covered the moment `PROFILE_PRIMITIVES` gains its entry —
 * with no manifest edit, and with `tsc` forcing that entry because the registry is a mapped type
 * over `CheckProfile` (#874).
 *
 * Each enumerated name must record that profile's primitive tag, and the profile must have one.
 */
export function profilePrimitiveSweepFindings(manifest, api) {
  const findings = [];
  const enumerate = resolveAccessor(api, "profilePrimitiveNames");
  if (typeof enumerate !== "function") {
    return [
      `profilePrimitiveNames is ${enumerate === undefined ? "not exported from @openlogo/parser" : describeAccessor(enumerate)}, so the profile-keyed registry cannot be swept at all — every primitive tag's enumerate direction is unreachable`,
    ];
  }
  const byName = new Map(manifest.names.map((entry) => [entry.name, entry]));
  const tagByProfile = new Map(
    Object.entries(manifest.registries)
      .filter(
        ([, registry]) =>
          registry.enumerate?.kind === "profile-enumerator" &&
          registry.enumerate.accessor === "profilePrimitiveNames",
      )
      .map(([tag, registry]) => [registry.profile, tag]),
  );
  for (const profile of api.OL_CHECK_PROFILES) {
    const names = enumerate(profile);
    const tag = tagByProfile.get(profile);
    if (tag === undefined) {
      if (names.length > 0) {
        findings.push(
          `profile ${profile}: profilePrimitiveNames enumerates ${names.length} name(s) for it, but ${MANIFEST_PATH} defines no primitive registry tag for that profile — a table the file does not know about is one nothing compares`,
        );
      }
      continue;
    }
    for (const name of names) {
      const entry = byName.get(name);
      if (entry === undefined) {
        findings.push(
          `${name}: the ${profile} primitive registry holds it but it is absent from ${MANIFEST_PATH}`,
        );
        continue;
      }
      if (!entry.registries.includes(tag)) {
        findings.push(
          `${name}: the ${profile} primitive registry holds it but its entry records ${entry.registries.join(", ")} — not ${tag}`,
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
 * Alias edges, checked against the edge the implementation actually resolves, **in both directions**.
 *
 * `aliasOf` is an edge rather than a parallel list so it cannot drift from its target. Two registries
 * carry edges and each names its own resolver and enumerator in the manifest:
 * `heritageAliasNames`/`canonicalOfHeritageAlias` for the Heritage short spellings, and
 * `turtleAliasNames`/`canonicalOfTurtleAlias` for the Turtle & Rendering one-word spellings. The
 * turtle pair is added by this slice — ADR-0021 §3 requires it — and supersedes the equal-arity
 * fallback that ADR records in the past tense.
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
      // An alias edge on a registry that carries no edges is meaningless, and meaningless is not
      // the same as absent.
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
    if (typeof resolveEdge !== "function") {
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
    }
    // No resolver-vs-enumerator check here: the whole-registry sweep below walks a universe that
    // includes every manifest entry, so it already reports exactly this disagreement — and reported
    // it *twice*, in two wordings, when both loops fired. The reverse loop exists to catch what this
    // one cannot see; where it can see the same thing, this one says nothing.
  }

  // The three domains must agree **as sets**, walked over a universe wider than any one of them:
  // the forward loop visits only entries that already claim an edge and the enumerator lists only
  // names it already knows, so an edge the RESOLVER invents belongs to neither.
  for (const [tag, registry] of Object.entries(manifest.registries)) {
    if (registry.canonicalAccessor === undefined) {
      continue;
    }
    const names = resolveAccessor(api, registry.aliasEnumerator);
    const resolveEdge = resolveAccessor(api, registry.canonicalAccessor);
    const members = registryMembers(registry, api);
    if (
      typeof names !== "function" ||
      typeof resolveEdge !== "function" ||
      members === null
    ) {
      findings.push(
        `registry ${tag}: names ${registry.aliasEnumerator} / ${registry.canonicalAccessor} for its alias edges, and at least one is not a usable export of @openlogo/parser`,
      );
      continue;
    }
    const enumeratedNames = names();
    // Cardinality, before the Set below collapses it.
    const repeated = duplicatedNames(enumeratedNames);
    if (repeated.length > 0) {
      findings.push(
        `${registry.aliasEnumerator} lists ${repeated.join(", ")} more than once — ${enumeratedNames.length} entries, ${new Set(enumeratedNames).size} unique`,
      );
    }
    const enumerated = new Set(enumeratedNames);
    // The universe is every name the gate knows about, not just this registry's members. Probing
    // `members ∪ enumerated` left an edge the RESOLVER invented on a name outside the registry —
    // `canonicalOfTurtleAlias("print") → "forward"` — visible to nothing, because `print` is in the
    // manifest but in neither the turtle registry nor its alias enumerator.
    const universe = new Set([
      ...members.keys(),
      ...enumerated,
      ...byName.keys(),
      ...manifest.excluded.map((entry) => entry.name),
    ]);
    for (const name of universe) {
      const resolved = resolveEdge(name) !== undefined;
      const listed = enumerated.has(name);
      const entry = byName.get(name);
      if (resolved !== listed) {
        findings.push(
          `${name}: ${registry.canonicalAccessor} ${resolved ? "resolves" : "does not resolve"} an edge for it but ${registry.aliasEnumerator} ${listed ? "lists" : "does not list"} it — the registry's two accessors disagree`,
        );
        continue;
      }
      if (!resolved) {
        continue;
      }
      if (entry === undefined) {
        findings.push(
          `${name}: ${registry.aliasEnumerator} lists it as an alias of "${resolveEdge(name)}" but it has no entry in ${MANIFEST_PATH}`,
        );
        continue;
      }
      if (entry.aliasOf === undefined) {
        findings.push(
          `${name}: ${registry.canonicalAccessor} resolves it to "${resolveEdge(name)}" but its entry records no aliasOf — a dropped edge is drift, not an absent one`,
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
    if (!isCanonicalName(entry.name)) {
      findings.push(
        `excluded ${entry.name}: is not a canonical OpenLogo name — spec/grammar.md:15's ASCII core form is \`[a-z_][a-z0-9_]*[?!]?\`, and built-in keywords and primitives are lowercase ASCII`,
      );
    }
    if (listed.has(entry.name)) {
      findings.push(
        `excluded ${entry.name}: also appears in names — a name is either a built-in name or a deliberate omission, never both`,
      );
    }
    if (
      typeof entry.rationale !== "string" ||
      entry.rationale.trim().length === 0
    ) {
      findings.push(
        `excluded ${entry.name}: no rationale — a carve-out with no stated reason is indistinguishable from an oversight`,
      );
    }
    if (entry.reason !== "library" && entry.source !== undefined) {
      // Only a `library` carve-out has a `source`; a `source` nothing checks is worse than none.
      findings.push(
        `excluded ${entry.name}: reason "${entry.reason}" carries a source (${entry.source}) that nothing checks — only a "library" carve-out has one`,
      );
    }
    switch (entry.reason) {
      case "library":
        if (!isStdlibSource(entry.source, io)) {
          findings.push(
            `excluded ${entry.name}: reason "library" names ${JSON.stringify(entry.source)}, which is not a real ${STDLIB_DIR}/*.logo file — the carve-out is that the name is OpenLogo SOURCE (ADR-0012), so any other path would prove nothing`,
          );
          break;
        }
        // The path being real proves a file exists; this binds the NAME to it.
        if (!definesProcedure(io.readText(entry.source), entry.name)) {
          findings.push(
            `excluded ${entry.name}: ${entry.source} is a real ${STDLIB_DIR} file but defines no procedure named "${entry.name}" — the carve-out claims this name IS that library source, so the path alone proves nothing`,
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
        const repeated = duplicatedNames(entry.positions);
        if (repeated.length > 0) {
          findings.push(
            `excluded ${entry.name}: position(s) ${repeated.join(", ")} recorded more than once — ${entry.positions.length} entries, ${new Set(entry.positions).size} unique`,
          );
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
    if (typeof reason !== "string" || reason.trim().length === 0) {
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
 * The normative keyword block: the fenced `text` block that follows `spec/grammar.md`'s
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
  // The block introduced by the anchor is the one immediately after it: the anchor line, one blank
  // line, then the fence. Binding to "the first fence anywhere below" would let a decoy fence
  // inserted between them shadow the real block — the same positional-binding defect as searching
  // for a specific info string, which is what this replaced.
  const open = anchor + 2;
  if (
    lines[anchor + 1] === undefined ||
    lines[anchor + 1].trim() !== "" ||
    lines[open] === undefined ||
    !lines[open].startsWith("```")
  ) {
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
  // Every code span must be a single keyword identifier: removing all spans and checking the residue
  // accepts a span that is not a word at all. A word list is words.
  const spans = [...paragraph.join(" ").matchAll(/`([^`]*)`/g)].map(
    (match) => match[1],
  );
  if (spans.some((span) => !/^[a-z_?]+$/.test(span))) {
    return null;
  }
  const residue = paragraph
    .join(" ")
    .replace(/`[^`]*`/g, "")
    .replace(/[\s,.;:]/g, "");
  if (residue.length > 0) {
    return null;
  }
  return backtickedWords(paragraph.join(" "));
}

/**
 * The `keyword` row of `spec/tooling.md`'s token-class table: the single line beginning
 * `` | `keyword` | ``. Requires **exactly one**, so a duplicate leaves nothing unambiguous to hash.
 */
export function extractToolingKeywordRow(text) {
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("| `keyword` |"));
  return rows.length === 1 ? rows[0] : null;
}

/** The row's sha256, over its exact bytes — untrimmed, unnormalised. */
export function rowFingerprint(row) {
  return createHash("sha256").update(row, "utf8").digest("hex");
}

/**
 * The `keyword` token-class row's **change detector**.
 *
 * **This verifies that the row has not changed. It verifies nothing about whether the row is
 * correct**, and that limit is the whole of its contract. It cannot tell a true row from a false
 * one, it has no opinion on where in the document the row sits, and its remedy — re-derive, then
 * record the new digest — is only as good as the hand that re-derives. What it converts is *silent*
 * drift into *loud* drift, which is the difference between the row shifting unnoticed and someone
 * being made to look at it.
 *
 * Everything stronger was tried and is recorded on issue #841. Gating the row **clause by clause**
 * did not converge across six review rounds: hand-declared anchors (about twenty findings), then a
 * fingerprint, then a fingerprint with derived claims layered on — and each mechanism carried its
 * own overstatement, the last being that two "derived" polarity clauses were self-declared literals
 * that verified **manifest ↔ row agreement, not truth**: invert the sentence in both, recompute the
 * digest, and every check passed. The row is 2,000 characters of English that
 * `spec/grammar.md:378` makes deliberately underivable, and a mechanism that claims more than
 * change detection over it has, six times, been claiming something it did not check.
 *
 * What actually guards this row's *correctness* is that `spec/` is maintainer-owned under
 * `CODEOWNERS`. This gate makes sure a change to it cannot pass unseen.
 */
export function rowFingerprintFindings(manifest, row) {
  const expected = manifest.tokenClassKeyword.rowFingerprint;
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected)) {
    return [
      `${MANIFEST_PATH}: tokenClassKeyword.rowFingerprint is not a sha256 digest — without it a change to the token-class row passes unseen`,
    ];
  }
  const actual = rowFingerprint(row);
  if (actual === expected) {
    return [];
  }
  return [
    `${TOOLING_PATH}: the \`keyword\` token-class row has changed. Nothing here verifies the new row is CORRECT -- this is a change detector, and the correctness of that row is maintainer-reviewed under CODEOWNERS. Re-derive the token class against @openlogo/parser's shipped output, confirm every claim the row makes is still true, and then record ${actual} as tokenClassKeyword.rowFingerprint in ${MANIFEST_PATH}.`,
  ];
}

/**
 * The three hand-maintained lists in `spec/` that this gate covers.
 *
 * Two are compared **derivedly**, by computing the expected words from the manifest and the
 * implementation: `spec/grammar.md`'s normative keyword block, and `spec/tooling.md`'s C19 mirror,
 * which must carry the same words in the same order. The comparison is on the **extracted words**,
 * not the bytes, so a whitespace-only edit to either paragraph is not a finding. That pair is the
 * one that caught the drift which actually happened — the mirror silently losing `mod` and standing
 * at 43 words.
 *
 * The third, `spec/tooling.md`'s `keyword` **token-class** row, is only **change-detected**; see
 * {@link rowFingerprintFindings} for why, and issue #841 for the three mechanisms that tried for
 * more and each overstated what they checked.
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
      `${TOOLING_PATH}: could not find exactly one \`keyword\` token-class row — the row this gate fingerprints has moved or been duplicated`,
    );
  }

  const coreKeywords = manifest.names
    .filter((entry) => entry.registries.includes("reserved"))
    .map((entry) => entry.name);

  // Cardinality, not just membership: `missing`/`extra` use set semantics and the mirror compares
  // joined strings, so a word duplicated in BOTH lists satisfies all three.
  for (const [path, words] of [
    [GRAMMAR_PATH, grammarWords],
    [TOOLING_PATH, mirrorWords],
  ]) {
    if (words === null) {
      continue;
    }
    const duplicated = duplicatedNames(words);
    if (duplicated.length > 0) {
      findings.push(
        `${path}: the keyword list names ${duplicated.join(", ")} more than once — ${words.length} entries, ${new Set(words).size} unique`,
      );
    }
  }

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
        `${TOOLING_PATH}: the C19 mirror (${mirrorWords.length} words) does not carry the same words in the same order as ${GRAMMAR_PATH}'s normative block (${grammarWords.length} words) — it mirrors that list and must not diverge from it`,
      );
    }
  }

  if (row !== null) {
    findings.push(...rowFingerprintFindings(manifest, row));
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
  // `OL_CHECK_PROFILES` is walked by the sweep and by profileCoverageFindings, and both reduce it to
  // membership. A profile listed twice makes those sweeps run twice over the same tables and read as
  // one — and `unlisted` below, being a set comparison, cannot see it either.
  const repeatedProfiles = duplicatedNames(api.OL_CHECK_PROFILES);
  if (repeatedProfiles.length > 0) {
    findings.push(
      `OL_CHECK_PROFILES lists ${repeatedProfiles.join(", ")} more than once — ${api.OL_CHECK_PROFILES.length} entries, ${new Set(api.OL_CHECK_PROFILES).size} unique`,
    );
  }
  // Values, not keys: `ids` is a Record, so a duplicate KEY is inexpressible, but two ids mapping to
  // one display name silently collapses the `phantom`/`unmapped` comparison below.
  const repeatedNames = duplicatedNames(Object.values(ids));
  if (repeatedNames.length > 0) {
    findings.push(
      `${MANIFEST_PATH}: profile name(s) ${repeatedNames.join(", ")} are claimed by more than one id — a profile has one name`,
    );
  }
  if (sections !== null) {
    // Cardinality first: `unmapped`/`phantom` below are set comparisons, so a section heading
    // written twice satisfies both while the inventory silently stands at one fewer profile than
    // it appears to. Same blindness as the keyword lists, on the third surface.
    const repeated = duplicatedNames(sections);
    if (repeated.length > 0) {
      findings.push(
        `${CONFORMANCE_PATH}: profile section(s) ${repeated.join(", ")} appear more than once — ${sections.length} sections, ${new Set(sections).size} unique`,
      );
    }
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
 * The file's own prose must be present. A manifest that validates 148 entries and not its own
 * contract statement is asserting the wrong things about itself.
 */
export function narrativeFindings(manifest) {
  // `.trim()`, not `.length`: a single space is as satisfying to a presence check as an empty
  // string, which is the defect that defeated every row anchor a round earlier.
  const blank = (value) =>
    typeof value !== "string" || value.trim().length === 0;
  // One sweep over a list the file DERIVES from itself, rather than four hand-written loops. The
  // previous shape was fixed in one location and not its neighbours three rounds running, which is
  // the second-list problem in miniature: the registry notes below come from `registries`, so a
  // further registry is covered without editing anything here.
  const required = [
    ["about", manifest.about],
    ["profiles.about", manifest.profiles?.about],
    ...[
      "unconditional",
      "precedence",
      "bothDirections",
      "accessorStatus",
      "derivedEnumeration",
    ].map((key) => [`invariants.${key}`, manifest.invariants?.[key]]),
    ...["about", "rowFingerprintReason"].map((key) => [
      `tokenClassKeyword.${key}`,
      manifest.tokenClassKeyword?.[key],
    ]),
    // Every registry carries a `note`, without exception: an optional field could only be gated
    // when present, which left all eight existing ones deletable, and "the six with nothing to say"
    // is a hand-maintained count sitting inside a list that is otherwise derived.
    ...Object.entries(manifest.registries).map(([tag, registry]) => [
      `registries.${tag}.note`,
      registry.note,
    ]),
  ];
  const findings = required
    .filter(([, value]) => blank(value))
    .map(
      ([path]) =>
        `${MANIFEST_PATH}: ${path} is missing or empty — this file is normative, and a claim it makes about itself that nothing states cannot be reviewed`,
    );
  findings.push(...controlCharacterFindings(manifest));
  findings.push(...noteRestatementFindings(manifest));
  return findings;
}

/**
 * No string value anywhere in the file may contain a Unicode `Cc` control character.
 *
 * Authoring the notes through a shell whose escape character is a backtick turned `` `note` ``,
 * `` `aliasOf` ``, `` `reserved` `` and `` `excluded` `` into LF, BEL, CR and ESC **code points in
 * the decoded strings** inside a normative `spec/` artefact — carried, as a conforming JSON file
 * must, as visible six-character escapes. Still valid JSON, still Prettier-clean, still zero
 * findings, and four words left unreadable.
 *
 * Every string leaf, not only the prose ones — `Object.entries` yields indexed pairs for arrays, so
 * the bare strings inside `names[].registries[]` and `excluded[].positions[]` are reached too. `Cc`
 * rather than C0 alone, because U+007F and U+0080-U+009F are control characters as well and the
 * finding says "control character" without qualification.
 */
export function controlCharacterFindings(manifest) {
  const findings = [];
  const isControl = (character) => {
    const code = character.codePointAt(0);
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  };
  const walk = (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      const at = path ? `${path}.${key}` : key;
      if (typeof value === "string") {
        const found = [...value].filter(isControl);
        if (found.length > 0) {
          findings.push(
            `${MANIFEST_PATH}: ${at} contains control character(s) ${[
              ...new Set(
                found.map(
                  (character) =>
                    `U+${character.codePointAt(0).toString(16).padStart(4, "0").toUpperCase()}`,
                ),
              ),
            ].join(", ")} — a Cc code point in a string value of this file`,
          );
        }
      } else if (value !== null && typeof value === "object") {
        walk(value, at);
      }
    }
  };
  walk(manifest, "");
  return findings;
}

/**
 * A registry `note` may not name any accessor the manifest declares.
 *
 * `about` states the no-restatement rule; this is the derivable half of it, executable. The
 * comparison is against the accessor values the file itself carries, so there is no word list to
 * maintain. Manifest-wide rather than per-tag: a foreign accessor in a note is exactly as much "a
 * second copy that the next rename drifts", and widening costs a line and buys the whole set.
 *
 * The other half of the rule — no counts — is deliberately **not** enforced, and `about` must not
 * claim it is. Doing so needs a list of counting words, which is a hand-maintained second list
 * inside the check that exists to remove second lists, and it fires on ordinary English:
 * "one-word spellings" and "carved out of this one" are not counts. An unfalsifiable stoplist would
 * be a worse defect than the one it catches.
 *
 * Scoped to `note` deliberately: `invariants`, `profiles.about`, `tokenClassKeyword` and each
 * `excluded[].rationale` are normative or required as data by ADR-0021 §2 and §3, so they are not
 * subject to it.
 */
export function noteRestatementFindings(manifest) {
  const findings = [];
  const declared = [
    ...new Set(
      Object.values(manifest.registries)
        .flatMap((registry) => [
          registry.lookup?.accessor,
          registry.enumerate?.accessor,
          registry.aliasEnumerator,
          registry.canonicalAccessor,
        ])
        .filter((accessor) => typeof accessor === "string"),
    ),
  ];
  for (const [tag, registry] of Object.entries(manifest.registries)) {
    if (typeof registry.note !== "string") {
      continue;
    }
    const echoed = declared.filter((accessor) =>
      registry.note.includes(accessor),
    );
    if (echoed.length > 0) {
      findings.push(
        `${MANIFEST_PATH}: registries.${tag}.note names the accessor(s) ${echoed.join(", ")} — the value is carried structurally, so the prose is a second copy that the next rename drifts`,
      );
    }
  }
  return findings;
}

/**
 * Names a registry's enumerator yields **more than once** — under two keys, or twice under one, for
 * every accessor kind.
 *
 * `registryMembers` flattens each enumeration into a `Map` (last-write-wins) and `registryHas`
 * answers with `.includes`, so cardinality is invisible to every other check here. A name has one
 * owning profile and one registration per registry; two of either is a registry defect, not a shape
 * the manifest can express.
 */
export function duplicateRegistrationFindings(manifest, api) {
  const findings = [];
  for (const registry of Object.values(manifest.registries)) {
    const spec = registry.enumerate;
    if (spec === undefined || spec.status !== "present") {
      continue;
    }
    // A wrong-shaped or absent accessor reads as unreachable here rather than being called. The
    // findings list is an eager array literal, so `accessorFindings` *computing* a finding about it
    // does not *prevent* this line dereferencing it.
    const accessor = resolveAccessor(api, spec.accessor);
    if (!hasAccessorShape(accessor, spec.kind)) {
      continue;
    }
    const occurrences = new Map();
    const sequences =
      spec.kind === "record"
        ? Object.entries(accessor)
        : [
            [
              registry.profile,
              enumeratedNames(spec, accessor, registry.profile),
            ],
          ];
    for (const [key, words] of sequences) {
      for (const word of words) {
        occurrences.set(word, [...(occurrences.get(word) ?? []), key]);
      }
    }
    for (const [word, keys] of occurrences) {
      if (keys.length === 1) {
        continue;
      }
      const distinct = [...new Set(keys)];
      findings.push(
        distinct.length > 1
          ? `${word}: ${spec.accessor} lists it under ${distinct.join(" and ")} — a name has one owning profile, and flattening two of them keeps only the last`
          : `${word}: ${spec.accessor} lists it ${keys.length} times under ${distinct[0]} — every other comparison here is set-based, so a duplicate is invisible to all of them`,
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
    ...duplicateRegistrationFindings(resolved, api),
    ...entryFindings(resolved, api),
    ...implementationFindings(resolved, api),
    ...directionAgreementFindings(resolved, api),
    ...profilePrimitiveSweepFindings(resolved, api),
    ...aliasFindings(resolved, api),
    ...carveOutFindings(resolved, io),
    ...profileInventoryFindings(resolved, api, io),
    ...profileCoverageFindings(resolved, api),
    ...proseFindings(resolved, io),
  ];

  const unenumerable = Object.entries(resolved.registries)
    .filter(([, registry]) => registry.enumerate?.status !== "present")
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
