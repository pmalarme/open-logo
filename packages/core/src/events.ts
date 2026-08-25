/**
 * The trace/event contract — the one normative, deterministic, headless event stream that
 * execution produces and that rendering, animation, stepping, `why`, `debug`, and playback
 * all consume. The envelope and `kind` registry are owned by `@openlogo/core`
 * ([`spec/execution-model.md`](../../../spec/execution-model.md)); `@openlogo/turtle`
 * reduces the stream into frames but does not own the registry. No timing or frames live in
 * the stream itself.
 */

import type { DiagnosticCode } from "./diagnostics.js";
import type { SourceSpan } from "./spans.js";
import type { OLValue } from "./values.js";

/** A 2-D point `[x, y]` in turtle space. */
export type Point = readonly [x: number, y: number];

/** Identity of a turtle/sprite; present only on turtle-specific events. */
export type TurtleId = number;

/**
 * The normative event `kind` registry from `spec/execution-model.md`. Start events precede
 * their effect; effect events follow the state change they describe. Kept as data
 * (`as const`) so {@link EventKind} derives from it.
 */
export const OL_EVENT_KINDS = [
  // Start events (emitted before their effect).
  "instruction",
  "procedure-enter",
  // Effect events (emitted immediately after the change they describe).
  "move",
  "turn",
  "pen-change",
  "width-change",
  "color-change",
  "background-change",
  "draw-segment",
  "fill",
  "stamp",
  "shape-change",
  "visibility-change",
  "clear",
  "overlay",
  "procedure-exit",
  "return",
  "print",
  "sound",
  "spawn-turtle",
  "primitive",
  "error",
  // Effect event scoped to the Educational profile (`spec/execution-model.md`
  // `#tutor-output-educational-profile`) — emitted only by hosts claiming that profile; a
  // Core-only implementation never produces or consumes it (see `TutorOutputPayload`).
  "tutor-output",
] as const;

/** One registered trace-event kind. */
export type EventKind = (typeof OL_EVENT_KINDS)[number];

/**
 * The registered kinds whose envelope **may carry** a `turtle_id`. `spec/execution-model.md:638` is
 * explicit: "`turtle-id` | Turtle identity; present only when the event is turtle-specific,
 * otherwise absent", and `spec/turtles-and-sprites.md:113` scopes the identity requirement to
 * explaining "which turtle moved or changed".
 *
 * These are the per-turtle effects — movement, turning, pen/width/color, the segment drawn,
 * `fill`/`stamp` (which "use the current turtle's pen and shape state",
 * `spec/turtles-and-sprites.md:109`), shape/visibility, and `spawn-turtle`
 * (`spec/turtles-and-sprites.md:34`, whose envelope names the turtle just created). Every other
 * kind describes the program or the scene rather than one turtle: `instruction`,
 * `procedure-enter`/`procedure-exit`/`return`, `print`, `sound`, `overlay`, `background-change`,
 * `error`, `tutor-output`, and `primitive` — including the addressing `primitive` events, whose
 * {@link AddressingSnapshot} describes a *set* of turtles.
 *
 * **`clear` is deliberately not here** (issue #738). It once was, on the reading that a
 * `clear_screen` homes the current turtle, but `spec/turtles-and-sprites.md:113` now settles the
 * question the other way: "A `clear` event describes the shared surface rather than any turtle, so
 * it is not turtle-specific and carries no turtle identity". `clear_screen` still homes — **every**
 * addressed turtle, not just one — and that homing is reported by the ordinary per-turtle `move`/
 * `turn` events, which carry the identities. One shared-surface event cannot name the N turtles a
 * single `clear_screen` homes, so naming one of them was exactly the order-dependence :113 removes.
 *
 * This is a **classification**, not a licence to label: it says which kinds are turtle-specific at
 * all, not that a producer may attribute any such event to whichever turtle is currently acting.
 * `spawn-turtle` carries its identity authoritatively at emission, so a producer synthesizing an
 * acting turtle's id must apply its own, narrower policy — see `@openlogo/runtime`'s
 * `ACTING_TURTLE_STAMPABLE_KINDS`.
 *
 * Lives here, next to the registry it partitions, so a producer stamping envelopes and a consumer
 * validating them share one list instead of each hard-coding its own (issue #764).
 */
