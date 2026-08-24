/**
 * Browser key → OpenLogo key word normalization (#952) for `on_key`
 * (`spec/interaction-events.md:194-198`).
 *
 * `on_key`'s entry says key words "are lowercase words such as `"space"`, `"enter"`, `"left"`,
 * `"right"`, `"up"`, `"down"`, or a single printable character word such as `"a"`", and then makes
 * two SHOULDs of it: an implementation "SHOULD document their supported key words and SHOULD
 * normalize physical keyboard input to those lowercase words **for accessibility**". This module is
 * both halves — the studio's documented key-word vocabulary, and the one tested place that maps a
 * `KeyboardEvent.key` onto it.
 *
 * ## Why normalization is an accessibility requirement, not a convenience
 * A learner writes `on_key "left"`. The browser reports `"ArrowLeft"`. Matching raw browser names
 * would make the program depend on a vocabulary no OpenLogo document defines, that differs across
 * platforms and input methods, and that a learner has no way to discover from the spec — so the
 * lowercase word IS the accessible surface, and the raw name never reaches an OpenLogo program.
 *
 * ## The vocabulary
 * - The four arrows, normalized to the spec's own examples: `left`, `right`, `up`, `down`. The
 *   pre-standard `"Left"`/`"Right"`/`"Up"`/`"Down"` spellings older engines report need no entry —
 *   lowercasing them already lands on the same word.
 * - The named non-printing keys a beginner program reaches for: `space`, `enter`, `escape`, `tab`,
 *   `backspace`, `delete`, `home`, `end`, `page_up`, `page_down`. The two-word names use OpenLogo's
 *   own underscored spelling (`pen_up`, `set_xy`), so the whole vocabulary reads like the language.
 * - Any **single printable character**, lowercased: `"A"` and `"a"` both become `"a"`, so
 *   `on_key "a"` fires whether or not Shift or Caps Lock is down. A learner who writes a lowercase
 *   word — the only spelling the spec offers — gets the key they named.
 * - Everything else the browser can report (function keys, media keys, IME keys) is lowercased
 *   verbatim, so `F1` is reachable as `"f1"` without this module having to enumerate every key a
 *   platform might grow.
 *
 * ## What is deliberately NOT a key press
 * A **modifier held on its own** ({@link MODIFIER_KEY_NAMES}) reports `null`, and so do the two
 * placeholder values a browser uses when it has no key to report (`"Unidentified"`, and `"Dead"`
 * for a dead key mid-composition). Tabbing to the canvas with Shift held, or typing an accented
 * character, must not spend a delivery on a key nobody pressed — see `run-controller.ts`'s
 * `deliverKey` for why every delivery costs a tick.
 */

import { parse, walk } from "@openlogo/parser";

/**
 * The browser key names ({@link https://www.w3.org/TR/uievents-key/ UI Events `key` values}) this
 * studio renames, and the OpenLogo key word each becomes. Only keys whose browser name is *not*
 * simply its own lowercase form need an entry here: everything else falls through to
 * {@link normalizeKeyWord}'s lowercasing.
 */
export const KEY_WORD_BY_BROWSER_KEY: Readonly<Record<string, string>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  " ": "space",
  Spacebar: "space",
  PageUp: "page_up",
  PageDown: "page_down",
  Del: "delete",
  Esc: "escape",
};

/**
 * The keys that are only ever *held with* another key, plus the two placeholders a browser reports
 * when it has no key to name. A `keydown` for one of these is not a key press an OpenLogo program
 * can act on, so {@link normalizeKeyWord} reports `null` rather than inventing a key word.
 */
export const MODIFIER_KEY_NAMES: readonly string[] = [
  "Alt",
  "AltGraph",
  "CapsLock",
  "Control",
  "Dead",
  "Fn",
  "FnLock",
  "Hyper",
  "Meta",
  "NumLock",
  "OS",
  "ScrollLock",
  "Shift",
  "Super",
  "Symbol",
  "SymbolLock",
  "Unidentified",
];

/**
 * The OpenLogo key word a browser's `KeyboardEvent.key` names, or `null` when the press is not one
 * an OpenLogo program can act on (a bare modifier, or a browser placeholder — see
 * {@link MODIFIER_KEY_NAMES}).
 *
 * The empty string is `null` too: it is not a key any program could name, and it would otherwise
 * become the word `""`, which no `on_key` can ever match.
 */
export function normalizeKeyWord(key: string): string | null {
  if (key === "" || MODIFIER_KEY_NAMES.includes(key)) {
    return null;
  }
  const renamed = KEY_WORD_BY_BROWSER_KEY[key];
  if (renamed !== undefined) {
    return renamed;
  }
  return key.toLowerCase();
}

/**
 * The key words a program's `on_key` statements name, or `null` when that set cannot be known
 * statically (#952, review round 2).
 *
 * ## Why this is read from the source rather than measured
 * A host must decide **synchronously, inside the `keydown` handler**, whether to suppress the
 * browser's own scrolling — and it must decide per key word, so that a program registering
 * `on_key "up"` stops `up` scrolling the page and nothing else. Neither fact is observable at
 * runtime: registration emits only the `primitive`'s *name* (`spec/interaction-events.md:120-122`),
 * never its key word, so `@openlogo/runtime` hands a host no way to ask "does anything listen for
 * `left`?".
 *
 * Two proxies were tried and both are unsound, which is why this exists:
 * - *"Did the replay's event stream grow?"* — a handler that raises **shortens** the stream
 *   (measured: an `on_key "up"` body referencing an undefined variable, followed by twenty prints,
 *   took the stream from 45 events to 5 with `ol-undefined-var`), so a handler that genuinely ran
 *   reported "nothing responded".
 * - *"Ask the controller after the replay settles"* — a Worker host settles a turn later, so the
 *   answer arrives after the `keydown` has already been allowed to scroll the page.
 *
 * Reading the declaration is exact for the literal form every OpenLogo document uses, needs no new
 * runtime API, and cannot be perturbed by what the program does at runtime.
 *
 * ## What `null` means
 * A key word that is not a literal — `on_key :chosen [ … ]` — is unknowable before the run, so the
 * whole set collapses to `null` rather than being silently under-reported. Callers treat `null` as
 * "suppress nothing", the safe direction: the page keeps scrolling, and no key is ever silently
 * swallowed from a learner who did not ask for it.
 *
 * This says nothing about whether a registration was *reached* — `if false [ on_key "up" … ] ]`
 * declares `up` and registers nothing. The caller pairs this with the run's own registration
 * evidence, so both must agree.
 */
export function collectDeclaredKeyWords(
  source: string,
): ReadonlySet<string> | null {
  const declared = new Set<string>();
  let unknown = false;
  walk(parse(source).ast, (node) => {
    if (node.kind !== "ProfileStatement" || node.keyword.name !== "on_key") {
      return;
    }
    const keyWord = node.args[0];
    if (keyWord?.kind === "WordLit") {
      declared.add(keyWord.value);
      return;
    }
    unknown = true;
  });
  return unknown ? null : declared;
}
