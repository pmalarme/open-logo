> OpenLogo Specification v0.1.0 — Draft (Status: Normative)

# Conformance

[Back to the specification index.](README.md)

**Status: Normative.** This document defines how an implementation declares conformance to
OpenLogo v0.1.0, which profiles are required, how optional profiles compose, and how extensions
are named and detected. The canonical primitive names, aliases, kinds, arities, arguments, results,
and errors are defined in the C3 primitive matrix in [commands.md](commands.md) and the owning
profile documents; this document assigns features to profiles and does not redefine signatures.

## Normative and informative text

**Status: Normative.** Text in this document is Normative unless a section or paragraph is
explicitly labeled **Informative**. Normative text uses the requirement words **MUST**, **MUST
NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** with their ordinary specification meanings.

**Status: Informative.** Examples and rationale explain the requirements but do not add new
requirements.

## Conformance claims

**Status: Normative.** A conformance claim MUST identify:

- the implementation name and version;
- the supported OpenLogo specification version, exactly `0.1.0` for this draft;
- the supported profiles, using the profile names in this document;
- the supported rendering target or targets when claiming **Turtle & Rendering**;
- any implementation extensions, named in the extension namespace defined below.

A v0.1.0 minimal conforming OpenLogo implementation is **Core Language + Turtle & Rendering**.
A Core-only evaluator MAY claim support for the **Core Language** profile, but it MUST NOT call
itself a minimal conforming OpenLogo implementation.

Learner **levels are not profiles**. Levels are an educational sequencing model owned by
[educational-model.md](educational-model.md); profiles are implementation capability sets.

The `*(ext)*` marker in the C3 primitive matrix is provenance only. Conformance is determined by
the profile that owns a feature, not by whether that feature is historically inherited or modern.

## Required profiles

### Core Language

**Status: Normative.** **Core Language** is required for every OpenLogo implementation. It includes:

- the lexical and grammar rules in [grammar.md](grammar.md);
- the reader, evaluator, fixed-arity prefix call model, variadic parenthesized call model,
  block-result rule, scoping, procedure registration, and execution semantics in
  [execution-model.md](execution-model.md);
- value support for `number`, `word`, `list`, and `boolean`;
- variables and places via `:name`, assignment with `<place> = <value>`, and worded assignment with
  `set <place> to <value>`;
- strict booleans; comparisons with `==`, `!=`, `<`, `>`, `<=`, and `>=` that may be chained
  (`1 < :x < 10`); the worded `is`-predicates (`… is empty`, `… is member of …`, `… is a …`,
  `… is [ strictly ] between … and …`); and logical operators;
- control forms including `if`, `while`, `repeat`, `forever`, `for … in`, and `for … from … to`;
- Core comprehensions: `map`, `filter`, and `reduce`, with bracketed expression bodies and no
  lambda or first-class procedure values;
- procedures with `define … end`, `return`, `stop`, and `throw`;
- Core math, logic, output, word, and list reporters as assigned to Core by the C3 primitive matrix.

Core is non-interactive. `print` and `show` are Core output facilities, but blocking input is not:
`input` belongs to **Interaction & Events**.

### Turtle & Rendering

**Status: Normative.** **Turtle & Rendering** is required for a graphical implementation and is part
of the minimal conforming implementation. It includes:

- the turtle movement, pen, color, visibility, shape, and turtle-state primitives owned by the
  Turtle & Rendering section of the C3 primitive matrix;
- the initial turtle and canvas state defined in [execution-model.md](execution-model.md);
- the rendering behavior, trace consumption, stepping, animation, accessibility, and export rules in
  [rendering.md](rendering.md).

An implementation claiming this profile MUST provide at least a Canvas-capable drawing target.
SVG and PNG export targets are recommended.

## Optional profiles

**Status: Normative.** Optional profiles MAY be implemented independently except where the dependency
DAG below states a dependency.

### Geometry

The **Geometry** profile provides the derived, source-shown standard library described in
[geometry-module.md](geometry-module.md). Most geometry procedures are written in OpenLogo and build
on Core control plus Turtle & Rendering behavior; they are not opaque primitive shortcuts. The
`grid`, `axes`, and `measure` overlays are the exception: they are renderer-backed primitives that
draw onto renderer overlay layers, specified behaviorally rather than as OpenLogo source. The
`area` and `perimeter` reporters read their shape-spec argument by list index (`:shape[2]`), which
is Data-profile behavior, so an implementation that provides `area` or `perimeter` also needs the
**Data** profile.

### Data

