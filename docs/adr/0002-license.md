# 2. Open-source license

- Status: Accepted
- Date: 2024
- Deciders: OpenLogo maintainer (@pmalarme)

## Context

OpenLogo is intended to be genuinely open — usable by schools, learners, and implementers without
friction. The specification text already declares the MIT License (`spec/conformance.md`,
`spec/README.md`), and a `LICENSE` file is present at the repository root.

## Decision

The project — specification **and** implementation — is licensed under the **MIT License**. The
canonical text is in [`LICENSE`](../../LICENSE).

- Conforming implementations MAY license their own code however they wish, but references to the
  OpenLogo specification text MUST preserve its MIT notice.
- New source files SHOULD be contributable under MIT; contributions are accepted under the same
  license.

## Consequences

- Maximum permissive reuse in educational and commercial settings, consistent with the project's
  open-source ethos.
- One license across spec and code avoids ambiguity for downstream users and packagers.
