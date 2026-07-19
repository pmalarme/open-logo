/**
 * Shared statement-execution core for `index.ts`'s {@link execute} — and, separately, this
 * package's own tests exercising `forever` loop mechanics. **Not part of `@openlogo/runtime`'s
 * public API**: `package.json`'s `exports` map only ever resolves the bare `"@openlogo/runtime"`
 * specifier to `dist/index.js`, and `index.ts` never re-exports anything from this file, so no
 * external consumer can reach {@link executeWithForeverIterationLimitForTests} through the
 * package. Only a same-package relative import straight into `dist/execute-internal.js` (which
 * `repeat-forever-repcount.test.mjs` uses) can — this is deliberate: it keeps the test-only
 * `forever` iteration cap architecturally unreachable from `execute()` or any real caller, not
 * just unreachable by convention/naming.
 *
 * Issue #97 adds user-procedure call execution: {@link executeStatements} now returns an
 * {@link ExecSignal} — `"normal"`/`"halt"` (its original two outcomes, renamed) plus `"return"`/
 * `"stop"` — so a control form's body (`If`/`While`/`Repeat`/`Forever`/`ForIn`/`ForRange`)
 * transparently propagates a `return`/`stop` up to the nearest enclosing procedure, rather than
 * only stopping its own loop (`spec/execution-model.md:340-349`). {@link runProcedure} is the
 * shared call mechanics reachable from both a statement-position call (dispatched directly, right
 * here) and an expression-position call (`evaluate.ts`'s `evaluateCall`, via the `callProcedure`
 * callback threaded onto `Environment` — see `evaluate.ts`'s doc comment for why a direct import
 * back into this file would be a cycle).
 */

import type {
  Diagnostic,
  OLValue,
  PrintPayload,
  ProcedureEnterPayload,
  ProcedureExitPayload,
  ReturnPayload,
  SourceSpan,
} from "@openlogo/core";
import { typeNameOf } from "@openlogo/core";
import type {
  CallNode,
  ExpressionNode,
  ForInNode,
  ParenCallNode,
  ProcedureDefNode,
  ProgramNode,
  SpannedName,
  StatementNode,
} from "@openlogo/parser";
import { parse, walk } from "@openlogo/parser";
import {
  evaluate,
  executeAssign,
  isSupportedExpression,
  printedForm,
  requireNumber,
  requireWholeNumber,
  type Environment,
  type EvalResult,
  type Frame,
  type ProcedureRegistry,
} from "./evaluate.js";
import { runtimeDiag } from "./errors.js";
import type { ExecuteResult, InstructionPayload } from "./index.js";

/**
 * `ForInNode.binder` (`spec/grammar.md:136-137`): a bare name, or a destructuring pattern. The
 * pattern node itself (`DestructuringBinderNode`) is not part of `@openlogo/parser`'s public
 * export list, so it is named here via `Extract` off the already-exported {@link ForInNode}
 * rather than importing it directly.
 */
type ForInBinder = ForInNode["binder"];
type DestructuringBinder = Extract<
  ForInBinder,
  { kind: "DestructuringBinder" }
>;

/**
 * Is `statement` a call to `print` — the single-value `print value` form or the parenthesized
 * variadic `(print a b …)` form (`spec/commands.md:142-158`)? Accepts both the plain infix
 * `Call` form (`print 1`) and the explicit-parentheses `ParenCall` form (`(print 1 2)`) — both
 * share the same callee/args shape (see `evaluate.ts`'s `ArithmeticCallNode`). Matches
 * regardless of argument count: a zero-argument `print`/`(print)` is handled separately in
 * {@link executeStatements}, since `execute()` runs `parse()` only (not the semantic checker), so
 * the checker's static `ol-not-enough-inputs` rule never sees it here.
 */
function isPrintCall(
  statement: StatementNode,
): statement is CallNode | ParenCallNode {
  return (
    (statement.kind === "Call" || statement.kind === "ParenCall") &&
    statement.callee.name.toLowerCase() === "print"
  );
}

/**
 * Evaluate an `if`/`while` condition and require it to be a boolean — there is no truthiness
 * (`spec/execution-model.md:365-369`, `spec/error-model.md:121`). `operation` names the leading
 * form (`"if"`/`"while"`) for the `ol-not-boolean` diagnostic's `params.operation`, reusing the
 * `runtimeDiag.notBoolean` builder issue #95 added for `and`/`or`/`not` rather than duplicating it.
 * Returns the propagated evaluation failure, the `ol-not-boolean` diagnostic, or the boolean.
 */
function evaluateCondition(
  condition: ExpressionNode,
  env: Environment,
  operation: "if" | "while",
):
  | { readonly ok: true; readonly value: boolean }
  | { readonly ok: false; readonly diagnostic: Diagnostic } {
  const result = evaluate(condition, env);
  if (!result.ok) {
    return result;
  }
  if (typeof result.value !== "boolean") {
    return {
      ok: false,
      diagnostic: runtimeDiag.notBoolean(condition.source_span, {
        actual: typeNameOf(result.value),
        operation,
      }),
    };
  }
  return { ok: true, value: result.value };
}

