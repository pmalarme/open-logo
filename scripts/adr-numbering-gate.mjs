/**
 * Logic module for the **ADR-numbering** Definition-of-Done gate (issue #1042). Extracted so tests
 * can import it directly for 100% coverage, keeping `scripts/check-adr-numbering.mjs` a thin CLI
 * shell — the same shape `scripts/spec-citations-gate.mjs` + `scripts/check-spec-citations.mjs` and
 * `scripts/markdown-examples-gate.mjs` + `scripts/check-markdown-examples.mjs` already have. A CLI
 * shell is exercised through a subprocess, so it stays outside the loaded-module coverage set
 * `docs/adr/0009-test-layout.md` defines.
 *
 * **Why this exists.** Nothing checked ADR numbering. Two Accepted ADRs were created four days
 * apart both carrying the number `0025`, and the duplicate stood for nearly three days before a
 * human noticed (issue #1036; the exact window is in that issue and in commit `f3bbc9d1`). A second
 * defect of the same family was in the tree when this gate was written:
 * `docs/adr/0022-documentation-example-gate.md` opened with `# 21.`, so two ADRs shared a heading
 * number, and two links in `.github/skills/shared/definition-of-done/SKILL.md` climbed three
 * directories where they needed four and resolved to a `.github/docs/adr/` that has never existed.
 * An ADR is a durable record addressed by its number; a number that is ambiguous or points nowhere
 * makes the record unciteable, and every one of these defects is mechanical.
 *
 * ## What this gate enumerates — read this before trusting a green run
 *
 * **The scanned set is tracked files *plus* untracked, non-ignored ones**
 * (`git ls-files --cached --others --exclude-standard`). That deviates from
 * `scripts/spec-citations-gate.mjs`, which walks the tracked set alone, and the deviation is the
 * point: that gate's own verification run happened before `git add`, so it had never read its own
 * source and reported green over a corpus that excluded the very file under review (issue #1042
 * records it). Including `--others` closes that hole mechanically, not by remembering to stage
 * first. In CI the two sets are identical — a fresh checkout has no untracked files — so this only
 * ever adds coverage locally, over a file that is a candidate for commit.
 *
 * **References are enumerated by three independent signals**, unioned, because each covers a hole
 * the others have. A link counts as an ADR reference when:
 *
 * 1. its **target names the ADR directory** (`<adrDirectory>/…`) — the only signal that sees a link
 *    whose relative prefix is wrong, because such a link resolves *outside* the ADR directory
 *    (defect 2 above resolved into `.github/docs/adr/`);
 * 2. its **resolved path lands inside the ADR directory** — the only signal that sees the sibling
 *    links ADRs use on each other (an `ADR-0005` label over a bare `0005-toolchain.md` target),
 *    whose target names no directory at all. They are the *majority* of ADR links in this
 *    repository, and a `docs/adr/`-substring enumeration — the obvious first design — misses every
 *    one of them;
 * 3. its **link text labels it** (`ADR-NNNN`) — the only signal that sees a link labelled as an ADR
 *    that points somewhere else entirely, which is the mislabelling half of AC3.
 *
 * All three CommonMark destination spellings are read: bare, `<angle-bracketed>`, and either with a
 * title after it, in any of the three legal delimiters. In **markdown**, a link inside a fenced
 * block or an inline code span is skipped, because it renders as text rather than as a link and
 * auditing it is a false red. That exemption is markdown-only and link-only: outside markdown an
 * illustrative link in a comment **is** a link here, so spell such an example out rather than write
 * it in link syntax — this note was flagged by the gate twice for doing otherwise.
 *
 * On top of links, every **bare textual path** of the form `<adrDirectory>/NNNN-….md` that is not
 * already inside a markdown link or a URL is checked to name a file that exists. Those appear in
 * code comments and in prose where no markdown link is possible — backticked or not, they are real
 * references — and they rot the same way when a slug is renamed. A path whose file part does not
 * start with four digits is not a reference, which is what keeps documented placeholders such as
 * `docs/adr/NNNN-title.md` out without an exceptions list.
 *
 * The gate prints its enumeration and every count on **every run**, so a check that quietly stops
 * finding anything is visible rather than inferred: a zero where there was a number is a broken
 * instrument, and `.github/scripts/validate-meta.py` records what an emptied inventory costs.
 *
 * ## What it does NOT catch
 *
 * **A bare `ADR-0025` in prose that points at the semantically wrong document.** There is no path
 * to resolve and no link to follow — only a number in a sentence that may or may not describe the
 * ADR that number now names. #1036 had to attribute every such reference by hand to decide which
 * ones moved with the renumbered document and which stayed, each on evidence from the surrounding
 * prose (one citing a "396 escape" figure that appears in only one ADR; another quoting "the shim
 * exposes no compiler API", attributable to a different one). The per-reference verdicts are
 * recorded in commit `f3bbc9d1`. No filename check reaches that, and this gate does not pretend to.
 * Nor does it check that a **heading's title** matches its slug, that a `#fragment` names a real
 * heading, or that numbers form an unbroken sequence.
 *
 * **It also reads one tree.** Two branches can each take the same "next free" number and both stay
 * green until the second merges — which happened to this very slice, whose ADR was renumbered after
 * a concurrently-authored one took the number first. The duplicate is caught on the merged tree,
 * which is the point, but nothing warns the second author before then.
 *
 * Reference-style link definitions (`[label]: url`) and HTML `<a href>` anchors are **not**
 * enumerated. Neither form occurs in this repository today (measured across the scanned set); if
 * one appears it is unchecked, which is why the enumeration is stated here rather than implied.
 * Nor is a link whose target contains whitespace or a nested `)`.
 *
 * {@link LINK_PATTERN} is deliberately **not** line-wise, and that is not a stylistic choice: the
 * first draft of this gate scanned line by line, which silently missed the link in
 * `docs/adr/0005-toolchain.md` whose `](` ends one line and whose target opens the next. One real
 * ADR link, invisible to the instrument, in the very corpus the gate was written to certify.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix, sep } from "node:path";

/** Directory holding the Architecture Decision Records, relative to the repository root. */
export const ADR_DIRECTORY = "docs/adr";

