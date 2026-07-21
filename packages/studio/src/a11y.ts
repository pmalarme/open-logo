/**
 * Keyboard + screen-reader accessibility for the studio REPL loop — editor (#124), run controls
 * (#126, extended in #228 with the turtle Canvas view), diagnostics (#125), the turtle Canvas pane
 * (#218/#228, as of #229) and its non-visual state text, and, as of #127, the lesson pane's nav
 * list and detail article. #305 removes the `Next step` control from the 0.1.0 UI; the headless
 * `step()` method it drove stays (Wave 1/#302 rebuilds a UI on it).
 *
 * Like #123-#129, ADR-0001 defers the studio's DOM/framework choice, so this slice models
 * accessibility as **headless, node:test-able data + functions** a future real-widget renderer
 * consumes 1:1 — exactly the same "headless controller, DOM binding documented but not built yet"
 * posture `editor.ts`'s doc comment already establishes. There is no DOM here to regress.
 *
 * ## Keyboard operability — {@link REPL_FOCUS_ORDER}
 * A single, static, ordered list of every focusable stop across the five studio panes: the lesson
 * nav list (one `list` stop, #127 — the entry point into `lesson-pane.ts`'s dynamically-sized,
 * natively-focusable per-lesson `<button>`s, not one stop per lesson), the editor (one `textbox`
 * stop), the run controls (three `button` stops — Run/Stop/Reset, matching
 * `run-controller.ts`'s `run()`/`stop()`/`reset()` — plus one `slider` stop, #310's turtle-speed
 * control), the turtle Canvas pane (one `img`
 * stop, #218/#228's rendered + animated scene), and the diagnostics list (one `log` stop).
 * {@link nextFocusStop}/{@link previousFocusStop} cycle through it (wrapping at both ends), so a
 * future Tab/Shift+Tab (or roving-`tabindex`) binding can move forward and backward from *any*
 * stop and always reach every other stop — the headless proof that there is no keyboard trap.
 *
 * `run-controller.ts`'s headless `step()` method still exists (Wave 1/#302 rebuilds a UI on it),
 * but 0.1.0 does not surface a `Next step` control, so this module deliberately adds no focus stop
 * for it (#305) — the same "document the honest gap, never fake it" precedent #126/#228 set for
 * controls that do not exist. `@openlogo/turtle` also exposes `exportTurtleSvg`/`exportTurtlePng`,
 * but studio does not yet wire either into a learner-facing action — same reasoning applies.
 * Wiring an export control is left to a follow-up issue. #310 delivers the speed control this
 * doc comment used to defer: {@link REPL_FOCUS_ORDER} now has a `slider` stop for it, in the
 * `repl` region alongside Run/Stop/Reset.
 *
 * ## Semantic structure — {@link REPL_LANDMARK_ROLES}
 * The ARIA role + label a future renderer gives each pane's *container* (as opposed to the
 * individual focusable stops above): the lesson pane is a `navigation` landmark (its nav list)
 * plus a `region` landmark (its detail article), the editor is a `textbox`, the run controls are a
 * `toolbar`, the turtle Canvas is an `img`, its non-visual state text is a `status` live region, and
 * diagnostics are a `log` landmark. A renderer maps this 1:1 onto real `role`/`aria-label`
 * attributes; this module never touches the DOM itself.
 *
 * ## Screen-reader announcements — {@link createA11yAnnouncer}
 * Subscribes to the shared #123 state model and emits an {@link Announcement} whenever
 * `runStatus` or `diagnostics` changes — covering both Given/When/Then's in the issue ("run state
 * changes" and "a new diagnostic appears after Run"). Announcement text is generated from
 * **structured** fields only (`runStatus`; diagnostics' `severity` counts) — never by reading or
 * branching on a `Diagnostic.message`'s prose (the diagnostic-identity rule, `spec/error-model.md`,
 * already followed by `diagnostics.ts`). A future renderer pipes {@link Announcement.message} into
 * an `aria-live` region whose `aria-live` politeness is {@link Announcement.politeness}.
 *
 * ## Non-visual turtle state — {@link createTurtleStateRegion}
 * As of #229: a headless `status`/`aria-live="polite"` text region, fed from the shared store's
 * `turtleState` (the same slot #218 paints from and #228 pushes into on every run tick/step/
 * reset), rendered via `@openlogo/turtle`'s published {@link describeTurtleState} — this module
 * never writes its own position/heading description logic. Unlike {@link createA11yAnnouncer}'s
 * discrete announcement log (deliberately sparse, so screen readers aren't spammed on every
 * keystroke), this is a single, continuously-current piece of text a screen reader can read at
 * any time and that updates in lockstep with the Canvas view as a program runs.
 */

