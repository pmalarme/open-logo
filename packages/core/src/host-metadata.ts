/**
 * Feature-detection / conformance-claim metadata, per
 * [`spec/conformance.md`](../../../spec/conformance.md)'s "Conformance claims" (~L22-30) and
 * "Extensions and feature detection" (~L266-291) sections. Hosts (studio, CLIs, editor
 * integrations, other tools) query {@link getHostMetadata} to learn, at runtime, the exact
 * spec version this build targets, which profiles it currently and correctly supports, which
 * vendor-namespaced extensions it adds, and which rendering targets it exposes when Turtle &
 * Rendering is claimed. There is no Core language primitive for this (spec/conformance.md:288-291
 * — feature detection is a host API, never a required Core program construct).
 *
 * Profile identifiers match the ids already used across the toolchain (`scripts/harness/index.mjs`
 * `PROFILE_DEPS`, `scripts/examples-gate.mjs` `IMPLEMENTED_PROFILES`): `core-language`,
 * `turtle-rendering`, `geometry`, `data`, `heritage`, `sprites`, `interaction-events`, `sound`,
 * `modules`, `localization`, `educational`, `tutor-ai`.
 *
 * {@link SUPPORTED_PROFILES} MUST list only the profiles this implementation currently and
 * correctly supports (issue #406, part of the M4 audit #396, finding F9). `data` and `geometry`
 * were added once their M4 correctness gaps (issue #397 and the sibling F2-F6 remediation
 * slices — list constructor, record destructuring, semantic-checker registration, runtime arity
 * guards, and the struct/Geometry primitive collision) merged and conformance went green.
 * `educational` was added once M3 shipped it: the runtime implements and emits Educational
 * `tutor-output` events, `explain`/`why`/`hint`/`debug` are gated behind the `educational`
 * profile in the checker, and the Educational conformance fixtures are green in the full DAG
 * (issue #425, found by the M3 milestone-completion re-gate audit #419).
 * `sound` was added once M5 shipped it: the runtime implements and emits `sound` trace events for
 * `set_tempo`/`note`/`play`/`beep`/`rest`, those commands are gated behind the `sound` profile in
 * the checker, and the Sound conformance fixtures — including the muted-environment guarantee
 * (events emitted even when audio is unavailable) and the profile-active/Core-only `"check": true`
 * pair — are green in the full DAG (issue #693, the Sound epic #662 terminal slice under saga #572).
 * `sprites` was added once M5 shipped it: the runtime implements the whole C3 Sprites surface
 * (`new_turtle`/`tell`/`ask`/`each`/`turtles`/`who`), every per-turtle effect event emitted under
 * explicit addressing (`tell`/`ask`/`each`) carries the acting turtle's `turtle_id` — the implicit
 * main turtle's effects stay un-stamped, exactly as the pre-Sprites Turtle & Rendering fixtures
 * expect — the forms and reporters are gated behind the `sprites` profile in the checker both
 * ways, and the Sprites conformance fixtures are green in the full DAG — including the profile
 * reserved-word rule, the `ol-type` negatives for `tell`/`ask`, per-turtle pen/color/width/position
 * state, and the spec's own `ask turtles [ each [ … ] ]` composition (issue #679, the Sprites epic
 * #660 terminal slice under saga #572).
 * `heritage` was added once M5 shipped it: the Heritage spellings (`make`/`to`/`output`/`op`, the
 * ten command aliases `fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`st`/`ht`/`cs`/`pr`, the three reporter aliases
 * `bf`/`bl`/`se`, and `value of … for key`) are gated behind the `heritage` profile in the checker,
 * they lower to the identical Core semantics — byte-identical event streams and diagnostics whose
 * `code` **and** structured params are canonical (never the surface spelling: the H4 arity
 * `params.callable`, H5 `params.operation`, and the return-family `params.keyword` all canonicalize
 * across parse, semantic, and runtime stages — issues #734/#670 and #737/#741), and the Heritage
 * conformance fixtures — statement forms, command aliases, reporter aliases, and `value of … for
 * key`, in both profile-active and Core-rejected shapes plus execution proofs — are green in the
 * full DAG (issue #672, the Heritage epic #659 terminal slice under saga #572). Heritage requires
 * Data, which is already claimed.
 * `interaction-events` was added once M5 shipped it: the runtime implements the whole C3 Interaction
 * surface (`input`/`wait`/`when`/`every`/`on_key`/`on_click`), each with execution-level conformance
 * proof rather than name recognition alone; registration forms emit `primitive` events after the
 * handler is registered, a delivered handler emits the block-head `instruction` event, and `wait`
 * emits its `primitive` after the pause completes; the normative same-tick delivery order
 * `when` -> `on_key` -> `on_click` -> due `every`, each in registration order
 * (`spec/interaction-events.md:136-141`), is pinned both across kinds and — as of this slice — WITHIN
 * each of the four kinds at a shared drain point; the six forms are gated behind the
 * `interaction-events` profile in the checker both ways; and the Interaction conformance fixtures are
 * green in the full DAG, including the `ol-type`/`ol-range` negatives for `every`/`wait`, the
 * labelled-`end` and stray-argument parse errors, and the profile primitive reserved-word rule
 * (issue #688, the Interaction & Events epic #661 terminal slice under saga #572 — the saga's last
 * profile claim). Interaction & Events depends only on Core Language, which is already claimed.
 * Claiming a profile before it is conformant would be a false conformance claim — exactly the
 * failure mode the M4 audit exists to catch — so any future profile addition here must follow
 * the same rule: land the profile's conformance fixes first, then claim it.
 */

