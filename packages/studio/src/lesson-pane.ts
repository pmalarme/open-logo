/**
 * The lesson pane (#127) — a headless, fully-testable controller plus pure view projections over
 * the single studio state model's (#123) `lesson` field and `@openlogo/edu`'s read-only `Lesson`
 * content contract (#189). Mirrors `run-log.ts`'s (#314) precedent: every rendering DECISION —
 * which lessons are selectable, which one is currently shown, what the worked examples/exercise
 * prompt look like once formatted, what to show when nothing is selected yet — lives in this
 * module and is fully covered by `lesson-pane.test.mjs`; `web/main.ts` only loops over the
 * already-computed view items to build DOM nodes (unavoidable, since this repository's
 * `node:test` suite has no DOM).
 *
 * ## Read-only rendering of the #189 data contract
 * This pane never authors, edits, or executes a lesson — it renders `@openlogo/edu`'s published
 * `Lesson` shape (`LESSONS`, `findLessonById`) exactly as fixed by #189: `id`, `title`, `level`,
 * `objective`, `workedExamples` (`source` + `explanation`), `exercisePrompt`. No AI, no lesson
 * execution — those are separate, later slices.
 *
 * ## Selection lives in the shared state model, not a private copy
 * `state-model.ts`'s `LessonContext` (`{ lessonId, title }`) already exists for this pane (#123's
 * doc comment reserves it) — {@link createLessonPaneController} reads/writes through it via
 * `getState().lesson`/`setLesson`, exactly like `editor.ts` reads/writes `source` straight through
 * the shared store, so no consumer can ever hold a stale, forked notion of which lesson is open.
 *
 * ## Rendering — {@link toLessonNavItems} / {@link toLessonDetailViewItem}
 * {@link toLessonNavItems} projects the full lesson list into one already-labeled
 * {@link LessonNavItem} per lesson (with `isSelected` precomputed), for a browsable nav list.
 * {@link toLessonDetailViewItem} projects the *selected* lesson (or `undefined`, when none is
 * selected yet) into a single {@link LessonDetailViewItem} carrying its title/level/objective,
 * every worked example (`source` + `explanation`, verbatim from #189 — never reformatted), and
 * the exercise prompt — or, when nothing is selected, `hasLesson: false` plus a fixed
 * {@link NO_LESSON_SELECTED_LABEL}, mirroring #314's `NO_RUN_LOG_ENTRIES_LABEL` empty-state
 * convention so `web/main.ts` only ever branches on the already-computed `hasLesson` flag.
 */

import type { Lesson } from "@openlogo/edu";
import { LESSONS } from "@openlogo/edu";
import type { AppShell } from "./app-shell.js";
import type { StudioStateStore } from "./state-model.js";

/** Optional configuration for {@link createLessonPaneController}. */
export interface LessonPaneControllerOptions {
  /** The lesson list to browse/select among. Defaults to `@openlogo/edu`'s published `LESSONS`. */
  readonly lessons?: readonly Lesson[];
}

/** The headless lesson pane controller over the shared studio state model. */
export interface LessonPaneController {
  /** The single studio state model instance this controller reads/writes through (never a copy). */
  readonly state: StudioStateStore;
  /** Every lesson this pane can browse/select among, in the configured (registry) order. */
  getLessons(): readonly Lesson[];
  /** The currently selected lesson, or `undefined` if none is selected or the id is unknown. */
  getSelectedLesson(): Lesson | undefined;
  /** Select the lesson identified by `lessonId`, or clear the selection when passed `null`. */
  selectLesson(lessonId: string | null): void;
}

/**
 * Construct the lesson pane controller bound to the shared studio state model (never a copy).
 * `options.lessons` defaults to `@openlogo/edu`'s published `LESSONS` registry — pass a smaller
 * fixture list in tests to avoid coupling to the curriculum's exact current content.
 */
export function createLessonPaneController(
  state: StudioStateStore,
  options: LessonPaneControllerOptions = {},
): LessonPaneController {
  const lessons = options.lessons ?? LESSONS;

  function findLesson(lessonId: string): Lesson | undefined {
    return lessons.find((lesson) => lesson.id === lessonId);
  }

  return {
    state,
    getLessons: () => lessons,
    getSelectedLesson() {
      const { lessonId } = state.getState().lesson;
      return lessonId === null ? undefined : findLesson(lessonId);
    },
    selectLesson(lessonId) {
      if (lessonId === null) {
        state.setLesson({ lessonId: null, title: null });
        return;
      }
      const lesson = findLesson(lessonId);
      state.setLesson({ lessonId, title: lesson?.title ?? null });
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

/** Fixed placeholder shown in the detail view when no lesson is selected yet. */
export const NO_LESSON_SELECTED_LABEL =
  "Select a lesson from the list to get started.";

/** One lesson in the browsable nav list, already labeled and selection-flagged for rendering. */
export interface LessonNavItem {
  readonly id: string;
  readonly title: string;
  readonly level: Lesson["level"];
  /** Whether this is the currently selected lesson (for `aria-current`/styling). */
  readonly isSelected: boolean;
}

/**
 * Project the full lesson list into a ready-to-render nav list, in registry order — one item per
 * lesson, each already carrying whether it is the current selection, so `web/main.ts` never has
 * to compare ids itself.
 */
export function toLessonNavItems(
  lessons: readonly Lesson[],
  selectedLessonId: string | null,
): readonly LessonNavItem[] {
  return lessons.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    level: lesson.level,
    isSelected: lesson.id === selectedLessonId,
  }));
}

/** One worked example, ready for direct rendering — copied verbatim from #189's `WorkedExample`. */
export interface LessonWorkedExampleViewItem {
  readonly source: string;
  readonly explanation: string;
}

/** The lesson detail view's rendering model — either a selected lesson's content, or the empty state. */
export interface LessonDetailViewItem {
  /** Whether a lesson is selected. When `false`, every other field below is empty/unset. */
  readonly hasLesson: boolean;
  readonly id: string;
  readonly title: string;
  readonly level: Lesson["level"] | "";
  readonly objective: string;
  readonly workedExamples: readonly LessonWorkedExampleViewItem[];
  readonly exercisePrompt: string;
  /** {@link NO_LESSON_SELECTED_LABEL} when `hasLesson` is `false`; `""` otherwise. */
  readonly emptyStateLabel: string;
}

const EMPTY_LESSON_DETAIL_VIEW_ITEM: LessonDetailViewItem = {
  hasLesson: false,
  id: "",
  title: "",
  level: "",
  objective: "",
  workedExamples: [],
  exercisePrompt: "",
  emptyStateLabel: NO_LESSON_SELECTED_LABEL,
};

/**
 * Project the selected lesson (or `undefined`, when none is selected) into the detail view's
 * rendering model. Always returns a fully-formed {@link LessonDetailViewItem} — when `lesson` is
 * `undefined` the result is the fixed {@link EMPTY_LESSON_DETAIL_VIEW_ITEM}, so `web/main.ts` only
 * ever branches on the returned `hasLesson` flag rather than on `lesson` being present itself.
 */
export function toLessonDetailViewItem(
  lesson: Lesson | undefined,
): LessonDetailViewItem {
  if (lesson === undefined) {
    return EMPTY_LESSON_DETAIL_VIEW_ITEM;
  }
  return {
    hasLesson: true,
    id: lesson.id,
    title: lesson.title,
    level: lesson.level,
    objective: lesson.objective,
    workedExamples: lesson.workedExamples.map((example) => ({
      source: example.source,
      explanation: example.explanation,
    })),
    exercisePrompt: lesson.exercisePrompt,
    emptyStateLabel: "",
  };
}
