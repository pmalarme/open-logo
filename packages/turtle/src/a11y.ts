/**
 * Rendering accessibility primitives (`spec/rendering.md#accessibility`): a textual, non-visual
 * turtle-state description and color-independent feedback descriptors for rendering state that
 * would otherwise be shown by color alone. This module is pure, deterministic, and DOM-free —
 * it produces plain strings/data, never DOM nodes or ARIA attributes. The actual keyboard
 * operability and screen-reader wiring (focus order, live regions, accessible names) is a host
 * UI concern layered on top of these primitives (Studio's job, tracked separately) — this
 * package only supplies the render-agnostic content that wiring needs to expose.
 *
 * Issue #778 settled the two **presentation** questions this text had been answering by accident.
 * Numbers are rendered for speech by {@link formatDescribedNumber} (and
 * {@link formatDescribedHeading}/{@link formatDescribedWidth}) rather than interpolated raw, and a
 * multi-line instruction is reduced to one line by {@link summarizeSourceInstruction}. Measured on
 * that issue's base across the 13 runnable `spec/examples`, 1018 of the 1423 emitted region texts
 * carried float noise and 163 contained a newline; both are 0 here. Both changes are text-only;
 * nothing they touch reaches the turtle state, the event stream, the scene, or an exporter.
 */

import type { Point, TurtleId } from "@openlogo/core";
import { INITIAL_TURTLE_STATE, type TurtleState } from "./state.js";
import type { TurtleWorldState } from "./world-state.js";

/**
 * Decimal places `x`, `y` and `heading` are rounded to before they appear in a spoken description
 * (issue #778).
 *
 * Why this exists at all: a turtle position is an IEEE-754 double accumulated through
 * `d·sin θ`/`d·cos θ`, so a closed square lands on `x 1.4210854715202004e-14` rather than `x 0`;
 * a heading is accumulated by repeated addition of the turn, so a 7-pointed star reports
 * `heading 154.28571428571428` (1080/7). Measured on the base of this change by driving the 13
 * runnable `spec/examples/*.logo` through studio's live region and collecting every emitted
 * announcement — 1423 emitted texts, control non-zero — 917 carried such an `x`, 950 a `y`, 311 a
 * `heading`, and 1018 at least one of the three. After this change all four counts are 0, the
 * emitted count is still 1423, and the number of globally distinct texts goes from 1313 to 1300.
 *
 * Why 3: `svg.ts`'s `COORDINATE_PRECISION` already fixes 3 decimal places as this package's
 * documented, stable precision for serialized numbers — the precision `spec/rendering.md`'s Export
 * determinism section requires be documented. Reusing that number keeps one numeric convention in
 * the package instead of inventing a second; it is a precedent for the value, not evidence that 3
 * is the uniquely correct precision for speech. It is deliberately **not** the same constant: this
 * module imports nothing from `svg.ts` (it is a leaf that imports only types plus
 * {@link INITIAL_TURTLE_STATE}), the two format different things — device coordinates for a file
 * versus world coordinates for speech — and neither should move because the other did.
 *
 * The alternative considered was the language's own `print` rule (at most 10 significant digits,
 * `spec/execution-model.md:19`). It was rejected on measurement: it renders the value this issue
 * was filed about, `1.4210854715202004e-14`, as `1.421085472e-14` — still an exponent — and
 * `84.8528137423857` as `84.85281374`, still eight decimals to speak.
 *
 * **The threshold is a deliberate trade.** Rounding to 3 places puts positions into buckets 0.001
 * wide, and two positions in the same bucket render the same position clause — the effect is
 * bucket-relative, not magnitude-relative, so `0.00049` and `0.00051` differ by 0.00002 yet render
 * `y 0` and `y 0.001`, while `0` and `0.0004`, twenty times further apart, render identically. A
 * listener is notified only when the *whole* rendered text changes, so a collapsed position is
 * silent only while every other field, the current-instruction clause included, is also unchanged:
 * `repeat 4 / forward 0.0001 / end repeat` produces 3 region texts — the initial one plus 2
 * changes — where the same program with `forward 80` produces 7, ending at a real `y` of 0.0004
 * announced as `y 0`.
 *
 * A scale-aware formatter — snapping only values within some residue band of zero, then rounding
 * — could keep `0.0004` while still collapsing `1.4210854715202004e-14`, so this is a chosen trade
 * and not a forced one. It is not built here because it needs a second threshold to tune and no
 * measured program needs it: taking, for each runnable example and each turtle, the distance
 * between that same turtle's position at consecutive announcements, all 192 non-zero movements are
 * at least 0.2571255761402784 (the smallest, in `12-fractal.logo`) and **none** falls below
 * 0.001 — one bucket width, so none can be collapsed at all. The behaviour is pinned by a test so
 * it stays a decision rather than a surprise.
 *
 * This is presentation only: it is reached from this module alone (nothing in `state.ts`,
 * `world-state.ts`, `scene.ts`, `canvas.ts`, `svg.ts`, `png.ts`, `animation.ts` or `overlay.ts`
 * imports this file), so turtle state, the trace events, the retained scene and every exporter are
 * untouched. The region and the program's own `print xcor` therefore now differ deliberately —
 * `x 0` here, `1.421085472e-14` there — because each abbreviates for its own surface: `print`
 * renders the value in the language's canonical form into the output pane, this renders it into
 * the state description.
 */