import type { TurtleState } from "@openlogo/turtle";
import { describeTurtleState } from "@openlogo/turtle";
import type {
  StudioState,
  StudioStateStore,
  Unsubscribe,
} from "./state-model.js";
import type { RegionName } from "./app-shell.js";

/** The ARIA role a focus stop or landmark is exposed as. */
export type A11yRole =
  | "textbox"
  | "toolbar"
  | "button"
  | "log"
  | "img"
  | "status"
  | "slider"
  | "navigation"
  | "list"
  | "region";

/** One focusable stop in the REPL's keyboard focus order. */
export interface FocusStop {
  /** A stable identifier for this stop, unique within {@link REPL_FOCUS_ORDER}. */
  readonly id: string;
  /** The app-shell region ({@link RegionName}) this stop lives in. */
  readonly region: RegionName;
  /** The ARIA role a renderer should expose this stop as. */
  readonly role: A11yRole;
  /** The accessible label a screen reader announces for this stop. */
  readonly label: string;
}

/**
 * The studio's keyboard focus order: the lesson nav list → editor → Run → Stop → Reset → Speed →
 * turtle Canvas → diagnostics list. The lesson nav list is first because #313/#127's layout
 * (`web/styles.css`'s `main:has(.pane-lesson:not([hidden]))` rules) places the lesson pane first
 * in both the wide (leftmost column) and narrow (topmost row) layouts, matching DOM order. Static
 * and declarative — it does not depend on shell mount state — because the full studio REPL +
 * Canvas loop always composes every pane together. The lesson pane's individual per-lesson
 * buttons (#127, `lesson-pane.ts`'s `toLessonNavItems`) are a dynamically-sized list rendered as
 * real, natively-focusable `<button>` elements — this single `"list"`-role stop names the
 * container as the keyboard entry point into that list rather than enumerating an unbounded,
 * content-dependent number of individual stops here.
 */
export const REPL_FOCUS_ORDER: readonly FocusStop[] = [
  {
    id: "lesson-nav-list",
    region: "lesson",
    role: "list",
    label: "Lessons",
  },
  {
    id: "editor",
    region: "editor",
    role: "textbox",
    label: "OpenLogo source editor",
  },
  { id: "run-button", region: "repl", role: "button", label: "Run" },
  { id: "stop-button", region: "repl", role: "button", label: "Stop" },
  { id: "reset-button", region: "repl", role: "button", label: "Reset" },
  {
    id: "speed-slider",
    region: "repl",
    role: "slider",
    label: "Turtle speed",
  },
  { id: "canvas", region: "turtle", role: "img", label: "Turtle canvas" },
  {
    id: "diagnostics-list",
    region: "diagnostics",
    role: "log",
    label: "Diagnostics",
  },
];

/** The container-level ARIA role + label for one REPL pane (as opposed to its focus stops). */
export interface RegionLandmark {
  readonly region: RegionName;
  readonly role: A11yRole;
  readonly label: string;
}

/**
 * Each studio pane's landmark roles: the lesson pane's nav list and detail article (#127), editor,
 * run controls (`repl`), the turtle Canvas (visual `img` plus its non-visual `status` state-text
 * region — see {@link createTurtleStateRegion}), and diagnostics.
 */