export const OL_TURTLE_SPECIFIC_EVENT_KINDS: ReadonlySet<EventKind> = new Set([
  "move",
  "turn",
  "pen-change",
  "width-change",
  "color-change",
  "draw-segment",
  "fill",
  "stamp",
  "shape-change",
  "visibility-change",
  "spawn-turtle",
]);

/**
 * Type guard: may an event of this `kind` carry a `turtle_id` at all?
 * See {@link OL_TURTLE_SPECIFIC_EVENT_KINDS} — including why "may carry" is not the same question
 * as "may be labelled with the turtle that is currently acting".
 */
export function isTurtleSpecificEventKind(kind: string): boolean {
  return OL_TURTLE_SPECIFIC_EVENT_KINDS.has(kind as EventKind);
}

/** Payload for a `move` event. */
export interface MovePayload {
  readonly from: Point;
  readonly to: Point;
  readonly heading: number;
}

/** Payload for a `draw-segment` event. */
export interface DrawSegmentPayload {
  readonly from: Point;
  readonly to: Point;
  readonly color: string;
  readonly width: number;
}

/** Payload for a `turn` event (headings in degrees). */
export interface TurnPayload {
  readonly from: number;
  readonly to: number;
}

/** Payload for a `clear` event. */
export interface ClearPayload {
  readonly mode: "clear_screen" | "clean";
}

/** Whether the pen is up (not drawing) or down (drawing), per `spec/rendering.md`. */
export type PenState = "up" | "down";

/**
 * Payload for a `pen-change` event: the pen state before and after `pen_up`/`pen_down`
 * (`spec/rendering.md`'s "Line segments" section — a segment is drawn only while the pen is
 * down). Mirrors `turn`'s `{from, to}` shape.
 */
export interface PenChangePayload {
  readonly from: PenState;
  readonly to: PenState;
}

/**
 * Payload for a `width-change` event: the pen width before and after `set_width`, in the same
 * world units used for rendering (`spec/rendering.md`'s "Width" section). Mirrors `turn`'s
 * `{from, to}` shape.
 */
export interface WidthChangePayload {
  readonly from: number;
  readonly to: number;
}

/**
 * Payload for a `color-change` event: the pen color before and after `set_color`, each an
 * sRGB-normalizable color value as accepted by `set_color` (`spec/rendering.md`'s "Color"
 * section). Mirrors `turn`'s `{from, to}` shape.
 */
export interface ColorChangePayload {
  readonly from: string;
  readonly to: string;
}

/**
 * Payload for a `background-change` event: the new scene background color set by
 * `set_background` (`spec/rendering.md`'s "Background" section). The background is a scene
 * property, not turtle state, so there is no prior-value pairing to report here.
 */
export interface BackgroundChangePayload {
  readonly color: string;
}

/**
 * Payload for a `shape-change` event: the turtle avatar's shape word before and after
 * `set_shape` (`spec/rendering.md`'s "Turtle avatar and shapes" section). Mirrors `turn`'s
 * `{from, to}` shape.
 */
export interface ShapeChangePayload {
  readonly from: string;
  readonly to: string;
}

/**
 * Payload for a `visibility-change` event: the turtle avatar's visibility before and after
 * `show_turtle`/`hide_turtle` (`spec/rendering.md`'s "Turtle avatar and shapes" section).
 * Mirrors `turn`'s `{from, to}` shape.
 */
export interface VisibilityChangePayload {
  readonly from: boolean;
  readonly to: boolean;
}

