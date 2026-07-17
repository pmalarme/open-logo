> OpenLogo Specification v0.1.0 — Draft (Status: Informative)

# OpenLogo Specification

OpenLogo is a modern, open-source, educational reimagining of Logo. Its canonical name is **OpenLogo**, its short name is **OL**, and source files use the **`.logo`** extension.

OpenLogo keeps Logo's constructionist spirit: learners discover ideas by building visible things, starting with turtle graphics and growing toward data, procedures, events, and optional AI tutor support.

```logo
repeat 4
  forward 100
  right 90
end
```

## Goals

- Keep a low floor for learners aged 6+ while leaving room for advanced ideas.
- Make programs readable with lowercase words, light punctuation, and explicit structure.
- Preserve Logo heritage where it teaches well: turtles, words, lists, `to`/`define`, `return`/`output`, and friendly errors.
- Specify a consistent language contract for implementers, tools, examples, and conformance profiles.
- Prefer discoverable abstractions: geometry routines are standard-library OpenLogo source, not opaque magic.
- Support localization, accessibility, and optional profiles without bloating the Core Language.

## Non-goals

- This repository does not define an interpreter, runtime, editor binary, or package format.
- OpenLogo v0.1 has no arrays, lambda syntax, first-class procedure values, significant whitespace, commas, or `f(x,y)` call syntax.
- Core OpenLogo is non-interactive; input, events, sprites, sound, modules, localization packs, and AI tutor behavior are optional profiles.
- The language does not include hidden drawing shortcuts that bypass the learner's discovery of `repeat`, turns, and procedures.

## Organization

| File | Purpose |
|---|---|
| [README.md](README.md) | This hub: overview, navigation, glossary, references, license, and contribution pointers. |
| [conformance.md](conformance.md) | Profiles, feature mapping, dependency DAG, feature detection, versioning, and normative/informative status. |
| [vision.md](vision.md) | Educational philosophy, audience, principles, anti-goals, and open-source ethos. |
| [grammar.md](grammar.md) | Lexis, EBNF, precedence, block forms, places, postfix access, and reserved words. |
| [commands.md](commands.md) | Core, word/list, and turtle primitive reference using the canonical signatures. |
| [execution-model.md](execution-model.md) | Values, reader/evaluator, scoping, state, equality, safety, control flow, trace events, and mutation semantics. |
| [educational-model.md](educational-model.md) | Learning levels, concept-to-command map, and deterministic `explain`, `why`, `hint`, and `debug` behavior. |
| [geometry-module.md](geometry-module.md) | Derived geometry standard library built from OpenLogo source with learner-facing math explanations. |
| [data-structures.md](data-structures.md) | Lists, dicts, records/structs, uniform access, mutation-vs-copy, destructuring, and comprehensions. |
| [turtles-and-sprites.md](turtles-and-sprites.md) | Optional Sprites profile: multiple turtles, addressing, per-turtle state, and shapes. |
| [interaction-events.md](interaction-events.md) | Optional Interaction and Sound profiles: input, timers, handlers, wait, and music primitives. |
| [error-model.md](error-model.md) | Diagnostic shape, stable `ol-*` codes, did-you-mean behavior, stages, severity, and learner messages. |
| [rendering.md](rendering.md) | Canvas/SVG/PNG rendering model, animation, stepping, overlays, fill, export determinism, and accessibility. |
| [ai-tutor.md](ai-tutor.md) | Optional AI tutor augmentation, Socratic guardrails, progressive hints, adaptation, and offline fallback. |
| [localization.md](localization.md) | Aliases, localized keyword packs, module interaction, French example pack, and transliteration guidance. |
| [style-guide.md](style-guide.md) | Naming, formatting, full-name preference, comments, good practice, anti-patterns, and style lint guidance. |
| [tooling.md](tooling.md) | Syntax highlighting token classes, syntax checker/linter layers, diagnostic reuse, and editor integration guidance. |
| [examples/](examples/) | Annotated `.logo` learning journey and showcase programs. |

## Status and versioning

This is **OpenLogo Specification v0.1.0 — Draft**. The status line at the top of each file identifies whether that file is Normative or Informative. Versioning, profiles, feature detection, and the boundary between required and optional behavior are defined in [conformance.md](conformance.md).

## Glossary

- **Turtle**: the drawing actor with position, heading, visibility, shape, and pen state.
- **Sprite**: an optional-profile movable actor, modeled as a turtle that can be addressed among many turtles.
- **Heading**: the turtle's direction in degrees, where `0` points up and `right` turns clockwise.
- **Pen**: the drawing state that determines whether movement leaves marks, plus color and width.
- **Word**: a closed double-quoted text value such as `"tom"` or `"red"`.
- **List**: the ordered mutable sequence type, written with `[ ]`.
- **Dict**: a mutable dictionary from word or number keys to values, written with `{ key: value }`.
- **Record/struct**: a named, mutable, fixed-field aggregate declared with `struct`.
- **Field**: a named slot in a record/struct, accessed with `.field`.
- **Key**: a word or number used to access a dict entry.
- **Place**: an assignable variable, index, field, key, or nested chain such as `:people.tom.age`.
- **Block**: a list of instructions used as a body, written `[ ]` inline or multiline, or `… end` (preferred for multi-line bodies). A control body is always delimited.
- **Procedure**: a learner-defined callable introduced with `define` or heritage `to`.
- **Reporter**: a callable that produces a value.
- **Command**: a callable that performs an effect and returns no value.
- **Special form**: syntax whose parts are parsed by fixed keyword slots rather than ordinary prefix arity.
- **Primitive**: a built-in command, reporter, or special form specified by the language.
- **Comprehension**: one of `map`, `filter`, or `reduce`, using a binder and expression block to compute from a list.
- **Alias**: an alternate name registered for an existing primitive, procedure, or keyword.
- **Learner**: the person writing OpenLogo programs, from early beginners through advanced students.
- **Profile**: a conformance feature set such as Core Language, Turtle & Rendering, Data, Sprites, or Tutor.

## References

- Abelson, Goodman, and Rudolph, **The LOGO Manual**, MIT AI Memo AIM-313, 1974: <https://dspace.mit.edu/entities/publication/b3a67090-ad15-42da-98f4-df0a568c559b>
- Logo Foundation history and language pages: <https://web.archive.org/web/20110815060633/http://el.media.mit.edu/logo-foundation/logo/index.html>
- Stefik and Siebert, **An Empirical Investigation into Programming Language Syntax**, ACM TOCE, 2013.

## License

OpenLogo is licensed under the **MIT License**. See [../LICENSE](../LICENSE).

## Contributing

Contributions should preserve the v0.1.0 language contract, update cross-links when adding or moving spec content, and follow [style-guide.md](style-guide.md) and [tooling.md](tooling.md). Until a dedicated contributing guide exists, use repository issues or pull requests and cite the relevant spec file.