const DESCRIBED_NUMBER_PRECISION = 3;

/**
 * Renders a number for a spoken description: rounded to {@link DESCRIBED_NUMBER_PRECISION} places,
 * then printed **without trailing zeros**, so a whole value stays whole (`100`, never `100.000`)
 * and `spec/rendering.md:193`'s worked example — `turtle at x 100 y 0 heading 90 degrees pen down
 * color black width 1` — remains byte-identical. That no-trailing-zeros rule is the same one the
 * language itself uses for `print` (`spec/execution-model.md:19`, implemented as
 * `@openlogo/runtime`'s `formatNumber`), reimplemented here rather than imported because
 * `@openlogo/turtle` must not depend on `@openlogo/runtime`.
 *
 * A magnitude at or above `1e21` renders in exponent form, because `toFixed` itself switches to
 * exponent notation there. That is reachable — `forward power 10 21` is diagnostic-free and
 * announces `y 1e+21` — and is left as the honest rendering of a genuinely huge number rather than
 * special-cased; a test pins it so the behaviour is recorded rather than assumed.
 */
function formatDescribedNumber(value: number): string {
  // `Number(...)` drops the trailing zeros `toFixed` pads with. It does **not** remove the sign of
  // the `-0` that rounding a tiny negative (`-1.47e-14`) produces — `Number("-0.000")` is `-0`;
  // interpolating that into the template is what renders it as `0`.
  return `${Number(value.toFixed(DESCRIBED_NUMBER_PRECISION))}`;
}

/**
 * Renders a heading for a spoken description. Identical to {@link formatDescribedNumber} except
 * that a heading which *rounds up* to a full turn is spoken as `0`, because
 * `spec/rendering.md:67` and `spec/execution-model.md:619` both normalize headings into `[0,360)`
 * — `heading 360 degrees` names a value the model never holds.
 *
 * This is reachable, not defensive: measured on the base of this change, `right 359.9999` and
 * `repeat 3 / right 119.99999999 / end repeat` are both diagnostic-free Turtle & Rendering
 * programs whose live region announced `heading 359.9999`/`heading 359.99999997000003`, each of
 * which `.toFixed(3)` turns into `"360.000"`. Rounding can only ever reach `360` and never exceed
 * it, since the value it rounds is already below `360`.
 */
function formatDescribedHeading(heading: number): string {
  const rounded = Number(heading.toFixed(DESCRIBED_NUMBER_PRECISION));
  return `${rounded === 360 ? 0 : rounded}`;
}

