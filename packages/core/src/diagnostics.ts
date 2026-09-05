/**
 * The `ol-*` diagnostic contract — the normative shape every OpenLogo finding takes, plus
 * the stable code registry. Owned by `@openlogo/core`; parser and runtime emit these, and
 * studio, tests, and the tutor consume them. Never throw bare strings or invent an `ol-*`
 * code in implementation code — the namespace is reserved by
 * [`spec/error-model.md`](../../../spec/error-model.md); a genuinely new code is a
 * maintainer-owned spec change.
 */

import type { SourceSpan } from "./spans.js";
import { OLDict, OLRecord, OLTurtle } from "./values.js";

/**
 * The normative `ol-*` error/semantic/runtime code registry from `spec/error-model.md`.
 * Kept as data (`as const`) so tooling can enumerate it and {@link DiagnosticCode} derives
 * from it — one source of truth, no scattered string literals.
 */
export const OL_DIAGNOSTIC_CODES = [
  "ol-unknown-command",
  "ol-not-enough-inputs",
  "ol-too-many-inputs",
  "ol-type",
  "ol-range",
  "ol-undefined-var",
  "ol-unmatched-bracket",
  "ol-unmatched-brace",
  "ol-unmatched-paren",
  "ol-missing-end",
  "ol-mismatched-end",
  "ol-unclosed-comment",
  "ol-unclosed-string",
  "ol-bad-token",
  "ol-div-zero",
  "ol-neg-sqrt",
  "ol-tan-undefined",
  "ol-no-output",
  "ol-no-value",
  "ol-return-outside-proc",
  "ol-return-in-comprehension",
  "ol-duplicate-binder",
  "ol-stop-outside-proc",
  "ol-repcount-outside-repeat",
  "ol-limit",
  "ol-user-error",
  "ol-not-boolean",
  "ol-bad-color",
  "ol-reserved-word",
  "ol-duplicate-definition",
  "ol-unknown-type",
  "ol-unknown-field",
  "ol-unknown-key",
  "ol-not-a-place",
  "ol-not-implemented",
] as const;

/** A stable `ol-*` diagnostic code from the normative registry. */
export type DiagnosticCode = (typeof OL_DIAGNOSTIC_CODES)[number];

/**
 * Style-lint codes. These reuse the diagnostic shape with `severity: "warning"` and MUST
 * NOT change program meaning. `spec/tooling.md:240-254` registers 13 `ol-style-*` codes; issue
 * #115 slice 1 wired `ol-style-useless-value`, `ol-style-equality-confusion`, and
 * `ol-style-name-case`; #169 slice 2a added `ol-style-magic-number` and
 * `ol-style-predicate-name`; slice 2b (this one) adds the layout group —
 * `ol-style-one-command-per-line`, `ol-style-deep-nesting`, `ol-style-block-indentation`, and
 * `ol-style-prefer-block` — the remaining four (`ol-style-full-name`, `ol-style-procedure-name`,
 * `ol-style-comment-style`, `ol-style-hidden-abstraction`) are tracked in the #169 follow-up
 * issue.
 *
 * Issue #828 adds `ol-style-nested-handler`, the first code in this family that is not sourced
 * from `spec/style-guide.md`: it comes from the #828 ruling, which pairs the runtime's instruction
 * budget (the guard that *bounds* unbounded handler accumulation) with a check-time lint that
 * *teaches* why it happens. The budget catches; the lint explains. Registered normatively in
 * `spec/tooling.md`'s "Layer 3: style lints" table alongside the other codes.
 */
export const OL_STYLE_DIAGNOSTIC_CODES = [
  "ol-style-useless-value",
  "ol-style-equality-confusion",
  "ol-style-name-case",
  "ol-style-magic-number",
  "ol-style-predicate-name",
  "ol-style-one-command-per-line",
  "ol-style-deep-nesting",
  "ol-style-block-indentation",
  "ol-style-prefer-block",
  "ol-style-nested-handler",
] as const;

/** A stable `ol-style-*` linter code. */
export type StyleDiagnosticCode = (typeof OL_STYLE_DIAGNOSTIC_CODES)[number];

/** When the finding was discovered: reading structure, understanding it, or running it. */
export type DiagnosticStage = "parse" | "semantic" | "runtime";

/** Errors stop execution; style warnings never change meaning. There is no `info`. */
export type DiagnosticSeverity = "error" | "warning";

/** Optional extra detail for `debug`, developer tools, and advanced learners. */
export interface DiagnosticDebug {
  /** Innermost call first. */
  readonly procedure_stack?: readonly string[];
  /** Observable state after the error was reported. */
  readonly state_after_error?: unknown;
}

