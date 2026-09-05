/**
 * The two **name-resolution** diagnostics of Layer 2 (`spec/tooling.md:184-185`): `ol-undefined-var`
 * for a read that resolves against nothing, and `ol-var-not-visible` (issue #825) for a read the
 * **sealed procedure boundary** is the reason for.
 *
 * A read is a bare `VarRef` (`:name`), a `thing "name"` call whose literal argument names a
 * variable, or the base of a postfixed `Place` (`:people.tom.age`, `:nums[1]`).
 *
 * ### This module is the static shadow of `@openlogo/runtime`'s `scope.ts`
 *
 * `spec/execution-model.md`'s § *Variables, scoping, and procedures* states the whole ruling in one
 * sentence — **"A name is born where it is first assigned, lives until that scope ends, and a
 * procedure's edge is sealed."** (`spec/execution-model.md:351-352`) — and `@openlogo/runtime`'s
 * `scope.ts` is that sentence executable. This module is the same four bullet points of
 * `spec/execution-model.md:381-403` restated **lexically**, because `@openlogo/parser` cannot depend
 * on `@openlogo/runtime` (the dependency runs the other way, and that module's own doc comment rules
 * on exactly this). The correspondence is deliberate and meant to be checked, not merely intended:
 *
 * | here | `@openlogo/runtime`'s `scope.ts` |
 * |---|---|
 * | {@link visibleInChain} | `findVisibleFrame` |
 * | {@link boundaryHiding} | `boundaryHiding` |
 * | {@link collectBindingsIn}'s `Assign` case | `assignVariable` |
 * | {@link DocumentFacts.rootBindings} | `collectRootScopeNames` |
 *
 * That last row is the one place the two sets are **not** literally equal, and the difference is
 * measured rather than assumed. `collectRootScopeNames` subtracts every name a root-level `global`
 * declares, because the runtime can reach `boundaryHiding` for such a name — a read that runs
 * *before* the declaration line finds no binding — and `spec/execution-model.md:412-414` says that
 * read is an ordinary `ol-undefined-var`. Here the same subtraction is **unobservable**: the check
 * is lexical, so a root-level `global` is already visible through the seal at every read in the
 * document ({@link visibleInChain}), and {@link boundaryHiding} is only ever consulted after a read
 * has already failed. Subtracting a set that can never be consulted would be code no test could
 * fail, which is worse than an honest asymmetry — so it is stated here instead of written.
 *
 * `packages/runtime/src/checker-runtime-agreement.test.mjs` is the guard: it runs `check()` and
 * `execute()` over one corpus and asserts they report the same code and params wherever the spec
 * says they must agree. Moving `collectRootScopeNames` down into this package so there is literally
 * one implementation is a pure refactor, deliberately not done in this slice (issue #1116).
 *
 * ### The one asymmetry, and why it is not a bug
 *
 * `spec/execution-model.md:416-424` is explicit that the two stages resolve differently on purpose:
 * the evaluator resolves a name **as execution reaches it**, while the checker "MUST resolve them
 * lexically and conservatively: it reports a name only when **no** execution order could make that
 * name visible at the read". That splits cleanly in two, and the split is this module's whole
 * design:
 *
 * - **Within one scope's own straight-line statement list the two agree exactly**, so a read is
 *   resolved against the bindings that scope has made *so far* ({@link Scope.boundSoFar}). This is
 *   what makes the headline diagnostic fire on the **read**: in
 *   `repeat 4 [ forward :count * 10   :count = :count + 1 ]` the write creates a binding in the
 *   `repeat` body — born fresh on every turn, a genuinely different variable — and the read comes
 *   first (`spec/execution-model.md:441-447`).
 * - **Across a scope boundary the checker never reports a name that a later declaration or a
 *   deferred handler could reach** (`spec/execution-model.md:423-424`), so an *enclosing* scope
 *   contributes every name it binds **anywhere** ({@link Scope.own}), regardless of position. A
 *   handler block registered before the top-level statement that binds the name it reads still sees
 *   that binding when it fires (`spec/execution-model.md:401-403`), and nothing here reports it.
 *
 * The consequence is that nesting a read one scope deeper can only ever make this module quieter,
 * never louder — which is the direction a conservative checker must err in. The price is one
 * **permitted false negative**: `repeat 1 [ print :later ]` followed by `:later = 1` is silent,
 * although no execution order makes that read resolve. `spec/execution-model.md:409-411` names that
 * shape as `ol-undefined-var`, but it is classifying *which code a failed read gets*, at whichever
 * stage; the checker's own obligation to agree with the evaluator is scoped by `:416-419` to "one
 * scope's straight-line statement list", which a nested read is not in. Separating it from the
 * *deferred* case — `on_click [ print :later ]`, which `:401-403` says legitimately sees the later
 * binding — needs deferredness modelled through a whole nested chain (a handler registered inside a
 * loop body captures that turn's scope, not the root's), and getting that wrong is a false positive
 * on a conforming program. Issue #1118 holds the sharper analysis; `variable-visibility.test.mjs`
 * pins both the silence and its paired positive control so the boundary stays deliberate.
 *
 * A procedure body reading a name its boundary hides is decidable for a different reason, and that
 * is what earns `ol-var-not-visible` the `semantic` stage: the boundary is **lexical and absolute**,
 * so no execution order can bring that binding inside, wherever in the body the read sits —
 * including inside a `repeat` or `if` nested in the body. The choice between the two codes is
 * therefore lexical, not temporal (`spec/execution-model.md:405-414`):
 * {@link DocumentFacts.rootBindings} is consulted, never "has the top-level line run yet".
 *
 * ### What binds a name where
 *
 * A scope's own names are its seeds — a procedure's parameters, a `for`/comprehension binder — plus
 * every binding site among its **own** statements, stopping at each nested scope
 * ({@link collectBindingsIn}). A binding site is a `local` declaration, a root-level `global`
 * declaration, or a bare zero-segment assignment (`:name = …` / `set name to …` / heritage `make`)
 * whose name **no enclosing scope makes visible** — because an assignment to a visible name updates
 * that binding instead of creating one (`spec/execution-model.md:476-490`, `assignVariable`).
 * Visibility decides that, never statement order, which is why `global count = 5` followed by a
 * procedure body's `:count = 0` writes the global and is clean.
 *
 * A segmented place's base (`:people` in `:people.tom = 1`) is always checked as a **read**, never
 * treated as a declaration — `spec/execution-model.md:492-499` is explicit that there is no
 * intermediate auto-vivification, and that inside a procedure that cannot see `people` the postfix
 * form raises `ol-var-not-visible` on the base while the bare form silently creates a local.
 *
 * ### Deliberately out of scope
 *
 * A `define` is registered in phase 1 and never captures the scope it is written in
 * (`spec/execution-model.md:651-655`), so a procedure frame's enclosing chain is always
 * `[frame, root]` — never the lexical parents. A handler block, written in the same place, *does*
 * capture; that is the conservative "enclosing scopes contribute everything" rule above.
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
  StatementNode,
  WordLitNode,
} from "./ast.js";
import { childrenOf } from "./ast.js";
import type { CheckProfile } from "./check.js";

/** A set of case-folded names. Identifiers are case-insensitive (`spec/grammar.md:13`). */
type NameSet = ReadonlySet<string>;

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
 * The document-wide facts every scope consults — all computed once, before any read is resolved,
 * because each is a property of the whole document rather than of how far a walk has got.
 */
