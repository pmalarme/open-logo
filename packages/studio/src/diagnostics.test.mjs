import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

const {
  createDiagnosticsController,
  createParserHighlighter,
  DEFAULT_DIAGNOSTICS_DOCUMENT,
  mountDiagnosticsPane,
  toDiagnosticsView,
  createAppShell,
  createStudioState,
} = OL;

/** A minimal, arbitrary Diagnostic-shaped fixture for testing the pure projection in isolation. */
function fakeDiagnostic(overrides = {}) {
  return {
    code: "ol-bad-token",
    source_span: { document: "x", start: [1, 1], end: [1, 2] },
    params: {},
    message: "irrelevant prose",
    stage: "parse",
    severity: "error",
    ...overrides,
  };
}

test("toDiagnosticsView() projects an empty list as isEmpty with zero counts", () => {
  const view = toDiagnosticsView([]);
  assert.deepEqual(view, {
    items: [],
    errorCount: 0,
    warningCount: 0,
    isEmpty: true,
  });
});

test("toDiagnosticsView() counts errors and warnings by severity, never by message text", () => {
  const diagnostics = [
    fakeDiagnostic({
      severity: "error",
      message: "message text is irrelevant",
    }),
    fakeDiagnostic({ severity: "warning", message: "totally different prose" }),
    fakeDiagnostic({ severity: "warning" }),
  ];

  const view = toDiagnosticsView(diagnostics);

  assert.equal(view.errorCount, 1);
  assert.equal(view.warningCount, 2);
  assert.equal(view.isEmpty, false);
  assert.equal(view.items.length, 3);
});

test("toDiagnosticsView() items carry code/span/severity/stage/params as structured fields", () => {
  const diagnostic = fakeDiagnostic({
    code: "ol-unknown-command",
    params: { name: "flibbertigibbet" },
    stage: "semantic",
    severity: "error",
  });

  const [item] = toDiagnosticsView([diagnostic]).items;

  assert.equal(item.code, "ol-unknown-command");
  assert.equal(item.stage, "semantic");
  assert.equal(item.severity, "error");
  assert.deepEqual(item.params, { name: "flibbertigibbet" });
  assert.deepEqual(item.sourceSpan, diagnostic.source_span);
  assert.equal(item.message, diagnostic.message);
});

test("createDiagnosticsController() starts with no diagnostics for an empty document", () => {
  const state = createStudioState();
  const controller = createDiagnosticsController(state);

  assert.deepEqual(state.getState().diagnostics, []);
  assert.equal(controller.getView().isEmpty, true);
});

test("editing to a bad-token line surfaces a diagnostic at its span, without crashing", () => {
  const state = createStudioState();
  createDiagnosticsController(state);

  state.setSource("%");

  const view = toDiagnosticsView(state.getState().diagnostics);
  assert.equal(view.errorCount, 1);
  assert.equal(view.items[0].code, "ol-bad-token");
  assert.deepEqual(view.items[0].sourceSpan.start, [1, 1]);
});

test("multiple bad tokens surface as multiple diagnostics, still without crashing", () => {
  const state = createStudioState();
  createDiagnosticsController(state);

  state.setSource("%$@");

  const view = toDiagnosticsView(state.getState().diagnostics);
  assert.equal(view.items.length, 3);
  assert.ok(view.items.every((item) => item.code === "ol-bad-token"));
});

test("an ordinary Core program has no parse-stage diagnostics by default (no false positives)", () => {
  // Regression guard for the semanticCheck-defaults-to-false design decision: check()'s
  // ol-unknown-command rule doesn't yet recognize every Turtle & Rendering primitive, so it
  // must not run by default. (Note: `forward` itself isn't a clean example here — it isn't yet
  // registered in the parser's own arity table either, so `forward 100` is presently a genuine
  // Layer-1 parse diagnostic, not something this pane should suppress or hide.)
  const state = createStudioState();
  createDiagnosticsController(state);

  state.setSource("repeat 4 [ print 1 + 2 ]");

  assert.deepEqual(state.getState().diagnostics, []);
});

test("semanticCheck: true layers real semantic diagnostics into the same unified field", () => {
  const state = createStudioState();
  createDiagnosticsController(state, { semanticCheck: true });

  state.setSource("flibbertigibbet 5");

  const view = toDiagnosticsView(state.getState().diagnostics);
  assert.ok(view.items.some((item) => item.code === "ol-unknown-command"));
});

test("styleCheck: true additionally layers Layer-3 style-lint warnings when semanticCheck is on", () => {
  const state = createStudioState();
  createDiagnosticsController(state, { semanticCheck: true, styleCheck: true });

  state.setSource("define MyProc\nend");

  const view = toDiagnosticsView(state.getState().diagnostics);
  assert.ok(view.items.some((item) => item.code === "ol-style-name-case"));
});

test("styleCheck: true has no effect when semanticCheck is false (default)", () => {
  const state = createStudioState();
  createDiagnosticsController(state, { styleCheck: true });

  state.setSource("define MyProc\nend");

  const view = toDiagnosticsView(state.getState().diagnostics);
  assert.equal(view.items.length, 0);
});

// #740 — the checker reads the same active profile set the highlighter does. The fixture pairs a
// Sound command with a name no profile knows: under the studio's default set only the unknown name
// is reported, and under Core Language alone `beep` is reported too. Reporting the *names*, from a
// list that is non-empty either way, is what makes both directions non-vacuous — an assertion that
// merely counted zero would also pass if semantic checking never ran at all, and `!items.some(...)`
// would report 100% coverage without its callback ever executing.
const UNKNOWN_NAME_FIXTURE = "beep\nflibbertigibbet";

