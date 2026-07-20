/**
 * Headless glue for the browser entry (`web/main.ts`, issue #277, extended by #278 and #279).
 * Everything a real DOM host needs beyond composing the published `@openlogo/studio` controllers
 * verbatim lives here, so it stays `node:test`-able and inside the 100% coverage gate —
 * `web/main.ts` itself is a thin, logic-free wiring layer that only touches `document`/`window`
 * and is never imported by a test (per this package's `tsconfig.json`, `web/**` is outside the
 * `src` build graph and this monorepo has no `lib.dom`), so any real logic must live here instead.
 *
 * #279 adds the decisions the finished, servable page needs beyond #278's controls: {@link
 * selectScheduler} picks the reduced-motion-aware `Scheduler`, {@link
 * createKeyValueStorageAdapter} adapts `window.localStorage` into #128's `StorageAdapter` seam,
 * {@link selectAnnouncerElementId} routes a #129 `Announcement` to the right always-live
 * `aria-live` region, {@link assertPresent} turns `web/main.ts`'s DOM-element lookups into a
 * straight-line sequence of assertions instead of one large `if`/`throw` block, and {@link
 * syncTextValue} keeps the editor `<textarea>`'s value in sync without fighting the learner's
 * cursor.
 *
 * #310 fixes {@link createTimeoutScheduler} to honor each scheduled call's own `delayMs` instead
 * of a fixed pace, so the learner-facing turtle-speed slider (`turtle-speed.ts`, wired through
 * `run-controller.ts`'s `prepare()`) actually takes effect in the browser.
 */

import type { Diagnostic, DiagnosticSeverity, Position } from "@openlogo/core";
import type { Scheduler } from "@openlogo/turtle";
import type { AnnouncementPoliteness } from "./a11y.js";
import { toDiagnosticsView } from "./diagnostics.js";
import type { StorageAdapter } from "./persistence.js";

/**
 * The program the editor boots with — the canonical acceptance square from issue #277 and the
 * root README ("Try a program"). Kept as a named constant so both the browser entry and this
 * module's tests assert the exact same string.
 */
export const DEFAULT_RUN_PROGRAM = "repeat 4 [ forward 100 right 90 ]";

/** Fixed label shown in the diagnostics list (#278) when there is nothing to report. */
export const NO_DIAGNOSTICS_LABEL = "No diagnostics.";

/**
 * One diagnostic, fully formatted and ready for direct DOM rendering — `web/main.ts` (#278) only
 * assembles a `<li>` per item from these fields; it never builds the span/label text itself (the
 * "non-trivial DOM formatting stays in a tested helper" rule from issue #278).
 */
export interface DiagnosticListItem {
  /** Stable `ol-*`/`ol-style-*` identity, exposed for callers that want to key off it (e.g. CSS).
   * `""` for the synthetic empty-state item (see {@link toDiagnosticListItems}). */
  readonly code: string;
  /** `"error"` or `"warning"`, or `"info"` for the synthetic empty-state item, exposed for
   * callers that want to badge/style by severity. */
  readonly severity: DiagnosticSeverity | "info";
  /** The full, ready-to-display line: `"<line>:<column> <code> (<severity>): <message>"`, or
   * {@link NO_DIAGNOSTICS_LABEL} for the synthetic empty-state item. */
  readonly label: string;
}

/** Formats a 1-based `[line, column]` position as `"line:column"`. */
function formatPosition([line, column]: Position): string {
  return `${line}:${column}`;
}

