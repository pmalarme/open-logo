import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

function pos(line, column) {
  return [line, column];
}

function collapsed(position) {
  return { anchor: position, head: position };
}

test("createEditorController reads text/selection straight from the shared state model", () => {
  const store = OL.createStudioState({ source: "forward 10" });
  const controller = OL.createEditorController(store);

  assert.equal(controller.getText(), "forward 10");
  assert.deepEqual(controller.getSelection(), collapsed(pos(1, 1)));

  // The controller has no private buffer: mutating the store directly is immediately visible.
  store.setSource("right 90");
  assert.equal(controller.getText(), "right 90");
});

test("setText replaces the document and collapses the cursor to the end", () => {
  const store = OL.createStudioState();
  const controller = OL.createEditorController(store);

  controller.setText("forward 10\nright 90");

  assert.equal(store.getState().source, "forward 10\nright 90");
  assert.deepEqual(controller.getSelection(), collapsed(pos(2, 9)));
});

test("setSelection moves the cursor without changing the text", () => {
  const store = OL.createStudioState({ source: "forward 10" });
  const controller = OL.createEditorController(store);

  controller.setSelection({ anchor: pos(1, 3), head: pos(1, 5) });

  assert.equal(controller.getText(), "forward 10");
  assert.deepEqual(controller.getSelection(), {
    anchor: pos(1, 3),
    head: pos(1, 5),
  });
});

test("insertText inserts at a collapsed cursor and advances it", () => {
  const store = OL.createStudioState({ source: "forward " });
  const controller = OL.createEditorController(store);
  controller.setSelection(collapsed(pos(1, 9)));

  controller.insertText("100");

  assert.equal(controller.getText(), "forward 100");
  assert.deepEqual(controller.getSelection(), collapsed(pos(1, 12)));
});

test("insertText replaces a non-collapsed (forward) selection", () => {
  const store = OL.createStudioState({ source: "forward 10" });
  const controller = OL.createEditorController(store);
  // Select "10" (columns 9-11).
  controller.setSelection({ anchor: pos(1, 9), head: pos(1, 11) });

  controller.insertText("360");

  assert.equal(controller.getText(), "forward 360");
  assert.deepEqual(controller.getSelection(), collapsed(pos(1, 12)));
});

test("insertText replaces a backward selection (head before anchor) the same way", () => {
  const store = OL.createStudioState({ source: "forward 10" });
  const controller = OL.createEditorController(store);
  // Same "10" selection, but dragged right-to-left.
  controller.setSelection({ anchor: pos(1, 11), head: pos(1, 9) });

  controller.insertText("5");

  assert.equal(controller.getText(), "forward 5");
  assert.deepEqual(controller.getSelection(), collapsed(pos(1, 10)));
});

test("insertText can insert a newline, moving the cursor to the next line", () => {
  const store = OL.createStudioState({ source: "forward 10" });
  const controller = OL.createEditorController(store);
  controller.setSelection(collapsed(pos(1, 11)));

  controller.insertText("\nright 90");

  assert.equal(controller.getText(), "forward 10\nright 90");
  assert.deepEqual(controller.getSelection(), collapsed(pos(2, 9)));
});

test("insertText resolves a selection on a later line, not just line 1", () => {
  const store = OL.createStudioState({ source: "forward 10\nright 90" });
  const controller = OL.createEditorController(store);
  // Cursor after "right " on line 2 (column 7); forces offsetFromPosition to walk a prior line.
  controller.setSelection(collapsed(pos(2, 7)));

  controller.insertText("45");

  assert.equal(controller.getText(), "forward 10\nright 4590");
  assert.deepEqual(controller.getSelection(), collapsed(pos(2, 9)));
});

test("deleteBackward removes the character before a collapsed cursor", () => {
  const store = OL.createStudioState({ source: "forward 100" });
  const controller = OL.createEditorController(store);
  controller.setSelection(collapsed(pos(1, 12)));

  controller.deleteBackward();

  assert.equal(controller.getText(), "forward 10");
  assert.deepEqual(controller.getSelection(), collapsed(pos(1, 11)));
});

