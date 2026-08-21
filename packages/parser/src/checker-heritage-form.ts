/**
 * The Heritage form-head profile gate (issue #667, slice H2): the net-new checker machinery that
 * rejects a Heritage assignment/procedure/return spelling — `make`, `to`, `output`, or `op` — when
 * the Heritage profile is NOT active, and accepts it (silently) when it IS.
 *
 * Unlike the profile *block-heads* (`ask`/`each`/`tell`, the four event heads) — which the reader
 * lowers to a profile-blind {@link ProfileStatementNode} that `ol-unknown-command` already gates via
 * {@link collectVisibleNames} — these four Heritage forms are *special-form spellings* the reader
 * lowers straight onto the SAME Core AST nodes as their Core equivalents, discriminated only by a
 * surface tag: `make` → {@link AssignNode} `form: "make"` (issue #151), `to` →
 * {@link ProcedureDefNode} `keyword: "to"`, and `output`/`op` → {@link ReturnNode} `keyword`. Because
 * they never become a `Call`/`ParenCall`/`ProfileStatement`, no visible-name rule can ever see them,
 * so this dedicated rule is the form-head gate for the whole family — the machinery the slice owns
 * "once for all four forms" (issue #667).
 *
 * Rejection reuses the existing `ol-unknown-command` code (`spec/error-model.md`): to a Core-only
 * learner, `make`/`to`/`output`/`op` are simply words the language does not know here — exactly the
 * "i don't know how to …" story a Core-inactive `tell` already tells — and its `did you mean`
 * suggestion naturally points at the Core equivalent (`set`, `define`, `return`) when it is within
 * edit distance. This keeps the family on one diagnostic identity rather than inventing an ad-hoc
 * "profile-inactive" code the registry does not define.
 *
 * Heritage adds NO new semantics (`spec/conformance.md#heritage` — "alternate spellings only"), so
 * when Heritage IS active this rule is silent and the runtime evaluates each form through the exact
 * same code path as its Core equivalent — there is no divergent Heritage evaluation anywhere.
 *
 * Slice H5 (issue #670) adds the `value of <dict> for key <key>` reader
 * (`spec/grammar.md:213`'s `value-of-reader`) to this same family. Unlike the four form *heads*, it
 * is a four-keyword *reader* form, not an alias-able name — the reader lowers it to a
 * {@link ValueOfKeyNode} whose evaluation is byte-identical to the Core dict read `:d[:k]`/`:d.key`
 * (`spec/data-structures.md:183-195`). It has no single Core *word* equivalent (the Core spelling is
 * the `[]`/`.` selector *syntax*, not a keyword), so — like `ol-unknown-command`'s no-candidate
 * branch (`spec/error-model.md:96`) — its rejection carries no `suggestion`, only the "check the
 * spelling, or define it with 'define'" message, at the `value` head word. Because it operates on a
 * dict, Heritage depends on Data (`spec/conformance.md#heritage`), so an accepting fixture claims
 * both `data` and `heritage`.
 */

import { makeSpan } from "@openlogo/core";
import type { Diagnostic, SourceSpan } from "@openlogo/core";
import type {
  AnyNode,
  AssignNode,
  ProcedureDefNode,
  ProgramNode,
  ReturnNode,
} from "./ast.js";
import { walk } from "./ast.js";
import type { CheckProfile } from "./check.js";
import {
  canonicalOfHeritageFormHead,
  heritageWordedForm,
} from "./signatures.js";
import type { HeritageFormHead } from "./signatures.js";

/**
 * The surface head keyword a Heritage-spelled node was written with, or `undefined` when the node
 * is the Core spelling (`Assign form: "equals"`/`"set"`, `ProcedureDef keyword: "define"`,
 * `Return keyword: "return"`) — which this gate never touches.
 */
