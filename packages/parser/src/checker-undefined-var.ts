/**
 * The `ol-undefined-var` semantic rule (issue #113): a static read of an unbound `:name` — a
 * bare {@link VarRefNode}, a `thing "name"` call whose literal argument names a variable, or the
 * base of a postfixed {@link PlaceNode} (`:people.tom.age`, `:nums[1]`) — with no visible
 * declaration in the program's static scope chain (`spec/tooling.md:183-184`).
 *
 * Scope model: OpenLogo uses genuine lexical frame scoping, not a flat whole-program namespace
 * (`spec/execution-model.md:340-342`). A procedure's parameters and `local` names live only in
 * that procedure's own frame, invisible to its callers and to every other procedure; a `for`/
 * comprehension binder lives only within its own loop/comprehension body, shadowing an outer
 * binding of the same name and never leaking past the end of that body; the top-level program
 * runs in a root frame, and an assignment or a top-level `local` that has no other visible
 * binding creates or updates a *global* — a binding in that root frame
 * (`spec/execution-model.md:344-348`). Treating that root-frame binding as visible throughout the
 * program regardless of textual order is this checker's own resolution model, not a spec rule:
 * the spec grants forward references only to `define`/`struct` (`spec/execution-model.md:83`),
 * never to variables. This rule resolves
 * every read against that chain: innermost binder scope → the enclosing procedure's own frame
 * (if any) → the global/root frame.
 *
 * Two passes over the program:
 *
 * 1. {@link collectGlobalNames} finds every name that becomes a *global* binding: every
 *    top-level `local` (one not nested inside any `define`, regardless of surrounding control
 *    flow), plus every zero-segment assignment target (`:name = value`) whose name is not already
 *    visible via an enclosing procedure frame or binder scope at that point — an assignment to an
 *    *already-visible* name is just an update, not a new global
 *    (`spec/execution-model.md:344-348`). This pass must run to completion before pass 2, since a
 *    read may forward-reference a global declared later in the file — globals, unlike procedure
 *    frames and binder scopes, are order-insensitive.
 * 2. {@link checkReads} walks the whole program again, this time emitting `ol-undefined-var` for
 *    every read (bare `:name`, `thing "name"`, or a `Place` base) that resolves against no scope
 *    in the chain above.
 *
 * Deliberately out of scope: this rule does **not** simulate control-flow execution order for
 * *global* reads (e.g. `print :x` textually before `:x = 1` at the top level is not flagged).
 * Doing so would require reasoning about whether an intervening branch/loop/procedure call
 * actually runs before the read — exactly the "speculate on dynamic values" this issue's own
 * scope explicitly rules out — and would risk false positives on ordinary top-to-bottom code
 * (e.g. a global set inside one `if` branch and read after the `if` closes). Procedure frames and
 * binder scopes, by contrast, are checked for *lexical membership*, not order, which is what
 * `spec/execution-model.md`'s frame model actually specifies.
 *
 * That same order-free frame set is why a `local`'s own initializer is checked against a scope
 * that already contains the binding the declaration creates, so `local x = :x` does not report
 * although `spec/execution-model.md:508-515` evaluates the initializer *before* the binding exists.
 * Fixing it needs a per-statement scope rather than a per-frame set — the same model
 * `ol-var-not-visible` has to build — and a partial fix would reject the conforming
 * `local x = 1` / `local x = :x` snapshot idiom `:511-515` exists to allow. Tracked as issue #1102,
 * scheduled with #825.
 *
 * A segmented place's base (`:people` in `:people.tom = 1`) is always checked as a **read**, never
 * treated as a declaration — `spec/execution-model.md:251-291` is explicit that there is no
 * intermediate auto-vivification; only a bare, zero-segment `:name = value` can create a new
 * binding.
 */

import type { Diagnostic } from "@openlogo/core";
import type {
  AnyNode,
  Binder,
  CallNode,
  ExpressionNode,
  ParenCallNode,
  PlaceNode,
  ProcedureDefNode,
  ProgramNode,
  WordLitNode,
} from "./ast.js";
import { childrenOf } from "./ast.js";
import type { CheckProfile } from "./check.js";

/**
 * The lowercase name(s) a `for … in` / `map`/`filter`/`reduce` binder introduces: one for a bare
 * `name`, or one per `:name` in a destructuring `[ :x :y ]` pattern (`spec/grammar.md:137-138`).
 * Resolving which destructured name a given read maps to is out of scope here (#114); every
 * destructured name is simply visible throughout the loop/comprehension body, same as today's
 * single bare-name binder.
 */
function binderNames(binder: Binder): string[] {
  return "kind" in binder
    ? binder.names.map((name) => name.name.toLowerCase())
    : [binder.name.toLowerCase()];
}