/** Directory names the filesystem walk never descends into. */
const UNWALKED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "web-dist",
  "coverage",
]);

/** The one legal ADR filename shape: a four-digit number, a hyphen, a lowercase kebab-case slug. */
export const ADR_FILENAME_PATTERN = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

/**
 * An inline markdown link. The **text** may not span lines, so a stray `[` cannot swallow a
 * paragraph and pick up an `ADR-NNNN` label from an unrelated sentence; the **target** may, because
 * a wrapped link is a real form in this repository (see the module note).
 *
 * All three CommonMark destination spellings are read — bare, `<angle-bracketed>`, and either
 * followed by a title in any of the three legal delimiters — because a spelling this gate does not
 * parse is worse than unchecked: a titled link was still seen by the bare-path scan, which resolves
 * from the repository root, so a wrong `../` depth **passed**. An escaped `\]` in the link text is
 * consumed rather than ending it, for the same reason.
 *
 * Still not parsed, and therefore not checked: a link whose *text* spans lines or nests brackets,
 * reference-style definitions, and HTML anchors.
 */
export const LINK_PATTERN =
  /\[((?:[^\]\n\r\\]|\\.)*)\]\(\s*(?:<([^>\n\r]*)>|([^)\s]+))(?:\s+(?:"[^"\n\r]*"|'[^'\n\r]*'|\([^)\n\r]*\)))?\s*\)/g;

/** The destination of a {@link LINK_PATTERN} match, whichever spelling it used. */
function linkTarget(match) {
  return match[2] === undefined ? match[3] : match[2];
}

/**
 * A target that leaves the repository: any `scheme:` URL, or a protocol-relative `//host/…`.
 *
 * Without this, `[gh-aw](https://github.com/github/gh-aw)` written *inside* an ADR resolves to
 * `docs/adr/https:/github.com/…`, which is inside the ADR directory by path arithmetic and exists
 * nowhere — a false red on three real links, found by running the gate over the tree rather than by
 * reasoning about it.
 */
const EXTERNAL_TARGET = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * A fenced code block delimiter: up to three **spaces**, then a run of backticks or tildes, then
 * the rest of the line (an info string on an opener, whitespace only on a closer).
 *
 * The run's **character and length** both matter. A three-backtick line does not close a
 * four-backtick block, and review built exactly that document — a fenced `# 31.` between a
 * four-backtick opener and a three-backtick line — to manufacture a heading the gate accepted.
 *
 * Spaces, not `\s`: a tab-indented line is an indented code block in CommonMark, not a fence, and
 * accepting one as a fence swallowed the real heading below it.
 *
 * **Not modelled:** a fence nested in a list item or a block quote, whose container prefix this
 * pattern does not strip. What happens then depends on the marker: a block-quoted backtick fence
 * still opens a code span through its backticks, so a link inside it is skipped, while a tilde one
 * has no such accident and the link is audited as live. Full container parsing is a markdown parser,
 * which this gate is not, and **no markdown file in the tracked corpus holds such a fence** — the
 * count has to be taken over `*.md` only, because a JSDoc ` * ` leader reads as a list bullet and a
 * corpus-wide grep finds those instead. Fence handling is markdown-only anyway
 * ({@link collectReferences}), so a JSDoc fence is not a false negative here.
 */
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Convert a native path to the `/`-separated form this gate reports and compares with. */
export function toPosixPath(path) {
  return path.split(sep).join("/");
}

/**
 * The prefix that makes a path rooted, which normalisation must never rewrite: a POSIX `/`, a
 * Windows drive **root** (`C:/`), a UNC share (`//server/share/`), or a device path together with
 * the volume it names (`//./C:/`, `//?/C:/`) — the volume belongs to the root, or a `..` in the
 * remainder would swallow it.
 */
const PATH_ROOT = /^(?:\/\/[.?]\/[^/]*\/?|\/\/[^/]+\/[^/]+\/?|[A-Za-z]:\/|\/)/;

/** A drive-relative prefix (`C:foo`), which names a volume but is *not* rooted at its top. */
const DRIVE_RELATIVE = /^[A-Za-z]:/;

/**
 * The one spelling of a path this gate compares: `/`-separated, normalised, with no trailing slash.
 *
 * Identity is a string comparison, so `docs/adr/` and `docs/adr/./` have to become `docs/adr` or a
 * sibling link goes unclassified — review passed each of those as `--adr-root` and watched a broken
 * link report `links: 0`.
 *
 * Two things are held back from normalisation, because neither is an ordinary segment:
 *
 * - a **root**, so `C:/` stays a drive root rather than becoming the drive-relative `C:`, and a
 *   `..` in the remainder cannot climb above it — which is what the operating system does too;
 * - a leading **`..`** on an unrooted path, which is a real part of where that path points.
 *   Dropping it turned `--adr-root=../docs/adr`, run from a subdirectory, into `docs/adr`: the
 *   gate then found no ADRs at all and failed every reference in the tree.
 *
 * Case is **not** folded: `docs/ADR/0001-x.md` exists on Windows and does not on Linux or
 * github.com, so a link spelled that way fails its existence check on CI, which is where it counts.
 */
export function canonicalPath(value) {
  const posixValue = toPosixPath(value);
  if (posixValue === "") {
    return ".";
  }
  const rooted = PATH_ROOT.exec(posixValue);
  if (rooted === null) {
    const drive = DRIVE_RELATIVE.exec(posixValue);
    const prefix = drive === null ? "" : drive[0];
    const rest = posixValue.slice(prefix.length);
    const body =
      rest === "" ? "" : posix.normalize(rest).replace(/(?!^)\/+$/, "");
    if (prefix === "") {
      return body === "" ? "." : body;
    }
    return `${prefix}${body}`;
  }
  const root = rooted[0];
  const body = posix
    .normalize(`/${posixValue.slice(root.length)}`)
    .replace(/^\//, "")
    .replace(/(?!^)\/+$/, "");
  const base = root.replace(/\/$/, "");
  return body === "" ? `${base}/` : `${base}/${body}`;
}

/** Split text into lines, tolerating CRLF and a lone CR, so a reported line number matches an editor's. */
export function splitLines(text) {
  return text.split(/\r\n|[\r\n]/);
}

/**
 * Read a file as text, or `null` when it is binary (a NUL byte) or cannot be read.
 *
 * A path can be listed yet unreadable — a dangling symlink, a `skip-worktree` placeholder, a file
 * deleted from the worktree but still in the index. Throwing there would crash the gate mid-scan
 * instead of skipping one file, so it degrades the same way a binary file does.
 */
export function readTextFile(path) {
  let buffer;
  try {
    buffer = readFileSync(path);
  } catch {
    return null;
  }
  if (buffer.includes(0)) {
    return null;
  }
  return buffer.toString("utf8");
}

/** Every file under `roots`, depth-first and sorted, as `/`-separated paths. */
export function walkFiles(roots) {
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!UNWALKED_DIRECTORIES.has(entry.name)) {
          visit(path);
        }
        continue;
      }
      found.push(toPosixPath(path));
    }
  };
  for (const root of roots) {
    if (existsSync(root)) {
      visit(root);
    }
  }
  return found.sort();
}

