/**
 * Type/field resolution (issue #112): the `ol-unknown-type` semantic rule plus the
 * `ol-unknown-field` record-field resolution primitive.
 *
 * **`ol-unknown-type`** is the Core-observable half and is fully wired into `check()` (see
 * {@link unknownTypeRule}). A worded `is a <type-word>` predicate carries a *literal* type word
 * in the grammar (`spec/execution-model.md:161-166`: "The worded `is a` form takes a literal type
 * word in the grammar, so at runtime only an unknown type word can occur and it raises
 * `ol-unknown-type`"), so the AST hands us a {@link WordLitNode} we can resolve statically. A type
 * word that names neither a built-in type nor a declared struct raises `ol-unknown-type`
 * (`spec/error-model.md`: `params = { name }`, `stage: semantic`). The prefix `is_a? value type`
 * form is deliberately *not* checked here: its type argument is an ordinary, dynamically evaluated
 * call argument, and `spec/tooling.md:198-200` requires tools MUST NOT report speculative type
 * errors when dynamic values are unknown.
 *
 * **`ol-unknown-field`** ({@link resolveRecordField}) is the record-field half. Field resolution
 * needs a record's statically known struct type and its declared field set — both of which come
 * from a `struct` declaration, formally part of the **Data** profile (`spec/data-structures.md`).
 * Core has no `struct` surface and no `StructDef` AST node yet, so no Core-profile program can
 * construct a record, and therefore no `core-language` conformance fixture can trigger
 * `ol-unknown-field`. Per the #96 observability-caveat pattern, this slice implements the pure
 * resolution *logic* and unit-tests it directly; it is intentionally **not** wired into
 * `check()`'s walk (there is nothing to resolve against at Core). The Data profile's
 * struct-registration slice adds the `StructDef` walk that feeds records into this primitive and
 * lands the matching Data-profile conformance coverage.
 */

import type { Diagnostic, SourceSpan } from "@openlogo/core";
import type { ProgramNode } from "./ast.js";
import { walk } from "./ast.js";
import type { CheckProfile } from "./check.js";

/**
 * The built-in type words `is a` accepts under the **Core Language** profile — the four Core
 * value types from `spec/execution-model.md`'s type table (`number`, `word`, `list`, `boolean`).
 * Type words are literal words and are matched exactly (words preserve case; the type registry
 * keys are lowercase), so `is a "number"` resolves and `is a "Number"` does not.
 */
const CORE_TYPE_WORDS: readonly string[] = [
  "number",
  "word",
  "list",
  "boolean",
];

/**
 * The built-in type words the **Data** profile adds — `dict` and `record`, the two Data value
 * types from the same type table (`spec/execution-model.md` / `spec/data-structures.md`). Present
 * only when `"data"` is in the active profile set, exactly as `spec/tooling.md:175-176` requires.
 */
const DATA_TYPE_WORDS: readonly string[] = ["dict", "record"];

/**
 * Every type word that resolves as a known type under the active `profiles`. Includes the Core
 * built-ins only when `"core-language"` is active and the Data built-ins only when `"data"` is,
 * never a hardcoded "every optional profile active" set. Declared struct type names join this set
 * once the Data profile's `struct`-registration slice exists (there is no `StructDef` AST node to
 * collect from yet — see the module doc comment).
 */
function knownTypeWords(
  profiles: readonly CheckProfile[],
): ReadonlySet<string> {
  const active = new Set(profiles);
  const words = new Set<string>();

  if (active.has("core-language")) {
    for (const word of CORE_TYPE_WORDS) {
      words.add(word);
    }
  }
  if (active.has("data")) {
    for (const word of DATA_TYPE_WORDS) {
      words.add(word);
    }
  }

  return words;
}

/** The learner-facing message template for an unknown type word (`spec/error-model.md` voice). */
function messageForType(name: string): string {
  return `i don't know the type ${name}. check the spelling, or declare it with 'struct'.`;
}

/**
 * The `ol-unknown-type` rule: every worded `is a <type-word>` predicate whose type word is not a
 * known type under the active profiles raises one diagnostic at the type word's span. Other
 * `is`-predicate forms (`is empty`, `is member of`, `is between`) carry no type word and are left
 * untouched, as is the prefix `is_a?` call form (its type argument is dynamic; see the module doc
 * comment).
 */
export function unknownTypeRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  const known = knownTypeWords(profiles);
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    if (node.kind !== "IsPredicate" || node.test.form !== "a") {
      return;
    }
    const typeWord = node.test.type;
    if (known.has(typeWord.value)) {
      return;
    }

    diagnostics.push({
      code: "ol-unknown-type",
      source_span: typeWord.source_span,
      params: { name: typeWord.value },
      message: messageForType(typeWord.value),
      stage: "semantic",
      severity: "error",
    });
  });

  return diagnostics;
}

/**
 * A statically known record-field access: a read or write of `field` on a record of struct type
 * `type` whose declared field set is `declaredFields`, at source span `span`. The Data profile's
 * struct-registration slice builds these from a `struct` declaration plus a `.field` place
 * segment; this shape is the seam between that walk and {@link resolveRecordField}.
 */
export interface RecordFieldAccess {
  /** The record's declared struct type name (e.g. `point`). */
  readonly type: string;
  /** The field being read or written (e.g. `z`). */
  readonly field: string;
  /** The struct type's declared fields, in declaration order (e.g. `["x", "y"]`). */
  readonly declaredFields: readonly string[];
  /** `true` for a write (`:p.z = …` / `set :p.z to …`), `false` for a read. */
  readonly write: boolean;
  /** The span of the offending field segment. */
  readonly span: SourceSpan;
}

/**
 * Resolve a record-field access against its struct type's declared fields: returns an
 * `ol-unknown-field` {@link Diagnostic} when `field` is not one of the record's fixed fields
 * (records never upsert; `spec/data-structures.md`), or `undefined` when the field resolves. The
 * diagnostic carries `params = { type, field }`, plus `write: true` for a write
 * (`spec/error-model.md`: `type`, `field`, optional `write`), at `stage: "semantic"` because a
 * static tool is reporting a statically knowable use of this otherwise-runtime code
 * (`spec/tooling.md:132`, `:196-198`).
 *
 * This is the pure resolution logic for `ol-unknown-field`. It is not yet reachable from
 * `check()` — Core has no way to declare a struct, so no `RecordFieldAccess` can be built from a
 * Core program (module doc comment). The Data profile's struct-access slice supplies the walk that
 * calls this and the matching Data-profile conformance fixtures.
 */
export function resolveRecordField(
  access: RecordFieldAccess,
): Diagnostic | undefined {
  if (access.declaredFields.includes(access.field)) {
    return undefined;
  }

  const params: Record<string, unknown> = access.write
    ? { type: access.type, field: access.field, write: true }
    : { type: access.type, field: access.field };

  return {
    code: "ol-unknown-field",
    source_span: access.span,
    params,
    message: messageForField(access.type, access.field, access.write),
    stage: "semantic",
    severity: "error",
  };
}

/** The learner-facing message template for an unknown record field. */
function messageForField(type: string, field: string, write: boolean): string {
  return write
    ? `${type} has no field ${field}, and records can't grow new fields.`
    : `${type} has no field ${field}. check the spelling.`;
}