/**
 * Push a fresh body-local frame binding `bindings` (name → value) onto `env`, nearest-first, for
 * a `for` loop's own binder(s) — `spec/execution-model.md:435-437` ("body-local bindings that
 * shadow outer names only for the body"). Returns a *new* {@link Environment}; `env` itself is
 * never mutated, so once the caller stops using the returned value the binding is gone — there is
 * no explicit "pop" step, unlike `repeatTurns` (a plain mutable array shared by every recursive
 * call). `repeatTurns` is threaded through unchanged (same array reference) so a `for` nested
 * inside a `repeat` still sees the right `repcount`, and a `repeat`/`for` nested inside a `for`
 * still sees it too.
 */
function pushLoopFrame(
  env: Environment,
  bindings: ReadonlyMap<string, OLValue>,
): Environment {
  const frame: Frame = new Map(bindings);
  return { ...env, frames: [frame, ...env.frames] };
}

/**
 * The first name in a destructuring pattern that repeats an earlier one in the same pattern
 * (case-insensitively), or `undefined` when every name is distinct. Mirrors the parser's
 * `checker-control-flow.ts` `patternDuplicateDiagnostics` exactly (same case-folding) so the
 * runtime's own `ol-duplicate-binder` guard agrees with the semantic checker's — this is a static
 * property of the pattern, checked once before iterating rather than per element.
 */
function findDuplicateBinderName(
  binder: DestructuringBinder,
): SpannedName | undefined {
  const seen = new Set<string>();
  for (const name of binder.names) {
    const key = name.name.toLowerCase();
    if (seen.has(key)) {
      return name;
    }
    seen.add(key);
  }
  return undefined;
}

/**
 * Bind one `for ... in` element against `binder`: a bare name binds the whole element, while a
 * destructuring pattern destructures it positionally (`spec/execution-model.md:435-439`). A
 * non-list element, or one whose length disagrees with the pattern's arity, raises `ol-range` — a
 * non-list element's length is treated as `0`, since it can never match a non-empty pattern.
 * `"kind" in binder` — not `binder.kind`, since a bare-name binder is a plain {@link SpannedName}
 * with no `kind` field at all (see `ast.ts`'s own `walk` for the same pattern) — distinguishes the
 * two without a false discriminated-union assumption.
 */
function bindForInElement(
  binder: ForInBinder,
  element: OLValue,
):
  | { readonly ok: true; readonly bindings: Map<string, OLValue> }
  | { readonly ok: false; readonly diagnostic: Diagnostic } {
  if (!("kind" in binder)) {
    return { ok: true, bindings: new Map([[binder.name, element]]) };
  }
  const values = Array.isArray(element) ? element : undefined;
  if (values === undefined || values.length !== binder.names.length) {
    return {
      ok: false,
      diagnostic: runtimeDiag.patternLengthMismatch(binder.source_span, {
        operation: "destructuring",
        value: values === undefined ? 0 : values.length,
        length: binder.names.length,
      }),
    };
  }
  const bindings = new Map<string, OLValue>();
  binder.names.forEach((name, index) => {
    bindings.set(name.name, values[index] as OLValue);
  });
  return { ok: true, bindings };
}

/**
 * The outcome of running a list of statements. `"normal"` is a clean run through every statement;
 * `"halt"` is the pre-existing "stopped on a diagnostic" outcome, just renamed to make room for
 * the two new control-transfer outcomes issue #97 adds: `"return"` (a `return`/`output`/`op`
 * reached, carrying its value and the exact keyword spelling used, for the
 * `ol-return-outside-proc` diagnostic if it escapes every enclosing procedure) and `"stop"` (a
 * `stop` reached). Every control-form body below (`If`/`While`/`Repeat`/`Forever`/`ForIn`/
 * `ForRange`) now propagates ANY non-`"normal"` signal straight up unchanged rather than only
 * checking for `"halt"` — this is what makes a `stop`/`return` nested inside a loop inside a
 * procedure exit the whole procedure, not just that loop (`spec/execution-model.md:340-349`).
 * {@link runProcedure} is the only place that ever *consumes* a `"return"`/`"stop"` signal; if one
 * reaches {@link runProgram}'s top level instead, no procedure was there to catch it, so it is
 * converted to `ol-return-outside-proc`/`ol-stop-outside-proc`.
 */
type ExecSignal =
  | { readonly kind: "normal" }
  | { readonly kind: "halt"; readonly diagnostic: Diagnostic }
  | {
      readonly kind: "return";
      readonly value: OLValue;
      readonly source_span: SourceSpan;
      readonly keyword: "return" | "output" | "op";
    }
  | { readonly kind: "stop"; readonly source_span: SourceSpan };

const NORMAL_SIGNAL: ExecSignal = { kind: "normal" };

function halt(diagnostic: Diagnostic): ExecSignal {
  return { kind: "halt", diagnostic };
}