/**
 * Project the shared state model's raw diagnostics into a ready-to-render list — one item per
 * diagnostic, in order, each already carrying its fully formatted `label` (source span, code,
 * severity, message). Keys every decision off {@link toDiagnosticsView}'s structured fields
 * (`code`/`severity`/`sourceSpan`), per `spec/error-model.md`'s diagnostic-identity rule —
 * `message` is prose for display only, appended verbatim, never parsed. `message` already bakes
 * in any did-you-mean suggestion the spec provides (e.g. `ol-unknown-command`'s
 * "did you mean forward?", per `spec/error-model.md`'s "Did-you-mean" section), so no separate
 * suggestion rendering is needed here.
 *
 * Always returns a **non-empty** list: when there are no diagnostics, the single result item is
 * the synthetic {@link NO_DIAGNOSTICS_LABEL} placeholder. This keeps the empty-state decision in
 * this tested helper rather than as a branch in `web/main.ts`, which only ever loops over the
 * returned items unconditionally (per issue #278's "logic stays in a tested `src/` helper" rule).
 */
export function toDiagnosticListItems(
  diagnostics: readonly Diagnostic[],
): readonly DiagnosticListItem[] {
  const items = toDiagnosticsView(diagnostics).items.map((item) => ({
    code: item.code,
    severity: item.severity as DiagnosticSeverity | "info",
    label: `${formatPosition(item.sourceSpan.start)} ${item.code} (${item.severity}): ${item.message}`,
  }));
  if (items.length === 0) {
    return [{ code: "", severity: "info", label: NO_DIAGNOSTICS_LABEL }];
  }
  return items;
}

/**
 * The real timer primitives {@link createTimeoutScheduler} paces playback through. Declared
 * locally (rather than referencing the ambient `setTimeout`/`clearTimeout` globals directly) so
 * this module needs neither `lib.dom` nor `@types/node` to type-check — the browser entry
 * (`web/main.ts`, which has `lib: ["DOM"]` via `tsconfig.web.json`) supplies the real
 * `window.setTimeout`/`window.clearTimeout` as a one-line wiring call.
 */
export interface TimeoutSchedulerTimers<Handle = unknown> {
  /** Schedules `callback` after `delayMs` and returns an opaque handle. */
  readonly setTimeout: (callback: () => void, delayMs: number) => Handle;
  /** Cancels a handle previously returned by `setTimeout`, if it hasn't fired yet. */
  readonly clearTimeout: (handle: Handle) => void;
}

/**
 * Builds a real, paced `Scheduler` (`@openlogo/turtle`'s `Scheduler` type) for
 * `createRunController`'s `RunControllerOptions.scheduler`, so a run's turtle animation plays back
 * visibly instead of draining instantly like the default `IMMEDIATE_SCHEDULER` — `@openlogo/turtle`
 * stays timer-free by design, so studio owns the timer (`run-controller.ts`'s doc comment).
 *
 * Honors each scheduled call's own `delayMs` argument (#310) — that argument is
 * `TurtleAnimationController.driveRun()`'s own `this.delayMs()` (`1000 / stepsPerSecond`), which
 * `run-controller.ts`'s `prepare()` now derives from the learner-facing turtle-speed slider
 * (`turtle-speed.ts`'s `mapSpeedSliderValueToTickDelayMs` → `tickDelayMsToStepsPerSecond`), so a
 * fixed delay here would silently override every speed the slider chose. Before #310 this
 * function paced every step at one fixed delay instead, since studio did not yet expose a speed
 * control.
 */
export function createTimeoutScheduler<Handle = unknown>(
  timers: TimeoutSchedulerTimers<Handle>,
): Scheduler {
  return (callback, delayMs) => {
    const handle = timers.setTimeout(callback, delayMs);
    return () => {
      timers.clearTimeout(handle);
    };
  };
}

/**
 * Formats a run's learner-visible output (`StudioState.output`, one entry per `print` trace
 * event, already in `@openlogo/runtime`'s canonical `printedForm` — this helper never reformats
 * a value itself) as a single string ready for direct assignment to the output `<pre>`'s
 * `textContent`: one line per entry, joined with `"\n"`. An empty `output` formats to `""`, which
 * `web/main.ts` assigns unconditionally — no empty-state branch needed there, mirroring
 * {@link toDiagnosticListItems}'s "logic stays in a tested `src/` helper" rule from issue #278.
 */
