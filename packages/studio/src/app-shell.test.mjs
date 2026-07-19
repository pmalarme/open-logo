import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

test("createAppShell renders every region as an empty placeholder by default", () => {
  const shell = OL.createAppShell(OL.createStudioState());

  for (const region of OL.APP_SHELL_REGIONS) {
    assert.deepEqual(shell.getRegion(region), { region, content: null });
  }
});

test("the shell exposes the exact same state store instance it was given (no fork)", () => {
  const store = OL.createStudioState({ source: "forward 100" });
  const shell = OL.createAppShell(store);

  assert.equal(shell.state, store);
  assert.equal(shell.state.getState().source, "forward 100");

  // A mutation through the original store is visible through the shell's reference too.
  store.setSource("right 90");
  assert.equal(shell.state.getState().source, "right 90");
});

test("mount composes a pane's content into its region, replacing the placeholder", () => {
  const shell = OL.createAppShell(OL.createStudioState());
  const editorPane = { kind: "editor-pane" };

  shell.mount("editor", editorPane);

  assert.deepEqual(shell.getRegion("editor"), {
    region: "editor",
    content: editorPane,
  });
  // Other regions stay untouched.
  assert.deepEqual(shell.getRegion("turtle"), {
    region: "turtle",
    content: null,
  });
});

test("unmount restores a region's placeholder", () => {
  const shell = OL.createAppShell(OL.createStudioState());
  shell.mount("diagnostics", { kind: "diagnostics-pane" });

  shell.unmount("diagnostics");

  assert.deepEqual(shell.getRegion("diagnostics"), {
    region: "diagnostics",
    content: null,
  });
});

test("two panes composed into the shell read the same underlying state (no desync)", () => {
  const store = OL.createStudioState();
  const shell = OL.createAppShell(store);

  const editorPane = { readSource: () => shell.state.getState().source };
  const lessonPane = { readSource: () => shell.state.getState().source };
  shell.mount("editor", editorPane);
  shell.mount("lesson", lessonPane);

  store.setSource("forward 42");

  assert.equal(shell.getRegion("editor").content.readSource(), "forward 42");
  assert.equal(shell.getRegion("lesson").content.readSource(), "forward 42");
});