interface DocumentFacts {
  /**
   * Names a **root-level** `global` declaration names. These are the only root bindings a procedure
   * body can see (`spec/execution-model.md:389-394`), and they are what {@link visibleInChain} lets
   * through the seal.
   */
  readonly globals: NameSet;
  /**
   * Names a `global` declaration written **anywhere but** the root scope names. Such a declaration
   * declares nothing — it raises `ol-global-outside-root` when it runs
   * (`spec/execution-model.md:561-563`) — but answering that one mistake with a second
   * `ol-undefined-var` on every read of the name would be two diagnostics for one defect, so those
   * reads are suppressed. **The suppression stops there and MUST NOT reach `ol-var-not-visible`:** a
   * learner who put `global` in the wrong place still needs the diagnostic that names the fix when a
   * procedure body reads a name the root scope really does bind.
   *
   * **The suppression is document-wide and name-keyed, and that is sound rather than lazy.** It
   * means exactly "assume the reported mistake is repaired": a root-level `global` is visible to
   * every procedure in the document, so every read this silences really does resolve once the
   * learner does the one thing `ol-global-outside-root` told them to do. Reporting it as well would
   * answer one mistake with a second diagnostic that vanishes when the first is fixed — the thing
   * issue #823 introduced this suppression to avoid. Delete the misplaced declaration instead of
   * moving it and the read is reported again, so the silence is tied to the declaration rather than
   * swallowing the name; `variable-visibility.test.mjs` pins both repairs.
   */
  readonly misplacedGlobals: NameSet;
  /**
   * Every name the root scope binds anywhere. It is both the enclosing chain of every procedure
   * frame and the set that decides `ol-var-not-visible` (`spec/error-model.md:132`) — the names the
   * sealed boundary hides. See the module doc comment's table for why no `global` subtraction is
   * needed here although `collectRootScopeNames` needs one.
   */
  readonly rootBindings: NameSet;
}

