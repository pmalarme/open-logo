/**
 * Which `:name` occurrences resolve to a binding the program declared `global` (issue #826).
 *
 * `spec/execution-model.md:389-394` seals a procedure's edge: inside a procedure body only its
 * parameters, the names its body has already bound, and names declared `global` are visible.
 * `:441-446` records the readability cost the maintainer's ruling deliberately accepted — when a
 * procedure's first touch of a name it cannot see is a **write**, it silently creates a
 * procedure-local, "which is correct, because that is a genuinely different variable" and so is
 * *not* diagnosed. Nothing in the diagnostic layers reaches that case, which is why the reader
 * needs it in the paint: `:private = 1` and `:shared = 1` sit side by side in one body and mean
 * entirely different things.
 *
 * This module answers one question — *does this occurrence resolve to a `global` binding?* — and
 * `highlight.ts` attaches the answer to each variable-naming token as `Token.global`, which
 * `semantic-tokens.ts` surfaces as the `global` semantic-token modifier. It is the **modifier**
 * channel rather than a sixteenth token class, on `spec/tooling.md`'s own precedent for a
 * grammar-derived sub-distinction: brackets have **five** grammatical roles spread over just **two**
 * classes — a selector's `[`/`]` is `index/dot`, not `bracket` (`spec/tooling.md:36,40`) — and the
 * spec gives none of the five a class of its own, directing them instead to be exposed "as
 * semantic-token modifiers where possible, even when the visible theme maps all roles to the same
 * bracket color" (`spec/tooling.md:83-84`), with `listRole`/`blockRole`/`selectorRole` named in the
 * LSP list (`:281-283`) as the vehicle. The normative 15-class table is unchanged and `spec/` is
 * untouched; ADR-0032 records the decision and its limits.
 *
 * ## The class follows resolution, not spelling
 *
 * That is the whole point of the analysis, and it is why this is an AST walk rather than a name
 * match. A name declared `global` is painted global only where it is *not shadowed*, so the
 * `local count` in `spec/execution-model.md:530-543`'s own example — which prints `5` then `0` —
 * reads as an ordinary variable while the top-level `:count` beside it reads as shared.
 *
 * Three groups of binding shadow a global, all of them scoped:
 *
 *  - **A procedure's parameters**, for its whole body: a parameter is bound when the frame is
 *    created, before any statement runs (`spec/execution-model.md:365-366`).
 *  - **A `for`/`map`/`filter`/`reduce` binder** (and `reduce`'s accumulator), for that body only,
 *    including each `:name` of a destructuring `[ :x :y ]` pattern (`spec/grammar.md:139-140`).
 *  - **`local`, from its own statement onward**, for the rest of the scope it is written in —
 *    `spec/execution-model.md:398-399`, "a binding a scope creates for itself is visible from the
 *    point the statement that creates it has run". A `local`'s **initializer** is therefore
 *    resolved *before* the shadow exists, which is exactly `:508-515`: `local count = :count + 1`
 *    reads "whatever `count` the statement could already see", so its `:count` still paints
 *    global. (`checker-undefined-var.ts` models frames as an order-free set and gets that case
 *    wrong — issue #1102. A per-statement scope is the fix there and is what this module already
 *    is, so the two must not be merged into one model until #1102 lands.)
 *
 * Two things deliberately do **not** shadow:
 *
 *  - **`local` at the root scope.** `spec/execution-model.md:520-526`: there is no enclosing scope
 *    to shadow into, so `local` names the root scope's own binding, and where that binding is
 *    already `global` it "leaves it global". A root `local count` after `global count = 0` keeps
 *    every later `:count` painted global — anything else would tell the reader a shared name had
 *    become private when it had not. A `local` inside a *block* at the root is a different case:
 *    a block scope is not the root scope, so it shadows normally.
 *  - **An assignment.** A `global` name is visible everywhere it is not shadowed, so an assignment
 *    updates that binding rather than creating one (`spec/execution-model.md:483-487`,
 *    "Visibility decides which binding an assignment reaches, never statement order"). A write is
 *    an occurrence to paint, never a shadow.
 *
 * ## What counts as a declaration, and what counts as an occurrence
 *
 * A name is global when a `Global` node is a **direct element of `program.body`** — the root scope,
 * exactly as `checker-global-placement.ts` reads `spec/execution-model.md:361-369`. A misplaced
 * `global` is `ol-global-outside-root` (`spec/execution-model.md:561-563`) and declares nothing, so
 * it paints nothing; painting from it would tell the reader that a rejected declaration had taken
 * effect.
 *
 * An **occurrence** here is a **use** of a variable name — a token that *resolves* an existing name,
 * never one that introduces it. Uses come in three token shapes, and they are marked on whatever
 * class each already carries, because a **modifier decorates a class rather than replacing it**.
 * That is the whole reason this works without a `spec/` change, and an earlier revision of this
 * slice got it wrong: it declined the worded forms on the grounds that they are not `:variable`
 * tokens, which is true and irrelevant.
 *
 *  - a bare `VarRef` read and the **base** of a `Place` — `:count`, `:people.tom`, and the target of
 *    `:count = 1` — all `variable`-kind tokens, classed `:variable`;
 *  - a `set` target's **bare place head**: `set-assignment ::= "set" bare-place "to" expression`
 *    (`spec/grammar.md:107`) — a `name`-kind token;
 *  - a `make` target's **word literal**: `make-assignment ::= "make" word-literal expression`
 *    (`spec/grammar.md:108`) — and a `thing "name"` read, both `word`-kind tokens.
 *
 * The last two are not classed `:variable`, and do not need to be. A bare place head takes the
 * grammar-safe fallback at `spec/tooling.md:31`, because `:34` gives `:variable` to *colon-form*
 * place heads only; a word literal is `word/string`. Marking one classifies nothing *inside* the
 * string, so `spec/tooling.md:25-26`'s MUST NOT — that tokens inside closed strings are never
 * *classified* as variables — is untouched: the literal keeps its class and gains a modifier.
 *
 * All three assignment spellings "resolve the same way" (`spec/execution-model.md:478-481`), so the
 * paint agrees with the language rather than with the lexer. **What remains open is the class, not
 * the resolution:** whether a bare place head or a binder spelling should carry a variable-ish class
 * at all is a `spec/` question covering every binding form at once — issue #1107, and #826's review
 * is where both halves of it were separated.
 *
 * A **binding site is never an occurrence**, and that is the one deliberate exclusion: `global
 * count = 0`, `local count`, and a `for`/comprehension binder all write a bare name, but those
 * tokens *introduce* a binding rather than resolve one — the same reason a procedure's `:param`
 * binding site is not a use either. (The `:param` still carries `false` rather than nothing, because
 * the field is total on `:variable`; the bare ones carry nothing at all. That asymmetry is
 * `Token.global`'s own contract, stated there.) Everything else is reached by the generic descent,
 * which is why a `Global`/`Local` node needs no arm of its own: its one walkable child is the
 * initializer, an ordinary read position, and its declared name is `SpannedName` metadata rather
 * than a node.
 *
 * Declaration-order is not consulted for the *global* itself: a name any root-level `global`
 * declares is painted global at every unshadowed occurrence in the document, including one written
 * above the declaration line. That is the same lexical, whole-document reading
 * `spec/execution-model.md:405-408` gives `ol-var-not-visible` ("whether or not that binding has
 * been created by the time the read executes"). A read that *runs* before the declaration is an
 * ordinary `ol-undefined-var` (`:571-574`) — a runtime-order fact the checker reports and the
 * paint does not restate.
 *
 * ## The one case a static paint cannot decide: a deferred handler body
 *
 * A handler block (`when`/`every`/`on_key`/`on_click`) is walked exactly like an inline block: the
 * shadows in force are the ones its *registration* position can see. That is a **decision, not an
 * oversight**, and it is knowingly incomplete, because `spec/execution-model.md:401-403` gives a
 * deferred handler a different rule from an inline block — an enclosing scope's binding is visible
 * to an inline block "from that block's own position", but to a handler block "whenever the handler
 * fires". So in
 *
 * ```logo
 * global shared = 0
 * define setup
 *   on_click [ print :shared ]
 *   local shared = 7
 * end
 * ```
 *
 * a click **after** `setup` returns resolves `:shared` to the retained procedure-local, while a
 * click that somehow arrived between the two statements would resolve it to the global. One token,
 * two resolutions, decided by an event time no static pass can know — so no static class is right
 * in both, and painting global is the reading that matches the registration site the learner is
 * looking at. The alternative (treat a handler body as seeing every `local` of its enclosing scope,
 * wherever written) is equally defensible and equally wrong half the time. It is pinned by a test
 * so the choice cannot drift silently, and referred to the maintainer for a ruling in issue #1108;
 * `rubber-duck` raised it in this slice's round-1 review, which is where the two readings were first
 * written down side by side.
 */

