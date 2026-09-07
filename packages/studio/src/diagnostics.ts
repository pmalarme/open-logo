/**
 * The diagnostics pane (#125) — a headless, fully-testable view-model + controller over the
 * single studio state model's (#123) `diagnostics` field. Every diagnostic surfaced anywhere in
 * the studio — parse-stage (this module wires it live), runtime-stage (#126's run controller
 * already writes `execute()`'s diagnostics into the same field), and semantic-stage (this module
 * runs `@openlogo/parser`'s `check()` live since #817, with style-stage still opt-in beside it —
 * see below) — renders through **one** unified path: {@link toDiagnosticsView} projects whatever
 * is in `state.getState().diagnostics` right now, regardless of which stage produced it. There is
 * no separate ad-hoc "runtime error" surface.
 *
 * ## The diagnostic-identity rule (`spec/error-model.md`)
 * Every decision here — grouping, counting, severity — keys off `code`/`params`/`severity`/
 * `stage`. `message` is carried through for display only; nothing in this module parses or
 * branches on its English prose.
 *
 * ## Live parse-stage and semantic-stage wiring
 * {@link createDiagnosticsController} subscribes to the shared store and, whenever `source`
 * changes, re-analyzes it via `@openlogo/parser`'s `analyze()` — Layer 1 (`parse()`, issue #9) and
 * Layer 2 (`check()`) merged through `applyOneFaultRules`, the identical composition `execute()`
 * runs — republishing the result through `state.setDiagnostics`, so both a bad line (e.g.
 * `ol-bad-token`) and an unknown name (`ol-unknown-command`) surface at their `source_span` as the
 * learner types, without a Run. Neither layer *reports* by throwing — a malformed line yields
 * diagnostics, not an exception — but both can exhaust the native stack on a deeply nested program,
 * so the call is wrapped in a guard that degrades rather than letting a throw wedge the session.
 * See {@link guardedRunChecks}; the underlying unbounded walk is tracked as #1146.
 *
 * ## Semantic checking (`check()`) runs by default (#817)
 * `@openlogo/parser`'s `check()` (epic #108) is the Layer-2/3 entry point this controller runs on
 * every re-check, appending its findings after the Layer-1 parse diagnostics. It was opt-in until
 * issue #817; both recorded reasons for that default were re-measured and neither survived.
 *
 * The **older** reason was false positives: `check()` here ran under Core Language alone, where
 * `forward 100` really is `ol-unknown-command`. That stopped being true at issue #740, which made
 * this controller pass `options.profiles ?? STUDIO_PROFILES`. Measured on this slice's base
 * commit, under {@link STUDIO_PROFILES}: `forward 100` reports nothing, the whole
 * `define sq :n / repeat 4 [ forward :n right 90 ] / end / sq 50` program reports nothing, and all
 * **13** `spec/examples/*.logo` files together report **0** semantic diagnostics. The same corpus
 * under `["core-language"]` alone does report — which is what makes those zeros a measurement of
 * the profile set rather than of a checker that never ran. `tests/conformance/`'s two
 * `PROFILE-ARGUMENT` fixtures hold that contrast as a wall against re-introducing the false
 * positive.
 *
 * The **later** reason was duplication: issue #815 made `execute()` check itself under the profile
 * set the run CLAIMS (`spec/execution-model.md:673-680`) before Phase 2, so the Run path already
 * surfaces these findings. That is true, and it is why this module goes through the same
 * `analyze()` the runtime does rather than composing the layers itself — the two paths report the
 * same finding for the same source because they are the same function. But it is not a reason to
 * withhold a finding *before* a Run. What flipping this default changes is exclusively **when** the
 * learner is told: at the keystroke instead of at the Run. A learner who has typed an unknown name
 * otherwise sees nothing at all until they press Run, which is the blank canvas issue #817 is
 * about.
 *
 * **The two writers are arbitrated, and the arbitration is narrower than it looks.** Both this
 * module and the run controller write the one `diagnostics` field through `setDiagnostics`, which
 * **replaces** rather than appends, and {@link DiagnosticsController.refresh} returns early when
 * `source` is unchanged — so a Run's own diagnostics are not clobbered by a re-check the Run itself
 * triggered, and a live finding and a Run finding are never listed side by side. That is a claim
 * about **one list at one instant**, and nothing more: it does not by itself stop the same fault
 * being *reported* twice over time, which is why a Run no longer clears a still-applicable live
 * finding (see `run-controller.ts`, "#817") — an earlier revision of this slice announced
 * "1 error found", then "No diagnostics", then "1 error found" again to a screen-reader user for a
 * single unchanged typo.
 *
 * Pass `semanticCheck: false` to switch this back off (a host that runs its own checker, say).
 * Layer-3 style lints stay **opt-in** beside it — see {@link DiagnosticsControllerOptions.styleCheck}
 * for the measurement that decided that. No rendering-side change was needed when this default
 * flipped, because {@link toDiagnosticsView} already renders every stage identically — which is the
 * claim #817 asked this slice to prove rather than restate.
 *
 * ## Cost, since this now runs on every keystroke
 * There is deliberately no debounce: the cost is linear in program size and small in absolute terms
 * — measured at 0.26–2.11 ms for realistic programs and 9.3 ms for 800 flat lines. The constant
 * scales with the number of **diagnostics** rather than lines, because the did-you-mean suggestion
 * runs an edit-distance sweep per unknown name: 800 unknown names cost 239 ms, and a transiently
 * broken large program (a mistyped `define` across 60 procedures, 480 findings) costs 34 ms per
 * keystroke. Nothing accumulates across calls — `check()` holds no cache — so this is a per-edit
 * cost, not a leak. Revisit debouncing if the editor grows past a few hundred lines.
 *
 * ## One profile set, shared with the highlighter (#740)
 * When `check()` does run, its active profile set defaults to `profiles.ts`'s
 * {@link STUDIO_PROFILES} — the identical constant `highlighter.ts` hands `highlight()` by default.
 * A learner's program has exactly one profile set, so the checker deciding a name is unavailable
 * while the editor paints it as if that profile were on (or the reverse) would be a contradiction
 * the learner sees on screen. Sharing the default is what removes that class of contradiction, when
 * neither caller overrides it; a caller that passes its own `profiles` here is on its own to keep
 * the two aligned.
 */