/**
 * Payload for a `fill` event: the color used to fill the currently enclosed region of the
 * active turtle's drawn path (`spec/rendering.md`'s "Fill" section — the current pen color
 * unless a vendor extension exposes a separate fill color).
 */
export interface FillPayload {
  readonly color: string;
}

/**
 * Payload for a `stamp` event: the position, heading, shape word, and pen color of the turtle
 * avatar stamped into the retained scene (`spec/rendering.md`'s "Turtle avatar and shapes"
 * section, and its "Color" section: "a segment, fill, or stamp captures the color at the
 * moment its event is applied").
 */
export interface StampPayload {
  readonly position: Point;
  readonly heading: number;
  readonly shape: string;
  readonly color: string;
}

/**
 * Payload for a `print` event: the evaluated {@link OLValue}s, in argument order — one element
 * for the single-value `print value` form, two or more for the parenthesized variadic
 * `(print a b …)` form (`spec/commands.md:142-158`). Values are carried raw, not pre-formatted
 * text, matching every other effect payload here (e.g. `move`'s raw coordinates): a consumer
 * renders learner-visible text from them via the shared canonical-printed-form rule
 * (`@openlogo/runtime`'s `printedForm`, `spec/execution-model.md:19`).
 */
export interface PrintPayload {
  readonly values: readonly OLValue[];
}

/**
 * Payload for a `procedure-enter` event: the callee's canonical name and its evaluated argument
 * values, in parameter order — required arguments as supplied, trailing optional ones with their
 * default applied when the caller omitted them (`spec/execution-model.md:775-813`'s worked
 * recursive-call trace, e.g. `{name:"countdown", args:[2]}`).
 */
export interface ProcedureEnterPayload {
  readonly name: string;
  readonly args: readonly OLValue[];
}

/**
 * Payload for a `procedure-exit` event: the callee's canonical name and its result
 * (`spec/execution-model.md:775-813`, e.g. `{name:"countdown", result:0}`). `result` is `null`
 * when the invocation is a command — it finished (or `stop`ped) without reaching `return`
 * (`spec/execution-model.md:368-374`) — rather than `0`/`false`/an empty list, which are
 * themselves ordinary result values.
 */
export interface ProcedureExitPayload {
  readonly name: string;
  readonly result: OLValue | null;
}

/**
 * Payload for a `return` event: the value supplied to `return`/`output`/`op`
 * (`spec/execution-model.md:775-813`, e.g. `{value:0}`). Emitted only when a procedure actually
 * reaches a `return`; a command invocation (falls through, or `stop`s) never emits one.
 */
export interface ReturnPayload {
  readonly value: OLValue;
}

/**
 * Payload for an `overlay` event emitted by `grid` (Geometry profile,
 * `spec/geometry-module.md:268-278`): creates/refreshes the persistent grid guide-line overlay.
 * `spacing` is the world-unit distance between adjacent guide lines (default `20`,
 * `spec/geometry-module.md:272`/`spec/rendering.md:135`). Never changes turtle position,
 * heading, pen, color, or width, and survives `clean` (the overlay reducer has no `clear` case —
 * see `@openlogo/turtle`'s `overlay.ts`).
 */
export interface GridOverlayPayload {
  readonly overlay: "grid";
  readonly spacing: number;
}

/**
 * Payload for an `overlay` event emitted by `axes` (Geometry profile,
 * `spec/geometry-module.md:282-291`): creates/refreshes the persistent coordinate-axes overlay
 * (the line `y == 0` and the line `x == 0`, crossing at `home`). Carries no extra data — the
 * overlay is a fixed pair of lines through the origin. Never changes turtle state and survives
 * `clean`.
 */
export interface AxesOverlayPayload {
  readonly overlay: "axes";
}

