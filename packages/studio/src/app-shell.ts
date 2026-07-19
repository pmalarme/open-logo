/**
 * The app shell — the minimal, composable UI skeleton later panes attach to. ADR-0001 leaves the
 * studio shell technology (framework/bundler) as a deferred sub-decision, so this slice (#123)
 * models the shell as a plain, headless **region registry** rather than real DOM: KISS, no
 * premature framework commitment, and fully testable under `node:test` with no new dependency.
 *
 * Each named region ({@link APP_SHELL_REGIONS}) starts holding a `null` placeholder — an empty
 * content area. A later pane composes itself into the shell by calling {@link AppShell.mount}
 * with its own renderer/instance; the shell never inspects or reimplements that content. Every
 * region reads from the **same** {@link StudioStateStore} instance passed to
 * {@link createAppShell} — the shell does not hold or fork any state of its own.
 */

import type { StudioStateStore } from "./state-model.js";

/** The named composition points later panes mount into. */
export const APP_SHELL_REGIONS = [
  "editor",
  "turtle",
  "diagnostics",
  "lesson",
  "repl",
] as const;

/** One of the app shell's named regions. */
export type RegionName = (typeof APP_SHELL_REGIONS)[number];

/** A region's current content: `null` is the placeholder/empty content area. */
export interface RegionState {
  readonly region: RegionName;
  readonly content: unknown;
}

/** The composable app shell: a region registry over the single studio state model. */
export interface AppShell {
  /** The single studio state model instance every region/pane shares. */
  readonly state: StudioStateStore;
  /** Read a region's current content. */
  getRegion(region: RegionName): RegionState;
  /** Compose a pane into a region, replacing any previous content. */
  mount(region: RegionName, content: unknown): void;
  /** Remove a region's content, restoring its placeholder. */
  unmount(region: RegionName): void;
}

/** Construct the app shell over an existing {@link StudioStateStore} (never a copy of it). */
export function createAppShell(state: StudioStateStore): AppShell {
  const regions = new Map<RegionName, RegionState>(
    APP_SHELL_REGIONS.map((region) => [region, { region, content: null }]),
  );

  return {
    state,
    getRegion(region) {
      // Every RegionName is seeded above, so this is always present.
      return regions.get(region) as RegionState;
    },
    mount(region, content) {
      regions.set(region, { region, content });
    },
    unmount(region) {
      regions.set(region, { region, content: null });
    },
  };
}
