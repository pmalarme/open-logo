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
 * `spec/interaction-events.md:214-215` says `on_click` runs "when the drawing surface is clicked
 * **or activated by an equivalent accessible action**". Both are wired, and neither is a fallback
 * for the other:
 * - the canvas's own pointer `click`;
 * - a real, labelled, tab-reachable **Activate canvas button**, which the browser natively operates
 *   with Enter and Space and which a screen reader announces as a button.
 *
 * A separate control rather than Enter/Space on the focused canvas, because the canvas is also the
 * keyboard surface: `"enter"` and `"space"` are two of the key words `:194-198` names, so a learner
 * writing `on_key "space"` must receive a space press, not an activation. The two affordances stay
 * distinct so neither has to guess which the learner meant.
 *
 * Nothing about a click's *position* is carried, and that is not a shortcut: OpenLogo v0.1
 * "does not standardize click coordinate reporters" (`:216-218`), so a click has no payload for a
 * button to be unable to supply — which is precisely what makes a keyboard activation an *equal*
 * click rather than a degraded one.
 *
 * ## Why some keys have their default suppressed and most do not
 * Arrows, space, and the paging keys scroll the page. A learner playing `10-game.logo` would drive
 * the turtle and scroll the studio out from under themselves at the same time. So the default is
 * suppressed for exactly {@link SCROLLING_KEY_WORDS} — and only when
 * {@link RunController.deliverKey} reports that **the program actually responded to that press**.
 *
 * The unit of that decision is the **individual press**, not the program: a program registering
 * `on_key "up"` only suppresses `up`, and one with no interaction at all suppresses nothing and
 * behaves exactly as it did before this seam existed. That is not a nicety. Most OpenLogo programs —
 * every drawing example, every geometry lesson, everything below the Interaction profile — can
 * never respond to a key, and swallowing scrolling for them would present to a learner as "the
 * studio is broken", affecting everyone rather than only the few using Interaction. The bug this
 * slice fixes is silent inaction; the regression it must not introduce is silent interception.
 *
 * `"tab"` is deliberately **not** in that list even for a responding press: it is how a learner
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
  "Use the Activate canvas button, or click the canvas, to trigger its on_click handlers.";

/** Whether `keyWord` is one whose browser default this module suppresses once it is delivered. */
export function suppressesBrowserDefault(keyWord: string): boolean {
  return SCROLLING_KEY_WORDS.includes(keyWord);
}

/**
 * Handle one `keydown` on the canvas: normalize it to an OpenLogo key word, deliver it, and
 * suppress the browser's own scrolling only if the program actually responded and the key is one
 * that would otherwise scroll.
 *
 * Reports the key word the program responded to, or `null` when it responded to nothing — a bare
 * modifier, a key no handler names, or a program with no `on_key` at all. Exported so the decision
 * is testable without a DOM.
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
 * default a *responded* press suppresses.
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
 * Show the activation control exactly while an activation could reach an `on_click` handler, and
 * hide it otherwise — so a program with no interaction adds no tab stop a learner cannot use. See
 * this module's doc comment.
 */
export function syncActivationControl(
  elements: CanvasInteractionElements,
  controller: RunController,
): void {
  elements.activationControl.hidden = !controller.acceptsClick();
}