import type { Position } from "@openlogo/core";
import type {
  AnyNode,
  Binder,
  BlockNode,
  CallNode,
  ExpressionNode,
  ParenCallNode,
  ProcedureDefNode,
  ProgramNode,
  StatementNode,
  WordLitNode,
} from "./ast.js";
import { childrenOf } from "./ast.js";

/**
 * The lowercase name(s) a `for … in` / comprehension binder introduces: one for a bare `name`, or
 * one per `:name` in a destructuring `[ :x :y ]` pattern (`spec/grammar.md:139-140` —
 * `binder ::= name | destructuring-pattern` and the pattern's own production). Mirrors
 * `checker-undefined-var.ts`'s helper of the same shape; every destructured name simply shadows
 * throughout the body, since resolving which one a read maps to is not decidable here.
 */
function binderNames(binder: Binder): string[] {
  return "kind" in binder
    ? binder.names.map((name) => name.name.toLowerCase())
    : [binder.name.toLowerCase()];
}

/**
 * The names that shadow a global at one point in the walk. A `Set` rather than a stack because a
 * shadow only ever needs answering as a yes/no at an occurrence, and because each scope gets a
 * **copy** on entry: a `local` added inside a block or a procedure body can then never leak back
 * out to the statements that follow the scope it was written in.
 */
