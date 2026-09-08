/**
 * The variable **scope model** — the one place `@openlogo/runtime` decides what a name means.
 *
 * `spec/execution-model.md`'s § *Variables, scoping, and procedures* states the whole ruling in a
 * sentence: **"A name is born where it is first assigned, lives until that scope ends, and a
 * procedure's edge is sealed."** This module is that sentence, executable. Everything the evaluator
 * and the statement dispatcher do with a name — read it, assign it, declare it `local`, declare it
 * `global`, enter a block, enter a call — goes through the four exported operations below, so the
 * rule is stated once rather than re-derived at each of the (currently five) name sites.
 *
 * ### The three scope kinds (`spec/execution-model.md:359-379`)
 *
 * A scope is one {@link Frame}. {@link Environment.frames} is that chain, **nearest first, root
 * last**, and the kind of each is implied by how it got there:
 *
 * - the **root scope** is always the last frame, created once per run;
 * - a **procedure frame** is pushed by a call, which builds its chain as
 *   `[calleeFrame, rootFrame]` — the caller's own frames are dropped, which is the seal;
 * - a **block scope** is pushed by {@link pushBlockScope} (a control-form body, a handler block,
 *   an `ask`/`each` body) or by {@link pushLoopFrame} (a `for`/comprehension binder, which needs
 *   the same fresh frame *and* seeds it with the binder's names).
 *
 * Both pushes return a **new** {@link Environment} rather than mutating one, so leaving a scope
 * needs no "pop" step and no cleanup on an early `stop`/`return`/halt: the caller simply stops
 * using the value. That is also what makes each entry's bindings **fresh**
 * (`spec/execution-model.md:377-379`) — every turn of a loop, every call, and every handler
 * invocation gets its own frame — and what makes a handler's capture of the registering scope a
 * capture of *that entry's* frame chain (`spec/execution-model.md:617-637`).
 *
 * ### What is visible (`spec/execution-model.md:381-403`)
 *
 * {@link findVisibleFrame} is the whole rule, and every other operation here is written on top of
 * it:
 *
 * - every frame **before** the root is visible, so a block sees its enclosing scopes out to and
 *   including the procedure frame or root scope it is written in;
 * - the **root** frame is visible in full at the top level, and inside a procedure body only for
 *   names declared `global` ({@link Environment.globals}).
 *
 * The seal needs no extra bookkeeping because a call's chain already stops at the root: the only
 * thing the boundary has to hide is the root frame's *non-`global`* names, which
 * {@link Environment.procedure} (set exactly when a procedure body is executing) gates.
 *
 * ### The static shadow of this model
 *
 * The semantic checker must restate these rules lexically rather than reuse them — `@openlogo/parser`
 * cannot depend on `@openlogo/runtime` (the dependency runs the other way), and the checker answers a
 * different question anyway: it reports a name only when **no** execution order could make it
 * visible, where this module answers "what is visible *now*". The two therefore agree exactly within
 * one scope's straight-line statement list and diverge only where the spec says they may
 * (`spec/execution-model.md:416-424`). Keep them in step: this module's `findVisibleFrame` and the
 * checker's scope walk are two encodings of the same four bullet points above, and
 * `checker-runtime-agreement.test.mjs` in this package is what holds them there — it runs `check()`
 * and `execute()` over one corpus and asserts they report the same code and params wherever the spec
 * says they must agree, plus pins the divergences it says they may have.
 */

import type { OLValue } from "@openlogo/core";
import type { ProgramNode } from "@openlogo/parser";
import type { Environment } from "./evaluate.js";

/**
 * The value of a binding declared by `local name` with **no initializer**
 * (`spec/commands.md:103-122`). Such a binding genuinely exists — it shadows an outer name of the
 * same spelling, and a later assignment finds and fills it — but it holds no value yet, and
 * OpenLogo has no "empty" value to stand in for one. Reading it is therefore an ordinary
 * `ol-undefined-var`, exactly like reading a name whose creating statement has not run.
 *
 * A unique symbol rather than `undefined`, so `Map.get` returning "nothing there" stays
 * distinguishable from "declared, still unbound" without a second `has` probe on the hot read path.
 */
export const UNBOUND: unique symbol = Symbol("openlogo.unbound");

/** What a frame slot may hold: a real value, or {@link UNBOUND}. */
export type Binding = OLValue | typeof UNBOUND;

