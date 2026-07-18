/**
 * Grammar-version tracking (issue #121, team charter §12: "the highlighter and tooling track the
 * grammar version"). `@openlogo/parser`'s grammar — and everything derived from it, including
 * {@link highlight} and {@link semanticTokens} — is versioned in lockstep with
 * `@openlogo/core`'s `OPENLOGO_VERSION`. A grammar or reserved-word change that bumps one without
 * shipping the matching highlighting/tooling update in the same milestone is exactly the drift
 * this module exists to catch: {@link OL_GRAMMAR_VERSION} and `OPENLOGO_VERSION` are asserted
 * equal both at import time (so a stale build fails immediately, in CI or otherwise) and by
 * `grammar-version.test.mjs` (so the drift is provably detectable, not just asserted never to
 * happen).
 */

import { OPENLOGO_VERSION } from "@openlogo/core";

/**
 * The grammar/highlighter version this package's `parse`/`highlight`/`semanticTokens` implement.
 * Bump this in the same PR that bumps `@openlogo/core`'s `OPENLOGO_VERSION` for a grammar or
 * reserved-word change — never independently.
 */
export const OL_GRAMMAR_VERSION = "0.1.0";

/**
 * Throws when `grammarVersion` and `coreVersion` disagree. Defaults to the real
 * `OL_GRAMMAR_VERSION`/`OPENLOGO_VERSION` pair, so calling it with no arguments is the
 * production check; tests pass explicit, deliberately mismatched strings to prove the drift is
 * detectable.
 */
export function assertGrammarVersionInSync(
  grammarVersion: string = OL_GRAMMAR_VERSION,
  coreVersion: string = OPENLOGO_VERSION,
): void {
  if (grammarVersion !== coreVersion) {
    throw new Error(
      `@openlogo/parser's grammar version "${grammarVersion}" is out of sync with ` +
        `@openlogo/core's OPENLOGO_VERSION "${coreVersion}" — a grammar/reserved-word change ` +
        "must ship its highlighting/tooling update in the same milestone " +
        "(team charter §12; spec/tooling.md).",
    );
  }
}

// Fail fast at import time: any consumer that imports this package with a desynced version pair
// sees the failure immediately, not only when a test happens to run.
assertGrammarVersionInSync();