type ShadowedNames = ReadonlySet<string>;

/**
 * One token that **uses** a variable name, and whether that name resolves to a `global` binding.
 * A binding site — a bare declared name, a binder — is not a use and is never reported here.
 * Positions rather than a key format, so no caller has to share this module's idea of how a
 * `Position` is spelled as a map key.
 */
export interface VariableOccurrence {
  /** Where the naming token starts — a `:name`, a bare place head, or a word literal. */
  readonly position: Position;
  /** `true` when the name resolves to a binding a root-level `global` declaration made. */
  readonly global: boolean;
}

/** Everything one walk needs that does not change between nodes. */
interface Resolution {
  readonly globals: ReadonlySet<string>;
  readonly found: VariableOccurrence[];
}

/**
 * Every name a root-level `global` declaration binds, lowercased. Only `program.body`'s own direct
 * elements are the root scope — see the module doc comment.
 */
function collectRootGlobals(program: ProgramNode): ReadonlySet<string> {
  const globals = new Set<string>();
  for (const statement of program.body) {
    if (statement.kind === "Global") {
      globals.add(statement.name.name.toLowerCase());
    }
  }
  return globals;
}

/**
 * Record `position` as a variable occurrence, `global` when `name` is a global that nothing shadows
 * here. Every occurrence is recorded, not only the global ones, so a consumer can tell "a use that
 * is not shared" from "a token this walk reported no use for".
 *
 * Which scope the occurrence sits in is irrelevant to the decision — a global reads the same from
 * the root scope, a block, and a procedure body, which is what "with no further ceremony at the
 * point of assignment" (`spec/execution-model.md:565-569`) means.
 */
function markOccurrence(
  name: string,
  position: Position,
  shadowed: ShadowedNames,
  resolution: Resolution,
): void {
  const lower = name.toLowerCase();
  resolution.found.push({
    position,
    global: resolution.globals.has(lower) && !shadowed.has(lower),
  });
}