/**
 * Every `ProcedureDef` in `program`, keyed by its lowercased name — a whole-program scan (not
 * just the top-level statement list) so a procedure may be called before its textual `define`
 * (`spec/execution-model.md:328-333`), mirroring the static checker's `collectProcedureArities`/
 * `collectVisibleNames` (`packages/parser/src/checker-arity.ts`) exactly, including "a later
 * `define` of the same name overwrites the earlier one here" — redefinition itself is
 * `ol-reserved-word`'s concern (issue #113), not this collection's.
 */
function collectProcedures(program: ProgramNode): ProcedureRegistry {
  const procedures = new Map<string, ProcedureDefNode>();
  walk(program, (node) => {
    if (node.kind === "ProcedureDef") {
      procedures.set(node.name.name.toLowerCase(), node);
    }
  });
  return procedures;
}

/**
 * Is `statement` a call — bare or parenthesized — to a name that {@link Environment.procedures}
 * knows, i.e. a user-procedure call in statement (command) position (`star 5 100`, as opposed to
 * expression/reporter position, e.g. `print area :r`, which `evaluate.ts`'s `evaluateCall`
 * dispatches instead via `env.callProcedure`)?
 */
function isProcedureCallStatement(
  statement: StatementNode,
  procedures: ProcedureRegistry,
): boolean {
  return (
    (statement.kind === "Call" || statement.kind === "ParenCall") &&
    procedures.has(statement.callee.name.toLowerCase())
  );
}

/**
 * The result of one procedure invocation: `ok:false` propagates a diagnostic (an arity mismatch,
 * a failed argument/default evaluation, or a diagnostic that halted the body); `ok:true` carries
 * `result` — the `return`ed value, or `null` for a command (the body finished, or `stop`ped,
 * without ever reaching `return`). A dedicated type, not {@link EvalResult}, since `result` can be
 * `null` (a command) where {@link OLValue} cannot.
 */
type ProcedureOutcome =
  | { readonly ok: true; readonly result: OLValue | null }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/**
 * Run one invocation of the user procedure `def` denotes, called via `node` (its callee span is
 * used for every diagnostic below, matching the static checker's `checker-arity.ts` convention of
 * pointing at the callee, not the whole call). Shared by both a statement-position call
 * (dispatched directly in {@link executeStatements}) and an expression-position call
 * (`evaluate.ts`'s `evaluateCall`, via `env.callProcedure` — see this file's header comment for
 * why that indirection exists).
 *
 * Arity is checked BEFORE evaluating any argument, exactly like the static checker's
 * `arityRule` (`packages/parser/src/checker-arity.ts`): `actual < required` is
 * `ol-not-enough-inputs`, `actual > max` is `ol-too-many-inputs` — both share that rule's
 * `{callable, expected, actual}` param shape so the two stages agree on diagnostic identity
 * (issue #111 / #97). The reader already caps a bare `Call` to a user procedure at its required
 * parameter count (it stops gathering arguments at the first optional/parenthesized-default
 * parameter), so `actual > max` is only actually reachable for the parenthesized form in
 * practice — but the check itself does not special-case `node.kind`, matching `arityRule` exactly.
 *
 * Each supplied argument is evaluated left to right in the CALLER's environment, before the
 * callee frame exists. The callee then runs in a FRESH frame stacked only on the shared root
 * frame (`env.frames[env.frames.length - 1]`, never the caller's own local frame(s)) — lexical
 * scoping: the callee cannot see the caller's parameters or locals unless passed as an argument
 * (`spec/execution-model.md:316-320`). Its own `repeatTurns` starts empty: `repcount` is tied to
 * the lexical nesting of `repeat` within the currently-running body, and a callee begins a new
 * body, so it starts with no active `repeat` turn of its own (an assumption called out in this
 * issue's PR, since the spec does not spell out `repcount` across a call boundary explicitly).
 * Every parameter without a supplied argument (an omitted optional) has its `defaultValue`
 * evaluated in the NEW callee frame, in parameter order, so an earlier parameter's bound value is
 * visible to a later parameter's default expression; a failure there (e.g. `ol-div-zero`)
 * propagates exactly like a failed supplied-argument evaluation.
 *
 * A `procedure-enter` event carries the callee's name and every bound argument value (required
 * ones as supplied, optional ones with their default already applied) in parameter order,
 * pushed before the body runs; a `procedure-exit` event carries the callee's name and its result
 * — the `return`ed value, or `null` for a command (fell through, or `stop`ped) — pushed after,
 * but only on a clean or `return`/`stop` outcome (a `"halt"` outcome skips it, matching the
 * existing convention that a diagnostic stops the trace with no further events at all). This
 * ordering reproduces the spec's worked recursive-call trace exactly
 * (`spec/execution-model.md:606-648`).
 */