/**
 * The scope chain in effect at a point in the program: the enclosing procedure's own frame (its
 * parameters plus every `local` reachable from its body, or `undefined` at the top level), and a
 * stack of active binder scopes (innermost last) from enclosing `for`/comprehension bodies.
 */
interface ScopeContext {
  readonly procedureFrame: ReadonlySet<string> | undefined;
  readonly binderStack: readonly ReadonlySet<string>[];
}

const ROOT_CONTEXT: ScopeContext = {
  procedureFrame: undefined,
  binderStack: [],
};

function pushBinder(
  scopeContext: ScopeContext,
  binder: ReadonlySet<string>,
): ScopeContext {
  return {
    procedureFrame: scopeContext.procedureFrame,
    binderStack: [...scopeContext.binderStack, binder],
  };
}

/** Is `name` visible via `scopeContext`'s binder stack or enclosing procedure frame (not the globals)? */
function visibleInLocalScope(
  name: string,
  scopeContext: ScopeContext,
): boolean {
  for (let i = scopeContext.binderStack.length - 1; i >= 0; i -= 1) {
    // `binderStack[i]` is always populated within `[0, length)` — `noUncheckedIndexedAccess`
    // cannot correlate that with a bounded `for` loop, so this documents the invariant.
    const binder = scopeContext.binderStack[i] as ReadonlySet<string>;
    if (binder.has(name)) {
      return true;
    }
  }
  return scopeContext.procedureFrame?.has(name) ?? false;
}

/** Is `name` visible anywhere in the full scope chain: binder stack, procedure frame, or global? */
function isVisible(
  name: string,
  scopeContext: ScopeContext,
  globals: ReadonlySet<string>,
): boolean {
  return visibleInLocalScope(name, scopeContext) || globals.has(name);
}

/**
 * Collects `procDef`'s own frame: its parameters plus every `local` name reachable from its
 * body — stopping at a nested `define` (procedures don't share frames with one another) so a
 * deeper procedure's own locals never leak into this one.
 */
function collectProcedureFrame(procDef: ProcedureDefNode): ReadonlySet<string> {
  const names = new Set<string>();
  for (const param of procDef.params) {
    names.add(param.name.name.toLowerCase());
  }
  collectLocalsWithoutCrossingProcedures(procDef.body, names);
  return names;
}

function collectLocalsWithoutCrossingProcedures(
  node: AnyNode,
  into: Set<string>,
): void {
  if (node.kind === "ProcedureDef") {
    return;
  }
  if (node.kind === "Local") {
    for (const name of node.names) {
      into.add(name.name.toLowerCase());
    }
    // Fall through to the generic descent rather than returning: since #823 a `Local` can carry an
    // initializer, and a comprehension body inside it holds statements — so a `local` nested there
    // is reachable exactly the way one nested in a control body already was.
  }
  for (const child of childrenOf(node)) {
    collectLocalsWithoutCrossingProcedures(child, into);
  }
}

/**
 * Pass 1: every name that becomes a global binding anywhere in the program — see the module doc
 * comment. Must run to completion before {@link checkReads}, since a read may forward-reference a
 * global declared later in the file.
 */
function collectGlobalNames(program: ProgramNode): ReadonlySet<string> {
  const globals = new Set<string>();
  collectGlobalsIn(program, ROOT_CONTEXT, globals);
  return globals;
}

