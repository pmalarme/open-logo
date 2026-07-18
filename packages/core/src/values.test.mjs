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
});
