/**
 * `ol-bad-token` for a **profile word read as a callee** — issue #864, the profile-conditional half
 * of the value-position rule `spec/grammar.md:390` states:
 *
 * > A keyword in a position none of these cover has no derivation at all and is a parse error,
 * > never a silently accepted name: `repeat key [ ]` does not read as a call to a procedure named
 * > `key` …
 *
 * Issue #853 closed that hole for the **globally** reserved words by deriving the reader's
 * non-expression-head set from `OL_KEYWORDS`, so `repeat key [ ]` now reports `ol-bad-token` in the
 * reader. The seven profile words `OL_PROFILE_KEYWORDS` contributes — the Sprites heads `ask`/`each`
 * and its mode switch `tell` (`spec/turtles-and-sprites.md`), and the Interaction & Events heads
 * `when`/`every`/`on_key`/`on_click` (`spec/interaction-events.md`) — were left out of that sweep
 * and stayed **completely clean** in value position whenever their profile was active. Measured at
 * the saga tip `a7db8f2` with a sanity-asserted harness (`define count` must raise before any row is
 * recorded), all seven read clean as `print <word>`, as `:x = <word>`, and in the issue's own
 * `repeat <word> [ ]` — a silent no-op (saga #811): the `repeat` ran with no count and nothing said
 * so.
 *
 * **Why this cannot be fixed in the reader, and so lives here instead.** `parser.ts`'s
 * `PROFILE_STATEMENT_FORMS` states the design: *"The reader is deliberately profile-blind — it never
 * inspects the active profile set"*, and it must stay that way, because a Core-only program may
 * legally `define ask … end` and then call `ask` (pinned by the conformance fixture
 * `interaction-events/block-heads-free-core-only`). A profile-blind reader therefore cannot tell
 * `ask`-the-block-head from `ask`-the-learner's-procedure. The **checker** can, because it is handed
 * the active profile set (`spec/tooling.md:175-176` — a semantic rule "MUST use the active
 * conformance profile set when deciding which primitives and profile block-heads are available").
 * So the rule is profile-gated here, in exactly the shape `checker-names.ts` already registers those
 * same words as visible statement-form heads.
 *
 * **Scope: position, not reservation.** This rule decides *what happens when an active profile's
 * word appears where the grammar gives it no callable form*. It deliberately does **not** touch
 * whether those words are built-in names *unconditionally* — `spec/grammar.md:408` ("Profile words
 * are built-in names unconditionally") is issue #841's subject, and the profile gating of the four
 * **declaration** slots stays exactly where `checker-reserved-word.ts` has it. A Core-only program
 * keeps every one of these seven as an ordinary name in every position, which is why the gate below
 * is `isProfileKeyword(name, profiles)` and not a profile-blind lookup.
 *
 * **Why the callee, rather than a value-slot walk.** `spec/grammar.md:390` draws the line at what a
 * word is *matched as*: a keyword "is matched as `callable-name` only where the
 * [C3 primitive matrix](commands.md) also gives that word a callable form". None of the seven has a
 * callable form — each is a statement-form head — so a `Call`/`ParenCall` whose callee is one of
 * them is, by construction, the mis-derivation the spec forbids, wherever that node sits. Keying on
 * the callee therefore needs no slot classification and covers the issue's own positions plus one
 * they do not list: a statement-position `( when 1 )`, which reads as a `parenthesized-call` with
 * `when` in `callable-name` position and was equally clean before. A legitimate profile statement is
 * untouched, because the reader lowers it to a {@link ProfileStatementNode} whose head is
 * `keyword`, not `callee` — `when "start" [ … ]`, `tell 1`, and `each … end each` never reach this
 * rule.
 *
 * **Why `ol-bad-token` at `stage: "semantic"`.** The code is the one
 * `spec/error-model.md:110` assigns to "a token that is itself a valid OpenLogo token but is not
 * permitted at the current grammar position and no more-specific parse diagnostic applies", which is
 * precisely this defect and precisely what the six Core words already report — so the two halves of
 * the rule are finally the same diagnostic rather than one raising and the other saying nothing. The
 * stage is `semantic` because `spec/error-model.md:77` defines it that way: "The `code` remains the
 * same; the `stage` records **when it was found**." Its neighbouring sentence — "If an
 * implementation can detect a condition earlier without changing behavior, it SHOULD report the
 * earlier stage" — does not apply, since detecting this in the reader *would* change behavior, for
 * exactly the Core-only programs the paragraph above protects.
 *
 * `ol-unknown-command` would have been wrong twice over: the name **is** known when its profile is
 * active (that is the whole premise), and `spec/tooling.md:181` scopes that code to a name that is
 * not known at all. Core-only, where the word genuinely is unknown, `ol-unknown-command` is what
 * still fires — from `checker-unknown-command.ts`, unchanged.
 */

import type { Diagnostic } from "@openlogo/core";
import type { AnyNode, CallNode, ParenCallNode, ProgramNode } from "./ast.js";
import { walk } from "./ast.js";
import type { CheckProfile } from "./check.js";
import { isProfileKeyword } from "./keywords.js";

function isCallLike(node: AnyNode): node is CallNode | ParenCallNode {
  return node.kind === "Call" || node.kind === "ParenCall";
}

/**
 * The one learner-facing sentence, in the lowercase Logo voice `spec/error-model.md:18` requires.
 * Its first half is byte-identical to the reader's own `ol-bad-token` prose (`errors.ts`'s
 * `badToken`), so the profile half of the rule reads exactly like the Core half a learner may
 * already have met; the second half is the "closest legal form" `spec/error-model.md:110` asks for —
 * every one of these words heads a statement of its own.
 *
 * `word` is the learner's **surface** spelling, so a mixed-case `When` is quoted back as written.
 */
function statementHeadInValuePositionMessage(word: string): string {
  return `i don't know how to read ${word} here. ${word} starts its own instruction, so it cannot make a value.`;
}

function badTokenDiagnostic(node: CallNode | ParenCallNode): Diagnostic {
  return {
    code: "ol-bad-token",
    source_span: node.callee.source_span,
    params: { text: node.callee.name },
    message: statementHeadInValuePositionMessage(node.callee.name),
    stage: "semantic",
    severity: "error",
  };
}

/**
 * Report every place an **active** profile's statement-form head was read as a callee, in source
 * order (which the pre-order {@link walk} gives directly).
 *
 * The span covers just the head word, not the enclosing call: `spec/error-model.md:41-42` wants "the
 * most local repair site", and the word itself is what the learner has to replace.
 *
 * The gate is the shared {@link isProfileKeyword} registry rather than a table of its own, so a
 * profile slice that adds a block-head to `OL_PROFILE_KEYWORDS` gets this rule for free — the same
 * derive-from-the-registry property issue #837 proved for the Core half when adding `mod`.
 */
export function profileWordPositionRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    if (isCallLike(node) && isProfileKeyword(node.callee.name, profiles)) {
      diagnostics.push(badTokenDiagnostic(node));
    }
  });

  return diagnostics;
}