function runProcedure(
  node: CallNode | ParenCallNode,
  env: Environment,
): ProcedureOutcome {
  const name = node.callee.name.toLowerCase();
  const def = env.procedures.get(name) as ProcedureDefNode;
  const required = def.params.filter(
    (param) => param.defaultValue === undefined,
  ).length;
  const max = def.params.length;
  const actual = node.args.length;
  if (actual < required) {
    return {
      ok: false,
      diagnostic: runtimeDiag.notEnoughInputs(
        node.callee.source_span,
        node.callee.name,
        required,
        actual,
      ),
    };
  }
  if (actual > max) {
    return {
      ok: false,
      diagnostic: runtimeDiag.tooManyInputs(
        node.callee.source_span,
        node.callee.name,
        max,
        actual,
      ),
    };
  }

  const argValues: OLValue[] = [];
  for (const arg of node.args) {
    const result = evaluate(arg, env);
    if (!result.ok) {
      return { ok: false, diagnostic: result.diagnostic };
    }
    argValues.push(result.value);
  }

  const calleeFrame: Frame = new Map();
  const calleeEnv: Environment = {
    ...env,
    frames: [calleeFrame, env.frames[env.frames.length - 1] as Frame],
    repeatTurns: [],
  };
  const boundArgs: OLValue[] = [];
  for (const [index, param] of def.params.entries()) {
    if (index < argValues.length) {
      const value = argValues[index] as OLValue;
      calleeFrame.set(param.name.name, value);
      boundArgs.push(value);
      continue;
    }
    // An omitted optional's default is evaluated in the callee frame, once its earlier
    // (already-bound) siblings are in place, so a later default may reference an earlier
    // parameter (e.g. a hypothetical `(:step 100) (:points (:step))`).
    const defaultResult = evaluate(
      param.defaultValue as ExpressionNode,
      calleeEnv,
    );
    if (!defaultResult.ok) {
      return { ok: false, diagnostic: defaultResult.diagnostic };
    }
    calleeFrame.set(param.name.name, defaultResult.value);
    boundArgs.push(defaultResult.value);
  }

  env.events.push({
    seq: env.events.length,
    kind: "procedure-enter",
    source_span: node.source_span,
    payload: {
      name: def.name.name,
      args: boundArgs,
    } satisfies ProcedureEnterPayload,
  });

  const signal = executeStatements(def.body.body, calleeEnv);
  if (signal.kind === "halt") {
    return { ok: false, diagnostic: signal.diagnostic };
  }
  const result = signal.kind === "return" ? signal.value : null;

  env.events.push({
    seq: env.events.length,
    kind: "procedure-exit",
    source_span: node.source_span,
    payload: { name: def.name.name, result } satisfies ProcedureExitPayload,
  });

  return { ok: true, result };
}

/**
 * Call a user procedure from an expression/reporter position (`print area :r`): like
 * {@link runProcedure}, but a command result (`null` — the procedure never reached `return`)
 * is `ol-no-output` here, since a value is required in this position
 * (`spec/execution-model.md:346-349`). Wired onto every execution `Environment`'s
 * `callProcedure` field so `evaluate.ts`'s `evaluateCall` can reach it without importing this
 * module (see this file's header comment).
 */
function callProcedureAsValue(
  node: CallNode | ParenCallNode,
  env: Environment,
): EvalResult {
  const outcome = runProcedure(node, env);
  if (!outcome.ok) {
    return outcome;
  }
  if (outcome.result === null) {
    return {
      ok: false,
      diagnostic: runtimeDiag.noOutput(
        node.callee.source_span,
        node.callee.name,
      ),
    };
  }
  return { ok: true, value: outcome.result };
}