/**
 * The `WordLit` a `thing "name"` call reads a variable through — the one call form whose literal
 * argument statically names a variable (`spec/commands.md`'s `thing`, and the sugar rule at
 * `spec/execution-model.md:347-349`, "Reading `:name` is sugar for `thing \"name\"`"). Mirrors
 * `checker-undefined-var.ts`'s `thingCallArg`, which resolves the same form for `ol-undefined-var`.
 */
function thingCallArgument(
  node: CallNode | ParenCallNode,
): WordLitNode | undefined {
  if (node.callee.name.toLowerCase() !== "thing" || node.args.length !== 1) {
    return undefined;
  }
  // `args.length === 1` guarantees index 0 is populated; `noUncheckedIndexedAccess` cannot
  // correlate a `.length` check with indexed access, so this documents the invariant rather than
  // adding a branch whose "undefined" arm could never be taken (the shape `checker-undefined-var.ts`
  // uses for the identical lookup, and for the same 100%-coverage reason).
  const argument = node.args[0] as ExpressionNode;
  return argument.kind === "WordLit" ? argument : undefined;
}

/**
 * Walk one scope's statement list in source order, growing `shadowed` as each `local` passes.
 *
 * `atRoot` distinguishes the one scope where `local` does not shadow (`program.body`) from every
 * other statement list, all of which are block scopes or procedure bodies.
 */
function visitStatements(
  statements: readonly StatementNode[],
  shadowed: ShadowedNames,
  atRoot: boolean,
  resolution: Resolution,
): void {
  let current = shadowed;
  for (const statement of statements) {
    if (statement.kind === "Local") {
      // The initializer is resolved against the scope as it stands *before* the declaration takes
      // effect (`spec/execution-model.md:508-515`), so it is visited with `current` unchanged.
      if (statement.value !== undefined) {
        visitNode(statement.value, current, resolution);
      }
      if (!atRoot) {
        const next = new Set(current);
        for (const name of statement.names) {
          next.add(name.name.toLowerCase());
        }
        current = next;
      }
      continue;
    }
    visitNode(statement, current, resolution);
  }
}

/** A block opens a scope of its own; `local` inside it never escapes past its closing delimiter. */
function visitBlock(
  block: BlockNode,
  shadowed: ShadowedNames,
  resolution: Resolution,
): void {
  visitStatements(block.body, shadowed, false, resolution);
}

/**
 * A procedure body is a sealed scope whose parameters are bound before any statement runs, so they
 * shadow a same-named global throughout — and **nothing the enclosing scope shadowed carries in**,
 * because a procedure sees only its own parameters, its own bindings, and the globals
 * (`spec/execution-model.md:389-394`). The walk therefore restarts from the parameters alone, which
 * is why this takes no enclosing shadow set at all. That seal holds for a `define` written inside a
 * block. `spec/execution-model.md:651-652` states the neighbouring case — a `define` written inside a
 * **procedure body** "is registered globally in Phase 1 like any other declaration … and therefore
 * does not capture the frame it appears in" — and a `define` inside a *block* is the same shape of
 * declaration, so the seal is asserted by test rather than left to that citation to carry.
 *
 * An optional parameter's default (`(:step 2)`, `spec/grammar.md:152`) binds **incrementally**: when
 * a default is resolved, only the parameters *before* it are bound. The spec does not say which
 * scope evaluates a default, so this follows the runtime, which is the authority the spec leaves the
 * question to — `packages/runtime/src/execute-internal.ts` evaluates each omitted optional's default
 * "in the callee frame, once its earlier (already-bound) siblings are in place". A default naming a
 * *later* same-named parameter therefore reaches past it to the global, rather than being painted
 * private by a binding that does not exist yet. (`checker-undefined-var.ts` pre-binds the whole
 * parameter set, so the two differ in exactly that case; the runtime evidence is why the paint does
 * not copy it. Issue #826 review, round 1.)
 */