/**
 * Payload for an `overlay` event emitted by `measure` (Geometry profile,
 * `spec/geometry-module.md:296-306`): creates/refreshes the educational annotation overlay,
 * snapshotting the turtle's `position`/`heading` at the moment of the call — one of the
 * spec-permitted annotation kinds ("current position, heading" — `spec/geometry-module.md:300`).
 * Returns no value and never changes turtle state; the overlay survives `clean` and is excluded
 * from exported drawing geometry unless an export format explicitly includes overlays.
 */
export interface MeasureOverlayPayload {
  readonly overlay: "measure";
  readonly position: Point;
  readonly heading: number;
}

/**
 * The `overlay` event's payload — a discriminated union on `overlay`, one arm per Geometry-profile
 * overlay primitive ({@link GridOverlayPayload}, {@link AxesOverlayPayload},
 * {@link MeasureOverlayPayload}). See `spec/geometry-module.md:268-308` and
 * `spec/rendering.md:131-141` ("Grid, axes, and measure overlays").
 */
export type OverlayPayload =
  GridOverlayPayload | AxesOverlayPayload | MeasureOverlayPayload;

/**
 * The four baseline meta-commands that emit `tutor-output` events
 * (`spec/educational-model.md#baseline-meta-commands`), owned by the Educational profile.
 */
export type TutorCommand = "explain" | "why" | "hint" | "debug";

/**
 * The four progressive stages of `hint` (`spec/educational-model.md#hint`). A `hint` invocation
 * for a given `target-source-span` starts at `"nudge"` and escalates one stage per repeated
 * request, up to `"last-resort"`, which then repeats rather than revealing a full solution
 * (`spec/execution-model.md:640-652`). Present in {@link TutorOutputPayload} only when
 * `command` is `"hint"`.
 */
export type TutorHintStage = "nudge" | "concept" | "partial" | "last-resort";

/**
 * Payload for a `tutor-output` event (Educational profile,
 * `spec/execution-model.md#tutor-output-educational-profile`): the deterministic, template-based
 * result of a baseline meta-command (`explain`/`why`/`hint`/`debug`), emitted immediately after
 * that command produces its result. A discriminated union on `command` — rather than one
 * interface with every field optional — so the type system itself enforces the spec's
 * command-dependent field rules instead of merely documenting them:
 *
 * - `segments` — a non-empty ordered list of learner-facing message segments (plain text), for
 *   every command. The spec's normative guardrail is that these, read together, MUST NOT
 *   constitute a complete, ready-to-run OpenLogo solution program.
 * - `stage` — required, and present ONLY on the `"hint"` arm (absent for
 *   `explain`/`why`/`debug`), one of the four progressive stages in {@link TutorHintStage}.
 * - `target_source_span` — the instruction/statement range/program the `segments` describe.
 *   REQUIRED on the `"hint"` arm (using the whole-program span when no narrower target is
 *   selected); optional on `explain`/`why`/`debug` — present whenever they describe a specific
 *   instruction, statement range, or diagnostic, and absent only when they concern the program
 *   as a whole with no diagnostic and no narrower selection in scope.
 * - `diagnostic_code` — optional, and present ONLY on the `"why"`/`"debug"` arms (never
 *   `"explain"`/`"hint"`): the `ol-*` code being explained, when the explanation concerns a
 *   diagnostic rather than turtle/variable state. Whenever `diagnostic_code` is present,
 *   `target_source_span` is REQUIRED alongside it (co-required — a `why`/`debug` payload can
 *   never carry a diagnostic code without also carrying that diagnostic's own source span). The
 *   type system enforces this presence pairing via separate diagnostic/non-diagnostic arms
 *   below; it does NOT enforce that the span's *value* equals the diagnostic's own span — that
 *   equality is a residual runtime invariant left to later slices.
 */
export interface TutorOutputSegments {
  readonly segments: readonly [string, ...string[]];
}

/** The `tutor-output` payload for `explain` — see {@link TutorOutputPayload}. */
export interface ExplainTutorOutputPayload extends TutorOutputSegments {
  readonly command: "explain";
  readonly target_source_span?: SourceSpan;
}

