import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { execute } from "@openlogo/runtime";
import * as OL from "@openlogo/studio";

const {
  CHECKER_INCOMPLETE_NOTICE_MESSAGE,
  createDiagnosticsController,
  createParserHighlighter,
  DEFAULT_DIAGNOSTICS_DOCUMENT,
  mountDiagnosticsPane,
  STUDIO_PROFILES,
  toDiagnosticsView,
  createAppShell,
  createStudioState,
} = OL;

/** The document the differential test runs both paths under, so spans are comparable. */
const RUN_DOCUMENT = DEFAULT_DIAGNOSTICS_DOCUMENT;

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

test("an ordinary Core program has no diagnostics at all — parse OR semantic (no false positives)", () => {
  // #817 — this guard's *premise* changed, so it is rewritten rather than left quietly green.
  //
  // It was written to protect the "semanticCheck defaults to false" design decision, and its
  // comment gave two reasons that were both re-measured on this slice's base commit and are both
  // FALSE:
  //   1. "check()'s ol-unknown-command rule doesn't yet recognize every Turtle & Rendering
  //      primitive, so it must not run by default" — it does recognize them, once the active
  //      profile set is passed. That has been true since #740.
  //   2. "`forward` isn't yet registered in the parser's own arity table either, so `forward 100`
  //      is presently a genuine Layer-1 parse diagnostic" — measured: `parse("forward 100")`
  //      reports ZERO diagnostics, and `check()` under STUDIO_PROFILES reports zero as well.
  //
  // So the default flipped to `true`, and what this test guards flipped with it: not "semantic
  // checking is off" but "with semantic checking ON, an ordinary program is still clean". That is
  // the false-positive wall, and it is now the load-bearing one — see the `forward`-based
  // assertions below, which the old comment specifically claimed could not be written.
  const state = createStudioState();
  createDiagnosticsController(state);

  state.setSource("repeat 4 [ print 1 + 2 ]");

  assert.deepEqual(state.getState().diagnostics, []);
});

test("#817 AC: a Turtle & Rendering program is clean under the default profile set", () => {
  // The exact program issue #817 names, and the exact claim the retired comment denied. Under the
  // studio's active set this is clean; `an explicit Core-Language-only set...` below is the
  // falsification that keeps this zero from being the zero of a checker that never ran.
  const state = createStudioState();
  createDiagnosticsController(state);

  state.setSource(
    "define sq :n\n  repeat 4 [ forward :n right 90 ]\nend\nsq 50\n",
  );

  assert.deepEqual(state.getState().diagnostics, []);
});

test("#817 AC: the same turtle program IS flagged under Core Language alone (falsification)", () => {
  // Without this, the test above would pass identically if semantic checking were switched off
  // entirely. Reporting the *names* is what makes it a measurement rather than a count of zero.
  const state = createStudioState();
  createDiagnosticsController(state, { profiles: ["core-language"] });

  state.setSource(
    "define sq :n\n  repeat 4 [ forward :n right 90 ]\nend\nsq 50\n",
  );

  assert.deepEqual(reportedNames(state), ["forward", "right"]);
});

test("#817 AC: an unknown reporter is flagged as the learner types, with no Run", () => {
  // The user story: `difference` is not an OpenLogo name, and before this slice the learner saw
  // nothing at all until they pressed Run. No run() is involved anywhere in this test.
  const state = createStudioState();
  createDiagnosticsController(state);

  state.setSource("print (difference 10 5)");

  const view = toDiagnosticsView(state.getState().diagnostics);
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].code, "ol-unknown-command");
  assert.equal(view.items[0].stage, "semantic");
  assert.equal(view.items[0].severity, "error");
  assert.deepEqual(view.items[0].params, { name: "difference" });
  // At the span of `difference`, not of the whole line — the pane renders it inline there.
  assert.deepEqual(view.items[0].sourceSpan.start, [1, 8]);
  assert.deepEqual(view.items[0].sourceSpan.end, [1, 18]);
});

test("#817 AC: in a mixed program ONLY the invalid name is flagged", () => {
  const state = createStudioState();
  createDiagnosticsController(state);

  state.setSource("forward 100\nprint (wibble 2)\nright 90\n");

  assert.deepEqual(reportedNames(state), ["wibble"]);
});

