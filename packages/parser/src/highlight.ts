/**
 * Syntax-highlighting token classes — the normative token-class model from
 * [`spec/tooling.md`](../../../spec/tooling.md). A highlighter classifies tokens from the
 * grammar (grammatical position decides the class), not from ad-hoc regular expressions.
 * Owned by `@language-designer`; consumed by the studio editor, docs, and external editors.
 * The class set tracks the grammar version — a grammar change ships its highlighting update
 * in the same saga.
 *
 * {@link highlight} is the grammar-derived LEXICAL first pass (issue #119) plus the SEMANTIC
 * disambiguation pass (issue #120): it reuses {@link tokenize} and {@link parse} (never
 * re-lexing) to resolve every class and delimiter role decidable from tokens + grammatical
 * position alone, then layers on a local symbol-discovery pass for `procedure-name`,
 * `type-name`, and `field-name`.
 *
 * Symbol discovery is re-derived locally from the AST/token stream on every call — it does not
 * import or share state with the semantic checker (`check.ts`/`checker-*.ts`), which owns a
 * separate, authoritative symbol table for diagnostics. `define`/`to` procedure headers ARE real
 * `ProcedureDefNode`s, so procedure names/calls are resolved via {@link walk}. `struct <type>
 * [ field … ]` has no dedicated AST node yet (`ast.ts`'s comment marks it future Data-profile
 * work; the parser's error recovery drops its tokens rather than building a node for them), so
 * type/field names are resolved the same way #119 resolves the `field-list` bracket role itself:
 * a positional token scan, independent of whether the declaration parses cleanly. `.field`
 * access is classified `field-name` whenever the field's bare spelling matches ANY struct's
 * declared field (there is no static place-to-type binding to narrow it further, per
 * `spec/tooling.md`'s "MAY defer … precision" allowance) — this is a deliberate, best-effort
 * heuristic, not full type inference. A bare name that resolves to neither a known procedure nor
 * a known type stays `primitive` (or `keyword`/`operator` when reserved), matching #119's
 * fallback and the spec's graceful-degradation requirement: unresolved symbols, mid-edit input,
 * and malformed/unclosed constructs never throw and never misclassify a class name/field as a
 * command or keyword.
 */

import { makeSpan } from "@openlogo/core";
import type { Position, SourceSpan } from "@openlogo/core";
import type {
  AnyNode,
  DictEntryNode,
  IsPredicateNode,
  NumberLitNode,
  SpannedName,
  ValueOfKeyNode,
} from "./ast.js";
import { walk } from "./ast.js";
import type { CheckProfile } from "./check.js";
import { DEFAULT_CHECK_PROFILES } from "./check.js";
import { resolveVariableOccurrences } from "./global-variable-resolution.js";
import { parse } from "./parser.js";
import { isKeyword } from "./keywords.js";
import type { LexToken, LexTokenKind } from "./tokens.js";
import { tokenize } from "./tokens.js";

/**
 * The 15 normative token classes. Names are the spec's literal spellings (including the
 * `word/string`, `:variable`, `index/dot`, and `dict-key` forms) so highlighters and
 * semantic-token providers can share one vocabulary.
 */
export const OL_TOKEN_CLASSES = [
  "keyword",
  "primitive",
  "number",
  "word/string",
  ":variable",
  "comment",
  "bracket",
  "brace",
  "paren",
  "operator",
  "index/dot",
  "dict-key",
  "procedure-name",
  "type-name",
  "field-name",
] as const;

/** One normative token class. */
export type TokenClass = (typeof OL_TOKEN_CLASSES)[number];

/**
 * The 5 grammar-derived `[`/`]` delimiter roles from `spec/tooling.md`'s "Delimiter roles"
 * table. A selector's brackets carry role `"selector"` but class `index/dot` (not `bracket`) —
 * see {@link highlight}.
 */
export const OL_BRACKET_ROLES = [
  "list",
  "instruction-block",
  "selector",
  "pattern",
  "field-list",
] as const;

/** One grammar-derived bracket delimiter role. */
export type BracketRole = (typeof OL_BRACKET_ROLES)[number];

/** A classified token: its class, its source text, and where it came from. */
export interface Token {
  readonly class: TokenClass;
  readonly text: string;
  readonly source_span: SourceSpan;
  /** Present only on the `[`/`]` of a list/instruction-block/selector/pattern/field-list. */
  readonly role?: BracketRole;
  /**
   * Present only on the classes with a decidable declaration/reference split —
   * `procedure-name`, `type-name`, `field-name`, and `:variable` (a procedure's own `:param`)
   * — `true` at the binding site, `false` at every other (use/call) site. Consumed by
   * `semantic-tokens.ts` (issue #121) to compute the LSP `declaration`/`reference` modifiers
   * from `spec/tooling.md:282`; absent on classes with no such split (e.g. `keyword`, `number`).
   */
  readonly declaration?: boolean;
  /**
   * Marks a token that **uses** a variable name: `true` when that use resolves to a binding the
   * program declared `global`, `false` when it resolves to anything else — a parameter, a `local`
   * that shadows a same-named global, a binder, or an ordinary top-level name.
   *
   * **Where it appears is asymmetric, and the asymmetry is worth reading before relying on it.**
   *
   *  - On a `:variable` token it is **total** — always `true` or `false`, because that class is
   *    never anything but a variable. A procedure's own `:param` binding site therefore reads
   *    `false`, which is a consequence of that totality rather than a statement that the parameter
   *    resolves to a non-global.
   *  - On a `primitive` or `word/string` token it is present **only at a use**: a `set` target's
   *    bare place head (`set count to 1`), and a `make` target or `thing` argument's word literal
   *    (`make "count" 1`, `thing "count"`). Absent on those classes therefore means "not a resolved
   *    use" — which includes a name the program only **declares**, since `global count = 0`,
   *    `local count`, and a `for`/comprehension binder all write a bare name that *introduces* a
   *    binding rather than resolving one. They name a variable and are still not marked.
   *
   * The three spellings are marked together because `spec/execution-model.md:478-481` makes them
   * resolve identically, and they can be marked at all because a modifier **decorates whatever class
   * a token already has**: marking a `primitive` or a `word/string` invents no class and, for the
   * word literal, classifies nothing *inside* the string (`spec/tooling.md:25-26`'s MUST NOT is
   * about classification). Whether those tokens should carry a variable-ish *class* is the separate
   * `spec/` question in issue #1107.
   *
   * **It follows resolution, not spelling** (issue #826): see `global-variable-resolution.ts` for
   * the scope model, the spec clauses behind it, and the one case it knowingly cannot decide (a
   * deferred handler body). `semantic-tokens.ts` surfaces it as the `global` semantic-token
   * modifier, which is the channel an editor should consume; the token **class** is untouched, the
   * way `spec/tooling.md:83-84` keeps the bracket roles off the class axis and on the modifier one.
   */
  readonly global?: boolean;
}

/**
 * Word-spelled operators (`spec/tooling.md:39`): `and`, `or`, `not`, and `mod` — always
 * `operator`, never `keyword`. Consulted before the {@link isKeyword} lookup so none of the four
 * falls through to `keyword`: all four are on the keyword list (`spec/grammar.md:375`), and
 * `spec/grammar.md:380` makes that list and the `keyword` **token class** "different sets on
 * purpose", so membership here is what decides the class.
 *
 * **Exported as the set classification actually reads, not as a copy of it.** The four are built-in
 * names, so `spec/built-in-names.json` lists them — but it lists them by *category*, and this is the
 * only place the implementation says how they are *painted*. The built-in-names gate enumerates this
 * export to catch a **fifth** word added here that the manifest does not list (issue #959 review).
 * That comparison is only worth as much as the export being the very object {@link highlight}
 * consults, so there is deliberately no second internal literal to drift from it.
 */
