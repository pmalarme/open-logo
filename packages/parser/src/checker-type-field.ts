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
 * **`ol-unknown-field`** is the record-field half, split between a pure resolver
 * ({@link resolveRecordField}) and a narrowly scoped static rule ({@link unknownFieldRule}). Field
 * resolution needs a record's statically known struct type and its declared field set — both from a
 * `struct` declaration, formally part of the **Data** profile (`spec/data-structures.md`).
 * {@link unknownFieldRule} wires the *statically knowable* slice: a `.field` **read** whose base is
 * a direct struct-constructor call — `(point 0 0).z` — has a type the checker knows exactly, so an
 * unknown field is reported at `check()` time (`spec/tooling.md:193`: a tool SHOULD report a
 * statically knowable use of an otherwise-runtime code; `:186` lists `ol-unknown-field` in the
 * checker table). It deliberately does **not** touch a `:p.field` access: statically resolving that
 * needs `:p`'s struct type, which in turn needs tracking a variable's type across assignments —
 * exactly the speculative inference `spec/tooling.md:196-200` forbids when a value is only known
 * dynamically. The runtime (`@openlogo/runtime`) therefore stays the authoritative source of
 * `ol-unknown-field` for the variable-base case: it validates every field read/write against the
 * record's actual declared fields at execution time (issue #329), reusing this module's
 * `params`/message shape so both layers agree on the diagnostic's identity. {@link knownTypeWords}
 * is likewise wired into `check()` and collects declared struct type names so `is a <struct-type>`
 * resolves.
 */

import type { Diagnostic, SourceSpan } from "@openlogo/core";
import type {
  ExpressionNode,
  PostfixExpressionNode,
  ProgramNode,
  StructDefNode,
} from "./ast.js";
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
 * never a hardcoded "every optional profile active" set. When `"data"` is active, every declared
 * `struct` type name in `program` also joins the set, so `is a <struct-type>` resolves for a type
 * the program itself declared (`spec/error-model.md:124`: a known built-in type *or declared
 * struct*) — matching the runtime's own `is_a?` type-word recognition (issue #329).
 */