/**
 * The files the gate scans: every tracked file **and** every untracked, non-ignored one, so a
 * reference in a file that has not been `git add`ed yet is still checked (see the module note).
 * `roots` overrides this with a plain filesystem walk, which is how the tests point the gate at
 * isolated temp fixtures.
 */
export function listScannedFiles(roots) {
  if (roots !== undefined) {
    return walkFiles(roots);
  }
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter((path) => path !== "");
  return [...new Set(listed)].sort();
}

/**
 * The `*.md` documents in the ADR directory, sorted; an absent directory yields none.
 *
 * The extension test is **case-insensitive** so that a `0031-x.MD` is audited and then rejected by
 * {@link ADR_FILENAME_PATTERN}, rather than falling outside the audit entirely and being numbered
 * however it likes — review found exactly that hole.
 *
 * `README.md` is excluded: a directory index is not a decision record, and `docs/design-notes/` —
 * the sibling family with the same numbering convention — already carries one, so requiring the
 * `NNNN-slug.md` shape of it would be a false red waiting for the day `docs/adr/` gains an index.
 */
export function listAdrDocuments(adrRoot) {
  if (!existsSync(adrRoot)) {
    return [];
  }
  return readdirSync(adrRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.md$/i.test(entry.name) &&
        entry.name.toLowerCase() !== "readme.md",
    )
    .map((entry) => entry.name)
    .sort();
}