/**
 * Execute `statements` in order, mutating `env.events` in place with one `instruction` event per
 * statement plus whatever effect events that statement's kind produces, and returns an
 * {@link ExecSignal} describing how the run ended: `"normal"` on a clean run through every
 * statement, `"halt"` with the diagnostic that stopped it, or — issue #97 — `"return"`/`"stop"`
 * when a `return`/`stop` was reached and needs to keep propagating up to its enclosing procedure
 * (or, if there is none, to {@link runProgram}'s top level). This is the shared statement-
 * execution core for both the top-level program body ({@link runProgram}), a procedure's own body
 * ({@link runProcedure}), and a control form's block body (the `If`/`While`/`Repeat`/`Forever`
 * handling below) — a block is just another list of statements run against the same threaded
 * {@link Environment} (`spec/execution-model.md:316-327`), so nested control forms, further-nested
 * blocks, and procedure bodies all recurse through this same function without their own copy of
 * the dispatch logic.
 *
 * An `Assign` statement (`:place = value`, `set place to value`) is executed via
 * {@link executeAssign}; it never emits its own event (there is no dedicated event kind for
 * assignment in the trace/event registry) but a failure — `ol-not-a-place` for a reporter/call
 * target, or a diagnostic propagated from evaluating the value/an intermediate postfix segment —
 * stops execution exactly like a print failure does. A `.field`-bearing target is Data-profile
 * and deferred: `executeAssign` leaves it silently un-executed rather than raising.
 *
 * A `print` statement (`print value` or the parenthesized variadic `(print a b …)`) additionally
 * evaluates every operand, left to right, and — once all of them evaluate cleanly — emits a
 * `print` event carrying every value, but only when {@link isSupportedExpression} says this
 * issue's evaluator gives *each* operand a value; otherwise the whole statement is left
 * un-evaluated for a future slice (e.g. `print :ages.tom` — dotted-field reads land with the
 * Data profile). A zero-argument `print`/`(print)` raises `ol-not-enough-inputs` (issue #98):
 * `execute()` runs `parse()` only, so the semantic checker's static arity rule — which cannot
 * itself catch an open-variadic parenthesized under-supply, `packages/parser/src/checker-arity.ts`
 * — never runs here, and this is the only guard against silently treating a callee-only `print`
 * as a no-op. If evaluating an operand raises a runtime diagnostic (`ol-div-zero`, `ol-neg-sqrt`,
 * `ol-type`, `ol-undefined-var`, `ol-range`), execution stops there: the events emitted so far are
 * kept and the diagnostic is returned, exactly as a parse-stage failure returns diagnostics
 * instead of a trace — later operands of that same `print` are never evaluated.
 *
 * A `Call`/`ParenCall` statement whose callee names a user procedure (issue #97,
 * {@link isProcedureCallStatement}) runs it via {@link runProcedure} for its side effects only —
 * a command result (`null`) is perfectly fine to discard in statement position, so `ol-no-output`
 * never fires here (only {@link callProcedureAsValue}'s expression-position path raises it). Any
 * OTHER call (a callee this issue's evaluator does not know — neither a Core primitive/operator
 * nor a user procedure) still emits its `instruction` event but is left un-evaluated, same as
 * before.
 *
 * A `Return`/`Stop`/`Throw` statement (issue #97) always returns its own {@link ExecSignal}
 * unconditionally, regardless of whether a procedure is actually running: `Return`'s value is
 * evaluated first — gated by {@link isSupportedExpression}, same "defer if unsupported"
 * convention as `print` — and pushes a `return` event before returning `{kind:"return", …}`;
 * `Stop` returns `{kind:"stop", …}` with no event of its own (the enclosing `procedure-exit`'s
 * `result:null` already conveys it); `Throw`'s value is likewise evaluated first (a word is used
 * as the message verbatim, any other value via its printed form, matching `print`'s own
 * rendering) and becomes `{kind:"halt", diagnostic: ol-user-error}`. Whichever signal comes out is
 * either consumed by the nearest enclosing {@link runProcedure} call, or — if it escapes every
 * enclosing procedure — converted by {@link runProgram} into `ol-return-outside-proc`/
 * `ol-stop-outside-proc`.
 *
 * An `If` statement (issue #100) evaluates `condition` — requiring a boolean, `ol-not-boolean`
 * otherwise (`spec/execution-model.md:365-369`) — and runs exactly one branch: `thenBody` when
 * `condition` is `true`, `elseBody` when it is `false` and present, or neither (no further events)
 * when it is `false` and there is no `else`. Both the bracketed and long-form `… end` bodies parse
 * to the identical `BlockNode` shape, so they execute identically — there is nothing here that
 * distinguishes them. Per the block-result rule (`spec/execution-model.md:214-227`), a bracketed
 * `if`/`while` body runs for effect only: a trailing bare-value expression's value is silently
 * discarded (no value-producing event, no diagnostic) — which already falls out of this function,
 * since a statement kind this issue does not evaluate (a bare arithmetic expression, a call to
 * anything other than `print`) still emits its `instruction` event but never reaches a branch that
 * evaluates or emits a value for it.
 *
 * A `While` statement (issue #100) re-evaluates `condition` before every pass — including the
 * first — running `body` each time it holds and stopping the moment it is `false`
 * (`spec/execution-model.md:365-369`); a condition that never becomes `false` runs forever, same
 * as any other unbounded loop in this issue's scope (the cancellable execution budget is a later,
 * separate slice).
 *
 * A `Repeat` statement (issue #104) evaluates `count`, then validates it TYPE then RANGE, in that
 * exact order (`spec/execution-model.md:367-369`): a non-whole-number count raises `ol-type`
 * ({@link requireWholeNumber}); otherwise a negative count raises `ol-range`
 * (`runtimeDiag.negativeCount`); `repeat 0` runs `body` zero times with no diagnostic. Each pass
 * pushes that pass's 1-based turn onto `env.repeatTurns` before running `body` and pops it after —
 * even on a diagnostic, the stack for `repcount` is only ever this scoped, so a nested `repeat`
 * inside `body` sees its own turn on top of the outer one, and `repcount` always reads the
 * innermost.
 *
 * A `Forever` statement (issue #104) repeats `body` without bound — cancellation and the
 * execution budget are a later, separate slice (#102) — up to `foreverIterationLimit` passes when
 * one is supplied. That limit is a **test-only** knob only reachable via
 * {@link executeWithForeverIterationLimitForTests}, never via `execute()`; no production caller
 * ever passes it, so every real `forever` genuinely never terminates, same as an always-`true`
 * `while`.
 *
 * A `ForIn` statement (issue #103) evaluates `iterable` — it must be a list, `ol-type` otherwise
 * (`spec/execution-model.md:375-376`; Core `for ... in` is list-only, dict iteration is a later
 * profile) — then runs `body` once per element, in order, binding `binder` fresh each pass via
 * {@link pushLoopFrame}. A bare-name binder binds the whole element; a destructuring binder
 * ({@link bindForInElement}) binds each of its names positionally from the element, which must
 * itself be a list of exactly that many items (`ol-range` otherwise —
 * `spec/execution-model.md:435-439`). A duplicate name within one destructuring pattern
 * (`for [:x :x] in ...`) raises `ol-duplicate-binder`, checked once up front via
 * {@link findDuplicateBinderName} since it is a static property of the pattern, not the data.
 *
 * A `ForRange` statement (issue #103) evaluates `from`/`to`/`by` (default step `1`) — each must be
 * a number, `ol-type` otherwise ({@link requireNumber}, which unlike `repeat`'s count is not
 * restricted to whole numbers) — then iterates `variable` from `from` to `to` inclusive, adding
 * `step` each pass: with a positive step the body runs while `variable` is at most `to`, with a
 * negative step while it is at least `to` (`spec/execution-model.md:370-375`). A step pointing
 * away from `to` (e.g. `from 1 to 5 by -1`) runs `body` zero times, no diagnostic; a step of `0`
 * raises `ol-range` (`runtimeDiag.forStepZero`) since it would otherwise never reach `to`.
 * `variable` is bound fresh each pass via {@link pushLoopFrame}, same as `ForIn`'s binder.
 *
 * Both loops' binders are fresh **body-local** bindings (`spec/execution-model.md:435-437`): each
 * pass runs `body` against a *new* {@link Environment} with one extra frame in front of `env`'s
 * own frames, so the binding is visible inside `body` but never leaks past the loop — `env` itself
 * is never mutated. `env.repeatTurns` (same array reference) and `env.foreverIterationLimit` are
 * threaded through unchanged, so a `repeat`'s `repcount` and a `forever`'s test-only iteration cap
 * both still work correctly across a nested `for`. Every control-form body below propagates ANY
 * non-`"normal"` signal from `executeStatements` straight back up — including `"return"`/`"stop"`
 * — so a `stop` or `return` nested inside a loop nested inside a procedure exits the *procedure*,
 * not just that loop (`spec/execution-model.md:340-349`).
 *
 * Statement kinds this issue does not give meaning to (e.g. a bare arithmetic expression, or any
 * call this evaluator does not know) still emit their `instruction` event but do not evaluate —
 * that is each statement kind's own future slice to add.
 */