function knownTypeWords(
  program: ProgramNode,
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
    walk(program, (node) => {
      if (node.kind === "StructDef") {
        words.add(node.name.name);
      }
    });
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
  const known = knownTypeWords(program, profiles);
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
 * This is the pure resolution logic for `ol-unknown-field`. {@link unknownFieldRule} is the
 * Data-profile walk that builds a {@link RecordFieldAccess} for every statically typed
 * struct-constructor field read and calls this resolver; a Core program declares no `struct`, so
 * that walk collects no types and this stays unreached from a Core `check()` (module doc comment).
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

/**
 * Every declared `struct` type in `program`, keyed by its canonical **lowercased** type name —
 * mirroring `@openlogo/runtime`'s phase-1 struct registry (`execute-internal.ts`'s `collectStructs`,
 * `evaluate.ts`'s `StructRegistry`), which keys by the same lowercased name so a constructor call
 * resolves case-insensitively like every other command name. The stored {@link StructDefNode}
 * carries the declared type name (case-preserved, exactly as the runtime records on a value's
 * `type`) and its declared field names in order, so {@link unknownFieldRule} resolves against the
 * very same type name and field set the runtime does. A later `struct` of the same name overwrites
 * the earlier one — a duplicate type name is a collision the runtime/reserved-word checks own, not
 * this rule's.
 */
function collectStructTypes(
  program: ProgramNode,
): ReadonlyMap<string, StructDefNode> {
  const structs = new Map<string, StructDefNode>();
  walk(program, (node) => {
    if (node.kind === "StructDef") {
      structs.set(node.name.name.toLowerCase(), node);
    }
  });
  return structs;
}

/**
 * The lowercased struct type name `base` denotes when it is a *direct* struct-constructor call — a
 * {@link CallNode} or a parenthesized {@link ParenCallNode}, the same two call shapes
 * `checker-arity.ts` recognizes as struct constructors. Any other base — a `:variable` read, a
 * list/dict literal, a nested postfix read — returns `undefined`: its value's struct type is only
 * known dynamically, so {@link unknownFieldRule} leaves it to the runtime (the speculation boundary
 * described in the module doc comment).
 *
 * In practice a struct constructor *with arguments* only ever reaches a postfix base parenthesized
 * (`(point 0 0).z`, a `ParenCall`) — a bare `point 0 0 .z` is not a parseable postfix base — so a
 * struct match always arrives via `ParenCall`. The `Call` arm still keeps the recognition uniform
 * with `checker-arity.ts` for any bare zero-argument call base (a struct match through it just never
 * happens today), rather than silently diverging from the sibling rule.
 */
function structConstructorType(base: ExpressionNode): string | undefined {
  if (base.kind === "Call" || base.kind === "ParenCall") {
    return base.callee.name.toLowerCase();
  }
  return undefined;
}

/**
 * The `ol-unknown-field` static rule (issue #441): a postfix `.field` **read** whose base is a
 * direct struct-constructor call of a declared `struct` type raises `ol-unknown-field` when `field`
 * is not one of that struct's declared fields, reusing {@link resolveRecordField}'s params, message,
 * and field-segment span so the static and runtime halves share the diagnostic's identity. Gated on
 * the `data` profile, since `struct` — hence any statically known record type — is a Data-profile
 * feature; when Data is inactive the constructor name is not a known callee at all
 * (`ol-unknown-command`'s concern) and there is no static record type to resolve against.
 *
 * Scope is deliberately narrow (`spec/tooling.md:196` forbids speculative inference):
 * - **Direct struct-constructor base only.** `(point 0 0).z` is checked; a `:variable.field` base
 *   is not — inferring `:p`'s struct type across assignments is the forbidden speculation, so the
 *   runtime stays authoritative there (issue #329).
 * - **Read positions only.** A postfix in assignment-target position (`Assign.place`, both the `=`
 *   and `set … to` forms) is excluded: a constructor result is not an assignable place whether or
 *   not the field exists (`ol-not-a-place`, `checker-not-a-place.ts`, owns that case), so field
 *   existence is irrelevant to the write. The read on an assignment's RHS (`:x = (point 0 0).z`) is
 *   not a target and *is* checked.
 * - **One level deep.** Only the first segment is resolved; a struct field's own value type is not
 *   statically tracked, so `(point 0 0).x.foo` checks the valid `.x` (⇒ clean) and leaves `.foo`
 *   to the runtime.
 */
export function unknownFieldRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  if (!profiles.includes("data")) {
    return [];
  }
  const structs = collectStructTypes(program);

  // A postfix in assignment-target position is excluded from field checking (see "Read positions
  // only"). A pre-order `walk` visits an `Assign` before its `place` child, so recording the target
  // here reliably excludes it by identity when the walk later reaches that same postfix node.
  const assignmentTargets = new Set<PostfixExpressionNode>();
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    if (node.kind === "Assign") {
      if (node.place.kind === "PostfixExpression") {
        assignmentTargets.add(node.place);
      }
      return;
    }
    if (node.kind !== "PostfixExpression" || assignmentTargets.has(node)) {
      return;
    }
    const typeName = structConstructorType(node.base);
    if (typeName === undefined) {
      return;
    }
    const def = structs.get(typeName);
    if (def === undefined) {
      return;
    }
    const declaredFields = def.fields.map((field) => field.name);
    for (const [index, segment] of node.segments.entries()) {
      if (index === 0 && segment.kind === "field") {
        const diagnostic = resolveRecordField({
          type: def.name.name,
          field: segment.name.name,
          declaredFields,
          write: false,
          span: segment.source_span,
        });
        if (diagnostic !== undefined) {
          diagnostics.push(diagnostic);
        }
      }
    }
  });

  return diagnostics;
}