/**
 * Split text into raw lines **including their terminators**, so an offset computed by summing line
 * lengths is a true index into the text. Summing `line.length + 1` instead drifts by one byte per
 * line under CRLF, which review measured: after a hundred CRLF lines, a code span was audited as a
 * live link because every span offset had slid past it.
 *
 * The pattern matches the empty string, so `match` never returns `null` here — a `?? []` fallback
 * would be a branch no test could ever reach, which the coverage gate says out loud.
 */
export function rawLines(text) {
  return text.match(/[^\n\r]*(?:\r\n|[\r\n])?/g).filter((line) => line !== "");
}

/** A line without its terminator, whichever of the three legal endings it used. */
function withoutTerminator(line) {
  return line.replace(/\r\n$|[\r\n]$/, "");
}

/**
 * The number the document's first level-1 heading declares, exactly as written.
 *
 * The house shape is `# <n>. <title>` with the number **unpadded** (`0009-test-layout.md` opens
 * `# 9.`), and the comparison is textual for that reason: a numeric one accepts `# 0009.`, which
 * reads as a different convention to a human and drifts from every other record.
 *
 * Lines inside a fenced code block are skipped. A fenced `# 29.` is an illustration, not the
 * document's heading, and accepting one let a document with no real H1 pass.
 */
export function headingNumber(text) {
  let fence = null;
  for (const raw of rawLines(text)) {
    const line = withoutTerminator(raw);
    const delimiter = FENCE_PATTERN.exec(line);
    if (fence === null) {
      if (delimiter !== null && opensFence(delimiter)) {
        fence = { marker: delimiter[1][0], length: delimiter[1].length };
        continue;
      }
    } else {
      if (closesFence(delimiter, fence)) {
        fence = null;
      }
      continue;
    }
    const heading = /^#\s+(.*)$/.exec(line);
    if (heading === null) {
      continue;
    }
    const numbered = /^(\d+)\.\s/.exec(heading[1]);
    return { heading: line, number: numbered === null ? null : numbered[1] };
  }
  return null;
}

/** Whether a fence delimiter opens a block: a backtick opener may not carry a backtick info string. */
function opensFence(delimiter) {
  return !(delimiter[1].startsWith("`") && delimiter[2].includes("`"));
}