function visitProcedureDef(
  node: ProcedureDefNode,
  resolution: Resolution,
): void {
  const bound = new Set<string>();
  for (const parameter of node.params) {
    if (parameter.defaultValue !== undefined) {
      visitNode(parameter.defaultValue, bound, resolution);
    }
    bound.add(parameter.name.name.toLowerCase());
  }
  visitStatements(node.body.body, bound, false, resolution);
}

function withNames(
  shadowed: ShadowedNames,
  names: readonly string[],
): ShadowedNames {
  const next = new Set(shadowed);
  for (const name of names) {
    next.add(name);
  }
  return next;
}

function visitNode(
  node: AnyNode,
  shadowed: ShadowedNames,
  resolution: Resolution,
): void {
  switch (node.kind) {
    case "VarRef":
      markOccurrence(node.name, node.source_span.start, shadowed, resolution);
      return;
    case "Place":
      // The base is the one token that NAMES the variable — a `:name` for a colon place, the bare
      // name of a `set` target, or the whole word literal of a `make` target, since all three build
      // this node (`spec/grammar.md:106-111`). Read or written, the occurrence resolves the same
      // way. Segment keys are ordinary expressions.
      markOccurrence(
        node.base.name,
        node.base.source_span.start,
        shadowed,
        resolution,
      );
      for (const segment of node.segments) {
        if (segment.kind === "index") {
          visitNode(segment.key, shadowed, resolution);
        }
      }
      return;
    case "Block":
      visitBlock(node, shadowed, resolution);
      return;
    case "ProcedureDef":
      visitProcedureDef(node, resolution);
      return;
    case "ForIn":
      visitNode(node.iterable, shadowed, resolution);
      visitBlock(
        node.body,
        withNames(shadowed, binderNames(node.binder)),
        resolution,
      );
      return;
    case "ForRange": {
      visitNode(node.from, shadowed, resolution);
      visitNode(node.to, shadowed, resolution);
      if (node.by !== undefined) {
        visitNode(node.by, shadowed, resolution);
      }
      visitBlock(
        node.body,
        withNames(shadowed, [node.variable.name.toLowerCase()]),
        resolution,
      );
      return;
    }
    case "Comprehension": {
      visitNode(node.iterable, shadowed, resolution);
      const names = binderNames(node.binder);
      if (node.form === "reduce") {
        visitNode(node.initial, shadowed, resolution);
        names.push(node.accumulator.name.toLowerCase());
      }
      visitBlock(node.body, withNames(shadowed, names), resolution);
      return;
    }
    case "Call":
    case "ParenCall": {
      const wordArgument = thingCallArgument(node);
      if (wordArgument !== undefined) {
        markOccurrence(
          wordArgument.value,
          wordArgument.source_span.start,
          shadowed,
          resolution,
        );
      }
      for (const child of childrenOf(node)) {
        visitNode(child, shadowed, resolution);
      }
      return;
    }
    default:
      for (const child of childrenOf(node)) {
        visitNode(child, shadowed, resolution);
      }
  }
}

/**
 * Every token that **uses** a variable name, in source order, each with whether it resolves to a
 * `global` binding — see {@link VariableOccurrence} and the module doc comment. A binding site is
 * not a use and is not reported.
 *
 * Total on any AST `parse()` can produce, including a partial one from malformed source: an
 * unparsed region simply contributes no nodes, so it contributes no occurrences and never throws —
 * which is what keeps `highlight.ts`'s own never-throw contract intact.
 *
 * There is deliberately **no fast path for a document with no `global` declaration**. It would be
 * one comparison, and it would silently drop every `false` — which is the answer a consumer needs to
 * tell "a use that is not shared" from "no use reported here", on the most common document shape
 * there is (issue #826 review, round 3).
 */
export function resolveVariableOccurrences(
  program: ProgramNode,
): readonly VariableOccurrence[] {
  const resolution: Resolution = {
    globals: collectRootGlobals(program),
    found: [],
  };
  visitStatements(program.body, new Set<string>(), true, resolution);
  return resolution.found;
}
