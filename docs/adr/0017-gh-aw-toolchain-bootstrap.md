# 17. gh-aw toolchain bootstrap: pinned version, direct release download, generated files committed as generated

- Status: Accepted
- Date: 2026-08-01
- Deciders: OpenLogo maintainer (@pmalarme)
- Related: extends [ADR-0005](0005-toolchain.md) (how this repository pins and runs its tooling);
  mechanics in [`../../AGENTS.md`](../../AGENTS.md) §"gh-aw bootstrap" and
  [`../../.github/instructions/workflows.instructions.md`](../../.github/instructions/workflows.instructions.md)

## Context

The repository adopts [GitHub Agentic Workflows (`gh-aw`)](https://github.com/github/gh-aw): a CLI
that compiles agentic-workflow markdown into lock files, and that also serves an MCP server the
Copilot agents consume. Three problems had to be solved before it could be used consistently by
contributors, cloud agents, and CI.

- **The documented install methods do not work where we need them most.** `gh aw` is normally
  installed with `gh extension install github/gh-aw` or `go install`. Both are blocked in restricted
  agent sandboxes (including the GitHub Copilot coding-agent environment), while the release CDN
  behind the GitHub releases redirect — `release-assets.githubusercontent.com` — is reachable. A
  bootstrap that only works for humans means agents silently skip the tool, or worse, hand-edit
  generated lock files.
- **A tool version that lives in more than one place drifts.** The `gh aw init` output hardcoded the
  version twice inside the generated setup workflow. A compile run with a mismatched binary produces
  lock files that nobody can reproduce.
- **`gh aw init` generates repository files whose names violate our conventions.** It writes
  `.github/agents/agentic-workflows.md` (we use `*.agent.md`), `.github/skills/agentic-workflows/`
  (we use `skills/<owner>/<name>/`), and `.vscode/settings.json`. Renaming them to fit the house
  style would make every future `gh aw init` re-run produce a spurious diff — and invite a future
  contributor to "fix" it back.

## Decision

**1. One authoritative pin, one shared installer.**
[`.github/aw/version`](../../.github/aw/version) is a one-line file and the single source of truth
for the `gh-aw` version. [`.github/aw/install.sh`](../../.github/aw/install.sh) is the only install
procedure: contributors, agents, and `copilot-setup-steps.yml` all run the same script, so the
bootstrap exists in exactly one place and CI cannot diverge from the documentation. Upgrading is
edit the pin → re-run the installer → recompile lock files; editing the pin alone leaves the caller
compiling with the old binary, so all four places that mention the upgrade say all three steps.

**2. Direct release download, verified, fail-closed.**
The installer maps `uname -s`/`uname -m` to a release asset and fetches `checksums.txt` **first**
(it is the authoritative list of published assets, so an unreleased OS/arch combination fails with
the real asset list instead of an opaque 404), then downloads the asset and verifies its SHA-256
**before** making it executable. It supports `sha256sum`, `shasum -a 256`, and FreeBSD's
`sha256 -q`, and exits non-zero — installing nothing — when no utility is available or the hash
does not match. It is POSIX `sh` (shellcheck-clean, runs under `dash` and `busybox ash`); on
Windows it needs Git Bash or another POSIX environment.

**3. The binary is standalone — `gh-aw`, not `gh aw`.**
Because the installer places a binary on `PATH` rather than registering a `gh` extension (`gh`
resolves extensions from its own directory, not from `PATH`), every invocation is `gh-aw …`.
[`.github/mcp.json`](../../.github/mcp.json) therefore launches `gh-aw mcp-server`. This is a real
trap: the binary's own `--version` prints `gh aw version …`, and the generated agent file is full of
`gh aw …` command lines. `.github/mcp.json` carries a second correction — it declares the tool as
`mcp-inspect`, where `gh aw init` emits `inspect`, a name the v0.83.1 server advertises for no tool
(verified by an MCP `tools/list` handshake), so as generated the capability is silently unavailable.
Both corrections must survive a future `gh aw init` re-run.

**4. Generated files are committed as generated.**
`.github/agents/agentic-workflows.md` and `.github/skills/agentic-workflows/SKILL.md` are committed
byte-identical to the `gh aw init` output, keeping a future re-run diff-free, with the naming
deviation and the `gh aw …` → `gh-aw …` substitution documented in `AGENTS.md` instead. The one
exception is `.vscode/settings.json`, which is inside Prettier's scope and so is reformatted to keep
`format:check` green. A consequence of the non-`*.agent.md` name: `.github/scripts/validate-meta.py`
globs `.github/agents/*.agent.md`, so this file's frontmatter is intentionally not covered by CI's
agent frontmatter check (unlike the paired `SKILL.md`, which the `.github/skills/**/SKILL.md` glob
does cover) — the naming deviation is deliberate, so the validator glob is not widened for it.

## Consequences

- **Positive.** One bootstrap command works identically for humans, cloud agents, and CI. The
  version is bumped in exactly one line. A download that differs from the published checksum can
  never be executed — note that the manifest and the asset share one release trust boundary, so
  this detects corruption and tampering in transit, not a compromised release. An unsupported
  platform gets an actionable error. A future `gh aw init` re-run produces no spurious diff in the
  generated markdown.
- **Negative.** We own an installer rather than using the upstream one, so a change to the release
  asset naming or to `checksums.txt` is ours to follow. The `gh-aw` versus `gh aw` distinction is a
  standing papercut that documentation, not tooling, has to keep resolving.
- **Neutral.** `.github/aw/` is also gh-aw's own prompt-overlay directory; `version` and
  `install.sh` are ours and nothing collides today, but a future overlay drop shares the directory.