/**
 * A single diagnostic. `code` + `params` are the identity; `message` is localizable prose
 * derived from them — tools MUST NOT parse the English message.
 */
export interface Diagnostic {
  /** Stable identity from {@link OL_DIAGNOSTIC_CODES} or an `ol-style-*` code. */
  readonly code: DiagnosticCode | StyleDiagnosticCode;
  /** The source location that best explains the finding. */
  readonly source_span: SourceSpan;
  /** Structured data used for identity, repair, telemetry, and localization. */
  readonly params: Readonly<Record<string, unknown>>;
  /** Learner-facing prose generated from `code` and `params`. */
  readonly message: string;
  /** Parse, semantic, or runtime. */
  readonly stage: DiagnosticStage;
  /** Error or warning. */
  readonly severity: DiagnosticSeverity;
  /** Optional detail for tooling; off by default for learners. */
  readonly debug?: DiagnosticDebug;
}

/** Type guard: is `value` a registered `ol-*` diagnostic code? */
export function isDiagnosticCode(value: string): value is DiagnosticCode {
  return (OL_DIAGNOSTIC_CODES as readonly string[]).includes(value);
}

/**
 * The identity of one *fault*, as `spec/execution-model.md:741-748` defines it for the
 * de-duplication rule: `code` + `params` (diagnostic identity per `spec/error-model.md:255-260`)
 * plus `source_span` (the location). `message` is derived prose and `stage` is deliberately
 * **excluded** — the spec says outright that `stage` "records when the fault was found, not which
 * fault it is", so the same fault reported at `semantic` and again at `runtime` is one fault.
 *
 * `params` are serialized **canonically**: keys are sorted at every depth, so two findings carrying
 * the same entries in a different insertion order compare equal. Two rules can legitimately build
 * the same params object field-by-field in different orders, and an identity that depended on that
 * order would silently let the duplicate through. Sorting only the top level is not enough —
 * `ol-duplicate-definition`'s `original_span` is itself an object (a normative `params` entry,
 * `spec/error-model.md:144-147`), and two identical findings whose nested keys were inserted in
 * different orders were measured surviving as two.
 *
 * Beyond ordering, the encoding must be **injective**, **total**, and **cycle-safe**, and all three
 * fail in the same direction. A missed duplicate is merely visible — the learner reads the same
 * fault twice. A *collision* or a crash is silent or wrong: two different faults are judged one and
 * the second is discarded, or the de-duplicator itself throws and replaces the diagnostic a program
 * was owed. That is intolerable in the one component whose entire job is deciding which findings
 * survive. Three review rounds each found the previous encoding failing one of the three:
 *
 * - **Injective by construction.** Values are not rendered structurally: an object's sorted entry
 *   list is byte-identical to a literal array of the same pairs, and `params` carry both (an object
 *   in `original_span`, arrays in `expected`). Every value emits a **type tag**, and strings are
 *   **length-prefixed**, so no payload can be mistaken for a different shape's rendering.
 *   Type-tagging is what separates the number `NaN` from the word `"NaN"`, and `undefined` from the
 *   word `"undefined"` — a round that encoded special atoms *by name* made all four pairs collide,
 *   and its test compared the specials only against each other, never against their spellings.
 * - **`OLValue`s are read through their own accessors, not through `Object.keys`.** `OLDict` and
 *   `OLRecord` hold their contents in a *private* `Map`, which `Object.keys` reports as empty — so
 *   every dict collapsed onto every other dict, and `ol-type {actual: {a: 1}}` and
 *   `{actual: {a: 2}}` at one span were one fault. Each collection is snapshotted **once**; asking
 *   `values()` per key rebuilt the whole collection per entry, which is quadratic (~280 ms at 8,000
 *   entries). A turtle is encoded by `id`: `spec/execution-model.md:552` requires two turtles to be
 *   `==` when they are the "Same turtle identity" but says nothing about how identity is
 *   represented — that `id` *is* the representation is {@link OLTurtle}'s own contract, not the
 *   spec's. (An earlier draft of this comment cited the spec for the second claim as well. It
 *   resolved and did not support it, which is the failure mode `npm run spec-citations` prints that
 *   it cannot see.)
 * - **Total, including deep and cyclic values.** The traversal is **iterative over an explicit
 *   stack**, so it does not consume the host call stack. Recursion failed twice here: on
 *   `:x = []  add :x to :x  forward :x`, whose cycle looped forever, and then on a merely *deep*
 *   value — ~1,500 nested lists, which a program can build — where the `RangeError` surfaced as
 *   `ol-limit` in place of the `ol-type` the program was owed. A cycle is emitted as a
 *   back-reference to the depth of the value it revisits.
 *
 * `params` is `Record<string, unknown>`, not `OLValue`, so this is deliberately **total over
 * anything a host can put there** — including a `bigint`, which `JSON.stringify` throws on. An
 * exotic value gets its type tag and its `String()` form rather than an exception. An earlier draft
 * argued the opposite, that a `bigint` arm would be unreachable because `OLValue` has none; that
 * reasoned from the wrong type, and the reachable consequence was a throw inside the component
 * whose job is deciding which diagnostics survive.
 */
