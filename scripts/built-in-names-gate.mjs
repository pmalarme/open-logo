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
 * ## The two axes this gate now compares, and the one it used to only fingerprint
 *
 * `spec/built-in-names.json` carries two independent per-name axes and neither determines the other
 * (`spec/grammar.md:378`): `category` (may a program **declare** this name?) and `tokenClass` (how is
 * this word **painted**?). `category` is compared against the implementation in both directions;
 * `tokenClass` is measured declaration-first and compared back over the enumerable name sources
 * only. ADR-0025 names each mechanism and what it does not reach — "both directions" over-describes
 * the paint axis, and this file must not restate it.
 *
 * `tokenClass` replaces a content fingerprint over `spec/tooling.md`'s `keyword` token-class row
 * (issue #959). That fingerprint could tell you the row had moved and nothing about whether it was
 * true — inverting the row's meaning and recomputing the digest passed every check. What issue #855
 * had refuted was **deriving** the class from data that already existed: a positional rule, and "the
 * keyword list minus the operators". **Declaring** it as new data was never tried, and "cannot be
 * derived from the existing lists" is a different claim from "cannot be written down". So the
 * enumeration moved out of the row into the manifest, where {@link tokenClassFindings} re-paints
 * every name through the shipped `highlight()` and compares.
 *
 * `spec/tooling.md`'s C19 mirror is derived the same way it always was — compared word-for-word
 * against `spec/grammar.md`'s normative block, which is compared against this manifest.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
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
 * Every OpenLogo procedure `source` defines, in file order.
 *
 * Deliberately a lexical scan for `define` headers rather than a parse: this module reads `spec/`
 * and `stdlib/` as text and must not acquire a dependency on the runtime it is auditing. Tokenised
 * rather than matched with a regex built from manifest data, so a name carrying regex
 * metacharacters cannot change what is being asked. Anchored on the Core spelling
 * (`spec/grammar.md`), so a Heritage `to` header does not register — correct, because `stdlib/` is
 * Core-profile source.
 */
export function procedureNamesIn(source) {
  if (typeof source !== "string") {
    return [];
  }
  const names = [];
  for (const line of codeOnly(source).split("\n")) {
    const words = line.trim().split(/\s+/);
    // Case-folded, because `spec/grammar.md:13` makes keywords and identifiers case-insensitive:
    // `DEFINE Hexagon` declares the same procedure as `define hexagon`, so a scanner anchored on
    // the lowercase spelling alone would read a real stdlib procedure as absent — and this walk
    // reports an *absent* carve-out, so its blind spots become the gate's blind spots. The name is
    // folded too, since a carve-out's `name` is lowercase-canonical ({@link isCanonicalName}).
    if (words[0].toLowerCase() === "define" && words[1] !== undefined) {
      names.push(words[1].toLowerCase());
    }
  }
  return names;
}

/**
 * Does `source` define an OpenLogo procedure literally named `name`?
 *
 * The path check above proves a *file* exists; this binds the carve-out's `name` to it. It reads the
 * same header scan {@link procedureNamesIn} does — one scan, asked in two directions — so the
 * manifest→stdlib and stdlib→manifest checks cannot disagree about what a file defines.
 */
export function definesProcedure(text, name) {
  return procedureNamesIn(text).includes(name);
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

/**
 * Every `.logo` file under `directory`, at any depth, spelled the way the manifest spells a
 * `source` — `/`-separated and relative to the repository root — so a finding can name the file in
 * the manifest's own vocabulary on every platform.
 *
 * A missing or unreadable directory reports as **empty** rather than throwing, so "the library is
 * gone" reaches {@link stdlibCarveOutFindings} as the finding it is instead of a stack trace that
 * reads like a broken gate.
 */
export function logoFilesUnder(directory) {
  try {
    return readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".logo"))
      .map((entry) => join(entry.parentPath, entry.name).split(sep).join("/"))
      .sort();
  } catch {
    return [];
  }
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
  // See {@link logoFilesUnder}: this gate's scan surface, disclosed in the summary line.
  listStdlibFiles: () => logoFilesUnder(STDLIB_DIR),
};

/**
 * Read and parse the authoritative list.
 *
 * Deliberately **unguarded**, unlike the `spec/` document reads, and the asymmetry is the point.
 * Those are anchors *inside* documents the gate audits, so failing to read one must degrade to a
 * finding or the run would report on anchors it never saw. This is the gate's own authoritative
 * input: with no manifest there is nothing to check, `runBuiltInNamesGate` has already asked
 * `io.exists`, and a read or parse that fails after that is a broken invocation rather than a
 * finding about the tree. It cannot produce a false green — the exception propagates and the CLI
 * exits non-zero — so a guard here would only convert a loud failure into a quieter one.
 */
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
 * @returns `true`/`false`, or `null` when the answer is unavailable — the registry declares no
 *   lookup, its accessor's status is not `present` (`declared` being the case in point:
 *   {@link ACCESSOR_STATUSES} defines it as decided but not created, so the file itself says it
 *   must not resolve), or the export is the wrong shape. `null` is propagated rather than coerced
 *   to `false`, so an unreachable direction is reported as unreachable instead of silently reading
 *   as "the implementation does not have it".
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
 * Alias edges, checked against the edge the implementation's **own accessors** resolve, in both
 * directions.
 *
 * `aliasOf` is an edge rather than a parallel list, so it cannot drift from the target *the manifest
 * records* — the edge is that target, and there is no second copy of it here. It says nothing about
 * whether the target is the one the **runtime** dispatches to: nothing in this gate compares either
 * against `packages/runtime/src/execute-internal.ts`, which hardcodes its own mapping. See
 * {@link canonicalOfTurtleAlias}'s note in `@openlogo/parser` and the gap recorded on #841.
 *
 * Two registries carry edges and each names its own resolver and enumerator in the manifest:
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
 * `io.readText(path)`, or `undefined` when the read throws.
 *
 * Both carve-out directions read `stdlib/` files that a directory walk or a manifest path has just
 * said exist, and "exists" is not "readable": a permissions change, a broken symlink, or a race
 * with a checkout throws between the two. {@link logoFilesUnder} already catches for exactly this
 * reason — so that "the library is gone" arrives as a finding rather than a stack trace that reads
 * like a broken gate — and the per-file reads have to do the same, or the guarantee holds for the
 * walk and not for the gate.
 */
function readOrUndefined(io, path) {
  try {
    return io.readText(path);
  } catch {
    return undefined;
  }
}

/**
 * `io.listStdlibFiles()`, or an empty list when the walk throws.
 *
 * The default port already catches inside {@link logoFilesUnder}, but `io` is injectable and the
 * port boundary is where that guarantee has to hold: a throwing walk crashed the gate instead of
 * producing the "defines no OpenLogo procedure" finding written for exactly that state. Empty is
 * the honest answer — nothing was scanned — and the anti-vacuity clause turns it into a finding.
 */
function listStdlibOrEmpty(io) {
  try {
    return io.listStdlibFiles();
  } catch {
    return [];
  }
}

/**
 * `io` with every document read **at most once per run**, success or failure alike.
 *
 * Several checks read the same `spec/` document — `spec/grammar.md` is consulted both for the
 * contextual-keyword enumeration and for the normative keyword block — and each read went to the
 * port separately. A non-idempotent port could therefore hand one check a document with a valid
 * keyword block and another a document declaring a fifth contextual keyword, and the gate would
 * report `0 finding(s)` on a Frankenstein document that never existed: every check passed against
 * *a* version, none against *the same* version.
 *
 * That is the same defect as walking `stdlib/` twice, one layer up, and it is worth closing at the
 * port rather than at each call site: a future check that reads a document a third time inherits
 * the guarantee instead of having to remember it. A thrown read is cached too, so a port that fails
 * once and succeeds later cannot make two checks disagree about whether a document is readable.
 */
function oneReadPerDocument(io) {
  const cache = new Map();
  return {
    ...io,
    readText: (path) => {
      if (!cache.has(path)) {
        try {
          cache.set(path, { text: io.readText(path) });
        } catch (error) {
          cache.set(path, { error });
        }
      }
      const entry = cache.get(path);
      if (Object.hasOwn(entry, "error")) {
        throw entry.error;
      }
      return entry.text;
    },
  };
}