test("#817 AC: every runnable spec example is free of semantic false positives", () => {
  // The corpus check the issue asks for, run through the controller itself rather than through a
  // separate call to check() — a false positive here would be one a learner meets on day one.
  const examplesDirectory = fileURLToPath(
    new URL("../../../spec/examples/", import.meta.url),
  );
  const files = readdirSync(examplesDirectory)
    .filter((name) => name.endsWith(".logo"))
    .sort();
  assert.ok(files.length > 0, "no spec examples were found to check");

  /** Every finding one program produces, labelled — the single instrument this test trusts. */
  function findingsIn(label, source) {
    const state = createStudioState();
    createDiagnosticsController(state);
    state.setSource(source);
    return toDiagnosticsView(state.getState().diagnostics).items.map(
      (item) => `${label}: ${item.code} ${JSON.stringify(item.params)}`,
    );
  }

  const flagged = files.flatMap((file) =>
    findingsIn(file, readFileSync(join(examplesDirectory, file), "utf8")),
  );

  assert.deepEqual(flagged, []);

  // Falsification, through **the same function** rather than a parallel one: an instrument that
  // reports nothing on the corpus proves nothing until it is shown able to report at all. Running
  // the control here also means the reporting path above is exercised rather than merely present.
  // The bare name (no argument) is deliberate — `flibbertigibbet 5` additionally trips a Layer-1
  // `ol-bad-token`, because the parser has no arity for an unknown name and reads `5` as a second
  // instruction on the line, which would make this control assert two faults instead of the one it
  // is about.
  assert.deepEqual(findingsIn("control", "forward 100\nflibbertigibbet"), [
    'control: ol-unknown-command {"name":"flibbertigibbet"}',
  ]);
});

test("semanticCheck: false opts back out, leaving only Layer-1 parse diagnostics", () => {
  const state = createStudioState();
  createDiagnosticsController(state, { semanticCheck: false });

  state.setSource("flibbertigibbet");

  assert.deepEqual(state.getState().diagnostics, []);
});

test("semantic diagnostics land in the same unified field by default", () => {
  const state = createStudioState();
  createDiagnosticsController(state);

  state.setSource("flibbertigibbet");

  const view = toDiagnosticsView(state.getState().diagnostics);
  assert.ok(view.items.some((item) => item.code === "ol-unknown-command"));
});

test("styleCheck: true additionally layers Layer-3 style-lint warnings", () => {
  const state = createStudioState();
  createDiagnosticsController(state, { styleCheck: true });

  state.setSource("define MyProc\nend");

  const view = toDiagnosticsView(state.getState().diagnostics);
  assert.ok(view.items.some((item) => item.code === "ol-style-name-case"));
});

test("style lints stay OFF by default even though semantic checking is on (#817)", () => {
  // The half of the flip that did NOT change, with its reason gated rather than asserted in prose:
  // over the same spec-example corpus that yields ZERO semantic diagnostics, the style lints fire
  // repeatedly (46 of them at the time of writing, mostly `ol-style-magic-number`). Turning both on
  // as-you-type would bury a real `ol-unknown-command` under advice about programs that are already
  // correct. The exact count is deliberately not pinned — the contrast is the load-bearing part,
  // and pinning 46 would make every future example edit a failing test.
  const examplesDirectory = fileURLToPath(
    new URL("../../../spec/examples/", import.meta.url),
  );
  const files = readdirSync(examplesDirectory)
    .filter((name) => name.endsWith(".logo"))
    .sort();

  let styleLints = 0;
  for (const file of files) {
    const opted = createStudioState();
    createDiagnosticsController(opted, { styleCheck: true });
    opted.setSource(readFileSync(join(examplesDirectory, file), "utf8"));
    styleLints += toDiagnosticsView(opted.getState().diagnostics).items.filter(
      (item) => item.code.startsWith("ol-style-"),
    ).length;
  }

  assert.ok(
    styleLints > 0,
    "the corpus produced no style lints at all, so the contrast this default rests on is untested",
  );

  // And by default that same advice stays silent.
  const state = createStudioState();
  createDiagnosticsController(state);

  state.setSource("define MyProc\nend");

  assert.deepEqual(state.getState().diagnostics, []);
});