function heritageHead(node: AnyNode): HeritageFormHead | undefined {
  if (node.kind === "Assign") {
    return (node as AssignNode).form === "make" ? "make" : undefined;
  }
  if (node.kind === "ProcedureDef") {
    return (node as ProcedureDefNode).keyword === "to" ? "to" : undefined;
  }
  if (node.kind === "Return") {
    const keyword = (node as ReturnNode).keyword;
    return keyword === "output" || keyword === "op" ? keyword : undefined;
  }
  return undefined;
}

/**
 * The source span of the head keyword itself — the node's `source_span` starts exactly at the head
 * word (the reader builds every one of these nodes with `spanFrom(headToken.start, …)`), and the
 * four Heritage heads are all plain single-line lowercase words, so the head span is the node start
 * extended by the keyword's length. Pointing at the head (not the whole statement) matches how
 * `ol-unknown-command` spans a `ProfileStatement`'s keyword.
 */
function headSpan(nodeSpan: SourceSpan, head: string): SourceSpan {
  const [line, column] = nodeSpan.start;
  return makeSpan(nodeSpan.document, nodeSpan.start, [
    line,
    column + head.length,
  ]);
}

/**
 * The learner-facing `ol-unknown-command` message template (`spec/error-model.md:96`). When a Core
 * spelling to point at exists, the did-you-mean names it; the `value of … for key` reader has no
 * single-word Core equivalent, so — like `ol-unknown-command`'s no-candidate branch — it falls back
 * to the "check the spelling, or define it with 'define'" message.
 */
function messageFor(head: string, suggestion: string | undefined): string {
  return suggestion === undefined
    ? `i don't know how to ${head}. check the spelling, or define it with 'define'.`
    : `i don't know how to ${head}. did you mean ${suggestion}?`;
}

/**
 * The `value of … for key` reader head is the literal word `value` (5 chars), so its head span is
 * the node start extended by that length — mirroring {@link headSpan} for the four form heads.
 *
 * Read from the parser's Heritage worded-form registry rather than restated here, so this rule and
 * {@link heritageSurfaceSpellings} can never disagree about what the form's surface word is: the
 * canonical-diagnostic-params guards match that registry's words against every diagnostic's
 * structured params, and a second private copy of the string is precisely how a spelling drifts out
 * from under a guard that looks like it covers it (issue #755).
 */
const VALUE_OF_KEY_HEAD = heritageWordedForm("value-of-reader").head;

/**
 * The Heritage form-head rule: with the Heritage profile inactive, every `make`/`to`/`output`/`op`
 * head — and every `value of … for key` reader — raises one `ol-unknown-command` at the head word.
 * For the four form heads the did-you-mean points at the Core spelling to use instead
 * ({@link canonicalOfHeritageFormHead}); the reader carries no suggestion (its Core equivalent is
 * the `[]`/`.` selector syntax, not a word). With Heritage active, it raises nothing.
 *
 * `params.name` is the *surface* head here, and deliberately so: unlike the canonical-params rule
 * the escape diagnostics follow (`checker-control-flow.ts`, issue #737), this diagnostic's subject
 * IS the word the learner wrote, and its Core twin raises nothing at all — `set x to 1` is simply
 * valid. There is no "same condition, two spellings" pair to keep byte-identical; naming the
 * canonical spelling here would report a word that appears nowhere at the diagnostic's own span.
 */
export function heritageFormRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  if (profiles.includes("heritage")) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    if (node.kind === "ValueOfKey") {
      diagnostics.push({
        code: "ol-unknown-command",
        source_span: headSpan(node.source_span, VALUE_OF_KEY_HEAD),
        params: { name: VALUE_OF_KEY_HEAD },
        message: messageFor(VALUE_OF_KEY_HEAD, undefined),
        stage: "semantic",
        severity: "error",
      });
      return;
    }
    const head = heritageHead(node);
    if (head === undefined) {
      return;
    }
    const suggestion = canonicalOfHeritageFormHead(head);
    diagnostics.push({
      code: "ol-unknown-command",
      source_span: headSpan(node.source_span, head),
      params: { name: head, suggestion },
      message: messageFor(head, suggestion),
      stage: "semantic",
      severity: "error",
    });
  });

  return diagnostics;
}