/**
 * One scope being walked, mirroring a `@openlogo/runtime` `Environment` at the point the walk has
 * reached: {@link boundSoFar} is this scope's own frame as far as execution has got, and
 * {@link enclosing} is the rest of the chain, **nearest first, root last** — empty only at the root
 * scope itself.
 */
interface Scope {
  /** The full name sets of the enclosing scopes, nearest first, root last. */
  readonly enclosing: readonly NameSet[];
  /** Every name this scope binds anywhere — what it contributes to a *nested* scope's chain. */
  readonly own: NameSet;
  /** The names bound by this scope's statements walked so far, seeded with its binders. */
  readonly boundSoFar: Set<string>;
  /** The declared name of the procedure whose body this is, or `undefined` outside every body. */
  readonly procedure: string | undefined;
}

/**
 * Whether `chain` has a scope that binds `key` **and that the code being checked can see** —
 * `findVisibleFrame` restated (`spec/execution-model.md:381-394`).
 *
 * The loop stops one short of the root and the root is judged separately, because the root is the
 * only scope the procedure boundary gates: every earlier link is one the code is written inside,
 * while the root's plain names are exactly what a procedure body must not see. An **empty** chain
 * means the root scope is asking what encloses *it*, and nothing does.
 */
function visibleInChain(
  chain: readonly NameSet[],
  key: string,
  procedure: string | undefined,
  globals: NameSet,
): boolean {
  if (chain.length === 0) {
    return false;
  }
  const rootIndex = chain.length - 1;
  for (let index = 0; index < rootIndex; index += 1) {
    // Populated within `[0, length)`; `noUncheckedIndexedAccess` cannot correlate that with a
    // bounded `for` loop, so this documents the invariant rather than adding an unreachable branch.
    if ((chain[index] as NameSet).has(key)) {
      return true;
    }
  }
  const root = chain[rootIndex] as NameSet;
  if (!root.has(key)) {
    return false;
  }
  return procedure === undefined || globals.has(key);
}

/** Is `key` visible at the point `scope`'s walk has reached? See the module doc comment's split. */
function isVisible(scope: Scope, key: string, facts: DocumentFacts): boolean {
  return visibleInChain(
    [scope.boundSoFar, ...scope.enclosing],
    key,
    scope.procedure,
    facts.globals,
  );
}

/**
 * The procedure whose sealed boundary is the reason a read failed, or `undefined` when the boundary
 * is not the reason. Called only once a read has already missed, so it decides nothing but which of
 * the two codes `spec/error-model.md:102,132` distinguishes the failure gets — `boundaryHiding`
 * restated.
 *
 * A procedure body's only lexically enclosing scope is the **root scope**: procedures are
 * declarations registered in phase 1 (`spec/execution-model.md:651-655`), never nested inside the
 * scope they are written in, so there is no other enclosing scope to consult. A name a top-level
 * *block* binds is therefore not in this set — that block encloses no procedure body — and a read of
 * it from a procedure is the ordinary `ol-undefined-var`.
 */
