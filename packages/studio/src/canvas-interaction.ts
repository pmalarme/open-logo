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
 * suppressed for exactly {@link SCROLLING_KEY_WORDS} — and only when the press was actually
 * **delivered to a running program**, which is what {@link RunController.deliverKey} reports back.
 * A key the program is not listening for keeps its ordinary browser behavior.
 *
 * `"tab"` is deliberately **not** in that list: it is how a learner leaves the canvas, and a game
 * that could swallow it would be a keyboard trap. `"enter"` and `"escape"` are left alone for the
 * same reason — they operate the surrounding UI.
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
 * suppress the browser's own scrolling only if it was both delivered and a scrolling key.
 *
 * Reports the key word that was delivered, or `null` when nothing was — a bare modifier, or a key
 * the running program is not listening for. Exported so the decision is testable without a DOM.
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
 * `deliverKey`, canvas `click` and the activation control → `deliverClick`.
 *
 * The controller decides whether any of it reaches the program — a delivery to a program that
 * registered no such handler runs nothing at all (see `run-controller.ts`'s doc comment, "#952").
 * This function makes no decision beyond which DOM event feeds which delivery.
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
  });
  elements.activationControl.addEventListener("click", () => {
    controller.deliverClick();
  });
}
