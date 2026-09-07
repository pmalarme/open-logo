/**
 * The OpenLogo specification version this implementation targets, per
 * `spec/conformance.md:27` ("the supported OpenLogo specification version, exactly `0.2.0` for
 * this draft") and `spec/conformance.md:330` (`openlogo.version`). Kept in its own module so
 * both the public entry point and {@link ./host-metadata.js} can depend on it without a
 * circular import.
 *
 * This is the **contract** version, not the package version — the two are independent lines that
 * currently happen to read the same string. It moves in the PR that changes the normative
 * contract, never at release time; `docs/delivery.md` §1 states the rule and
 * `docs/adr/0033-contract-version-moves-with-the-contract.md` records why.
 */
export const OPENLOGO_VERSION = "0.2.0";
