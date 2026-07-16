> OpenLogo Specification v0.1.0 — Draft (Status: Normative)

# Interaction Events

[Back to the specification index.](README.md)

This document is normative for the optional **Interaction & Events** profile and
the optional **Sound** profile. It realizes the Interaction & Sound rows of the
[C3 canonical primitive matrix](commands.md) and uses the execution event stream
defined in [the execution model](execution-model.md). OpenLogo **Core** remains
non-interactive: `input` is defined here, not in Core, and every feature in this
file is optional unless an implementation declares the corresponding profile.

The locked OpenLogo surface applies here: variables are written with `:name`,
assignment uses `=`, equality uses `==`, strings are closed double-quoted words,
blocks are `[ … ]` or `… end` under the block-result rule — a long event block
closes with `end` or `end <keyword>` (`end when`, `end every`, `end on_key`, or
`end on_click`) — and examples do not use arrays, lambdas, or commas.

## Profiles and reservation

The **Interaction & Events** profile contains:

| Form | Kind | Args | Result | Required by |
|---|---:|---|---|---|
| `input <prompt>` | R | prompt | word or number | Interaction & Events |
| `when <event-word> <block>` | S | event-word, block | — | Interaction & Events |
| `every <n> <block>` | S | number, block | — | Interaction & Events |
| `on_key <key-word> <block>` | S | key-word, block | — | Interaction & Events |
| `on_click <block>` | S | block | — | Interaction & Events |
| `wait <n>` | C | number | — | Interaction & Events |

The **Sound** profile contains:

| Form | Kind | Args | Result | Required by |
|---|---:|---|---|---|
| `note <pitch-word> <duration>` | C | word, number | — | Sound |
| `play <melody-list>` | C | list | — | Sound |
| `beep` | C | 0 | — | Sound |
| `rest <duration>` | C | number | — | Sound |
| `set_tempo <beats-per-minute>` | C | number | — | Sound |

`when`, `every`, `on_key`, and `on_click` are profile block-heads. They are
reserved **only within the Interaction & Events profile**. An implementation
that does not declare this profile does not reserve those words except through a
vendor extension or an imported alias. Sound command names are ordinary
primitive names when the Sound profile is present.

## Profile grammar

