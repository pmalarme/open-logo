/**
 * The LSP `textDocument/semanticTokens`-shaped contract (issue #121) layered over
 * {@link highlight}'s token-class + delimiter-role output — the "Informative LSP-style editor
 * integration" section of `spec/tooling.md:272-278`. It never re-lexes or re-classifies: every
 * {@link SemanticToken} carries {@link highlight}'s own `class`/`text`/`source_span`/`role`
 * unchanged, plus a `modifiers` array populated from that section's exact modifier vocabulary —
 * `declaration`, `reference`, `readonly`, `defaultLibrary`, `listRole`, `blockRole`, and
 * `selectorRole`. Owned by `@language-designer`; consumed by the studio editor/LSP successor
 * (`packages/studio`) and any external editor integration.
 *
 * Modifier derivation, by class:
 *  - `procedure-name` / `type-name` / `field-name` — {@link highlight} already resolves each of
 *    these to either its binding site (`define`/`struct` header) or a use site (call/field
 *    access), recorded on {@link Token.declaration}; this module reads that flag straight
 *    through as `declaration` or `reference`. No re-analysis needed.
 *  - `:variable` — the only binding site the AST can resolve directly is a procedure's own
 *    `:param` (`highlight.ts`'s `paramDeclIndexes`, exposed the same way via `declaration`);
 *    every other `:variable` token is a `reference` (a read, or an assignment/place target).
 *    `local`/`for`/comprehension binders parse as bare `name` tokens (see `ast.ts`), so they
 *    never surface as `:variable` tokens at all — there is nothing else to resolve here.
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
 *    always gets `defaultLibrary` (`tooling.md:277`'s literal example).
 *  - any class — a `[`/`]` carrying {@link Token.role} `"list"`, `"instruction-block"`, or
 *    `"selector"` gets `listRole`, `blockRole`, or `selectorRole` respectively; `"pattern"` and
 *    `"field-list"` have no named LSP modifier in `tooling.md:277` and so contribute none.
 *  - every other class (`keyword`, `number`, `word/string`, `comment`, `bracket`, `brace`,
 *    `paren`, `operator`, `index/dot`, `dict-key`) gets no declaration/reference/readonly
 *    modifier — there is no binding/use distinction for a literal, delimiter, or operator.
 */

import type { Position } from "@openlogo/core";
import type { AnyNode, ProgramNode } from "./ast.js";
import { walk } from "./ast.js";
import { parse } from "./parser.js";
import type { BracketRole, Token, TokenClass } from "./highlight.js";
import { highlight } from "./highlight.js";

/**
 * The LSP-style semantic-token modifiers from `spec/tooling.md:276-278`, in the document's own
 * order.
 */
export const OL_TOKEN_MODIFIERS = [
  "declaration",
  "reference",
  "readonly",
  "defaultLibrary",
  "listRole",
  "blockRole",
  "selectorRole",
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
 */
export function semanticTokens(
  source: string,
  document = "<input>",
): SemanticToken[] {
  const tokens = highlight(source, document);
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
  return modifiers;
}

/**
 * Every `:name` read (a `VarRef`, or a `Place`'s base) inside a `map`/`filter`/`reduce`
 * comprehension's own body that spells the same name as that comprehension's binder (or, for
 * `reduce`, its accumulator) — see the module doc comment for why that makes the read `readonly`.
 */
function collectComprehensionBinderReads(program: ProgramNode): Set<string> {
  const reads = new Set<string>();
  walk(program, (node: AnyNode) => {
    if (node.kind !== "Comprehension") {
      return;
    }
    const binderNames = new Set<string>([node.binder.name.toLowerCase()]);
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