/**
 * Renders a pen width for a spoken description. Rounded like a coordinate, except that a positive
 * width may never be spoken as `0`: below the decimal threshold it falls back to
 * {@link DESCRIBED_NUMBER_PRECISION} *significant* digits, which cannot reach zero for a non-zero
 * input.
 *
 * The asymmetry with {@link formatDescribedNumber} is not a preference, it is the difference
 * between the two quantities. A width is **never legitimately zero** — `set_width 0` and
 * `set_width -1` both raise `ol-range` — so `width 0` is false for every width that can exist, and
 * `set_width 0.0001` is diagnostic-free. A coordinate *is* legitimately zero at the origin, and
 * collapsing the float residue that lands near it is the whole point of rounding it.
 *
 * Both halves are measured and diagnostic-free: `set_width 0.0001` reaches the fallback and stays
 * `0.0001`, while `set_width 1 / 3` (`0.3333333333333333`, sixteen digits) and
 * `set_width 0.1 + 0.2` (`0.30000000000000004`, seventeen) are spoken as `0.333` and `0.3`. The
 * fallback is only taken below the threshold, so an ordinary `set_width 1234` stays `1234` rather
 * than becoming the `1230` that three significant digits alone would give.
 */
function formatDescribedWidth(width: number): string {
  const rounded = Number(width.toFixed(DESCRIBED_NUMBER_PRECISION));
  return rounded === 0
    ? `${Number(width.toPrecision(DESCRIBED_NUMBER_PRECISION))}`
    : `${rounded}`;
}

/**
 * Reduces an already-sliced source instruction to a single line safe to speak (issue #778).
 *
 * `spec/rendering.md` asks the state description for the "current source instruction when available
 * from `source-span`". When that span covers a block, the sliced text is the **whole** block, and
 * putting it in the live region verbatim puts the block's body lines into the region text:
 * `spec/examples/09-sprites.logo` produced `current instruction ask :leader [ / set_shape
 * "turtle" / …`, spanning lines 10-17 of that file. Measured on the base of this change, 163 of
 * the 1423 region texts the 13 runnable examples produce contained a newline, and those slices had
 * 52 distinct head lines (distinct head lines of the multi-line instruction slices; the same 52
 * when counted by stepping instead of by announcement) — including every handler form,
 * `every 30 [`, `on_key "left" [`, `on_click [`. It also repeats: `repeat 4 / forward 80 /
 * right 90 / end repeat` announces the block head twice out of 18 announcements, and
 * `12-fractal.logo`'s `if :depth == 0` block 46 times.
 *
 * So the head line is spoken and the rest is replaced by a count: `ask :leader [, plus 7 more
 * lines`. The head line is the one the span begins at; the count records that something was left
 * out, which a bare first line would not. A single-line instruction is returned with only
 * surrounding whitespace trimmed, so every announcement the runnable examples produce for one is
 * unchanged.
 *
 * Two wording decisions, both `@turtle-engine` + `@learner-experience`:
 *
 * - The marker is words rather than an ellipsis or brackets. A screen reader's punctuation
 *   verbosity is a user setting we cannot exercise in CI, so this is a conservative choice rather
 *   than a measured one; what *is* measured is the shape of the string — it never contains a
 *   newline and reproduces no line but the head. The words are also chosen from outside the
 *   language: `plus`, `more` and `lines` are absent from `spec/built-in-names.json`, where `and`
 *   and `or` are present — a marker that is itself a built-in would sit against quoted learner
 *   source and blur the same boundary the comma exists to mark.
 * - The comma before `plus` is load-bearing, and its justification is a property of the string: it
 *   marks where the learner's own source text ends and this function's generated count begins.
 *   Without it, 11 of the 53 distinct block announcements the runnable examples produce match
 *   `/\d+\s+plus\s+\d+/` — `if :sides < 3 plus 2 more lines` runs the guard's trailing `3` straight
 *   into the count with nothing between them. With the comma, 0 of 53 match. A test asserts both
 *   directions on one such announcement.
 *
 * The count is of the span's remaining lines, blank ones included — it describes the source, not
 * the non-blank subset of it. An instruction whose head line is empty has nothing to name, so it
 * returns `""` and every caller — {@link describeState}, {@link describeCurrentStepCue}, and
 * studio's own clause — drops the label rather than emitting an empty one. Studio reaches that
 * only through a span pointing outside the current source; a direct caller of this package's
 * public API can pass such a string outright.
 */
export function summarizeSourceInstruction(instructionText: string): string {
  const firstNewlineIndex = instructionText.indexOf("\n");
  if (firstNewlineIndex === -1) {
    return instructionText.trim();
  }
  const headLine = instructionText.slice(0, firstNewlineIndex).trim();
  if (headLine === "") {
    return "";
  }
  const remainingLineCount = instructionText
    .slice(firstNewlineIndex + 1)
    .split("\n").length;
  const lineNoun = remainingLineCount === 1 ? "line" : "lines";
  return `${headLine}, plus ${remainingLineCount} more ${lineNoun}`;
}

