# 5. Profiles and the conformance DAG

- Status: Accepted
- Date: 2026
- Deciders: OpenLogo maintainer (@pmalarme) + team

## Context

Every language project that wants to grow past its first release has to answer the same
question: how do you let the feature set expand over time without forcing every implementation,
every learner, and every program to carry the whole language at once? The classic answer is a
single, monolithic **spec version**: "OpenLogo 0.1", "OpenLogo 0.2", each a strictly bigger
superset of the last, and an implementation either targets a version or it doesn't. That answer
is simple to state, but it is a poor fit for OpenLogo's actual shape. OpenLogo bundles several
things that are conceptually independent — a small procedural core, turtle graphics, structured
data, alternate ("Heritage") spellings for classic-Logo migrants, sprites, events, sound, modules,
and an educational/AI coaching layer — and a version-gated spec would force every implementation
(and every learner level) to adopt all of them together or none of them, and would force the
*build order* of this very project into an arbitrary big-bang sequence rather than the dependency
order the features actually have.

We needed a way to (1) let an implementation credibly claim "I support OpenLogo" while only
building a minimal, genuinely useful subset; (2) let optional capabilities (Data, Geometry,
Sprites, Sound, the AI tutor, …) be added independently, by different teams, on different
timelines, without waiting on each other; and (3) let curriculum levels map onto what a given
implementation actually supports, instead of assuming every learner-facing feature is always
present.

## Decision

`spec/conformance.md` defines conformance in terms of **profiles** — named, independently
implementable capability sets — rather than a single monolithic version number. **Core Language**
and **Turtle & Rendering** together define the **minimal conforming OpenLogo implementation**
(`spec/conformance.md#required-profiles`, `#core-language`, `#turtle--rendering`,
`#conformance-claims`). A Core-only evaluator MAY still claim support for just the **Core
Language** profile, but it MUST NOT call itself a minimal conforming OpenLogo implementation
(`spec/conformance.md#conformance-claims`) — so Core Language is the one profile every claim
implies, while Turtle & Rendering is required specifically to earn the "minimal conforming"
label. Every other profile is **optional**: **Data**, **Geometry**, **Heritage**, **Sprites**,
**Interaction & Events**, **Sound**, **Modules**, **Localization**, **Educational**, and
**Tutor (AI)** (`spec/conformance.md#optional-profiles`).

Profiles are related by an explicit **dependency DAG**
(`spec/conformance.md#profile-dependency-dag`):

```text
Core Language
├─ Turtle & Rendering
│  ├─ Geometry        (also depends on Data)
│  └─ Sprites
├─ Data
├─ Heritage           (also depends on Data)
├─ Interaction & Events
├─ Sound
├─ Modules
│  └─ Localization
└─ Educational
   └─ Tutor (AI)
```

