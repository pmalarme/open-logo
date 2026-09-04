// The identity assertion for saga #811's THIRD fault class (issue #1087).
//
// `challenge` is registered by `@openlogo/parser`'s Tutor primitive table and its canonical
// signature is normative in `spec/conformance.md:239-244`, but `@openlogo/runtime` has no evaluator
// for it, so `packages/parser/src/checker-names.ts` deliberately withholds the name — the filter sits
// INSIDE the per-profile loop that builds the visible-name set, so the name is never added rather
// than being subtracted afterwards. (`spec/ai-tutor.md` describes `challenge` at length but is
// marked `Status: Informative`, and `spec/conformance.md:236` says so explicitly, so it is not the
// normative source for anything asserted here.)
//
// The consequence, measured below, is that a learner who types `challenge` is told the same thing as
// a learner who types a word that does not exist in any profile.
//
// **This is what the fix destroys, and therefore what has to be recorded now.** Once #814 rules and
// #815 lands, `challenge` stops reporting `ol-unknown-command` while `wibble` keeps it, and nothing
// in the tree would otherwise record that the two were ever indistinguishable. That identity is the
// strongest available argument for the `ol-not-implemented` code existing at all: it is justified
// precisely because, without it, the implementation reports the learner's typo for its own omission.
// A fixture written after the fix could only assert the fix; it could prove nothing about what was
// wrong.
//
// It lives in `node:test` rather than in an `.expected.json` because a conformance fixture pairs ONE
// source with ONE expected stream, and this is a **relation between two sources** — the same reason
// `scripts/examples-semantic-sweep.test.mjs` is a test. The per-source behaviour of `challenge` is
// pinned by the three fixtures beside this file; only the equality is here.
//
// **When #815 lands, this file must be INVERTED, not deleted** — the equality becomes a
// disequality, and asserting that `challenge` and `wibble` are finally distinguishable is exactly
// how the fix proves it did its job.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SUPPORTED_PROFILES } from "@openlogo/core";
import { check, namesAwaitingAnEvaluator, parse, walk } from "@openlogo/parser";
import { execute } from "@openlogo/runtime";

/** Registered, correctly kinded, and unevaluable — the third fault class. */
const REGISTERED_BUT_UNEVALUABLE = "challenge\n";
const REGISTERED_CALLEE = "challenge";

/** Shape A: a name no profile defines. Saga #811's own reproduction. */
const GENUINELY_UNKNOWN = "print (wibble 2)\n";
const UNKNOWN_CALLEE = "wibble";

/** A third program whose classification genuinely differs, used to prove the comparison bites. */
const DIFFERENTLY_CLASSIFIED = 'challenge "x"\n';

const PROFILE_SETS = [
  ["core-language alone", ["core-language"]],
  ["Educational active", ["core-language", "educational"]],
  ["Tutor (AI) active", ["core-language", "educational", "tutor-ai"]],
  ["the host's supported set", [...SUPPORTED_PROFILES]],
];

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

/** Every built-in name the specification defines, from the authoritative manifest (ADR-0021). */
const BUILT_IN_NAMES = new Set(
  JSON.parse(
    readFileSync(join(REPO_ROOT, "spec", "built-in-names.json"), "utf8"),
  ).names.map((entry) => entry.name),
);

/**
 * The learner-visible **classification** of a stage's diagnostics: code, stage and severity, in
 * order.
 *
 * `params`, `message` and `source_span` are deliberately excluded, and saying so precisely matters:
 * the two programs name different words at different offsets, so those fields MUST differ and
 * asserting them equal would be false. The claim this file makes is therefore NOT that the two
 * programs are indistinguishable in every byte — it is the narrower and more damaging one that their
 * **classification** is identical, so the two faults are reported to a learner as the same kind of
 * mistake. `spec/error-model.md:97` defines `ol-unknown-command` as being about a name that "is not
 * known", which is a true statement about `wibble` and a false one about `challenge`.
 */
function classification(diagnostics) {
  return diagnostics.map(
    (diagnostic) =>
      `${diagnostic.code}/${diagnostic.stage}/${diagnostic.severity}`,
  );
}

/** The profile-dependent half: what the parser and checker say under one active profile set. */
function observeCheck(source, profiles) {
  const parsed = parse(source, "identity-probe");
  const checked = check(parsed.ast, { profiles, source });
  return {
    parse: classification(parsed.diagnostics),
    check: classification(checked.diagnostics),
  };
}

/**
 * The profile-independent half. `execute()` takes no profile set, so this is invariant across
 * `PROFILE_SETS` by construction — it is asserted ONCE rather than inside the profile loop, so the
 * loop is not credited with proving more than it does.
 */
function observeExecute(source) {
  const executed = execute(source, "identity-probe");
  return {
    diagnostics: classification(executed.diagnostics),
    eventKinds: executed.events.map((event) => event.kind),
  };
}

/**
 * The callee names a program actually calls, read from the parsed AST rather than from the source
 * text.
 *
 * Substring matching is not good enough here, and that is not hypothetical: a reviewer changed the
 * third-class operand to `challenge2` — a genuinely unknown name that *contains* `challenge` — and
 * a `source.includes(callee)` guard accepted it, leaving the whole file green while the operand it
 * was guarding had silently become an ordinary shape-A program. `node.callee.name` is the same
 * field `checker-unknown-command.ts` keys its own rule on, so the guard now binds to the thing the
 * checker actually judged.
 */
