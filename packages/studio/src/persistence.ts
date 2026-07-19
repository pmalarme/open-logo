/**
 * Persistence (#128) — the smallest mechanism that satisfies "a learner's document text survives
 * a reload," bound exclusively to the shared {@link StudioStateStore} from #123. No duplicate copy
 * of `source` is kept here: {@link attachPersistence} only reads via `state.getState()` and writes
 * back via `state.setSource`/`state.setNotice`.
 *
 * ## Design
 * - A {@link StorageAdapter} is a pluggable `save`/`load`/`clear` seam, matching the same
 *   headless-first approach as #123/#124 (ADR-0001 defers the studio's DOM/framework choice).
 *   {@link createInMemoryStorageAdapter} is the fully `node:test`-able default. A real browser
 *   adapter (backed by `window.localStorage`) plugs in later by implementing the same three
 *   synchronous methods — `save`/`load` must not throw for normal values, but MAY throw (e.g. on
 *   quota-exceeded or storage-disabled errors); {@link attachPersistence} always catches and
 *   degrades gracefully rather than propagating.
 * - {@link attachPersistence} restores `source` from the adapter once at creation time, then
 *   subscribes to the store and re-saves `source` whenever it changes (skipping saves when the
 *   text is unchanged, so unrelated state changes — selection, run status, diagnostics — never
 *   trigger a redundant write).
 * - On any adapter failure (restore OR save OR clear), the store's `notice` is set to a visible,
 *   non-fatal warning via {@link StudioStateStore.setNotice} — the learner keeps working, nothing
 *   crashes, and no failure is silently swallowed. A later pane can render `state.notice`. Once a
 *   subsequent restore/save/clear succeeds, the warning this module set is cleared automatically —
 *   tracked by the exact {@link Notice} object reference this module last set, so a notice some
 *   other pane sets in between (for an unrelated reason) is never clobbered.
 */

import type { Notice, StudioStateStore } from "./state-model.js";

/**
 * A pluggable storage backend. All three operations are synchronous to match the browser
 * `localStorage` API this seam is designed to be backed by later; any of them MAY throw (quota
 * exceeded, storage disabled, adapter-specific failure) and {@link attachPersistence} handles
 * that gracefully.
 */
export interface StorageAdapter {
  /** Persist `value` under `key`. */
  save(key: string, value: string): void;
  /** Read the value previously saved under `key`, or `null` if nothing is stored. */
  load(key: string): string | null;
  /** Remove any value stored under `key`. */
  clear(key: string): void;
}

/** The default storage key used when {@link PersistenceOptions.key} is not provided. */
export const DEFAULT_PERSISTENCE_KEY = "openlogo.studio.source";

/**
 * An in-memory {@link StorageAdapter} — the default, fully `node:test`-able backend. Values do
 * not survive a real process/page reload; a browser adapter backed by `localStorage` implements
 * the same interface for that.
 */
export function createInMemoryStorageAdapter(): StorageAdapter {
  const backing = new Map<string, string>();

  return {
    save(key, value) {
      backing.set(key, value);
    },
    load(key) {
      return backing.get(key) ?? null;
    },
    clear(key) {
      backing.delete(key);
    },
  };
}

/** Options for {@link attachPersistence}. */
export interface PersistenceOptions {
  /** The storage backend to use. Defaults to a fresh {@link createInMemoryStorageAdapter}. */
  readonly adapter?: StorageAdapter;
  /** The key under which the document text is stored. Defaults to {@link DEFAULT_PERSISTENCE_KEY}. */
  readonly key?: string;
}

/** The handle returned by {@link attachPersistence}. */
export interface Persistence {
  /** The storage backend in use. */
  readonly adapter: StorageAdapter;
  /** The key the document text is stored under. */
  readonly key: string;
  /** Stop persisting further changes (unsubscribes from the store). */
  dispose(): void;
  /** Remove the persisted document text via the adapter, degrading gracefully on failure. */
  clearPersisted(): void;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Wire save-on-change and restore-on-init persistence of `source` into the shared
 * {@link StudioStateStore}. Reads and writes go straight through the store — `source` is never
 * forked into a private buffer here.
 */
export function attachPersistence(
  state: StudioStateStore,
  options?: PersistenceOptions,
): Persistence {
  const adapter = options?.adapter ?? createInMemoryStorageAdapter();
  const key = options?.key ?? DEFAULT_PERSISTENCE_KEY;

  // Tracks the exact Notice object *this module* last set (by reference), so a later success can
  // clear it without ever clobbering a notice some other pane may have set for an unrelated
  // reason in the meantime — a plain boolean flag can't tell those two cases apart.
  let ownNotice: Notice | null = null;
  function reportFailure(message: string): void {
    const notice: Notice = { level: "warning", message };
    state.setNotice(notice);
    ownNotice = notice;
  }
  function clearOwnNotice(): void {
    if (ownNotice !== null && state.getState().notice === ownNotice) {
      state.setNotice(null);
    }
    ownNotice = null;
  }

  try {
    const restored = adapter.load(key);
    if (restored !== null) {
      state.setSource(restored);
    }
    clearOwnNotice();
  } catch (error) {
    reportFailure(`Could not restore your saved work: ${describeError(error)}`);
  }

  // `undefined` is a sentinel meaning "not known to match storage" — distinct from any real
  // string `source`, including "" — so the first change (and any change right after
  // `clearPersisted()`) always attempts a save, never suppressed by the equality skip below.
  let lastSaved: string | undefined = state.getState().source;
  const unsubscribe = state.subscribe((next) => {
    if (next.source === lastSaved) {
      return;
    }
    lastSaved = next.source;
    try {
      adapter.save(key, next.source);
      clearOwnNotice();
    } catch (error) {
      reportFailure(`Your work could not be saved: ${describeError(error)}`);
    }
  });

  return {
    adapter,
    key,
    dispose: unsubscribe,
    clearPersisted() {
      try {
        adapter.clear(key);
        // Storage no longer matches lastSaved; force the next change (even to an unchanged
        // `source`) to attempt a fresh save instead of being skipped as a no-op.
        lastSaved = undefined;
        clearOwnNotice();
      } catch (error) {
        reportFailure(
          `Could not clear your saved work: ${describeError(error)}`,
        );
      }
    },
  };
}