/** One scope: a mutable name→binding table, keyed by the case-folded identifier. */
export type Frame = Map<string, Binding>;

/**
 * The outcome of reading a name. A failed read carries **which** of the two spec codes it is:
 * `hiddenBy` names the procedure whose sealed boundary hid an otherwise-existing binding
 * (`ol-var-not-visible`, `spec/error-model.md:132`), and is `undefined` for every other failed read
 * (`ol-undefined-var`, `spec/error-model.md:102`).
 */
export type VariableRead =
  | { readonly found: true; readonly value: OLValue }
  | { readonly found: false; readonly hiddenBy: string | undefined };

/**
 * The nearest frame that binds `key` **and that the code being executed can see**, or `undefined`
 * when no visible frame binds it (`spec/execution-model.md:381-394`).
 *
 * The loop stops one short of the root and the root is then judged separately, because the root is
 * the only frame the procedure boundary gates: a call's chain is `[calleeFrame, …, rootFrame]`, so
 * every frame the loop covers is one the running code is written inside, while the root frame's
 * plain names are exactly what a procedure body must not see. At the top level `procedure` is
 * `undefined` and the root is visible in full; a chain of length one (the root alone) skips the loop
 * entirely and takes that path.
 */
function findVisibleFrame(
  environment: Environment,
  key: string,
): Frame | undefined {
  const frames = environment.frames;
  const rootIndex = frames.length - 1;
  for (let index = 0; index < rootIndex; index++) {
    const frame = frames[index] as Frame;
    if (frame.has(key)) {
      return frame;
    }
  }
  const root = frames[rootIndex] as Frame;
  if (!root.has(key)) {
    return undefined;
  }
  return environment.procedure !== undefined && !environment.globals.has(key)
    ? undefined
    : root;
}

/**
 * The procedure whose sealed boundary is the reason a read failed, or `undefined` when the boundary
 * is not the reason. Called only once a read has already missed, so it decides nothing but which of
 * the two codes `spec/error-model.md:102,132` distinguishes the failure gets.
 *
 * **The test is lexical, not temporal** (`spec/execution-model.md:405-414`,
 * `spec/error-model.md:132`): a name an enclosing scope binds *anywhere in the declaring document*
 * takes `ol-var-not-visible` "whether or not that binding has been created by the time the read
 * executes", which is what keeps the code decidable at the `semantic` stage. So this consults
 * {@link Environment.rootScopeNames} — the names the root scope binds anywhere in the document,
 * computed once before the run — and never `root.has(key)`, which would answer the different,
 * temporal question "has that binding been created yet?" and would report `ol-undefined-var` for a
 * read that merely runs before the top-level assignment line.
 *
 * A procedure body's only lexically enclosing scope is the **root scope**: procedures are
 * declarations registered in phase 1 (`spec/execution-model.md:651-655`), never nested inside the
 * scope they are written in, so there is no other enclosing scope to consult. A name a top-level
 * *block* binds is therefore not in this set — that block encloses no procedure body — and a read
 * of it is the ordinary `ol-undefined-var`.
 *
 * A name declared `global` is not boundary-hidden at all (`spec/execution-model.md:412-414`), so
 * {@link rootScopeNames} excludes every name any `global` declaration in the document names: a read
 * that runs before such a declaration line "finds no binding and raises `ol-undefined-var`, like any
 * other name".
 */
function boundaryHiding(
  environment: Environment,
  key: string,
): string | undefined {
  const procedure = environment.procedure;
  if (procedure === undefined) {
    return undefined;
  }
  return environment.rootScopeNames.has(key) ? procedure : undefined;
}

/**
 * Read `name` (`:name`, `thing "name"`, or a postfix place's base). Case-folded, because OpenLogo
 * identifiers are case-insensitive (`spec/grammar.md:13`) — every binder folds the same way, so
 * `:SomeVar` and `:somevar` are one binding and one failed-read identity.
 */
export function readVariable(
  environment: Environment,
  name: string,
): VariableRead {
  const key = name.toLowerCase();
  const frame = findVisibleFrame(environment, key);
  if (frame === undefined) {
    return { found: false, hiddenBy: boundaryHiding(environment, key) };
  }
  const binding = frame.get(key) as Binding;
  return binding === UNBOUND
    ? { found: false, hiddenBy: undefined }
    : { found: true, value: binding };
}

