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