export const REPL_LANDMARK_ROLES: readonly RegionLandmark[] = [
  { region: "lesson", role: "navigation", label: "Lessons" },
  { region: "lesson", role: "region", label: "Lesson detail" },
  { region: "editor", role: "textbox", label: "OpenLogo source editor" },
  { region: "repl", role: "toolbar", label: "Run controls" },
  { region: "turtle", role: "img", label: "Turtle canvas" },
  { region: "turtle", role: "status", label: "Turtle state" },
  { region: "diagnostics", role: "log", label: "Diagnostics" },
];

/** The index of `id` within `order`, or throws if it isn't a member (a programming error). */
function indexOf(order: readonly FocusStop[], id: string): number {
  const index = order.findIndex((stop) => stop.id === id);
  if (index === -1) {
    throw new RangeError(`"${id}" is not a stop in this focus order.`);
  }
  return index;
}

/** The next stop after `currentId`, wrapping from the last stop back to the first (no trap). */
export function nextFocusStop(
  order: readonly FocusStop[],
  currentId: string,
): FocusStop {
  const index = indexOf(order, currentId);
  // `order` is never empty (see REPL_FOCUS_ORDER), so this index is always in range.
  return order[(index + 1) % order.length] as FocusStop;
}

/** The stop before `currentId`, wrapping from the first stop back to the last (no trap). */
export function previousFocusStop(
  order: readonly FocusStop[],
  currentId: string,
): FocusStop {
  const index = indexOf(order, currentId);
  // `order` is never empty (see REPL_FOCUS_ORDER), so this index is always in range.
  return order[(index - 1 + order.length) % order.length] as FocusStop;
}

/** How urgently assistive technology should interrupt the user for an announcement. */
export type AnnouncementPoliteness = "polite" | "assertive";

/** One screen-reader announcement, ready to render into an `aria-live` region. */
export interface Announcement {
  readonly politeness: AnnouncementPoliteness;
  readonly message: string;
}

/** A subscriber notified with each new announcement as it is emitted. */
export type AnnouncementListener = (announcement: Announcement) => void;

/** The headless screen-reader announcer over the shared state model. */
export interface A11yAnnouncer {
  /** The single studio state model instance this announcer reads through. */
  readonly state: StudioStateStore;
  /** Every announcement emitted so far, oldest first. */
  getAnnouncements(): readonly Announcement[];
  /** Register a listener notified with each new announcement as it is emitted. */
  subscribeAnnouncements(listener: AnnouncementListener): Unsubscribe;
}

/** Describe a `runStatus` transition using only the structured status value. */
function describeRunStatus(runStatus: StudioState["runStatus"]): string {
  switch (runStatus) {
    case "running":
      return "Run started.";
    case "done":
      return "Run complete.";
    case "stopped":
      return "Run stopped.";
    case "idle":
      return "Ready.";
  }
}

/** Describe the current diagnostics list using only `severity` counts, never `message` prose. */
function describeDiagnostics(diagnostics: StudioState["diagnostics"]): string {
  if (diagnostics.length === 0) {
    return "No diagnostics.";
  }
  let errorCount = 0;
  let warningCount = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") {
      errorCount += 1;
    } else {
      warningCount += 1;
    }
  }
  const parts: string[] = [];
  if (errorCount > 0) {
    parts.push(`${errorCount} error${errorCount === 1 ? "" : "s"}`);
  }
  if (warningCount > 0) {
    parts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
  }
  return `${parts.join(" and ")} found.`;
}

/**
 * A structural identity key for a diagnostics list — `code`/`severity`/`stage`/`source_span`/
 * `params` only, **never** `message` (the diagnostic-identity rule). Used to detect a genuinely
 * *new* diagnostics list rather than merely a new array reference: the diagnostics controller
 * (#125) and run controller (#126) both republish a fresh array on every parse/run even when the
 * diagnostics are unchanged (e.g. re-running clean source stays empty), and announcing that as
 * "new" would spam an assistive-technology user with a redundant interruption on every keystroke
 * or Run.
 */
function diagnosticsKey(diagnostics: StudioState["diagnostics"]): string {
  return JSON.stringify(
    diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      stage: diagnostic.stage,
      source_span: diagnostic.source_span,
      params: diagnostic.params,
    })),
  );
}

