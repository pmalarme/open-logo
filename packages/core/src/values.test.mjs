import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/core";

test("typeNameOf reports the Core concept name for each runtime value shape", () => {
  assert.equal(OL.typeNameOf(42), "number");
  assert.equal(OL.typeNameOf(-3.5), "number");
  assert.equal(OL.typeNameOf("red"), "word");
  assert.equal(OL.typeNameOf(""), "word");
  assert.equal(OL.typeNameOf(true), "boolean");
  assert.equal(OL.typeNameOf(false), "boolean");
  assert.equal(OL.typeNameOf([]), "list");
  assert.equal(OL.typeNameOf([1, "a", true]), "list");
  assert.equal(OL.typeNameOf(new OL.OLDict()), "dict");
  assert.equal(
    OL.typeNameOf(new OL.OLRecord("point", ["x", "y"], [3, 4])),
    "record",
  );
});

test("OLRecord binds its declared fields in order and exposes them via has/get/fields", () => {
  const record = new OL.OLRecord("point", ["x", "y"], [3, 4]);
  assert.equal(record.type, "point");
  assert.deepEqual(record.fields(), ["x", "y"]);
  assert.equal(record.has("x"), true);
  assert.equal(record.has("z"), false);
  assert.equal(record.get("x"), 3);
  assert.equal(record.get("y"), 4);
  assert.equal(record.get("z"), undefined);
});

test("OLRecord.set overwrites a declared field's value in place", () => {
  const record = new OL.OLRecord("point", ["x", "y"], [3, 4]);
  record.set("x", 10);
  assert.equal(record.get("x"), 10);
  assert.deepEqual(record.fields(), ["x", "y"]);
});

test("OLRecord folds field case on has/get/set but keeps the declared spelling (spec/grammar.md:13)", () => {
  const record = new OL.OLRecord("Point", ["X", "Y"], [3, 4]);
  // fields() and the type keep their declared spelling for display.
  assert.equal(record.type, "Point");
  assert.deepEqual(record.fields(), ["X", "Y"]);
  // Access is case-insensitive: every casing of a declared field addresses one slot.
  assert.equal(record.has("x"), true);
  assert.equal(record.has("X"), true);
  assert.equal(record.get("x"), 3);
  assert.equal(record.get("Y"), 4);
  // A write through one casing is observed through every other casing (one slot).
  record.set("x", 30);
  assert.equal(record.get("X"), 30);
  // An undeclared field stays unknown regardless of case.
  assert.equal(record.has("z"), false);
  assert.equal(record.get("Z"), undefined);
});

test("OLRecord collapses case-only duplicate fields to one field, keeping fields() 1:1 with its slots (spec/grammar.md:13)", () => {
  // `x` and `X` fold to the same identifier, so this declares ONE field, not two — the record
  // must not expose a phantom declared position that no slot backs (no split-brain).
  const record = new OL.OLRecord("point", ["x", "X"], [1, 2]);
  assert.deepEqual(record.fields(), ["x"]);
  // The last value written for the folded key wins, and every casing observes that one slot.
  assert.equal(record.get("x"), 2);
  assert.equal(record.get("X"), 2);
  assert.equal(record.has("x"), true);
  assert.equal(record.has("X"), true);
});

test("OLDict.set upserts by canonical key and preserves first-insertion order", () => {
  const dict = new OL.OLDict();
  dict.set("tom", 8);
  dict.set("sophie", 6);
  dict.set("tom", 9);
  assert.deepEqual(dict.keys(), ["tom", "sophie"]);
  assert.deepEqual(dict.values(), [9, 6]);
  assert.equal(dict.size, 2);
});

test("OLDict collapses number and word keys under printed-form equality", () => {
  const dict = new OL.OLDict();
  dict.set(5, "five");
  assert.equal(dict.has("5"), true);
  assert.equal(dict.get("5"), "five");
  dict.set("5", "cinco");
  assert.deepEqual(dict.keys(), [5]);
  assert.equal(dict.get(5), "cinco");
  assert.equal(dict.has("05"), false);
});

test("OLDict.has/get/delete gracefully reject non-word/non-number candidate keys", () => {
  const dict = new OL.OLDict();
  dict.set("tom", 8);
  assert.equal(dict.has(true), false);
  assert.equal(dict.get([1, 2]), undefined);
  assert.equal(dict.delete(false), false);
});

test("OLDict.delete removes an entry and reports success; clear empties the dict", () => {
  const dict = new OL.OLDict();
  dict.set("tom", 8);
  dict.set("sophie", 6);
  assert.equal(dict.delete("tom"), true);
  assert.equal(dict.delete("tom"), false);
  assert.deepEqual(dict.keys(), ["sophie"]);
  dict.clear();
  assert.equal(dict.size, 0);
  assert.deepEqual(dict.keys(), []);
});
