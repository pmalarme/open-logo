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
 * Counts array elements copied while `run()` executes, by wrapping every *bulk-copy* mechanism the
 * fold could plausibly use: the array iterator (`[...spread]`, `for…of`), `slice`, `concat`, and
 * `Array.from`. Deterministic and clock-free, so it asserts a *growth* property without the
 * flakiness a timing ratio would bring to a shared CI runner.
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
 * per-mechanism controls below: coverage is demonstrated mechanism by mechanism, never in aggregate.
 *
 * ### Declared blind spot — do not read this as complete
 * A hand-rolled copy (`for (i) out[i] = a[i]`, or `map`) touches no bulk-copy builtin and is
 * invisible here. That cannot be closed by a whitelist, so it is stated rather than implied: this
 * instrument catches a regression that *reintroduces bulk copying per event*, which is the shape
 * #977 actually had, and it does not prove linearity in general.
 */
function countCopiedElements(run) {
  const original = {
    iterator: Array.prototype[Symbol.iterator],
    slice: Array.prototype.slice,
    concat: Array.prototype.concat,
    from: Array.from,
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
  Array.from = function countingFrom(...args) {
    const result = original.from.apply(Array, args);
    copied += result.length;
    return result;
  };
  try {
    run();
  } finally {
    Array.prototype[Symbol.iterator] = original.iterator;
    Array.prototype.slice = original.slice;
    Array.prototype.concat = original.concat;
    Array.from = original.from;
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

/** Every bulk-copy spelling a quadratic fold could realistically use. */
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
  [
    "Array.from",
    (items, item) => {
      const copy = Array.from(items);
      copy.push(item);
      return copy;
    },
  ],
];

for (const [spelling, append] of QUADRATIC_SPELLINGS) {
  test(`the copy counter detects a quadratic fold spelled with ${spelling} (#977 coverage control)`, () => {
    // One control PER MECHANISM. An aggregate control is what failed review: it proved the counter
    // could fire, not that it covered the ways the property can be violated.
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
    from: Array.from,
  };
  assert.throws(() => {
    countCopiedElements(() => {
      throw new Error("boom");
    });
  }, /boom/);
  assert.equal(Array.prototype[Symbol.iterator], before.iterator);
  assert.equal(Array.prototype.slice, before.slice);
  assert.equal(Array.prototype.concat, before.concat);
  assert.equal(Array.from, before.from);
});

test("reduceSceneEvents copies a LINEAR number of elements, not a quadratic one (#977)", () => {
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

test("reduceSceneEvents copying grows LINEARLY with n, not quadratically (#977)", () => {
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

test("seekToEventIndex copies a LINEAR number of elements over the resume prefix (#977)", () => {
  // This is what makes the studio's resume claim enforceable rather than merely written down:
  // `packages/studio/README.md` and `run-controller.ts` both state that the scene fold over a
  // resumed prefix is linear in how much has been drawn. Lives beside the counter rather than in
  // `animation.test.mjs` so there is exactly one copy of the instrument to keep correct.
  const events = segmentEvents(2_000);
  const copied = countCopiedElements(() => {
    const controller = new OL.TurtleAnimationController(events);
    controller.seekToEventIndex(events.length);
  });
  assert.ok(
    copied <= events.length * 8,
    `expected <= ${events.length * 8} elements copied for ${events.length} events, got ${copied}`,
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

test("reduceSceneEvents folds a long stream to the right result (#977)", () => {
  const events = segmentEvents(20_000);
  const scene = OL.reduceSceneEvents(events);
  assert.equal(scene.items.length, 20_000);
  assert.deepEqual(scene.items[0].segment.from, [0, 0]);
  assert.deepEqual(scene.items[19_999].segment.to, [20_000, 0]);
});
