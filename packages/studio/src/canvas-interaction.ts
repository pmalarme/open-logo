/**
 * The studio's keyboard and pointer input surface (#952) — the wiring that turns a learner's real
 * key press or click into a delivery on `run-controller.ts`'s host-input seam, so `on_key` and
 * `on_click` fire.
 *
 * ## Why this lives in `src/` and not in `web/main.ts`
 * `web/**` is outside this package's `src` build graph: it is **neither type-checked nor linted**,
 * and no test imports it — yet it is bundled and shipped. So every decision lives here, behind the
 * two tiny structural element interfaces below, and `web/main.ts` only looks the elements up and
 * hands them over. Same rule `web-bootstrap.ts` and `execution-worker-runner.ts` already follow.
 *
 * ## The two ways to activate the drawing surface
 * `spec/interaction-events.md:298-299` says `on_click` runs "when the drawing surface is clicked
 * **or activated by an equivalent accessible action**". Both are wired, and neither is a fallback
 * for the other:
 * - the canvas's own pointer `click`;
 * - a real, labelled, tab-reachable **Activate canvas button**, which the browser natively operates
 *   with Enter and Space and which a screen reader announces as a button.
 *
 * A separate control rather than Enter/Space on the focused canvas, because the canvas is also the
 * keyboard surface: `"enter"` and `"space"` are two of the key words `:251-255` names, so a learner
 * writing `on_key "space"` must receive a space press, not an activation. The two affordances stay
 * distinct so neither has to guess which the learner meant.
 *
 * Nothing about a click's *position* is carried, and that is not a shortcut: OpenLogo v0.1
 * "does not standardize click coordinate reporters" (`:273-275`), so a click has no payload for a
 * button to be unable to supply — which is precisely what makes a keyboard activation an *equal*
 * click rather than a degraded one.
 *
 * ## Why some keys have their default suppressed and most do not
 * Arrows, space, and the paging keys scroll the page. A learner playing `10-game.logo` would drive
 * the turtle and scroll the studio out from under themselves at the same time. So the default is
 * suppressed for exactly {@link SCROLLING_KEY_WORDS} — and only when
 * {@link RunController.deliverKey} reports **synchronously that this very press ran a handler**,
 * which it answers by comparing `on_key` invocation markers across that one delivery.
 *
 * Two exceptions follow directly from that, and neither over-suppresses:
 * - **a host that settles across event-loop turns** (the Worker one) cannot confirm in time, so it
 *   reports `false` for every press and **nothing is suppressed there at all**. The handler still
 *   *runs* — this is a gap in confirmation, not in delivery. It is structural rather than
 *   incidental: an `ExecutionRequest` crosses that boundary by structured clone, so the occurrence
 *   objects a Worker run reports back are copies and no identity survives to match a delivery on
 *   (`execution-host.ts`'s `ExecutionSettlement.handlerDeliveries`);
 * - **a press past the program's last usable tick**, where nothing ran and not suppressing is
 *   simply *exact*.
 *
 * The first is *conservative*: the studio declines to intercept a key it cannot prove ran a handler.
 *
 * **A non-literal key word is no longer an exception.** Until #976 the studio read declared key
 * words out of the program's source, so `on_key :chosen [ … ]` was unknowable and reported `false`
 * however plainly the handler fired. The runtime now reports what each delivery actually did
 * (`@openlogo/runtime`'s `ExecuteOptions.handlerDeliveries`), and a count does not care how the key
 * word was written.
 *
 * The unit of the decision is the **individual press**, not the program: a program registering
 * `on_key "up"` only suppresses `up`, and one with no interaction at all suppresses nothing and
 * behaves exactly as it did before this seam existed. That is not a nicety. Most OpenLogo programs —
 * every drawing example, every geometry lesson, everything below the Interaction profile — can
 * never respond to a key, and swallowing scrolling for them would present to a learner as "the
 * studio is broken", affecting everyone rather than only the few using Interaction. The bug this
 * slice fixes is silent inaction; the regression it must not introduce is silent interception —
 * which is why every one of the cases above resolves toward *not* suppressing.
 *
 * `"tab"` is deliberately **not** in that list even for a key a handler names: it is how a learner
 * leaves the canvas, and a game that could swallow it would be a keyboard trap. `"enter"` and
 * `"escape"` are left alone for the same reason — they operate the surrounding UI.
 *
 * ## Why the listener is on the canvas and nowhere else
 * `keydown` is registered on the drawing surface itself, never on `document` or `window`. A learner
 * typing `forward 100` in the editor is not on that event path at all, so editor focus wins over
 * canvas focus by construction rather than by a check that could be got wrong.
 *
 * ## Why the activation control hides itself
 * A focusable control that nothing can respond to is a tab stop every learner pays for and only
 * interactive programs use. So it is `hidden` until the live run registers `on_click`
 * ({@link RunController.acceptsClick}) — the same mechanism `a11y.ts` documents for the lesson pane,
 * where `index.html`'s `hidden` attribute rather than `REPL_FOCUS_ORDER` is what removes a stop from
 * the real browser tab order.
 */

import type { RunController } from "./run-controller.js";
import { normalizeKeyWord } from "./key-words.js";

/** The part of a browser `KeyboardEvent` this module reads. */
export interface KeyboardEventLike {
  /** The `KeyboardEvent.key` value — normalized by `key-words.ts`, never used raw. */
  readonly key: string;
  /** Suppresses the browser's own action for this key. */
  preventDefault(): void;
}

/**
 * The structural shape of the real `<canvas>` this module attaches to. Declared locally rather than
 * reused from `lib.dom`, which this package's `tsconfig` does not include — the same boundary
 * `canvas-view.ts` draws for the 2-D context.
 */