import { OPENLOGO_VERSION } from "./version.js";

/** A supported OpenLogo profile identifier, using the ids established across the toolchain. */
export type SupportedProfile = (typeof SUPPORTED_PROFILES)[number];

/** A supported turtle rendering target identifier. */
export type RenderingTarget = (typeof SUPPORTED_RENDERING_TARGETS)[number];

/**
 * Profiles this implementation currently and correctly supports. Only add a profile here once its
 * conformance fixes have merged and gone green — see the module doc comment above.
 */
export const SUPPORTED_PROFILES = [
  "core-language",
  "turtle-rendering",
  "data",
  "geometry",
  "educational",
  "sound",
  "sprites",
  "heritage",
  "interaction-events",
] as const;

/**
 * Vendor-namespaced extension feature names this implementation adds
 * (`spec/conformance.md:266-279`, `<vendor>.<feature>`). Empty: this implementation adds no
 * extensions yet.
 */
export const SUPPORTED_EXTENSIONS = [] as const;

/**
 * Rendering targets exposed by `@openlogo/turtle` (Canvas live rendering, deterministic SVG and
 * PNG export), reported because `turtle-rendering` is claimed
 * (`spec/conformance.md:281-286`, "rendering targets when Turtle & Rendering is claimed").
 */
export const SUPPORTED_RENDERING_TARGETS = ["canvas", "svg", "png"] as const;

/** The feature-detection metadata shape a host queries, per `spec/conformance.md:281-286`. */
export interface HostMetadata {
  readonly openlogo: {
    readonly version: string;
  };
  readonly supportedProfiles: readonly SupportedProfile[];
  readonly supportedExtensions: readonly string[];
  readonly renderingTargets: readonly RenderingTarget[];
}

/**
 * A single, deeply frozen metadata object built once at module load. Every call to
 * {@link getHostMetadata} returns this same reference, so repeated queries in the same process
 * are referentially identical, never regenerated or mutable per call.
 */
const HOST_METADATA: HostMetadata = Object.freeze({
  openlogo: Object.freeze({ version: OPENLOGO_VERSION }),
  supportedProfiles: Object.freeze([...SUPPORTED_PROFILES]),
  supportedExtensions: Object.freeze([...SUPPORTED_EXTENSIONS]),
  renderingTargets: Object.freeze([...SUPPORTED_RENDERING_TARGETS]),
});

/**
 * Returns the implementation's feature-detection metadata: the exact spec version, the list of
 * currently and correctly supported profile names, the list of vendor-namespaced extension
 * feature names, and the list of supported rendering targets. The returned object (and its
 * nested arrays/objects) is frozen and is the same reference on every call.
 */
export function getHostMetadata(): HostMetadata {
  return HOST_METADATA;
}
