import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for the Educational profile's baseline meta-commands (issue #331):
 * `explain`/`why`/`hint`/`debug` recognized as bare-word, zero-input Commands
 * (`spec/commands.md`: "Meta-commands are commands taking no inputs, invoked as the bare words
 * explain, why, hint, and debug in the Educational profile"; `spec/conformance.md`'s Educational
 * signature table: each a Command, arity 0). Behavior is verified against the built
 * `@openlogo/parser` entry point per the shared black-box convention (co-located `*.test.mjs`
 * importing only `@openlogo/parser`).
 *
 * Scope note: this slice is parser-only (grammar/AST/reserved-words/highlighter). It proves
 * source → AST + `check()` diagnostics; it does not execute anything or emit `tutor-output` —
 * that is issue #332 (A2)'s runtime slice, layered on top of the `Call` nodes parsed here.
 */

const META_COMMANDS = ["explain", "why", "hint", "debug"];

const doc = "educational-meta-commands.logo";

function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, doc);
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return ast;
}

function checkSource(source, profiles) {
  const ast = parseClean(source);
  return OL.check(ast, { profiles }).diagnostics;
}

test("each meta-command parses as a bare zero-argument Call node — the same grammar production as home/pi/randomize, per the ast-design skill's one-node-per-production rule", () => {
  for (const name of META_COMMANDS) {
    const [call] = parseClean(name).body;
    assert.equal(call.kind, "Call", `expected a Call node for ${name}`);
    assert.equal(call.callee.name, name);
    assert.deepEqual(call.args, []);
  }
});

test("each meta-command's callee source_span covers just the bare word", () => {
  for (const name of META_COMMANDS) {
    const [call] = parseClean(name).body;
    assert.deepEqual(call.callee.source_span, {
      document: doc,
      start: [1, 1],
      end: [1, name.length + 1],
    });
  }
});

test("educationalPrimitiveArity reports arity 0 for each meta-command, case-insensitively, and undefined for anything else", () => {
  for (const name of META_COMMANDS) {
    assert.equal(OL.educationalPrimitiveArity(name), 0);
    assert.equal(OL.educationalPrimitiveArity(name.toUpperCase()), 0);
  }
  assert.equal(OL.educationalPrimitiveArity("forward"), undefined);
  assert.equal(OL.educationalPrimitiveArity("challenge"), undefined);
});

test("profile gating: with educational active, each meta-command is visible — never ol-unknown-command", () => {
  for (const name of META_COMMANDS) {
    assert.deepEqual(
      checkSource(name, ["core-language", "educational"]),
      [],
      `expected ${name} to be visible under the educational profile`,
    );
  }
});

test("profile gating: with educational NOT active, each meta-command is NOT recognized — ol-unknown-command fires", () => {
  for (const name of META_COMMANDS) {
    const diagnostics = checkSource(name, ["core-language"]);
    assert.equal(diagnostics.length, 1);
    const [finding] = diagnostics;
    assert.equal(finding.code, "ol-unknown-command");
    assert.equal(finding.stage, "semantic");
    assert.equal(finding.severity, "error");
    assert.equal(finding.params.name, name);
  }
});

test("profile gating: with no profiles active at all, each meta-command is still not recognized", () => {
  for (const name of META_COMMANDS) {
    const [finding] = checkSource(name, []);
    assert.equal(finding.code, "ol-unknown-command");
    assert.equal(finding.params.name, name);
  }
});

test("the parenthesized form is also visible under the educational profile (arity 0, so the paren form takes no arguments)", () => {
  for (const name of META_COMMANDS) {
    assert.deepEqual(
      checkSource(`(${name})`, ["core-language", "educational"]),
      [],
    );
  }
});

test("did-you-mean: a near-miss typo of a meta-command suggests it, but only when educational is active", () => {
  // "explian" is Levenshtein distance 2 from "explain".
  const withEducational = checkSource("explian", [
    "core-language",
    "educational",
  ]);
  assert.equal(withEducational.length, 1);
  assert.deepEqual(withEducational[0].params, {
    name: "explian",
    suggestion: "explain",
  });

  const withoutEducational = checkSource("explian", ["core-language"]);
  assert.equal(withoutEducational.length, 1);
  assert.deepEqual(withoutEducational[0].params, { name: "explian" });
});

test("did-you-mean tie-break: a Core word beats an Educational-profile word at the same edit distance", () => {
  // "wh" isn't close enough to trigger a real tie in practice; instead prove the tie-break logic
  // directly via a constructed near-tie: "hin" is distance 1 from "hint" (Educational) and the
  // reserved word "in" is also distance 1 — Core-language reserved words must win the tie.
  const [finding] = checkSource("hin", ["core-language", "educational"]);
  assert.equal(finding.code, "ol-unknown-command");
  assert.deepEqual(finding.params, { name: "hin", suggestion: "in" });
});

test("the meta-commands are never hardcoded into the Core-only or Turtle & Rendering visible sets", () => {
  for (const name of META_COMMANDS) {
    const diagnostics = checkSource(name, [
      "core-language",
      "turtle-rendering",
    ]);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "ol-unknown-command");
  }
});

test("each meta-command highlights as a `primitive` token, matching every other bare Command callee (no dedicated grammar production, so no dedicated token class)", () => {
  for (const name of META_COMMANDS) {
    const tokens = OL.highlight(name, doc).filter(
      (token) => token.class !== "comment",
    );
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].class, "primitive");
    assert.equal(tokens[0].text, name);
  }
});

test("each meta-command's semantic token carries the defaultLibrary modifier, exactly like any other primitive callee", () => {
  for (const name of META_COMMANDS) {
    const [token] = OL.semanticTokens(name, doc);
    assert.equal(token.class, "primitive");
    assert.deepEqual(token.modifiers, ["defaultLibrary"]);
  }
});
