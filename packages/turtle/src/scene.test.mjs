import assert from "node:assert/strict";
import { test } from "node:test";
import * as Core from "@openlogo/core";
import * as OL from "@openlogo/turtle";

function makeSpan() {
  return Core.makeSpan("main.logo", [1, 1], [1, 1]);
}

let seq = 0;
function event(kind, payload, turtleId = 0) {
  seq += 1;
  return {
    seq,
    kind,
    source_span: makeSpan(),
    turtle_id: turtleId,
    payload,
  };
}

test("initial turtle scene matches program-start defaults", () => {
  assert.deepEqual(OL.INITIAL_TURTLE_SCENE, { background: "white", items: [] });
});

test("draw-segment appends a segment capturing the color/width from its own payload", () => {
  const events = [
    event("draw-segment", {
      from: [0, 0],
      to: [0, 100],
      color: "black",
      width: 1,
    }),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.equal(scene.items.length, 1);
  assert.deepEqual(scene.items[0], {
    kind: "segment",
    segment: { from: [0, 0], to: [0, 100], color: "black", width: 1 },
  });
});

test("a later color-change/width-change does not retroactively alter an already-added segment", () => {
  const events = [
    event("draw-segment", {
      from: [0, 0],
      to: [0, 100],
      color: "black",
      width: 1,
    }),
    event("color-change", { from: "black", to: "red" }),
    event("width-change", { from: 1, to: 5 }),
    event("draw-segment", {
      from: [0, 100],
      to: [100, 100],
      color: "red",
      width: 5,
    }),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.equal(scene.items.length, 2);
  assert.deepEqual(scene.items[0].segment, {
    from: [0, 0],
    to: [0, 100],
    color: "black",
    width: 1,
  });
  assert.deepEqual(scene.items[1].segment, {
    from: [0, 100],
    to: [100, 100],
    color: "red",
    width: 5,
  });
});

test("background-change updates the scene-level background, not a segment", () => {
  const events = [
    event(
      "draw-segment",
      { from: [0, 0], to: [0, 50], color: "black", width: 1 },
      undefined,
    ),
    event("background-change", { color: "blue" }, undefined),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.equal(scene.background, "blue");
  assert.equal(scene.items.length, 1);
  assert.equal(scene.items[0].kind, "segment");
});

test("fill appends a fill item retaining its fill color", () => {
  const events = [event("fill", { color: "blue" })];
  const scene = OL.reduceSceneEvents(events);
  assert.deepEqual(scene.items, [{ kind: "fill", fill: { color: "blue" } }]);
});

test("stamp appends a stamp item with position, heading, shape, and color", () => {
  const events = [
    event("stamp", {
      position: [10, 20],
      heading: 90,
      shape: "arrow",
      color: "green",
    }),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.deepEqual(scene.items, [
    {
      kind: "stamp",
      stamp: {
        position: [10, 20],
        heading: 90,
        shape: "arrow",
        color: "green",
      },
    },
  ]);
});

test("clear with mode clean removes all segments/fills/stamps", () => {
  const events = [
    event("draw-segment", {
      from: [0, 0],
      to: [0, 50],
      color: "black",
      width: 1,
    }),
    event("fill", { color: "black" }),
    event("stamp", {
      position: [0, 50],
      heading: 0,
      shape: "turtle",
      color: "black",
    }),
    event("clear", { mode: "clean" }),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.deepEqual(scene.items, []);
});

test("clear with mode clear_screen removes drawing items identically to clean", () => {
  const events = [
    event("draw-segment", {
      from: [0, 0],
      to: [0, 50],
      color: "black",
      width: 1,
    }),
    event("fill", { color: "black" }),
    event("stamp", {
      position: [0, 50],
      heading: 0,
      shape: "turtle",
      color: "black",
    }),
    event("clear", { mode: "clear_screen" }),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.deepEqual(scene.items, []);
});

test("tutor-output (Educational profile) is inert: default branch returns the same scene reference unchanged", () => {
  const scene = OL.reduceSceneEvents([
    event("draw-segment", {
      from: [0, 0],
      to: [0, 50],
      color: "black",
      width: 1,
    }),
  ]);
  const next = OL.reduceTurtleScene(
    scene,
    event("tutor-output", {
      command: "explain",
      segments: ["`repeat` runs the block four times."],
    }),
  );
  assert.strictEqual(next, scene);
});

test("clear does not reset the background — clean and clear_screen preserve it", () => {
  const events = [
    event("background-change", { color: "yellow" }, undefined),
    event("draw-segment", {
      from: [0, 0],
      to: [0, 50],
      color: "black",
      width: 1,
    }),
    event("clear", { mode: "clear_screen" }),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.equal(scene.background, "yellow");
  assert.deepEqual(scene.items, []);
});

test("non-scene-bearing events (turtle state, print, instruction) leave the scene unchanged", () => {
  const events = [
    event("move", { from: [0, 0], to: [0, 100], heading: 0 }),
    event("turn", { from: 0, to: 90 }),
    event("pen-change", { from: "down", to: "up" }),
    event("color-change", { from: "black", to: "red" }),
    event("width-change", { from: 1, to: 3 }),
    event("shape-change", { from: "turtle", to: "arrow" }),
    event("visibility-change", { from: true, to: false }),
    event("print", { values: [] }, undefined),
    event("instruction", {}, undefined),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.deepEqual(scene, OL.INITIAL_TURTLE_SCENE);
});

test("reduceTurtleScene folds a single event onto an explicit starting scene", () => {
  const start = { background: "green", items: [] };
  const next = OL.reduceTurtleScene(start, event("fill", { color: "orange" }));
  assert.equal(next.background, "green");
  assert.deepEqual(next.items, [{ kind: "fill", fill: { color: "orange" } }]);
});

test("reduceSceneEvents accepts an explicit initial scene and folds in seq order", () => {
  const initial = {
    background: "white",
    items: [{ kind: "fill", fill: { color: "black" } }],
  };
  const events = [event("fill", { color: "red" })];
  const scene = OL.reduceSceneEvents(events, initial);
  assert.deepEqual(scene.items, [
    { kind: "fill", fill: { color: "black" } },
    { kind: "fill", fill: { color: "red" } },
  ]);
});

test("a full program's worth of events folds deterministically to the same final scene", () => {
  const program = [
    event("background-change", { color: "white" }, undefined),
    event("color-change", { from: "black", to: "blue" }),
    event("width-change", { from: 1, to: 2 }),
    event("turn", { from: 0, to: 90 }),
    event("move", { from: [0, 0], to: [100, 0], heading: 90 }),
    event("draw-segment", {
      from: [0, 0],
      to: [100, 0],
      color: "blue",
      width: 2,
    }),
    event("turn", { from: 90, to: 180 }),
    event("move", { from: [100, 0], to: [100, -100], heading: 180 }),
    event("draw-segment", {
      from: [100, 0],
      to: [100, -100],
      color: "blue",
      width: 2,
    }),
    event("fill", { color: "blue" }),
    event("stamp", {
      position: [100, -100],
      heading: 180,
      shape: "turtle",
      color: "blue",
    }),
  ];

  const first = OL.reduceSceneEvents(program);
  const second = OL.reduceSceneEvents(program);
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [100, 0], color: "blue", width: 2 },
      },
      {
        kind: "segment",
        segment: { from: [100, 0], to: [100, -100], color: "blue", width: 2 },
      },
      { kind: "fill", fill: { color: "blue" } },
      {
        kind: "stamp",
        stamp: {
          position: [100, -100],
          heading: 180,
          shape: "turtle",
          color: "blue",
        },
      },
    ],
  });
});

/**
 * `reduceSceneRange` is the batching form of a `reduceTurtleScene` loop (#977), so the loop is the
 * oracle: anything the range fold does differently is a defect, not an optimisation.
 */
function foldOneAtATime(events, initial = OL.INITIAL_TURTLE_SCENE) {
  let scene = initial;
  for (const event of events) {
    scene = OL.reduceTurtleScene(scene, event);
  }
  return scene;
}

test("reduceSceneRange equals folding the same events one at a time (#977)", () => {
  const events = [
    event("draw-segment", {
      from: [0, 0],
      to: [0, 10],
      color: "black",
      width: 1,
    }),
    event("turn", { from: 0, to: 90 }),
    event("background-change", { color: "navy" }),
    event("fill", { color: "gold" }),
    event("draw-segment", {
      from: [0, 10],
      to: [10, 10],
      color: "red",
      width: 3,
    }),
    event("stamp", {
      position: [10, 10],
      heading: 90,
      shape: "turtle",
      color: "red",
    }),
    event("print", { text: "hello" }),
  ];
  assert.deepEqual(
    OL.reduceSceneRange(OL.INITIAL_TURTLE_SCENE, events, 0, events.length),
    foldOneAtATime(events),
  );
});

test("reduceSceneRange matches the one-at-a-time fold across a `clear` in mid-range", () => {
  const events = [
    event("draw-segment", {
      from: [0, 0],
      to: [0, 5],
      color: "black",
      width: 1,
    }),
    event("background-change", { color: "navy" }),
    event("clear", { mode: "clean" }),
    event("draw-segment", {
      from: [0, 0],
      to: [5, 0],
      color: "blue",
      width: 2,
    }),
  ];
  const range = OL.reduceSceneRange(
    OL.INITIAL_TURTLE_SCENE,
    events,
    0,
    events.length,
  );
  assert.deepEqual(range, foldOneAtATime(events));
  // `clear` drops the items drawn before it but keeps the background set before it.
  assert.equal(range.items.length, 1);
  assert.equal(range.background, "navy");
});

test("reduceSceneRange agrees with the one-at-a-time fold on EVERY sub-range", () => {
  const events = [
    event("draw-segment", {
      from: [0, 0],
      to: [0, 1],
      color: "black",
      width: 1,
    }),
    event("instruction", { text: "right 90" }),
    event("background-change", { color: "navy" }),
    event("clear", { mode: "clear_screen" }),
    event("fill", { color: "gold" }),
    event("stamp", {
      position: [1, 1],
      heading: 0,
      shape: "turtle",
      color: "red",
    }),
  ];
  for (let start = 0; start <= events.length; start += 1) {
    for (let end = start; end <= events.length; end += 1) {
      assert.deepEqual(
        OL.reduceSceneRange(OL.INITIAL_TURTLE_SCENE, events, start, end),
        foldOneAtATime(events.slice(start, end)),
        `sub-range [${start}, ${end})`,
      );
    }
  }
});

test("reduceSceneRange returns the SAME scene reference when the range bears no scene events", () => {
  const scene = OL.reduceSceneEvents([
    event("draw-segment", {
      from: [0, 0],
      to: [1, 1],
      color: "black",
      width: 1,
    }),
  ]);
  const inert = [
    event("instruction", { text: "right 90" }),
    event("turn", { from: 0, to: 90 }),
    event("print", { text: "hi" }),
  ];
  assert.equal(OL.reduceSceneRange(scene, inert, 0, inert.length), scene);
});

test("reduceSceneRange returns the SAME scene reference for an empty or inverted range", () => {
  const scene = OL.reduceSceneEvents([
    event("draw-segment", {
      from: [0, 0],
      to: [1, 1],
      color: "black",
      width: 1,
    }),
  ]);
  const events = [event("fill", { color: "gold" })];
  assert.equal(OL.reduceSceneRange(scene, events, 0, 0), scene);
  assert.equal(OL.reduceSceneRange(scene, events, 1, 0), scene);
});

test("reduceSceneRange clamps both bounds to the event array", () => {
  const events = [
    event("fill", { color: "gold" }),
    event("fill", { color: "teal" }),
  ];
  const clamped = OL.reduceSceneRange(
    OL.INITIAL_TURTLE_SCENE,
    events,
    -5,
    events.length + 5,
  );
  assert.deepEqual(clamped, foldOneAtATime(events));
  assert.equal(clamped.items.length, 2);
});

test("reduceSceneRange clamps a NEGATIVE start that Array.slice would read from the end", () => {
  // `-5` on a 2-element array is the one value that does NOT distinguish clamping from `slice`'s
  // own semantics, because it underflows past `-length` and slice clamps it to 0 anyway. `-1` on a
  // 3-element array does distinguish them: unclamped, `slice(-1, 3)` yields only the LAST element.
  const events = [
    event("fill", { color: "gold" }),
    event("fill", { color: "teal" }),
    event("fill", { color: "plum" }),
  ];
  const clamped = OL.reduceSceneRange(
    OL.INITIAL_TURTLE_SCENE,
    events,
    -1,
    events.length,
  );
  assert.equal(
    clamped.items.length,
    3,
    "a negative start means 'from the beginning'",
  );
  assert.deepEqual(clamped, foldOneAtATime(events));
});

test("reduceSceneRange clamps a NEGATIVE end instead of folding all-but-the-last (#977)", () => {
  // `Array.prototype.slice` reads a negative end as an offset from the array end, so an unclamped
  // `end` of -1 would fold every event but the last where the contract promises none at all.
  const events = [
    event("fill", { color: "gold" }),
    event("fill", { color: "teal" }),
    event("fill", { color: "plum" }),
  ];
  const scene = OL.INITIAL_TURTLE_SCENE;
  for (const end of [-1, -3, -99]) {
    assert.equal(
      OL.reduceSceneRange(scene, events, 0, end),
      scene,
      `end=${end} must fold nothing and return the same scene reference`,
    );
  }
  // And a negative end paired with a negative start is still empty, not "the middle".
  assert.equal(OL.reduceSceneRange(scene, events, -5, -2), scene);
});

test("reduceSceneRange never writes through the scene it was given (#977 shared-array hazard)", () => {
  const base = OL.reduceSceneEvents([
    event("draw-segment", {
      from: [0, 0],
      to: [1, 1],
      color: "black",
      width: 1,
    }),
  ]);
  const baseItemsBefore = [...base.items];
  const appended = OL.reduceSceneRange(
    base,
    [
      event("fill", { color: "gold" }),
      event("stamp", {
        position: [0, 0],
        heading: 0,
        shape: "turtle",
        color: "red",
      }),
    ],
    0,
    2,
  );
  assert.equal(
    base.items.length,
    1,
    "the input scene still has its own item count",
  );
  assert.deepEqual([...base.items], baseItemsBefore);
  assert.equal(appended.items.length, 3);
  assert.notEqual(
    appended.items,
    base.items,
    "the result owns a different array",
  );
});

/**
 * ## The copy counter — and exactly what it does and does not cover
 *
 * Counts array elements copied while `run()` executes, by wrapping the array iterator
 * (`[...spread]`, `for…of`), `slice` and `concat`. Deterministic and clock-free, so it asserts a
 * *growth* property without the flakiness a timing ratio would bring to a shared CI runner.
 *
 * ### Why it is shaped this way — two instruments were rejected before it
 * The first attempt asserted only the final *result* and claimed in its comment that a regression
 * would surface "as a timeout". There is no timeout (`node --test` defaults to none), so restoring
 * the exact Θ(n²) defect left the whole suite green, 78× slower.
 *
 * The second attempt instrumented **only** the iterator and was paired with a positive control —
 * but the control was written with spread, the one mechanism it detects, so it proved only that the
 * instrument detects the control. A quadratic fold spelled `fold.items.slice()` reported *the same
 * number as the pristine build* and sailed through. **A control drawn from the same mechanism as
 * the instrument is circular, and circularity is invisible from a green result.** Hence the
 * per-mechanism controls below.
 *
 * ### What it is NOT — read this before trusting it
 * This instrument **does not verify linearity**. It counts copying done through three mechanisms —
 * the array iterator, `slice`, and `concat` — and nothing else. Quadratic folds it cannot see
 * include `toSpliced`, `filter`, `flat`, `with`, `structuredClone`, `Object.values` and `map` (all
 * ordinary bulk-copy builtins, all genuinely quadratic here — a `toSpliced` mutant survives the
 * whole suite), a hand-rolled `for (i) out[i] = a[i]`, a module-level alias captured before this
 * patch runs (`const copy = Array.prototype.slice`), and a per-object iterator override
 * (`Object.defineProperty(items, Symbol.iterator, { value: Array.prototype.values })`, which
 * bypasses the prototype patch a spread would otherwise go through). Some of those a longer
 * whitelist could cover; the last three none could.
 *
 * **What it does guard** is a regression that reintroduces the copy through the spellings #977's
 * defect actually used and their nearest neighbours. That is worth having — it is what kills the
 * historical defect — but it is a guard on *those mechanisms*, not a proof about growth, and no
 * comment, test name or README sentence in this change should say otherwise.
 *
 * `Array.from` is deliberately **not** wrapped: over an array it reads its source through the array
 * iterator, which is wrapped already, so a wrapper would double-count and a control for it would
 * pass with that wrapper removed — the circularity that failed review once already. It is covered
 * by the iterator, and no separate control claims otherwise.
 */
function countCopiedElements(run) {
  const original = {
    iterator: Array.prototype[Symbol.iterator],
    slice: Array.prototype.slice,
    concat: Array.prototype.concat,
  };
  let copied = 0;
  Array.prototype[Symbol.iterator] = function countingIterator() {
    const inner = original.iterator.call(this);
    return {
      next() {
        const result = inner.next();
        if (result.done !== true) {
          copied += 1;
        }
        return result;
      },
      // Iterator objects must themselves be iterable; without this a caller doing
      // `[...arr[Symbol.iterator]()]` would throw only while instrumented.
      [Symbol.iterator]() {
        return this;
      },
    };
  };
  Array.prototype.slice = function countingSlice(...args) {
    const result = original.slice.apply(this, args);
    copied += result.length;
    return result;
  };
  Array.prototype.concat = function countingConcat(...args) {
    const result = original.concat.apply(this, args);
    copied += result.length;
    return result;
  };
  try {
    run();
  } finally {
    Array.prototype[Symbol.iterator] = original.iterator;
    Array.prototype.slice = original.slice;
    Array.prototype.concat = original.concat;
  }
  return copied;
}

function segmentEvents(count) {
  const events = [];
  for (let index = 0; index < count; index += 1) {
    events.push(
      event("draw-segment", {
        from: [index, 0],
        to: [index + 1, 0],
        color: "black",
        width: 1,
      }),
    );
  }
  return events;
}

/**
 * The same segments, but instruction-aligned so the stream has real step boundaries — `segmentEvents`
 * has none, so a single `step()` consumes all of it and no sub-range fold can be observed.
 */
function steppedSegmentEvents(count) {
  const events = [];
  for (let index = 0; index < count; index += 1) {
    events.push(event("instruction", { text: "forward 1" }));
    events.push(
      event("draw-segment", {
        from: [index, 0],
        to: [index + 1, 0],
        color: "black",
        width: 1,
      }),
    );
  }
  return events;
}

/** Every bulk-copy spelling this instrument actually wraps. `Array.from` is deliberately absent:
 * over an array it reads through the iterator, so a control for it would pass with an `Array.from`
 * wrapper removed — it would prove the iterator is instrumented, not `Array.from`. */
const QUADRATIC_SPELLINGS = [
  ["spread", (items, item) => [...items, item]],
  [
    "slice",
    (items, item) => {
      const copy = items.slice();
      copy.push(item);
      return copy;
    },
  ],
  ["concat", (items, item) => items.concat([item])],
];

for (const [spelling, append] of QUADRATIC_SPELLINGS) {
  test(`the copy counter detects a quadratic fold spelled with ${spelling} (#977 coverage control)`, () => {
    // One control PER MECHANISM, for the three mechanisms wrapped. An aggregate control is what
    // failed review twice: it proves the counter can fire, not that it covers the ways the property
    // can be violated. Each of these fails if its own wrapper is removed — that is what makes it a
    // genuine per-mechanism control rather than a restatement of the iterator's.
    const count = 500;
    const items = segmentEvents(count);
    const copied = countCopiedElements(() => {
      let accumulated = [];
      for (const item of items) {
        accumulated = append(accumulated, item);
      }
      return accumulated;
    });
    assert.ok(
      copied > count * 20,
      `${spelling}: a quadratic fold of ${count} items should copy ~${(count * (count - 1)) / 2} elements, got ${copied}`,
    );
  });
}

test("a quadratic fold spelled with an UNWRAPPED builtin is invisible — the declared gap (#977)", () => {
  // Pins two of the declared blind spots so the declaration above cannot quietly become false in
  // either direction. `toSpliced` is an ordinary bulk-copy builtin; the second case overrides one
  // array's own `Symbol.iterator`, bypassing the prototype patch a spread goes through. Both folds
  // are genuinely Θ(n²) and both must read as linear here. If either ever fails, the counter got
  // wider and the documented coverage must be widened with it.
  const count = 500;
  const items = segmentEvents(count);

  const viaToSpliced = countCopiedElements(() => {
    let accumulated = [];
    for (const item of items) {
      accumulated = accumulated.toSpliced(accumulated.length, 0, item);
    }
    return accumulated;
  });
  assert.ok(
    viaToSpliced <= count * 4,
    `toSpliced is expected to be INVISIBLE to this counter; it reported ${viaToSpliced}. If this now fails, widen the documented coverage.`,
  );

  const viaIteratorOverride = countCopiedElements(() => {
    let accumulated = [];
    for (const item of items) {
      Object.defineProperty(accumulated, Symbol.iterator, {
        value: Array.prototype.values,
        configurable: true,
      });
      accumulated = [...accumulated, item];
    }
    return accumulated;
  });
  assert.ok(
    viaIteratorOverride <= count * 4,
    `a per-object iterator override is expected to be INVISIBLE; it reported ${viaIteratorOverride}. If this now fails, widen the documented coverage.`,
  );
});

test("the counting iterator stays iterable while instrumented (#977)", () => {
  // Covers the instrument's own `[Symbol.iterator]`, and pins that patching does not break a
  // caller that iterates an iterator directly.
  let observed = null;
  const copied = countCopiedElements(() => {
    observed = [...[1, 2, 3][Symbol.iterator]()];
  });
  assert.deepEqual(observed, [1, 2, 3]);
  assert.ok(copied >= 3);
});

test("countCopiedElements restores every builtin it patches, even when run() throws", () => {
  const before = {
    iterator: Array.prototype[Symbol.iterator],
    slice: Array.prototype.slice,
    concat: Array.prototype.concat,
  };
  assert.throws(() => {
    countCopiedElements(() => {
      throw new Error("boom");
    });
  }, /boom/);
  assert.equal(Array.prototype[Symbol.iterator], before.iterator);
  assert.equal(Array.prototype.slice, before.slice);
  assert.equal(Array.prototype.concat, before.concat);
});

test("reduceSceneEvents does not copy through the wrapped mechanisms per event (#977)", () => {
  const count = 2_000;
  const copied = countCopiedElements(() =>
    OL.reduceSceneEvents(segmentEvents(count)),
  );
  // The pre-#977 fold copied the accumulated array on every append — count*(count-1)/2 = 1 999 000
  // elements on top of the single pass — two orders of magnitude above this ceiling.
  assert.ok(
    copied <= count * 8,
    `expected <= ${count * 8} elements copied for ${count} events, got ${copied}`,
  );
});

test("reduceSceneEvents' wrapped-mechanism copying grows ~2x per doubling, not ~4x (#977)", () => {
  // Stronger than a ceiling at one size, which a third legitimate linear pass would trip: doubling
  // the input must not more than roughly double the copying. A quadratic fold quadruples it.
  const small = countCopiedElements(() =>
    OL.reduceSceneEvents(segmentEvents(1_000)),
  );
  const large = countCopiedElements(() =>
    OL.reduceSceneEvents(segmentEvents(2_000)),
  );
  const ratio = large / small;
  assert.ok(
    ratio <= 2.5,
    `doubling n multiplied copying by ${ratio.toFixed(2)}x; linear is ~2x, quadratic ~4x`,
  );
});

test("seekToEventIndex does not copy through the wrapped mechanisms per event (#977)", () => {
  // Guards the studio's resume claim against the historical defect's spellings — see the counter's
  // doc block for what that does and does not cover. The claim itself is a growth claim; this is a
  // mechanism guard, and the two are not the same thing. Lives beside the counter rather than in
  // `animation.test.mjs` so there is exactly one copy of the instrument to keep correct.
  //
  // The ceiling is tight, not generous: a seek measures exactly 3n — `applyRange`'s ONE slice of
  // the window plus two linear passes over it (world/overlay, then the scene). That 3n is the
  // measurement behind `animation.ts`'s "sliced once and shared" comment, so pinning it here is
  // what stops that comment silently becoming false again: routing the raw event array into
  // `reduceSceneRange` instead of the window restores the two-transient shape at 4n and fails here.
  const events = segmentEvents(2_000);
  const copied = countCopiedElements(() => {
    const controller = new OL.TurtleAnimationController(events);
    controller.seekToEventIndex(events.length);
  });
  assert.ok(
    copied <= events.length * 3.5,
    `expected <= ${events.length * 3.5} elements copied for ${events.length} events (one slice + two passes = 3n), got ${copied}`,
  );
});

test("seekToEventIndex's wrapped-mechanism copying grows ~2x per doubling, not ~4x (#977)", () => {
  // The ceiling above fixes the constant; this fixes the shape. Both are needed: a ceiling alone
  // passes a quadratic implementation at a small enough n, and a ratio alone passes an
  // implementation that is linear but wasteful.
  const measure = (count) =>
    countCopiedElements(() => {
      const controller = new OL.TurtleAnimationController(segmentEvents(count));
      controller.seekToEventIndex(count);
    });
  const ratio = measure(2_000) / measure(1_000);
  assert.ok(
    ratio <= 2.5,
    `doubling n multiplied copying by ${ratio.toFixed(2)}x; linear is ~2x, quadratic ~4x`,
  );
});

test("a whole-array range is folded in place, without copying the stream (#977)", () => {
  // Pins BOTH the in-place branch and the upper clamp as load-bearing. Measured: folding in place
  // costs 1.00n (the `for…of` alone); slicing first costs 2.00n. The 1.5n ceiling sits between
  // them, so removing the fast path — or the `Math.min` that lets an `end` past the array still
  // reach it — fails here rather than passing as a wash.
  const events = segmentEvents(1_000);
  const exact = countCopiedElements(() =>
    OL.reduceSceneRange(OL.INITIAL_TURTLE_SCENE, events, 0, events.length),
  );
  const past = countCopiedElements(() =>
    OL.reduceSceneRange(OL.INITIAL_TURTLE_SCENE, events, 0, events.length + 5),
  );
  assert.equal(
    past,
    exact,
    "an end past the array must fold in place, exactly as an exact end does",
  );
  assert.ok(
    exact <= events.length * 1.5,
    `a whole-array fold must not copy the stream: got ${exact} for ${events.length} events (in-place is ~1n, slicing ~2n)`,
  );
  // A genuine sub-range still slices, so the fast path is a real branch rather than the only one.
  const partial = countCopiedElements(() =>
    OL.reduceSceneRange(OL.INITIAL_TURTLE_SCENE, events, 1, events.length),
  );
  assert.ok(
    partial > exact,
    "a partial range takes the slicing branch, so both branches are exercised",
  );
});

test("a PARTIAL seek does not re-slice the raw event array (#977 — one transient, not two)", () => {
  // The full-stream seek above cannot pin `animation.ts`'s "sliced once and shared" comment:
  // passing the raw event array into `reduceSceneRange` instead of the window is EQUIVALENT for a
  // whole-array range, because the in-place fast path applies to both. It diverges only on a
  // partial range, which is exactly what a resume does — so the mutation survived until this test.
  //
  // Pristine: one slice of the window + two linear passes over it = 3 counts per event.
  // Two-transient shape: that, plus a second slice of the raw array = 4 counts per event.
  const events = steppedSegmentEvents(1_000);
  const copied = countCopiedElements(() => {
    const controller = new OL.TurtleAnimationController(events);
    controller.step(); // advance the cursor so the following fold is a genuine sub-range
    controller.seekToEnd();
  });
  assert.ok(
    copied <= events.length * 3.5,
    `expected <= ${events.length * 3.5} elements copied for ${events.length} events (one slice + two passes = 3n; a second slice makes it 4n), got ${copied}`,
  );
});

test("reduceSceneEvents folds a long stream to the right result (#977)", () => {
  const events = segmentEvents(20_000);
  const scene = OL.reduceSceneEvents(events);
  assert.equal(scene.items.length, 20_000);
  assert.deepEqual(scene.items[0].segment.from, [0, 0]);
  assert.deepEqual(scene.items[19_999].segment.to, [20_000, 0]);
});
