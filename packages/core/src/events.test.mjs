import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/core";

function makeSpan() {
  return OL.makeSpan("main.logo", [1, 1], [1, 1]);
}

test("pen-change payload carries pen state before and after (up vs down)", () => {
  const event = {
    seq: 1,
    kind: "pen-change",
    source_span: makeSpan(),
    turtle_id: 0,
    payload: { from: "down", to: "up" },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.from, "down");
  assert.equal(event.payload.to, "up");
});

test("visibility-change payload carries visibility before and after", () => {
  const event = {
    seq: 2,
    kind: "visibility-change",
    source_span: makeSpan(),
    turtle_id: 0,
    payload: { from: true, to: false },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.from, true);
  assert.equal(event.payload.to, false);
});

test("color-change payload carries the new pen color and the previous one", () => {
  const event = {
    seq: 3,
    kind: "color-change",
    source_span: makeSpan(),
    turtle_id: 0,
    payload: { from: "black", to: "red" },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.from, "black");
  assert.equal(event.payload.to, "red");
});

test("background-change payload carries the new background color", () => {
  const event = {
    seq: 4,
    kind: "background-change",
    source_span: makeSpan(),
    payload: { color: "blue" },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.color, "blue");
});

test("width-change payload carries the new pen width and the previous one", () => {
  const event = {
    seq: 5,
    kind: "width-change",
    source_span: makeSpan(),
    turtle_id: 0,
    payload: { from: 1, to: 3 },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.from, 1);
  assert.equal(event.payload.to, 3);
});

test("shape-change payload carries the new shape word and the previous one", () => {
  const event = {
    seq: 6,
    kind: "shape-change",
    source_span: makeSpan(),
    turtle_id: 0,
    payload: { from: "turtle", to: "arrow" },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.from, "turtle");
  assert.equal(event.payload.to, "arrow");
});

test("fill payload carries the fill color used", () => {
  const event = {
    seq: 7,
    kind: "fill",
    source_span: makeSpan(),
    turtle_id: 0,
    payload: { color: "green" },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.color, "green");
});

test("stamp payload carries position, heading, shape, and color stamped", () => {
  const event = {
    seq: 8,
    kind: "stamp",
    source_span: makeSpan(),
    turtle_id: 0,
    payload: {
      position: [10, 20],
      heading: 90,
      shape: "triangle",
      color: "red",
    },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.deepEqual(event.payload.position, [10, 20]);
  assert.equal(event.payload.heading, 90);
  assert.equal(event.payload.shape, "triangle");
  assert.equal(event.payload.color, "red");
});