/**
 * Optional context for {@link describeTurtleState} beyond the turtle state itself.
 */
export interface TurtleStateDescriptionOptions {
  /**
   * The source text of the instruction currently executing, when available. `@openlogo/turtle`
   * has no access to the original source string (only `source_span` positions travel with trace
   * events) — the caller (which does hold the source) slices the text using the `instruction`
   * event's `source_span` and passes it in here. Omit when no instruction is currently active
   * (e.g. before the first step, or after the stream is exhausted). A multi-line slice is reduced
   * to one speakable line by {@link summarizeSourceInstruction} (#778), so a caller passes the
   * slice exactly as cut and never has to shorten it first.
   */
  readonly currentInstruction?: string;
}

/**
 * The shared body of the non-visual state description: `subject` (what the sentence is about)
 * followed by position, heading, pen up/down, pen color and width, always; visibility and the
 * current source instruction are appended only when they add information (hidden, or an
 * instruction is available and has something to name).
 *
 * `x`, `y` and `heading` are rounded for speech ({@link DESCRIBED_NUMBER_PRECISION}); `width` goes
 * through {@link formatDescribedWidth}, which rounds the same way but can never speak a positive
 * width as `0`.
 */
function describeState(
  subject: string,
  state: TurtleState,
  options: TurtleStateDescriptionOptions,
): string {
  const [x, y] = state.position;
  const parts = [
    `${subject} at x ${formatDescribedNumber(x)} y ${formatDescribedNumber(y)} heading ${formatDescribedHeading(state.heading)} degrees`,
    `pen ${state.penDown ? "down" : "up"}`,
    `color ${state.color} width ${formatDescribedWidth(state.width)}`,
  ];
  if (!state.visible) {
    parts.push("hidden");
  }
  if (options.currentInstruction !== undefined) {
    const instruction = summarizeSourceInstruction(options.currentInstruction);
    if (instruction !== "") {
      parts.push(`instruction "${instruction}"`);
    }
  }
  return parts.join(" ");
}

/**
 * Builds the textual, non-visual turtle-state description required by
 * `spec/rendering.md#non-visual-state-descriptions`: position, heading, pen up/down, pen color
 * and width, always; visibility and the current source instruction are appended only when they
 * add information (hidden, or an instruction is available and has something to name) — this keeps
 * the common case byte-identical to the spec's own worked example. For a visible turtle at world
 * `(100, 0)`, heading `90`, pen down, color `"black"`, width `1`, and no known current instruction,
 * this produces exactly
 * `"turtle at x 100 y 0 heading 90 degrees pen down color black width 1"`,
 * matching `spec/rendering.md`'s example text verbatim.
 *
 * This describes **one** turtle, so it never names an identity: with a single turtle there is
 * nothing to disambiguate. A host driving several turtles calls
 * {@link describeTurtleWorldState} instead, which satisfies `spec/rendering.md:193`'s
 * "Implementations with multiple turtles MUST identify the active turtle or addressed turtle set".
 *
 * Deterministic: the same state (and options) always produce the same string, with no locale,
 * timing, or rendering dependency.
 */
export function describeTurtleState(
  state: TurtleState,
  options: TurtleStateDescriptionOptions = {},
): string {
  return describeState("turtle", state, options);
}

/**
 * The addressing clause plus the turtle state that follows it — or `null` when the world carries no
 * addressing worth announcing (or none this function can honestly speak for), in which case
 * {@link describeTurtleWorldState} falls back to the plain last-acted wording.
 */
interface AddressedSubject {
  readonly subject: string;
  readonly state: TurtleState;
}

/** `#1 #2 #3` — each addressed turtle under the identity an OpenLogo program prints for it. */
function listTurtleIds(ids: readonly TurtleId[]): string {
  return ids.map((id) => `#${id}`).join(" ");
}

