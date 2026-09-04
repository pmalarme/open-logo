// The identity assertion for saga #811's THIRD fault class (issue #1087).
//
// `challenge` is registered by `@openlogo/parser`'s Tutor primitive table and defined normatively by
// `spec/ai-tutor.md`, but `@openlogo/runtime` has no evaluator for it, so
// `packages/parser/src/checker-names.ts` deliberately withholds the name from `collectVisibleNames`.
// The consequence, measured below, is that a learner who types `challenge` is told the same thing as
// a learner who types a word that does not exist in any profile.
//
// **This is what the fix destroys, and therefore what has to be recorded now.** Once #814 rules and
// #815 lands, `challenge` reports `ol-not-implemented` while `wibble` keeps `ol-unknown-command`, and
// nothing in the tree would otherwise record that the two were ever indistinguishable. That identity
// is the strongest available argument for `ol-not-implemented` existing at all: the new code is
// justified precisely because, without it, the implementation reports the learner's typo for its own
// omission. A fixture written after the fix could only assert the fix; it could prove nothing about
// what was wrong.
//
// It lives in `node:test` rather than in an `.expected.json` because a conformance fixture pairs ONE
// source with ONE expected stream, and this is a **relation between two sources**. The same reason
// `scripts/examples-semantic-sweep.test.mjs` is a test rather than a fixture. The per-source
// behaviour of `challenge` is pinned by the three fixtures beside this file; only the equality is
// here.
//
// **When #815 lands, this file must be INVERTED, not deleted** — the equality becomes a
// disequality, and asserting that `challenge` and `wibble` are finally distinguishable is exactly
// how the fix proves it did its job.

import assert from "node:assert/strict";
import test from "node:test";

import { SUPPORTED_PROFILES } from "@openlogo/core";
import { check, parse } from "@openlogo/parser";
import { execute } from "@openlogo/runtime";

/** Registered, correctly kinded, and unevaluable — the third fault class. */
const REGISTERED_BUT_UNEVALUABLE = "challenge\n";

/** Shape A: a name no profile defines. Saga #811's own reproduction. */
const GENUINELY_UNKNOWN = "print (wibble 2)\n";

/** A third program whose classification genuinely differs, used to prove the comparison bites. */
const DIFFERENTLY_CLASSIFIED = 'challenge "x"\n';

const PROFILE_SETS = [
  ["core-language alone", ["core-language"]],
  ["Educational active", ["core-language", "educational"]],
  ["Tutor (AI) active", ["core-language", "educational", "tutor-ai"]],
  ["the host's supported set", [...SUPPORTED_PROFILES]],
];

/**
 * The learner-visible **classification** of a stage's diagnostics: code, stage and severity, in
 * order.
 *
 * `params` and `source_span` are deliberately excluded, and their exclusion is the honest scope of
 * this whole file: the two programs name different words at different offsets, so those fields
 * MUST differ and asserting them equal would be false. What is claimed — and what actually harms a
 * learner — is that the classification is the same, so the two faults are reported as the same kind
 * of mistake. `spec/error-model.md:97` is where `ol-unknown-command` is defined as being about a
 * name that "is not known", which is a true statement about `wibble` and a false one about
 * `challenge`.
 */
function classification(diagnostics) {
  return diagnostics.map(
    (diagnostic) =>
      `${diagnostic.code}/${diagnostic.stage}/${diagnostic.severity}`,
  );
}

/** Everything an observer can see about one program at one profile set. */
function observe(source, profiles) {
  const parsed = parse(source, "identity-probe");
  const checked = check(parsed.ast, { profiles, source });
  const executed = execute(source, "identity-probe");
  return {
    parse: classification(parsed.diagnostics),
    check: classification(checked.diagnostics),
    executeDiagnostics: classification(executed.diagnostics),
    executeEventKinds: executed.events.map((event) => event.kind),
  };
}

test("the comparison bites: two differently-classified programs are not equal", () => {
  // Sanity-assert the instrument before trusting any equality it reports. An equality test that
  // cannot fail asserts nothing, and `observe()` returning some constant would look exactly like a
  // successful run (`.github/skills/shared/conformance-fixture/SKILL.md`).
  const challenge = observe(REGISTERED_BUT_UNEVALUABLE, ["core-language"]);
  const different = observe(DIFFERENTLY_CLASSIFIED, ["core-language"]);
  assert.notDeepEqual(challenge, different);
  assert.deepEqual(challenge.check, ["ol-unknown-command/semantic/error"]);
  assert.deepEqual(different.parse, ["ol-bad-token/parse/error"]);
});

test("a registered-but-unevaluable name is indistinguishable from an unknown one", () => {
  for (const [label, profiles] of PROFILE_SETS) {
    const registered = observe(REGISTERED_BUT_UNEVALUABLE, profiles);
    const unknown = observe(GENUINELY_UNKNOWN, profiles);
    assert.deepEqual(
      registered,
      unknown,
      `under ${label}, \`challenge\` and \`wibble\` are reported differently — if this fails ` +
        "because #815 has landed, INVERT this file rather than deleting it: the disequality is " +
        "how the fix proves it worked",
    );
  }
});

test("both are reported as an unknown name, and both then run silently", () => {
  // Stated positively as well as relationally: an equality alone would also be satisfied if BOTH
  // programs started reporting something correct, so this pins which side of the equality we are on.
  for (const [label, profiles] of PROFILE_SETS) {
    const registered = observe(REGISTERED_BUT_UNEVALUABLE, profiles);
    assert.deepEqual(
      registered.parse,
      [],
      `${label}: the program parses cleanly`,
    );
    assert.deepEqual(
      registered.check,
      ["ol-unknown-command/semantic/error"],
      `${label}: the checker calls a registered name unknown`,
    );
    assert.deepEqual(
      registered.executeDiagnostics,
      [],
      `${label}: running it reports nothing at all`,
    );
    assert.deepEqual(
      registered.executeEventKinds,
      ["instruction"],
      `${label}: it emits its statement marker and then does nothing`,
    );
  }
});

test("turning the Tutor (AI) profile on does not make the name available", () => {
  // The withholding is unconditional, which is what makes this a third class rather than an
  // ordinary inactive-profile result: `packages/parser/src/checker-names.ts`'s
  // NAMES_AWAITING_AN_EVALUATOR is subtracted after the profile sweep, so no profile set can
  // restore the name. Measured rather than reasoned from the source.
  const withoutTutor = observe(REGISTERED_BUT_UNEVALUABLE, [
    "core-language",
    "educational",
  ]);
  const withTutor = observe(REGISTERED_BUT_UNEVALUABLE, [
    "core-language",
    "educational",
    "tutor-ai",
  ]);
  assert.deepEqual(withTutor, withoutTutor);
  assert.deepEqual(withTutor.check, ["ol-unknown-command/semantic/error"]);
});