import { analyze, parse } from "@openlogo/parser";
import type { CheckProfile } from "@openlogo/parser";
import type {
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticStage,
  SourceSpan,
} from "@openlogo/core";
import type { AppShell } from "./app-shell.js";
import { STUDIO_PROFILES } from "./profiles.js";
import type { Notice, StudioStateStore } from "./state-model.js";

/** The document identifier passed to `parse()`/`check()` when the caller doesn't supply one. */
export const DEFAULT_DIAGNOSTICS_DOCUMENT = "studio-session";

/**
 * One diagnostic projected for rendering. Every field is copied straight from the source
 * {@link Diagnostic} — this is a read-only view, never a reinterpretation of `message`.
 */
export interface DiagnosticViewItem {
  readonly code: Diagnostic["code"];
  readonly sourceSpan: SourceSpan;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly stage: DiagnosticStage;
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * The diagnostics pane's rendering model: an ordered list plus severity counts a UI can use to
 * badge/announce the pane without re-deriving anything from `message` prose.
 */
export interface DiagnosticsView {
  readonly items: readonly DiagnosticViewItem[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly isEmpty: boolean;
}

function toViewItem(diagnostic: Diagnostic): DiagnosticViewItem {
  return {
    code: diagnostic.code,
    sourceSpan: diagnostic.source_span,
    message: diagnostic.message,
    severity: diagnostic.severity,
    stage: diagnostic.stage,
    params: diagnostic.params,
  };
}

/**
 * Project a raw `Diagnostic[]` (from any stage — parse, semantic, or runtime) into the pane's
 * rendering model. Pure: the same input always yields the same output, and nothing here consults
 * `message` to decide anything — only `severity` drives the counts.
 */
export function toDiagnosticsView(
  diagnostics: readonly Diagnostic[],
): DiagnosticsView {
  const items = diagnostics.map(toViewItem);
  let errorCount = 0;
  let warningCount = 0;
  for (const item of items) {
    if (item.severity === "error") {
      errorCount += 1;
    } else {
      warningCount += 1;
    }
  }
  return { items, errorCount, warningCount, isEmpty: items.length === 0 };
}

/** Optional configuration for {@link createDiagnosticsController}. */
export interface DiagnosticsControllerOptions {
  /** The document identifier passed to `parse()`/`check()`. Defaults to `"studio-session"`. */
  readonly document?: string;
  /**
   * Run Layer-2 semantic checking (`@openlogo/parser`'s `check()`, epic #108) on every re-check,
   * appended after the Layer-1 parse diagnostics. Defaults to **`true`** since issue #817 — see
   * this module's doc comment for the measurements that retired both earlier reasons for `false`.
   * Pass `false` to switch it off.
   */
  readonly semanticCheck?: boolean;
  /**
   * Also run Layer-3 style lints (`check()`'s `style: true`, issue #115). Has no effect when
   * `semanticCheck` is `false`. Defaults to `false`, matching `check()`'s own opt-in default, and
   * it stays `false` even though `semanticCheck` flipped at #817: style lints are **opinions about
   * working code**, and measured across `spec/examples/*.logo` they fire **46** times (mostly
   * `ol-style-magic-number`) on the same 13 files that produce 0 semantic diagnostics. Turning them
   * on as-you-type would bury a real `ol-unknown-command` under advice about a program that is
   * already correct.
   */
  readonly styleCheck?: boolean;
  /**
   * Active conformance profiles passed to `check()` when `semanticCheck` is `true`. Defaults to
   * {@link STUDIO_PROFILES} — the same default `highlighter.ts` gives `highlight()`, so by default,
   * when neither caller overrides the profile set, the checker and the editor's colors read a
   * program under the same profiles (#740). Leaving it unset used to fall through to `check()`'s own
   * Core-Language-only default, which is not the environment the studio actually runs.
   */
  readonly profiles?: readonly CheckProfile[];
  /**
   * Where a throw from the checker goes. Defaults to
   * {@link rethrowCheckFailureAsynchronously}, so the synchronous listener loop completes — no
   * wedged session — while the error still reaches the host's failure channel and fails CI.
   *
   * Inject it to assert on a failure without an uncaught error. A test that provokes a real throw
   * **must** supply this: under `node --test` the default surfaces as an unhandled rejection that
   * reddens the whole file even when every assertion in the test passed.
   */
  readonly onCheckFailure?: (error: unknown) => void;
}

/** The headless diagnostics pane controller. */
export interface DiagnosticsController {
  /** The single studio state model instance this controller reads/writes through. */
  readonly state: StudioStateStore;
  /**
   * Re-run the diagnostics pipeline over the store's current `source` and publish the result via
   * `state.setDiagnostics`, unless `source` is unchanged since the last check (a no-op guard, so
   * a diagnostics-only state change — e.g. a Run writing runtime diagnostics — never clobbers
   * itself in a subscribe loop).
   */
  refresh(): void;
  /** The current rendering model, derived from the store's live `diagnostics` list. */
  getView(): DiagnosticsView;
}

/**
 * The result of one diagnostics pass: the findings to publish, plus whether the checker gave up.
 * A pass that gave up carries a {@link Notice} for the *tool*, never a `Diagnostic` about the
 * *program* — see {@link guardedRunChecks}.
 */
interface ChecksOutcome {
  readonly diagnostics: readonly Diagnostic[];
  readonly notice: Notice | null;
}

/**
 * The message shown when the checker cannot finish. It describes the **tool**, promises the Run
 * path still works, and makes no claim about the program's correctness — because the checker did
 * not get far enough to have one.
 */
export const CHECKER_INCOMPLETE_NOTICE_MESSAGE =
  "This program is too deeply nested to check as you type. Press Run for the full answer.";

/**
 * Run the checker layers over `source`.
 *
 * Uses `@openlogo/parser`'s {@link analyze} — the *same* composition `@openlogo/runtime`'s
 * `execute()` runs — rather than calling `parse()` and `check()` and concatenating the two lists.
 * That is not a tidiness preference, it is the fix for a real defect (#817 review, `@interpreter`):
 * `analyze()` ends in `applyOneFaultRules`, and hand-composing skipped it, so **one** typo produced
 * **two** messages. Measured on `fowad 100`: the pane showed `ol-bad-token` ("i didn't expect `100`
 * to keep going on this line" — wrong advice about a perfectly good `100`) stacked above the true
 * `ol-unknown-command`, while pressing Run showed only the latter. `@openlogo/parser`'s own
 * `index.ts` exports `applyOneFaultRules` with a comment naming "the studio's diagnostics pane" as
 * the caller that owes the learner one message per fault. Going through `analyze()` means the two
 * paths cannot drift again, because they are the same function rather than two call sites that
 * happen to agree.
 *
 * `semanticCheck: false` returns Layer 1 alone, which is what that opt-out means.
 */
function runChecks(
  source: string,
  options: DiagnosticsControllerOptions,
): readonly Diagnostic[] {
  const document = options.document ?? DEFAULT_DIAGNOSTICS_DOCUMENT;
  if (options.semanticCheck === false) {
    return parse(source, document).diagnostics;
  }
  return analyze(source, document, {
    profiles: options.profiles ?? STUDIO_PROFILES,
    style: options.styleCheck === true,
  }).diagnostics;
}

/**
 * Run `check` and, if it throws, degrade instead of letting the throw escape.
 *
 * ## Why the keystroke path must not throw
 * This runs inside the state model's `commit()` listener loop, which iterates listeners with no
 * isolation. A throw here therefore aborts the **whole loop**, so every listener registered after
 * this one — the editor, the highlighter, the turtle pane, the screen-reader announcer — never sees
 * the update, while `source` has already been committed. Measured before this guard: one
 * sufficiently nested program wedged the session permanently, because the source stayed large and
 * every subsequent keystroke threw again.
 *
 * It is reachable: `check()` walks expressions recursively without bounding the walk, so deep
 * nesting exhausts the native stack (`@openlogo/parser`, tracked as **#1146** — bound the walk in
 * `checker-undefined-var.ts` and audit the sibling rules). `parse()` can overflow the same way on
 * deeply nested `[`, which predates this slice. This guard is a **host-level backstop, not the fix
 * for either**, and it keeps earning its place after #1146 lands: a browser tab's stack is smaller
 * than Node's, which is the same reason `@openlogo/runtime` keeps its issue-#726 guard despite
 * clamping its own recursion depth.
 *
 * ## Why a `Notice` and not a `Diagnostic`
 * The tempting answer — report `ol-limit`, matching what `execute()` returns for the same source —
 * is wrong twice over. `spec/error-model.md:59-71` makes all three stages classifications of *when
 * a fact about the program was found*, and "the checker ran out of stack" is not a fact about the
 * program, so it has no true stage. And `spec/error-model.md:121` defines `ol-limit` as a
 * **configurable** safety limit; the runtime's is (`recursionDepthLimit`, and its reported `value`
 * is the depth actually enforced), while a native stack nobody chose is not. `execute()` owes a
 * diagnostic because `spec/execution-model.md:696` requires evaluation to terminate in a value, an
 * effect, or a diagnostic — it promised to run the program. This pane promised nothing: it runs
 * unbidden on every keystroke. The falsifying detail is that `parse()` returns **zero** diagnostics
 * on the program that overflows the checker, so a pane answering `ol-limit` would contradict a
 * clean Layer 1 and flash-and-clear as the learner keeps typing.
 *
 * So the diagnostics list stays a statement about the **program** and the notice is a statement
 * about the **tool**. The live pane already reports only a subset of what a Run does (it can never
 * see runtime findings), and degrading here keeps it a subset rather than making it contradict.
 *
 * ## Why the error is still rethrown
 * Swallowing it would turn a genuine bug in `check()` into a silent notice. Rethrowing it
 * synchronously would wedge the session, which is the thing this exists to prevent. Deferring the
 * rethrow to a microtask gives both: the synchronous listener loop completes, and the error still
 * reaches the host's failure channel, so a real defect still fails CI. Same policy as
 * `@openlogo/runtime`'s rethrow of an unrelated error, different mechanism, because a keystroke
 * listener cannot afford to fail where a `run()` boundary can. See
 * {@link rethrowCheckFailureAsynchronously}.
 */
function guardedRunChecks(
  run: () => readonly Diagnostic[],
  parseOnly: () => readonly Diagnostic[],
  onFailure: (error: unknown) => void,
): ChecksOutcome {
  try {
    return { diagnostics: run(), notice: null };
  } catch (error) {
    onFailure(error);
    // Degrade to Layer 1 alone. `analyze()` is parse → check → merge with no internal guard, so it
    // throws as a UNIT: the `catch` above holds neither the AST nor the parse diagnostics, and
    // without re-parsing the pane would empty out — including on a program whose Layer 1 had real
    // findings the learner needs. Its own `try` because `parse()` can overflow too.
    try {
      return {
        diagnostics: parseOnly(),
        notice: {
          level: "warning",
          message: CHECKER_INCOMPLETE_NOTICE_MESSAGE,
        },
      };
    } catch (parseError) {
      onFailure(parseError);
      return {
        diagnostics: [],
        notice: {
          level: "warning",
          message: CHECKER_INCOMPLETE_NOTICE_MESSAGE,
        },
      };
    }
  }
}

/**
 * The default {@link DiagnosticsControllerOptions.onCheckFailure}: reject a promise carrying
 * `error`, so the failure escapes *after* the synchronous listener loop has finished. See
 * {@link guardedRunChecks} for why it must not escape synchronously.
 *
 * A rejected promise rather than `queueMicrotask`, for two reasons that are both about this package
 * rather than about the mechanism. `tsconfig.base.json` sets `lib: ["es2023"]` with no DOM or Node
 * types, so `queueMicrotask` is not a typed global here; and `web-bootstrap.ts:93-96` records the
 * convention that this package takes host capabilities as injected seams instead of reaching for
 * ambient globals. `Promise` is in the language, so this needs neither.
 *
 * The channel differs from a synchronous `throw` and the difference is worth stating rather than
 * glossing: this surfaces as an **unhandled rejection**. Both are fatal where it matters — Node has
 * thrown on unhandled rejections by default since v15, so `node --test` still fails the run, and
 * browsers fire `unhandledrejection`, which error reporters capture alongside `onerror`. What is
 * preserved is the property the guard needs: loud for a developer, invisible to the learner's
 * session, which keeps running.
 *
 * **It returns the promise, and the controller discards it — deliberately.** Discarding is what
 * leaves the rejection unhandled, and therefore loud. Returning it is what lets a test attach a
 * `.catch()` and assert the error is carried without that assertion reddening the run: a rejection
 * nobody handles is precisely what this function is for, so it cannot be observed passively.
 */
export function rethrowCheckFailureAsynchronously(
  error: unknown,
): Promise<never> {
  return Promise.reject(error);
}

/** Construct the diagnostics pane controller bound to the shared studio state model. */
export function createDiagnosticsController(
  state: StudioStateStore,
  options: DiagnosticsControllerOptions = {},
): DiagnosticsController {
  let lastCheckedSource: string | null = null;
  // The exact `Notice` object this controller last published, or `null`. `setNotice(null)` is a
  // global stomp and the field is shared — persistence uses it for "your work could not be saved" —
  // so the controller must clear only its OWN notice.
  //
  // A reference, not a boolean. A boolean records that we once wrote a notice; it does not record
  // whether ours is still the one on screen. Measured with a boolean: the controller sets its
  // notice, persistence then replaces it (a `setNotice` alone does not change `source`, so
  // `refresh()` early-returns and the flag stays latched), and the next successful check clears
  // "your work could not be saved" — so a learner who has lost work also loses the only warning
  // that they lost it. `guardedRunChecks` builds a fresh object every time, so identity is exact,
  // and it is the same instrument the run controller uses to tell a live finding from a stale run
  // result.
  let ourNotice: Notice | null = null;
  const onFailure = options.onCheckFailure ?? rethrowCheckFailureAsynchronously;

  function refresh(): void {
    const source = state.getState().source;
    if (source === lastCheckedSource) {
      return;
    }
    lastCheckedSource = source;
    const document = options.document ?? DEFAULT_DIAGNOSTICS_DOCUMENT;
    const outcome = guardedRunChecks(
      () => runChecks(source, options),
      () => parse(source, document).diagnostics,
      onFailure,
    );
    state.setDiagnostics(outcome.diagnostics);
    if (outcome.notice !== null) {
      ourNotice = outcome.notice;
      state.setNotice(outcome.notice);
    } else if (ourNotice !== null && state.getState().notice === ourNotice) {
      ourNotice = null;
      state.setNotice(null);
    }
  }

  state.subscribe(refresh);
  refresh();

  return {
    state,
    refresh,
    getView: () => toDiagnosticsView(state.getState().diagnostics),
  };
}

/** Compose the diagnostics controller into the app shell's `diagnostics` region. */
export function mountDiagnosticsPane(
  shell: AppShell,
  controller: DiagnosticsController,
): void {
  shell.mount("diagnostics", controller);
}
