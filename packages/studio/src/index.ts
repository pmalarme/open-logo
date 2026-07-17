/**
 * `@openlogo/studio` — the browser learner IDE: editor/REPL, Canvas turtle view, run/stop/step,
 * diagnostics UI, tooling/LSP, the lesson pane, and persistence. Composes every other package;
 * it never reimplements them. Depends on core, parser, runtime, turtle, and edu.
 *
 * The studio state model and panes land in later slices; this is the M0 skeleton.
 */

/** Marker export so the M0 skeleton is a real ES module; replaced by real exports later. */
export const STUDIO_PACKAGE = "@openlogo/studio";