/**
 * The `why` payload arm describing an `ol-*` diagnostic: `diagnostic_code` and
 * `target_source_span` are co-required (see {@link TutorOutputPayload}).
 */
export interface WhyDiagnosticTutorOutputPayload extends TutorOutputSegments {
  readonly command: "why";
  readonly diagnostic_code: DiagnosticCode;
  readonly target_source_span: SourceSpan;
}

/**
 * The `why` payload arm describing turtle/variable state rather than a diagnostic: no
 * `diagnostic_code`; `target_source_span` is optional (see {@link TutorOutputPayload}).
 */
export interface WhyProgramTutorOutputPayload extends TutorOutputSegments {
  readonly command: "why";
  readonly diagnostic_code?: undefined;
  readonly target_source_span?: SourceSpan;
}

/** The `tutor-output` payload for `why` — see {@link TutorOutputPayload}. */
export type WhyTutorOutputPayload =
  WhyDiagnosticTutorOutputPayload | WhyProgramTutorOutputPayload;

/** The `tutor-output` payload for `hint` — see {@link TutorOutputPayload}. */
export interface HintTutorOutputPayload extends TutorOutputSegments {
  readonly command: "hint";
  readonly stage: TutorHintStage;
  readonly target_source_span: SourceSpan;
}

/**
 * The `debug` payload arm describing an `ol-*` diagnostic: `diagnostic_code` and
 * `target_source_span` are co-required (see {@link TutorOutputPayload}).
 */
export interface DebugDiagnosticTutorOutputPayload extends TutorOutputSegments {
  readonly command: "debug";
  readonly diagnostic_code: DiagnosticCode;
  readonly target_source_span: SourceSpan;
}

/**
 * The `debug` payload arm describing turtle/variable state rather than a diagnostic: no
 * `diagnostic_code`; `target_source_span` is optional (see {@link TutorOutputPayload}).
 */
export interface DebugProgramTutorOutputPayload extends TutorOutputSegments {
  readonly command: "debug";
  readonly diagnostic_code?: undefined;
  readonly target_source_span?: SourceSpan;
}

/** The `tutor-output` payload for `debug` — see {@link TutorOutputPayload}. */
export type DebugTutorOutputPayload =
  DebugDiagnosticTutorOutputPayload | DebugProgramTutorOutputPayload;

export type TutorOutputPayload =
  | ExplainTutorOutputPayload
  | WhyTutorOutputPayload
  | HintTutorOutputPayload
  | DebugTutorOutputPayload;

/**
 * The name of a primitive that emits a `primitive` event. `primitive` is the **generic catch-all**
 * effect kind — "the generic catch-all for a primitive without a more specific event"
 * (`spec/execution-model.md:703`) — so it is profile-neutral and the set of emitters is
 * **open-ended**: any current or future primitive that lacks a more specific event kind emits one.
 * This alias is therefore an open `string`, not a closed union, so a new emitter never requires
 * re-opening this contract. The current M5 emitters are the Interaction & Events forms
 * `wait`/`when`/`every`/`on_key`/`on_click` ("primitives without a more specific kind emit
 * `primitive`", `spec/interaction-events.md:105-106`; "wait emits a `primitive` event after the
 * pause completes … event registration forms emit `primitive` events after the handler is
 * registered", `spec/interaction-events.md:120-122`), but the type deliberately does not close over
 * them.
 */
export type PrimitiveName = string;