/**
 * `:<place> = <value>`, `set <place> to <value>`, and heritage `make "name" <value>`: **update the
 * nearest visible binding, and create one in the current scope when no binding of that name is
 * visible** (`spec/execution-model.md:476-490`).
 *
 * **Visibility decides, never statement order.** A procedure assigning a name an enclosing scope
 * made visible to it — a parameter, or a `global` — updates that binding whether the assignment
 * comes before or after any read; a procedure assigning a name it cannot see creates its own, again
 * regardless of order. There is no rule here that makes a whole body local because of an assignment
 * later in it: the *only* thing this function looks at is {@link findVisibleFrame}'s answer.
 *
 * "The current scope" is `frames[0]` — the enclosing block if there is one, otherwise the procedure
 * frame or the root scope — which is also why a name born inside a block dies at the `]`: the frame
 * it was created in is the one the block stops using (`spec/execution-model.md:595-615`).
 */
export function assignVariable(
  environment: Environment,
  name: string,
  value: OLValue,
): void {
  const key = name.toLowerCase();
  const target =
    findVisibleFrame(environment, key) ?? (environment.frames[0] as Frame);
  target.set(key, value);
}

/**
 * The names the **root scope** binds anywhere in `program` — the lexical set
 * {@link boundaryHiding} decides `ol-var-not-visible` from, computed once before the run because it
 * is a property of the document, not of how far execution has got
 * (`spec/execution-model.md:405-414`).
 *
 * Only the program's **own top-level statements** are scanned, never their bodies. A name bound
 * inside a top-level `repeat`/`if`/handler block belongs to that *block* scope, and a block encloses
 * no procedure body, so it is not something the boundary hides — reading it from a procedure is the
 * ordinary `ol-undefined-var`. What binds a name in the root scope is a bare assignment
 * (`:name = …` / `set name to …` / heritage `make`, all `Assign` nodes with a segment-less place)
 * or a root-level `local`.
 *
 * Every name any `global` declaration in the document names is then **removed**, because a `global`
 * is not boundary-hidden (`spec/execution-model.md:412-414`) — a procedure can see it, and a read
 * that runs before its declaration line is an ordinary `ol-undefined-var` "like any other name".
 * Only root-level `global` declarations count, because only those declare anything: one written
 * anywhere else raises `ol-global-outside-root` when it runs and shares no name at all.
 */
export function collectRootScopeNames(program: ProgramNode): Set<string> {
  const names = new Set<string>();
  const declaredGlobal = new Set<string>();
  for (const statement of program.body) {
    if (
      statement.kind === "Assign" &&
      statement.place.kind === "Place" &&
      statement.place.segments.length === 0
    ) {
      names.add(statement.place.base.name.toLowerCase());
      continue;
    }
    if (statement.kind === "Local") {
      for (const name of statement.names) {
        names.add(name.name.toLowerCase());
      }
      continue;
    }
    if (statement.kind === "Global") {
      declaredGlobal.add(statement.name.name.toLowerCase());
    }
  }
  for (const name of declaredGlobal) {
    names.delete(name);
  }
  return names;
}

/**
 * Push `frame` onto `environment` as the new current scope, nearest-first. Returns a **new**
 * {@link Environment}; `environment` itself is never mutated, so the scope ends simply by the
 * caller ceasing to use the returned value — there is no pop and no unwind path to get wrong.
 * Everything else (`repeatTurns`, `callDepth`, the shared mutable boxes, `procedure`, `globals`) is
 * threaded through unchanged, so a block nested in a `repeat` still sees the right `repcount` and a
 * block inside a procedure body is still inside that procedure.
 */
function pushFrame(environment: Environment, frame: Frame): Environment {
  return { ...environment, frames: [frame, ...environment.frames] };
}

/**
 * Enter a **block scope** (`spec/execution-model.md:367-369`): a control-form body, a handler block,
 * or an `ask`/`each` body, in either the `[ … ]` or the long `… end` spelling. One call per
 * *entry*, so each turn of a loop and each handler invocation gets its own frame — which is what
 * makes `repeat 4 [ :x = 0  :x = :x + 1  print :x ]` print `1 1 1 1` and what gives each
 * registration in `repeat 3 [ :n = repcount * 10   every 5 [ print :n ] ]` its own `:n`.
 *
 * A block is a **lifetime** boundary, not a write boundary: the pushed frame is empty, so an
 * assignment to a name an enclosing scope binds still finds that binding and updates it — the
 * accumulator idiom (`spec/execution-model.md:595-601`).
 */