function collectGlobalsIn(
  node: AnyNode,
  scopeContext: ScopeContext,
  globals: Set<string>,
): void {
  switch (node.kind) {
    case "Local":
      // A `local` is always a declaration into the *current* frame — the enclosing procedure's
      // own frame (already collected by collectProcedureFrame, so ignored here) or, at the top
      // level, the root/global frame, regardless of surrounding control-flow nesting.
      if (scopeContext.procedureFrame === undefined) {
        for (const name of node.names) {
          globals.add(name.name.toLowerCase());
        }
      }
      // The single-name form's initializer is an ordinary expression and may itself assign
      // (`local total = :n + 1`), so it is descended into whatever the frame.
      if (node.value !== undefined) {
        collectGlobalsIn(node.value, scopeContext, globals);
      }
      return;
    case "Global":
      // `global name = value` names the ROOT scope's binding whatever scope it is written in
      // (`spec/execution-model.md:576-583`), so it contributes a global unconditionally — the
      // `procedureFrame` gate `Local` needs does not apply. A misplaced one is
      // `ol-global-outside-root`'s subject (`checker-global-placement.ts`), not this rule's:
      // reporting the name as undefined *as well* would answer one mistake with two diagnostics.
      //
      // **That suppression is this rule's alone and must not carry over to `ol-var-not-visible`
      // (#825).** A learner who wrote `global` in the wrong place still needs the diagnostic whose
      // message names the fix when a procedure body reads the name. Note too that `globals` below
      // flattens three different origins — a top-level `local`, a root-level bare assignment, and a
      // `Global` declaration — which is all `ol-undefined-var` needs and is *not* enough for #825,
      // whose whole question is whether a root-bound name is `global` or merely top-level. The
      // `Global` node kind is the discriminator; the flat set is not a settled contract.
      globals.add(node.name.name.toLowerCase());
      collectGlobalsIn(node.value, scopeContext, globals);
      return;
    case "Assign": {
      const target = node.place;
      if (target.kind === "Place" && target.segments.length === 0) {
        const name = target.base.name.toLowerCase();
        if (!visibleInLocalScope(name, scopeContext)) {
          globals.add(name);
        }
      } else if (target.kind !== "Place") {
        collectGlobalsIn(target, scopeContext, globals);
      }
      collectGlobalsIn(node.value, scopeContext, globals);
      return;
    }
    case "ProcedureDef": {
      const inner: ScopeContext = {
        procedureFrame: collectProcedureFrame(node),
        binderStack: [],
      };
      for (const param of node.params) {
        if (param.defaultValue !== undefined) {
          collectGlobalsIn(param.defaultValue, inner, globals);
        }
      }
      collectGlobalsIn(node.body, inner, globals);
      return;
    }
    case "ForIn": {
      collectGlobalsIn(node.iterable, scopeContext, globals);
      const binder = new Set(binderNames(node.binder));
      collectGlobalsIn(node.body, pushBinder(scopeContext, binder), globals);
      return;
    }
    case "ForRange": {
      collectGlobalsIn(node.from, scopeContext, globals);
      collectGlobalsIn(node.to, scopeContext, globals);
      if (node.by !== undefined) {
        collectGlobalsIn(node.by, scopeContext, globals);
      }
      const binder = new Set([node.variable.name.toLowerCase()]);
      collectGlobalsIn(node.body, pushBinder(scopeContext, binder), globals);
      return;
    }
    case "Comprehension": {
      collectGlobalsIn(node.iterable, scopeContext, globals);
      const names = binderNames(node.binder);
      if (node.form === "reduce") {
        collectGlobalsIn(node.initial, scopeContext, globals);
        names.push(node.accumulator.name.toLowerCase());
      }
      collectGlobalsIn(
        node.body,
        pushBinder(scopeContext, new Set(names)),
        globals,
      );
      return;
    }
    default:
      for (const child of childrenOf(node)) {
        collectGlobalsIn(child, scopeContext, globals);
      }
  }
}

/** Is `node` a `thing "name"` call — the one form whose literal argument statically names a variable? */
function thingCallArg(node: CallNode | ParenCallNode): WordLitNode | undefined {
  if (node.callee.name.toLowerCase() !== "thing" || node.args.length !== 1) {
    return undefined;
  }
  // `node.args.length === 1` guarantees index 0 is populated; `noUncheckedIndexedAccess` cannot
  // correlate a `.length` check with indexed access, so this documents the invariant instead of
  // adding a redundant runtime `undefined` check whose "undefined" branch could never be taken
  // (the same documented-invariant-cast shape `checker-not-a-place.ts`'s `RenderableNode` cast
  // uses, and for the same reason: an unreachable branch fails the 100% coverage gate).
  const arg = node.args[0] as ExpressionNode;
  return arg.kind === "WordLit" ? arg : undefined;
}

/** The learner-facing message template for a read of an unbound variable name. */
function messageFor(name: string): string {
  return `:${name} is not defined yet. declare it with a parameter, 'local', or an assignment first.`;
}

function undefinedVarDiagnostic(
  name: string,
  span: Diagnostic["source_span"],
): Diagnostic {
  return {
    code: "ol-undefined-var",
    source_span: span,
    params: { name },
    message: messageFor(name),
    stage: "semantic",
    severity: "error",
  };
}

/** Checks a `Place`'s base as a read (postfixed reads and segmented assignment-target bases). */
function checkBaseRead(
  place: PlaceNode,
  scopeContext: ScopeContext,
  globals: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): void {
  const name = place.base.name.toLowerCase();
  if (!isVisible(name, scopeContext, globals)) {
    diagnostics.push(undefinedVarDiagnostic(name, place.base.source_span));
  }
}

/**
 * Pass 2: every read (bare `:name`, `thing "name"`, or a `Place` base) that resolves against no
 * scope in the chain raises one `ol-undefined-var` diagnostic. See the module doc comment for the
 * scope model and its deliberate boundary (no control-flow-order analysis for globals).
 */
function checkReads(
  program: ProgramNode,
  globals: ReadonlySet<string>,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  checkReadsIn(program, ROOT_CONTEXT, globals, diagnostics);
  return diagnostics;
}