/**
 * The **addressed turtle set** in effect at the instant an addressing `primitive` event is emitted
 * (Sprites profile, `spec/turtles-and-sprites.md`'s "Addressing model"). This is what makes
 * `spec/rendering.md:193` — "Implementations with multiple turtles MUST identify the active turtle
 * or addressed turtle set" — reachable from the stream at all: every per-turtle effect event carries
 * only the *acting* turtle's `turtle_id`, which after an `ask`/`each` block restores
 * (`spec/turtles-and-sprites.md:58`) is neither the active turtle nor the addressed set (issue #766).
 *
 * - {@link addressed_turtle_ids} is the whole set a subsequent turtle command applies to, once for
 *   each (`spec/turtles-and-sprites.md:113`), deduplicated and in first-occurrence order — the same
 *   order `each` iterates. It MAY be empty (`tell [ ]` addresses no turtle).
 * - {@link current_turtle_id} is **the addressed set's first member** — the turtle `who` reports
 *   between commands (`spec/turtles-and-sprites.md:26`) — and `null` exactly when the set is empty.
 *   It is derived from the set itself rather than from any separate pointer, so the two halves of
 *   this payload can never contradict each other. `null` is deliberate: the spec defines no current
 *   turtle for an empty addressed set, so an implementation's own fallback there (this one keeps
 *   reporting the main turtle from `who`) MUST NOT become binding on every implementation through a
 *   conformance fixture — the event claims nothing instead, and a consumer picks its own display
 *   fallback.
 *
 * Note what `current_turtle_id` deliberately does **not** track: while a single command runs for a
 * multi-turtle addressed set, `who` momentarily reports each addressed turtle in turn, so that a
 * reporter evaluated in that command's argument sees the turtle actually running it
 * (`spec/turtles-and-sprites.md:113`). That transient pointer is *not* a change of the addressed set,
 * and the stream expresses it where it belongs — on each effect event's own `turtle_id` — rather than
 * by rewriting the addressed-set snapshot. An addressing event emitted inside that window (from an
 * addressing form reached through the argument) therefore reports the set's first member, which can
 * differ from what a `print who` on the next line inside that same argument would report.
 *
 * The snapshot is **absolute, not a delta**: a consumer folds it by assignment, never by inferring
 * which transition produced it, so entering an `ask` scope, narrowing per `each` iteration, and
 * restoring the previous set on the way out all reduce through one rule.
 *
 * The set lives in the payload rather than the envelope's `turtle_id`, which is normatively
 * "present only when the event is turtle-specific" (`spec/execution-model.md:638`): addressing
 * concerns a *set* of turtles, so an addressing event is never turtle-specific and MUST NOT be
 * stamped with one turtle's id.
 */
export interface AddressingSnapshot {
  readonly addressed_turtle_ids: readonly TurtleId[];
  readonly current_turtle_id: TurtleId | null;
}

/**
 * Payload for a `primitive` event: the canonical {@link PrimitiveName} of the primitive whose
 * effect the event records. `primitive` is the generic catch-all effect kind for a primitive
 * without a more specific event (`spec/execution-model.md:703`) — profile-neutral, not scoped to
 * any one profile — and `name` is what lets replay/debug tools tell those primitives apart. The
 * event is emitted after the effect it describes (after a `wait` pause completes, or after a handler
 * is registered), so no timing or tick data lives in the payload — the stream carries no timing or
 * frames.
 *
 * `addressing` is present only on the Sprites addressing primitives `tell`, `ask`, and `each`
 * (`spec/turtles-and-sprites.md:17`'s C3 rows), which change the addressed turtle set and have no
 * more specific event kind — exactly the case `primitive` exists for, and the same reading under
 * which the Interaction registration *forms* `when`/`every`/`on_key`/`on_click` emit `primitive`
 * ("primitives without a more specific kind emit `primitive`", `spec/interaction-events.md:105-106`).
 * It is deliberately NOT a new registered `kind`: the registry's `kind` values are normative and
 * closed (`spec/execution-model.md:689-694`, "One registered event kind"), the only sanctioned
 * un-registered kinds are vendor-namespaced extensions (`vendor_name.event_name`) which by
 * definition may not be recorded as portable conformance behavior, and reusing the catch-all keeps
 * every existing consumer correct with no change — an addressing-unaware renderer simply sees one
 * more inert `primitive` event. A non-addressing primitive carries `{ name }` alone, so no existing
 * emitter, fixture, or consumer of `primitive` changes, and a Core/Turtle & Rendering program — which
 * cannot run `tell`/`ask`/`each` at all — emits no addressing event and stays byte-identical.
 */
