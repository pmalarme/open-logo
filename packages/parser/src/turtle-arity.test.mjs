import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for the Turtle & Rendering primitive arities the reader needs to group a bare call's
 * arguments (issue #193). Before this slice, `corePrimitiveArity('forward')` was unregistered, so
 * the reader defaulted `forward` to arity 0 and could not gather `100` as its argument, leaving it
 * as a stray token (a Layer-1 `ol-bad-token`). These tests assert the Core-spelled turtle
 * primitives from `spec/commands.md`'s Turtle & Rendering matrix now parse cleanly as `Call` nodes
 * grouping the correct number of arguments — regardless of the active profile set, since the
 * reader has no profile concept; profile legality is `check()`'s job (`arity.test.mjs`,
 * `unknown-command.test.mjs`). Behavior is verified against the built `@openlogo/parser` entry
 * point per the shared black-box test convention.
 */

function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, "turtle-arity.logo");
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return ast;
}

test("forward gathers exactly one numeric argument (spec/commands.md worked example)", () => {
  const [call] = parseClean("forward 100").body;
  assert.equal(call.kind, "Call");
  assert.equal(call.callee.name, "forward");
  assert.equal(call.args.length, 1);
  assert.equal(call.args[0].kind, "NumberLit");
  assert.equal(call.args[0].value, 100);
});

test("every fixed-arity-1 turtle command gathers its one argument", () => {
  for (const name of ["forward", "back", "left", "right", "set_heading"]) {
    const [call] = parseClean(`${name} 45`).body;
    assert.equal(call.kind, "Call");
    assert.equal(call.callee.name, name);
    assert.equal(call.args.length, 1);
  }
});

test("set_xy, towards, and distance gather exactly two numeric arguments", () => {
  for (const name of ["set_xy", "towards", "distance"]) {
    const [call] = parseClean(`${name} 50 25`).body;
    assert.equal(call.kind, "Call");
    assert.equal(call.callee.name, name);
    assert.equal(call.args.length, 2);
    assert.equal(call.args[0].value, 50);
    assert.equal(call.args[1].value, 25);
  }
});

test("every no-argument turtle command gathers zero arguments", () => {
  for (const name of [
    "home",
    "xcor",
    "ycor",
    "heading",
    "pos",
    "show_turtle",
    "hide_turtle",
    "pen_up",
    "pen_down",
    "clear_screen",
    "clean",
    "fill",
    "stamp",
  ]) {
    const [call] = parseClean(name).body;
    assert.equal(call.kind, "Call");
    assert.equal(call.callee.name, name);
    assert.equal(call.args.length, 0);
  }
});

test("set_color, set_background, set_width, and set_shape gather exactly one argument", () => {
  for (const [name, arg] of [
    ["set_color", '"blue"'],
    ["set_background", '"white"'],
    ["set_width", "4"],
    ["set_shape", '"triangle"'],
  ]) {
    const [call] = parseClean(`${name} ${arg}`).body;
    assert.equal(call.kind, "Call");
    assert.equal(call.callee.name, name);
    assert.equal(call.args.length, 1);
  }
});

test("a nested reporter call fills a turtle command's argument slot (forward random 100)", () => {
  const [call] = parseClean("forward random 100").body;
  assert.equal(call.kind, "Call");
  assert.equal(call.callee.name, "forward");
  assert.equal(call.args.length, 1);
  const [arg] = call.args;
  assert.equal(arg.kind, "Call");
  assert.equal(arg.callee.name, "random");
  assert.equal(arg.args.length, 1);
  assert.equal(arg.args[0].value, 100);
});

test("without the turtle-rendering profile active, forward still parses cleanly at Layer 1 but is flagged ol-unknown-command at Layer 2", () => {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(
    "forward 100",
    "turtle-arity.logo",
  );
  assert.deepEqual(parseDiagnostics, []);
  const { diagnostics } = OL.check(ast, { profiles: ["core-language"] });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-unknown-command");
  assert.equal(diagnostics[0].stage, "semantic");
});