function canonicalize(value: unknown): string {
  const out: string[] = [];
  /** The chain of containers currently open, for cycle detection by depth. */
  const path: unknown[] = [];
  /**
   * Explicit work stack. Each entry is either a one-element array holding the value to encode, or
   * `null` marking "the container opened here is finished". The wrapper array matters: a value to
   * encode may itself be `null`, and boxing keeps that from reading as the sentinel.
   */
  const work: (readonly [unknown] | null)[] = [[value]];

  while (work.length > 0) {
    const item = work.pop();
    if (item === undefined || item === null) {
      path.pop();
      out.push(")");
      continue;
    }
    out.push(encodeAtomOrOpen(item[0], path, work));
  }
  return out.join("");
}

/** A string rendered so it cannot be confused with anything around it. */
function tagged(tag: string, text: string): string {
  return `${tag}${text.length}:${text}`;
}

/**
 * Emit `value`'s encoding, pushing its children onto `work` when it is a container. Returns the
 * text to append; container children are pushed in reverse so they are visited in order, with a
 * `null` sentinel beneath them to close the group and pop the cycle path.
 */
function encodeAtomOrOpen(
  value: unknown,
  path: unknown[],
  work: (readonly [unknown] | null)[],
): string {
  const seenAt = path.indexOf(value);
  if (seenAt !== -1) {
    return `cyc${seenAt};`;
  }
  switch (typeof value) {
    case "undefined":
      return "und;";
    case "boolean":
      return value ? "bool1;" : "bool0;";
    case "number":
      // `Object.is` separates -0 from 0, which `String()` renders identically.
      return tagged("num", Object.is(value, -0) ? "-0" : `${value}`);
    case "string":
      return tagged("str", value);
    case "object":
      break;
    default:
      // bigint, symbol, function — not `OLValue`s, but `params` is `Record<string, unknown>`.
      return tagged(typeof value, String(value));
  }
  if (value === null) {
    return "nul;";
  }

  path.push(value);
  work.push(null);
  const children: unknown[] = [];
  let head: string;
  if (Array.isArray(value)) {
    head = `arr${value.length}(`;
    children.push(...value);
  } else if (value instanceof OLDict) {
    const keys = value.keys();
    const values = value.values();
    head = `dict${keys.length}(`;
    for (let index = 0; index < keys.length; index++) {
      children.push(keys[index], values[index]);
    }
  } else if (value instanceof OLRecord) {
    const fields = value.fields();
    head = `rec${tagged("", value.type)}${fields.length}(`;
    for (const field of fields) {
      children.push(field, value.get(field));
    }
  } else if (value instanceof OLTurtle) {
    head = `turtle${value.id}(`;
  } else {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    head = `obj${keys.length}(`;
    for (const key of keys) {
      children.push(key, (value as Record<string, unknown>)[key]);
    }
  }
  for (let index = children.length - 1; index >= 0; index--) {
    work.push([children[index]]);
  }
  return head;
}

function faultIdentity(diagnostic: Diagnostic): string {
  const span = diagnostic.source_span;
  return [
    diagnostic.code,
    span.document,
    `${span.start[0]},${span.start[1]}`,
    `${span.end[0]},${span.end[1]}`,
    canonicalize(diagnostic.params),
  ]
    .map((part) => tagged("", part))
    .join("");
}

/**
 * Report each fault once — `spec/execution-model.md:741-748`'s **de-duplication** half of *one
 * fault, one diagnostic*. Findings sharing a {@link faultIdentity} collapse to the FIRST one, and
 * the surviving order is the input order, so the earliest and most specific report is the one a
 * learner reads.
 *
 * It lives in core because more than one producer now has to obey it: the reader collapses the two
 * findings its own recovery paths can push for a single fault, and the check-before-run gate
 * (`spec/execution-model.md:632-694`) merges Layer 1's and Layer 2's collections, where the same
 * fault can legitimately be found twice — once statically, once again at run time under the
 * unchecked-run opt-out. A rule two packages implement separately is a rule they can drift on.
 */
export function dedupeDiagnostics(
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  const seen = new Set<string>();
  const result: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const identity = faultIdentity(diagnostic);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    result.push(diagnostic);
  }
  return result;
}