function executeStatements(
  statements: readonly StatementNode[],
  env: Environment,
): ExecSignal {
  for (const statement of statements) {
    env.events.push({
      seq: env.events.length,
      kind: "instruction",
      source_span: statement.source_span,
      payload: { statement_kind: statement.kind } satisfies InstructionPayload,
    });

    if (statement.kind === "Assign") {
      const result = executeAssign(statement, env);
      if (!result.ok) {
        return halt(result.diagnostic);
      }
      continue;
    }

    if (isProcedureCallStatement(statement, env.procedures)) {
      const outcome = runProcedure(statement as CallNode | ParenCallNode, env);
      if (!outcome.ok) {
        return halt(outcome.diagnostic);
      }
      continue;
    }

    if (isPrintCall(statement)) {
      if (statement.args.length === 0) {
        return halt(
          runtimeDiag.notEnoughInputs(
            statement.callee.source_span,
            statement.callee.name,
            1,
            0,
          ),
        );
      }
      // Only evaluate a `print` whose every operand is an expression kind this issue's
      // evaluator gives meaning to (Core literals, arithmetic, variable/place reads, user
      // procedure calls). `(print 1 :ages.tom)` and similar still emit their `instruction`
      // event but are left un-evaluated for the slice that implements the unsupported
      // operand's expression kind.
      if (
        statement.args.every((arg) =>
          isSupportedExpression(arg, env.procedures),
        )
      ) {
        const values: OLValue[] = [];
        let failure: Diagnostic | undefined;
        for (const arg of statement.args) {
          const result = evaluate(arg, env);
          if (!result.ok) {
            failure = result.diagnostic;
            break;
          }
          values.push(result.value);
        }
        if (failure) {
          return halt(failure);
        }
        env.events.push({
          seq: env.events.length,
          kind: "print",
          source_span: statement.source_span,
          payload: { values } satisfies PrintPayload,
        });
      }
      continue;
    }

    if (statement.kind === "Return") {
      if (!isSupportedExpression(statement.value, env.procedures)) {
        continue;
      }
      const result = evaluate(statement.value, env);
      if (!result.ok) {
        return halt(result.diagnostic);
      }
      env.events.push({
        seq: env.events.length,
        kind: "return",
        source_span: statement.source_span,
        payload: { value: result.value } satisfies ReturnPayload,
      });
      return {
        kind: "return",
        value: result.value,
        source_span: statement.source_span,
        keyword: statement.keyword,
      };
    }

    if (statement.kind === "Stop") {
      return { kind: "stop", source_span: statement.source_span };
    }

    if (statement.kind === "Throw") {
      if (!isSupportedExpression(statement.value, env.procedures)) {
        continue;
      }
      const result = evaluate(statement.value, env);
      if (!result.ok) {
        return halt(result.diagnostic);
      }
      const message =
        typeof result.value === "string"
          ? result.value
          : printedForm(result.value);
      return halt(runtimeDiag.userError(statement.source_span, message));
    }

    if (statement.kind === "If") {
      if (!isSupportedExpression(statement.condition, env.procedures)) {
        continue;
      }
      const condition = evaluateCondition(statement.condition, env, "if");
      if (!condition.ok) {
        return halt(condition.diagnostic);
      }
      const branch = condition.value
        ? statement.thenBody.body
        : (statement.elseBody?.body ?? []);
      const signal = executeStatements(branch, env);
      if (signal.kind !== "normal") {
        return signal;
      }
      continue;
    }

    if (statement.kind === "While") {
      if (!isSupportedExpression(statement.condition, env.procedures)) {
        continue;
      }
      for (;;) {
        const condition = evaluateCondition(statement.condition, env, "while");
        if (!condition.ok) {
          return halt(condition.diagnostic);
        }
        if (!condition.value) {
          break;
        }
        const signal = executeStatements(statement.body.body, env);
        if (signal.kind !== "normal") {
          return signal;
        }
      }
      continue;
    }

    if (statement.kind === "Repeat") {
      if (!isSupportedExpression(statement.count, env.procedures)) {
        continue;
      }
      const countResult = evaluate(statement.count, env);
      if (!countResult.ok) {
        return halt(countResult.diagnostic);
      }
      const whole = requireWholeNumber(
        countResult.value,
        statement.count.source_span,
        "repeat",
      );
      if (!whole.ok) {
        return halt(whole.diagnostic);
      }
      if (whole.value < 0) {
        return halt(
          runtimeDiag.negativeCount(statement.count.source_span, {
            operation: "repeat",
            value: whole.value,
          }),
        );
      }
      for (let turn = 1; turn <= whole.value; turn++) {
        env.repeatTurns.push(turn);
        const signal = executeStatements(statement.body.body, env);
        env.repeatTurns.pop();
        if (signal.kind !== "normal") {
          return signal;
        }
      }
      continue;
    }

    if (statement.kind === "Forever") {
      let turn = 1;
      while (
        env.foreverIterationLimit === undefined ||
        turn <= env.foreverIterationLimit
      ) {
        const signal = executeStatements(statement.body.body, env);
        if (signal.kind !== "normal") {
          return signal;
        }
        turn++;
      }
      continue;
    }

    if (statement.kind === "ForIn") {
      if ("kind" in statement.binder) {
        const duplicate = findDuplicateBinderName(statement.binder);
        if (duplicate !== undefined) {
          return halt(
            runtimeDiag.duplicateBinder(duplicate.source_span, duplicate.name),
          );
        }
      }
      if (!isSupportedExpression(statement.iterable, env.procedures)) {
        continue;
      }
      const iterableResult = evaluate(statement.iterable, env);
      if (!iterableResult.ok) {
        return halt(iterableResult.diagnostic);
      }
      if (!Array.isArray(iterableResult.value)) {
        return halt(
          runtimeDiag.forInNotList(statement.iterable.source_span, {
            actual: typeNameOf(iterableResult.value),
            value: iterableResult.value,
          }),
        );
      }
      for (const element of iterableResult.value) {
        const bound = bindForInElement(statement.binder, element);
        if (!bound.ok) {
          return halt(bound.diagnostic);
        }
        const signal = executeStatements(
          statement.body.body,
          pushLoopFrame(env, bound.bindings),
        );
        if (signal.kind !== "normal") {
          return signal;
        }
      }
      continue;
    }

    if (statement.kind === "ForRange") {
      if (
        !isSupportedExpression(statement.from, env.procedures) ||
        !isSupportedExpression(statement.to, env.procedures) ||
        (statement.by !== undefined &&
          !isSupportedExpression(statement.by, env.procedures))
      ) {
        continue;
      }
      const fromResult = evaluate(statement.from, env);
      if (!fromResult.ok) {
        return halt(fromResult.diagnostic);
      }
      const from = requireNumber(
        fromResult.value,
        statement.from.source_span,
        "for",
      );
      if (!from.ok) {
        return halt(from.diagnostic);
      }
      const toResult = evaluate(statement.to, env);
      if (!toResult.ok) {
        return halt(toResult.diagnostic);
      }
      const to = requireNumber(toResult.value, statement.to.source_span, "for");
      if (!to.ok) {
        return halt(to.diagnostic);
      }
      let step = 1;
      if (statement.by !== undefined) {
        const byResult = evaluate(statement.by, env);
        if (!byResult.ok) {
          return halt(byResult.diagnostic);
        }
        const by = requireNumber(
          byResult.value,
          statement.by.source_span,
          "for",
        );
        if (!by.ok) {
          return halt(by.diagnostic);
        }
        if (by.value === 0) {
          return halt(runtimeDiag.forStepZero(statement.by.source_span));
        }
        step = by.value;
      }
      // Recompute each pass's value from `from` and the pass count (rather than repeatedly
      // adding `step` to a running total) so IEEE-754 rounding cannot drift the running value
      // away from its true multiple of `step` over many passes. A step whose exact decimal
      // value cannot be represented exactly in binary floating point (e.g. `0.1`) would
      // otherwise sometimes land a hair past `to` — silently dropping the inclusive endpoint
      // (`from 0 to 0.3 by 0.1` would stop at `0.2`, since the fourth running total is
      // `0.30000000000000004`, not `0.3`). The boundary comparison tolerates only a few ULPs of
      // `current`/`to` themselves (`Number.EPSILON` scaled to their own magnitude) — not a
      // fraction of `step` — so it absorbs that per-pass representation error without ALSO
      // admitting a pass that is genuinely beyond `to` (e.g. `from 0 to 0.9999999995 by 1` must
      // still run only once, at `0`).
      for (let turn = 0; ; turn += 1) {
        const current = from.value + turn * step;
        const epsilon =
          Number.EPSILON * Math.max(1, Math.abs(current), Math.abs(to.value));
        const withinBound =
          step > 0
            ? current <= to.value + epsilon
            : current >= to.value - epsilon;
        if (!withinBound) {
          break;
        }
        const signal = executeStatements(
          statement.body.body,
          pushLoopFrame(env, new Map([[statement.variable.name, current]])),
        );
        if (signal.kind !== "normal") {
          return signal;
        }
      }
    }
  }

  return NORMAL_SIGNAL;
}