export function formatOutput(output: readonly string[]): string {
  return output.join("\n");
}

/**
 * Returns `value` when `isValid(value)` is true, otherwise throws
 * `new Error("index.html is missing an expected element: " + description)`. `web/main.ts` (#279)
 * uses this to turn every `document.getElementById` lookup into one straight-line assertion
 * instead of a single large `if (!(... || ... || ...)) throw` block spanning all of them — the
 * missing-element DECISION (and its message) lives here, fully tested with plain values.
 *
 * The default `isValid` only checks `value !== null && value !== undefined`; `web/main.ts` passes
 * a narrower `instanceof` predicate per element where it needs a specific DOM subtype (e.g.
 * `HTMLTextAreaElement`) so the returned type is narrowed too. That predicate is a single boolean
 * expression supplied by the caller, not a branch inside `web/main.ts` itself, and can't be
 * exercised by this repository's jsdom-free `node:test` suite since constructors like
 * `HTMLTextAreaElement` don't exist outside a real browser/DOM — but `assertPresent`'s own
 * pass/throw behavior is fully covered here regardless of which predicate a caller supplies (this
 * module's tests exercise both the default predicate and a custom one, built from plain values).
 */
export function assertPresent<T>(
  value: unknown,
  description: string,
  isValid: (value: unknown) => value is T = (candidate): candidate is T =>
    candidate !== null && candidate !== undefined,
): T {
  if (!isValid(value)) {
    throw new Error(
      `index.html is missing an expected element: ${description}`,
    );
  }
  return value;
}

/**
 * A DOM element's minimal `.value` surface — matches `HTMLTextAreaElement`/`HTMLInputElement`
 * exactly, so `web/main.ts` can pass the real editor `<textarea>` directly; this module's own
 * tests pass a plain fake with no DOM involved.
 */
export interface TextValueTarget {
  value: string;
}

/**
 * Writes `nextValue` into `target.value`, but only when it actually differs from the current
 * value. `web/main.ts` (#279, extending #278) uses this for the editor `<textarea>`: a browser
 * moves a `<textarea>`'s caret to the end on ANY assignment to `.value` — even to a string
 * identical to the one already there — so writing back the same `source` every time the shared
 * state store's `subscribe` callback re-fires (as it does right after the editor's own `input`
 * event round-trips through `setSource`) would fight the learner's cursor mid-keystroke. Keeping
 * this equality check here, rather than as an `if` in `web/main.ts`, keeps the browser entry
 * branch-free per issue #278's "logic stays in a tested `src/` helper" rule.
 */
export function syncTextValue(
  target: TextValueTarget,
  nextValue: string,
): void {
  if (target.value !== nextValue) {
    target.value = nextValue;
  }
}

/**
 * Chooses which paced {@link Scheduler} a run should animate a program's turtle Canvas through,
 * honoring the browser's `prefers-reduced-motion` media query (#279, `spec/rendering.md`'s
 * reduced-motion requirement). `web/main.ts` only reads the boolean from
 * `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and forwards it here — this
 * pure function makes the actual choice, keeping the browser entry branch-free per issue #278's
 * "logic stays in a tested `src/` helper" rule.
 *
 * When reduced motion is requested, `immediateScheduler` (`@openlogo/turtle`'s
 * `IMMEDIATE_SCHEDULER`) drains every step synchronously instead of pacing playback; otherwise
 * `timeoutScheduler` (built by {@link createTimeoutScheduler}) paces it. Callers should also pass
 * the same boolean as `RunControllerOptions.reducedMotion`, which makes `run()` paint the final
 * turtle scene instantly via `@openlogo/turtle`'s `playWithMotionPreference` — the scheduler
 * chosen here still matters for `step()`, which advances the animation one tick at a time
 * regardless of `reducedMotion`.
 */
