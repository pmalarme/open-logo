/**
 * The lesson pane (#127) — a headless, fully-testable controller that renders curriculum content
 * into the app shell's `lesson` region (`APP_SHELL_REGIONS` in `app-shell.ts`, unchanged since
 * #123). It reads the shared state model's `lesson` field (`LessonContext` — just an id/title
 * pair, see `state-model.ts`) and resolves the full `Lesson` — objective, worked examples,
 * exercise prompt — through `@openlogo/edu`'s read-only `Lesson` contract (#189). This module
 * never defines its own lesson-content shape and never authors curriculum content itself (that is
 * `@curriculum`'s job); it only projects an already-authored `Lesson` into a render-ready view.
 *
 * ## Sandbox (no-lesson) mode
 * The state model's `lesson` starts at `{ lessonId: null, title: null }` (`state-model.ts`'s
 * `INITIAL_LESSON`) and stays there unless something calls `state.setLesson(...)` — which lesson
 * to load, if any, is a future slice's concern (e.g. a curriculum picker); this slice only makes
 * sure that whenever no lesson is loaded, or `lessonId` no longer resolves to a registered
 * `Lesson` (a stale/unknown id), {@link LessonPaneController.getView} degrades to
 * {@link NO_LESSON_VIEW} rather than throwing — so the freeform/sandbox Given/When/Then ("the
 * lesson pane is absent or collapsed and the editor/diagnostics panes still function fully") holds
 * unconditionally. `isVisible` is the single boolean a renderer needs to decide whether to show or
 * hide the pane; every other field is `""`/`[]` in that case so a renderer never has to branch
 * before reading them (mirroring `diagnostics.ts`/`run-log.ts`'s "always return a fully-formed,
 * non-branching view" convention).
 *
 * ## Resolving a `Lesson`
 * {@link LessonLookup} is the pluggable seam between `lessonId` and the full `Lesson` — defaults
 * to `@openlogo/edu`'s published `findLessonById`, which searches the real curriculum registry,
 * but is injectable so this module's own tests can resolve fixed fixture lessons without
 * depending on whatever curriculum content `@openlogo/edu` happens to ship.
 *
 * ## DOM/mount integration contract (for the real-widget wiring in `web/main.ts`)
 * Exactly like `editor.ts`/`diagnostics.ts`, this stays headless (ADR-0001 defers the studio
 * shell's DOM/framework choice): `web/main.ts` looks up `#lesson-pane`, calls
 * `mountLessonPane(shell, createLessonPaneController(state))`, and on every state change sets
 * `element.hidden = !view.isVisible` and (re)builds the section's heading structure — an `<h2>`
 * for the lesson title, then `<h3>`s for "Objective", each worked example, and the exercise
 * prompt — from {@link LessonPaneView}'s fields. `index.html`'s `#lesson-pane` section already
 * carries `role="region"`/`aria-label="Lesson"`/`tabindex="0"` (this slice's a11y fix — see
 * `a11y.ts`'s `REPL_LANDMARK_ROLES`/`REPL_FOCUS_ORDER`), and its native `hidden` attribute removes
 * it from the accessibility tree and keyboard focus order whenever no lesson is loaded, with no
 * further branching needed anywhere.
 */

import type { Lesson } from "@openlogo/edu";
import { findLessonById } from "@openlogo/edu";
import type { AppShell } from "./app-shell.js";
import type { StudioStateStore } from "./state-model.js";

/**
 * Resolves a lesson id to its full {@link Lesson}, or `undefined` if none is registered under
 * that id. Defaults to `@openlogo/edu`'s `findLessonById`; injectable so tests can resolve fixed
 * fixture lessons instead of depending on the real curriculum registry's contents.
 */
export type LessonLookup = (lessonId: string) => Lesson | undefined;

/** One worked example, ready to render — copied straight from `@openlogo/edu`'s `WorkedExample`. */
export interface WorkedExampleViewItem {
  /** The annotated OpenLogo source the learner can read and run. */
  readonly source: string;
  /** The plain-language explanation of what the example shows and why. */
  readonly explanation: string;
}

/**
 * The lesson pane's rendering model — always fully formed, never requiring a renderer to branch
 * before reading a field. `isVisible` is the single decision a renderer needs: whether to show or
 * hide the pane (`false` in freeform/sandbox mode, or when `lessonId` no longer resolves to a
 * registered lesson).
 */
export interface LessonPaneView {
  /** Whether a lesson is loaded and should be shown; `false` means sandbox mode. */
  readonly isVisible: boolean;
  /** The lesson's learner-facing title, or `""` when `isVisible` is `false`. */
  readonly title: string;
  /** The single idea this lesson teaches, or `""` when `isVisible` is `false`. */
  readonly objective: string;
  /** This lesson's worked examples, in order; `[]` when `isVisible` is `false`. */
  readonly workedExamples: readonly WorkedExampleViewItem[];
  /** What the learner is asked to try next, or `""` when `isVisible` is `false`. */
  readonly exercisePrompt: string;
}

/**
 * The fixed sandbox/no-lesson view: every field empty, `isVisible: false`. Returned whenever no
 * lesson is loaded, or a loaded `lessonId` no longer resolves — see this module's doc comment.
 */
export const NO_LESSON_VIEW: LessonPaneView = {
  isVisible: false,
  title: "",
  objective: "",
  workedExamples: [],
  exercisePrompt: "",
};

/** Optional configuration for {@link createLessonPaneController}. */
export interface LessonPaneControllerOptions {
  /** Resolves a lesson id to its full {@link Lesson}. Defaults to `@openlogo/edu`'s `findLessonById`. */
  readonly lookup?: LessonLookup;
}

/** The headless lesson pane controller over the shared studio state model. */
export interface LessonPaneController {
  /** The single studio state model instance this controller reads through (never a copy). */
  readonly state: StudioStateStore;
  /** The current rendering model, derived from the store's live `lesson` context. */
  getView(): LessonPaneView;
}

function toView(lesson: Lesson): LessonPaneView {
  return {
    isVisible: true,
    title: lesson.title,
    objective: lesson.objective,
    workedExamples: lesson.workedExamples.map((example) => ({
      source: example.source,
      explanation: example.explanation,
    })),
    exercisePrompt: lesson.exercisePrompt,
  };
}

/** Construct the lesson pane controller bound to the shared studio state model (never a copy). */
export function createLessonPaneController(
  state: StudioStateStore,
  options: LessonPaneControllerOptions = {},
): LessonPaneController {
  const lookup = options.lookup ?? findLessonById;

  return {
    state,
    getView() {
      const { lessonId } = state.getState().lesson;
      if (lessonId === null) {
        return NO_LESSON_VIEW;
      }
      const lesson = lookup(lessonId);
      return lesson === undefined ? NO_LESSON_VIEW : toView(lesson);
    },
  };
}

/** Compose the lesson pane controller into the app shell's `lesson` region. */
export function mountLessonPane(
  shell: AppShell,
  controller: LessonPaneController,
): void {
  shell.mount("lesson", controller);
}