/** Whether a fence delimiter closes `fence`: same character, at least as long, nothing after it. */
function closesFence(delimiter, fence) {
  return (
    delimiter !== null &&
    delimiter[1][0] === fence.marker &&
    delimiter[1].length >= fence.length &&
    delimiter[2].trim() === ""
  );
}

/**
 * Audit the ADR directory itself: filename shape, number uniqueness (AC1), and filename↔heading
 * agreement (AC2). Returns one message per problem, each naming the file and both numbers.
 */
export function auditAdrDocuments(adrRoot, adrDirectory) {
  const problems = [];
  const byNumber = new Map();
  const documents = listAdrDocuments(adrRoot);
  for (const name of documents) {
    const label = `${adrDirectory}/${name}`;
    const named = ADR_FILENAME_PATTERN.exec(name);
    if (named === null) {
      problems.push(
        `${label}: an ADR filename must be NNNN-lowercase-kebab-slug.md — this one is not, so its ` +
          "number cannot be read and every reference to it is unverifiable",
      );
      continue;
    }
    const number = named[1];
    byNumber.set(number, [...(byNumber.get(number) ?? []), label]);

    const text = readTextFile(join(adrRoot, name));
    if (text === null) {
      problems.push(`${label}: could not be read as text`);
      continue;
    }
    const declared = headingNumber(text);
    if (declared === null || declared.number === null) {
      problems.push(
        `${label}: no level-1 heading of the form "# ${Number(number)}. <title>" — the number in the ` +
          "filename is then the only one, and nothing keeps the document's own title honest",
      );
      continue;
    }
    if (declared.number !== String(Number(number))) {
      problems.push(
        `${label}: the filename says ${Number(number)} but the heading says ${declared.number} ` +
          `(${declared.heading.trim()}) — the number a reader sees must be the number the file is ` +
          "addressed by, written unpadded",
      );
    }
  }
  for (const [number, labels] of [...byNumber].sort()) {
    if (labels.length > 1) {
      problems.push(
        `ADR number ${number} is used by ${labels.length} documents: ${labels.join(", ")} — ` +
          "renumber all but the earliest by creation date, as issue #1036 did",
      );
    }
  }
  return { documents, problems };
}

