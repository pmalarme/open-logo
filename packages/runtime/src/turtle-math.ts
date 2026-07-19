/**
 * Shared turtle-heading math. Extracted (issue #203) from `execute-internal.ts`'s original
 * private `normalizeHeading`, which `turn`/`set_heading`/`seth` still use, because the `towards`
 * reporter (`evaluate.ts`) needs the identical [0,360) normalization and `evaluate.ts` cannot
 * import `execute-internal.ts` — `execute-internal.ts` already imports `evaluate.ts`, so the
 * reverse import would be a module cycle. A tiny standalone module is the simplest fix that keeps
 * one source of truth for the heading convention (DRY) without growing either module's import
 * graph in the wrong direction.
 */

/**
 * Normalize `degrees` to `[0,360)` (`spec/execution-model.md:538`). Guards against returning `-0`
 * (e.g. `normalizeHeading(-360)` would otherwise compute `-360 % 360 === -0`) so a heading of
 * exactly `0` always serializes/compares as plain `0`, not `-0`.
 */
export function normalizeHeading(degrees: number): number {
  const normalized = degrees % 360;
  if (normalized === 0) {
    return 0;
  }
  return normalized < 0 ? normalized + 360 : normalized;
}
