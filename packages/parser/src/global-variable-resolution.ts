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
 * `highlight.ts` attaches the answer to each `:variable` token as `Token.global`, which
 * `semantic-tokens.ts` surfaces as the `global` semantic-token modifier. It is the **modifier**
 * channel rather than a sixteenth token class, on `spec/tooling.md`'s own precedent for a
 * grammar-derived sub-distinction over one lexical class: brackets have five grammatical roles and
 * keep a single `bracket` class, exposed "as semantic-token modifiers where possible, even when the
 * visible theme maps all roles to the same bracket color" (`spec/tooling.md:83-84`), with
 * `listRole`/`blockRole`/`selectorRole` named in the LSP list (`:281-283`) as the vehicle. The
 * normative 15-class table is unchanged and `spec/` is untouched.
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
 * The occurrences are the `:name` forms the lexer emits as one `variable` token: a bare `VarRef`
 * read, and the **base** of a `Place` — which covers a postfixed read
 * (`:people.tom`), a postfixed write, and a bare `:name = value` write alike. Everything else is
 * reached by the generic descent, which is why a `Global`/`Local` node needs no arm of its own: its
 * one walkable child is exactly the initializer, an ordinary read position, and its declared name
 * is `SpannedName` metadata rather than a node (`ast.ts`'s `childrenOf`).
 *
 * **That is every `:name`, which is not every mention of the name — and the difference is the
 * spec's, not this module's.** Three sibling spellings carry no signal, each because
 * `spec/tooling.md`'s class table already gives its token a different class:
 *
 *  - `set shared to 1` — `set-assignment ::= "set" bare-place "to" expression`
 *    (`spec/grammar.md:107`). The target is a **bare** name, and `spec/tooling.md:34` gives
 *    `:variable` to a "colon-prefixed variable read or **colon-form** assignable place head" only,
 *    so a bare place head falls to `:31`'s grammar-safe `primitive` fallback.
 *  - `make "shared" 1` — the name is inside a closed word literal, and `spec/tooling.md:25-26` is a
 *    MUST NOT: tokens inside closed `"..."` strings are never classified as variables. The same
 *    sentence is why `thing "shared"` carries nothing either.
 *  - `global shared = 0` and `local shared` — a declaration writes its name bare, so it is a `name`
 *    token taking the same `primitive` fallback `local` already gave it.
 *
 * Marking any of them would mean deciding a paint for bare place heads and binder spellings that
 * the normative table does not assign — a `spec/` question for the maintainer, and one that reaches
 * every binding form at once rather than `global` alone. It is issue #1107, raised by `rubber-duck`
 * in this slice's round-1 review. Until it is ruled, this module claims exactly what it delivers:
 * every **`:name` occurrence**, read or written, and nothing wider.
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
  ProcedureDefNode,
  ProgramNode,
  StatementNode,
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

/** Everything one walk needs that does not change between nodes. */
interface Resolution {
  readonly globals: ReadonlySet<string>;
  readonly found: Position[];
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
 * Record `position` as a global occurrence when `name` is a global that nothing shadows here.
 * `atRoot` is irrelevant to the decision — a global reads the same from the root scope, a block,
 * and a procedure body, which is what "with no further ceremony at the point of assignment"
 * (`spec/execution-model.md:565-569`) means.
 */
function markOccurrence(
  name: string,
  position: Position,
  shadowed: ShadowedNames,
  resolution: Resolution,
): void {
  const lower = name.toLowerCase();
  if (resolution.globals.has(lower) && !shadowed.has(lower)) {
    resolution.found.push(position);
  }
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
 * block, which is reachable and asserted (`spec/execution-model.md:651` registers it globally).
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
      // The base is the one `:name` token of a place — read or written, the occurrence is the same
      // token and resolves the same way. Segment keys are ordinary expressions.
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
    default:
      for (const child of childrenOf(node)) {
        visitNode(child, shadowed, resolution);
      }
  }
}

/**
 * The start position of every `:name` occurrence that resolves to a `global` binding, in source
 * order. Positions rather than a key format, so no caller has to share this module's idea of how a
 * `Position` is spelled as a map key.
 *
 * Total on any AST `parse()` can produce, including a partial one from malformed source: an
 * unparsed region simply contributes no nodes, so it contributes no occurrences and never throws —
 * which is what keeps {@link highlight}'s own never-throw contract intact.
 */
export function resolveGlobalVariableOccurrences(
  program: ProgramNode,
): readonly Position[] {
  const resolution: Resolution = {
    globals: collectRootGlobals(program),
    found: [],
  };
  if (resolution.globals.size === 0) {
    return resolution.found;
  }
  visitStatements(program.body, new Set<string>(), true, resolution);
  return resolution.found;
}
