import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/core";

test("getHostMetadata exposes the exact spec version", () => {
  const metadata = OL.getHostMetadata();
  assert.equal(metadata.openlogo.version, "0.1.0");
  assert.equal(metadata.openlogo.version, OL.OPENLOGO_VERSION);
});

test("getHostMetadata reports the full M3+M4-delivered profile set", () => {
  const metadata = OL.getHostMetadata();
  assert.deepEqual(metadata.supportedProfiles, [
    "core-language",
    "turtle-rendering",
    "data",
    "geometry",
    "educational",
  ]);
  assert.ok(metadata.supportedProfiles.includes("data"));
  assert.ok(metadata.supportedProfiles.includes("geometry"));
  assert.ok(metadata.supportedProfiles.includes("educational"));
});

test("getHostMetadata exposes rendering targets because turtle-rendering is claimed", () => {
  const metadata = OL.getHostMetadata();
  assert.deepEqual(metadata.renderingTargets, ["canvas", "svg", "png"]);
});

test("getHostMetadata exposes an empty extension list", () => {
  const metadata = OL.getHostMetadata();
  assert.deepEqual(metadata.supportedExtensions, []);
});

test("getHostMetadata is immutable: top-level and nested objects are frozen", () => {
  const metadata = OL.getHostMetadata();
  assert.equal(Object.isFrozen(metadata), true);
  assert.equal(Object.isFrozen(metadata.openlogo), true);
  assert.equal(Object.isFrozen(metadata.supportedProfiles), true);
  assert.equal(Object.isFrozen(metadata.supportedExtensions), true);
  assert.equal(Object.isFrozen(metadata.renderingTargets), true);

  assert.throws(() => {
    "use strict";
    // @ts-expect-error -- intentionally mutating a readonly array to prove it is frozen.
    metadata.supportedProfiles.push("sprites");
  }, TypeError);
});

test("getHostMetadata returns the same reference on every call (not regenerated per call)", () => {
  const first = OL.getHostMetadata();
  const second = OL.getHostMetadata();
  assert.equal(first, second);
  assert.equal(first.openlogo, second.openlogo);
  assert.equal(first.supportedProfiles, second.supportedProfiles);
});

test("SUPPORTED_PROFILES, SUPPORTED_EXTENSIONS, and SUPPORTED_RENDERING_TARGETS are exported and match the metadata object", () => {
  const metadata = OL.getHostMetadata();
  assert.deepEqual([...OL.SUPPORTED_PROFILES], [...metadata.supportedProfiles]);
  assert.deepEqual(
    [...OL.SUPPORTED_EXTENSIONS],
    [...metadata.supportedExtensions],
  );
  assert.deepEqual(
    [...OL.SUPPORTED_RENDERING_TARGETS],
    [...metadata.renderingTargets],
  );
});