The **Data** profile provides dictionaries, records/structs, mutable indexing and field access, and
collection mutation forms including `add`, `remove`, `clear`, and `insert`, as specified in
[data-structures.md](data-structures.md). It also owns dictionary key access, record field access,
record construction, destructuring behavior for data values, and dictionary/record-related
reporters.

### Heritage

The **Heritage** profile is **alternate spellings only**. It does not add new semantics. It includes:

- `make` as the heritage assignment spelling;
- `to` as the heritage procedure-definition spelling;
- `output` and `op` as heritage spellings for `return`;
- short command aliases `fd`, `bk`, `lt`, `rt`, `pu`, `pd`, `st`, `ht`, `cs`, and `pr`;
- list-reporter alias spellings `bf`, `bl`, and `se`;
- the worded dictionary reporter spelling `value of … for key`, which operates on dicts and therefore also needs the **Data** profile.

The full-name reporters `first`, `last`, `butfirst`, `butlast`, `count`, `word`, `sentence`, `fput`,
and `lput` are **Core**, not Heritage. The Heritage profile does not restore classic Logo open
quotes, arrays, `run`, `apply`, templates, or lambda.

### Sprites

The **Sprites** profile provides multiple turtles/sprites, turtle identity, sprite addressing, and
per-turtle execution as specified in [turtles-and-sprites.md](turtles-and-sprites.md). It depends on
**Turtle & Rendering**.

### Interaction & Events

The **Interaction & Events** profile provides blocking input, waits, event handlers, keyboard and
pointer events, and timer-style behavior as specified in
[interaction-events.md](interaction-events.md). `input` is in this profile, not Core.

### Sound

The **Sound** profile provides sound and music primitives as specified in
[interaction-events.md](interaction-events.md). It may share the execution event stream with
Interaction & Events, but it is a separate optional profile.

### Modules

The **Modules** profile provides `import` and `export` behavior and module loading semantics as
specified in [execution-model.md](execution-model.md) and [localization.md](localization.md).

### Localization

The **Localization** profile provides localized keyword packs through aliasing and modules as
specified in [localization.md](localization.md). It depends on **Modules**. English keywords remain
canonical; localized names are additive aliases.

### Educational

The **Educational** profile provides deterministic baseline meta-commands such as `explain`, `why`,
`hint`, and `debug`, as specified in [educational-model.md](educational-model.md). This profile is a
capability profile; it is distinct from learner levels.

A conforming **Educational** implementation MUST provide `explain`, `why`, `hint`, and `debug` as
deterministic, offline, template-based commands that reveal concepts without printing a complete
ready-to-run solution. `hint` MUST be progressive: it escalates from a nudge toward the underlying
concept and MUST NOT reveal a full solution on its first request. These requirements are normative
here; [educational-model.md](educational-model.md) is informative and explains the pedagogy behind
them.

### Tutor (AI)

The **Tutor (AI)** profile provides AI-augmented tutoring behavior, including `challenge`, Socratic
guardrails, learner adaptation, and offline degradation to Educational behavior, as specified in
[ai-tutor.md](ai-tutor.md). It depends on **Educational**.

A conforming **Tutor (AI)** implementation MUST augment the baseline meta-commands and `challenge`
while preserving their deterministic Educational behavior, and when its AI backend is unavailable it
MUST degrade gracefully to that Educational baseline. The tutor MUST ask guiding questions before
giving a direct answer and MUST NOT emit a complete take-home solution in place of guidance. These
requirements are normative here; [ai-tutor.md](ai-tutor.md) is informative and describes how a tutor
realizes them.

## Feature to profile table

**Status: Normative.** Each listed feature belongs to exactly the profile shown for conformance
purposes.