export interface PrimitivePayload {
  readonly name: PrimitiveName;
  readonly addressing?: AddressingSnapshot;
}

/**
 * Compile-time regression guard for the finding that `primitive` is the profile-neutral generic
 * catch-all (`spec/execution-model.md:703`): its `name` must stay an OPEN type so a future primitive
 * from any profile is representable without re-opening this contract. `AssertAssignable<T, V>`
 * requires `V extends T`, so this alias only compiles while the non-interaction literal
 * `"some_future_primitive"` is assignable to `PrimitiveName`; if `PrimitiveName` is ever narrowed
 * back to a closed union of interaction names, `tsc -b` fails here — a regression the name-only
 * runtime `.mjs` test cannot catch. Purely type-level: fully erased at emit, so it adds no runtime
 * code to cover.
 */
type AssertAssignable<T, V extends T> = V;
type _PrimitiveNameStaysOpen = AssertAssignable<
  PrimitiveName,
  "some_future_primitive"
>;

/**
 * Compile-time regression guard that {@link PrimitivePayload.addressing} stays OPTIONAL: the
 * addressing snapshot belongs to the three Sprites addressing primitives only, so a name-only
 * payload — what `wait` and every event-registration form emit — must remain assignable. If
 * `addressing` is ever made required, `tsc -b` fails here rather than silently forcing an
 * addressing-free primitive to invent an addressed set. Purely type-level: fully erased at emit.
 */
type _PrimitivePayloadAddressingStaysOptional = AssertAssignable<
  PrimitivePayload,
  { readonly name: "wait" }
>;

/**
 * Payload for a `sound` event emitted by `set_tempo` (Sound profile,
 * `spec/interaction-events.md:259-272`): the tempo, in beats per minute, that replay tools read to
 * interpret `note`, `play`, and `rest` beat durations. A positive number (`ol-range` otherwise);
 * the default before any `set_tempo`
 * is `120`.
 */
export interface SetTempoSoundPayload {
  readonly command: "set_tempo";
  readonly beats_per_minute: number;
}

/**
 * Payload for a `sound` event emitted by `note` (Sound profile,
 * `spec/interaction-events.md:274-291`): one pitched sound scheduled at the current tempo. `pitch`
 * is a scientific-pitch-notation word with lowercase canonical spelling (e.g. `"c4"`, `"fs4"`,
 * `"bb3"`); `duration` is a positive number of beats.
 */
export interface NoteSoundPayload {
  readonly command: "note";
  readonly pitch: string;
  readonly duration: number;
}

/**
 * One scheduled step of a `play` melody: a pitch word accepted by `note` or the word `"rest"`, and
 * its positive beat `duration` (`spec/interaction-events.md:293-307` — the melody list is
 * pitch/duration pairs in sequence). The runtime resolves the flat, even-length melody list into
 * these ordered pairs before emitting the event.
 */
export interface MelodyStep {
  readonly pitch: string;
  readonly duration: number;
}

/**
 * Payload for a `sound` event emitted by `play` (Sound profile,
 * `spec/interaction-events.md:293-307`): the resolved melody, as an ordered list of pitch/duration
 * {@link MelodyStep}s, scheduled in sequence at the current tempo.
 */
export interface PlaySoundPayload {
  readonly command: "play";
  readonly melody: readonly MelodyStep[];
}

/**
 * Payload for a `sound` event emitted by `beep` (Sound profile,
 * `spec/interaction-events.md:309-324`): one short, implementation-defined alert sound. It carries
 * no parameters — the spec pins none — so the discriminant `command` is the whole payload.
 */
export interface BeepSoundPayload {
  readonly command: "beep";
}