export const OL_WORD_OPERATORS: ReadonlySet<string> = new Set([
  "and",
  "or",
  "not",
  "mod",
]);

/** Lexical token kinds that carry highlightable content — never `newline`/`eof`. */
type ContentTokenKind = Exclude<LexTokenKind, "newline" | "eof">;

/** A raw lexer token narrowed to a highlightable kind. */
interface ContentToken extends LexToken {
  readonly kind: ContentTokenKind;
}

function isContentToken(token: LexToken): token is ContentToken {
  return token.kind !== "newline" && token.kind !== "eof";
}

/** `"line:column"` — a stable map key for a `Position` tuple. */
function posKey(position: Position): string {
  return `${position[0]}:${position[1]}`;
}

/** Is `a` at or before `b` in source order? */
function isAtOrBefore(a: Position, b: Position): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
}

/**
 * Options for {@link highlight} and {@link semanticTokens}.
 *
 * `profiles` is the **active profile set**, in the same vocabulary `check()` uses
 * (`check.ts`'s `OL_CHECK_PROFILES`), because a learner's program has exactly one profile set and
 * it would be a trap for the checker and the highlighter to name it differently.
 *
 * `options.profiles` decides the class of the profile block-heads and the Sprites mode-switch
 * command `tell`: `spec/tooling.md:30` puts them in `keyword` "while their profile is active",
 * and `:31` puts "a profile word whose profile is inactive" in `primitive`. Omitted, it defaults
 * to {@link DEFAULT_CHECK_PROFILES} (Core Language alone) — the profile-neutral reading, and
 * exactly what every caller saw before this option existed. Profile *primitives* — the Sound
 * commands, Interaction's `wait`/`input`, the Sprites reporters — are `primitive` under every
 * profile set (`:31`, "profile primitives when enabled"), so this option never moves them.
 */
export interface HighlightOptions {
  readonly profiles?: readonly CheckProfile[];
}

/**
 * The kinds {@link describeArgument} names: `typeof`'s eight results, plus `"null"` and `"array"`,
 * which `typeof` collapses into `"object"`.
 *
 * A closed union rather than `string` so the compiler, not the tests, is what keeps
 * {@link ARM_FOR_KIND} total: adding a member here is an error at that `Record` until it is mapped,
 * and removing one is an error at `describeArgument`'s `return typeof value`. Both directions
 * matter, and neither is enforceable with a bare `string`.
 */
type ArgumentKind =
  | "null"
  | "array"
  | "undefined"
  | "object"
  | "string"
  | "number"
  | "boolean"
  | "function"
  | "symbol"
  | "bigint";

/** The {@link adviceFor} arm a `document` of a given {@link ArgumentKind} gets. */
type AdviceArm = "required" | "object" | "generic";

/**
 * Which arm each kind takes — total over {@link ArgumentKind} by the `Record`, so a new kind is a
 * compile error here until it is mapped and can never reach a fall-through default.
 *
 * Exported for the tests, which use `Object.keys` as the oracle for "every kind is swept". It is
 * deliberately **not** re-exported from `index.ts`, so it stays package-internal; the tests reach
 * it by the `../dist/*.js` relative import this repo already uses for internals (for example
 * `child-edges.test.mjs` → `../dist/ast.js`).
 *
 * (`"string"` is mapped for totality only — {@link assertDocumentArgument} returns before a string
 * can reach {@link adviceFor}.)
 */
export const ARM_FOR_KIND: Record<ArgumentKind, AdviceArm> = {
  undefined: "required",
  object: "object",
  null: "generic",
  array: "generic",
  string: "generic",
  number: "generic",
  boolean: "generic",
  function: "generic",
  symbol: "generic",
  bigint: "generic",
};

