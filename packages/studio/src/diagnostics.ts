/**
 * The diagnostics pane (#125) — a headless, fully-testable view-model + controller over the
 * single studio state model's (#123) `diagnostics` field. Every diagnostic surfaced anywhere in
 * the studio — parse-stage (this module wires it live), runtime-stage (#126's run controller
 * already writes `execute()`'s diagnostics into the same field), and semantic/style-stage (this
 * module can opt into `@openlogo/parser`'s `check()`, see below) — renders through **one**
 * unified path: {@link toDiagnosticsView} projects whatever is in `state.getState().diagnostics`
 * right now, regardless of which stage produced it. There is no separate ad-hoc "runtime error"
 * surface.
 *
 * ## The diagnostic-identity rule (`spec/error-model.md`)
 * Every decision here — grouping, counting, severity — keys off `code`/`params`/`severity`/
 * `stage`. `message` is carried through for display only; nothing in this module parses or
 * branches on its English prose.
 *
 * ## Live parse-stage wiring
 * {@link createDiagnosticsController} subscribes to the shared store and, whenever `source`
 * changes, re-parses it via `@openlogo/parser`'s `parse()` (Layer 1 — issue #9) and republishes
 * the result through `state.setDiagnostics`, so a bad line (e.g. `ol-bad-token`) surfaces at its
 * `source_span` as the learner types, without a Run. `parse()` never throws on malformed input —
 * it reports diagnostics instead — so an erroneous line can never crash the session.
 *
 * ## Semantic checking (`check()`) is opt-in, not default
 * `@openlogo/parser`'s `check()` (epic #108) is the Layer-2/3 entry point this controller is
 * wired to accept — interface-level readiness for #125's AC — but it is **not** run by default
 * yet: `check()` was being called here with Core Language alone, under which an ordinary turtle
 * program like `forward 100` is falsely flagged `ol-unknown-command`. Issue #815 settled that — a
 * run checks itself under the profile set it CLAIMS (`spec/execution-model.md:673-680`), and
 * `execute()` now does so before Phase 2, which means the Run path already surfaces these findings
 * and turning this on would DUPLICATE them rather than add them. Pass
 * `semanticCheck: true` (see epic #813) to layer semantic/style diagnostics into
 * the exact same unified `diagnostics` field — no rendering-side change needed when that flag
 * flips, because {@link toDiagnosticsView} already renders every stage identically.
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
   * Opt into Layer-2 semantic checking (`@openlogo/parser`'s `check()`, epic #108) on every
   * re-check, appended after the Layer-1 parse diagnostics. Defaults to `false` — see this
   * module's doc comment for why turning it on today would falsely flag ordinary turtle
   * programs.
   */
  readonly semanticCheck?: boolean;
  /**
   * Also opt into Layer-3 style lints (`check()`'s `style: true`, issue #115) when
   * `semanticCheck` is `true`. Has no effect unless `semanticCheck` is also `true`. Defaults to
   * `false`, matching `check()`'s own opt-in default.
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
  if (options.semanticCheck !== true) {
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