/**
 * Construct the screen-reader announcer bound to the shared studio state model (never a copy).
 * Emits an {@link Announcement} whenever `runStatus` or `diagnostics` changes after construction
 * — the initial snapshot is never announced, matching the issue's "when run state changes"/"when
 * a new diagnostic appears" framing (a change, not the starting state).
 */
export function createA11yAnnouncer(state: StudioStateStore): A11yAnnouncer {
  const announcements: Announcement[] = [];
  const listeners = new Set<AnnouncementListener>();
  let lastRunStatus = state.getState().runStatus;
  let lastDiagnosticsKey = diagnosticsKey(state.getState().diagnostics);

  function emit(announcement: Announcement): void {
    announcements.push(announcement);
    for (const listener of listeners) {
      listener(announcement);
    }
  }

  state.subscribe((next) => {
    if (next.runStatus !== lastRunStatus) {
      lastRunStatus = next.runStatus;
      emit({
        politeness: "polite",
        message: describeRunStatus(next.runStatus),
      });
    }
    const nextDiagnosticsKey = diagnosticsKey(next.diagnostics);
    if (nextDiagnosticsKey !== lastDiagnosticsKey) {
      lastDiagnosticsKey = nextDiagnosticsKey;
      const hasError = next.diagnostics.some(
        (diagnostic) => diagnostic.severity === "error",
      );
      emit({
        politeness: hasError ? "assertive" : "polite",
        message: describeDiagnostics(next.diagnostics),
      });
    }
  });

  return {
    state,
    getAnnouncements: () => announcements,
    subscribeAnnouncements(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A subscriber notified with the current text whenever the turtle state changes. */
export type TurtleStateTextListener = (text: string) => void;

/**
 * The headless, always-current non-visual turtle-state text region over the shared state model.
 * Unlike {@link A11yAnnouncer}, this holds exactly one piece of text — the description of the
 * *current* {@link TurtleState} — that a renderer keeps mapped onto a single `status`/
 * `aria-live="polite"` region, rather than a growing announcement log.
 */
export interface TurtleStateRegion {
  /** The single studio state model instance this region reads through. */
  readonly state: StudioStateStore;
  /** The current non-visual turtle-state description, per `@openlogo/turtle`'s `describeTurtleState`. */
  getText(): string;
  /** Register a listener notified with the new text whenever the turtle state changes. */
  subscribeText(listener: TurtleStateTextListener): Unsubscribe;
}

/**
 * Construct the turtle-state text region bound to the shared studio state model (never a copy).
 * The text is computed via `@openlogo/turtle`'s published {@link describeTurtleState} — this
 * module never re-derives position/heading/pen wording itself — and recomputed on every store
 * update, but listeners are notified only when the **text itself** actually changes (not merely
 * on a new `turtleState` object reference): `@openlogo/turtle`'s reducers
 * (`reduceTurtleState`) always return a fresh object on any state-bearing trace event, even a
 * genuine no-op like a repeated `pen_down` while the pen is already down, or `set_color "black"`
 * when the color is already `"black"` — a reference check alone would re-notify identical text on
 * every such no-op tick during a long animation. Comparing the rendered text (like
 * `diagnosticsKey` does for diagnostics, above) is what actually keeps an assistive-technology
 * user from hearing the same sentence repeated. So the region reads in lockstep with the Canvas
 * view as a program runs, only ever announcing a *genuine* change. Unlike
 * {@link createA11yAnnouncer}, the initial state's text *is* available immediately via
 * {@link TurtleStateRegion.getText} (there is always a "current" turtle state to describe, even
 * before any run) — only {@link TurtleStateRegion.subscribeText} listeners are limited to changes
 * after construction.
 */
export function createTurtleStateRegion(
  state: StudioStateStore,
): TurtleStateRegion {
  const listeners = new Set<TurtleStateTextListener>();
  let text = describeTurtleState(state.getState().turtleState);

  state.subscribe((next) => {
    const nextText = describeTurtleState(next.turtleState);
    if (nextText !== text) {
      text = nextText;
      for (const listener of listeners) {
        listener(text);
      }
    }
  });

  return {
    state,
    getText: () => text,
    subscribeText(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