function boundaryHiding(
  scope: Scope,
  key: string,
  facts: DocumentFacts,
): string | undefined {
  const procedure = scope.procedure;
  if (procedure === undefined) {
    return undefined;
  }
  return facts.rootBindings.has(key) ? procedure : undefined;
}

/**
 * Adds to `into` every name the subtree at `node` binds **in the scope that owns it**, stopping at
 * each nested scope: a `Block` (a control-form body, a handler block, a comprehension body, in
 * either the `[ … ]` or the long `… end` spelling — `spec/execution-model.md:367-369`) and a
 * `ProcedureDef` both own their own names.
 *
 * `enclosing`/`procedure`/`globals` describe the chain **outside** the owning scope, which is what
 * decides whether a bare assignment creates a binding here or updates a visible one
 * (`spec/execution-model.md:476-490`). An empty `enclosing` therefore means the root scope, which is
 * also the only place a `global` declaration declares anything.
 */
function collectBindingsIn(
  node: AnyNode,
  into: Set<string>,
  enclosing: readonly NameSet[],
  procedure: string | undefined,
  globals: NameSet,
): void {
  switch (node.kind) {
    case "Block":
    case "ProcedureDef":
      return;
    case "Local":
      for (const name of node.names) {
        into.add(name.name.toLowerCase());
      }
      break;
    case "Global":
      if (enclosing.length === 0) {
        into.add(node.name.name.toLowerCase());
      }
      break;
    case "Assign": {
      const target = node.place;
      if (target.kind === "Place" && target.segments.length === 0) {
        const key = target.base.name.toLowerCase();
        if (!visibleInChain(enclosing, key, procedure, globals)) {
          into.add(key);
        }
      }
      break;
    }
    default:
      break;
  }
  for (const child of childrenOf(node)) {
    collectBindingsIn(child, into, enclosing, procedure, globals);
  }
}

/** Every name `statements` bind in the scope that owns them, seeded with that scope's binders. */
function collectScopeBindings(
  statements: readonly StatementNode[],
  seeds: readonly string[],
  enclosing: readonly NameSet[],
  procedure: string | undefined,
  globals: NameSet,
): Set<string> {
  const names = new Set<string>(seeds);
  for (const statement of statements) {
    collectBindingsIn(statement, names, enclosing, procedure, globals);
  }
  return names;
}

/**
 * The names any **root-level** `global` declaration names. Only those declare anything: one written
 * anywhere else raises `ol-global-outside-root` when it runs and shares no name at all
 * (`spec/execution-model.md:561-563`).
 */
function rootGlobalsOf(program: ProgramNode): Set<string> {
  const names = new Set<string>();
  for (const statement of program.body) {
    if (statement.kind === "Global") {
      names.add(statement.name.name.toLowerCase());
    }
  }
  return names;
}

/** The names every `global` written **off** the root scope names — see {@link DocumentFacts}. */
function misplacedGlobalsOf(program: ProgramNode): Set<string> {
  const names = new Set<string>();
  const collect = (node: AnyNode): void => {
    if (node.kind === "Global") {
      names.add(node.name.name.toLowerCase());
    }
    for (const child of childrenOf(node)) {
      collect(child);
    }
  };
  for (const statement of program.body) {
    if (statement.kind === "Global") {
      // Legal *here* — but only this declaration is at the root. Its initializer can still open a
      // block scope (a comprehension body holds statements, `spec/grammar.md:144`), so the subtree
      // below it is walked like any other. Same shape as `checker-global-placement.ts`.
      for (const child of childrenOf(statement)) {
        collect(child);
      }
      continue;
    }
    collect(statement);
  }
  return names;
}

