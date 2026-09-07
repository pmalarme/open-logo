// The distinguishability assertion for saga #811's THIRD fault class (issues #1087 and #815).
//
// `challenge` is registered by `@openlogo/parser`'s Tutor primitive table and its canonical
// signature is normative in `spec/conformance.md:239-244`, but `@openlogo/runtime` has no evaluator
// for it. (`spec/ai-tutor.md` describes `challenge` at length but is marked `Status: Informative`,
// and `spec/conformance.md:236` says so explicitly, so it is not the normative source for anything
// asserted here.)
//
// **This file was INVERTED, not deleted, and that is deliberate.** Issue #1087 wrote it as an
// *equality*: a learner who typed `challenge` was told the same thing as a learner who typed a word
// that does not exist in any profile, because `packages/parser/src/checker-names.ts` withheld the
// name from the visible-name set so the call would read as unknown. That identity was the strongest
// available argument for `ol-not-implemented` existing at all. Issue #815 deleted the withholding,
// and the equality becoming a **disequality** is how the fix proves it worked — a file written
// after the fix could only assert the fix, and could prove nothing about what was wrong.
// `spec/error-model.md:131` is what makes the old behaviour a violation rather than an unfortunate
// choice: an implementation MUST NOT report `ol-unknown-command` for such a name, at any stage,
// "including by withholding it from the visible vocabulary so that the call reads as unknown".
//
// **The disequality is contingent, and over-claiming it would be the easy mistake here.** The same
// sentence of `spec/error-model.md:131` positively permits `ol-unknown-command` for "a call under a
// profile the run does not claim", so the two programs stay legitimately indistinguishable under a
// run that does not claim Tutor (AI) — measured below across four profile sets, of which exactly
// one separates them. What #815 changed is not that the two are always distinguishable; it is that
// distinguishing them became *possible at all*, by making the answer follow the run's claimed
// profile set instead of being withheld unconditionally.
//
// It lives in `node:test` rather than in an `.expected.json` because a conformance fixture pairs ONE
// source with ONE expected stream, and this is a **relation between two sources** — the same reason
// `scripts/examples-semantic-sweep.test.mjs` is a test. The per-source behaviour of `challenge` is
// pinned by the three fixtures beside this file; only the relation is here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SUPPORTED_PROFILES } from "@openlogo/core";
import { check, parse, walk } from "@openlogo/parser";
import { execute } from "@openlogo/runtime";

/** Registered, correctly kinded, and unevaluable — the third fault class. */
const REGISTERED_BUT_UNEVALUABLE = "challenge\n";
const REGISTERED_CALLEE = "challenge";

/** Shape A: a name no profile defines. Saga #811's own reproduction. */
const GENUINELY_UNKNOWN = "print (wibble 2)\n";
const UNKNOWN_CALLEE = "wibble";

/** A third program whose classification genuinely differs, used to prove the comparison bites. */
const DIFFERENTLY_CLASSIFIED = 'challenge "x"\n';

/** The profile the third class needs a run to claim before it can be told apart. */
const CLAIMS_TUTOR = ["core-language", "educational", "tutor-ai"];

const PROFILE_SETS = [
  ["core-language alone", ["core-language"], false],
  ["Educational active", ["core-language", "educational"], false],
  ["Tutor (AI) active", CLAIMS_TUTOR, true],
  ["the host's supported set", [...SUPPORTED_PROFILES], false],
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
 * asserting them equal would be false. The claim this file makes is therefore about the
 * **classification** — the kind of mistake a learner is told they made — not about every byte.
 * `spec/error-model.md:97` defines `ol-unknown-command` as being about a name that "is not known",
 * which is a true statement about `wibble` and a false one about `challenge`.
 */
function classification(diagnostics) {
  return diagnostics.map(
    (diagnostic) =>
      `${diagnostic.code}/${diagnostic.stage}/${diagnostic.severity}`,
  );
}

/** What the parser and checker say under one active profile set. */
function observeCheck(source, profiles) {
  const parsed = parse(source, "identity-probe");
  const checked = check(parsed.ast, { profiles, source });
  return {
    parse: classification(parsed.diagnostics),
    check: classification(checked.diagnostics),
  };
}

/**
 * What a run says under one **claimed** profile set.
 *
 * Issue #1087 wrote this half as profile-independent, because `execute()` took no profile set and
 * checked itself under a fixed one. That is no longer true: #815 added `ExecuteOptions.profiles`
 * precisely so a run checks itself under the set it claims (`spec/execution-model.md:673-680`), so
 * the parameter is threaded here and this half varies across `PROFILE_SETS` like the other.
 */
function observeExecute(source, profiles) {
  const executed = execute(source, "identity-probe", { profiles });
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
 * field `checker-unknown-command.ts` keys its own rule on, so the guard binds to the thing the
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
  // comparison below would be trivial and every other test here would still pass. That is not
  // hypothetical — a reviewer made the two constants identical and nothing failed.
  assert.notEqual(REGISTERED_BUT_UNEVALUABLE, GENUINELY_UNKNOWN);
  assert.deepEqual(calleesOf(REGISTERED_BUT_UNEVALUABLE), [REGISTERED_CALLEE]);
  assert.deepEqual(calleesOf(GENUINELY_UNKNOWN), ["print", UNKNOWN_CALLEE]);

  // `challenge` is REGISTERED — the specification defines it — and UNEVALUABLE. #1087 pinned the
  // second half against `namesAwaitingAnEvaluator()`, the withheld-name list; #815 deleted that
  // list, because a name held back from the visible vocabulary is the very mechanism
  // `spec/error-model.md:131` forbids. So the property is pinned where it is now observable: a run
  // that CLAIMS Tutor (AI) resolves the name and then reports `ol-not-implemented`, which is the
  // third class's signature and is reachable for no other kind of name.
  assert.ok(
    BUILT_IN_NAMES.has(REGISTERED_CALLEE),
    "challenge must be a defined built-in name",
  );
  assert.deepEqual(
    observeExecute(REGISTERED_BUT_UNEVALUABLE, CLAIMS_TUTOR).diagnostics,
    ["ol-not-implemented/runtime/error"],
    "challenge must be registered-but-unevaluable under a run that claims Tutor (AI)",
  );

  // `wibble` is neither: it is genuinely unknown to the specification, under every set.
  assert.ok(
    !BUILT_IN_NAMES.has(UNKNOWN_CALLEE),
    "wibble must not be a defined built-in name",
  );
  assert.deepEqual(
    observeExecute(GENUINELY_UNKNOWN, CLAIMS_TUTOR).diagnostics,
    ["ol-unknown-command/semantic/error"],
  );
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
  // helper that ignored its `source` would satisfy the comparisons below while never measuring the
  // `wibble` side at all — structurally the same vacuity the taxonomy guard above closes.
  assert.notDeepEqual(
    observeExecute(DIFFERENTLY_CLASSIFIED, CLAIMS_TUTOR),
    observeExecute(REGISTERED_BUT_UNEVALUABLE, CLAIMS_TUTOR),
  );

  // And for the `profiles` parameter of each observer, which is now load-bearing in both. An
  // observer that ignored the profile set it was handed would leave the comparisons green while
  // hollowing out this file's central claim — that the answer FOLLOWS the claimed set. `forward` is
  // a Turtle & Rendering primitive, unknown under Core alone and visible once `turtle-rendering` is
  // active; it witnesses this without involving `challenge`, so the witness is independent of the
  // subject.
  assert.notDeepEqual(
    observeCheck("forward 100\n", ["core-language"]),
    observeCheck("forward 100\n", ["core-language", "turtle-rendering"]),
  );
  assert.notDeepEqual(
    observeExecute("forward 100\n", ["core-language"]),
    observeExecute("forward 100\n", ["core-language", "turtle-rendering"]),
  );
});