/**
 * The addressing clause: which turtles a subsequent turtle command will drive.
 *
 * The empty set (`tell [ ]`) is called out in words rather than left silent. `spec/turtles-and-
 * sprites.md` defines no current turtle there, and the stream says so explicitly by reporting
 * `current_turtle_id: null` — deliberately leaving the display fallback to this consumer — so the
 * text states plainly that nothing is addressed instead of implying some turtle is about to be
 * driven.
 */
function addressingClause(ids: readonly TurtleId[]): string {
  if (ids.length === 0) {
    return "no addressed turtles";
  }
  const noun = ids.length === 1 ? "turtle" : "turtles";
  return `addressed ${noun} ${listTurtleIds(ids)}`;
}

/**
 * Builds the addressing half of the description from {@link TurtleWorldState.addressedTurtleIds},
 * which `reduceTurtleWorldState` folds from the stream's addressing snapshots (issue #770).
 *
 * The wording decision, and why (`@turtle-engine` + `@learner-experience`, issue #770):
 * `describeState` describes **one** turtle's position/heading/pen/color/width, and a *set* has no
 * single position. The sentence therefore answers the two questions separately —
 * `addressed turtles #1 #2. turtle #2 at x … y … heading … degrees pen … color … width …` — naming
 * the addressed set, then describing the turtle {@link TurtleWorldState.lastActedTurtleId} names:
 * the one the most recent per-turtle command drove, or the main turtle before any command has:
 *
 * - **Identify the set, don't enumerate it.** Repeating every addressed turtle's full attributes was
 *   rejected: this is a single `aria-live="polite"` region a screen reader re-reads *in full* on
 *   every change, so `tell [ :a :b :c :d ]` / `repeat 100 [ forward 1 ]` would replace one sentence
 *   per tick with four — a wall of speech burying the change a learner was listening for — while
 *   `spec/rendering.md:193` asks only that the addressed set be *identified*. Every turtle's avatar
 *   stays on the canvas, and the per-turtle states stay published on
 *   {@link TurtleWorldState.turtles} for a future inspect-each-turtle affordance.
 * - **Describe the turtle a command last drove.** The numbers are those of
 *   {@link TurtleWorldState.lastActedTurtleId}, because this region is also how a non-visual user
 *   follows *progress* (`spec/rendering.md:195`: the drawing surface must not be the only way to
 *   understand program progress). Describing the restored/current turtle instead would silently drop
 *   what just happened: after `ask :b [ set_color "blue" ]` the region would report `:a`, still
 *   black — never announcing that `:b` turned blue at all, since the block's restore lands in the
 *   same step as its last inner instruction (a step spans one `instruction` event to the next).
 *   Naming the set *and* describing the acting turtle reports both halves of that step honestly.
 * - **Name that turtle, don't label it.** The state clause keeps the plain `turtle #<id> at …`
 *   subject {@link describeTurtleState}/#749 already established, rather than a "last acted turtle
 *   #<id>" label. A label would be an *assertion*, and it would sometimes be a false one: at program
 *   start {@link TurtleWorldState.lastActedTurtleId} is seeded to the main turtle, which has not
 *   acted at all, so `tell :friend` in a fresh program would claim the main turtle "last acted";
 *   and after `tell [ :a :b ]` / `forward 10` **both** turtles moved, so singling one out as *the*
 *   turtle that acted under-reports the broadcast. Naming asserts nothing beyond "this is the turtle
 *   these numbers are about", which is exactly what is true — and it gives every announcement, with
 *   or without an addressing clause, one identical state-sentence shape for a listener to learn.
 * - **Only when they differ.** When the addressed set is exactly the turtle that last acted — every
 *   Turtle & Rendering program, and the common `tell :b` / `forward 10` — there is nothing to
 *   disambiguate, so this returns `null` and the text stays the plain wording #749 baselined:
 *   `turtle #<id> at …` once the world holds more than one turtle, and the unnamed `turtle at …`
 *   (byte for byte, including `spec/rendering.md`'s own worked example) while it holds one.
 *
 * {@link TurtleWorldState.currentTurtleId} is deliberately *not* read here: it is the `who` pointer
 * the stream reports, kept on the world for `why`/`debug` and any consumer that needs it, but the
 * subject of this sentence is the turtle a command last drove, and the set clause already covers
 * what is addressed.
 *
 * Returns `null` — falling back to that same plain wording — when the world carries no
 * addressing at all (only constructible by hand, since {@link TurtleWorldState} requires the
 * fields), when the last-acted turtle is not live (nothing honest to describe), or when the set
 * names a turtle the world does not hold, keeping the same "never announce an identity no live
 * turtle has" promise {@link describeTurtleWorldState} already made.
 */
