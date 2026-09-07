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
 * changes, re-parses it via `@openlogo/parser`'s `parse()` (Layer 1 — issue #9) and re-checks it
 * via `check()` (Layer 2 — see below), republishing the result through `state.setDiagnostics`, so
 * both a bad line (e.g. `ol-bad-token`) and an unknown name (`ol-unknown-command`) surface at their
 * `source_span` as the learner types, without a Run. Neither `parse()` nor `check()` throws on
 * malformed input — they report diagnostics instead — so an erroneous line can never crash the
 * session.
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
 * surfaces these findings. That is true and it is why nothing here reports them a second time —
 * but it is not a reason to withhold them *before* a Run. Both paths write the same unified
 * `diagnostics` field through `setDiagnostics`, which **replaces** rather than appends, and
 * {@link DiagnosticsController.refresh}'s unchanged-`source` guard keeps a Run's own diagnostics
 * from being clobbered — so a finding is never listed twice. What flipping this default changes is
 * exclusively **when** the learner is told: at the keystroke instead of at the Run. A learner who
 * has typed an unknown name otherwise sees nothing at all until they press Run, which is the blank
 * canvas issue #817 is about.
 *
 * Pass `semanticCheck: false` to switch this back off (a host that runs its own checker, say).
 * Layer-3 style lints stay **opt-in** beside it — see {@link DiagnosticsControllerOptions.styleCheck}
 * for the measurement that decided that. No rendering-side change was needed when this default
 * flipped, because {@link toDiagnosticsView} already renders every stage identically — which is the
 * claim #817 asked this slice to prove rather than restate.
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

import { check, parse } from "@openlogo/parser";
import type { CheckProfile } from "@openlogo/parser";
import type {
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticStage,
  SourceSpan,
} from "@openlogo/core";
import type { AppShell } from "./app-shell.js";
import { STUDIO_PROFILES } from "./profiles.js";
import type { StudioStateStore } from "./state-model.js";

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

function runChecks(
  source: string,
  options: DiagnosticsControllerOptions,
): readonly Diagnostic[] {
  const document = options.document ?? DEFAULT_DIAGNOSTICS_DOCUMENT;
  const parsed = parse(source, document);
  if (options.semanticCheck === false) {
    return parsed.diagnostics;
  }
  const checked = check(parsed.ast, {
    profiles: options.profiles ?? STUDIO_PROFILES,
    source,
    style: options.styleCheck === true,
  });
  return [...parsed.diagnostics, ...checked.diagnostics];
}

/** Construct the diagnostics pane controller bound to the shared studio state model. */
export function createDiagnosticsController(
  state: StudioStateStore,
  options: DiagnosticsControllerOptions = {},
): DiagnosticsController {
  let lastCheckedSource: string | null = null;

  function refresh(): void {
    const source = state.getState().source;
    if (source === lastCheckedSource) {
      return;
    }
    lastCheckedSource = source;
    state.setDiagnostics(runChecks(source, options));
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