test("a run that claims Tutor (AI) finally tells the two apart", () => {
  // The inversion. #1087 asserted these two `deepEqual` under this very profile set.
  assert.notDeepEqual(
    observeCheck(REGISTERED_BUT_UNEVALUABLE, CLAIMS_TUTOR),
    observeCheck(GENUINELY_UNKNOWN, CLAIMS_TUTOR),
  );
  assert.notDeepEqual(
    observeExecute(REGISTERED_BUT_UNEVALUABLE, CLAIMS_TUTOR),
    observeExecute(GENUINELY_UNKNOWN, CLAIMS_TUTOR),
  );

  // Stated positively as well as relationally, so the file pins WHICH side of the disequality we
  // are on: a disequality alone would also be satisfied by two new and differently wrong answers.
  // The registered name checks clean and the run owns the gap; the unknown name is still unknown.
  assert.deepEqual(observeCheck(REGISTERED_BUT_UNEVALUABLE, CLAIMS_TUTOR), {
    parse: [],
    check: [],
  });
  assert.deepEqual(observeExecute(REGISTERED_BUT_UNEVALUABLE, CLAIMS_TUTOR), {
    diagnostics: ["ol-not-implemented/runtime/error"],
    eventKinds: ["instruction"],
  });
  assert.deepEqual(observeExecute(GENUINELY_UNKNOWN, CLAIMS_TUTOR), {
    diagnostics: ["ol-unknown-command/semantic/error"],
    eventKinds: [],
  });
});

test("neither program is silent any more, which is saga #811's actual subject", () => {
  // #1087's counterpart test asserted that both ran silently, emitting only a statement marker and
  // NO diagnostic. Both halves of that are now false, and the second is the one the saga is named
  // for: a program containing an unresolvable name no longer produces a wrong result quietly.
  for (const [label, profiles] of PROFILE_SETS) {
    for (const source of [REGISTERED_BUT_UNEVALUABLE, GENUINELY_UNKNOWN]) {
      assert.notDeepEqual(
        observeExecute(source, profiles).diagnostics,
        [],
        `under ${label}, ${JSON.stringify(source)} ran without reporting anything`,
      );
    }
  }
});

test("but only a run that claims the profile can tell them apart", () => {
  // The bound on the claim above, and the reason this file does not simply assert a blanket
  // disequality. `spec/error-model.md:131` positively permits `ol-unknown-command` for "a call
  // under a profile the run does not claim", so under the three sets that do not claim Tutor (AI)
  // the two programs remain legitimately indistinguishable — including the host's own supported
  // set, which does not list `tutor-ai` today. Measured across all four, so this states exactly one
  // separating set rather than implying every set separates them.
  const separating = [];
  for (const [label, profiles, expectedToSeparate] of PROFILE_SETS) {
    const same =
      JSON.stringify(observeCheck(REGISTERED_BUT_UNEVALUABLE, profiles)) ===
      JSON.stringify(observeCheck(GENUINELY_UNKNOWN, profiles));
    assert.equal(
      !same,
      expectedToSeparate,
      `${label}: expected the two classes to be ${expectedToSeparate ? "distinguishable" : "indistinguishable"}`,
    );
    if (!same) separating.push(label);
  }
  assert.deepEqual(separating, ["Tutor (AI) active"]);
  assert.ok(
    !SUPPORTED_PROFILES.includes("tutor-ai"),
    "if the host starts supporting Tutor (AI), the fourth row above separates too and this table " +
      "must be re-measured rather than re-argued",
  );
});
