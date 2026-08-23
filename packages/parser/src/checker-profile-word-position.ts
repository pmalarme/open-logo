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
 * **This rule closes six of those seven.** The seventh, `tell`, is a *command* rather than a special
 * form, so it genuinely has a callable form and must not be rejected here — the C3 **Kind** column
 * is the whole distinction, and {@link SPECIAL_FORM_PROFILE_WORDS} is where it is recorded and why.
 * A review of the first revision of this slice caught that: rejecting `tell` broke the legitimate
 * `( tell :t )`, which had checked clean.
 *
 * **Why this cannot be fixed in the reader, and so lives here instead.** `parser.ts`'s
 * `PROFILE_STATEMENT_FORMS` states the design: *"The reader is deliberately profile-blind — it never
 * inspects the active profile set"*, and it must stay that way. A Core-only program that writes
 * `define ask … end` and then calls `ask` is **not** legal — since issue #841 the declaration is
 * `ol-reserved-word` in every profile set — but the reader must still shape it as the learner wrote
 * it, so that the diagnostic lands on the declaration rather than on a mis-shaped
 * `ProfileStatement`. That shaping is pinned by `parse.profile-statement.test.mjs` (a declared head
 * followed by its call parses as `ProcedureDef` + `Call`); the conformance fixture
 * `interaction-events/block-heads-free-core-only` pins the declaration diagnostic itself. A
 * profile-blind reader therefore cannot tell `ask`-the-block-head from
 * `ask`-the-learner's-procedure. The **checker** can, because it is handed
 * the active profile set (`spec/tooling.md:175-176` — a semantic rule "MUST use the active
 * conformance profile set when deciding which primitives and profile block-heads are available").
 * So the rule is profile-gated here, in exactly the shape `checker-names.ts` already registers those
 * same words as visible statement-form heads.
 *
 * **Scope: position, not reservation.** This rule decides *what happens when an active profile's
 * word appears where the grammar gives it no callable form*. It deliberately does **not** decide
 * whether those words are built-in names — `spec/grammar.md:408` ("Profile words are built-in names
 * unconditionally") is `checker-reserved-word.ts`'s subject, and since issue #841 that rule answers
 * it with no profile set at all. The two rules therefore disagree about profiles on purpose: a
 * Core-only program may not **declare** `when`, yet `when` in a value position is an ordinary
 * unknown name rather than an `ol-bad-token`, because nothing has given it a structural role. That
 * is why the gate below is `isProfileKeyword(name, profiles)` and not a profile-blind lookup.
 *
 * **Why the callee, rather than a value-slot walk.** `spec/grammar.md:390` draws the line at what a
 * word is *matched as*: a keyword "is matched as `callable-name` only where the
 * [C3 primitive matrix](commands.md) also gives that word a callable form". That sentence is also
 * what scopes this rule to **six of the seven** profile words — see
 * {@link SPECIAL_FORM_PROFILE_WORDS}. For those six, a `Call`/`ParenCall` whose callee is one of
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
 *
 * **On the `parse`/`semantic` split for one code.** `spec/error-model.md:95` heads its registry
 * column *"**Usual** stage"*, not "Stage", and `:77` makes the stage a property of detection, so one
 * code reaching two stages is the model working as specified rather than an anomaly. Twelve codes in
 * the corpus already do it on the `semantic`/`runtime` axis, for exactly this reason and with the
 * same reasoning recorded at the raise site — see `@openlogo/runtime`'s `errors.ts` ("Registry stage
 * is `semantic`, but raised here at `stage: \"runtime\"`") and `evaluate.ts`. This rule is the first
 * on the **`parse`/`semantic`** axis, which is worth naming: `repeat key [ ]` reports `ol-bad-token`
 * at `parse` from the reader while `repeat when [ ]` reports it at `semantic` from here. **Neither
 * diagnostic is *rendered* differently**: `packages/studio/src/diagnostics.ts` renders every stage
 * identically by explicit design, and the only `stage` *branch* in the repository is
 * `scripts/markdown-examples-gate.mjs`, which keys on `"runtime"`. Structured consumers do of course
 * carry the field through and compare it — the conformance harness diffs it exactly
 * (`scripts/harness/index.mjs`'s `projectDiagnostic`) and `packages/studio/src/a11y.ts` folds it into
 * a diagnostics-list identity key — so a fixture pins whichever stage is chosen; that is the field
 * doing its job, not two defects being treated differently.
 *
 * What genuinely differs is *reaching* a consumer at all. A parse-only caller never runs `check()`,
 * and the studio's `semanticCheck` still defaults **off** pending epic #108
 * (`packages/studio/src/diagnostics.ts`'s `runChecks`), so a learner in today's studio sees the
 * reader's `repeat key [ ]` and nothing for `repeat when [ ]` until semantic checking is switched
 * on. That is a property of which layers a caller chooses to run, not of the stage field.
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
 * The profile words the C3 matrix classifies **Kind S — special form**, and therefore the only ones
 * this rule may reject. `spec/grammar.md:390` matches a keyword as `callable-name` "only where the
 * [C3 primitive matrix](commands.md) also gives that word a callable form", so the C3 **Kind**
 * column is the whole test, and it does not answer the same for all seven profile words:
 *
 * | Word | C3 Kind | Callable form? | Rejected here? |
 * |---|---|---|---|
 * | `ask <turtle\|turtle-list> <block>` | **S** | no | **yes** |
 * | `each <block>` | **S** | no | **yes** |
 * | `when <event-word> <block>` | **S** | no | **yes** |
 * | `every <n> <block>` | **S** | no | **yes** |
 * | `on_key <key-word> <block>` | **S** | no | **yes** |
 * | `on_click <block>` | **S** | no | **yes** |
 * | `tell <turtle\|turtle-list>` | **C** | **yes** | **no** |
 *
 * Sources: `spec/turtles-and-sprites.md`'s canonical-forms table ("The C3 Sprites rows are
 * authoritative", giving `tell` **C**, `ask` and `each` **S") and `spec/interaction-events.md`'s
 * (all four block-heads **S**).
 *
 * **`tell` is deliberately exempt, and this is the one distinction the rule turns on.** It is a
 * *command*, not a special form — `spec/grammar.md:408` itself calls it "the Sprites command `tell`
 * — a mode switch that takes no block". A command has a callable form, so `tell` genuinely *is* a
 * `callable-name` and `( tell :t )` is a legitimate `parenthesized-call`, exactly as `( forward 5 )`
 * is. Rejecting it here would turn a valid program into an error: measured, `( tell :t )` checked
 * clean before this rule existed.
 *
 * **What `tell` is still missing, precisely, and why none of it belongs here.** Two distinct gaps,
 * neither a derivation error:
 *
 * - `print tell` and `repeat tell [ ]` are **zero-input** calls of a one-input command, so the
 *   honest finding is a *missing-input* one — `ol-not-enough-inputs` from `checker-arity.ts`.
 *   `tell` escapes it only because `spritesPrimitiveArity("tell")` is `undefined`, exactly as
 *   recorded above. That table and that rule belong to another slice.
 * - `print ( tell :t )` supplies the input and still uses a **command as a value**. That is a
 *   *no-value* question, not an arity one, and OpenLogo answers it for no Kind-C command today —
 *   `print ( forward 10 )`, `print ( right 90 )`, and `print ( setxy 1 2 )` are equally
 *   undiagnosed. The parenthesized spelling is the point: it supplies every required input, so it
 *   isolates *command as a value* from the missing-input case above, which a bare `print forward`
 *   would not. A language-wide, pre-existing hole, not something about `tell`.
 *
 * Both are out of this slice's scope and left exactly as they were.
 *
 * Kept as an explicit set rather than derived, because the C3 **Kind** column has no representation
 * in `signatures.ts` today (`SPRITES_STATEMENT_FORM_NAMES` lists all three Sprites heads together,
 * and `spritesPrimitiveArity("tell")` is `undefined`). `checker-profile-word-position.test.mjs`
 * pins this set against `OL_PROFILE_KEYWORDS` so a future profile word cannot be added without
 * being deliberately classified — it fails loudly rather than defaulting either way.
 */
const SPECIAL_FORM_PROFILE_WORDS: ReadonlySet<string> = new Set([
  // Sprites (`spec/turtles-and-sprites.md`) — `tell` is Kind C and is absent on purpose.
  "ask",
  "each",
  // Interaction & Events (`spec/interaction-events.md`).
  "when",
  "every",
  "on_key",
  "on_click",
]);

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
 * Report every place an **active** profile's special-form head was read as a callee, in source order
 * (which the pre-order {@link walk} gives directly).
 *
 * The span covers just the head word, not the enclosing call: `spec/error-model.md:41-42` wants "the
 * most local repair site", and the word itself is what the learner has to replace.
 *
 * Two gates, in order, and both are load-bearing: {@link isProfileKeyword} keys the rule to the
 * shared registry **and** to the active profile set, so a Core-only program keeps every one of these
 * words as an ordinary name. Then {@link SPECIAL_FORM_PROFILE_WORDS} keeps the rejection to the
 * words that genuinely have no callable form, which is what leaves the Sprites *command* `tell`
 * alone.
 *
 * **A new registry word is therefore not covered "for free" — it is covered *loudly*.** Adding one
 * to `OL_PROFILE_KEYWORDS` passes the first gate but not the second, so the rule stays silent about
 * it *and* `checker-profile-word-position.test.mjs`'s classification guard fails until someone
 * decides its C3 Kind. That is deliberate: silently defaulting to "reject" is what broke `tell`, and
 * silently defaulting to "allow" would reopen issue #864 for the new word. Failing is the only
 * option that cannot be wrong by accident.
 */
export function profileWordPositionRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    if (!isCallLike(node)) {
      return;
    }
    const name = node.callee.name.toLowerCase();
    if (
      isProfileKeyword(name, profiles) &&
      SPECIAL_FORM_PROFILE_WORDS.has(name)
    ) {
      diagnostics.push(badTokenDiagnostic(node));
    }
  });

  return diagnostics;
}
