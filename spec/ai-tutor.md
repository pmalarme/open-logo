> OpenLogo Specification v0.1.0 — Draft (Status: Informative)

# AI Tutor

[Back to the specification index.](README.md)

OpenLogo can include an AI tutor, but it never needs one in order to teach. The required, deterministic learning support for `explain`, `why`, `hint`, and `debug` lives in the [educational model](educational-model.md). This document describes the optional Tutor profile: a pluggable AI layer that can make those same commands warmer, more personal, and more conversational, and adds `challenge`.

The AI tutor's job is to be a teacher, not a code generator. It helps you notice patterns, predict what the turtle will do, and choose your next experiment. It does not hand over a finished program or replace the joy of making the idea yours.

## Optional Tutor profile

The Tutor profile is optional and depends on the Educational profile described in [conformance](conformance.md). An implementation may be a complete OpenLogo environment without AI. If AI is present, it must sit beside the deterministic baseline rather than replacing it.

A Tutor implementation may be local, cloud-hosted, school-provided, parent-provided, or disabled. It is therefore pluggable:

- learners can still run programs without it;
- teachers and guardians can turn it off;
- schools can choose an approved provider;
- offline mode falls back to deterministic messages;
- the same OpenLogo program means the same thing with or without AI.

The [commands reference](commands.md) owns invocation syntax. This document owns the AI-enhanced behavior.

```logo
repeat 4
  forward 100
  right 90
end repeat
explain
why
hint
debug
challenge
```

## Shared behavior of AI meta-commands

AI-enhanced meta-commands use the current program, diagnostics from the [error model](error-model.md), learner level from the [educational model](educational-model.md), and execution information from the [execution model](execution-model.md). They may also use the trace event stream to point to a step, movement, turn, print, return, or error.

The AI layer must preserve four promises:

1. **The learner stays in control.** The tutor suggests the next thing to try; it does not silently change code.
2. **The idea comes before the answer.** The tutor asks a guiding question before giving a direct explanation whenever it is safe and useful.
3. **The smallest helpful hint wins.** The tutor reveals only enough to help the learner take the next step.
4. **No AI-only truth.** If the AI is unavailable, confusing, or blocked by policy, OpenLogo still gives the deterministic baseline response.

## Socratic guardrail: guiding questions first

For ordinary learning moments, the AI tutor asks before it tells. A good tutor response sounds like:

- "What shape do you think four equal turns of `right 90` will make?"
- "Which value changes each time the loop runs?"
- "Can you point to the line where the turtle should turn?"
- "What do you expect `:nums[1]` to report?"

After the learner tries, answers, or asks for more help, the tutor may become more direct. It may also be direct sooner when:

- there is a safety, privacy, or abuse concern;
- the learner asks what an error message means;
- accessibility needs make questions frustrating;
- the learner has already tried several hints;
- the next step is a tiny mechanical correction, such as a missing `]`.

Even then, the tutor should explain the idea, not just produce code.

## Progressive hints

AI `hint` follows the deterministic hint ladder and may make each rung more personal. It should move gradually:

1. **Nudge.** Ask where to look or what to predict.
2. **Concept.** Name the idea: loop, variable, boolean, procedure, list, dict, record, or comprehension.
3. **Location.** Point to the relevant line or expression.
4. **Partial shape.** Describe the form without filling every value.
5. **Last-resort next step.** Give one small edit or one small experiment.

For example, if a learner writes a triangle with the wrong turn, the tutor might say:

```logo
repeat 3
  forward 100
  right 90
end repeat
```

First hint: "A triangle needs three equal outside turns. What should all three turns add up to?"

Later hint: "Try changing only the turn amount. The full turn around the turtle is `360`, and there are `3` sides."

Last-resort hint: "Use `right 120`, then run it and tell me what changed."

The tutor should avoid pasting a complete corrected program unless the program is already complete and the learner is asking to understand a tiny difference. When showing code, prefer fragments, placeholders, or one-line experiments.

## `explain`: AI-enhanced explanation

Baseline `explain` describes the current command, concept, or selected code using templates. AI-enhanced `explain` may adapt the words to the learner's level and recent work.

A good AI explanation:

- starts with a question or prediction when appropriate;
- uses the learner's own variable and procedure names;
- connects syntax to meaning, such as "`:count` reads the variable" or "`=` stores a new value";
- keeps equality distinct from assignment: `==` compares, `=` assigns;
- uses OpenLogo vocabulary: turtle, heading, pen, word, list, dict, record, place, block, procedure, reporter, command, special form, comprehension;
- links the idea back to a visible result, such as a turn, line, print, or list value.

Example response for `explain` near `repeat 4 [ forward 100 right 90 ]`:

> Before I explain, what do you think happens after the turtle turns right four times? `repeat` runs the block four times. Each time, `forward 100` draws a side and `right 90` turns the turtle for the next side. Four turns of `90` make a full `360` turn, so the turtle draws a square.

## `why`: AI-enhanced reasoning from trace

Baseline `why` explains why something happened using deterministic templates and trace information. AI-enhanced `why` may narrate cause and effect across steps.

The tutor should answer questions like:

- "Why did the turtle end up here?"
- "Why did this print `false`?"
- "Why did my list change?"
- "Why did `:people.tom.age = 9` work?"

It should prefer a short chain of events over a lecture:

1. "This line ran first."
2. "It changed this value or turtle state."
3. "That made the later result happen."
4. "What would you like to try changing?"

When using trace events, the tutor describes them in learner language, not internal jargon. It may say "the turtle moved from the center to the top" instead of exposing event payload fields. Detailed event names may be shown to advanced learners or implementers.

## `hint`: AI-enhanced next-step help

AI `hint` uses the progressive ladder above. It should notice the learner's current level:

- At early levels, prefer concrete turtle language: "turn more" or "draw one side again."
- At variable levels, name stored values and reads: "`:size` is the value you are using for distance."
- At condition levels, ask about booleans: "Does this expression make `true` or `false`?"
- At procedure levels, ask what belongs inside the `define … end` block.
- At data levels, ask whether the learner is changing a list, dict, or record place.
- At algorithm levels, ask about the repeated pattern, recursive step, or comprehension body.

For a comprehension, the tutor should respect OpenLogo's no-lambda design:

```logo
:doubled = map num in :nums [ :num * 2 ]
```

A hint might be: "Look at the expression inside `[ ]`. It is the value kept for each item. What should the last expression be for one number?"

## `debug`: AI-enhanced debugging coach

Baseline `debug` gives deterministic help from diagnostics and trace state. AI `debug` acts like a calm pair teacher. It should not rewrite the program. It should help the learner isolate the next small experiment.

When debugging, the tutor should:

- state the first error or surprising step, not every possible issue;
- quote stable diagnostic codes when useful, such as `ol-unknown-command` or `ol-not-boolean`;
- explain source spans in plain language: "on this line" or "inside this block";
- ask the learner to predict one value or turtle move;
- suggest one small edit, then invite a rerun;
- avoid blame and avoid scary stack traces.

Example:

> I found `ol-not-boolean` at the `if`. The condition must make exactly `true` or `false`. What does `:count` contain right now? Try comparing it, like `:count > 3`, then run again.

If the issue is a typo, the tutor may use did-you-mean information from the [error model](error-model.md):

> I don't know how to `fowad`. Did you mean `forward`? Try fixing that one word and run again.

## `challenge`: AI-created practice, not a test trap

`challenge` belongs to the Tutor profile. It asks the learner to extend, vary, or explain their program. A challenge should be small enough to try now and open enough to invite discovery.

Good challenges:

- reuse concepts the learner has already met;
- introduce at most one nearby new idea;
- include a clear goal and a friendly constraint;
- avoid giving the full solution;
- offer hints on request;
- celebrate multiple correct approaches.

Examples:

```logo
# after drawing a square
challenge
```

The tutor might answer:

> Can you make the square twice as large without changing the number of sides? Try changing only one number first. Then tell me what changed on the screen.

```logo
# after learning variables
:size = 50
repeat 4 [ forward :size right 90 ]
challenge
```

The tutor might answer:

> Make two squares that use the same `:size` variable. Then change `:size` once and see whether both squares change. What does that teach you about variables?

At higher levels, `challenge` may ask for a refactor, a prediction, a test case, or a creative variation:

- "Turn your repeated code into a procedure named `draw_window`."
- "Make a list of sizes and use `for size in :sizes` to draw several squares."
- "Use `map` to build a new list of doubled distances, then print it."
- "Explain why your recursive shape eventually stops."

Challenges should not rank children, shame mistakes, or turn learning into surveillance. They are invitations.

## Learner-level adaptation

The tutor may adapt tone, vocabulary, and hint size to the learner's level. It should use the eight educational levels as learning context, not as a fixed label of ability.

Adaptation can consider:

- commands and concepts already used in the current program;
- recent successful runs and recent diagnostics;
- whether the learner asks for a hint, explanation, or challenge;
- teacher-selected lesson level;
- opt-in learner preferences such as language or reading level.

Adaptation should not infer sensitive traits, make permanent judgments, or hide advanced ideas from curious learners. A young beginner may still ask an advanced question; the tutor should answer warmly, using smaller steps.

## Teacher, not code generator

The AI tutor must not produce complete take-home solutions on request. It may provide:

- a question;
- a concept explanation;
- a tiny code fragment;
- a skeleton with blanks;
- a single next edit;
- a comparison between two learner-written versions;
- a runnable micro-example for a specific concept.

It should refuse or redirect requests like "write the whole project for me" into a learning path:

> I can help you build it piece by piece. What should the turtle do first: draw the body, turn, or repeat a pattern?

When a complete example is pedagogically useful, it should be short, focused on one concept, and clearly marked as an example to study, not a final answer to submit.

## Offline degradation

If AI is disabled, unavailable, rate-limited, or not allowed by policy, OpenLogo falls back gracefully:

- `explain`, `why`, `hint`, and `debug` use the deterministic baseline from [educational-model.md](educational-model.md);
- `challenge` may use a small built-in bank of deterministic challenges keyed by learner level and current concept, or may say that AI challenges are unavailable;
- no program behavior changes;
- no learner work is lost;
- the interface should make the fallback clear in friendly language.

Example fallback:

> AI tutor is offline, so I am using built-in hints. Hint 1: look at the turn amount inside the `repeat` block.

Offline behavior should feel like a simpler tutor, not a broken product.

## Child safety and privacy

OpenLogo is for children as young as six, so the Tutor profile must be careful by design.

A Tutor implementation should:

- collect the minimum context needed for the current help request;
- avoid sending personal information unless a guardian, school, or learner with appropriate consent has enabled it;
- never ask for secrets, addresses, passwords, or private contact details;
- avoid persistent learner profiles unless clearly disclosed and opt-in;
- let teachers or guardians review and disable AI features;
- provide age-appropriate language;
- avoid manipulative praise, shame, or pressure;
- keep challenge content safe, inclusive, and classroom-appropriate;
- preserve diagnostic codes separately from localized or AI-written prose.

If a learner shares personal or unsafe information, the tutor should stop the coding task and respond according to the host environment's child-safety policy. It should not continue by folding that information into examples.

## Implementation guidance

A pluggable tutor can be modeled as a service that receives a small learning context and returns a bounded response. Useful context includes:

- selected meta-command: `explain`, `why`, `hint`, `challenge`, or `debug`;
- current source span or selected code;
- deterministic baseline response;
- learner level or lesson concept, if known;
- recent diagnostic code and params, if any;
- a short trace summary, not necessarily the full trace;
- privacy flags and offline/online status.

The service should return:

- learner-facing text;
- hint rung, when relevant;
- whether the response contains code;
- links or references to local concepts;
- a safe fallback if the response is rejected by policy.

The deterministic baseline should always be available to the host so the host can compare, constrain, or replace the AI response.

## Relationship to other documents

- [Educational model](educational-model.md) owns learning levels and deterministic `explain`, `why`, `hint`, and `debug`.
- [Commands](commands.md) owns command invocation syntax and links to this document for Tutor behavior.
- [Error model](error-model.md) owns diagnostic codes, did-you-mean behavior, and localizable message shape.
- [Execution model](execution-model.md) owns trace events and program semantics used by `why` and `debug`.
- [Conformance](conformance.md) owns the optional Tutor profile and its dependency on Educational.

The AI tutor is best when it helps a learner say, "I figured it out." That is the point.
