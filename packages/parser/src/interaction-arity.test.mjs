import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for the Interaction & Events profile's reader arity registration — `wait <n>` (issue
 * #680, slice I1, `spec/interaction-events.md`'s `### wait <n>`). `wait` is an ordinary Kind-C
 * command taking one input, so the reader must group its single argument. Legality gating (whether
 * `wait` is callable under the program's active profile set) is a Layer-2 checker concern deferred
 * to the tooling slice #687 — the reader has no notion of an active profile
 * (`spec/tooling.md:175-176`), so it registers `wait`'s arity profile-blind, exactly like every
 * other profile's table. Behavior is verified against the built `@openlogo/parser` entry point per
 * the shared black-box test convention.
 */

function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, "interaction-arity.logo");
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return ast;
}

test("the reader groups wait's single argument into an infix Call node", () => {
  const [call] = parseClean("wait 2").body;
  assert.equal(call.kind, "Call");
  assert.equal(call.callee.name, "wait");
  assert.equal(call.args.length, 1);
});

test("interactionPrimitiveArity reports 1 for wait, case-insensitively, and undefined otherwise", () => {
  assert.equal(OL.interactionPrimitiveArity("wait"), 1);
  assert.equal(OL.interactionPrimitiveArity("WAIT"), 1);
  assert.equal(OL.interactionPrimitiveArity("forward"), undefined);
  assert.equal(OL.interactionPrimitiveArity("every"), undefined);
});

test("wait is registered in the shared reader table, so a bare `wait 2` parses without ol-bad-token", () => {
  // Regression guard for the whole reason this slice touches signatures.ts: without the arity
  // entry the reader treats `wait` as zero-arg and rejects the trailing `2` as a stray token.
  const { diagnostics } = OL.parse("wait 2", "interaction-arity.logo");
  assert.deepEqual(diagnostics, []);
});

test("the parenthesized (wait n) form parses at Layer 1 even with a non-1 argument count (arity is a Layer 2 concern)", () => {
  const [call] = parseClean("(wait 1 2)").body;
  assert.equal(call.kind, "ParenCall");
  assert.equal(call.callee.name, "wait");
  assert.equal(call.args.length, 2);
});