When the Interaction & Events profile is active, the Core `statement` production (see [grammar.md](grammar.md#profile-grammar-extensions)) gains these forms. They reuse the Core `expression`, `bracket-block`, `statement`, and `terminator` productions.

```logo
interaction-statement ::= when-statement | every-statement
                        | on-key-statement | on-click-statement
when-statement        ::= "when" expression event-block-tail
every-statement       ::= "every" expression event-block-tail
on-key-statement      ::= "on_key" expression event-block-tail
on-click-statement    ::= "on_click" event-block-tail
event-block-tail      ::= bracket-block
                        | terminator { statement terminator } event-end
event-end             ::= "end" [ "when" | "every" | "on_key" | "on_click" ]
```

Each block head takes its arguments — an event word, a tick count, or a key word, while `on_click` takes none — followed by a block. A labeled `end` MUST match its opener; a mismatched label raises `ol-mismatched-end`. `input` and `wait` are ordinary calls and take no block.

## Time, ticks, and handlers

Interaction time is measured in **ticks**. A tick is an implementation-defined
logical frame used by rendering, animation, and event dispatch. Implementations
SHOULD document the default tick rate and SHOULD allow slower execution for
stepping and classroom demonstrations. `wait` and `every` use this same tick
clock.

Handlers are registered during program execution. Registering a handler does not
run its block immediately unless the triggering event is already being delivered
by the implementation. A handler block is a normal OpenLogo block: it is a list
of instructions, it runs for effects, and any final value is discarded under the
block-result rule.

When an event fires, the implementation enqueues a handler invocation. Handler
invocations MUST run on the same OpenLogo execution thread as ordinary
instructions so learner-visible state changes remain deterministic. If several
events are ready in the same tick, they are delivered in this order:

1. pending `when` events in registration order
2. pending `on_key` events in registration order
3. pending `on_click` events in registration order
4. due `every` events in registration order

An implementation MAY coalesce high-frequency input events while a program is
paused or blocked, but MUST preserve the most recent key and click state needed
to deliver the next handler consistently.

## Trace stream integration

Interaction and sound behavior is tied to the normative trace stream in
[the trace and event registry](execution-model.md#trace-and-event-registry). Each handler invocation emits the same common event
envelope as ordinary execution: monotonic `seq`, `kind`, `source-span`,
optional `turtle-id`, and a typed payload.

The start of a handler block emits an `instruction` event for the block-head
that caused the handler to run. Every effect produced by the handler then emits
the normal after-effect events: movement emits `move` and `draw-segment`,
printing emits `print`, sound emits `sound`, and primitives without a more
specific kind emit `primitive`.

`input` is the only blocking read in OpenLogo v0.1. While `input` is waiting,
the implementation MAY continue rendering already-emitted trace events, but it
MUST NOT run new OpenLogo instructions or event handler blocks until the read
finishes or the program is cancelled.

`wait` emits a `primitive` event after the pause completes. Sound commands emit
`sound` events after sound state has been scheduled. Event registration forms
emit `primitive` events after the handler is registered.

## Interaction primitives

### `input <prompt>`

- **Kind:** reporter
- **Args:** one prompt value, normally a word
- **Result:** a word or number
- **Errors:** `ol-type` if the prompt cannot be displayed as learner text
- **Concept:** explicit human input

`input` displays the prompt and waits for the learner to enter one value. It is
the only blocking read in OpenLogo v0.1 and belongs to this profile, not Core.
If the submitted text parses as an OpenLogo number literal, the reporter returns
a number. Otherwise it returns a word preserving the entered text.

```logo
:name = input "what is your name?"
print word "hello " :name
```

### `when <event-word> <block>`

- **Kind:** special form
- **Args:** one event word and one block
- **Result:** none
- **Errors:** `ol-type` if the event is not a word
- **Concept:** named event handling

`when` registers a block for an implementation-defined named event. Standard
event words are intentionally small in v0.1: `"start"` for the start of the
interactive run and `"stop"` for a requested stop notification before
termination. Implementations MAY add vendor events with a dotted vendor prefix,
such as `"acme.shake"`.

```logo
when "start" [
  print "ready"
]
```

### `every <n> <block>`

- **Kind:** special form
- **Args:** tick count and one block
- **Result:** none
- **Errors:** `ol-type`, `ol-range`
- **Concept:** repeated timed action

`every` registers a block to run every `n` ticks. `n` MUST be a positive number.
The first run occurs after `n` ticks have elapsed. If a prior invocation is
still running when the next interval arrives, the implementation queues at most
one pending invocation for that `every` handler to prevent unbounded buildup.

```logo
every 30 [
  right 15
  forward 10
]
```

### `on_key <key-word> <block>`

- **Kind:** special form
- **Args:** key word and one block
- **Result:** none
- **Errors:** `ol-type`
- **Concept:** keyboard control

`on_key` registers a block to run when the named key is pressed. Key words are
lowercase words such as `"space"`, `"enter"`, `"left"`, `"right"`, `"up"`,
`"down"`, or a single printable character word such as `"a"`. Implementations
SHOULD document their supported key words and SHOULD normalize physical keyboard
input to those lowercase words for accessibility.

```logo
on_key "space" [
  forward 20
]
```

### `on_click <block>`

- **Kind:** special form
- **Args:** one block
- **Result:** none
- **Errors:** none
- **Concept:** pointer input

`on_click` registers a block to run when the drawing surface is clicked or
activated by an equivalent accessible action. The click position is exposed by
implementation-defined read-only variables only if the implementation documents
them as an extension. OpenLogo v0.1 does not standardize click coordinate
reporters.

```logo
on_click [
  stamp
]
```

### `wait <n>`

- **Kind:** command
- **Args:** tick count
- **Result:** none
- **Errors:** `ol-type`, `ol-range`
- **Concept:** time and animation pacing

`wait` pauses the current program for `n` ticks. `n` MUST be a non-negative
number. `wait 0` yields to the renderer and event loop without adding a visible
delay. Turtle and geometry documents may reference `wait` for animation, but
this document owns its definition.

```logo
repeat 36
  forward 5
  right 10
  wait 2
end repeat
```

## Sound primitives

Sound commands are optional and side-effecting. Implementations that cannot play
audio, or that run in a muted classroom environment, MUST still emit `sound`
trace events and SHOULD provide a visible or textual substitute. This keeps
debugging and replay deterministic even when audio output is unavailable.

The Sound profile is inspired by Logo heritage including the music facilities
described around the MIT Logo work in AIM-313, but OpenLogo uses the modern
closed-word syntax and tick-based timing defined in this specification.

### `set_tempo <beats-per-minute>`

- **Kind:** command
- **Args:** one positive number
- **Result:** none
- **Errors:** `ol-type`, `ol-range`
- **Concept:** shared timing

`set_tempo` sets the tempo used by `note`, `play`, and `rest`. The default tempo
is 120 beats per minute. Durations are measured in beats.

```logo
set_tempo 90
```

### `note <pitch-word> <duration>`

- **Kind:** command
- **Args:** pitch word and duration number
- **Result:** none
- **Errors:** `ol-type`, `ol-range`
- **Concept:** pitch and duration

`note` schedules one pitched sound. Pitch words use scientific pitch notation
with lowercase canonical spelling, such as `"c4"`, `"fs4"` for F sharp, and
`"bb3"` for B flat. Duration MUST be positive and is interpreted in beats at the
current tempo.

```logo
note "c4" 1
note "e4" 1
note "g4" 2
```

### `play <melody-list>`

- **Kind:** command
- **Args:** one list
- **Result:** none
- **Errors:** `ol-type`, `ol-range`
- **Concept:** sequencing

`play` schedules a melody list. The list contains pitch and duration pairs in
sequence. Each pitch is a word accepted by `note` or the word `"rest"`. Each
duration is a positive number. The list length MUST be even.

```logo
play ["c4" 1 "e4" 1 "g4" 2 "rest" 1 "g4" 1]
```

### `beep`

- **Kind:** command
- **Args:** none
- **Result:** none
- **Errors:** none
- **Concept:** simple feedback

`beep` schedules one short implementation-defined alert sound. It is intended
for beginner feedback and accessibility substitutes rather than precise music.

```logo
if :score == 10
  beep
end if
```

### `rest <duration>`

- **Kind:** command
- **Args:** duration number
- **Result:** none
- **Errors:** `ol-type`, `ol-range`
- **Concept:** silence as part of rhythm

`rest` schedules silence for the given duration in beats at the current tempo.
It emits a `sound` trace event so replay tools can show the silent interval.

```logo
note "c4" 1
rest 1
note "c4" 1
```

## Errors and cancellation

Interaction handlers and sound commands use the diagnostic shape defined in
[the error model](error-model.md). The most common errors are:

| Code | Applies to | Meaning |
|---|---|---|
| `ol-type` | `input`, `when`, `every`, `on_key`, `wait`, sound commands | an argument has the wrong type |
| `ol-range` | `every`, `wait`, `note`, `play`, `rest`, `set_tempo` | a number is outside the allowed range |
| `ol-limit` | handler execution | an instruction budget or cancellation limit was reached |

Cancellation MUST be available while a program is waiting for input, waiting for
ticks, running handlers, or playing sound. Cancellation stops future handler
delivery and sound scheduling, emits the standard error or cancellation trace
behavior, and leaves already-emitted trace events available for debugging.

## Conformance

An implementation declaring **Interaction & Events** conformance MUST implement
`input`, `when`, `every`, `on_key`, `on_click`, `wait`, handler scheduling,
tick semantics, cancellation, and the trace integration above.

An implementation declaring **Sound** conformance MUST implement `note`, `play`,
`beep`, `rest`, `set_tempo`, tempo semantics, graceful muted operation, and
`sound` trace events.

The profiles are independent: a text-only implementation may support
Interaction & Events without Sound, and a scripted renderer may support Sound
without real-time keyboard or pointer events.
