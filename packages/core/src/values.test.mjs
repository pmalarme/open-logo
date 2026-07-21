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
