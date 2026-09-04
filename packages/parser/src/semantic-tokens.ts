/**
 * The LSP `textDocument/semanticTokens`-shaped contract (issue #121) layered over
 * {@link highlight}'s token-class + delimiter-role output — the "Informative LSP-style editor
 * integration" section of `spec/tooling.md:277-283`. It never re-lexes or re-classifies: every
 * {@link SemanticToken} carries {@link highlight}'s own `class`/`text`/`source_span`/`role`
 * unchanged, plus a `modifiers` array populated from that section's modifier vocabulary —
 * `declaration`, `reference`, `readonly`, `defaultLibrary`, `listRole`, `blockRole`, and
 * `selectorRole` — **plus one extension of our own, `global`** (issue #826). That section lists its
 * seven "optional modifiers **such as** …", so the vocabulary is open rather than exact; see
 * {@link OL_TOKEN_MODIFIERS} for why the eighth is there. Owned by `@language-designer`; consumed
 * by the studio editor/LSP successor (`packages/studio`) and any external editor integration.
 * **Nothing in this repository renders `global` yet** — `packages/studio` maps token *class* to CSS
 * and drops every other field, exactly as it already drops `role` — so the modifier is a contract
 * for a consumer, not a visible change; issue #1106 is the studio slice that renders it.
 *
 * Modifier derivation, by class:
 *  - `procedure-name` / `type-name` / `field-name` — {@link highlight} already resolves each of
 *    these to either its binding site (`define`/`struct` header) or a use site (call/field
 *    access), recorded on {@link Token.declaration}; this module reads that flag straight
 *    through as `declaration` or `reference`. No re-analysis needed.
 *  - `:variable` — the only binding site the AST can resolve directly is a procedure's own
 *    `:param` (`highlight.ts`'s `paramDeclIndexes`, exposed the same way via `declaration`);
 *    every other `:variable` token is a `reference` (a read, or an assignment/place target).
 *    `local`/`for`/comprehension binders parse as bare `name` tokens, or — for a destructuring
 *    `[ :x :y ]` pattern (`spec/grammar.md:137-138`) — as `:variable` tokens with no dedicated
 *    binding-site resolution here (see `ast.ts`'s `Binder`), so a destructured name's own `:x`
 *    token still surfaces only as a `reference`, never a `declaration`.
 *  - `:variable` reads of a `map`/`filter`/`reduce` binder or `reduce` accumulator inside that
 *    comprehension's own body additionally get `readonly`: a comprehension body is a bracketed
 *    *expression*-block only (`spec/execution-model.md`: "Comprehension bodies are bracketed
 *    expression-blocks only"), so no `set`/`=` assignment statement can ever appear there — the
 *    binder is provably never reassigned within that scope. This is a positional, name-matching
 *    heuristic (like `highlight.ts`'s own field-name resolution): it does not model nested
 *    same-named shadowing, which the spec's "MAY defer … precision" allowance (`tooling.md:66-68`)
 *    permits, and does not change the correctness of the modifier for the common (non-shadowed)
 *    case, since a nested comprehension that re-shadows the name would itself just as validly
 *    mark those inner reads `readonly` again for its own binder.
 *  - `primitive` — every Core primitive/alias call is a call into the standard library, so it
 *    always gets `defaultLibrary` (`tooling.md:279`'s literal example).
 *  - `:variable` occurrences that resolve to a name the program declared `global` get `global`
 *    (issue #826) — read straight through from {@link Token.global}, which `highlight.ts` resolves
 *    with a scope-aware walk (`global-variable-resolution.ts`). This is the modifier that lets a
 *    reader tell `:private = 1` from `:shared = 1` at the assignment site, the one case
 *    `spec/execution-model.md:441-446` rules is correct and therefore never diagnoses. It follows
 *    **resolution, not spelling**: a `local` shadowing a global does not carry it.
 *  - any class — a `[`/`]` carrying {@link Token.role} `"list"`, `"instruction-block"`, or
 *    `"selector"` gets `listRole`, `blockRole`, or `selectorRole` respectively; `"pattern"` and
 *    `"field-list"` have no named LSP modifier in `tooling.md:278-280` and so contribute none.
 *  - every other class (`keyword`, `number`, `word/string`, `comment`, `bracket`, `brace`,
 *    `paren`, `operator`, `index/dot`, `dict-key`) gets no declaration/reference/readonly
 *    modifier — there is no binding/use distinction for a literal, delimiter, or operator.
 */

import type { Position } from "@openlogo/core";
import type { AnyNode, Binder, ProgramNode } from "./ast.js";
import { walk } from "./ast.js";
import { parse } from "./parser.js";
import type {
  BracketRole,
  HighlightOptions,
  Token,
  TokenClass,
} from "./highlight.js";
import { assertDocumentArgument, highlight } from "./highlight.js";

/**
 * The LSP-style semantic-token modifiers this parser emits: the seven from `spec/tooling.md:281-283`
 * in the document's own order, then `global` (issue #826).
 *
 * `global` is an **extension**, and a permitted one: that section is Informative and lists its seven
 * "optional modifiers **such as** …", so the list is open. It is appended **last** on purpose — the
 * seven keep their positions, so a consumer that encodes a modifier as a bit index is unaffected.
 *
 * It carries the one thing a learner cannot otherwise see — whether a `:name` inside a procedure
 * reaches shared state or creates a private binding — on the modifier channel rather than as a
 * sixteenth token class, following `spec/tooling.md:83-84`'s own treatment of the five bracket
 * roles: one lexical class, the grammar-derived sub-distinction exposed "as semantic-token
 * modifiers where possible, even when the visible theme maps all roles to the same bracket color".
 * The normative 15-class table is therefore unchanged, and `spec/` is untouched. ADR-0032 records
 * that decision, its limits, and the acceptance-criterion wording it supersedes.
 */