function checkReadsIn(
  node: AnyNode,
  scopeContext: ScopeContext,
  globals: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): void {
  switch (node.kind) {
    case "VarRef": {
      const name = node.name.toLowerCase();
      if (!isVisible(name, scopeContext, globals)) {
        diagnostics.push(undefinedVarDiagnostic(name, node.source_span));
      }
      return;
    }
    case "Place":
      // Reached here (not via the Assign case below, which handles a Place assignment target
      // directly and never recurses generically into it), this Place is always a read of its
      // base — e.g. `print :missing.field` or `:nums[1]` used as a value.
      checkBaseRead(node, scopeContext, globals, diagnostics);
      for (const segment of node.segments) {
        if (segment.kind === "index") {
          checkReadsIn(segment.key, scopeContext, globals, diagnostics);
        }
      }
      return;
    case "Local":
      // A declaration, never a read; its names are collected by collectGlobalNames /
      // collectProcedureFrame, not here. Its optional initializer IS a read position, so it is
      // checked (`local total = :n + 1`).
      if (node.value !== undefined) {
        checkReadsIn(node.value, scopeContext, globals, diagnostics);
      }
      return;
    case "Global":
      // Same split as `Local`: the declared name is a binding collected by collectGlobalNames,
      // and the required initializer is a read position.
      checkReadsIn(node.value, scopeContext, globals, diagnostics);
      return;
    case "Assign": {
      const target = node.place;
      if (target.kind === "Place") {
        if (target.segments.length > 0) {
          // Segmented target: the base must already be a bound variable — no intermediate
          // auto-vivification (spec/execution-model.md:251-291) — so it is checked as a read.
          checkBaseRead(target, scopeContext, globals, diagnostics);
          for (const segment of target.segments) {
            if (segment.kind === "index") {
              checkReadsIn(segment.key, scopeContext, globals, diagnostics);
            }
          }
        }
        // A zero-segment target (`:name = value`) is never itself a read — see the module doc
        // comment and collectGlobalNames.
      } else {
        checkReadsIn(target, scopeContext, globals, diagnostics);
      }
      checkReadsIn(node.value, scopeContext, globals, diagnostics);
      return;
    }
    case "ProcedureDef": {
      const inner: ScopeContext = {
        procedureFrame: collectProcedureFrame(node),
        binderStack: [],
      };
      for (const param of node.params) {
        if (param.defaultValue !== undefined) {
          checkReadsIn(param.defaultValue, inner, globals, diagnostics);
        }
      }
      checkReadsIn(node.body, inner, globals, diagnostics);
      return;
    }
    case "ForIn": {
      checkReadsIn(node.iterable, scopeContext, globals, diagnostics);
      const binder = new Set(binderNames(node.binder));
      checkReadsIn(
        node.body,
        pushBinder(scopeContext, binder),
        globals,
        diagnostics,
      );
      return;
    }
    case "ForRange": {
      checkReadsIn(node.from, scopeContext, globals, diagnostics);
      checkReadsIn(node.to, scopeContext, globals, diagnostics);
      if (node.by !== undefined) {
        checkReadsIn(node.by, scopeContext, globals, diagnostics);
      }
      const binder = new Set([node.variable.name.toLowerCase()]);
      checkReadsIn(
        node.body,
        pushBinder(scopeContext, binder),
        globals,
        diagnostics,
      );
      return;
    }
    case "Comprehension": {
      checkReadsIn(node.iterable, scopeContext, globals, diagnostics);
      const names = binderNames(node.binder);
      if (node.form === "reduce") {
        checkReadsIn(node.initial, scopeContext, globals, diagnostics);
        names.push(node.accumulator.name.toLowerCase());
      }
      checkReadsIn(
        node.body,
        pushBinder(scopeContext, new Set(names)),
        globals,
        diagnostics,
      );
      return;
    }
    case "Call":
    case "ParenCall": {
      const wordArg = thingCallArg(node);
      if (wordArg !== undefined) {
        const name = wordArg.value.toLowerCase();
        if (!isVisible(name, scopeContext, globals)) {
          diagnostics.push(undefinedVarDiagnostic(name, wordArg.source_span));
        }
      }
      for (const child of childrenOf(node)) {
        checkReadsIn(child, scopeContext, globals, diagnostics);
      }
      return;
    }
    default:
      for (const child of childrenOf(node)) {
        checkReadsIn(child, scopeContext, globals, diagnostics);
      }
  }
}

/**
 * The `ol-undefined-var` rule: every read whose name resolves against no scope in the program's
 * lexical chain raises one diagnostic at that read's own span. See the module doc comment.
 */
export function undefinedVarRule(
  program: ProgramNode,
  _profiles?: readonly CheckProfile[],
): readonly Diagnostic[] {
  const globals = collectGlobalNames(program);
  return checkReads(program, globals);
}
