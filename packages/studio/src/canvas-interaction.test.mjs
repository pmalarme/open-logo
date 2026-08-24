import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

/**
 * `canvas-interaction.ts` (#952) — the DOM half of input delivery, tested here rather than in
 * `web/main.ts` because `web/**` is neither type-checked nor linted and no test imports it.
 *
 * The two things this layer decides, and therefore the two things these tests pin: which DOM event
 * feeds which delivery (including `on_click`'s "equivalent accessible action",
 * `spec/interaction-events.md:214-215`), and when a key's browser default is suppressed.
 */

/** A DOM-free stand-in for a real element: records listeners so a test can fire them by name. */
function createFakeElement() {
  const registrations = [];
  return {
    addEventListener(type, listener) {
      registrations.push({ type, listener });
    },
    fire(type, event) {
      for (const registration of registrations) {
        if (registration.type === type) {
          registration.listener(event);
        }
      }
    },
    listenerCount(type) {
      return registrations.filter((registration) => registration.type === type)
        .length;
    },
  };
}

/** A recording stand-in for the run controller's two delivery methods. */
function createFakeController(accepted = true) {
  return {
    keys: [],
    clicks: 0,
    deliverKey(key) {
      this.keys.push(key);
      return accepted;
    },
    deliverClick() {
      this.clicks += 1;
      return accepted;
    },
  };
}

/** A `KeyboardEvent`-shaped event that records whether its default was suppressed. */
function createKeyEvent(key) {
  return {
    key,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

test("#952: a canvas keydown delivers the NORMALIZED key word, never the raw browser name", () => {
  const controller = createFakeController();
  const canvas = createFakeElement();
  const activationControl = createFakeElement();
  OL.mountCanvasInteraction({ canvas, activationControl }, controller);

  canvas.fire("keydown", createKeyEvent("ArrowLeft"));

  assert.deepEqual(
    controller.keys,
    ["left"],
    'a learner writes on_key "left", so "ArrowLeft" must never reach the program',
  );
});

test("#952: a bare modifier keydown delivers nothing", () => {
  const controller = createFakeController();
  const canvas = createFakeElement();
  const activationControl = createFakeElement();
  OL.mountCanvasInteraction({ canvas, activationControl }, controller);

  canvas.fire("keydown", createKeyEvent("Shift"));

  assert.deepEqual(controller.keys, []);
});

test("#952: both a canvas click and the accessible activation control deliver a click", () => {
  const controller = createFakeController();
  const canvas = createFakeElement();
  const activationControl = createFakeElement();
  OL.mountCanvasInteraction({ canvas, activationControl }, controller);

  canvas.fire("click");
  assert.equal(controller.clicks, 1, "the pointer path");

  activationControl.fire("click");
  assert.equal(
    controller.clicks,
    2,
    'spec/interaction-events.md:214-215 — "or activated by an equivalent accessible action"',
  );
});

test("#952: the accessible activation is a control of its own, not Enter/Space on the canvas — those stay key presses", () => {
  const controller = createFakeController();
  const canvas = createFakeElement();
  const activationControl = createFakeElement();
  OL.mountCanvasInteraction({ canvas, activationControl }, controller);

  canvas.fire("keydown", createKeyEvent(" "));
  canvas.fire("keydown", createKeyEvent("Enter"));

  assert.deepEqual(
    controller.keys,
    ["space", "enter"],
    'on_key "space" must receive a space press, not an activation',
  );
  assert.equal(controller.clicks, 0);
});

test("#952: a delivered scrolling key has its browser default suppressed, so playing does not scroll the studio away", () => {
  const controller = createFakeController(true);
  const canvas = createFakeElement();
  const activationControl = createFakeElement();
  OL.mountCanvasInteraction({ canvas, activationControl }, controller);

  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "]) {
    const event = createKeyEvent(key);
    canvas.fire("keydown", event);
    assert.equal(
      event.defaultPrevented,
      true,
      `${key} scrolls the page and was delivered, so its default must be suppressed`,
    );
  }
});

test("#952: Tab is never suppressed — a running game must not become a keyboard trap", () => {
  const controller = createFakeController(true);
  const canvas = createFakeElement();
  const activationControl = createFakeElement();
  OL.mountCanvasInteraction({ canvas, activationControl }, controller);

  const event = createKeyEvent("Tab");
  canvas.fire("keydown", event);

  assert.equal(controller.keys.at(-1), "tab", "the program still receives it");
  assert.equal(
    event.defaultPrevented,
    false,
    "Tab is how a learner leaves the canvas",
  );
  assert.equal(OL.suppressesBrowserDefault("tab"), false);
  assert.equal(OL.suppressesBrowserDefault("enter"), false);
  assert.equal(OL.suppressesBrowserDefault("escape"), false);
});

test("#952: a key the running program is not listening for keeps its ordinary browser behavior", () => {
  const controller = createFakeController(false);
  const canvas = createFakeElement();
  const activationControl = createFakeElement();
  OL.mountCanvasInteraction({ canvas, activationControl }, controller);

  const event = createKeyEvent("ArrowLeft");
  canvas.fire("keydown", event);

  assert.deepEqual(controller.keys, ["left"], "the delivery was attempted");
  assert.equal(
    event.defaultPrevented,
    false,
    "an undelivered arrow must still scroll the page as it always did",
  );
});

test("#952: handleCanvasKeyDown reports the delivered key word, or null when nothing was delivered", () => {
  const accepting = createFakeController(true);
  assert.equal(
    OL.handleCanvasKeyDown(accepting, createKeyEvent("ArrowUp")),
    "up",
  );

  const refusing = createFakeController(false);
  assert.equal(
    OL.handleCanvasKeyDown(refusing, createKeyEvent("ArrowUp")),
    null,
    "refused by the controller",
  );

  assert.equal(
    OL.handleCanvasKeyDown(accepting, createKeyEvent("Control")),
    null,
    "not a key press at all",
  );
});

test("#952: mounting attaches exactly the three listeners it documents", () => {
  const controller = createFakeController();
  const canvas = createFakeElement();
  const activationControl = createFakeElement();
  OL.mountCanvasInteraction({ canvas, activationControl }, controller);

  assert.equal(canvas.listenerCount("keydown"), 1);
  assert.equal(canvas.listenerCount("click"), 1);
  assert.equal(activationControl.listenerCount("click"), 1);
});

test("#952: SCROLLING_KEY_WORDS holds only words normalizeKeyWord can actually produce", () => {
  const producible = new Set(
    [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      " ",
      "PageUp",
      "PageDown",
      "Home",
      "End",
    ].map((key) => OL.normalizeKeyWord(key)),
  );
  for (const keyWord of OL.SCROLLING_KEY_WORDS) {
    assert.ok(
      producible.has(keyWord),
      `no browser key normalizes to "${keyWord}", so suppressing it could never happen`,
    );
  }
});