/** Name a runtime value for a diagnostic message: `null` and arrays are not just `"object"`. */
function describeArgument(value: unknown): ArgumentKind {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

/**
 * The advice each arm produces. A `Record` over {@link AdviceArm} for the same reason
 * {@link ARM_FOR_KIND} is one over {@link ArgumentKind}: it is **total by type**, so a new arm is a
 * compile error here until it is written, and there is no fall-through default for it to land in.
 *
 * A `switch` with an `assertNever` default gives exhaustiveness too, but strictly less. This form
 * additionally makes an arm that is written but **routed to no kind** a dead function, which the
 * 100%-function-coverage gate fails — a guarantee `assertNever` cannot give at all, and one it
 * would have cost by permanently parking an uncoverable `default` in a repo that gates at 100%.
 * Exhaustive *and* non-vacuous, with no branches.
 *
 * The two lookups also defend each other's annotations, which is what makes them hard to weaken:
 * because {@link adviceFor} is the single composed expression `ADVICE_BY_ARM[ARM_FOR_KIND[k]](c)`,
 * loosening either `Record`'s key type to `string` makes the *other* lookup ill-typed (`TS2538` on
 * the index, `TS2722` on the call). That coupling is a property of the two annotations, not of the
 * expression's shape — splitting it into intermediate variables was measured and still produces
 * both errors — so it survives an ordinary refactor.
 *
 * Exported, with {@link ARM_FOR_KIND}, only so the tests can use `Object.keys` as an oracle; it is
 * not re-exported from `index.ts` and stays package-internal, which a test asserts.
 */
export const ADVICE_BY_ARM: Record<
  AdviceArm,
  (callee: "highlight" | "semanticTokens") => string
> = {
  required: (callee) =>
    `\`document\` is required: name the source, e.g. ${callee}(source, "<input>").`,
  object: (callee) =>
    `An options object belongs in the THIRD argument — ${callee}(source, "<input>", { profiles }). ` +
    "Passed second it would bind to `document`, which is why this is rejected rather than " +
    "silently discarding your options.",
  generic: (callee) =>
    `Pass a string naming the source, e.g. ${callee}(source, "<input>").`,
};

/**
 * The remedy to offer for a `document` of `received` kind (as named by {@link describeArgument}).
 *
 * Three arms, because the mistakes have **disjoint** remedies — "put a string in that slot" versus
 * "move your object to third position" versus "that is not a name at all". One message would have
 * to state them all and leave the caller to work out which applies, and having to work that out is
 * the exact cost #951 was about. Only an object is plausibly a misplaced options bag: an omitted
 * or `undefined` argument needs a **string** in that slot (it is not a missing argument when the
 * caller wrote `undefined` explicitly, so "add a second argument" would be wrong advice), while
 * `null`, an array, and a number are simply the wrong type — so no arm but the object one is told
 * to move options it never passed.
 *
 * The object arm is `describeArgument`'s `"object"`, i.e. **any** non-null, non-array object. That
 * breadth is what `typeof` hands us rather than a decision that was weighed — but it is also the
 * safer default, and that is the reason to keep it. `Object.getPrototypeOf(value) ===
 * Object.prototype` is false for a same-realm options bag built with
 * `Object.assign(Object.create(null), { profiles: [...] })` — no `vm` needed — and false again for
 * one built in another realm, so a prototype-narrowed predicate would route the **real** mistake
 * shape to "that is not a name at all" and lose the options advice on the one call it was written
 * for.
 *
 * A shape test (`"profiles" in value`) would be better still: it is prototype- and realm-agnostic,
 * so it keeps both of those on the object arm, and it also fixes the cost at the other end — a
 * boxed `new String("x")`, which a caller might genuinely have meant as a name, currently gets the
 * options advice. The prototype argument above does **not** count against it. What counts against
 * it is that `profiles` is **optional** on {@link HighlightOptions}, so the test keys on a field a
 * perfectly valid options bag need not carry: `highlight(src, {})`, `highlight(src, { profile: [] })`
 * — the singular typo, a caller already in trouble — and every bag using a field this interface
 * has not grown yet would all fall to the generic arm and lose the options advice. That cost is
 * open-ended and grows with the interface, which is why this is not being done. A considered
 * alternative, recorded so the next reader inherits the reasoning rather than re-deriving it — not
 * scheduled work, and there is no tracking issue.
 */

function adviceFor(
  received: ArgumentKind,
  callee: "highlight" | "semanticTokens",
): string {
  return ADVICE_BY_ARM[ARM_FOR_KIND[received]](callee);
}

/**
 * Reject a non-string in the `document` slot of {@link highlight}/{@link semanticTokens} (#951).
 *
 * When `document` was optional, `highlight(source, { profiles })` bound the options object to
 * `document`, so `options` defaulted to `{}` and `activeProfiles` silently fell back to
 * {@link DEFAULT_CHECK_PROFILES} — a plausible, wrong answer — *and* wrote that object into every
 * token's `source_span.document`, a field typed `string`. That trap produced two false issues
 * (#832, #840) and a withdrawn Epic Gate PASS before it was closed; the ledger is
 * `.github/skills/shared/review-gate/SKILL.md:175-178`.
 *
 * The two halves of the fix do different jobs, and neither substitutes for the other. Making
 * `document` **required** is the static half: TypeScript then rejects both the omission and the
 * mis-bound object. This guard is the runtime half, and it is the one that matters in practice,
 * because a two-argument call from `.mjs` — where every test that calls these functions, and every
 * script here, lives — still binds the object into the slot with no types to stop it.
 *
 * The governing rule, stated so the next entry point inherits it rather than re-deriving it:
 * **a `document` parameter may keep a default only where it is the last parameter.** Phrasing it
 * as "only where no *options* parameter follows" would be under-general — a trailing
 * `profiles: readonly CheckProfile[]` mis-binds an array into `document` just as silently, and
 * TypeScript permits a required parameter after a defaulted one. `parse(source, document =
 * "<input>")` is compliant with the rule today because nothing follows it; **appending** anything
 * after it means making `document` required in the same change. Inserting a parameter *before*
 * `document` leaves it last, so this rule permits it — but that is not a free move either: it
 * re-binds every existing two-argument call, and if the inserted parameter carries its own default
 * the same trap simply moves one slot to the left. `@openlogo/runtime`'s `execute(source,
 * document, options)` already has the required-`document` shape this now matches.
 *
 * This does **not** weaken the never-throw contract {@link highlight} states. That contract is
 * about malformed *OpenLogo source* — any `source` string still yields a best-effort token stream.
 * `document` is a host argument, so tripping this is a caller bug that is deterministic and
 * independent of the program being classified: a caller passing a literal (as `@openlogo/studio`
 * does on every keystroke) can never reach it.
 */
export function assertDocumentArgument(
  document: unknown,
  callee: "highlight" | "semanticTokens",
): void {
  if (typeof document === "string") {
    return;
  }
  const received = describeArgument(document);
  throw new TypeError(
    `${callee}(source, document, options): \`document\` must be a string naming the source, but ` +
      `received ${received}. ${adviceFor(received, callee)}`,
  );
}

/**
 * Classify `source` into a flat, source-ordered `Token[]` — the grammar-derived lexical first
 * pass. Reuses {@link tokenize} for the raw token stream and {@link parse} for the AST that
 * resolves grammatical position (list/instruction-block/selector roles, dict-key selector
 * literals, negative-literal merging, contextual `is`-predicate keywords); it never re-lexes.
 * Malformed input still yields a best-effort token stream, matching {@link parse}'s own
 * never-throw contract.
 *
 * `options.profiles` is the active profile set — see {@link HighlightOptions}. It is the only
 * input that changes a class here, and it changes exactly one thing: whether a profile
 * block-head — or the Sprites mode-switch command `tell`, which takes no block — is `keyword`
 * or `primitive`. Profile *primitives* never move.
 *
 * `document` names the source for each token's `source_span` and is **required**. TypeScript then
 * rejects an options object in that slot; {@link assertDocumentArgument} rejects it at runtime,
 * where `.mjs` callers live and where it would otherwise still bind silently. That guard is about
 * the host's *arguments*, and leaves the never-throw contract above — which is about malformed
 * *source* — intact.
 */
export function highlight(
  source: string,
  document: string,
  options: HighlightOptions = {},
): Token[] {
  assertDocumentArgument(document, "highlight");
  const activeProfiles = options.profiles ?? DEFAULT_CHECK_PROFILES;
  const lex = tokenize(source, document).tokens;
  const program = parse(source, document).ast;

  // The synthetic `eof` token is zero-width (its start equals its end) and, whenever the source
  // has no trailing newline, that position exactly matches the preceding real token's own end —
  // colliding in `byEnd` and silently shadowing e.g. a closing `]`'s index. `eof` is never a
  // bracket/paren/selector boundary itself, so it is simply excluded from both maps.
  const byStart = new Map<string, number>();
  const byEnd = new Map<string, number>();
  lex.forEach((token, index) => {
    if (token.kind === "eof") {
      return;
    }
    byStart.set(posKey(token.source_span.start), index);
    byEnd.set(posKey(token.source_span.end), index);
  });

  // `dict-key` (`spec/tooling.md:41`) has two grammatical sources: a selector's bare-word key
  // (`:dict[key]`, handled by `markSelectorKey` below) and a dict-*literal*'s bare key before its
  // `:` (`{ key: value }`, handled by the `"DictLit"` case in `visit()`, reusing the same
  // `markSelectorKey` helper for each entry). Both share the identical bare-identifier-vs-quoted
  // -word-literal disambiguation, since a dict-literal key parses to the same `WordLitNode` shape
  // as a bare selector key.
  const roleByIndex = new Map<number, BracketRole>();
  const dictKeyIndexes = new Set<number>();
  const contextualKeywordIndexes = new Set<number>();
  const negativeMergeStarts = new Set<number>();

  // A dict-entry's `:` with no gap before its value's leading identifier (`{ a:foo }`) lexes as
  // one `variable` token — the same ambiguity `parser.ts`'s `splitGluedColonToken` resolves for
  // parsing. Highlighting never re-lexes its own copy, so it re-derives the same split here from
  // the raw `lex` array + the already-parsed AST (`markGluedDictColon` below) rather than sharing
  // parser-internal state: keyed by the raw glued token's index, the stored `Position` is where
  // the value's own AST span begins (one column past the colon), letting the final assembly loop
  // recompute the split colon/name spans and text without re-parsing.
  const dictColonSplits = new Map<number, Position>();

  // Semantic symbol discovery (#120): re-derived locally on every call, never shared with the
  // checker's own symbol table. `typeNames`/`fieldNames` (lowercased spellings) drive constructor
  // calls and `.field` access; the `*Indexes` sets record which raw token indexes carry each
  // resolved class once discovery is done.
  const typeDeclIndexes = new Set<number>();
  const fieldDeclIndexes = new Set<number>();
  const typeNames = new Set<string>();
  const fieldNames = new Set<string>();
  const procDeclIndexes = new Set<number>();
  const procCallIndexes = new Set<number>();
  const typeCallIndexes = new Set<number>();
  const fieldAccessIndexes = new Set<number>();
  // A procedure's own `:param` is the only `:variable` binding site the AST can resolve
  // directly (issue #121): `local`/`for`/comprehension binders parse as bare `name` tokens
  // (see `ast.ts`'s `ProcedureParam` vs. `ForInNode.binder`/`ComprehensionBase.binder`), so they
  // never reach this `:variable`-classed set at all — only a real `variable`-kind token can.
  const paramDeclIndexes = new Set<number>();
  // Which `:variable` tokens resolve to a `global` binding (issue #826). Computed from the AST by
  // its own module rather than inline here, because the answer needs an ordered, scope-aware walk
  // (a `local` shadows from its own statement onward) that the `visit()` pass below — a generic,
  // order-free `walk` — cannot express. Positions are mapped back to raw token indexes through the
  // same `byStart` lookup every other marker uses.
  // Which tokens use a variable name, and which of those resolve to a `global` binding (issue #826).
  // Computed from the AST by its own module rather than inline here, because the answer needs an
  // ordered, scope-aware walk (a `local` shadows from its own statement onward) that the `visit()`
  // pass below — a generic, order-free `walk` — cannot express. Positions are mapped back to raw
  // token indexes through the same `byStart` lookup every other marker uses.
  //
  // Three lexer kinds can carry the answer, because `spec/grammar.md:106-108` gives assignment three
  // spellings: `variable` for a colon place (`:count = 1`, and every read), `name` for a `set`
  // target's bare place head, and `word` for a `make` target or a `thing` read.
  //
  // **The kind check is redundant defensive code, not a discriminating filter, and QA proved it
  // twice** (issue #826 review, round 3, surviving mutant M4): the map is read at exactly three
  // sites below — the `word`, `variable`, and `name` arms — so an entry of any other kind is
  // unreachable by construction, and dropping the check leaves the marked-token stream byte-identical
  // across every `.logo` file and fenced block in the repository. It stays because it keeps the map
  // honest at its own boundary: a future AST or lexer change that moved a span would otherwise
  // silently mark a *neighbouring* token, and a wrong mark at a wrong span is worse than none.
  const variableGlobalByIndex = new Map<number, boolean>();
  for (const occurrence of resolveVariableOccurrences(program)) {
    const index = byStart.get(posKey(occurrence.position));
    const kind = index === undefined ? undefined : lex[index]?.kind;
    if (
      index !== undefined &&
      (kind === "variable" || kind === "name" || kind === "word")
    ) {
      variableGlobalByIndex.set(index, occurrence.global);
    }
  }

  /**
   * Tag the raw token starting at `name`'s span with `target`, when it is a real token of
   * `kind` (`"name"` by default; pass `"variable"` for a colon-prefixed binder such as a
   * procedure parameter). A dict-entry's glued `:name` value (`{ a:foo }`, resolved by
   * {@link markGluedDictColon}) has no real raw token starting at its own AST span — the whole
   * `:foo` is one `variable`-kind token — so an ordinary `"name"` lookup also accepts a glued
   * split index there, letting a glued value still resolve to `procedure-name`/`type-name`/
   * `field-name` like any other bare name.
   */
  function markNameIndex(
    name: SpannedName,
    target: Set<number>,
    kind: LexTokenKind = "name",
  ): void {
    const index = byStart.get(posKey(name.source_span.start));
    if (
      index !== undefined &&
      (lex[index]?.kind === kind ||
        (kind === "name" && dictColonSplits.has(index)))
    ) {
      target.add(index);
    }
  }

  /**
   * Tag the `[`/`]` at `span`'s start/end (when they are lexer bracket tokens) with `role`.
   * `spanBetween(open, close)` (the parser's span helper) always sets a `ListLit`/bracket-form
   * `Block`/selector span's start/end to a real open/close bracket token's own start/end, so the
   * `byStart`/`byEnd` lookup always lands on that exact token when the form is bracketed.
   */
  function markBracketPair(span: SourceSpan, role: BracketRole): void {
    // Never override a role the positional `for [` / `struct <type> [` scan already assigned
    // (it runs first, below): a `[` directly after `for`/`struct <type>` can only ever be a
    // pattern/field-list grammatically, even when today's grammar has no binder/type production
    // for it and the parser's error recovery mis-parses the bracket as an unrelated ListLit.
    const openIndex = byStart.get(posKey(span.start));
    if (
      openIndex !== undefined &&
      lex[openIndex]?.kind === "lbracket" &&
      !roleByIndex.has(openIndex)
    ) {
      roleByIndex.set(openIndex, role);
    }
    const closeIndex = byEnd.get(posKey(span.end));
    if (
      closeIndex !== undefined &&
      lex[closeIndex]?.kind === "rbracket" &&
      !roleByIndex.has(closeIndex)
    ) {
      roleByIndex.set(closeIndex, role);
    }
  }

  /** A selector's key that is a bare identifier (not a quoted `"word"`) is a `dict-key`. */
  function markSelectorKey(key: {
    readonly kind: string;
    readonly source_span: SourceSpan;
  }): void {
    if (key.kind !== "WordLit") {
      return;
    }
    const index = byStart.get(posKey(key.source_span.start));
    if (index !== undefined && lex[index]?.kind === "name") {
      dictKeyIndexes.add(index);
    }
  }

  /**
   * Record `entry` in {@link dictColonSplits} when its value has no gap after the `:` (`{ a:foo
   * }`), so the final assembly loop below can split that one glued `variable` token back into an
   * `operator` `:` plus the value's own class. An ordinary, spaced entry's value always starts at
   * a real raw token of its own, so `byStart` already resolves it — only the glued case needs
   * this. The colon character always sits exactly one column before the value on the same line
   * (`parser.ts`'s `splitGluedColonToken` only ever splits a same-line, zero-gap `variable`
   * token), so that position is where the raw glued token must start.
   */
  function markGluedDictColon(entry: DictEntryNode): void {
    const valueStart = entry.value.source_span.start;
    if (byStart.has(posKey(valueStart))) {
      return;
    }
    const colonPosition: Position = [valueStart[0], valueStart[1] - 1];
    const rawIndex = byStart.get(posKey(colonPosition));
    if (rawIndex !== undefined && lex[rawIndex]?.kind === "variable") {
      dictColonSplits.set(rawIndex, valueStart);
      // Let any AST node whose span starts exactly at the value (a `Call`'s callee, a
      // `BooleanLit`, …) resolve back to this raw index too — `markNameIndex` above is the
      // consumer that needs it.
      byStart.set(posKey(valueStart), rawIndex);
    }
  }

  /**
   * A `NumberLitNode` whose span starts at a `-` op token immediately followed by the numeral
   * it merges with (`tryNegativeNumberLiteral` in the parser) is one `number` token, not a
   * separate `operator` + `number` pair.
   *
   * A `NumberLitNode`'s span always starts at a real, non-`eof` token (either the merged `-` op
   * or the numeral itself), so `byStart` always resolves it.
   */
  function markNegativeLiteral(node: NumberLitNode): void {
    const startIndex = byStart.get(posKey(node.source_span.start)) as number;
    const startToken = lex[startIndex];
    const numberToken = lex[startIndex + 1];
    if (
      startToken?.kind === "op" &&
      startToken.text === "-" &&
      numberToken?.kind === "number" &&
      numberToken.source_span.end[0] === node.source_span.end[0] &&
      numberToken.source_span.end[1] === node.source_span.end[1]
    ) {
      negativeMergeStarts.add(startIndex);
    }
  }

  /** Is the token at `index` the word `expected` (case-insensitive)? Tag it if so. */
  function markContextualWord(index: number, expected: string): void {
    const token = lex[index];
    if (token?.kind === "name" && token.text.toLowerCase() === expected) {
      contextualKeywordIndexes.add(index);
    }
  }

  /**
   * `empty`/`member`/`of`/`a` are keywords in reader-recognized positions. `spec/tooling.md:97-99`
   * is the normative highlighter instruction and names two: "only inside an `is`-predicate or the
   * heritage `value of … for key` reader, and as ordinary names elsewhere". This function handles
   * the first, and {@link markValueOfKeyPreposition} below handles the second. `is` itself,
   * `between`, and `strictly` are already globally reserved.
   *
   * `node.operand`'s span always ends at a real, non-`eof` token, so `byEnd` always resolves.
   *
   * **Every index here walks past newlines, including the one that finds `is` itself** (issue
   * #995). Two earlier versions of this comment asserted adjacency instead, and both were false:
   * one claimed the words after `is` are "directly adjacent in the token stream (no `skipNewlines`
   * between them)", the other that "`is` is the literal next raw token after the operand". Neither
   * holds. `parseComparison` guards the operator with `continuesOnNextLineWith("is")` and skips
   * before testing `isName("is")`, and `parseIsPredicate` then calls `skipNewlinesBeforeOperand`
   * before the form word and again before `of` (issue #933).
   *
   * **Exactly three of those positions can move a word this function classifies** — before `is`,
   * before the form word, and between `member` and `of`. `parseIsPredicate` and `parseBetween`
   * skip newlines at several further points, and none of them can shift an index used here: the
   * remaining `parseIsPredicate` skips sit after the last contextual word, and `parseBetween`
   * classifies nothing from here at all — the `between` case of the switch below is empty, because
   * `between`, `strictly` and `and` are globally reserved and painted by the ordinary path.
   * (An earlier revision said those skips all precede "an operand or a type literal"; two of
   * `parseBetween`'s four precede the reserved words `between` and `and`, so the conclusion held
   * for the wrong reason.)
   *
   * Cited by role rather than by line on purpose. Line numbers into this file are the wrong-passage
   * mode waiting to happen and nothing gates them: `npm run spec-citations` validates only
   * `spec/*.md` references, and an earlier revision of this very comment cited six `parser.ts`
   * lines that its own sibling edit had already shifted, with the gate reporting zero failures.
   * A role survives an insertion; a line number does not.
   *
   * So `print :x` ⏎ `is empty` and `print :x is` ⏎ `empty` are both legal predicates, and a raw
   * offset lands on a newline token in each. The word then falls through to its ordinary
   * classification and is painted `primitive` — exactly as `of` was in #785, and, like #785, in a
   * program that parses **completely clean**, so no diagnostic could ever surface it. A token-class
   * assertion is the only instrument that can see it.
   *
   * Each index is derived from the previous *resolved* one rather than by arithmetic on `isIndex`,
   * so an arbitrary number of newlines between any two words resolves.
   *
   * **Both gap axes are guarded, and that is a claim about two token kinds, not about the
   * function.** A newline is one way for these offsets to miss; a `)` between the operand and `is`
   * is a second, independent one — `print (:x) is empty` classified `empty` as `primitive`, cleanly
   * parsed, until issue #959 folded closing parens into the same scan. It is specifically a
   * **grouping** paren, whose node span excludes the closer so the `)` really does sit between the
   * operand and `is`; a parenthesized **call** was never affected (`print (first :l) is empty`
   * classifies `empty` as `keyword`), as are selectors and `.field` access.
   *
   * {@link indexSkippingNewlinesAndClosingParens} skips exactly `newline` and `rparen` and stops at
   * the first token that is neither. Do not read "at every position" as meaning the function is
   * guarded against a *third* kind nobody has found yet — that inference is what this comment got
   * wrong twice already, and the corpus that would settle it is deferred (issue #959's PR body).
   */
  function markIsPredicateKeywords(node: IsPredicateNode): void {
    const operandEndIndex = byEnd.get(
      posKey(node.operand.source_span.end),
    ) as number;
    const isIndex = indexSkippingNewlinesAndClosingParens(operandEndIndex + 1);
    const formIndex = indexSkippingNewlinesAndClosingParens(isIndex + 1);
    switch (node.test.form) {
      case "empty":
        markContextualWord(formIndex, "empty");
        break;
      case "member-of":
        markContextualWord(formIndex, "member");
        markContextualWord(
          indexSkippingNewlinesAndClosingParens(formIndex + 1),
          "of",
        );
        break;
      case "a":
        markContextualWord(formIndex, "a");
        break;
      case "between":
        break;
    }
  }

  /**
   * `of` in the Heritage `value of <dict> for key <key>` reader (`spec/grammar.md:219`'s
   * `value-of-reader`) is `keyword`, alongside the `is`-predicate's `of` above.
   *
   * `spec/tooling.md:97-99` is the normative highlighter instruction and names **both** positions:
   * a highlighter marks `empty`/`member`/`of`/`a` as `keyword` "only inside an `is`-predicate or
   * the heritage `value of … for key` reader, and as ordinary names elsewhere". That sentence named
   * only the `is`-predicate until the maintainer's ruling on issue #785 added this reader; the spec
   * amendment and this marking ship in the same change, so no version of the tree has the code and
   * the spec disagreeing.
   *
   * Supporting passages elsewhere in the spec: `spec/tooling.md:30` names `of` among the contextual
   * words that take the `keyword` class in the structural positions it describes;
   * `spec/localization.md:80,82` lists
   * `value of dict for key key_value` among the Heritage grammar forms and states these forms "can
   * contain structural words such as `to`, `of`, `for`, and `key` in fixed grammar slots" — naming
   * `of` a structural word of this production, beside the three siblings that are reserved and so
   * already `keyword`; and `spec/grammar.md:382` calls this `of` "the contextual preposition in the
   * heritage `value of … for key` reader".
   *
   * Those passages now match. `spec/grammar.md:236`, `spec/execution-model.md:156-159`, and
   * `spec/commands.md:482` each keep their "after `is`" claim scoped to their own subject and
   * name this reader as `of`'s other structural position (#856); `spec/grammar.md:382` had already
   * folded its reader parenthetical into the sentence (#875), ending the tension it had carried
   * since the spec's initial commit. None of them governs token class in any case:
   * `spec/grammar.md:7` scopes that document to "lexis, reader-visible syntax, expression
   * precedence, bracket roles, assignable places, keywords, and the built-in names a program may
   * not declare", and `spec/commands.md:482` draws its contrast in keyword-membership terms ("Only
   * `is`, `strictly`, and `between` are keywords") — the *reservation* half of the claim comes
   * from `spec/tooling.md:100` ("`is`, `between`, and `strictly` are globally reserved"). The
   * normative token-class model is `spec/tooling.md`'s.
   *
   * It is emphatically not `primitive` **as a matrix claim**: `spec/tooling.md:31` scopes that
   * sense to "Built-in commands, reporters, and aliases from the C3 primitive matrix", and
   * `of` is in no primitive table (`corePrimitiveArity("of") === undefined`; `spec/commands.md` has
   * no `of` entry). `:31` does make `primitive` the grammar-safe *fallback* for an unclaimed bare
   * name, but it forbids reading matrix membership into that — whereas `semanticTokens` then
   * decorated `of` with `defaultLibrary`, asserting standard-library membership for a word that has
   * none (the residue tracked by #831).
   *
   * This is a *classification*, not a reservation: `of` is still not a reserved word, so it stays
   * redefinable and remains an ordinary name outside these two positions (`:of`, `define of`,
   * `{ of: 2 }`) — see `keywords.ts`, which deliberately omits all four contextual words.
   *
   * The node's span starts at its own `value` token, so `byStart` always resolves. `of` is found
   * by walking past any `newline` tokens, because `byStart`/`byEnd` are built over the **raw** lex
   * stream, which keeps them. An earlier version of this comment claimed the parser only builds a
   * `ValueOfKeyNode` when `of` is the literal next raw token, "`peek(1)`, no `skipNewlines`
   * between". That was true when it was written and my own #979 change falsified it without
   * updating it: `parseNamePrimary`'s `value` interception now tests
   * `isKeywordToken(peek(skippingNewlines(1)), "of")`, so the reader may be written
   * `value` ⏎ `of …`. Without the walk the marked index would land on
   * the newline, `of` would fall through to its ordinary classification and be painted `primitive`,
   * re-opening #785 for the split spelling alone — a regression no parse diagnostic could show,
   * since the program parses clean.
   *
   * Both halves of {@link markContextualWord}'s guard are redundant defence-in-depth on this path
   * rather than live branches: the token there is always a `name` token whose text is always `of`.
   * Deleting either half leaves the whole suite green (verified), so neither is pinned from here;
   * they are the shared helper's signature, kept because with them a wrong index degrades to
   * marking nothing, while without them it would mark the *wrong* token `keyword`.
   * Marking by token index leaves every other `of` in the same document untouched.
   */
  function markValueOfKeyPreposition(node: ValueOfKeyNode): void {
    const valueIndex = byStart.get(posKey(node.source_span.start)) as number;
    markContextualWord(
      indexSkippingNewlinesAndClosingParens(valueIndex + 1),
      "of",
    );
  }

  /**
   * The first index at or after `index` whose token is neither a `newline` nor a closing paren.
   *
   * Two token kinds, one scan, because the two gaps have the same cause and appear together. A
   * newline is separating whitespace wherever the grammar allows one (issue #995); a closing paren
   * appears because `node.operand`'s span is the **inner** expression's, so a parenthesised operand
   * leaves its own `)` between that span and the `is`:
   *
   *     (
   *       value of :d for key "x"
   *     ) is empty
   *
   * `(:x\n) is empty` leaves both at once, which is why skipping either alone was insufficient:
   * each fix landed on the token the other would have skipped, marked nothing, and painted the
   * predicate's own word `primitive` in a position `spec/tooling.md:30` gives the `keyword` class —
   * in a program that parses with **zero diagnostics** (issue #959 rounds 4-5, issue #995).
   *
   * Only these two kinds can sit in any of these gaps, so the scan is bounded by the grammar rather
   * than by a guess, and it stops at the first token that is neither. Closing parens are reachable
   * only in the operand gap; at the other call sites the grammar admits no `)`, and
   * {@link markContextualWord}'s guard makes an overshoot inert rather than wrong.
   */
  function indexSkippingNewlinesAndClosingParens(index: number): number {
    let next = index;
    while (lex[next]?.kind === "newline" || lex[next]?.kind === "rparen") {
      next += 1;
    }
    return next;
  }

  // Run the positional pattern/field-list scan first: a `[` directly after `for`/`struct
  // <type>` is grammatically never a real list literal today, but the parser's error recovery
  // can still misfile it as one (see markBracketPair's comment) — claiming the role here first
  // means the later AST walk's `markBracketPair` calls simply no-op on those same indexes. It
  // also discovers every `struct <type> [ field … ]`'s type/field names (#120): the declaration
  // has no AST node to walk, so this positional scan is their only source of truth.
  scanPositionalBracketRoles();

  // `define`/`to` procedure headers DO parse into real `ProcedureDefNode`s, so their names are
  // discovered with a plain pre-pass walk — done before the main `visit` walk below so a call
  // that appears lexically before its definition still resolves.
  const procNames = new Set<string>();
  walk(program, (node) => {
    if (node.kind === "ProcedureDef") {
      procNames.add(node.name.name.toLowerCase());
    }
  });

  function visit(node: AnyNode): void {
    switch (node.kind) {
      case "ListLit":
        markBracketPair(node.source_span, "list");
        break;
      case "DictLit":
        for (const entry of node.entries) {
          markSelectorKey(entry.key);
          markGluedDictColon(entry);
        }
        break;
      case "If":
        markBracketPair(node.thenBody.source_span, "instruction-block");
        if (node.elseBody !== undefined) {
          markBracketPair(node.elseBody.source_span, "instruction-block");
        }
        break;
      case "While":
      case "Repeat":
      case "Forever":
      case "ForIn":
      case "ForRange":
      case "Comprehension":
        markBracketPair(node.body.source_span, "instruction-block");
        break;
      case "ProcedureDef":
        markBracketPair(node.body.source_span, "instruction-block");
        markNameIndex(node.name, procDeclIndexes);
        for (const param of node.params) {
          markNameIndex(param.name, paramDeclIndexes, "variable");
        }
        break;
      case "Call":
      case "ParenCall": {
        const lower = node.callee.name.toLowerCase();
        if (procNames.has(lower)) {
          markNameIndex(node.callee, procCallIndexes);
        } else if (typeNames.has(lower)) {
          markNameIndex(node.callee, typeCallIndexes);
        }
        break;
      }
      case "Place":
      case "PostfixExpression":
        for (const segment of node.segments) {
          if (segment.kind === "index") {
            markBracketPair(segment.source_span, "selector");
            markSelectorKey(segment.key);
          } else if (fieldNames.has(segment.name.name.toLowerCase())) {
            markNameIndex(segment.name, fieldAccessIndexes);
          }
        }
        break;
      case "NumberLit":
        markNegativeLiteral(node);
        break;
      case "IsPredicate":
        markIsPredicateKeywords(node);
        break;
      case "ValueOfKey":
        markValueOfKeyPreposition(node);
        break;
      default:
        break;
    }
  }
  walk(program, visit);

  /**
   * `pattern` (`for [:x :y] in …`) has no AST support yet — destructuring binders are a later
   * slice — so it resolves purely from adjacent raw-token spellings, independent of whether the
   * surrounding construct parses cleanly. `field-list` (`struct <type> [ … ]`) is the same story
   * for its bracket role, and #120 additionally discovers the declaration's type name (the name
   * right before the bracket) and field names (every bare name between the brackets) from this
   * same positional scan, since `struct` has no dedicated AST node to walk either.
   */
  function scanPositionalBracketRoles(): void {
    for (let index = 0; index < lex.length; index += 1) {
      const token = lex[index];
      if (token?.kind !== "lbracket" || roleByIndex.has(index)) {
        continue;
      }
      const prev = previousSignificant(index);
      if (
        prev?.token.kind === "name" &&
        prev.token.text.toLowerCase() === "for"
      ) {
        applyPositionalRole(index, "pattern");
        continue;
      }
      if (prev?.token.kind === "name") {
        const beforePrev = previousSignificant(prev.index);
        if (
          beforePrev?.token.kind === "name" &&
          beforePrev.token.text.toLowerCase() === "struct"
        ) {
          typeDeclIndexes.add(prev.index);
          typeNames.add(prev.token.text.toLowerCase());
          const closeIndex = applyPositionalRole(index, "field-list");
          if (closeIndex !== undefined) {
            // The normative field list is bare names only (`struct <type> [ field1 field2 … ]`)
            // — a nested `[ … ]` is not a field spelling, so depth-track past it rather than
            // scooping up its own contents as bogus fields (e.g. `struct p [ x [ y ] z ]` must
            // not treat `y` as a field of `p`).
            let depth = 0;
            for (
              let fieldIndex = index + 1;
              fieldIndex < closeIndex;
              fieldIndex += 1
            ) {
              const fieldToken = lex[fieldIndex];
              if (fieldToken?.kind === "lbracket") {
                depth += 1;
              } else if (fieldToken?.kind === "rbracket") {
                depth -= 1;
              } else if (depth === 0 && fieldToken?.kind === "name") {
                fieldDeclIndexes.add(fieldIndex);
                fieldNames.add(fieldToken.text.toLowerCase());
              }
            }
          }
        }
      }
    }
  }

  function previousSignificant(
    index: number,
  ): { readonly index: number; readonly token: LexToken } | undefined {
    let cursor = index - 1;
    while (cursor >= 0 && lex[cursor]?.kind === "newline") {
      cursor -= 1;
    }
    const token = cursor >= 0 ? lex[cursor] : undefined;
    return token === undefined ? undefined : { index: cursor, token };
  }

  /**
   * Tag `openIndex` and its depth-matched close bracket with `role`; returns the close bracket's
   * index (or `undefined` when the bracket never closes) so callers that need to inspect what's
   * between the pair — such as `struct <type> [ field … ]`'s field names (#120) — don't have to
   * re-run their own depth-matching scan.
   */
  function applyPositionalRole(
    openIndex: number,
    role: BracketRole,
  ): number | undefined {
    roleByIndex.set(openIndex, role);
    let depth = 1;
    let index = openIndex + 1;
    // Loop until the matching close brings `depth` back to 0 — a genuinely reachable exit hit
    // by every properly-closed pattern/field-list bracket — or bail out early on `eof` for an
    // unclosed one (`tokenize()` always appends a final `eof` token, so this always terminates).
    while (depth > 0) {
      const token = lex[index];
      if (token?.kind === "lbracket") {
        depth += 1;
      } else if (token?.kind === "rbracket") {
        depth -= 1;
      } else if (token?.kind === "eof") {
        return undefined;
      }
      index += 1;
    }
    const closeIndex = index - 1;
    roleByIndex.set(closeIndex, role);
    return closeIndex;
  }

  // Comments live in the whitespace gaps `tokenize()` already skips; scan those gaps only, so
  // string/name/number/operator tokens are never re-inspected (atomicity, spec/tooling.md:25-26).
  const comments = collectComments(source, document, lex);

  const mergedAway = new Set<number>();
  for (const startIndex of negativeMergeStarts) {
    mergedAway.add(startIndex + 1);
  }

  function classifyName(index: number, token: ContentToken): Token {
    if (dictKeyIndexes.has(index)) {
      return {
        class: "dict-key",
        text: token.text,
        source_span: token.source_span,
      };
    }
    if (contextualKeywordIndexes.has(index)) {
      return {
        class: "keyword",
        text: token.text,
        source_span: token.source_span,
      };
    }
    // Semantic disambiguation (#120): a name resolved by symbol discovery to a user procedure,
    // struct type, or struct field takes priority over the plain reserved-word/primitive
    // fallback below — this is exactly what lets a reserved-word-spelled field/procedure name
    // (e.g. a field literally named `repeat`) stay its resolved class instead of `keyword`.
    if (procDeclIndexes.has(index) || procCallIndexes.has(index)) {
      return {
        class: "procedure-name",
        text: token.text,
        source_span: token.source_span,
        declaration: procDeclIndexes.has(index),
      };
    }
    if (typeDeclIndexes.has(index) || typeCallIndexes.has(index)) {
      return {
        class: "type-name",
        text: token.text,
        source_span: token.source_span,
        declaration: typeDeclIndexes.has(index),
      };
    }
    if (fieldDeclIndexes.has(index) || fieldAccessIndexes.has(index)) {
      return {
        class: "field-name",
        text: token.text,
        source_span: token.source_span,
        declaration: fieldDeclIndexes.has(index),
      };
    }
    const lower = token.text.toLowerCase();
    if (OL_WORD_OPERATORS.has(lower)) {
      return {
        class: "operator",
        text: token.text,
        source_span: token.source_span,
      };
    }
    // A profile block-head — Sprites' `ask`/`each` and its mode-switch command `tell`, which takes
    // no block, and Interaction's `when`/`every`/`on_key`/`on_click` — joins the Core keywords, but
    // only WHILE ITS PROFILE IS ACTIVE (`spec/tooling.md:30`, "Profile words — a profile's
    // block-heads and its mode-switch commands — take this class while their profile is active").
    // With the
    // profile inactive it falls through to `primitive`, which is where `:31` puts "a profile word
    // whose profile is inactive". Those two clauses are the whole rule, and they are why this
    // classifier needs an active-profile set at all (issue #740). Which words those are is declared
    // per name as `tokenClass` in `spec/built-in-names.json`, and `npm run built-in-names` re-paints
    // every one of them through this function to check both halves (issue #959).
    //
    // `isKeyword`'s two-argument form IS this rule — `keywords.ts` defines it as the Core list OR
    // an active profile's words — so the registry stays the single entry point rather than this
    // file re-deriving the disjunction.
    //
    // Deliberately checked HERE, after symbol discovery rather than before it: `spec/tooling.md:30`
    // says "[Disambiguating identifiers] is what demotes a token to `procedure-name`, `type-name`,
    // or `field-name` once parsing or symbol discovery resolves it", so a program's own
    // `define ask … end` stays `procedure-name` under an active Sprites profile. Hoisting this
    // above the discovery block would silently reverse that.
    //
    // Profile *primitives* are NOT affected and must not be: the Sound commands, Interaction's
    // `wait`/`input`, and the Sprites reporters are ordinary primitives under every profile set
    // (`:31`, "profile primitives when enabled"). Only the block-heads and `tell` move.
    if (isKeyword(lower, activeProfiles)) {
      return {
        class: "keyword",
        text: token.text,
        source_span: token.source_span,
      };
    }
    return {
      class: "primitive",
      text: token.text,
      source_span: token.source_span,
    };
  }

  function withRole(base: Token, role: BracketRole | undefined): Token {
    return role === undefined ? base : { ...base, role };
  }

  /**
   * Attach `global` to a `name`/`word` token that the resolver identified as naming a variable —
   * a `set` target's bare place head, or a `make`/`thing` word literal (issue #826, round-2 review).
   * A token the resolver did not identify keeps no field at all, which is what distinguishes
   * "names a variable, and it is not global" from "names no variable". `:variable` tokens are
   * handled directly below instead, because the field is total there.
   */
  function withGlobalFlag(base: Token, index: number): Token {
    const resolved = variableGlobalByIndex.get(index);
    return resolved === undefined ? base : { ...base, global: resolved };
  }

  function classifyToken(index: number, token: ContentToken): Token {
    if (negativeMergeStarts.has(index)) {
      const numberToken = lex[index + 1] as LexToken;
      return {
        class: "number",
        text: token.text + numberToken.text,
        source_span: makeSpan(
          document,
          token.source_span.start,
          numberToken.source_span.end,
        ),
      };
    }
    switch (token.kind) {
      case "number":
        return {
          class: "number",
          text: token.text,
          source_span: token.source_span,
        };
      case "word":
        return withGlobalFlag(
          {
            class: "word/string",
            text: token.text,
            source_span: token.source_span,
          },
          index,
        );
      case "variable":
        return {
          class: ":variable",
          text: token.text,
          source_span: token.source_span,
          declaration: paramDeclIndexes.has(index),
          global: variableGlobalByIndex.get(index) ?? false,
        };
      case "lbrace":
      case "rbrace":
        return {
          class: "brace",
          text: token.text,
          source_span: token.source_span,
        };
      case "lparen":
      case "rparen":
        return {
          class: "paren",
          text: token.text,
          source_span: token.source_span,
        };
      case "dot":
        return {
          class: "index/dot",
          text: token.text,
          source_span: token.source_span,
        };
      case "colon":
        return {
          class: "operator",
          text: token.text,
          source_span: token.source_span,
        };
      case "op":
        return {
          class: "operator",
          text: token.text,
          source_span: token.source_span,
        };
      case "lbracket":
      case "rbracket": {
        const role = roleByIndex.get(index);
        const base: Token =
          role === "selector"
            ? {
                class: "index/dot",
                text: token.text,
                source_span: token.source_span,
              }
            : {
                class: "bracket",
                text: token.text,
                source_span: token.source_span,
              };
        return withRole(base, role);
      }
      case "name":
        return withGlobalFlag(classifyName(index, token), index);
    }
  }

  const output: Token[] = [];
  let commentCursor = 0;
  // `tokenize()` always appends a synthetic `eof` token positioned at the true end of the
  // source (`tokens.ts`), so every comment's start position is at/before the final loop
  // iteration's `eof` token — the flush below always drains `comments` before the loop ends;
  // there is no leftover to flush afterwards.
  for (let index = 0; index < lex.length; index += 1) {
    const token = lex[index] as LexToken;
    while (
      commentCursor < comments.length &&
      isAtOrBefore(
        (comments[commentCursor] as Token).source_span.start,
        token.source_span.start,
      )
    ) {
      output.push(comments[commentCursor] as Token);
      commentCursor += 1;
    }
    if (!isContentToken(token) || mergedAway.has(index)) {
      continue;
    }
    const splitValueStart = dictColonSplits.get(index);
    if (splitValueStart !== undefined) {
      // A glued dict-entry value (`{ a:foo }`) lexed as one `variable`-kind token spanning
      // `:foo`; emit the operator `:` and the value's own real classification separately,
      // matching a normally-spaced entry's two tokens (spec/tooling.md:39,41).
      output.push({
        class: "operator",
        text: ":",
        source_span: makeSpan(
          document,
          token.source_span.start,
          splitValueStart,
        ),
      });
      const nameToken: ContentToken = {
        kind: "name",
        text: token.text.slice(1),
        value: "",
        source_span: makeSpan(document, splitValueStart, token.source_span.end),
      };
      output.push(classifyName(index, nameToken));
      continue;
    }
    output.push(classifyToken(index, token));
  }
  return output;
}

/**
 * Comments are pure whitespace to {@link tokenize} (`tokens.ts` skips `#`, `//`, and `/* ... *\/`
 * without pushing a token or preserving their span/text anywhere) — by design, not oversight, so
 * there is no comment data for `highlight` to "reuse" from the token stream. Recovering them is
 * therefore necessarily a second scan, but a narrow one: it only walks the gaps *between*
 * consecutive real tokens (any *successfully* tokenized content is never part of a gap) and only
 * ever recognizes comment *start* markers (`#`, `//`, `/*`) plus their close, using the exact same
 * marker rules and line/column bookkeeping {@link tokenize} itself uses (see
 * {@link buildOffsetIndex}). It never re-tokenizes or re-classifies a string, name, number,
 * bracket, or operator — those all still come from `lex`. The one caveat is an *unclosed*
 * `"..."`/`"""..."""` string: `tokenize` still consumes its characters but pushes no `word` token
 * for it (`tokens.ts`'s `"` branch only calls `push` when `closed` is true), so that content can
 * land inside a gap too — `scanGap` below bails out the moment it sees a bare `"`, since that can
 * only mean failed string content, never a real comment. Teaching {@link tokenize} itself to
 * preserve comment (and unclosed-string) trivia would remove this scan entirely, but that is a
 * shared, cross-cutting change to the lexer (used by the parser, runtime, and checker) outside
 * this issue's declared write-set — left as a follow-up, not bundled here.
 */
function collectComments(
  source: string,
  document: string,
  lex: readonly LexToken[],
): Token[] {
  const chars = [...source];
  const offsetOf = buildOffsetIndex(chars);
  const comments: Token[] = [];
  let previousEnd: Position = [1, 1];
  for (const token of lex) {
    scanGap(previousEnd, token.source_span.start);
    previousEnd = token.source_span.end;
  }
  return comments;

  function scanGap(from: Position, to: Position): void {
    const startOffset = offsetOf.get(posKey(from));
    const endOffset = offsetOf.get(posKey(to));
    if (
      startOffset === undefined ||
      endOffset === undefined ||
      startOffset >= endOffset
    ) {
      return;
    }
    let index = startOffset;
    let line = from[0];
    let column = from[1];
    // Every call site below only ever invokes `advanceOne` while `index` still addresses a real
    // character: either `index < endOffset` (and `endOffset` is itself a real offset into
    // `chars`) is checked first, or (for the 2-character `/*`/`*/` delimiters) the position was
    // already read as a real, non-`undefined` character just before advancing past it.
    const advanceOne = (): string => {
      const ch = chars[index] as string;
      index += 1;
      if (ch === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      return ch;
    };
    while (index < endOffset) {
      const ch = chars[index];
      // An unclosed `"..."` or `"""..."""` string is consumed by `tokenize` (advancing its
      // cursor) without ever pushing a `word` token (`tokens.ts`'s `"` branch only calls `push`
      // when `closed` is true) — so its content silently lands inside a "gap" here too, breaking
      // the "a gap holds only whitespace/comments" invariant. A bare `"` can only appear in a gap
      // for this reason (any successfully closed string IS a real token, so its span is never
      // part of a gap), so once one is seen the remainder of this gap is unclassifiable failed
      // string content, not comments — stop scanning it immediately rather than risk misreading
      // e.g. a `#`/`//` inside it as a real comment.
      if (ch === '"') {
        return;
      }
      if (ch === "#" || (ch === "/" && chars[index + 1] === "/")) {
        const start: Position = [line, column];
        let text = "";
        while (index < endOffset && chars[index] !== "\n") {
          text += advanceOne();
        }
        comments.push({
          class: "comment",
          text,
          source_span: makeSpan(document, start, [line, column]),
        });
        continue;
      }
      if (ch === "/" && chars[index + 1] === "*") {
        const start: Position = [line, column];
        let text = advanceOne() + advanceOne();
        while (
          index < endOffset &&
          !(chars[index] === "*" && chars[index + 1] === "/")
        ) {
          text += advanceOne();
        }
        if (index < endOffset) {
          text += advanceOne();
          text += advanceOne();
        }
        comments.push({
          class: "comment",
          text,
          source_span: makeSpan(document, start, [line, column]),
        });
        continue;
      }
      advanceOne();
    }
  }
}

/** Map every `[line, column]` position in `chars` to its code-point offset, mirroring the
 * exact `advance()` line/column bookkeeping {@link tokenize} uses (so gap lookups always hit). */
function buildOffsetIndex(chars: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  let line = 1;
  let column = 1;
  for (let index = 0; index <= chars.length; index += 1) {
    map.set(posKey([line, column]), index);
    if (index === chars.length) {
      break;
    }
    const ch = chars[index];
    if (ch === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return map;
}