/**
 * Build a fresh execution environment for running `program` from the top: the root/global frame,
 * no active `repeat` turn, `program`'s whole-program {@link ProcedureRegistry}
 * ({@link collectProcedures}), an empty event sink, `foreverIterationLimit` threaded through
 * unchanged, and `callProcedure` wired to {@link callProcedureAsValue} — unlike
 * `evaluate.ts`'s bare `createEnvironment()` (whose `callProcedure` stub is intentionally
 * unreachable, for expression-only tests with no procedures in scope), this is the environment
 * every real statement/expression in `program` actually runs against.
 */
function createExecutionEnvironment(
  program: ProgramNode,
  foreverIterationLimit: number | undefined,
): Environment {
  return {
    frames: [new Map()],
    repeatTurns: [],
    procedures: collectProcedures(program),
    events: [],
    foreverIterationLimit,
    callProcedure: callProcedureAsValue,
  };
}

/**
 * Parse `source` and run it, sharing {@link execute}'s and
 * {@link executeWithForeverIterationLimitForTests}'s logic. `foreverIterationLimit` is
 * `undefined` for every real `execute()` call — see `index.ts`'s `execute()` doc comment — so a
 * `forever` loop is genuinely unbounded there; only the test-only entry point below ever supplies
 * it.
 *
 * A `"return"`/`"stop"` signal that escapes {@link executeStatements} unconsumed means it was
 * never inside any procedure ({@link runProcedure} always consumes its own body's signal before
 * it reaches here) — this is `ol-return-outside-proc`/`ol-stop-outside-proc` (issue #97), the
 * runtime's own copy of the semantic checker's rule of the same name
 * (`packages/parser/src/checker-control-flow.ts`, issue #114), at `stage: "runtime"` since
 * `execute()` runs `parse()` only, never `check()`.
 */