/**
 * Payload for a `sound` event emitted by `rest` (Sound profile,
 * `spec/interaction-events.md:326-341`): scheduled silence of `duration` beats at the current
 * tempo. `rest` emits a `sound` event "so replay tools can show the silent interval"
 * (`spec/interaction-events.md:335`). `duration` is a positive number.
 */
export interface RestSoundPayload {
  readonly command: "rest";
  readonly duration: number;
}

/**
 * The `sound` event's payload — a discriminated union on `command`, one arm per Sound-profile
 * primitive ({@link SetTempoSoundPayload}, {@link NoteSoundPayload}, {@link PlaySoundPayload},
 * {@link BeepSoundPayload}, {@link RestSoundPayload}). Sound commands emit a `sound` event after
 * the sound state has been scheduled (`spec/interaction-events.md:120-121`); the payload carries
 * only what each command deterministically schedules (pitch, duration in beats, tempo), never
 * wall-clock timing or audio frames — those are a rendering concern, not part of the deterministic,
 * headless stream.
 */
export type SoundPayload =
  | SetTempoSoundPayload
  | NoteSoundPayload
  | PlaySoundPayload
  | BeepSoundPayload
  | RestSoundPayload;

/**
 * Payload for a `spawn-turtle` event (Sprites profile,
 * `spec/turtles-and-sprites.md:32-34`): emitted immediately after `new_turtle` creates a fresh
 * turtle. The payload MUST identify the new turtle and SHOULD include its initial visible state for
 * renderers and debuggers, so it carries the {@link TurtleId} plus the full default turtle state a
 * new turtle starts with (`spec/turtles-and-sprites.md:32`): origin at the canvas center (`[0, 0]`),
 * heading `0` degrees (up), pen down, color `"black"`, width `1`, visible, and the implementation's
 * default turtle `shape`. The envelope's optional `turtle-id` addresses which turtle an event
 * concerns; this payload's `turtle_id` is the identity of the turtle being reported, so it is
 * present unconditionally.
 */
export interface SpawnTurtlePayload {
  readonly turtle_id: TurtleId;
  readonly position: Point;
  readonly heading: number;
  readonly pen: PenState;
  readonly color: string;
  readonly width: number;
  readonly visible: boolean;
  readonly shape: string;
}

/**
 * The trace-event envelope. `payload` is kind-specific typed data — the payload interfaces
 * above cover every Turtle & Rendering kind (`move`, `turn`, `pen-change`, `width-change`,
 * `color-change`, `background-change`, `draw-segment`, `fill`, `stamp`, `shape-change`,
 * `visibility-change`, `clear`), `print`/`procedure-enter`/`procedure-exit`/`return`,
 * `tutor-output` (Educational profile, via {@link TutorOutputPayload}), and `overlay` (Geometry
 * profile, via {@link OverlayPayload}); `sound` (Sound profile, via {@link SoundPayload}) and
 * `spawn-turtle` (Sprites profile, via {@link SpawnTurtlePayload}); and `primitive`, the
 * profile-neutral generic catch-all (`spec/execution-model.md:703`, via {@link PrimitivePayload} —
 * which also carries the Sprites {@link AddressingSnapshot} for `tell`/`ask`/`each`);
 * other kinds (e.g. `error`) refine their payload with their feature slice.
 */
export interface TraceEvent<P = unknown> {
  /** Monotonic sequence number, ordering the stream. */
  readonly seq: number;
  /** One registered event kind. */
  readonly kind: EventKind;
  /** The source range that caused the event. */
  readonly source_span: SourceSpan;
  /** Turtle identity; present only when the event is turtle-specific. */
  readonly turtle_id?: TurtleId;
  /** Kind-specific typed data. */
  readonly payload: P;
}

/** Type guard: is `value` a registered trace-event kind? */
export function isEventKind(value: string): value is EventKind {
  return (OL_EVENT_KINDS as readonly string[]).includes(value);
}