/** Resolve a link target the way a reader does: relative to the file, or from `linkBase` if rooted. */
export function resolveTarget(file, target, linkBase) {
  const base = target.startsWith("/") ? linkBase : posix.dirname(file);
  return posix.normalize(posix.join(base, target.replace(/^\//, "")));
}

/**
 * Whether `path` sits inside `root` (path arithmetic only — neither has to exist).
 *
 * The comparison is **case-insensitive**, and only ever decides whether a link is *worth checking*:
 * identity is compared case-sensitively elsewhere. It is the signal that catches a **sibling** link
 * — a bare `0001-x.md` written inside a wrong-cased ADR directory — which names no directory for the
 * other signals to see. A link whose *target spells the directory* is caught by the directory-name
 * signal instead, whichever case it is written in; review measured that distinction, and an earlier
 * version of this note claimed the broader case.
 */
export function isInside(root, path) {
  const lowerRoot = root.toLowerCase();
  const lowerPath = path.toLowerCase();
  return lowerPath === lowerRoot || lowerPath.startsWith(`${lowerRoot}/`);
}

/**
 * Escape a literal so it can be interpolated into a regular expression as text.
 *
 * `adrDirectory` reaches these patterns from `--adr-dir`, so interpolating it raw is a regex
 * injection — CodeQL's `js/regex-injection`, raised on this very file — and, less dramatically but
 * more likely, a plain correctness bug: a directory whose name contained `.` or `+` would quietly
 * match paths that are not it.
 *
 * On the shipped invocation this is a **no-op**: `docs/adr` holds no metacharacter, so the gate's
 * report is byte-identical with and without it. Do not read the fix as something the default run
 * exercises — it is the override path, and the test, that exercise it.
 */
export function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The ADR number a link's text claims, from either `ADR-NNNN` or a spelled-out ADR path. */
export function labelledNumber(text, adrDirectory) {
  const labelled = /\bADR-(\d{4})\b/.exec(text);
  if (labelled !== null) {
    return labelled[1];
  }
  const spelled = new RegExp(`${escapeForRegExp(adrDirectory)}/(\\d{4})-`).exec(
    text,
  );
  return spelled === null ? null : spelled[1];
}

/** The 1-based line `index` falls on, so a wrapped link is reported where a reader sees it start. */
export function lineNumberAt(text, index) {
  return splitLines(text.slice(0, index)).length;
}

/**
 * The `[start, end)` offsets of every span in a markdown document where **link syntax does not
 * render as a link**: fenced code blocks and inline code spans.
 *
 * A link written in one of those is an illustration — ADR-0000 shows the ADR template that way —
 * and auditing it produces a false red for a link no reader can click. Only markdown files get this
 * treatment, and only their *link* matches: a bare ADR path inside backticks is a genuine reference
 * (this repository writes many of them that way), so those are still checked.
 *
 * Code spans are found by pairing **equal-length backtick runs over the raw text**, not by matching
 * within a line. Review defeated both shortcuts: a code span that wraps onto the next line was
 * audited as a link (false red), and a span opened with one backtick and closed with two hid a real
 * one (false green).
 */
export function codeSpans(text) {
  const spans = [];
  const outside = [];
  let offset = 0;
  let plainStart = 0;
  let fence = null;
  for (const raw of rawLines(text)) {
    const delimiter = FENCE_PATTERN.exec(withoutTerminator(raw));
    if (fence === null) {
      if (delimiter !== null && opensFence(delimiter)) {
        fence = {
          marker: delimiter[1][0],
          length: delimiter[1].length,
          start: offset,
        };
        outside.push([plainStart, offset]);
      }
    } else if (closesFence(delimiter, fence)) {
      spans.push([fence.start, offset + raw.length]);
      fence = null;
      plainStart = offset + raw.length;
    }
    offset += raw.length;
  }
  if (fence === null) {
    outside.push([plainStart, text.length]);
  } else {
    spans.push([fence.start, text.length]);
  }

  for (const [start, end] of outside) {
    const runs = [...text.slice(start, end).matchAll(/`+/g)];
    for (let index = 0; index < runs.length; index += 1) {
      // A backslash escapes exactly ONE backtick, so an escaped run of two opens a span of one —
      // review rendered that case through CommonMark and got a code span where this gate had been
      // auditing a live link. Escaping is consulted for the opener only: inside an open span
      // CommonMark processes no escapes, so the next equal-length run closes it regardless.
      const run = runs[index];
      const escaped = isEscaped(text, start + run.index);
      const openerStart = start + run.index + (escaped ? 1 : 0);
      const openerLength = run[0].length - (escaped ? 1 : 0);
      if (openerLength === 0) {
        continue;
      }
      const closerAt = runs.findIndex(
        (candidate, at) => at > index && candidate[0].length === openerLength,
      );
      if (closerAt === -1) {
        continue;
      }
      const closer = runs[closerAt];
      spans.push([openerStart, start + closer.index + closer[0].length]);
      index = closerAt;
    }
  }
  return spans;
}

/** Whether the character at `index` is backslash-escaped (an odd number of backslashes precede it). */
function isEscaped(text, index) {
  let backslashes = 0;
  while (index - backslashes > 0 && text[index - backslashes - 1] === "\\") {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/** Whether `index` falls inside any `[start, end)` span. */
function within(spans, index) {
  return spans.some(([start, end]) => index >= start && index < end);
}

/**
 * Whether the whitespace-delimited token ending at `index` is a URL, so a path inside it names
 * another host's file rather than one of ours.
 *
 * The token is taken from the raw text, so a newline delimits it: review put a flush-left
 * `docs/adr/…` path on the line after a URL and watched it go unchecked, and wrote a
 * protocol-relative `//host/docs/adr/…` that was audited as a local path. Opening wrappers are
 * stripped first, because an autolink or a parenthesised URL is still a URL — review wrapped one in
 * each and got a local path back.
 */
function insideUrl(text, index) {
  const token = /\S*$/.exec(text.slice(0, index))[0].replace(/^[<([{"'`]+/, "");
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(token);
}

/**
 * Every ADR reference in one file: markdown links classified by the three signals in the module
 * note, plus bare `<adrDirectory>/NNNN-….md` paths written outside any link.
 */
export function collectReferences(
  file,
  text,
  { adrDirectory, adrRoot, linkBase },
) {
  const references = [];
  const linkSpans = [];
  const illustrative = /\.md$/i.test(file) ? codeSpans(text) : [];
  for (const match of text.matchAll(LINK_PATTERN)) {
    linkSpans.push([match.index, match.index + match[0].length]);
    if (within(illustrative, match.index)) {
      // A link inside a fence or a code span renders as text, so it is an example, not a link.
      continue;
    }
    const target = linkTarget(match).split("#")[0];
    const labelled = labelledNumber(match[1], adrDirectory);
    if (target === "" || EXTERNAL_TARGET.test(target)) {
      // A same-document `#anchor` link names no file and an external URL is not a repository path,
      // so neither can be resolved here. A LABELLED one is still recorded — as `off-repo` rather
      // than silently dropped — because an ADR label over an off-repo target is a claim this gate
      // cannot check, and an unreported skip is how an instrument comes to certify less than it
      // appears to. Each one is printed with its file and line, because a bare total tells a reader
      // that something was skipped without telling them what.
      if (labelled !== null) {
        references.push({
          form: "off-repo",
          line: lineNumberAt(text, match.index),
          source: match[0].replace(/\s+/g, " "),
          target,
          resolved: null,
          labelled,
        });
      }
      continue;
    }
    const resolved = resolveTarget(file, target, linkBase);
    const names = linkTarget(match)
      .toLowerCase()
      .includes(`${adrDirectory.toLowerCase()}/`);
    if (!(names || isInside(adrRoot, resolved) || labelled !== null)) {
      continue;
    }
    references.push({
      form: "link",
      line: lineNumberAt(text, match.index),
      source: match[0].replace(/\s+/g, " "),
      target,
      resolved,
      labelled,
    });
  }
  const bare = new RegExp(
    `${escapeForRegExp(adrDirectory)}/(\\d{4}-[A-Za-z0-9._-]+\\.md)`,
    "g",
  );
  for (const match of text.matchAll(bare)) {
    // A path spelled out *inside* a link is that link, checked once, from where the reader stands.
    // Counting it again from the repository root would restate one defect in two voices. A path
    // inside a URL names another host's file, where a rename is none of this gate's business.
    if (within(linkSpans, match.index) || insideUrl(text, match.index)) {
      continue;
    }
    references.push({
      form: "path",
      line: lineNumberAt(text, match.index),
      source: match[0],
      target: match[0],
      resolved: posix.join(adrRoot, match[1]),
      labelled: null,
    });
  }
  return references.sort((left, right) => left.line - right.line);
}

/**
 * Run the gate over the ADR directory and every scanned file.
 *
 * Never calls `process.exit` — the CLI shell (`check-adr-numbering.mjs`) does that from `ok`.
 *
 * @param adrDirectory the token references are written with (`docs/adr`).
 * @param adrRoot where the ADR documents are read from; defaults to `adrDirectory`. Split so a
 *   test can point the reader at a temp fixture tree without changing the token fixtures reference.
 * @param linkBase what a root-relative (`/…`) link target is resolved against.
 * @returns `{ ok, counts, lines }` where `lines` is the printable report.
 */
export function runAdrNumberingGate({
  roots,
  adrDirectory = ADR_DIRECTORY,
  adrRoot = adrDirectory,
  linkBase = ".",
} = {}) {
  // Every path this gate compares is canonical: `/`-separated, normalised, no trailing slash. A
  // caller may hand `--adr-root` a native Windows path, a trailing slash or a `/./`, and identity is
  // a string comparison against a resolved reference — review produced a false red with the first
  // and a silent miss with the other two.
  const adrRootPath = canonicalPath(adrRoot);
  const linkBasePath = canonicalPath(linkBase);
  const lines = [];
  const counts = {
    adrs: 0,
    files: 0,
    links: 0,
    paths: 0,
    offRepo: 0,
    comparisons: 0,
    failed: 0,
  };
  const fail = (line) => {
    counts.failed += 1;
    lines.push(`FAIL ${line}`);
  };

  const audit = auditAdrDocuments(adrRootPath, adrDirectory);
  counts.adrs = audit.documents.length;
  for (const problem of audit.problems) {
    fail(problem);
  }
  // Identity by membership in the audited set, never by "the basename starts with four digits":
  // review labelled a link ADR-0001 and pointed it at a numbered document from a different family
  // entirely — under `docs/design-notes/` — and the number check waved it through.
  const adrPathFor = new Map();
  for (const name of audit.documents) {
    const named = ADR_FILENAME_PATTERN.exec(name);
    if (named !== null) {
      adrPathFor.set(named[1], posix.join(adrRootPath, name));
    }
  }

  for (const file of listScannedFiles(roots)) {
    const text = readTextFile(file);
    if (text === null) {
      continue;
    }
    counts.files += 1;
    for (const reference of collectReferences(file, text, {
      adrDirectory,
      adrRoot: adrRootPath,
      linkBase: linkBasePath,
    })) {
      if (reference.form === "off-repo") {
        counts.offRepo += 1;
        lines.push(
          `UNCHECKED ${file}:${reference.line}: ${reference.source} is labelled ` +
            `ADR-${reference.labelled} but points off-repo, so what it names cannot be verified here`,
        );
        continue;
      }
      counts[reference.form === "link" ? "links" : "paths"] += 1;
      if (!existsSync(reference.resolved)) {
        fail(
          `${file}:${reference.line}: ${reference.source} points at ${reference.resolved}, ` +
            "which does not exist",
        );
        continue;
      }
      if (reference.labelled === null) {
        continue;
      }
      counts.comparisons += 1;
      const expected = adrPathFor.get(reference.labelled);
      if (expected === reference.resolved) {
        continue;
      }
      fail(
        `${file}:${reference.line}: ${reference.source} is labelled ADR-${reference.labelled} but ` +
          `resolves to ${reference.resolved}, which is ` +
          `${expected === undefined ? `not that record — no ADR carries the number ${reference.labelled}` : `not ${expected}`}` +
          " — the link works, so only the label is wrong",
      );
    }
  }

  lines.push(
    `adr numbering: ${counts.adrs} ADR(s) in ${adrDirectory}, ` +
      `${counts.links} link(s) and ${counts.paths} bare path(s) referencing them ` +
      `across ${counts.files} scanned file(s), ${counts.comparisons} label check(s), ` +
      `${counts.offRepo} labelled link(s) pointing off-repo and therefore unchecked ` +
      `— ${counts.failed} failed`,
  );
  lines.push(
    `  Scanned set: ${
      roots === undefined
        ? "tracked files PLUS untracked, non-ignored ones (git ls-files --cached --others " +
          "--exclude-standard), so a file that is not staged yet is still checked"
        : `a filesystem walk of ${roots.join(", ")}`
    }.`,
  );
  lines.push(
    "  This gate checks that ADR numbers are unique, that each filename agrees with its own `# N.` " +
      "heading, that a markdown link or a written-out path resolves to a file that exists, and that " +
      "a link labelled ADR-NNNN resolves to that ADR. It does NOT check that a bare ADR-NNNN in " +
      "prose names the document the sentence is about — issue #1036 had to attribute every one of " +
      "those by hand — nor a heading's title, a #fragment, reference-style links, HTML anchors, or " +
      "that the numbers form an unbroken sequence. It reads ONE tree, so two branches can each take " +
      "the same next-free number and both stay green until the second merges.",
  );

  return { ok: counts.failed === 0, counts, lines };
}

/**
 * Parse CLI arguments: `--root=<path>` (repeatable), `--adr-dir=<token>`, `--adr-root=<path>` and
 * `--link-base=<path>` override the defaults, which is how the subprocess regression tests point
 * the CLI at isolated temp fixtures instead of the real corpus.
 */
export function parseArgs(argv) {
  const roots = [];
  const options = {};
  for (const arg of argv) {
    if (arg.startsWith("--root=")) {
      roots.push(arg.slice("--root=".length));
    } else if (arg.startsWith("--adr-dir=")) {
      options.adrDirectory = arg.slice("--adr-dir=".length);
    } else if (arg.startsWith("--adr-root=")) {
      options.adrRoot = arg.slice("--adr-root=".length);
    } else if (arg.startsWith("--link-base=")) {
      options.linkBase = arg.slice("--link-base=".length);
    }
  }
  return roots.length === 0 ? options : { ...options, roots };
}