| Feature | Owning profile | Required for minimal conformance? | Notes |
|---|---|---:|---|
| Lexing, parsing, reserved words, block delimiters, precedence | Core Language | Yes | Defined by [grammar.md](grammar.md). |
| Reader/evaluator, fixed default arity, variadic parentheses, block-result rule | Core Language | Yes | Defined by [execution-model.md](execution-model.md). |
| Values `number`, `word`, `list`, `boolean` | Core Language | Yes | No arrays, no null, no procedure values. |
| Variables with `:name`, `<place> = <value>`, and `set … to` | Core Language | Yes | `make` spelling is Heritage. |
| Strict booleans, comparisons, chaining, `is`-predicates, math, logic | Core Language | Yes | `=` assigns; `==` compares. |
| `print` and `show` output | Core Language | Yes | Non-interactive output only. |
| Control forms including `for … in` | Core Language | Yes | Includes `for … from … to`. |
| `map`, `filter`, `reduce` comprehensions | Core Language | Yes | No lambda; bracketed expression body. |
| Procedures, `define … end`, `return`, `stop`, `throw` | Core Language | Yes | `to`, `output`, and `op` spellings are Heritage. |
| Full-name word/list reporters | Core Language | Yes | Includes `first`, `last`, `butfirst`, `butlast`, `count`, `word`, `sentence`, `fput`, `lput`. |
| Turtle movement, pen, color, heading, visibility, shape | Turtle & Rendering | Yes | Required for graphical and minimal conformance. |
| Canvas rendering target | Turtle & Rendering | Yes | SVG/PNG recommended. |
| Geometry standard library | Geometry | No | Derived OpenLogo source built from Core + Turtle behavior. |
| Dictionaries and dictionary literals | Data | No | `{ key: value }`, dictionary access, mutation, keys, values. |
| Records/structs and record field access | Data | No | Fixed fields; unknown field errors. |
| Mutable indexing and field access for Data collections | Data | No | Includes nested places and final-key dict upsert. |
| `add`, `remove`, `clear`, `insert` mutation forms | Data | No | Collection mutation profile. |
| `make`, `to`, `output`, `op` spellings | Heritage | No | Alternate spellings only. |
| `fd`, `bk`, `lt`, `rt`, `pu`, `pd`, `st`, `ht`, `cs`, `pr` | Heritage | No | Short command aliases only. |
| `bf`, `bl`, `se` alias spellings | Heritage | No | Full-name reporters remain Core. |
| `value of … for key` spelling | Heritage | No | Alternate dictionary reporter spelling; operates on dicts, so it also needs Data. |
| Multiple turtles/sprites and sprite addressing | Sprites | No | Depends on Turtle & Rendering. |
| `input`, waits, timers, keyboard/mouse events | Interaction & Events | No | Core remains non-interactive. |
| Sound and music primitives | Sound | No | Separate optional profile. |
| `import` and `export` | Modules | No | Enables module loading and exported names. |
| Localized keyword packs | Localization | No | Depends on Modules. |
| Baseline `explain`, `why`, `hint`, `debug` | Educational | No | Deterministic, non-AI behavior. |
| AI tutoring and `challenge` | Tutor (AI) | No | Depends on Educational. |

## Profile dependency DAG

**Status: Normative.** A profile claim MUST include every transitive dependency of that profile.

```text
Core Language
├─ Turtle & Rendering
│  ├─ Geometry
│  └─ Sprites
├─ Data
├─ Heritage
├─ Interaction & Events
├─ Sound
├─ Modules
│  └─ Localization
└─ Educational
   └─ Tutor (AI)
```

Two optional features create a conditional dependency on **Data** that the tree above does not draw as an edge, because the rest of their profiles do not need it: the `area` and `perimeter` reporters in **Geometry** and the `value of … for key` reader in **Heritage** read a collection by index or key, which is **Data** behavior. An implementation that offers either feature MUST also claim **Data**.

The required minimal conformance path is:

```text
Core Language → Turtle & Rendering
```

## Extensions and feature detection

**Status: Normative.** Extension features MUST be named with a reverse-DNS-style or otherwise
vendor-owned prefix followed by a feature name:

```text
<vendor>.<feature>
```

Examples: `example.svg_filters`, `schooldistrict.lesson_badges`, `orgname.hardware_turtle`.

An extension MUST NOT redefine the syntax or semantics of a required or claimed profile feature.
If an extension adds event kinds, diagnostics, profile-like capability groups, rendering targets, or
host APIs, those names MUST use the same `<vendor>.<feature>` namespace.

Implementations MUST expose feature detection metadata to hosts and tools. The metadata MUST include:

- `openlogo.version`, with value `0.1.0` for this draft;
- a list of supported profiles by the profile names in this document;
- a list of supported extension feature names;
- rendering targets when Turtle & Rendering is claimed.

OpenLogo v0.1.0 does not define a Core language primitive for feature detection. An implementation
MAY expose feature detection through a host API, command-line flag, editor integration, or a
vendor-namespaced reporter, but such a reporter is an extension and MUST NOT be required by portable
Core programs.

## Versioning

**Status: Normative.** A v0.1.0 conformance claim applies only to this draft specification. Patch
updates MAY clarify text without changing required behavior. Minor or major versions MAY add,
remove, or change profile requirements; implementations MUST NOT claim conformance to a different
version without checking that version's conformance document.

Portable programs SHOULD declare the profiles they require in documentation or host metadata. A
program that uses an optional profile is not portable to implementations that do not claim that
profile.

## License

**Status: Normative.** OpenLogo is licensed under the MIT License. The repository license text is in
[../LICENSE](../LICENSE). Conforming implementations of this specification MAY use any license for
their own code, but references to the OpenLogo specification MUST preserve the MIT license notice for
the specification text.