function calleesOf(source) {
  const { ast } = parse(source, "taxonomy-probe");
  const callees = [];
  walk(ast, (node) => {
    if (node.kind === "Call" || node.kind === "ParenCall") {
      callees.push(node.callee.name.toLowerCase());
    }
  });
  return callees;
}

test("the two operands really are the two different fault classes", () => {
  // Without this, the whole file is vacuous: if both constants named the SAME program, every
  // equality below would hold trivially and every other test here would still pass. That is not
  // hypothetical — a reviewer made the two constants identical and nothing failed. So pin the
  // taxonomy itself, from the registry rather than from prose: `namesAwaitingAnEvaluator()` is
  // exported by `@openlogo/parser` precisely because "a claim nothing can call is a claim nothing
  // can check".
  assert.notEqual(REGISTERED_BUT_UNEVALUABLE, GENUINELY_UNKNOWN);
  assert.deepEqual(calleesOf(REGISTERED_BUT_UNEVALUABLE), [REGISTERED_CALLEE]);
  assert.deepEqual(calleesOf(GENUINELY_UNKNOWN), ["print", UNKNOWN_CALLEE]);

  // `challenge` is REGISTERED (the specification defines it) and WITHHELD (nothing can run it).
  assert.ok(
    BUILT_IN_NAMES.has(REGISTERED_CALLEE),
    "challenge must be a defined built-in name",
  );
  assert.deepEqual(
    namesAwaitingAnEvaluator(),
    [REGISTERED_CALLEE],
    "challenge must be the withheld name, and the only one — a second would need its own fixture",
  );

  // `wibble` is neither: it is genuinely unknown to the specification.
  assert.ok(
    !BUILT_IN_NAMES.has(UNKNOWN_CALLEE),
    "wibble must not be a defined built-in name",
  );
  assert.ok(!namesAwaitingAnEvaluator().includes(UNKNOWN_CALLEE));
});

test("the comparison bites: two differently-classified programs are not equal", () => {
  // Sanity-assert the instrument before trusting any equality it reports. An equality test that
  // cannot fail asserts nothing (`.github/skills/shared/conformance-fixture/SKILL.md`).
  const challenge = observeCheck(REGISTERED_BUT_UNEVALUABLE, ["core-language"]);
  const different = observeCheck(DIFFERENTLY_CLASSIFIED, ["core-language"]);
  assert.notDeepEqual(challenge, different);
  assert.deepEqual(challenge.check, ["ol-unknown-command/semantic/error"]);
  assert.deepEqual(different.parse, ["ol-bad-token/parse/error"]);

  // The same sanity assertion for the OTHER instrument. `observeExecute` needs its own, because a
  // helper that ignored its argument would satisfy the run-time equality below while never
  // measuring the `wibble` side at all — structurally the same vacuity the taxonomy guard above
  // closes for `observeCheck`, and found by a reviewer in exactly that way.
  assert.notDeepEqual(
    observeExecute(DIFFERENTLY_CLASSIFIED),
    observeExecute(REGISTERED_BUT_UNEVALUABLE),
  );
});

test("a registered-but-unevaluable name is classified exactly like an unknown one", () => {
  for (const [label, profiles] of PROFILE_SETS) {
    assert.deepEqual(
      observeCheck(REGISTERED_BUT_UNEVALUABLE, profiles),
      observeCheck(GENUINELY_UNKNOWN, profiles),
      `under ${label}, \`challenge\` and \`wibble\` are classified differently — if this fails ` +
        "because #815 has landed, INVERT this file rather than deleting it: the disequality is " +
        "how the fix proves it worked",
    );
  }
});

test("and both then run silently, emitting only a statement marker", () => {
  assert.deepEqual(
    observeExecute(REGISTERED_BUT_UNEVALUABLE),
    observeExecute(GENUINELY_UNKNOWN),
    "the two programs are also indistinguishable at run time",
  );
  // Stated positively as well as relationally: an equality alone would also be satisfied if BOTH
  // programs started reporting something correct, so this pins which side of the equality we are on.
  assert.deepEqual(observeExecute(REGISTERED_BUT_UNEVALUABLE), {
    diagnostics: [],
    eventKinds: ["instruction"],
  });
});

test("the checker calls a registered name unknown, under every profile set", () => {
  for (const [label, profiles] of PROFILE_SETS) {
    assert.deepEqual(
      observeCheck(REGISTERED_BUT_UNEVALUABLE, profiles),
      { parse: [], check: ["ol-unknown-command/semantic/error"] },
      `${label}: the program parses cleanly and the checker calls a registered name unknown`,
    );
  }
});

test("turning the Tutor (AI) profile on does not make the name available", () => {
  // The withholding is unconditional, which is what makes this a third class rather than an
  // ordinary inactive-profile result: no profile set can restore the name. Measured, not reasoned
  // from the source.
  const withoutTutor = observeCheck(REGISTERED_BUT_UNEVALUABLE, [
    "core-language",
    "educational",
  ]);
  const withTutor = observeCheck(REGISTERED_BUT_UNEVALUABLE, [
    "core-language",
    "educational",
    "tutor-ai",
  ]);
  assert.deepEqual(withTutor, withoutTutor);
  assert.deepEqual(withTutor.check, ["ol-unknown-command/semantic/error"]);
});