function reportedNames(state) {
  return toDiagnosticsView(state.getState().diagnostics).items.map(
    (item) => item.params.name,
  );
}

test("the checker runs under the studio's profile set by default", () => {
  const state = createStudioState();
  createDiagnosticsController(state, { semanticCheck: true });

  state.setSource(UNKNOWN_NAME_FIXTURE);

  assert.deepEqual(reportedNames(state), ["flibbertigibbet"]);
});

test("an explicit Core-Language-only set additionally flags the profile command", () => {
  const state = createStudioState();
  createDiagnosticsController(state, {
    profiles: ["core-language"],
    semanticCheck: true,
  });

  state.setSource(UNKNOWN_NAME_FIXTURE);

  assert.deepEqual(reportedNames(state), ["beep", "flibbertigibbet"]);
});

test("an explicitly empty profile set is honored by the checker too", () => {
  // The `check()` half of the same guard: `[]` means "no profiles active", so even Core Language's
  // own `print` is an unknown command. A regression that quietly substituted the studio default
  // would report nothing here.
  const state = createStudioState();
  createDiagnosticsController(state, { profiles: [], semanticCheck: true });

  state.setSource("print 1\nflibbertigibbet");

  assert.deepEqual(reportedNames(state), ["print", "flibbertigibbet"]);
});

test("the checker and the editor agree about a profile word under the shared default", () => {
  // The contradiction #740 exists to remove, on one program: the editor paints `ask` as the keyword
  // it is while the checker, reading the same default set, treats it as an available name and
  // reports only the name nothing knows. Before this slice the editor said "ordinary primitive"
  // about a command its own checker was happy to accept.
  //
  // Deliberately framed as *availability*, not reservation: `spec/grammar.md:408` makes profile
  // words built-in names unconditionally — "what a profile decides is whether a name works, never
  // whether a program may declare it" — so `ol-reserved-word` is not a profile-conditional
  // judgement and must not be asserted as one here.
  const source = ":t = new_turtle\nask :t [ right 90 ]\nflibbertigibbet";
  const state = createStudioState();
  createDiagnosticsController(state, { semanticCheck: true });

  state.setSource(source);

  assert.deepEqual(reportedNames(state), ["flibbertigibbet"]);

  const askToken = createParserHighlighter()(source).find(
    (token) => token.text === "ask",
  );
  assert.ok(askToken, "the fixture produced no token spelled ask");
  assert.equal(askToken.class, "ol-tok-keyword");
});

test("under Core Language alone the same program reads as unavailable and uncolored", () => {
  // The other direction of the same contradiction, so neither half above is vacuous: with Sprites
  // and Turtle & Rendering inactive the checker does not know `new_turtle`/`ask`/`right`, and the
  // editor stops painting `ask` as a keyword — `spec/tooling.md:31`'s "a profile word whose profile
  // is inactive" is `primitive`.
  const source = ":t = new_turtle\nask :t [ right 90 ]\nflibbertigibbet";
  const state = createStudioState();
  createDiagnosticsController(state, {
    profiles: ["core-language"],
    semanticCheck: true,
  });

  state.setSource(source);

  assert.deepEqual(reportedNames(state), [
    "new_turtle",
    "ask",
    "right",
    "flibbertigibbet",
  ]);

  const askToken = createParserHighlighter({ profiles: ["core-language"] })(
    source,
  ).find((token) => token.text === "ask");
  assert.ok(askToken, "the fixture produced no token spelled ask");
  assert.equal(askToken.class, "ol-tok-primitive");
});

test("refresh() is a no-op guard when source hasn't changed (subscribe doesn't clobber itself)", () => {
  const state = createStudioState();
  const controller = createDiagnosticsController(state);
  state.setSource("print 1");

  const diagnosticsAfterFirstCheck = state.getState().diagnostics;
  controller.refresh();
  controller.refresh();

  assert.equal(state.getState().diagnostics, diagnosticsAfterFirstCheck);
});

test("a diagnostics-only state change (e.g. a Run writing runtime diagnostics) is not clobbered", () => {
  const state = createStudioState();
  const controller = createDiagnosticsController(state);
  state.setSource("print 1");

  const runtimeDiagnostic = fakeDiagnostic({
    stage: "runtime",
    code: "ol-type",
  });
  state.setDiagnostics([runtimeDiagnostic]);
  controller.refresh();

  assert.deepEqual(state.getState().diagnostics, [runtimeDiagnostic]);
});

test("custom document option is passed through to parse()'s source spans", () => {
  const state = createStudioState();
  createDiagnosticsController(state, { document: "lesson-3.logo" });

  state.setSource("%");

  assert.equal(
    state.getState().diagnostics[0].source_span.document,
    "lesson-3.logo",
  );
});

test("default document identifier is DEFAULT_DIAGNOSTICS_DOCUMENT", () => {
  const state = createStudioState();
  createDiagnosticsController(state);

  state.setSource("%");

  assert.equal(
    state.getState().diagnostics[0].source_span.document,
    DEFAULT_DIAGNOSTICS_DOCUMENT,
  );
});

test("two consumers reading the same store always observe the same diagnostics (no forked copy)", () => {
  const state = createStudioState();
  createDiagnosticsController(state);
  state.setSource("%");

  const viewA = toDiagnosticsView(state.getState().diagnostics);
  const viewB = toDiagnosticsView(state.getState().diagnostics);

  assert.deepEqual(viewA, viewB);
});

test("mountDiagnosticsPane() composes the controller into the shell's diagnostics region", () => {
  const state = createStudioState();
  const shell = createAppShell(state);
  const controller = createDiagnosticsController(state);

  mountDiagnosticsPane(shell, controller);

  assert.equal(shell.getRegion("diagnostics").content, controller);
});