A conformance claim MUST include every transitive dependency of the profiles it declares — e.g.
claiming **Geometry** also requires claiming **Data** and **Turtle & Rendering**, and claiming
**Tutor (AI)** also requires claiming **Educational**
(`spec/conformance.md#profile-dependency-dag`). The minimal conformance path is exactly
`Core Language → Turtle & Rendering` (`spec/conformance.md#profile-dependency-dag`, "The required
minimal conformance path is"). Every feature in the language belongs to exactly one owning
profile, tracked in the feature-to-profile table
(`spec/conformance.md#feature-to-profile-table`). A conformance claim MUST identify the
implementation name and version, the supported spec version, its supported profiles (plus every
transitive dependency of each), the supported rendering target(s) when claiming Turtle &
Rendering, and any extensions (`spec/conformance.md#conformance-claims`) — the profile set with
its dependency closure is one required part of that claim, not the whole of it.
Learner **levels are explicitly not profiles**: levels are curriculum's sequencing model
(`spec/educational-model.md`), profiles are implementation capability sets
(`spec/conformance.md#conformance-claims`, "Learner levels are not profiles").

## Rationale

A profile DAG lets an implementation be honest and useful at every point on its build-out, instead
of only being "conformant" once it implements everything. A hobby implementation, a classroom tool
running in a constrained sandbox, or a first milestone of this very project can truthfully claim
just **Core Language** while it is still building out rendering, or **Core Language + Turtle &
Rendering** once it can also draw — the latter earning the "minimal conforming OpenLogo
implementation" label, the former a smaller but still real and checkable claim
(`spec/conformance.md#conformance-claims`). Nothing about either claim is a lie or a "coming
soon"; each is a real, checkable conformance level, and this project proves each with its own
stack-neutral conformance fixtures under `tests/conformance/`.

Declaring profiles instead of a version number also decouples the *rate of growth* of unrelated
capabilities. Turtle rendering, structured data, sprites, sound, and the AI tutor have almost
nothing to do with one another technically, are owned by different specialists on this team (see
`docs/architecture.md`'s ownership table), and have wildly different implementation cost and
maturity. Bundling them behind one version number would mean the whole language's version bumps
whenever *any* profile changes, and an implementer who only cares about turtle graphics would still
have to track sound-primitive changes to know if they're "on the latest version." Profiles let
each capability area evolve, ship, and be conformance-tested on its own schedule, gated only by its
*declared* dependencies (e.g. Geometry can't ship before Data and Turtle & Rendering, but Sound
and Sprites have no ordering constraint on each other at all).

Finally, an explicit DAG — rather than an implicit "everyone knows Geometry needs Data" — makes
the dependency **checkable**. A conformance claim that lists Geometry without Data is a
mechanically detectable error, not a judgment call. That same DAG structure gives curriculum a
clean way to describe what a given learner level requires: a level that only ever uses
`repeat`/`forward`/`right` needs nothing beyond Core + Turtle & Rendering; a level that
introduces dictionaries needs Data; a level that uses the AI tutor needs Tutor (AI) (and therefore
Educational). Levels can therefore be defined in terms of the profiles they exercise instead of an
opaque version number, and this repository's own build order
(`docs/delivery.md`, `.github/instructions/openlogo-team.instructions.md` §3) is sequenced along
that exact same DAG rather than an arbitrarily chosen phase list.

## How other languages do it

Most language ecosystems pick one of two strategies, and OpenLogo deliberately takes the second:

- **Edition/version gating.** ECMAScript ships one yearly edition (ES2015, ES2016, …) that is a
  cumulative, predominantly backward-compatible revision of the previous one; a *specification*
  conformance claim is keyed to that
  edition as a whole, so a feature (e.g. optional chaining) is not independently declarable apart
  from the year it shipped in, even though individual engines are free to implement features ahead
  of a formal claim. Python's `__future__` imports are a finer-grained variant of the same idea —
  a single flag opt-in per upcoming *language* change — but they are still keyed to specific
  interpreter versions and become unnecessary (though they remain accepted, as no-ops) once the
  behavior becomes the version default, so they
  describe a *migration path* through one version timeline rather than a standing, independently
  composable capability. Both approaches make "which version do you support" the central
  conformance question, and both make an unrelated pair of features (say, generators and a new
  numeric literal syntax) ship in lockstep purely because they landed in the same edition cycle.
- **Modular/profile-based standards.** WebAssembly instead ships a small stable **core**
  specification plus a long list of independently developed **proposals** (e.g. reference types,
  tail calls, threads), each maturing on its own timeline; a
  runtime is a conformant WebAssembly Core implementation on its own, and tooling
  queries *which proposals* it additionally supports rather than treating proposal adoption as
  part of one indivisible edition. That per-proposal detection is not itself standardized, though:
  hosts probe support empirically (validating a small module that uses the feature) or lean on
  community libraries such as `wasm-feature-detect`. OpenLogo's profiles go a step further than
  WASM's proposal-by-proposal detection by standardizing the capability names and their dependency
  closure directly in the spec, rather than leaving "which combination is coherent" to tooling
  convention. POSIX takes a
  related approach with its named conformance **option groups** (e.g. `_POSIX_THREADS`,
  `_POSIX_REALTIME_SIGNALS`): a system is POSIX-conformant at a base level and separately declares
  which optional facilities it provides, rather than claiming one indivisible "POSIX edition."

OpenLogo's profile DAG follows the second family: a small required core (Core Language + Turtle &
Rendering) plus named, independently declarable, dependency-checked optional profiles — closer to
WASM proposals or POSIX option groups than to an ECMAScript yearly edition or a Python
`__future__` flag.

## Consequences

- **Enables incremental, parallel implementation.** This repository's own milestone structure
  mirrors the DAG directly: Core Language and Turtle & Rendering land first as the minimal
  conforming path, and optional profiles (Data, Geometry, Heritage, Sprites, Interaction & Events,
  Sound, Modules → Localization, Educational → Tutor (AI)) are built out afterward, each only
  blocked on its own declared dependencies rather than on each other or on a single release train
  (`.github/instructions/openlogo-team.instructions.md` §3, `docs/delivery.md`).
- **Curriculum can target real capability sets.** Learner levels can be described in terms of
  which profiles they exercise instead of an opaque version number, so a classroom tool that only
  ships Core + Turtle & Rendering can still be a fully conformant target for early levels
  (`spec/conformance.md#conformance-claims`).
- **Requires careful, checkable dependency management.** Because profiles compose, the DAG must
  stay accurate and the spec must state every real dependency explicitly (Geometry → Data,
  Heritage → Data, Tutor (AI) → Educational): an implementation cannot silently redefine or
  half-implement a dependency's behavior just because it isn't the profile it primarily set out to
  build (`spec/conformance.md#profile-dependency-dag`, `#extensions-and-feature-detection`).
- **Conformance claims are compositional, not binary.** "Conformant" is no longer a single
  yes/no; an implementation's claim is the specific set of profiles (plus their transitive
  dependencies) it supports, and two implementations can both be fully conformant while
  supporting different, non-overlapping optional profiles.

Spec reference: [`spec/conformance.md`](../../spec/conformance.md), specifically the
[Required profiles](../../spec/conformance.md#required-profiles),
[Optional profiles](../../spec/conformance.md#optional-profiles),
[Feature to profile table](../../spec/conformance.md#feature-to-profile-table), and
[Profile dependency DAG](../../spec/conformance.md#profile-dependency-dag) sections.