test("styleCheck: true has no effect when semanticCheck is explicitly false", () => {
  const state = createStudioState();
  createDiagnosticsController(state, {
    semanticCheck: false,
    styleCheck: true,
  });

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
  // would fail to report `print` here.
  const state = createStudioState();
  createDiagnosticsController(state, { profiles: [], semanticCheck: true });

  state.setSource("print 1\nflibbertigibbet");

  assert.deepEqual(reportedNames(state), ["print", "flibbertigibbet"]);
});

test("the checker and the editor agree about a profile word under the shared default", () => {
  // The contradiction #740 exists to remove, on one program: the editor paints `ask` as the keyword
  // it is while the checker, reading the same default set, treats it as an available name and
  // reports only the name nothing knows. Before this slice the editor gave `ask` the plain
  // `primitive` fallback — a command its own checker was happy to accept.
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

// ---------------------------------------------------------------------------------------------
// #817 review round 1 — the one-fault merge and the checker guard.
// ---------------------------------------------------------------------------------------------

test("#817: one fault produces one message — the live pane matches execute() exactly", () => {
  // The differential test. `runChecks` used to concatenate `parse()` and `check()` by hand and skip
  // `applyOneFaultRules`, which `analyze()` (and therefore `execute()`) applies. `fowad 100` then
  // showed the learner a bogus `ol-bad-token` — "i didn't expect 100 to keep going on this line",
  // wrong advice about a perfectly good `100` — stacked above the true `ol-unknown-command`, and
  // that extra message vanished the moment they pressed Run.
  //
  // Asserting the two lists are EQUAL rather than asserting a count is what stops the two paths
  // drifting again: any future divergence in either direction fails here.
  //
  // Every case must be a program the check REFUSES, so nothing executes. The live pane runs only
  // Layers 1 and 2 and can never see a runtime finding, so adding a case that actually runs — say
  // `print 1 / 0` — would fail this test for an entirely correct reason. `execute()`'s output is
  // filtered to the static stages below so that trap is closed rather than merely documented.
  const staticOnly = (list) => list.filter((each) => each.stage !== "runtime");
  const shape = (list) =>
    staticOnly(list).map(
      (each) =>
        `${each.stage}/${each.code}${JSON.stringify(each.params)}@${JSON.stringify(each.source_span.start)}`,
    );

  for (const source of [
    "fowad 100",
    "fowad 100 200",
    "forward 100\nfowad 50\nright 90",
    "print (difference 10 5)",
    "flibbertigibbet",
    "forward 100",
    // A program that RUNS and produces a runtime diagnostic. It is here to keep the
    // `stage !== "runtime"` filter honest: delete the filter and this case fails, which is what
    // stops the filter from being an unexamined convenience.
    "print 1 / 0",
  ]) {
    const state = createStudioState();
    createDiagnosticsController(state, { document: RUN_DOCUMENT });
    state.setSource(source);

    const live = shape(state.getState().diagnostics);
    const run = shape(
      execute(source, RUN_DOCUMENT, { profiles: STUDIO_PROFILES }).diagnostics,
    );

    assert.deepEqual(
      live,
      run,
      `live and Run disagree for ${JSON.stringify(source)}`,
    );
  }
});

test("#817: the bare-typo form reports exactly one diagnostic, not two", () => {
  // Stated directly as well as differentially, because the differential test above would also pass
  // if BOTH paths regressed together. This is the shape every #817 acceptance test missed: they all
  // used a parenthesised call (`print (difference 10 5)`), which is the one form that produces no
  // trailing `ol-bad-token` and therefore cannot show the defect.
  const state = createStudioState();
  createDiagnosticsController(state);

  state.setSource("fowad 100");

  const view = toDiagnosticsView(state.getState().diagnostics);
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].code, "ol-unknown-command");
  assert.equal(view.items[0].stage, "semantic");
  assert.deepEqual(view.items[0].params, {
    name: "fowad",
    suggestion: "forward",
  });
  assert.ok(
    !view.items.some((item) => item.code === "ol-bad-token"),
    "the suppressed Layer-1 finding came back",
  );
});

/**
 * A profile set that is a faithful stand-in for {@link STUDIO_PROFILES} but throws from inside the
 * checker while `exploding` is set. Test-only, and the point is determinism: it makes the guard's
 * behaviour reproducible in every environment and every Node version, where provoking a real native
 * stack overflow depends on the runner, the flags, and how many frames are already below the call.
 * The depth-driven route is real and is what motivated the guard (#1146) — it is simply the wrong
 * instrument to assert with, because `assert.doesNotThrow` on a too-shallow program passes while
 * proving nothing.
 */
