/**
 * The OpenLogo specification version this implementation targets, per
 * `spec/conformance.md#conformance-claims` ("the supported OpenLogo specification version, exactly `0.1.0` for
 * this draft") and `spec/conformance.md#feature-to-profile-table` (`openlogo.version`). Kept in its own module so
 * both the public entry point and {@link ./host-metadata.js} can depend on it without a
 * circular import.
 */
export const OPENLOGO_VERSION = "0.1.0";