export function pushBlockScope(environment: Environment): Environment {
  return pushFrame(environment, new Map());
}

/**
 * Enter a block scope that starts out holding `bindings` — a `for … in`/`for … from … to` loop
 * variable or a comprehension binder (`spec/execution-model.md:769-808`). Identical to
 * {@link pushBlockScope} in every other respect: the binder's names are simply born already bound,
 * fresh on each pass, and go out of scope with the rest of the block's own names.
 */
export function pushLoopFrame(
  environment: Environment,
  bindings: ReadonlyMap<string, OLValue>,
): Environment {
  return pushFrame(environment, new Map(bindings));
}

/**
 * Is `environment` the **root scope** — the top-level program, outside every procedure frame and
 * every block? That is the placement `global` requires (`spec/execution-model.md:561-563`,
 * `spec/commands.md:143`) and the case `local` treats specially (it names the root scope's own
 * binding rather than shadowing into a new one).
 *
 * The frame chain alone decides it. The root frame is always last, a block entry always pushes one
 * in front of it, and a procedure call always builds `[calleeFrame, rootFrame]` — so a chain of
 * length one is the root scope and nothing else can be. Testing `procedure === undefined` as well
 * would be a branch no execution can take, since no procedure body ever runs on a one-frame chain.
 */
export function isRootScope(environment: Environment): boolean {
  return environment.frames.length === 1;
}

/**
 * `local name` / `(local a b …)` — declare `names` in the **current scope**, shadowing anything of
 * that name that was visible (`spec/commands.md:103-122`).
 *
 * At the root scope there is no enclosing scope to shadow into, so `local` **names the root scope's
 * own binding** of that name: an existing binding (including a `global`) is left exactly as it is,
 * rather than being replaced by a second, procedure-invisible binding beside it
 * (`spec/execution-model.md:520-526`). Everywhere else the declaration always creates a fresh,
 * {@link UNBOUND} binding in `frames[0]`, so it shadows even where the same scope already bound the
 * name.
 */
export function declareLocalNames(
  environment: Environment,
  names: readonly string[],
): void {
  const scope = environment.frames[0] as Frame;
  const namesTheRootBinding = isRootScope(environment);
  for (const name of names) {
    const key = name.toLowerCase();
    if (namesTheRootBinding && scope.has(key)) {
      continue;
    }
    scope.set(key, UNBOUND);
  }
}

/**
 * `local name = value` — the same declaration with an initializer already evaluated by the caller.
 *
 * The split matters and is the caller's job, not this function's: **the initializer is evaluated
 * before the new binding is created, with exactly the visibility the `local` statement itself has**
 * (`spec/execution-model.md:508-515`), which is what lets `local count = :count + 1` read the
 * `count` the statement could already see — a parameter, an earlier binding of the same scope, an
 * enclosing block's binding, or a `global` — instead of raising `ol-undefined-var` on the binding it
 * is about to create.
 *
 * At the root scope this assigns the root scope's own binding and leaves an existing `global` of
 * that name global (`spec/execution-model.md:520-526`); everywhere else it creates the shadowing
 * binding in the current scope.
 */
export function declareLocalWithValue(
  environment: Environment,
  name: string,
  value: OLValue,
): void {
  (environment.frames[0] as Frame).set(name.toLowerCase(), value);
}

/**
 * `global name = value` — mark the **root scope's** binding of `name` shared and assign the
 * initializer, whether or not the root scope already holds a binding of that name
 * (`spec/execution-model.md:576-583`). So `:count = 5` followed by `global count = 0` leaves one
 * binding, now shared and holding `0`, and a second `global count = …` assigns again rather than
 * creating a second binding or raising `ol-duplicate-definition`.
 *
 * `globals` is a shared mutable set carried by every environment derived from the run's root one
 * (like `instructionCount` and `addressing`), so a declaration made at the top level is observed by
 * every procedure body — including one that ran earlier and is still reachable through a registered
 * handler.
 */
export function declareGlobal(
  environment: Environment,
  name: string,
  value: OLValue,
): void {
  const key = name.toLowerCase();
  environment.globals.add(key);
  (environment.frames[environment.frames.length - 1] as Frame).set(key, value);
}