/** {@link DocumentFacts}, computed in the one order their dependencies allow. */
function documentFactsOf(program: ProgramNode): DocumentFacts {
  const globals = rootGlobalsOf(program);
  // The root scope has no enclosing chain, so `globals` is never consulted while deriving its own
  // bindings — which is what keeps this ordering non-circular.
  const rootBindings = collectScopeBindings(
    program.body,
    [],
    [],
    undefined,
    globals,
  );
  return {
    globals,
    misplacedGlobals: misplacedGlobalsOf(program),
    rootBindings,
  };
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

/** The learner-facing message for a read of a name nothing bound. */
function undefinedVarMessage(name: string): string {
  return `:${name} is not defined yet. declare it with a parameter, 'local', or an assignment first.`;
}

/**
 * The learner-facing message for a read the sealed boundary hid. `spec/error-model.md:132` makes two
 * requirements a generic "undefined variable" message would not meet, and both are load-bearing for
 * a learner who can see the name right there at the top level: the message MUST **name the
 * boundary** — `:{name} is not defined inside {procedure}` — and the suggestion MUST **name the
 * fix**, `global {name} = …`.
 *
 * Byte-identical to `@openlogo/runtime`'s `varNotVisible` prose, because `execute()` never runs
 * `check()` and the two stages must report **one identity for one defect** — the same rule
 * `ol-global-outside-root` already follows across `checker-global-placement.ts` and `errors.ts`.
 *
 * Three things in the wording are deliberate, each from a review-gate finding by
 * `@learner-experience`:
 *
 * - **"the fix is one word at the top level"**, which is `spec/execution-model.md:447`'s own
 *   framing. The learner reading this has *already* written `:count = 0` at the top level, so an
 *   earlier draft's "declare it at the top level" told them to do the thing they believe they have
 *   done. The repair is a change to what they wrote, not a new line somewhere else, and the
 *   sentence has to say which.
 * - **"the names it sets itself"** is the third of the three visible categories
 *   (`spec/execution-model.md:389-394`). Naming only parameters and `global` explained the rule by
 *   listing two things this learner's program contains neither of, and omitted the very mechanism
 *   that makes a write-first touch correctly silent.
 * - **"(its starting value)"** rather than `...`, because a screen reader does not speak an ellipsis
 *   at default punctuation verbosity: `global count = ...` was heard as "global count equals" and
 *   the entire actionable clause vanished. The placeholder stays a placeholder — the learner's real
 *   initializer is in neither param, and `spec/error-model.md:45-48` requires prose to be derived
 *   from `code` and `params` alone, so printing `= 0` here would need a spec change.
 *
 * Three short sentences rather than one em-dashed run-on, matching every neighbouring message in
 * this package.
 */
function varNotVisibleMessage(name: string, procedure: string): string {
  return `:${name} is not defined inside ${procedure}. a procedure only sees its own inputs, the names it sets itself, and names declared global. the fix is one word at the top level: write global ${name} = (its starting value).`;
}

/**
 * The one diagnostic a failed read raises, or `undefined` when it raises none.
 *
 * The order of the three tests is the rule, not an implementation detail. The boundary is asked
 * **first**, so a misplaced `global` suppresses only the generic code and never the one whose whole
 * job is to name the fix (see {@link DocumentFacts.misplacedGlobals}).
 */
function failedReadDiagnostic(
  name: string,
  span: Diagnostic["source_span"],
  scope: Scope,
  facts: DocumentFacts,
): Diagnostic | undefined {
  const procedure = boundaryHiding(scope, name, facts);
  if (procedure !== undefined) {
    return {
      code: "ol-var-not-visible",
      source_span: span,
      params: { name, procedure },
      message: varNotVisibleMessage(name, procedure),
      stage: "semantic",
      severity: "error",
    };
  }
  if (facts.misplacedGlobals.has(name)) {
    return undefined;
  }
  return {
    code: "ol-undefined-var",
    source_span: span,
    params: { name },
    message: undefinedVarMessage(name),
    stage: "semantic",
    severity: "error",
  };
}

/** Resolves one read, pushing its diagnostic when it fails. */
function checkRead(
  name: string,
  span: Diagnostic["source_span"],
  scope: Scope,
  facts: DocumentFacts,
  diagnostics: Diagnostic[],
): void {
  const key = name.toLowerCase();
  if (isVisible(scope, key, facts)) {
    return;
  }
  const diagnostic = failedReadDiagnostic(key, span, scope, facts);
  if (diagnostic !== undefined) {
    diagnostics.push(diagnostic);
  }
}

/** Checks a `Place`'s base as a read (postfixed reads and segmented assignment-target bases). */
function checkBaseRead(
  place: PlaceNode,
  scope: Scope,
  facts: DocumentFacts,
  diagnostics: Diagnostic[],
): void {
  checkRead(place.base.name, place.base.source_span, scope, facts, diagnostics);
}

/** Enters a nested **block** scope: a control body, handler block, or comprehension/loop body. */
function enterBlockScope(
  parent: Scope,
  statements: readonly StatementNode[],
  seeds: readonly string[],
  facts: DocumentFacts,
): Scope {
  const enclosing = [parent.own, ...parent.enclosing];
  return {
    enclosing,
    own: collectScopeBindings(
      statements,
      seeds,
      enclosing,
      parent.procedure,
      facts.globals,
    ),
    boundSoFar: new Set(seeds),
    procedure: parent.procedure,
  };
}

/**
 * Enters a **procedure frame**. Its chain is `[frame, root]` whatever the definition is written
 * inside, because a `define` is registered in phase 1 and never captures the scope it appears in
 * (`spec/execution-model.md:651-655`).
 */
function enterProcedureFrame(
  node: ProcedureDefNode,
  facts: DocumentFacts,
): Scope {
  const enclosing = [facts.rootBindings];
  const procedure = node.name.name;
  const seeds = node.params.map((param) => param.name.name.toLowerCase());
  return {
    enclosing,
    own: collectScopeBindings(
      node.body.body,
      seeds,
      enclosing,
      procedure,
      facts.globals,
    ),
    boundSoFar: new Set(seeds),
    procedure,
  };
}

/**
 * Walks one scope's statements **in order**, resolving each statement's reads against the bindings
 * made so far and only then adding the ones that statement itself creates. That order is the whole
 * point: it is why `local x = :x` reads the *enclosing* `x` rather than the binding it is about to
 * create (`spec/execution-model.md:508-515`, issue #1102), and why the headline diagnostic lands on
 * the read rather than staying silent because a later write in the same block binds the name.
 */
function checkScope(
  statements: readonly StatementNode[],
  scope: Scope,
  facts: DocumentFacts,
  diagnostics: Diagnostic[],
): void {
  for (const statement of statements) {
    checkNode(statement, scope, facts, diagnostics);
    collectBindingsIn(
      statement,
      scope.boundSoFar,
      scope.enclosing,
      scope.procedure,
      facts.globals,
    );
  }
}

function checkNode(
  node: AnyNode,
  scope: Scope,
  facts: DocumentFacts,
  diagnostics: Diagnostic[],
): void {
  switch (node.kind) {
    case "VarRef":
      checkRead(node.name, node.source_span, scope, facts, diagnostics);
      return;
    case "Place":
      // Reached here (not via the Assign case below, which handles a Place assignment target
      // directly and never recurses generically into it), this Place is always a read of its
      // base — e.g. `print :missing.field` or `:nums[1]` used as a value.
      checkBaseRead(node, scope, facts, diagnostics);
      for (const segment of node.segments) {
        if (segment.kind === "index") {
          checkNode(segment.key, scope, facts, diagnostics);
        }
      }
      return;
    case "Local":
      // A declaration, never a read; its names join `boundSoFar` only once the whole statement has
      // been checked. Its optional initializer IS a read position, and is checked with exactly the
      // visibility the `local` statement itself has (`spec/execution-model.md:508-515`).
      if (node.value !== undefined) {
        checkNode(node.value, scope, facts, diagnostics);
      }
      return;
    case "Global":
      // Same split as `Local`: the declared name is a binding, and the required initializer is a
      // read position that runs before the declaration takes effect
      // (`spec/execution-model.md:571-574`).
      checkNode(node.value, scope, facts, diagnostics);
      return;
    case "Assign": {
      const target = node.place;
      if (target.kind === "Place") {
        if (target.segments.length > 0) {
          // Segmented target: the base must already be a bound variable — no intermediate
          // auto-vivification (`spec/execution-model.md:492-499`) — so it is checked as a read.
          checkBaseRead(target, scope, facts, diagnostics);
          for (const segment of target.segments) {
            if (segment.kind === "index") {
              checkNode(segment.key, scope, facts, diagnostics);
            }
          }
        }
        // A zero-segment target (`:name = value`) is never itself a read: a write-first touch of a
        // name the scope cannot see creates a binding here, silently and correctly, because it is a
        // genuinely different variable (`spec/execution-model.md:443-446`).
      } else {
        checkNode(target, scope, facts, diagnostics);
      }
      checkNode(node.value, scope, facts, diagnostics);
      return;
    }
    case "Block":
      checkScope(
        node.body,
        enterBlockScope(scope, node.body, [], facts),
        facts,
        diagnostics,
      );
      return;
    case "ProcedureDef": {
      const frame = enterProcedureFrame(node, facts);
      for (const param of node.params) {
        if (param.defaultValue !== undefined) {
          checkNode(param.defaultValue, frame, facts, diagnostics);
        }
      }
      checkScope(node.body.body, frame, facts, diagnostics);
      return;
    }
    case "ForIn": {
      checkNode(node.iterable, scope, facts, diagnostics);
      const body = node.body.body;
      checkScope(
        body,
        enterBlockScope(scope, body, binderNames(node.binder), facts),
        facts,
        diagnostics,
      );
      return;
    }
    case "ForRange": {
      checkNode(node.from, scope, facts, diagnostics);
      checkNode(node.to, scope, facts, diagnostics);
      if (node.by !== undefined) {
        checkNode(node.by, scope, facts, diagnostics);
      }
      const body = node.body.body;
      checkScope(
        body,
        enterBlockScope(scope, body, [node.variable.name.toLowerCase()], facts),
        facts,
        diagnostics,
      );
      return;
    }
    case "Comprehension": {
      checkNode(node.iterable, scope, facts, diagnostics);
      const seeds = binderNames(node.binder);
      if (node.form === "reduce") {
        checkNode(node.initial, scope, facts, diagnostics);
        // `reduce` has TWO binders: the element binder and the accumulator
        // (`spec/execution-model.md:769-776`). Modelling only the element wrongly flags the
        // accumulator as an outer read and breaks `spec/examples/12-fractal.logo`.
        seeds.push(node.accumulator.name.toLowerCase());
      }
      const body = node.body.body;
      checkScope(
        body,
        enterBlockScope(scope, body, seeds, facts),
        facts,
        diagnostics,
      );
      return;
    }
    case "Call":
    case "ParenCall": {
      const wordArg = thingCallArg(node);
      if (wordArg !== undefined) {
        checkRead(
          wordArg.value,
          wordArg.source_span,
          scope,
          facts,
          diagnostics,
        );
      }
      for (const child of childrenOf(node)) {
        checkNode(child, scope, facts, diagnostics);
      }
      return;
    }
    default:
      for (const child of childrenOf(node)) {
        checkNode(child, scope, facts, diagnostics);
      }
  }
}

/**
 * The name-resolution rule: every read whose name resolves against no visible scope raises one
 * diagnostic at that read's own span — `ol-var-not-visible` when the sealed procedure boundary is
 * the reason, `ol-undefined-var` otherwise. See the module doc comment.
 *
 * It takes no profile set. Which names a scope binds is a property of the grammar and the scoping
 * ruling, not of the profiles a run claims, so the findings are identical along the whole profile
 * DAG — the trap documented in issue #814.
 */
export function undefinedVarRule(
  program: ProgramNode,
  _profiles?: readonly CheckProfile[],
): readonly Diagnostic[] {
  const facts = documentFactsOf(program);
  const diagnostics: Diagnostic[] = [];
  checkScope(
    program.body,
    {
      enclosing: [],
      own: facts.rootBindings,
      boundSoFar: new Set<string>(),
      procedure: undefined,
    },
    facts,
    diagnostics,
  );
  return diagnostics;
}
