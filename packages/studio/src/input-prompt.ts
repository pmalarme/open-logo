/**
 * The learner-facing prompt for the blocking `input` reporter (#769) — the studio half of the host
 * reader seam #681 shipped in `@openlogo/runtime`
 * (`ExecuteOptions.hostInput.read?: (prompt: string) => string | undefined`).
 *
 * This module owns **only the prompt itself**: the pending question, the view a renderer paints,
 * and the two ways a learner can end it (answer / dismiss). It knows nothing about executing a
 * program — `run-controller.ts` drives it through the {@link InputPromptHost} seam below, which is
 * the single point of contact between the two.
 *
 * ## The seam, and why it is `present`/`respond` rather than a return value
 * `@openlogo/runtime`'s reader is **synchronous** — `spec/interaction-events.md:169-172` requires
 * that no OpenLogo instruction and no handler block runs until the read finishes, and a synchronous
 * call is that guarantee by construction. A browser cannot block its event loop for an arbitrary
 * styled, keyboard-operable, screen-reader-announced prompt, so this host is deliberately
 * **asynchronous**: `present()` hands over the question plus a responder the UI calls whenever the
 * learner is ready. `run-controller.ts` is what reconciles the two shapes (see its
 * "#769 — the `input` prompt and the synchronous reader" doc section); nothing here works around
 * the runtime's semantics, and this package never reaches into `@openlogo/runtime` to change them.
 *
 * A host may call `respond` **synchronously from inside `present`** (a scripted test host, or a
 * hypothetical `window.prompt`-backed one). `run-controller.ts` handles that re-entrancy
 * explicitly, so both shapes are supported.
 *
 * ## The one thing a host must not do
 * `present()` must **not unconditionally restart the run** — calling `reset()` then `run()` (or
 * `run()` after any other transition out of `"running"`) on *every* presentation is a host-side
 * infinite loop, and **nothing bounds it**. Each restart begins a fresh execution with a fresh
 * `instructionBudget`, so the runtime's own safety gate never fires: measured at 5,000 questions in
 * 460ms with no diagnostic and `runStatus` stuck at `"running"`.
 *
 * A program with genuinely unbounded reads — `forever [ :answer = input "?" ]`, note the
 * **assignment**, since a bare `input "?"` statement reads nothing at all — is *formally* different
 * but practically no better through this host: a single `execute()` of it hits the instruction
 * budget, but the run controller answers only one more read per attempt, so it puts on the order of
 * 500,000 questions to the learner at the default budget while replaying quadratically many reads
 * to get there. It presents as a hang too. Neither is defended against in code,
 * because no library can defend against a callback that unconditionally re-invokes the operation it
 * was called back from, and because the retry cap `run-controller.ts` used to carry counted
 * no-progress attempts *within one chain*: the unbounded-reads program makes progress on every
 * attempt, and the host-restart loop never has a second attempt in any chain for the counter to
 * reach. Restarting in response to a *learner action* is fine; doing
 * it on every presentation is not.
 *
 * ## `dismiss()` — withdrawing a question nobody will answer
 * Stop and Reset can both happen while a question is on screen. Neither is an *answer*, so neither
 * may go through `respond`: `run-controller.ts` calls {@link InputPromptHost.dismiss} to take the
 * question down, and decides the run's outcome itself. A host must treat `dismiss()` as "this
 * question is void" and must not call `respond` for it.
 *
 * ## Accessibility ({@link INPUT_PROMPT_FOCUS_ORDER})
 * `spec/rendering.md`'s Keyboard operability section requires every control be reachable and
 * operable by keyboard, and the prompt is where a learner is *most* stuck if it is not — the
 * program cannot continue until they answer it. The prompt is therefore modeled as a **dialog with
 * its own focus scope**, not as extra stops inside `a11y.ts`'s {@link REPL_FOCUS_ORDER}: while a
 * question is open it is the only thing to interact with, so its three stops (the answer field,
 * Answer, Cancel) form their own cycle. That is not a keyboard trap in the accessibility-defect
 * sense — {@link INPUT_PROMPT_CANCEL_LABEL} (and, in `index.html`, the Escape key routed through
 * the native `<dialog>`'s `cancel` event) always ends it. `nextFocusStop`/`previousFocusStop` from
 * `a11y.ts` are generic over an order array, so the same tested helpers prove this scope cycles
 * both ways without a trap.
 *
 * The question text is the learner's **own program's** prompt, rendered verbatim as text (never
 * markup) — `web/main.ts` assigns it through `textContent`, so a program whose prompt happens to
 * contain angle brackets displays them rather than injecting elements.
 */

import type { FocusStop } from "./a11y.js";
import type { Unsubscribe } from "./state-model.js";

/** One outstanding `input` read, as the learner sees it. */
export interface InputPromptRequest {
  /**
   * The prompt, already rendered to displayable text by `@openlogo/runtime` (the reader is called
   * with `printedForm`'s output). Studio never re-formats it.
   */
  readonly prompt: string;
}

/**
 * How a host reports the end of one outstanding read: the learner's answer, or `undefined` when
 * they dismissed the question — which is exactly the runtime reader's own `undefined`, cancelling
 * the run (`spec/interaction-events.md:171-172`'s only other ending for a read).
 */
export type InputPromptResponder = (answer: string | undefined) => void;