function describeAddressedTurtles(
  world: TurtleWorldState,
): AddressedSubject | null {
  const ids = world.addressedTurtleIds;
  const state = world.turtles.get(world.lastActedTurtleId);
  if (ids === undefined || state === undefined) {
    return null;
  }
  if (ids.length === 1 && ids[0] === world.lastActedTurtleId) {
    return null;
  }
  if (!ids.every((id) => world.turtles.has(id))) {
    return null;
  }
  return {
    subject: `${addressingClause(ids)}. turtle #${world.lastActedTurtleId}`,
    state,
  };
}

/**
 * Builds the non-visual state description for a whole {@link TurtleWorldState}: the state of the
 * turtle {@link TurtleWorldState.lastActedTurtleId} names, named once the world holds more than one
 * live turtle (#749), and preceded by the addressed turtle set whenever that set is not exactly
 * `[lastActedTurtleId]` (#770) — two independent triggers, either of which can fire without the
 * other.
 *
 * `spec/rendering.md:193` makes that identification a MUST: "Implementations with multiple turtles
 * MUST identify the active turtle or addressed turtle set." A world holding several turtles is
 * therefore described as `turtle #<id> at x … y … heading … degrees pen … color … width …`, using
 * **exactly the identity the language itself prints** for a turtle value: `@openlogo/runtime`'s
 * `printedForm` renders a turtle as `turtle #<id>` from `@openlogo/core`'s `OLTurtle.id`
 * (`packages/runtime/src/evaluate.ts`), which is what a learner sees from `print who` or
 * `print :friend` (`spec/turtles-and-sprites.md:39`, `:85`). A screen-reader user therefore hears
 * the same name in the state region that the output pane gives them, and can match the two without
 * seeing the drawing. Any second numbering — a creation-order ordinal, say — would be off by one
 * against `print who` for every turtle, which defeats the purpose of the MUST.
 *
 * Once the addressed set is *not* simply the turtle that last acted — `tell [ :a :b ]`, an
 * `ask`/`each` block that has just restored, or `tell [ ]` — naming a single turtle cannot satisfy
 * that MUST, so the sentence leads with the set: `addressed turtles #1 #2. turtle #2 at x …`.
 * {@link describeAddressedTurtles} carries that decision and the reasoning behind it, including the
 * empty-set (`tell [ ]`) wording.
 *
 * For a world folded from a well-formed program stream, the unnamed, `spec/rendering.md`-verbatim
 * wording is produced under one exact condition: the
 * world holds **one** live turtle and its addressed set is that same turtle. That covers every
 * Turtle & Rendering program — which is the compatibility property this function is built around,
 * since adding multi-turtle identification must not perturb single-turtle announcements — and a
 * Sprites program only until it changes either half of that condition. `:friend = new_turtle` alone
 * changes it: a second live turtle appears while addressing stays put, so the text becomes the
 * named `turtle #0 at …` (#749's rule, unchanged here). `tell [ ]` changes the other half, and is
 * then said out loud; no Turtle & Rendering program can reach it, since `tell` is a Sprites
 * primitive.
 *
 * The totality fallbacks below reach that same unnamed wording from further states, which is
 * why the condition above is scoped to a folded world: none of them is reachable by running a
 * program. They are ordered so the text never announces an identity nothing in the world
 * corresponds to. Addressing that is **missing** (a hand-built world predating the fields) or
 * **unusable** (a set naming a turtle the world does not hold) is ignored in favor of the plain
 * last-acted wording — that turtle's **real** state, named `turtle #<id> at …` in a multi-turtle
 * world or unnamed in a one-turtle world. Only the third state, a `lastActedTurtleId` that itself
 * names no live turtle — leaving no honest subject at all — falls back to the program-start
 * defaults. All three are constructible only by hand, since every world this package folds carries
 * addressing and keeps both identities live.
 */