function explodingProfiles() {
  const state = { exploding: true };
  const error = new Error("checker exploded");
  const profiles = new Proxy([...STUDIO_PROFILES], {
    get(target, property, receiver) {
      if (state.exploding) {
        throw error;
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { profiles, state, error };
}

test("#817: a throw from the checker degrades instead of escaping into setSource", () => {
  // The guard, driven through a deterministic seam rather than a real stack overflow.
  // `onCheckFailure` is injected — the default rethrows asynchronously, which under `node --test`
  // would redden this file as an unhandled rejection even though every assertion here passes.
  const failures = [];
  const state = createStudioState();
  const { profiles, error: boom } = explodingProfiles();

  let laterListenerSawSource = null;
  createDiagnosticsController(state, {
    profiles,
    onCheckFailure: (failure) => failures.push(failure),
  });
  // The controller checks once at construction (over the empty initial source), which this set also
  // fails. Measure the DELTA across the edit, so the assertion is about the keystroke.
  const failuresBeforeEdit = failures.length;
  state.subscribe((next) => {
    laterListenerSawSource = next.source;
  });

  assert.doesNotThrow(() => {
    state.setSource("forward 100");
  });

  // The failure reached the developer channel, exactly once for this edit.
  assert.equal(failures.length - failuresBeforeEdit, 1);
  assert.equal(failures.at(-1), boom);
  // The listener loop completed — this is the thing that actually broke a session. A throw here
  // aborted `commit()`'s loop, so the editor, highlighter, turtle pane and announcer never saw the
  // update while `source` had already been committed.
  assert.equal(laterListenerSawSource, "forward 100");
  // The pane degraded to Layer 1 rather than emptying: `analyze()` throws as a unit, so without the
  // nested re-parse there would be nothing left to show, including for a program with real findings.
  assert.deepEqual(state.getState().diagnostics, []);
  // And the learner is told about the TOOL, not given a verdict about their PROGRAM.
  assert.deepEqual(state.getState().notice, {
    level: "warning",
    message: CHECKER_INCOMPLETE_NOTICE_MESSAGE,
  });
});

test("#817: the DEFAULT failure handler carries the error asynchronously, never synchronously", async () => {
  // Covers the default `onCheckFailure`, which every other guard test deliberately replaces.
  //
  // It is asserted directly rather than by provoking it through the controller, because a rejection
  // *nobody handles* is exactly what this function is for: under `node --test` that is a test
  // failure by construction, so the default cannot be observed passively. Calling it and attaching
  // a `.catch()` to the promise it returns is the seam — the controller discards that return value,
  // which is what leaves the rejection unhandled and therefore loud in production.
  const boom = new Error("checker exploded");

  // Half one: it does not throw synchronously. A synchronous throw is what aborts `commit()`'s
  // listener loop and wedges the session.
  let returned;
  assert.doesNotThrow(() => {
    returned = OL.rethrowCheckFailureAsynchronously(boom);
  });

  // Half two: the error is genuinely carried, so a real bug still reaches a developer.
  await assert.rejects(returned, (reason) => reason === boom);
});

test("#817: a degraded check still surfaces the Layer-1 findings it could compute", () => {
  const failures = [];
  const state = createStudioState();
  const { profiles } = explodingProfiles();
  createDiagnosticsController(state, {
    profiles,
    onCheckFailure: (failure) => failures.push(failure),
  });
  const failuresBeforeEdit = failures.length;

  state.setSource("%");

  assert.equal(failures.length - failuresBeforeEdit, 1);
  // The falsifying half of the test above: degrading is not the same as going silent.
  const view = toDiagnosticsView(state.getState().diagnostics);
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].code, "ol-bad-token");
});

test("#817: the notice clears when the next check succeeds", () => {
  const state = createStudioState();
  const { profiles, state: explosion } = explodingProfiles();
  createDiagnosticsController(state, {
    profiles,
    onCheckFailure: () => {},
  });

  state.setSource("forward 100");
  assert.equal(
    state.getState().notice?.message,
    CHECKER_INCOMPLETE_NOTICE_MESSAGE,
  );

  explosion.exploding = false;
  state.setSource("forward 200");

  assert.equal(state.getState().notice, null);
  // And the recovered check is a real one, not merely a cleared notice.
  assert.deepEqual(state.getState().diagnostics, []);
  state.setSource("fowad 200");
  assert.deepEqual(
    state.getState().diagnostics.map((each) => each.code),
    ["ol-unknown-command"],
  );
});

test("#817: a notice this controller did not set is never cleared", () => {
  // `setNotice(null)` is a global stomp and the field is shared — persistence uses it for "your
  // work could not be saved". A controller that cleared unconditionally would silently erase it.
  const state = createStudioState();
  createDiagnosticsController(state);

  state.setNotice({
    level: "warning",
    message: "your work could not be saved",
  });
  state.setSource("forward 100");

  assert.deepEqual(state.getState().notice, {
    level: "warning",
    message: "your work could not be saved",
  });
});

test("#817: a foreign notice that REPLACES ours is still not cleared", () => {
  // The ordering the first test cannot reach, and the one that actually bit. With ownership tracked
  // by a boolean, this sequence erased persistence's warning: the flag recorded that we had once
  // written a notice, not whether ours was still the one on screen. A `setNotice` alone does not
  // change `source`, so `refresh()` early-returns and the flag stayed latched.
  //
  // A learner who has lost their work would also lose the only warning that they lost it.
  const state = createStudioState();
  const { profiles, state: explosion } = explodingProfiles();
  createDiagnosticsController(state, { profiles, onCheckFailure: () => {} });

  // 1. We set our own notice.
  state.setSource("forward 100");
  assert.equal(
    state.getState().notice?.message,
    CHECKER_INCOMPLETE_NOTICE_MESSAGE,
  );

  // 2. Another subsystem replaces it.
  const foreign = { level: "warning", message: "your work could not be saved" };
  state.setNotice(foreign);

  // 3. The next check succeeds.
  explosion.exploding = false;
  state.setSource("forward 200");

  // The foreign notice survives, and the successful check really did happen.
  assert.deepEqual(state.getState().notice, foreign);
  assert.deepEqual(state.getState().diagnostics, []);
});

test("#817: a foreign notice is not OVERWRITTEN by a checker failure either", () => {
  // Ownership is symmetric. Round 2 guarded only the clearing half, which left the identical harm
  // reachable from the other direction: a checker failure publishing over persistence's "your work
  // could not be saved" hides the learner's only warning that their work is gone.
  //
  // Losing our own notice to that rule is the right trade — ours reports that a convenience
  // degraded and the Run path still works; theirs reports lost work.
  const state = createStudioState();
  const { profiles } = explodingProfiles();
  const foreign = { level: "warning", message: "your work could not be saved" };

  createDiagnosticsController(state, { profiles, onCheckFailure: () => {} });
  state.setNotice(foreign);

  state.setSource("forward 100");

  assert.equal(state.getState().notice, foreign);
});

test("#817: with the notice field free, a checker failure DOES publish ours", () => {
  // The falsifying control for the test above: a guard that simply never published would satisfy it
  // trivially, and the learner would then be told nothing at all when live checking degrades.
  const state = createStudioState();
  const { profiles } = explodingProfiles();
  createDiagnosticsController(state, { profiles, onCheckFailure: () => {} });

  state.setSource("forward 100");

  assert.deepEqual(state.getState().notice, {
    level: "warning",
    message: CHECKER_INCOMPLETE_NOTICE_MESSAGE,
  });
});

test("#817: the failure notice does not blame the learner's program", () => {
  // It is reached by ANY throw from the checker, so it must not name a cause it has not
  // established. The deterministic seam these tests use throws a plain Error, which is nothing to
  // do with nesting — an earlier revision told that learner their program was "too deeply nested".
  assert.ok(
    !/nest|deep/i.test(CHECKER_INCOMPLETE_NOTICE_MESSAGE),
    `the notice names a cause it cannot establish: ${CHECKER_INCOMPLETE_NOTICE_MESSAGE}`,
  );
  // It must still say the Run path works, which is the actionable half.
  assert.match(CHECKER_INCOMPLETE_NOTICE_MESSAGE, /Run/);
});
