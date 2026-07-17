/**
 * `@openlogo/studio` — the OpenLogo browser learner IDE: editor/REPL, the Canvas turtle
 * view, Run/Stop/Reset/Step, the diagnostics UI, LSP-style tooling, and the lesson pane. It
 * composes the other `@openlogo/*` packages and owns presentation, never language logic.
 * This module is the package's only public entry point; import it as the OpenLogo (`OL`)
 * namespace:
 *
 * ```ts
 * import * as OL from "@openlogo/studio";
 * ```
 *
 * M0 skeleton: the real surface lands with this package's first vertical slice. The
 * `version` constant exists so the workspace builds and type-checks and so the
 * `@openlogo/*` tuple versions in lockstep.
 */
export const version = "0.1.0";