export function describeTurtleWorldState(
  world: TurtleWorldState,
  options: TurtleStateDescriptionOptions = {},
): string {
  const addressed = describeAddressedTurtles(world);
  if (addressed !== null) {
    return describeState(addressed.subject, addressed.state, options);
  }
  const state = world.turtles.get(world.lastActedTurtleId);
  if (state === undefined || world.turtles.size < 2) {
    return describeState("turtle", state ?? INITIAL_TURTLE_STATE, options);
  }
  return describeState(`turtle #${world.lastActedTurtleId}`, state, options);
}

/**
 * One kind of rendering state that `spec/rendering.md#color-independent-feedback` requires to
 * never be color-only: the currently executing step, a pen-up movement preview, which turtle
 * currently has focus, and where a runtime error occurred.
 */
export type ColorIndependentCueKind =
  "current-step" | "pen-up-preview" | "turtle-focus" | "error-location";

/**
 * A render-agnostic descriptor for one color-independent cue: plain text plus a small set of
 * non-color carriers (`spec/rendering.md`: "text, shape, position, line pattern, iconography, or
 * labels"). This is data, not a DOM node or a drawing call — a renderer or Studio's UI decides
 * how to actually present `icon`/`linePattern`/`position` (e.g. an outline, a badge, an ARIA
 * label); this module only guarantees the information is available without relying on color.
 */
export interface ColorIndependentCue {
  /** Which kind of otherwise-color-only state this cue describes. */
  readonly kind: ColorIndependentCueKind;
  /** A human-readable label — always present, so text alone is sufficient on its own. */
  readonly text: string;
  /** A short, color-independent glyph/label a renderer MAY show instead of (or with) color. */
  readonly icon: string;
  /** A line pattern a renderer MAY use in place of a color distinction, when relevant. */
  readonly linePattern?: "solid" | "dashed" | "dotted";
  /** The world position the cue refers to, when it refers to one. */
  readonly position?: Point;
}

/**
 * Describes the currently executing step without relying on a color highlight alone
 * (`spec/rendering.md`: "current-step highlighting … SHOULD also use text, shape, position, line
 * pattern, iconography, or labels"). `sourceInstruction` is the same already-sliced instruction
 * text {@link describeTurtleState} accepts, and is reduced the same way (#778). When the slice has
 * no head line to name, the text is the bare `current step` rather than a label followed by
 * nothing — `ColorIndependentCue.text` is documented as sufficient on its own, so an empty tail
 * would make it not so.
 */
export function describeCurrentStepCue(
  sourceInstruction: string,
): ColorIndependentCue {
  const instruction = summarizeSourceInstruction(sourceInstruction);
  return {
    kind: "current-step",
    text: instruction === "" ? "current step" : `current step: ${instruction}`,
    icon: "\u25B6", // "▶"
    linePattern: "solid",
  };
}

/**
 * Describes a pen-up movement preview without relying on color alone — a dashed line pattern
 * plus text distinguish a pen-up move from an ordinary drawn segment.
 */
export function describePenUpPreviewCue(): ColorIndependentCue {
  return {
    kind: "pen-up-preview",
    text: "pen up (not drawing)",
    icon: "\u270E", // "✎"
    linePattern: "dashed",
  };
}

/**
 * Describes which turtle currently has focus, by position and label rather than color alone
 * (`spec/rendering.md`: "Implementations with multiple turtles MUST identify the active turtle
 * or addressed turtle set" plus the color-independent-feedback requirement for "turtle focus").
 */
export function describeTurtleFocusCue(position: Point): ColorIndependentCue {
  const [x, y] = position;
  return {
    kind: "turtle-focus",
    text: `turtle focus at x ${formatDescribedNumber(x)} y ${formatDescribedNumber(y)}`,
    icon: "\u25CE", // "◎"
    position,
  };
}

/**
 * Describes a runtime error's location without relying on a red mark alone
 * (`spec/rendering.md`: "an error location can be shown with a message and source highlight, not
 * only a red mark"). `message` is the learner-facing diagnostic text (e.g. an `ol-*` message),
 * already produced by the diagnostics layer — this module only carries it alongside a
 * color-independent icon.
 */
export function describeErrorLocationCue(message: string): ColorIndependentCue {
  return {
    kind: "error-location",
    text: `error: ${message}`,
    icon: "\u26A0", // "⚠"
  };
}
