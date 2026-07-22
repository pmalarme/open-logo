/**
 * `@openlogo/turtle` — turtle/sprite state, pen/heading/shape, rendering (Canvas/SVG/PNG),
 * animation, deterministic export, and accessibility. Consumes the trace/event stream from
 * `@openlogo/core`.
 *
 * ```ts
 * import * as OL from "@openlogo/turtle";
 * const state = OL.reduceTurtleEvents(events);
 * const scene = OL.reduceSceneEvents(events);
 * OL.paintTurtle(canvasContext, scene, state, { width: 400, height: 400 });
 * const svg = OL.exportTurtleSvg(scene, state, { width: 400, height: 400 });
 * const png = OL.exportTurtlePng(scene, state, { width: 400, height: 400 });
 * ```
 *
 * This slice publishes the deterministic turtle-**state** reducer (position, heading, pen,
 * color, width, shape, visibility), the deterministic retained-**scene** reducer (background,
 * segments, fills, stamps), the **Canvas live renderer**, deterministic **SVG** and **PNG**
 * export — all three renderers paint the same retained data through the same
 * dependency-injected `RenderTarget` abstraction and coordinate mapping — the
 * **animation/execution-control** cursor (`run`/`pause`/`step`/`speed`/`reset`+`replay`) that
 * paces consumption of that same event stream without ever re-deriving it, and **rendering
 * accessibility** primitives: a non-visual textual state description
 * (`describeTurtleState`), color-independent feedback descriptors for otherwise color-only
 * rendering state, and a `renderFrame` reduced-motion paint mode that instantly drains and
 * paints the retained scene without ever changing the event stream, final scene, turtle state,
 * or export output.
 */

export {
  INITIAL_TURTLE_STATE,
  reduceTurtleEvents,
  reduceTurtleState,
} from "./state.js";
export type { TurtleState } from "./state.js";

export {
  INITIAL_TURTLE_SCENE,
  reduceSceneEvents,
  reduceTurtleScene,
} from "./scene.js";
export type {
  SceneFill,
  SceneItem,
  SceneSegment,
  SceneStamp,
  TurtleScene,
} from "./scene.js";

export {
  paintOverlay,
  paintScene,
  paintTurtle,
  playWithMotionPreference,
  renderFrame,
  worldToTarget,
} from "./canvas.js";
export type {
  MotionPreference,
  MotionPreferencePlayer,
  ReducedMotionSource,
  RenderTarget,
  Viewport,
} from "./canvas.js";

export {
  INITIAL_OVERLAY_STATE,
  reduceOverlayEvents,
  reduceOverlayState,
} from "./overlay.js";
export type { GridOverlay, MeasureOverlay, OverlayState } from "./overlay.js";

export { exportTurtleSvg } from "./svg.js";
export type { SvgExportOptions } from "./svg.js";

export { exportTurtlePng } from "./png.js";
export type { PngExportOptions } from "./png.js";

export { IMMEDIATE_SCHEDULER, TurtleAnimationController } from "./animation.js";
export type {
  AnimationSnapshot,
  PlaybackStatus,
  Scheduler,
  TurtleAnimationOptions,
} from "./animation.js";

export {
  describeCurrentStepCue,
  describeErrorLocationCue,
  describePenUpPreviewCue,
  describeTurtleFocusCue,
  describeTurtleState,
} from "./a11y.js";
export type {
  ColorIndependentCue,
  ColorIndependentCueKind,
  TurtleStateDescriptionOptions,
} from "./a11y.js";