test("deleteBackward at the very start of the document is a no-op", () => {
  const store = OL.createStudioState({ source: "forward 10" });
  const controller = OL.createEditorController(store);
  controller.setSelection(collapsed(pos(1, 1)));

  controller.deleteBackward();

  assert.equal(controller.getText(), "forward 10");
  assert.deepEqual(controller.getSelection(), collapsed(pos(1, 1)));
});

test("deleteBackward removes a non-collapsed selection instead of one character", () => {
  const store = OL.createStudioState({ source: "forward 100" });
  const controller = OL.createEditorController(store);
  controller.setSelection({ anchor: pos(1, 9), head: pos(1, 12) });

  controller.deleteBackward();

  assert.equal(controller.getText(), "forward ");
  assert.deepEqual(controller.getSelection(), collapsed(pos(1, 9)));
});

test("deleteForward removes the character after a collapsed cursor", () => {
  const store = OL.createStudioState({ source: "forward 100" });
  const controller = OL.createEditorController(store);
  controller.setSelection(collapsed(pos(1, 9)));

  controller.deleteForward();

  assert.equal(controller.getText(), "forward 00");
  assert.deepEqual(controller.getSelection(), collapsed(pos(1, 9)));
});

test("deleteForward at the very end of the document is a no-op", () => {
  const store = OL.createStudioState({ source: "forward 10" });
  const controller = OL.createEditorController(store);
  controller.setSelection(collapsed(pos(1, 11)));

  controller.deleteForward();

  assert.equal(controller.getText(), "forward 10");
  assert.deepEqual(controller.getSelection(), collapsed(pos(1, 11)));
});

test("deleteForward removes a non-collapsed selection instead of one character", () => {
  const store = OL.createStudioState({ source: "forward 100" });
  const controller = OL.createEditorController(store);
  controller.setSelection({ anchor: pos(1, 9), head: pos(1, 12) });

  controller.deleteForward();

  assert.equal(controller.getText(), "forward ");
  assert.deepEqual(controller.getSelection(), collapsed(pos(1, 9)));
});

test("getTokens defaults to noopHighlighter (plain text, no hard dependency on #118)", () => {
  const store = OL.createStudioState({ source: "forward 100" });
  const controller = OL.createEditorController(store);

  assert.deepEqual(controller.getTokens(), []);
  assert.deepEqual(OL.noopHighlighter("anything"), []);
});

test("getTokens delegates to a configured HighlightProvider, re-classifying on every call", () => {
  const store = OL.createStudioState({ source: "forward 100" });
  const calls = [];
  const highlighter = (source) => {
    calls.push(source);
    return [
      {
        text: source,
        class: "primitive",
        start: [1, 1],
        end: [1, source.length + 1],
      },
    ];
  };
  const controller = OL.createEditorController(store, { highlighter });

  const tokens = controller.getTokens();

  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].text, "forward 100");
  assert.deepEqual(calls, ["forward 100"]);
});

test("editing never forks the document text: two independent controllers over one store agree", () => {
  const store = OL.createStudioState({ source: "forward 10" });
  const controllerA = OL.createEditorController(store);
  const controllerB = OL.createEditorController(store);

  controllerA.setSelection(collapsed(pos(1, 11)));
  controllerA.insertText("0");

  assert.equal(controllerA.getText(), "forward 100");
  assert.equal(controllerB.getText(), "forward 100");
  assert.equal(store.getState().source, "forward 100");
});

test("mountEditorPane composes the controller into the shell's editor region", () => {
  const store = OL.createStudioState();
  const shell = OL.createAppShell(store);
  const controller = OL.createEditorController(store);

  OL.mountEditorPane(shell, controller);

  assert.equal(shell.getRegion("editor").content, controller);
});