export interface CanvasInteractionElement {
  addEventListener(
    type: "keydown",
    listener: (event: KeyboardEventLike) => void,
  ): void;
  addEventListener(type: "click", listener: () => void): void;
}

/** The structural shape of the keyboard-reachable activation control (a real `<button>`). */
export interface ActivationControlElement {
  addEventListener(type: "click", listener: () => void): void;
  /**
   * The native `hidden` attribute. Set rather than a CSS class, because `hidden` is what actually
   * removes the control from the browser's tab order — the same mechanism `index.html` uses for the
   * lesson pane.
   *
   * Typed `boolean | string` only so a real `HTMLButtonElement` is structurally assignable: the DOM
   * widened this property for `hidden="until-found"`. This module only ever writes a `boolean`.
   */
  hidden: boolean | string;
}

/**
 * The key words whose browser default is suppressed once the press has been delivered — every key
 * that would otherwise scroll the page out from under a learner who is driving the turtle with it.
 * See this module's doc comment for why `"tab"`, `"enter"`, and `"escape"` are absent.
 */
export const SCROLLING_KEY_WORDS: readonly string[] = [
  "left",
  "right",
  "up",
  "down",
  "space",
  "page_up",
  "page_down",
  "home",
  "end",
];

/**
 * The accessible name of the activation control — the "equivalent accessible action" `on_click`
 * requires. Exported so `index.html`'s button and this module cannot drift apart (asserted by
 * `index.test.mjs`).
 */
export const CANVAS_ACTIVATION_LABEL = "Activate canvas";

/** The visible text on that control. */
export const CANVAS_ACTIVATION_TEXT = "Activate";

/**
 * The description a screen reader reads for the canvas, telling a learner that the surface takes
 * key presses and how to activate it without a pointer. Rendered in `index.html` as the canvas's
 * `aria-describedby` target.
 */
export const CANVAS_INTERACTION_HELP_TEXT =
  "While a program is running, keys pressed here are sent to its on_key handlers. " +
  "A program that uses on_click also shows an Activate canvas button beside this canvas, " +
  "which triggers it without a pointer.";

/** Whether `keyWord` is one whose browser default this module suppresses once it is delivered. */
export function suppressesBrowserDefault(keyWord: string): boolean {
  return SCROLLING_KEY_WORDS.includes(keyWord);
}

/**
 * Handle one `keydown` on the canvas: normalize it to an OpenLogo key word, deliver it, and suppress
 * the browser's own scrolling only on **synchronous confirmation** that the press ran a handler, for
 * a key that would otherwise scroll.
 *
 * Reports the key word that confirmation names, or `null` when there is none. `null` covers two
 * genuinely different situations, and conflating them is what this wording exists to avoid:
 * - **Nothing ran, and that is known.** A bare modifier, a key no `on_key` names, a program with no
 *   `on_key` at all, or a press past the program's last usable tick. Not suppressing is *exact*.
 * - **Something may have run, but it cannot be confirmed in time.** Under a host that settles across
 *   event-loop turns the handler does fire — measured, a Worker press reported `null` with
 *   `preventDefault` never called while the program still printed `"hit"`. Not suppressing is
 *   *conservative*: the studio declines to intercept a key it cannot prove was the program's.
 *
 * Exported so the decision is testable without a DOM.
 */
export function handleCanvasKeyDown(
  controller: RunController,
  event: KeyboardEventLike,
): string | null {
  const keyWord = normalizeKeyWord(event.key);
  if (keyWord === null) {
    return null;
  }
  if (!controller.deliverKey(keyWord)) {
    return null;
  }
  if (suppressesBrowserDefault(keyWord)) {
    event.preventDefault();
  }
  return keyWord;
}

/** The real elements {@link mountCanvasInteraction} attaches to. */
export interface CanvasInteractionElements {
  /** The drawing surface: the keyboard surface and the pointer click target. */
  readonly canvas: CanvasInteractionElement;
  /** The keyboard-reachable activation control — `on_click`'s accessible equivalent. */
  readonly activationControl: ActivationControlElement;
}

/**
 * Attach the studio's keyboard and pointer input to `controller` (#952): canvas `keydown` →
 * `deliverKey`, canvas `click` and the activation control → `deliverClick`, and the activation
 * control's visibility to whether an activation can reach a handler at all.
 *
 * The controller decides whether any of it reaches the program — a delivery to a program that
 * registered no such handler runs nothing at all (see `run-controller.ts`'s doc comment, "#952").
 * This function makes no decision beyond which DOM event feeds which delivery, and which browser
 * default a press the program registered for suppresses.
 */
export function mountCanvasInteraction(
  elements: CanvasInteractionElements,
  controller: RunController,
): void {
  elements.canvas.addEventListener("keydown", (event) => {
    handleCanvasKeyDown(controller, event);
  });
  elements.canvas.addEventListener("click", () => {
    controller.deliverClick();
    syncActivationControl(elements, controller);
  });
  elements.activationControl.addEventListener("click", () => {
    controller.deliverClick();
    syncActivationControl(elements, controller);
  });
  syncActivationControl(elements, controller);
  controller.state.subscribe(() => {
    syncActivationControl(elements, controller);
  });
}

/**
 * Show the activation control while the live run has an `on_click` **registration**, and hide it
 * otherwise — so a program with no interaction adds no tab stop a learner cannot use. It follows
 * registration rather than reachability, so the control can outlive its own usefulness by the tail
 * of a run: visible and inert, never hidden while it still works
 * ({@link RunController.acceptsClick}). See
 * this module's doc comment.
 */
export function syncActivationControl(
  elements: CanvasInteractionElements,
  controller: RunController,
): void {
  elements.activationControl.hidden = !controller.acceptsClick();
}