export const OL_TOKEN_MODIFIERS = [
  "declaration",
  "reference",
  "readonly",
  "defaultLibrary",
  "listRole",
  "blockRole",
  "selectorRole",
  "global",
] as const;

/** One LSP-style semantic-token modifier. */
export type TokenModifier = (typeof OL_TOKEN_MODIFIERS)[number];

/** A classified token plus its LSP-style semantic-token modifiers. */
export interface SemanticToken extends Token {
  readonly modifiers: readonly TokenModifier[];
}

/** Token classes with a decidable declaration/reference split (see the module doc comment). */
const DECLARABLE_CLASSES: ReadonlySet<TokenClass> = new Set([
  "procedure-name",
  "type-name",
  "field-name",
  ":variable",
]);

/** Bracket roles with a named LSP modifier (`"pattern"`/`"field-list"` have none). */
const ROLE_MODIFIERS: Readonly<Partial<Record<BracketRole, TokenModifier>>> = {
  list: "listRole",
  "instruction-block": "blockRole",
  selector: "selectorRole",
};

/** `"line:column"` — a stable map/set key for a `Position` tuple (mirrors `highlight.ts`). */
function posKey(position: Position): string {
  return `${position[0]}:${position[1]}`;
}

/**
 * Classify `source` into a flat, source-ordered `SemanticToken[]` — {@link highlight}'s token
 * stream with LSP-style modifiers layered on top. Never throws on malformed input, matching
 * {@link highlight}'s own never-throw contract.
 *
 * `document` is **required** for the same reason it is on {@link highlight}: it keeps an options
 * object out of that slot statically, and {@link assertDocumentArgument} rejects one at runtime.
 * The guard is called here rather than left to the delegated {@link highlight} call so the
 * `TypeError` names the function the caller actually invoked.
 */
export function semanticTokens(
  source: string,
  document: string,
  options: HighlightOptions = {},
): SemanticToken[] {
  assertDocumentArgument(document, "semanticTokens");
  const tokens = highlight(source, document, options);
  const program = parse(source, document).ast;
  const readonlyReads = collectComprehensionBinderReads(program);
  return tokens.map((token) => ({
    ...token,
    modifiers: modifiersFor(token, readonlyReads),
  }));
}

function modifiersFor(
  token: Token,
  readonlyReads: ReadonlySet<string>,
): TokenModifier[] {
  const modifiers: TokenModifier[] = [];
  if (token.class === "primitive") {
    // KNOWN DEVIATION (#831): `spec/tooling.md:31` makes `primitive` the grammar-safe **fallback**
    // for any bare name no other row claims, and says that fallback "is not a claim of matrix
    // membership, and tools MUST NOT infer one from it". This branch infers exactly that, so an
    // unresolved name (`fowad`, `zzz`) or a contextual word outside its structural positions
    // (`local empty`) is decorated `defaultLibrary` despite being in no C3 table. Narrowing this to
    // confirmed built-ins is #831's; the fallback CLASS itself is now normative and correct.
    modifiers.push("defaultLibrary");
  }
  const roleModifier =
    token.role === undefined ? undefined : ROLE_MODIFIERS[token.role];
  if (roleModifier !== undefined) {
    modifiers.push(roleModifier);
  }
  if (DECLARABLE_CLASSES.has(token.class)) {
    modifiers.push(token.declaration === true ? "declaration" : "reference");
  }
  if (
    token.class === ":variable" &&
    readonlyReads.has(posKey(token.source_span.start))
  ) {
    modifiers.push("readonly");
  }
  if (token.global === true) {
    modifiers.push("global");
  }
  return modifiers;
}

/**
 * The lowercase name(s) a comprehension binder introduces: one for a bare `name`, or one per
 * `:name` in a destructuring `[ :x :y ]` pattern (`spec/grammar.md:137-138`, mirroring
 * `checker-undefined-var.ts`'s own `binderNames` helper for `for … in`/comprehension binders).
 */
function namesOf(binder: Binder): string[] {
  return "kind" in binder
    ? binder.names.map((name) => name.name.toLowerCase())
    : [binder.name.toLowerCase()];
}

/**
 * Every `:name` read (a `VarRef`, or a `Place`'s base) inside a `map`/`filter`/`reduce`
 * comprehension's own body that spells the same name as one of that comprehension's binder
 * names (a bare binder, or each name in a destructuring `[ :x :y ]` pattern) or, for `reduce`,
 * its accumulator — see the module doc comment for why that makes the read `readonly`.
 */
function collectComprehensionBinderReads(program: ProgramNode): Set<string> {
  const reads = new Set<string>();
  walk(program, (node: AnyNode) => {
    if (node.kind !== "Comprehension") {
      return;
    }
    const binderNames = new Set<string>(namesOf(node.binder));
    if (node.form === "reduce") {
      binderNames.add(node.accumulator.name.toLowerCase());
    }
    walk(node.body, (inner: AnyNode) => {
      if (
        inner.kind === "VarRef" &&
        binderNames.has(inner.name.toLowerCase())
      ) {
        reads.add(posKey(inner.source_span.start));
      } else if (
        inner.kind === "Place" &&
        binderNames.has(inner.base.name.toLowerCase())
      ) {
        reads.add(posKey(inner.base.source_span.start));
      }
    });
  });
  return reads;
}
