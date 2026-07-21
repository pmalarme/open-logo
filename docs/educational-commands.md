# Educational commands reference

> The four Educational-profile meta-commands — `explain`, `why`, `hint`, and `debug` — that help a
> learner without ever handing over a finished solution. Signatures are normative in
> [`spec/conformance.md`](../spec/conformance.md#educational); their teaching behavior is owned by
> [`spec/educational-model.md`](../spec/educational-model.md). Implemented in `@openlogo/edu`
> (`packages/edu/src/tutor/explain-why.ts`, `packages/edu/src/tutor/hint.ts`,
> `packages/edu/src/debug.ts`).

## Overview

All four commands share the same shape and the same guarantees:

| Name | Kind | Arity | Result | Profile | Learner level |
|---|---:|---:|---|---|---|
| `explain` | Command | 0 | none (tutor output) | Educational | any |
| `why` | Command | 0 | none (tutor output) | Educational | any |
| `hint` | Command | 0 | none (tutor output) | Educational | any |
| `debug` | Command | 0 | none (tutor output) | Educational | any |

- Each is invoked as a **bare word** with no inputs — there is nothing to pass in parentheses or
  after the command name.
- Each is a **Command**, not a reporter: it produces no value a caller can use, only a
  `tutor-output` trace event (`spec/execution-model.md#tutor-output-educational-profile`) carrying
  the learner-facing message.
- Each is **deterministic, offline, and template-based** — no AI is required. The same program,
  the same selected instruction, and the same execution trace always produce the same message. The
  AI-enhanced `challenge` command has the same bare-word shape but belongs to the separate Tutor
  (AI) profile (`spec/ai-tutor.md`) and is out of scope here.
- Each is **available at any learner level** — these are not level-gated like curriculum content;
  a Level 1 learner and a Level 5 learner can both call `explain` on whatever they are looking at.
- None of the four ever prints a **complete, ready-to-run solution**. This is a normative guardrail
  of the Educational profile (`spec/conformance.md#educational`), not just a style preference.

## `explain`

Describes what a selected instruction or short program does, in learner language.

**Behavior:**

- Names the command or special form.
- Says what inputs it uses.
- Says what visible or stored effect it has.
- Links the idea to the current level.
- Never rewrites the learner's whole program.

**Example:**

```logo
# why: explain should name the idea without solving the next challenge
repeat 4
  forward 80
  right 90
end repeat
```

Possible response: "`repeat` runs the block four times. Each time, the turtle moves forward and
turns right. The repeated side-and-turn pattern makes a square."

## `why`

Uses the execution trace to answer why something happened — the instruction, state, or comparison
that caused a result.

**Behavior:**

- Identifies the source instruction.
- Uses the turtle state or variable value at that moment.
- Explains the cause in one or two steps.
- When an error happened, links to the diagnostic shape in
  [`spec/error-model.md`](../spec/error-model.md) (the `tutor-output` event's optional
  `diagnostic-code` field names the `ol-*` code).

**Example:**

```logo
# why: the color changes because the comparison is true
:sides = 4
if :sides == 4
  set_color "green"
else
  set_color "purple"
end if
```

Possible response: "The turtle became green because `:sides == 4` was `true`, so OpenLogo ran the
first block."

## `hint`

Progressive: never reveals a full solution. The same request moves through four stages only when
the learner asks again for the same target (or the environment remembers earlier hints for that
`target-source-span`) — a fresh target always restarts at the first stage.

**Progression:**

1. **Nudge** — point attention to the relevant place.
2. **Concept** — name the concept that may help.
3. **Partial** — show a small pattern with different names or numbers.
4. **Last-resort** — describe the next step, still without giving the complete answer. Requests
   after `last-resort` repeat `last-resort` rather than escalate further or reveal the solution.

**Example progression**, for a challenge to draw a pentagon:

```logo
# why: a regular pentagon needs five equal turns that add to a full turn
repeat 5
  forward 60
  right 360 / 5
end repeat
```

- Nudge: "Look at the turn after each side. How many equal turns make a full turn?"
- Concept: "A full turn is `360` degrees, and a regular polygon divides that by the number of
  sides."
- Partial: "For a shape with `:sides`, the turn can use `360 / :sides`."
- Last-resort: "Try using `repeat 5` with one `forward` and one `right 360 / 5` inside the block."

Even the last-resort hint never presents the whole final program.

## `debug`

Helps a learner inspect what happened without exposing implementation stack traces or a fix.

**Behavior:**

- Shows the current instruction.
- Shows relevant variable values.
- Shows turtle state when useful: position, heading, pen, color, width.
- For procedures, shows a friendly call path.
- For errors, includes the stable `ol-*` code and a learner message
  ([`spec/error-model.md`](../spec/error-model.md)).
- Suggests one next investigation step, not a full fix.

**Example:**

```logo
# why: debug can show that :size is a word when forward needs a number
:size = "big"
forward :size
```

Possible response: "`forward` needs a number to tell it how far to go. Here `:size` is the word
`"big"`. Diagnostic: `ol-type`."

## See also

- [`spec/educational-model.md`](../spec/educational-model.md) — the full pedagogy behind these four
  commands, the discovery guardrails they protect, and the 8-level curriculum they support.
- [Curriculum overview](curriculum-overview.md) — the Level 1–5 lessons a learner works through
  while these commands are available alongside every one of them.
- [`spec/ai-tutor.md`](../spec/ai-tutor.md) — the Socratic, AI-enhanced `challenge` command that
  degrades to this deterministic baseline when the AI backend is unavailable.