/**
 * `path`'s text, or `undefined` after recording a finding that names the document.
 *
 * Every prose anchor this gate reads lives in a `spec/` document it opens by path, and each of
 * those reads was unguarded: a permissions change, a broken symlink, or a race with a checkout
 * threw out of the gate instead of producing a finding, so the run died with a stack trace that
 * reads like a broken gate rather than the unread document it is (issue #988).
 *
 * **It does not become a silent pass.** The read failure is a finding in its own right, and the
 * extractors below all fail closed on a non-string input, so each anchor that could not be checked
 * *also* reports itself. Two findings for one cause is the honest outcome: one names the cause, the
 * others name exactly what went unchecked because of it. That is the #964 rule applied to this
 * gate's own inputs — a check that passes when its data is absent is not a check.
 */
function readDocument(io, path, findings) {
  const text = readOrUndefined(io, path);
  if (text === undefined) {
    findings.push(
      `${path}: could not be read, so every anchor this gate reads in it went unchecked — a document the gate cannot open is a finding, never a skip`,
    );
  }
  return text;
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
        // The path being real proves a file exists; this binds the NAME to it. An unreadable file
        // is reported rather than thrown, like every other read of `stdlib/` here.
        {
          const source = readOrUndefined(io, entry.source);
          if (source === undefined) {
            findings.push(
              `excluded ${entry.name}: ${entry.source} was named as its library source but could not be read, so nothing can bind the name to it`,
            );
            break;
          }
          if (!definesProcedure(source, entry.name)) {
            findings.push(
              `excluded ${entry.name}: ${entry.source} is a real ${STDLIB_DIR} file but defines no procedure named "${entry.name}" — the carve-out claims this name IS that library source, so the path alone proves nothing`,
            );
          }
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
 * The stdlib→manifest direction of the `library` carve-outs: **every procedure `stdlib/**.logo`
 * defines must have one.**
 *
 * {@link carveOutFindings} binds each carve-out to a file. Nothing walked `stdlib/` itself, so the
 * binding ran one way only and the whole set could evaporate unobserved: emptying `excluded`
 * reported `0 carve-outs` and exited **0**, as did deleting the six `library` entries, deleting a
 * contextual one, or renaming one to a word the language does not contain (issue #964). The gate
 * printed its own emptiness and passed.
 *
 * That is not bookkeeping. `spec/conformance.md:88-91` is why these carve-outs exist at all: the
 * Geometry procedures "are not opaque primitive shortcuts, and they are therefore **library
 * procedures rather than built-in names**". Their absence from the built-in list is a *claim about
 * the tree* — that the source is really there — and `spec/geometry-module.md:419` makes the
 * learner-visible source "part of the contract". A carve-out silently deleted turns that claim into
 * an oversight nobody can distinguish from a missing name.
 *
 * **Read the bound precisely: this binds a carve-out to a `define` HEADER, not to a body.** Six
 * empty `define`/`end` shells satisfy it. That the shipped procedures are the real teaching source
 * is a different claim, held by `tests/conformance/geometry/stdlib/source-drift.test.mjs`, which
 * asserts every call site inlines the source verbatim. Naming that here so this comment's `:419`
 * citation is not over-read as something this function checks.
 *
 * **An empty result is a finding, not a vacuous pass** — and the emptiness that matters is
 * *procedures found*, not *files walked*. A bijection between two empty sets holds, so without this
 * clause deleting `stdlib/`'s six geometry files together with their six carve-outs would satisfy
 * the very check written to protect them. Keying the guard on the file count was the first attempt
 * and was itself an instance of this epic's defect: leaving any one header-free `.logo` file behind
 * kept the count non-zero while both sets were empty, so the countermeasure passed on exactly the
 * input it exists to reject. Nothing else in the gate would notice either, since every remaining
 * `stdlib` assertion is driven by manifest entries that would also be gone.
 *
 * **Read that guard as the floor it is: one procedure, not this library.** Replace the six geometry
 * files with a single decoy that defines one procedure, and add a matching `library` carve-out, and
 * the bijection holds again — this function proves *some* stdlib procedure exists and is declared,
 * never that `polygon`/`star`/`circle`/`arc`/`area`/`perimeter` in particular do. That inventory is
 * held elsewhere and deliberately not restated here: `tests/conformance/geometry/stdlib/
 * source-drift.test.mjs` pins each procedure's source, `spec/examples/13-geometry-stdlib.logo` runs
 * them, and the decoy route additionally requires an edit to `spec/built-in-names.json`, which is
 * maintainer-owned through `CODEOWNERS`.
 */
export function stdlibCarveOutFindings(
  manifest,
  io,
  files = listStdlibOrEmpty(io),
) {
  const findings = [];

  const carvedOut = new Set(
    manifest.excluded
      .filter((entry) => entry.reason === "library")
      .map((entry) => entry.name),
  );
  const defined = new Map();
  for (const file of files) {
    const text = readOrUndefined(io, file);
    if (text === undefined) {
      findings.push(
        `${file} was listed under ${STDLIB_DIR}/ but could not be read, so nothing can say whether it defines a carved-out procedure`,
      );
      continue;
    }
    for (const name of procedureNamesIn(text)) {
      const first = defined.get(name);
      if (first !== undefined) {
        findings.push(
          `${STDLIB_DIR} defines "${name}" in both ${first} and ${file} — a library carve-out names one source file, so two would make the binding ambiguous`,
        );
        continue;
      }
      defined.set(name, file);
      if (!carvedOut.has(name)) {
        findings.push(
          `${file} defines "${name}" but ${MANIFEST_PATH} records no "library" carve-out for it — a stdlib procedure absent from both names and excluded is indistinguishable from a name nobody has noticed is missing`,
        );
      }
    }
  }

  // Keyed on procedures found, not files walked: a header-free `.logo` file left behind would keep
  // a file count non-zero while both sets are empty, which is the vacuous pass this guards.
  if (defined.size === 0) {
    findings.push(
      `${STDLIB_DIR}/ defines no OpenLogo procedure across ${files.length} .logo file(s) — the library carve-outs are what record that the geometry standard library is OpenLogo SOURCE rather than built-in names (spec/conformance.md:88-91, ADR-0012), and a bijection with an empty set asserts nothing`,
    );
  }

  for (const name of carvedOut) {
    if (!defined.has(name)) {
      findings.push(
        `excluded ${name}: reason "library" but no ${STDLIB_DIR}/**.logo file defines a procedure of that name`,
      );
    }
  }
  return findings;
}

/**
 * The small number words the closing claim can spell, so the sentence's own count can be reconciled
 * against the words it enumerates. Bounded and fail-closed: a count word outside this map is
 * unrecognised, which makes the extraction fail rather than pass unchecked.
 */
const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/**
 * The **contextual keywords** `spec/grammar.md:380` names — the words that are structural by
 * position without OpenLogo owning the name — extracted from the sentence that enumerates them:
 * *"By contrast, `empty`, `member`, `of`, and `a` are **not** keywords and **not** built-in
 * names."*
 *
 * Four things must agree, because each of the first two alone has a false pass:
 *
 * 1. **The enumeration, with its full predicate** — `are **not** keywords and **not** built-in
 *    names`. Matching only the shorter `are **not** keywords` accepted a doctored sentence saying
 *    the words *are* built-in names, which is the opposite of the claim a carve-out makes.
 * 2. **The closing claim** — *"The contextual keywords are exactly these four;"* — which closes the
 *    set, so a fifth word cannot be added silently. The count word must be **followed immediately
 *    by punctuation**, because a bare `\w+` capture also matched the `four` of *"four hundred"*.
 * 3. **Their agreement.** The closing claim states a *number*, and matching the anchor without
 *    reading that number let a five-word enumeration pass beneath prose still saying "four": the
 *    gate derived the wrong set and then forced the manifest to follow it. The count is parsed and
 *    reconciled against the words actually enumerated, **and the words must be distinct** — four
 *    words of which two are the same spelling satisfies a count of four while naming three.
 * 4. **Uniqueness, document-wide.** The document may contain exactly **one** enumeration and
 *    exactly **one** closing claim, and they must share a paragraph. Two weaker rules each let the
 *    document contradict itself unread: returning on the first *paragraph* that carried both left a
 *    later contradictory paragraph unexamined, and matching once *within* a paragraph left a second
 *    claim in the same paragraph unexamined. Every occurrence of each anchor is counted, so a
 *    second claim **written in the anchors' own form** is a finding rather than a
 *    silently-preferred first match.
 *
 * **The bound of 4, stated rather than left to be discovered.** A contradiction that *paraphrases*
 * — "In contrast, …", "`quux` is **not** a keyword and **not** a built-in name", or a fifth word
 * announced in a sentence resembling neither anchor — matches neither regex and is not seen. That
 * is inherent to extracting a claim from prose, and it is why the count reconciliation in 3 is the
 * real backstop: a maintainer who adds a fifth contextual keyword *and* updates "exactly these
 * four" to "five" is caught even when the wording is new (measured: the paraphrase alone passes,
 * the paraphrase plus an honest count fails). Only a change that adds a word, leaves the count
 * stale, *and* avoids both anchor forms slips through. Closing that fully would need
 * `spec/grammar.md` to declare the set in a machine-checkable form rather than prose, which is
 * maintainer-owned via `CODEOWNERS` and belongs in its own slice.
 *
 * Returns `null` when any of the four fails — a **finding** at the caller, never a skip, because
 * `spec/` is maintainer-owned and this gate may not annotate the documents it reads. The word list
 * itself is bounded to the sentence rather than the paragraph: the surrounding prose backticks
 * `to`, `set ... to`, `define of` and the `is`-predicate examples, none of which are members of
 * this set.
 */
export function extractContextualKeywords(text) {
  if (typeof text !== "string") {
    return null;
  }
  const ENUMERATION =
    /By contrast, ([^.]*?) are \*\*not\*\* keywords and \*\*not\*\* built-in names\./g;
  const CLOSURE = /contextual keywords are exactly these ([a-z]+)[;.,]/g;
  // Counted document-wide, not per paragraph and not once per paragraph: either weaker rule leaves
  // a contradicting second claim unread, which is the false pass this exists to close.
  const enumerations = [...text.matchAll(ENUMERATION)];
  const closures = [...text.matchAll(CLOSURE)];
  if (enumerations.length !== 1 || closures.length !== 1) {
    return null;
  }
  const [enumeration] = enumerations;
  const [closure] = closures;
  // ...and the two must be the same paragraph, so a claim elsewhere cannot close this enumeration.
  const paragraphs = text.split(/\r?\n\s*\r?\n/);
  const paragraphOf = (match) =>
    paragraphs.findIndex((paragraph) => paragraph.includes(match[0]));
  if (paragraphOf(enumeration) !== paragraphOf(closure)) {
    return null;
  }
  const words = backtickedWords(enumeration[1]);
  // No `words.length === 0` clause: `NUMBER_WORDS` maps `one`..`ten`, so no key maps to 0 and the
  // count comparison already rejects an empty enumeration. Adding the emptiness test back would be
  // a clause that can never decide the outcome — the third such no-op caught in this file, and
  // invisible to a 100%-branch-covered gate.
  if (NUMBER_WORDS[closure[1]] !== words.length) {
    return null;
  }
  return new Set(words).size === words.length ? words : null;
}

/**
 * The `contextual-keyword` carve-outs, bound to `spec/grammar.md`'s own enumeration in **both**
 * directions, plus the claim each one actually makes about the implementation.
 *
 * {@link carveOutFindings} validates a contextual entry's shape — canonical spelling, a rationale,
 * positions drawn from a closed vocabulary — but validating an entry cannot notice a **missing**
 * one. Measured on the tree that filed issue #964: deleting the `of` carve-out left the gate at
 * `0 finding(s)`, exit 0, and the summary still reported the remaining carve-outs as though the
 * total were an assertion. The library half had the same hole in the other direction; this is the
 * contextual half of the same fix.
 *
 * The third check is the one that makes the carve-out mean something. A contextual keyword's whole
 * claim is *"structural in this position, and yet **not** a built-in name"*, so the entry is
 * refuted the moment {@link isBuiltInName} starts answering `true` for the word — which is exactly
 * what would happen if a later slice registered it as a keyword or a primitive without noticing the
 * carve-out. That is a genuine implementation→manifest direction, not a restatement.
 */
export function contextualCarveOutFindings(manifest, api, io) {
  const declared = extractContextualKeywords(readOrUndefined(io, GRAMMAR_PATH));
  if (declared === null) {
    return [
      `${GRAMMAR_PATH}: could not derive the contextual keywords — one paragraph must enumerate them ("By contrast, … are **not** keywords and **not** built-in names.") AND close the set with a count that matches ("The contextual keywords are exactly these four"). A reworded, contradicted, or miscounted sentence leaves the carve-outs underived, which is a finding rather than a skip`,
    ];
  }

  const findings = [];
  const carvedOut = manifest.excluded
    .filter((entry) => entry.reason === "contextual-keyword")
    .map((entry) => entry.name);
  // Fail closed on a missing accessor rather than throwing. `isBuiltInName` is what makes the third
  // check mean anything, so an implementation that does not expose it leaves that direction
  // unchecked — reported as a finding, never as a silent skip. `undefined` rather than `null` so
  // the call below can be an optional chain, which is what Biome asks for; the two states are the
  // same one state (no accessor) and only ever reached through the guard above.
  const ownsName =
    typeof api.isBuiltInName === "function" ? api.isBuiltInName : undefined;
  if (ownsName === undefined) {
    findings.push(
      "the implementation exposes no isBuiltInName accessor, so the claim each contextual carve-out makes — structural by position, and yet NOT a built-in name — cannot be checked against it",
    );
  }
  for (const word of declared) {
    if (!carvedOut.includes(word)) {
      findings.push(
        `${GRAMMAR_PATH} names "${word}" a contextual keyword but ${MANIFEST_PATH} records no "contextual-keyword" carve-out for it — a word that is structural by position and absent from both names and excluded is indistinguishable from an oversight`,
      );
    }
    if (ownsName?.(word)) {
      findings.push(
        `excluded ${word}: carved out as a contextual keyword, but isBuiltInName says OpenLogo owns the name — ${GRAMMAR_PATH} makes these "**not** keywords and **not** built-in names", so the carve-out and the implementation now disagree`,
      );
    }
  }
  for (const name of carvedOut) {
    if (!declared.includes(name)) {
      findings.push(
        `excluded ${name}: reason "contextual-keyword" but ${GRAMMAR_PATH} does not name it among the contextual keywords, which it declares to be exactly ${declared.map((word) => `"${word}"`).join(", ")}`,
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
  if (typeof text !== "string") {
    return null;
  }
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
  if (typeof text !== "string") {
    return null;
  }
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
 * `` | `keyword` | ``. Requires **exactly one**, so a duplicate leaves nothing unambiguous to read.
 */
export function extractToolingKeywordRow(text) {
  if (typeof text !== "string") {
    return null;
  }
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("| `keyword` |"));
  return rows.length === 1 ? rows[0] : null;
}

/**
 * The words between `open` and `close` in `text`, as backticked bare identifiers.
 *
 * `close` is located first and `open` is then taken as the nearest one **before** it, because the
 * closing phrase is what makes each anchor unique — "The words " opens the sentence this reads in
 * `spec/tooling.md`, and it also opens several earlier ones.
 *
 * Fail-closed on purpose: a missing anchor — or a document that could not be read at all, which
 * `readDocument` reports as `undefined` after recording its own finding — returns `null`, and its
 * caller reports the anchor as moved rather than comparing against an empty list that would match
 * nothing and pass.
 */
export function wordsBetween(text, open, close) {
  if (typeof text !== "string") {
    return null;
  }
  const end = text.indexOf(close);
  if (end === -1) {
    return null;
  }
  const start = text.lastIndexOf(open, end);
  return start === -1
    ? null
    : backtickedWords(text.slice(start + open.length, end));
}

/**
 * The positions each name is re-painted in. Together they are the manifest's `positionIndependence`
 * claim made executable: a bare statement head, an argument, a list element, a `local` binder, a
 * postfix field, an `export` operand, a `for … from` binder, a `for … in` binder, and a `set … to`
 * place. Every one after the first is a position where the grammar admits a keyword as an
 * **ordinary name** (`spec/grammar.md:386`), which is where a positional rule for this class was
 * refuted (issue #855) — so a class that varied by position is caught here rather than assumed away.
 *
 * Each probe must yield **at least one** matching token. Unioning the classes across probes made a
 * probe that emitted none invisible: the other eight covered for it, and a rule that stopped
 * classifying `local repeat` at all still passed (issue #959 review).
 */
export const TOKEN_CLASS_PROBES = [
  (name) => name,
  (name) => `print ${name}`,
  (name) => `[ ${name} ]`,
  (name) => `local ${name}`,
  (name) => `:p.${name}`,
  (name) => `export ${name}`,
  (name) => `for ${name} from 1 to 3\nend`,
  (name) => `for ${name} in [ 1 2 ]\nend`,
  (name) => `set ${name} to 1`,
];

/** The profile-neutral set: Core Language alone, where every profile word must fall back. */
export const CORE_ONLY_PROFILES = ["core-language"];

/**
 * The AST node kind each contextual position is realised by. A probe labelled with a position must
 * actually **parse into** that position, not merely paint the word `keyword` somewhere.
 *
 * Without this the label was decorative: swapping `of`'s `value-of-reader` probe for its
 * `is-predicate` one left the Heritage `value of … for key` reader never exercised while the gate
 * still reported the position as checked (issue #959 review, finding F1). The keys are
 * {@link CONTEXTUAL_POSITIONS}; a position with no kind here cannot be validated and is a finding.
 */
export const CONTEXTUAL_POSITION_NODE_KINDS = {
  "is-predicate": "IsPredicate",
  "value-of-reader": "ValueOfKey",
};

/**
 * The anchors the prose statements of the contextual set are read through. Each is a
 * `[describe, open, close, source]`: the backticked words between `open` and `close` must be exactly
 * the words `tokenClass.contextual` declares. `source` says which text to read — `"row"` for the
 * `keyword` token-class row alone, `"tooling"` for the whole of `spec/tooling.md`, `"grammar"` for
 * `spec/grammar.md`.
 *
 * Three sides, not two, because two can be emptied together: `spec/grammar.md:380`'s "the contextual
 * keywords are exactly these four" is a normative statement in a document this slice does not touch,
 * so it is the independent lower bound (issue #959 review, finding 4).
 */
export const CONTEXTUAL_PROSE_ANCHORS = [
  [
    `${TOOLING_PATH}'s "Reserved words for tooling" contextual sentence`,
    "The words ",
    " are contextual keywords",
    "tooling",
  ],
  [
    `${GRAMMAR_PATH}'s contextual-keyword sentence`,
    "By contrast, ",
    " are **not** keywords",
    "grammar",
  ],
];

/**
 * Re-paint `name` through the shipped highlighter in each of {@link TOKEN_CLASS_PROBES}, under
 * `profiles`.
 *
 * Returns `{ classes, silent }` — the set of classes the word came back as, and the probe sources
 * that produced no token for it at all. Every occurrence in every probe is collected, not just the
 * first: `for for from 1 to 3` puts the word in two positions at once, and a rule that painted only
 * one of them would otherwise pass. A word literal's token text keeps its quotes (`"a"`), so a probe
 * may safely mention the name inside a string without the comparison matching it.
 */
export function paintedClasses(api, name, profiles) {
  const classes = new Set();
  const silent = [];
  for (const probe of TOKEN_CLASS_PROBES) {
    const source = probe(name);
    let seen = 0;
    for (const token of api.highlight(source, "<token-class-probe>", {
      profiles,
    })) {
      if (token.text.toLowerCase() === name) {
        seen += 1;
        classes.add(token.class);
      }
    }
    if (seen === 0) {
      silent.push(source);
    }
  }
  return { classes, silent };
}

/**
 * The **paint axis**: every name's declared `tokenClass` re-measured against the shipped
 * highlighter.
 *
 * This function is the **file -> implementation** direction only. The reverse is
 * {@link tokenClassSourceFindings}; saying "in both directions" here read as though one function
 * did both, and an undeclared name would have escaped whoever believed it.
 *
 * Per name, each of these can fail on its own:
 *
 * - the value is present and is one of the implementation's own `OL_TOKEN_CLASSES` (no vocabulary is
 *   restated here, so a class the implementation adds is accepted without an edit);
 * - every {@link TOKEN_CLASS_PROBES} position yields **at least one** token for the name, and every
 *   token in every position carries exactly that class;
 * - the profile rule of `spec/tooling.md:30-31` holds **for the profile the entry names**: a name
 *   painted `keyword` by a non-Core profile is `keyword` with that profile active and `primitive`
 *   with it inactive, and every other name is unmoved by either. Comparing only "all profiles"
 *   against "Core alone" left the *owning* profile unchecked — re-filing `tell` under Interaction
 *   passed (issue #959 review, finding 2).
 *
 * The **implementation -> file** direction is {@link tokenClassSourceFindings}: `names` is compared
 * against the registries elsewhere, but the highlighter has a name source no registry holds.
 */
export function tokenClassFindings(manifest, api) {
  if (typeof api.highlight !== "function") {
    return [
      `${MANIFEST_PATH}: tokenClass cannot be compared — @openlogo/parser exposes no highlight() to measure against, so every declared class would pass unchecked`,
    ];
  }
  if (!Array.isArray(api.OL_TOKEN_CLASSES)) {
    return [
      `${MANIFEST_PATH}: tokenClass cannot be compared — @openlogo/parser exposes no OL_TOKEN_CLASSES, so there is no vocabulary to check a declared class against`,
    ];
  }
  const findings = [];
  const vocabulary = api.OL_TOKEN_CLASSES;
  for (const entry of manifest.names) {
    if (!vocabulary.includes(entry.tokenClass)) {
      findings.push(
        `${entry.name}: tokenClass ${JSON.stringify(entry.tokenClass)} is not one of the implementation's token classes [${vocabulary.join(", ")}]`,
      );
      continue;
    }
    const all = paintedClasses(api, entry.name, api.OL_CHECK_PROFILES);
    if (all.silent.length > 0) {
      findings.push(
        `${entry.name}: the highlighter emits no token for it in ${all.silent.map((source) => JSON.stringify(source)).join(", ")} — an unpainted position proves nothing, and the other probes must not cover for it`,
      );
      continue;
    }
    if (all.classes.size !== 1) {
      findings.push(
        `${entry.name}: the highlighter paints it ${[...all.classes].join(" and ")} depending on position — a name whose class varies cannot carry one tokenClass, and belongs in tokenClass.contextual`,
      );
      continue;
    }
    const [actual] = all.classes;
    if (actual !== entry.tokenClass) {
      findings.push(
        `${entry.name}: tokenClass "${entry.tokenClass}" but the highlighter paints it "${actual}"`,
      );
      continue;
    }
    findings.push(...profileGatingFindings(api, entry));
  }
  return findings;
}

/**
 * The profile half of the paint rule.
 *
 * Two axes, swept separately because the full product is not enumerable — twelve profiles is 4096
 * sets, and the gate re-paints nine probes per set per name:
 *
 * - **gating.** Every subset of the profiles that contribute keywords, each swept twice: over Core
 *   Language alone, and over Core plus every non-contributing profile. A gated word must be
 *   `keyword` exactly when its own profile is in the subset.
 * - **invariance.** With every keyword-contributing profile active, each non-contributing profile is
 *   removed **one at a time**. No profile that contributes no keywords may move any class, so a
 *   single-profile dependency is caught wherever it sits.
 *
 * Each stage answered a mutant its predecessor let through: two endpoints hid a word gated on the
 * *wrong* profile; three sets hid a word wrong only in a partial combination; and holding the
 * non-contributing profiles permanently active hid a highlighter that mispainted whenever Sound was
 * absent (issue #959 review rounds 2-4). **The limit, measured rather than assumed:** the sweep
 * varies eleven profiles into 17 distinct sets, which realise all four valuations of every pair —
 * so all **220** distinct two-literal conjunctions are caught, 0 escape. A rule needing one profile
 * present and **two** absent mostly escapes: 99 of 495 are caught, **396 escape**. ADR-0025
 * records it.
 */
export function profileGatingFindings(api, entry) {
  const contributing = Object.keys(api.OL_PROFILE_KEYWORDS ?? {});
  const others = api.OL_CHECK_PROFILES.filter(
    (profile) =>
      !contributing.includes(profile) && !CORE_ONLY_PROFILES.includes(profile),
  );
  const gated =
    entry.tokenClass === "keyword" && contributing.includes(entry.profile);
  const sets = [];
  for (let mask = 0; mask < 2 ** contributing.length; mask += 1) {
    const active = contributing.filter((_, index) => (mask >> index) & 1);
    const describeActive =
      active.length === 0
        ? "with no keyword-contributing profile active"
        : `plus ${active.join(" + ")}`;
    sets.push([
      [...CORE_ONLY_PROFILES, ...active],
      active,
      `over Core Language alone ${describeActive}`,
    ]);
    sets.push([
      [...CORE_ONLY_PROFILES, ...others, ...active],
      active,
      `over every non-keyword profile ${describeActive}`,
    ]);
  }
  for (const omitted of others) {
    sets.push([
      [
        ...CORE_ONLY_PROFILES,
        ...others.filter((profile) => profile !== omitted),
        ...contributing,
      ],
      contributing,
      `with every profile active except ${omitted}`,
    ]);
  }

  const findings = [];
  for (const [profiles, active, describe] of sets) {
    const expected =
      gated && !active.includes(entry.profile) ? "primitive" : entry.tokenClass;
    const painted = paintedClasses(api, entry.name, profiles);
    if (painted.silent.length > 0) {
      findings.push(
        `${entry.name}: the highlighter emits no token for it ${describe} in ${painted.silent.map((source) => JSON.stringify(source)).join(", ")} — an unpainted position proves nothing under any profile set`,
      );
      continue;
    }
    if (painted.classes.size === 1 && painted.classes.has(expected)) {
      continue;
    }
    findings.push(
      gated
        ? `${entry.name}: must be "${expected}" ${describe} but the highlighter paints it ${[...painted.classes].join(" and ")} — spec/tooling.md:30 gates a profile word on ITS OWN profile (${entry.profile}), and spec/tooling.md:31 makes it "primitive" while that profile is inactive`
        : `${entry.name}: is painted "${entry.tokenClass}" under every profile but ${[...painted.classes].join(" and ")} ${describe} — only a profile's structural words move`,
    );
  }
  return findings;
}

/**
 * The **implementation -> file** direction for the paint axis: every word the highlighter treats
 * specially must be a name this file declares, with the class that treatment gives it.
 *
 * `names` is already compared against the *registries* in both directions, but the highlighter does
 * not decide a class from the registries alone: `OL_WORD_OPERATORS` is a name source of its own. So
 * a fifth word added there — painted `operator` while no registry holds it and no entry lists it —
 * escaped every check (issue #959 review, finding 1). Both keyword-class sources are compared the
 * same way, as sets, in both directions:
 *
 * - `tokenClass: "operator"` must equal `OL_WORD_OPERATORS`;
 * - `tokenClass: "keyword"` must equal `OL_KEYWORDS` + `OL_PROFILE_KEYWORDS` minus those operators.
 *
 * Fails closed: a source the implementation stops exporting is a finding, not a skipped comparison.
 * The residual it does **not** reach is the positional marking in `highlight.ts`, which is decided
 * from parsed structure rather than a set and so cannot be enumerated from outside; that is what
 * {@link contextualTokenClassFindings} probes word by word instead.
 */
export function tokenClassSourceFindings(manifest, api) {
  if (
    !(api.OL_WORD_OPERATORS instanceof Set) &&
    !Array.isArray(api.OL_WORD_OPERATORS)
  ) {
    return [
      `${MANIFEST_PATH}: the paint axis cannot be compared implementation-first — @openlogo/parser exposes no enumerable OL_WORD_OPERATORS, so a word it paints that this file does not list would pass unseen`,
    ];
  }
  if (!Array.isArray(api.OL_KEYWORDS)) {
    return [
      `${MANIFEST_PATH}: the paint axis cannot be compared implementation-first — @openlogo/parser exposes no OL_KEYWORDS, so a word it paints that this file does not list would pass unseen`,
    ];
  }
  if (
    api.OL_PROFILE_KEYWORDS === null ||
    typeof api.OL_PROFILE_KEYWORDS !== "object"
  ) {
    return [
      `${MANIFEST_PATH}: the paint axis cannot be compared implementation-first — @openlogo/parser exposes no OL_PROFILE_KEYWORDS, so a profile word it paints that this file does not list would pass unseen`,
    ];
  }
  const operators = [...api.OL_WORD_OPERATORS].map((word) =>
    word.toLowerCase(),
  );
  const keywordSources = [
    ...api.OL_KEYWORDS,
    ...Object.values(api.OL_PROFILE_KEYWORDS).flat(),
  ]
    .map((word) => word.toLowerCase())
    .filter((word) => !operators.includes(word));
  const findings = [];
  for (const [tokenClass, expected] of [
    ["operator", operators],
    ["keyword", keywordSources],
  ]) {
    const declared = manifest.names
      .filter((entry) => entry.tokenClass === tokenClass)
      .map((entry) => entry.name);
    const undeclared = expected.filter((word) => !declared.includes(word));
    const unbacked = declared.filter((word) => !expected.includes(word));
    if (undeclared.length > 0) {
      findings.push(
        `${MANIFEST_PATH}: the highlighter paints ${undeclared.join(", ")} "${tokenClass}", and no entry declares that — a word the implementation classes and this file does not list is exactly the drift the manifest exists to catch`,
      );
    }
    if (unbacked.length > 0) {
      findings.push(
        `${MANIFEST_PATH}: ${unbacked.join(", ")} declare tokenClass "${tokenClass}", which no name source of the highlighter backs`,
      );
    }
  }
  return findings;
}

/**
 * Does the occurrence of `name` that `highlight()` paints `expectedClass` in `source` sit **inside**
 * a node of `kind`?
 *
 * Existence of such a node anywhere is not enough, and that is the whole point: a probe carrying
 * *both* forms — `print (value of :d for key "x") == (:x is empty)` — has an `IsPredicate` node
 * while the word `of` is painted through the `ValueOfKey`, so a bare "is there such a node" test
 * declared the wrong position verified (issue #959 review round 2, finding 1).
 *
 * Containment alone was not enough either: nodes **nest**, so
 * `(value of :d for key "x") is empty` puts `of` inside a `ValueOfKey` that is itself inside the
 * outer `IsPredicate`, and any-ancestor matching accepted the wrong label again (round 3, finding
 * 1). So the test is on the **innermost** node containing the painted occurrence: the position a
 * word occupies is the narrowest form that encloses it, not every form above it.
 *
 * `parse` never throws on malformed input, so a probe that does not parse has no enclosing node
 * beyond the program itself and fails.
 */
export function paintedInsideNode(api, source, name, expectedClass, kind) {
  // Only the kinds this gate can label a position with are candidates. Narrower nodes that are not
  // positions at all (a literal, a variable reference) say nothing about which structural form the
  // word sits in, while `ValueOfKey` nested inside `IsPredicate` says everything — that pair is the
  // whole point (issue #959 review round 3, finding 1).
  const positionKinds = Object.values(CONTEXTUAL_POSITION_NODE_KINDS);
  const nodes = [];
  api.walk(api.parse(source, "<contextual-probe>").ast, (node) => {
    if (node.source_span !== undefined && positionKinds.includes(node.kind)) {
      nodes.push(node);
    }
  });
  const within = (position, span) => {
    const [line, column] = position;
    const [startLine, startColumn] = span.start;
    const [endLine, endColumn] = span.end;
    const afterStart =
      line > startLine || (line === startLine && column >= startColumn);
    const beforeEnd =
      line < endLine || (line === endLine && column <= endColumn);
    return afterStart && beforeEnd;
  };
  // "Innermost" as ONE sortable key rather than a chain of `||` comparisons, whose later links are
  // unreachable while spans nest strictly — dead branches that a coverage gate rightly rejects.
  //
  // The key ranks by CONTAINMENT, using absolute positions: among nodes that all contain the token,
  // the innermost is the one that starts latest and ends earliest. Span *widths* were tried and are
  // wrong — a span ending on a later line at a smaller column has a NEGATIVE column delta, and
  // `"-30"` sorts after `"-20"` lexically while being the narrower of the two, so an indented
  // multiline probe picked the outer node (issue #959 review round 5, finding 2). Every component
  // here is non-negative, so fixed-width padding gives a total order that agrees with containment.
  const pad = (value) => String(value).padStart(9, "0");
  const rankOf = (node) => {
    const span = node.source_span;
    return [
      pad(1e8 - span.start[0]),
      pad(1e8 - span.start[1]),
      pad(span.end[0]),
      pad(span.end[1]),
      node.kind,
    ].join(":");
  };
  return api
    .highlight(source, "<contextual-probe>", {
      profiles: api.OL_CHECK_PROFILES,
    })
    .filter(
      (token) =>
        token.text.toLowerCase() === name && token.class === expectedClass,
    )
    .some((token) => {
      const byRank = new Map(
        nodes
          .filter((node) => within(token.source_span.start, node.source_span))
          .map((node) => [rankOf(node), node]),
      );
      // Default `.sort()` — no comparator, so no branch of this module's own to leave untaken. The
      // keys are fixed-width strings, so lexicographic order IS the intended order.
      const innermost = [...byRank.keys()].sort()[0];
      return byRank.get(innermost)?.kind === kind;
    });
}

/**
 * The declared contextual block, normalised so every caller can read `words`, `class` and
 * `elsewhereClass` without guarding.
 *
 * It reads defensively for one reason: every check in this module runs over the same manifest and
 * collects findings independently, so the first one to reach a missing field must not throw before
 * the others have said what is wrong with it. A malformed block still fails — an absent or empty
 * `words` is reported by {@link contextualTokenClassFindings} and disagrees with all three prose
 * statements in {@link tokenClassRowFindings}.
 */
export function contextualDeclaration(manifest) {
  const contextual = manifest.tokenClass?.contextual;
  if (contextual === undefined || !Array.isArray(contextual.words)) {
    return { class: undefined, elsewhereClass: undefined, words: [] };
  }
  return contextual;
}

/**
 * The **exception set**: the four words painted `keyword` by position and ordinary names elsewhere.
 *
 * They are not built-in names (`spec/grammar.md:378`), so they are not rows in `names` and no flat
 * class can express them. What makes this a gate rather than a carve-out that passes when emptied
 * (issue #964) is that the set is pinned from four sides at once, and each measures the others:
 *
 * - it must be **non-empty**, and so must the `excluded` carve-outs — emptying every side *at once*
 *   otherwise satisfied all of the pairwise comparisons and passed (issue #959 review, finding 4);
 * - it must name the same words, with the same positions, as the `excluded` carve-outs whose reason
 *   is `contextual-keyword` — that is the same words' **declaration** axis;
 * - every declared position must carry a probe that **parses into** that position, checked against
 *   {@link CONTEXTUAL_POSITION_NODE_KINDS}, and that paints the word `class` there; every
 *   `elsewhereProbes` entry must be painted `elsewhereClass`. Without the parse check the label was
 *   decorative: `of`'s two probes could be swapped, leaving the Heritage `value of … for key` reader
 *   never exercised while the position still read as checked;
 * - all three prose statements of the set must enumerate exactly it
 *   ({@link tokenClassRowFindings}), one of them in `spec/grammar.md` — a document this slice does
 *   not touch, so it is an independent lower bound rather than a second copy of the same edit.
 */
export function contextualTokenClassFindings(manifest, api) {
  // Fail CLOSED. Returning `[]` when a capability is absent let the gate report "0 findings" while
  // skipping this proof entirely — a check that passes because it ran nothing, which is the exact
  // shape (`rowFingerprint`, the carve-out that passed when emptied, issue #964) this whole
  // mechanism exists to close. It was in the one function whose job is proving the probes are
  // *parsed* (issue #959 review, rebase round).
  const missing = ["highlight", "parse"].filter(
    (capability) => typeof api[capability] !== "function",
  );
  if (missing.length > 0) {
    return [
      `${MANIFEST_PATH}: the parser exports no ${missing.map((name) => `\`${name}\``).join(" and no ")} — the contextual probes cannot be run or parsed, and a silent skip here reads as "checked" (issue #959)`,
    ];
  }
  const declared = contextualDeclaration(manifest);
  const findings = [];
  const carveOuts = new Map(
    manifest.excluded
      .filter((entry) => entry.reason === "contextual-keyword")
      .map((entry) => [entry.name, entry.positions ?? []]),
  );
  const words = declared.words;
  if (words.length === 0) {
    findings.push(
      `${MANIFEST_PATH}: tokenClass.contextual.words is empty — the exception set carries every word no flat class can express, so an empty one checks nothing while reading as checked (issue #964)`,
    );
  }
  if (carveOuts.size === 0) {
    findings.push(
      `${MANIFEST_PATH}: no excluded carve-out has reason "contextual-keyword" — spec/grammar.md:380 names four such words, so an empty set here is drift rather than a language with none`,
    );
  }
  const named = new Set(words.map((word) => word.name));
  // Every position this gate knows how to verify must be claimed by at least one word. Without it,
  // thinning a word's `positions` on BOTH axes at once passed: the two are pinned against each
  // other, so a synchronized shrink satisfied both and silently dropped the only probe holding a
  // normative position (issue #959 review round 2, QA finding N1).
  const claimed = new Set(
    words.flatMap((word) => Object.keys(word.positions ?? {})),
  );
  const unclaimed = Object.keys(CONTEXTUAL_POSITION_NODE_KINDS).filter(
    (position) => !claimed.has(position),
  );
  if (unclaimed.length > 0) {
    findings.push(
      `${MANIFEST_PATH}: no contextual word claims position(s) ${unclaimed.join(", ")} — spec/grammar.md:380 makes each of them structural, and the probe is the only thing proving the highlighter paints a word "${declared.class}" there`,
    );
  }
  for (const name of carveOuts.keys()) {
    if (!named.has(name)) {
      findings.push(
        `tokenClass.contextual: does not declare a paint for ${name}, which excluded records as a contextual keyword — the two are the same word's two axes and neither may name a word the other does not`,
      );
    }
  }
  for (const word of words) {
    const positions = carveOuts.get(word.name);
    if (positions === undefined) {
      findings.push(
        `tokenClass.contextual ${word.name}: has no excluded carve-out with reason "contextual-keyword" — a word painted by position is structural by position, and must be recorded on both axes`,
      );
      continue;
    }
    const probed = Object.keys(word.positions ?? {});
    const missing = positions.filter((position) => !probed.includes(position));
    const extra = probed.filter((position) => !positions.includes(position));
    if (missing.length > 0) {
      findings.push(
        `tokenClass.contextual ${word.name}: no probe for position(s) ${missing.join(", ")}, which excluded records — an unprobed position is an unchecked claim`,
      );
    }
    if (extra.length > 0) {
      findings.push(
        `tokenClass.contextual ${word.name}: probes position(s) ${extra.join(", ")} that excluded does not record`,
      );
    }
    for (const [position, probe] of Object.entries(word.positions ?? {})) {
      const kind = CONTEXTUAL_POSITION_NODE_KINDS[position];
      if (kind === undefined) {
        findings.push(
          `tokenClass.contextual ${word.name}: position ${position} has no AST node kind this gate can verify a probe against — an unverifiable position label is decorative`,
        );
      } else if (
        !paintedInsideNode(api, probe, word.name, declared.class, kind)
      ) {
        findings.push(
          `tokenClass.contextual ${word.name}: in probe ${JSON.stringify(probe)} the occurrence painted "${declared.class}" is not inside a ${kind} node, so the probe does not put the word in the ${position} position it is labelled with`,
        );
      }
      const painted = api
        .highlight(probe, "<contextual-probe>", {
          profiles: api.OL_CHECK_PROFILES,
        })
        .filter((token) => token.text.toLowerCase() === word.name)
        .map((token) => token.class);
      if (painted.length === 0 || painted.some((c) => c !== declared.class)) {
        findings.push(
          `tokenClass.contextual ${word.name}: probe ${JSON.stringify(probe)} for position ${position} paints it ${painted.length === 0 ? "nothing at all" : [...new Set(painted)].join(" and ")}, not "${declared.class}"`,
        );
      }
    }
    if ((word.elsewhereProbes ?? []).length === 0) {
      findings.push(
        `tokenClass.contextual ${word.name}: records no elsewhereProbes — without one, nothing shows the word is an ordinary name outside its positions, which is the whole reason it is not a row in names`,
      );
    }
    // Each declared context must actually be rendered, so the set cannot be thinned to whichever
    // probe happens to be first (issue #959 review round 3, QA finding F2).
    const uncovered = Object.entries(CONTEXTUAL_ELSEWHERE_CONTEXTS)
      .filter(
        ([, render]) =>
          !(word.elsewhereProbes ?? []).includes(render(word.name)),
      )
      .map(([context]) => context);
    if (uncovered.length > 0) {
      findings.push(
        `tokenClass.contextual ${word.name}: no elsewhereProbe puts it in the ${uncovered.join(", ")} context — an ordinary-name claim shown in one position only is thinner than it reads`,
      );
    }
    for (const probe of word.elsewhereProbes ?? []) {
      const painted = api
        .highlight(probe, "<contextual-probe>", {
          profiles: api.OL_CHECK_PROFILES,
        })
        .filter((token) => token.text.toLowerCase() === word.name)
        .map((token) => token.class);
      if (
        painted.length === 0 ||
        painted.some((c) => c !== declared.elsewhereClass)
      ) {
        findings.push(
          `tokenClass.contextual ${word.name}: probe ${JSON.stringify(probe)} paints it ${painted.length === 0 ? "nothing at all" : [...new Set(painted)].join(" and ")} outside its structural positions, not "${declared.elsewhereClass}"`,
        );
      }
    }
  }
  return findings;
}

/**
 * `` `word1`, `word2`, and `word3` `` — an Oxford-comma English list of backticked names, which is
 * how the token-class row's two generated clauses render their data.
 */
export function renderNameList(names) {
  const quoted = names.map((name) => `\`${name}\``);
  if (quoted.length < 2) {
    return quoted.join("");
  }
  return `${quoted.slice(0, -1).join(", ")}, and ${quoted[quoted.length - 1]}`;
}

/**
 * The two sentences of `spec/tooling.md`'s `keyword` row that carry data, **rendered from the
 * declaration**. The row must contain each verbatim.
 *
 * This is the "generated from" half of the row's contract, and it is what the earlier set-comparison
 * could not do: comparing only *which* names the row mentioned left the sentence around them free,
 * so inverting its polarity — `` are **not** in this class `` to `` are **also** in this class `` —
 * passed while putting a false normative claim on disk (issue #959 review, finding 6). The words and
 * the class in each sentence now come from `spec/built-in-names.json`, which is itself compared
 * against the running highlighter.
 *
 * **The limit, stated rather than implied:** the English *around* the data is a template here, so
 * this verifies the row renders the declaration and nothing about whether the template's own wording
 * is a faithful rendering of it. Co-editing the template and the row would pass — but that is a
 * change to `spec/**` and `scripts/**` in one PR, which `CODEOWNERS` puts in front of the
 * maintainer. It is not a digest that anyone can recompute alone.
 */
export function generatedRowClauses(manifest) {
  const clauses = [];
  const exceptions = manifest.names.filter(
    (entry) => entry.tokenClass !== entry.category,
  );
  const classes = [...new Set(exceptions.map((entry) => entry.tokenClass))];
  // No exceptions is a coherent state — the two axes would simply agree everywhere — and then the
  // row has no exception sentence to carry. The set-comparison below still forbids it naming one.
  if (exceptions.length > 0) {
    clauses.push([
      "the two-axis exceptions",
      classes.length === 1
        ? `The word-spelled operators ${renderNameList(exceptions.map((entry) => entry.name))} are the only built-in names whose token class differs from their category: they are **not** in this class — they are \`${classes[0]}\` below.`
        : null,
    ]);
  }
  const contextual = contextualDeclaration(manifest);
  clauses.push([
    "the contextual words",
    `The contextual words ${renderNameList(contextual.words.map((word) => word.name))} take this class only in the structural positions described under [Reserved words](#reserved-words-for-tooling), and are ordinary names elsewhere.`,
  ]);
  return clauses;
}

/**
 * The profile half of the row's rule. It carries no data to render, so it is a **required literal**
 * — nothing more and nothing less. It exists because the polarity of this sentence is a normative
 * claim that the rest of the row check could not see: rewriting it to "whether or not their profile
 * is active" contradicts `spec/tooling.md:31` and used to pass.
 */
export const REQUIRED_ROW_SENTENCES = [
  "Profile words — a profile's block-heads and its mode-switch commands — take this class while their profile is active, and `primitive` while it is not.",
];

/**
 * The contexts every contextual word must be shown to be an ordinary name in.
 *
 * `elsewhereProbes` was checked only for `length > 0`, so thinning all four words to one probe each
 * — dropping the whole reporter-argument context — left the DoD green with a byte-identical summary
 * (issue #959 review round 3, QA finding F2). The declaration names the contexts; each word must
 * carry a probe rendering each of them, so a context cannot be dropped from one word or from all.
 */
export const CONTEXTUAL_ELSEWHERE_CONTEXTS = {
  "local-binder": (name) => `local ${name}`,
  "reporter-argument": (name) => `print ${name}`,
};

/**
 * A re-enumeration of the class written to dodge {@link backtickedWords}, which only sees
 * individually backticked bare words.
 *
 * Two shapes, both measured as escapes before this existed: a run of names in one code span, and a
 * bare English list. Detected as **list syntax** — three or more built-in names in a row, joined by
 * commas and/or `and`/`or`, in any case — rather than by scanning for individual words, which is
 * unusable here: `in`, `to`, `set`, `for`, `value` and `key` are all built-in names and all ordinary
 * English, so a per-word scan fires on the row's own prose. Names are regex-escaped, because
 * `member?` and `empty?` carry a metacharacter.
 *
 * **This is a heuristic, and the ADR says so.** It raises the cost of copying the enumeration back
 * into prose; it is not a proof that no enumeration can be expressed. What is *guaranteed* is the
 * verbatim rendering of the two data-bearing sentences ({@link generatedRowClauses}) and the
 * both-directions set comparison of the names the row backticks.
 */
export function reEnumerationFindings(row, names) {
  const findings = [];
  const lower = names.map((name) => name.toLowerCase());
  const isName = (word) => lower.includes(word.toLowerCase());
  for (const span of row.match(/`[^`]+`/g) ?? []) {
    const words = span.slice(1, -1).trim().split(/\s+/);
    if (words.length >= 3 && words.every(isName)) {
      findings.push(
        `${TOOLING_PATH}: the \`keyword\` token-class row holds the code span ${span}, which lists ${words.length} built-in names in one span — the class is enumerated in ${MANIFEST_PATH}, and a span like this is that list copied back into prose`,
      );
    }
  }
  const escaped = lower
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((left, right) => right.length - left.length);
  const alternation = `(?:${escaped.join("|")})`;
  // Identifier-aware boundaries, NOT `\b`: OpenLogo names may end in `?` or `!`
  // (`spec/grammar.md:15`), and `\b` cannot match after a non-word character, so
  // `member?, empty?, and list?` slipped past a `\b`-anchored rule entirely (issue #959 review
  // round 3, finding 3). The classes are Unicode-aware because a user name may contain Unicode
  // letters (`spec/tooling.md:24`), so `éset` is ONE identifier and must not read as a boundary
  // before `set` (round 4).
  const identifier = "[\\p{L}\\p{N}_?!]";
  const before = `(?<!${identifier})`;
  const after = `(?!${identifier})`;
  // A separator is a comma, or `and`/`or` with or without the Oxford comma before it: `a, b and c`
  // escaped a comma-only rule.
  const separator = "(?:\\s*,\\s*|\\s*,?\\s+(?:and|or)\\s+)";
  const list = new RegExp(
    `${before}${alternation}${after}(?:${separator}${alternation}${after}){2,}`,
    "giu",
  );
  const prose = row.replace(/`[^`]+`/g, " ");
  for (const run of prose.match(list) ?? []) {
    findings.push(
      `${TOOLING_PATH}: the \`keyword\` token-class row holds the list "${run}" — three or more built-in names in a row is the class enumerated back into prose, which ${MANIFEST_PATH} is the home for`,
    );
  }
  return findings;
}

/**
 * `spec/tooling.md`'s `keyword` row, compared against the declaration four ways.
 *
 * The row no longer enumerates the class — it points at `spec/built-in-names.json`, and that pointer
 * is required, because a row that names no home for the enumeration has quietly become the
 * enumeration again. Beyond that:
 *
 * - both data-bearing sentences are **generated** from the declaration and must appear verbatim
 *   ({@link generatedRowClauses}), so their polarity and their words are both fixed;
 * - the profile sentence is a {@link REQUIRED_ROW_SENTENCES} literal, having no data to render;
 * - the set of built-in names the row names backticked must **equal** the two-axis exception set, in
 *   both directions, so no class member can be named anywhere else in the row;
 * - {@link reEnumerationFindings} catches an enumeration written to dodge the backtick scan.
 *
 * The contextual four are also stated in `spec/tooling.md`'s "Reserved words for tooling" and in
 * `spec/grammar.md`; both are read through their own fail-closed anchor and both must equal the
 * declaration.
 */
export function tokenClassRowFindings(manifest, row, toolingText, grammarText) {
  const findings = [];
  if (!row.includes("built-in-names.json")) {
    findings.push(
      `${TOOLING_PATH}: the \`keyword\` token-class row no longer points at ${MANIFEST_PATH} — the class is declared there, and a row that names no home for it is the enumeration again`,
    );
  }

  let residue = row;
  for (const [describe, clause] of generatedRowClauses(manifest)) {
    if (clause === null) {
      findings.push(
        `${MANIFEST_PATH}: the two-axis exceptions do not share one tokenClass, so ${describe} cannot be rendered — the row's sentence is generated from them and there is no single class to name`,
      );
      continue;
    }
    if (residue.includes(clause)) {
      residue = residue.replace(clause, " ");
      continue;
    }
    findings.push(
      `${TOOLING_PATH}: the \`keyword\` token-class row does not carry ${describe} as ${MANIFEST_PATH} renders it. Expected verbatim: ${clause}`,
    );
  }
  for (const sentence of REQUIRED_ROW_SENTENCES) {
    if (residue.includes(sentence)) {
      residue = residue.replace(sentence, " ");
      continue;
    }
    findings.push(
      `${TOOLING_PATH}: the \`keyword\` token-class row does not carry the required sentence verbatim: ${sentence}`,
    );
  }

  const listed = new Set(manifest.names.map((entry) => entry.name));
  const exceptions = manifest.names
    .filter((entry) => entry.tokenClass !== entry.category)
    .map((entry) => entry.name);
  const namedInRow = [
    ...new Set(backtickedWords(row).filter((word) => listed.has(word))),
  ];
  const copied = namedInRow.filter((word) => !exceptions.includes(word));
  const dropped = exceptions.filter((word) => !namedInRow.includes(word));
  if (copied.length > 0) {
    findings.push(
      `${TOOLING_PATH}: the \`keyword\` token-class row names ${copied.join(", ")}, whose token class equals its category — the row states only the exceptions, and anything more is a second copy of a list ${MANIFEST_PATH} already carries`,
    );
  }
  if (dropped.length > 0) {
    findings.push(
      `${TOOLING_PATH}: the \`keyword\` token-class row does not name ${dropped.join(", ")}, whose token class differs from its category — those exceptions are what the row is for`,
    );
  }
  findings.push(...reEnumerationFindings(residue, [...listed]));

  const contextual = contextualDeclaration(manifest).words.map(
    (word) => word.name,
  );
  for (const [describe, open, close, source] of CONTEXTUAL_PROSE_ANCHORS) {
    const words = wordsBetween(
      source === "grammar" ? grammarText : toolingText,
      open,
      close,
    );
    if (words === null) {
      findings.push(
        `${describe}: could not read the contextual words out of it — the anchor "${open.trim()} ... ${close.trim()}" this gate reads has moved`,
      );
      continue;
    }
    if (words.join(" ") !== contextual.join(" ")) {
      findings.push(
        `${describe} names the contextual words [${words.join(", ")}], and tokenClass.contextual declares [${contextual.join(", ")}]`,
      );
    }
  }
  return findings;
}

/**
 * The three hand-maintained lists in `spec/` that this gate covers.
 *
 * Two are compared **derivedly**, by computing the expected words from the manifest and the
 * implementation: `spec/grammar.md`'s normative keyword block, and `spec/tooling.md`'s C19 mirror,
 * which must carry the same words in the same order. The comparison is on the **extracted words**,
 * not the bytes, so changing the spacing *between* them is not a finding. A blank line inside the
 * **mirror** paragraph is, because its extraction ends at the paragraph; `spec/grammar.md`'s block
 * is inside a fence, which a blank line does not close, so it survives one. That pair is the one
 * that caught the drift which actually happened — the mirror silently losing `mod` and standing at
 * 43 words.
 *
 * The third, `spec/tooling.md`'s `keyword` **token-class** row, was change-detected until issue #959
 * moved the enumeration into the manifest; {@link tokenClassRowFindings} now compares what it still
 * names against that declaration in both directions.
 */
export function proseFindings(manifest, io) {
  const findings = [];
  const grammarText = readDocument(io, GRAMMAR_PATH, findings);
  const grammarWords = extractGrammarKeywordBlock(grammarText);
  if (grammarWords === null) {
    findings.push(
      `${GRAMMAR_PATH}: could not find the fenced keyword block after "The normative OpenLogo keyword list is:" — the anchor this gate reads has moved`,
    );
  }

  const toolingText = readDocument(io, TOOLING_PATH, findings);
  const mirrorWords = extractToolingC19Mirror(toolingText);
  if (mirrorWords === null) {
    findings.push(
      `${TOOLING_PATH}: could not find the C19 mirror paragraph after "this is the C19 registry repeated" — the anchor this gate reads has moved`,
    );
  }

  const row = extractToolingKeywordRow(toolingText);
  if (row === null) {
    findings.push(
      `${TOOLING_PATH}: could not find exactly one \`keyword\` token-class row — the row this gate reads has moved or been duplicated`,
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
    findings.push(
      ...tokenClassRowFindings(manifest, row, toolingText, grammarText),
    );
  }

  return findings;
}

/**
 * The profile sections of `spec/conformance.md`: every `###` heading between the "Required
 * profiles" and "Feature to profile table" headings, which is the region covering the required and
 * optional profile sections. Anchored on the existing headings, fail-closed if either moves.
 */
export function extractConformanceProfiles(text) {
  if (typeof text !== "string") {
    return null;
  }
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
  const sections = extractConformanceProfiles(
    readDocument(io, CONFORMANCE_PATH, findings),
  );
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
    ...["about", "classVocabulary", "positionIndependence"].map((key) => [
      `tokenClass.${key}`,
      manifest.tokenClass?.[key],
    ]),
    ["tokenClass.contextual.about", manifest.tokenClass?.contextual?.about],
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
 * the decoded strings** inside a normative `spec/` artefact. Still valid JSON, still Prettier-clean,
 * still zero findings, and four words left unreadable.
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
 * Scoped to `note` deliberately: `invariants`, `profiles.about`, `tokenClass` and each
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
  io: rawIo = REAL_IO,
} = {}) {
  // Every document this run reads is read once, so all checks judge the same bytes.
  const io = oneReadPerDocument(rawIo);
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

  // ONE walk per run, shared by the check and the report. Two walks let a non-idempotent port
  // disagree with itself: validation could see the library while the summary line reported
  // `over 0 stdlib file(s)` beside `0 finding(s)`, which is a green run describing a tree it did
  // not check. The scan surface a report cites has to be the one the checks actually used.
  const stdlibFiles = listStdlibOrEmpty(io);

  const findings = [
    ...versionFindings(resolved, api),
    ...narrativeFindings(resolved),
    ...accessorFindings(resolved, api),
    ...duplicateRegistrationFindings(resolved, api),
    ...entryFindings(resolved, api),
    ...tokenClassFindings(resolved, api),
    ...tokenClassSourceFindings(resolved, api),
    ...contextualTokenClassFindings(resolved, api),
    ...implementationFindings(resolved, api),
    ...directionAgreementFindings(resolved, api),
    ...profilePrimitiveSweepFindings(resolved, api),
    ...aliasFindings(resolved, api),
    ...carveOutFindings(resolved, io),
    ...stdlibCarveOutFindings(resolved, io, stdlibFiles),
    ...contextualCarveOutFindings(resolved, api, io),
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
  // The carve-out total is broken out by reason because the two halves are bound to DIFFERENT
  // authorities — the library ones to a walk of `stdlib/**.logo`, the contextual ones to
  // `spec/grammar.md`'s own enumeration — and a single number would hide which of them a green run
  // actually asserted. Reporting the scan surface beside the count is what makes it evidence
  // rather than a tally of whatever the file happens to contain (epic #900).
  const carveOutsByReason = resolved.excluded.reduce((counts, entry) => {
    counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
    return counts;
  }, {});
  const carveOutSummary = Object.keys(carveOutsByReason)
    .sort()
    .map((reason) => `${carveOutsByReason[reason]} ${reason}`)
    .join(" + ");
  lines.push(
    `built-in-names: ${resolved.names.length} names, ${resolved.excluded.length} carve-outs (${carveOutSummary}) over ${stdlibFiles.length} ${STDLIB_DIR} file(s), ${Object.keys(resolved.registries).length} registries, spec version ${resolved.specVersion} — ${findings.length} finding(s)`,
  );
  const painted = new Map();
  for (const entry of resolved.names) {
    painted.set(entry.tokenClass, (painted.get(entry.tokenClass) ?? 0) + 1);
  }
  lines.push(
    `built-in-names: token classes re-painted through highlight() in ${TOKEN_CLASS_PROBES.length} positions — ${[
      ...painted,
    ]
      .sort()
      .map(([tokenClass, count]) => `${count} ${tokenClass}`)
      .join(
        ", ",
      )}, plus ${contextualDeclaration(resolved).words.length} contextual word(s)`,
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
