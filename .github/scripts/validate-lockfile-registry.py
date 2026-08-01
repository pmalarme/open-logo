#!/usr/bin/env python3
"""Guard package-lock.json against non-public npm registries.

Regression guard for issue #642: the committed lockfile resolved its dependencies against a
private Azure Artifacts mirror, so `npm ci` failed for every outside contributor and in every
agent sandbox. Third-party dependencies must always install from the **public** npm registry
(see docs/adr/0017-packages-are-private-not-published.md — packages flow *in* from npmjs and are
never published *out*).

Rules for every `"resolved"` value in the lockfile:
  * an `https://registry.npmjs.org/...` URL is allowed (the public registry);
  * a workspace-relative path (`packages/core`) or a `file:` reference is allowed — it never
    reaches a registry;
  * a `git+https:`/`git+ssh:`/`git:` source is allowed: it is a direct VCS dependency, not a
    private registry mirror (npm has to fetch it from the host it names);
  * anything else with a URI scheme is rejected as a non-public registry.

Stdlib only; parses the JSON rather than grepping, so a missing/mistyped pattern cannot silently
pass. Self-tested by test-validate-lockfile-registry.py, which runs in the same CI meta job.

Usage (CI): `python .github/scripts/validate-lockfile-registry.py [path-to-package-lock.json]`.
A missing lockfile is not an error — the guard runs from day one, before the toolchain lands.
"""

from __future__ import annotations

import json
import re
import sys

PUBLIC_REGISTRY_PREFIX = "https://registry.npmjs.org/"

# Direct VCS sources are fetched from the host they name, not from a registry mirror.
ALLOWED_VCS_SCHEMES = ("git+https://", "git+ssh://", "git+http://", "git://")

# `scheme://...` — the shape that reaches a remote host. Anything without it is a local path.
URI_SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*://")


def is_allowed(resolved: str) -> bool:
    """True when a `resolved` value is a public-registry, VCS, or local reference."""
    if resolved.startswith(PUBLIC_REGISTRY_PREFIX):
        return True
    if resolved.startswith(ALLOWED_VCS_SCHEMES):
        return True
    if resolved.startswith("file:"):
        return True
    # No scheme at all: a workspace-relative path such as "packages/core".
    return not URI_SCHEME.match(resolved)


def find_violations(document: object) -> list[str]:
    """Collect every `resolved` value in the lockfile that is not allowed."""
    violations: list[str] = []
    stack: list[object] = [document]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            resolved = node.get("resolved")
            if isinstance(resolved, str) and not is_allowed(resolved):
                violations.append(resolved)
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
    return sorted(set(violations))


def main(argv: list[str]) -> int:
    path = argv[1] if len(argv) > 1 else "package-lock.json"
    try:
        with open(path, encoding="utf-8") as handle:
            document = json.load(handle)
    except FileNotFoundError:
        print(f"{path} not found — nothing to check.")
        return 0
    except json.JSONDecodeError as error:
        print(f"{path} is not valid JSON: {error}", file=sys.stderr)
        return 1

    violations = find_violations(document)
    if violations:
        print(
            f'{path} has "resolved" URLs outside the public npm registry '
            f"({PUBLIC_REGISTRY_PREFIX}):",
            file=sys.stderr,
        )
        for violation in violations:
            print(f"  {violation}", file=sys.stderr)
        return 1

    print(f"{path}: every resolved dependency comes from the public npm registry.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