/** The seam `run-controller.ts` presents an outstanding read through. */
export interface InputPromptHost {
  /**
   * Show `request` and call `respond` exactly once with the learner's answer (or `undefined` if
   * they dismiss it). May call `respond` synchronously; may also never call it, if
   * {@link InputPromptHost.dismiss} withdraws the question first.
   */
  present(request: InputPromptRequest, respond: InputPromptResponder): void;
  /**
   * Withdraw the outstanding question without answering it (Stop/Reset). The responder handed to
   * {@link InputPromptHost.present} must **not** be called for a withdrawn question — the caller
   * has already decided the run's outcome.
   */
  dismiss(): void;
}

/** The prompt's fully-decided presentation — a renderer applies it 1:1, deciding nothing itself. */
export interface InputPromptView {
  /** Whether a question is currently outstanding (the dialog is open). */
  readonly isVisible: boolean;
  /** The program's own prompt text, or `""` when nothing is outstanding. */
  readonly prompt: string;
  /** The accessible label for the answer field. */
  readonly fieldLabel: string;
  /** The submit control's visible text and accessible name. */
  readonly submitLabel: string;
  /** The dismiss control's visible text and accessible name. */
  readonly cancelLabel: string;
}

/** Notified with the prompt's new view after every change. */
export type InputPromptViewListener = (view: InputPromptView) => void;

/** The answer field's accessible label. */
export const INPUT_PROMPT_FIELD_LABEL = "Your answer";

/** The submit control's label — it finishes the read with the entered text. */
export const INPUT_PROMPT_SUBMIT_LABEL = "Answer";

/** The dismiss control's label — it ends the read unanswered, which cancels the run. */
export const INPUT_PROMPT_CANCEL_LABEL = "Cancel";

/**
 * The prompt dialog's own keyboard focus scope: answer field → Answer → Cancel. Deliberately
 * separate from `a11y.ts`'s {@link REPL_FOCUS_ORDER} — see this module's doc comment. Every stop
 * belongs to the `"repl"` region, since the prompt is part of the run loop rather than a new pane.
 */
export const INPUT_PROMPT_FOCUS_ORDER: readonly FocusStop[] = [
  {
    id: "input-prompt-field",
    region: "repl",
    role: "textbox",
    label: INPUT_PROMPT_FIELD_LABEL,
  },
  {
    id: "input-prompt-submit",
    region: "repl",
    role: "button",
    label: INPUT_PROMPT_SUBMIT_LABEL,
  },
  {
    id: "input-prompt-cancel",
    region: "repl",
    role: "button",
    label: INPUT_PROMPT_CANCEL_LABEL,
  },
];

/** The view for "no question outstanding" — the dialog closed, with no stale prompt text left. */
const HIDDEN_INPUT_PROMPT_VIEW: InputPromptView = {
  isVisible: false,
  prompt: "",
  fieldLabel: INPUT_PROMPT_FIELD_LABEL,
  submitLabel: INPUT_PROMPT_SUBMIT_LABEL,
  cancelLabel: INPUT_PROMPT_CANCEL_LABEL,
};

/**
 * Maps the outstanding request (or its absence) to the prompt's fully-decided presentation — the
 * one tested place that owns this decision, so `web/main.ts` never branches on it itself (this
 * package's "thin, branch-free wiring layer" rule).
 */
export function mapInputPromptRequestToView(
  request: InputPromptRequest | null,
): InputPromptView {
  if (request === null) {
    return HIDDEN_INPUT_PROMPT_VIEW;
  }
  return {
    ...HIDDEN_INPUT_PROMPT_VIEW,
    isVisible: true,
    prompt: request.prompt,
  };
}

/** The headless prompt controller — an {@link InputPromptHost} a renderer can subscribe to. */
export interface InputPromptController extends InputPromptHost {
  /** The prompt's current presentation. */
  getView(): InputPromptView;
  /** Register a listener notified with the new view after every change. */
  subscribeView(listener: InputPromptViewListener): Unsubscribe;
  /** Finish the outstanding read with `answer`. A no-op when nothing is outstanding. */
  submit(answer: string): void;
  /**
   * End the outstanding read unanswered — the learner dismissed the question, which cancels the
   * run (`spec/interaction-events.md:171-172`). A no-op when nothing is outstanding.
   */
  cancel(): void;
}

/**
 * Construct the prompt controller. It holds only the single outstanding question (like
 * `run-log.ts`/`tutor-output-pane.ts` hold their own derived state) rather than a field on the
 * shared state model: a question is a transient interaction between the run controller and the
 * learner, not a value other panes render from, and keeping it here means `state-model.ts`'s
 * snapshot contract is untouched.
 */
export function createInputPromptController(): InputPromptController {
  let request: InputPromptRequest | null = null;
  let responder: InputPromptResponder | null = null;
  const listeners = new Set<InputPromptViewListener>();

  function publish(): void {
    const view = mapInputPromptRequestToView(request);
    for (const listener of listeners) {
      listener(view);
    }
  }

  /** Clear the outstanding question and hand back the responder that was waiting on it. */
  function takeResponder(): InputPromptResponder | null {
    const pending = responder;
    request = null;
    responder = null;
    publish();
    return pending;
  }

  return {
    present(next, respond) {
      request = next;
      responder = respond;
      publish();
    },
    dismiss() {
      // Withdrawn, never answered: drop the responder without calling it (see this module's doc
      // comment) — the caller has already decided the run's outcome.
      takeResponder();
    },
    submit(answer) {
      takeResponder()?.(answer);
    },
    cancel() {
      takeResponder()?.(undefined);
    },
    getView: () => mapInputPromptRequestToView(request),
    subscribeView(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