export function selectScheduler(
  prefersReducedMotion: boolean,
  timeoutScheduler: Scheduler,
  immediateScheduler: Scheduler,
): Scheduler {
  return prefersReducedMotion ? immediateScheduler : timeoutScheduler;
}

/**
 * The minimal synchronous key-value storage surface {@link createKeyValueStorageAdapter} adapts —
 * matches `window.localStorage`'s `getItem`/`setItem`/`removeItem` shape exactly, so the real
 * browser entry can pass `window.localStorage` directly; this module's own tests pass a plain
 * fake with no DOM involved.
 */
export interface KeyValueStorage {
  /** Read the value previously stored under `key`, or `null` if nothing is stored. */
  getItem(key: string): string | null;
  /** Persist `value` under `key`. */
  setItem(key: string, value: string): void;
  /** Remove any value stored under `key`. */
  removeItem(key: string): void;
}

/**
 * Adapts a lazily-resolved {@link KeyValueStorage} (e.g. `() => window.localStorage`) into
 * `persistence.ts`'s {@link StorageAdapter} seam, so `attachPersistence` (#128) can persist the
 * learner's document text across a real page reload (#279) exactly as it already does for the
 * fully `node:test`-able `createInMemoryStorageAdapter`. `attachPersistence` alone decides
 * restore-vs-default precedence (a `null` load leaves the store's existing `source` — e.g.
 * {@link DEFAULT_RUN_PROGRAM} — untouched) and already degrades gracefully on a throwing
 * `save`/`load`/`clear` (quota exceeded, storage disabled, private browsing) via
 * `StudioStateStore.setNotice`.
 *
 * `getStorage` is called lazily — once per `save`/`load`/`clear`, never at construction time —
 * because *reading* `window.localStorage` itself (not just calling its methods) can throw in some
 * browsers under restrictive privacy settings; deferring the access into these methods means it
 * happens inside `attachPersistence`'s existing synchronous `try`/`catch`, so it degrades to the
 * same visible warning notice as a throwing `getItem`/`setItem`/`removeItem` instead of crashing
 * the whole bootstrap before `attachPersistence` ever gets a chance to catch it.
 */
export function createKeyValueStorageAdapter(
  getStorage: () => KeyValueStorage,
): StorageAdapter {
  return {
    save(key, value) {
      getStorage().setItem(key, value);
    },
    load(key) {
      return getStorage().getItem(key);
    },
    clear(key) {
      getStorage().removeItem(key);
    },
  };
}

/** The `id` of the always-`aria-live="polite"` region {@link selectAnnouncerElementId} routes a
 * `politeness: "polite"` {@link Announcement} to. `index.html` (#279) declares it, always empty
 * at rest. */
export const ANNOUNCER_POLITE_ELEMENT_ID = "announcer-polite";

/** The `id` of the always-`aria-live="assertive"` region {@link selectAnnouncerElementId} routes
 * a `politeness: "assertive"` {@link Announcement} to. `index.html` (#279) declares it, always
 * empty at rest. */
export const ANNOUNCER_ASSERTIVE_ELEMENT_ID = "announcer-assertive";

/**
 * Chooses which of the two always-live `aria-live` regions an {@link Announcement} should render
 * into, keyed only on its structured `politeness` field — never on message prose. Two always-live
 * regions (one `polite`, one `assertive`), each updated only when needed, is the standard pattern
 * for reliable screen-reader announcements: dynamically flipping a single region's `aria-live`
 * attribute is not reliably picked up by every screen reader once the region already exists in
 * the DOM. `web/main.ts` only looks the returned id up via `document.getElementById` and sets its
 * `textContent`; the politeness-to-region decision stays here so the browser entry is
 * branch-free, per issue #278's "logic stays in a tested `src/` helper" rule.
 */
export function selectAnnouncerElementId(
  politeness: AnnouncementPoliteness,
): string {
  return politeness === "assertive"
    ? ANNOUNCER_ASSERTIVE_ELEMENT_ID
    : ANNOUNCER_POLITE_ELEMENT_ID;
}