export function runProgram(
  source: string,
  document: string,
  foreverIterationLimit: number | undefined,
): ExecuteResult {
  const { ast: program, diagnostics } = parse(source, document);
  if (diagnostics.length > 0) {
    return { events: [], diagnostics };
  }

  const env = createExecutionEnvironment(program, foreverIterationLimit);
  const signal = executeStatements(program.body, env);
  const diagnostic =
    signal.kind === "halt"
      ? signal.diagnostic
      : signal.kind === "return"
        ? runtimeDiag.returnOutsideProc(signal.source_span, signal.keyword)
        : signal.kind === "stop"
          ? runtimeDiag.stopOutsideProc(signal.source_span)
          : undefined;
  return { events: env.events, diagnostics: diagnostic ? [diagnostic] : [] };
}

/**
 * **Test-only.** Identical to `execute()` except a `forever` loop in `source` stops on its own
 * (with no diagnostic) after `foreverIterationLimit` passes, so a unit test can exercise
 * `forever`'s loop mechanics without hanging the test process. Deliberately lives in this
 * module — never re-exported by `index.ts` — rather than as an optional parameter on `execute()`,
 * so the bound can never leak into a real caller's `execute()` invocation and is not reachable via
 * the `"@openlogo/runtime"` package specifier at all (see this file's header comment);
 * `forever` has no cancellation or execution-budget semantics in this issue's scope (that lands
 * with #102). Only this package's own tests, importing this file directly by relative path, ever
 * call it.
 */
export function executeWithForeverIterationLimitForTests(
  source: string,
  document: string,
  foreverIterationLimit: number,
): ExecuteResult {
  return runProgram(source, document, foreverIterationLimit);
}
