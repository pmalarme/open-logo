#!/usr/bin/env python3
"""Self-test for the lockfile registry guard in validate-lockfile-registry.py.

Runs in the CI meta job alongside test-validate-meta.py and test-validate-commits.py. Stdlib
only; never touches the network. Exits non-zero on any unexpected result.

Locks the edge cases that made the original inline `grep` fragile: private mirrors must be
caught, a registry whose host merely *starts with* the public one must not be trusted, and
workspace/file/VCS references must not false-positive.
"""

import importlib.util
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "validate_lockfile_registry", os.path.join(HERE, "validate-lockfile-registry.py")
)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

# (label, resolved value, should_be_allowed)
CASES = [
    ("public registry", "https://registry.npmjs.org/biome/-/biome-2.0.0.tgz", True),
    ("workspace path", "packages/core", True),
    ("file reference", "file:../local-dep", True),
    ("git+https source", "git+https://github.com/owner/repo.git#abc123", True),
    ("git+ssh source", "git+ssh://git@github.com/owner/repo.git#abc123", True),
    ("git+http source", "git+http://git.example.com/owner/repo.git#abc123", True),
    ("git source", "git://github.com/owner/repo.git#abc123", True),
    ("azure artifacts mirror", "https://ms-feed-x.pkgs.visualstudio.com/_packaging/f/npm/registry/biome/-/biome-2.0.0.tgz", False),
    ("host suffix spoof", "https://registry.npmjs.org.evil.com/biome/-/biome-2.0.0.tgz", False),
    ("http public registry", "http://registry.npmjs.org/biome/-/biome-2.0.0.tgz", False),
    ("private http mirror", "http://10.0.0.1:4873/biome/-/biome-2.0.0.tgz", False),
    ("yarn registry", "https://registry.yarnpkg.com/biome/-/biome-2.0.0.tgz", False),
]

failures = []

for label, resolved, should_be_allowed in CASES:
    allowed = guard.is_allowed(resolved)
    if allowed is not should_be_allowed:
        failures.append(
            f"{label}: expected {'allowed' if should_be_allowed else 'rejected'}, "
            f"got {'allowed' if allowed else 'rejected'} for {resolved!r}"
        )

# find_violations walks the whole nested lockfile shape, not just the top level.
document = {
    "lockfileVersion": 3,
    "packages": {
        "": {"name": "openlogo"},
        "packages/core": {"resolved": "packages/core", "link": True},
        "node_modules/good": {"resolved": "https://registry.npmjs.org/good/-/good-1.0.0.tgz"},
        "node_modules/bad": {"resolved": "https://mirror.internal/bad/-/bad-1.0.0.tgz"},
        "node_modules/null-resolved": {"resolved": None},
    },
}
violations = guard.find_violations(document)
if violations != ["https://mirror.internal/bad/-/bad-1.0.0.tgz"]:
    failures.append(f"find_violations: unexpected result {violations!r}")

# Older lockfileVersion 1/2 trees nest under "dependencies" — the walk is key-agnostic.
legacy_document = {
    "lockfileVersion": 2,
    "dependencies": {
        "good": {
            "resolved": "https://registry.npmjs.org/good/-/good-1.0.0.tgz",
            "dependencies": {
                "nested-bad": {"resolved": "https://feed.internal/nested/-/nested-1.0.0.tgz"},
            },
        },
    },
}
legacy_violations = guard.find_violations(legacy_document)
if legacy_violations != ["https://feed.internal/nested/-/nested-1.0.0.tgz"]:
    failures.append(f"find_violations (legacy tree): unexpected result {legacy_violations!r}")

# A lockfile with no "resolved" keys at all must not trip the guard.
if guard.find_violations({"lockfileVersion": 3, "packages": {"": {"name": "openlogo"}}}) != []:
    failures.append("find_violations: a lockfile without resolved keys should be clean")

# A missing lockfile is not an error — the guard runs before the toolchain lands.
with tempfile.TemporaryDirectory() as directory:
    missing = os.path.join(directory, "package-lock.json")
    if guard.main(["validate-lockfile-registry.py", missing]) != 0:
        failures.append("main: a missing lockfile should exit 0")

    clean = os.path.join(directory, "clean.json")
    with open(clean, "w", encoding="utf-8") as handle:
        json.dump(
            {"packages": {"node_modules/a": {"resolved": "https://registry.npmjs.org/a/-/a-1.0.0.tgz"}}},
            handle,
        )
    if guard.main(["validate-lockfile-registry.py", clean]) != 0:
        failures.append("main: a clean lockfile should exit 0")

    dirty = os.path.join(directory, "dirty.json")
    with open(dirty, "w", encoding="utf-8") as handle:
        json.dump(
            {"packages": {"node_modules/a": {"resolved": "https://feed.internal/a/-/a-1.0.0.tgz"}}},
            handle,
        )
    if guard.main(["validate-lockfile-registry.py", dirty]) != 1:
        failures.append("main: a private-mirror lockfile should exit 1")

    invalid = os.path.join(directory, "invalid.json")
    with open(invalid, "w", encoding="utf-8") as handle:
        handle.write("{not json")
    if guard.main(["validate-lockfile-registry.py", invalid]) != 1:
        failures.append("main: an unparsable lockfile should exit 1")

if failures:
    print("Lockfile registry guard self-test FAILED:", file=sys.stderr)
    for failure in failures:
        print(f"  - {failure}", file=sys.stderr)
    sys.exit(1)

print(f"Lockfile registry guard self-test passed ({len(CASES)} cases + harness checks).")
