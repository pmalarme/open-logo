> OpenLogo Specification v0.1.0 — Draft (Status: Normative)

# Turtles and Sprites Profile

[Back to the specification index](README.md).

This document defines the optional **Sprites** profile for OpenLogo. It extends the required [Turtle & Rendering](conformance.md#turtle--rendering) model with multiple addressable turtles, sprite-like shapes, and profile-local block heads for agent-based drawings and simulations. The model follows the lineage of StarLogo, NetLogo, and MicroWorlds while keeping the OpenLogo surface small and readable.

## Profile status and dependency

The Sprites profile is **Normative** when an implementation declares support for it. It depends on the Turtle & Rendering profile because per-turtle state and effects are expressed through the Turtle commands defined in [commands.md](commands.md). Conformance and profile discovery are owned by [conformance.md](conformance.md).

The profile adds the `turtle` value type. Turtle values compare by identity, not by position or shape. OpenLogo v0.1 has no arrays and no first-class procedure values; a turtle set is represented with the existing `list` type.

## Canonical forms

The C3 Sprites rows are authoritative and are realized here with these exact forms: `new_turtle` → turtle (R, 0); `tell <turtle|turtle-list>` (C, set the addressed turtle(s)); `ask <turtle|turtle-list> <block>` (S, run the block for those turtles); `each <block>` (S, run once per turtle in the current tell/ask set); `turtles` → list (R, 0); `who` → turtle (R, 0).

| Form | Kind | Args | Result | Meaning |
|---|---:|---|---|---|
| `new_turtle` | R | 0 | turtle | Create and report a new turtle. |
| `tell <turtle|turtle-list>` | C | turtle or list of turtles | — | Set the addressed turtle or turtles. |
| `ask <turtle|turtle-list> <block>` | S | turtle or list of turtles, block | — | Run the block for those turtles. |
| `each <block>` | S | block | — | Run once per turtle in the current `tell` or `ask` set. |
| `turtles` | R | 0 | list | Report the current list of turtles. |
| `who` | R | 0 | turtle | Report the turtle currently running turtle commands. |

The full underscored names are primary. Implementations MAY expose aliases through the [aliasing model](localization.md), but examples and teaching material SHOULD prefer `new_turtle` and the other full names.

## Turtle creation

`new_turtle` creates a fresh turtle with its own state: position, heading, pen state, color, width, visibility, and shape. The initial state for a new turtle follows the same turtle defaults as the main turtle in [commands.md](commands.md) and [execution-model.md](execution-model.md): origin at the canvas center, heading `0` degrees up, pen down, color `"black"`, width `1`, visible, and the implementation's default turtle shape.

Creating a turtle emits the `spawn-turtle` trace event defined in [execution-model.md](execution-model.md#trace-and-event-registry). The event is an effect event, so it is emitted immediately after the new turtle exists. Its envelope includes the common `seq`, `kind`, `source-span`, optional `turtle-id`, and `payload` fields. The payload MUST identify the newly created turtle and SHOULD include its initial visible state for renderers and debuggers.

```logo
:leader = who
:friend = new_turtle
print :friend
```

## Addressing model

At any moment, turtle commands run for an **addressed set**. In a program without the Sprites profile, the addressed set contains the single default turtle. In this profile, `tell`, `ask`, and `each` control that set. One rule governs all three: `tell` changes who is addressed and the change stays, while `ask` and `each` restore whatever was addressed before them when their block ends, regardless of what happened inside.

`tell <turtle|turtle-list>` is a command that changes the current addressed set for subsequent turtle commands. Its input is either one turtle value or a list whose items are turtle values. The change persists until the next `tell` or until an enclosing `ask` or `each` block ends. The addressed set is **world state**, in the same category as a turtle's position, heading, pen state, color, and visibility — it is not a variable binding. A procedure that runs `tell` therefore leaves the addressed set changed for its caller, exactly as a procedure that runs `forward` leaves the turtle moved and one that runs `pen_up` leaves the pen up. This is consistent with, not an exception to, the scoping rules in [execution-model.md](execution-model.md#variables-scoping-and-procedures): a procedure boundary seals **variables**, and changing the world is what procedures are for. `ask` and `each` are the only forms that scope the addressed set.

```logo
:a = new_turtle
:b = new_turtle
tell [ :a :b ]
forward 50
right 90
```

After the `tell`, `forward` and `right` apply to both `:a` and `:b`. A later `tell :a` narrows the addressed set to one turtle.

`ask <turtle|turtle-list> <block>` is a special form that temporarily runs a block for the given turtle or turtle list. The previous addressed set is restored after the block finishes. Restoration happens on **every** exit path — normal completion, `stop`, `return`, and a diagnostic raised inside the block, including `throw` — and regardless of what the block did: a `tell` inside the block, or inside a procedure the block calls, takes effect for the rest of the block and is discarded with the `ask` scope. Restoring is what distinguishes `ask` from `tell`; without it, `ask :b <block>` would mean the same as `tell :b`. The block follows the normal OpenLogo block forms and the block-result rule: it is a list of instructions run for effects and reports no value.

```logo
:t = new_turtle
ask :t [
  set_color "red"
  forward 80
]
forward 20
```

The final `forward 20` runs for the addressed set that was active before `ask`. The same `ask` may be written in long form, which closes with `end` or `end ask`:

```logo
ask :t
  set_color "red"
  forward 80
end ask
```

`each <block>` runs its block once per turtle in the current `tell` or `ask` set. During each run, `who` reports the turtle for that iteration, and Turtle commands affect only that turtle unless the program changes the addressed set again; such a change applies to the rest of that iteration only, because the next iteration addresses its own turtle. `each` fixes the turtles it will visit before its first iteration, so a `tell` inside the block never changes which turtles `each` iterates. Like `ask`, `each` restores the addressed set that was active before it, on **every** exit path — normal completion, `stop`, `return`, and a diagnostic raised inside the block, including `throw` — and regardless of what the block did. In long form an `each` block closes with `end` or `end each`.

```logo
:a = new_turtle
:b = new_turtle
tell [ :a :b ]
each [
  print who
  forward 40
  right 120
]
```

`turtles` reports the current list of turtles known to the world. The list includes the initial turtle and every turtle created with `new_turtle`. Programs can store that list, pass it to `tell` or `ask`, and use the list operations from [data-structures.md](data-structures.md).

```logo
ask turtles [
  each [
    pen_up
    home
    pen_down
  ]
]
```

## Per-turtle state and Turtle commands

Per-turtle state uses the Turtle commands from [commands.md](commands.md). The movement reporters and commands are evaluated for the current turtle:

- `forward`, `back`, `left`, `right`, `home`, `set_xy`, and `set_heading` update the current turtle.
- `xcor`, `ycor`, `heading`, `pos`, `towards`, and `distance` read from the current turtle.
- `pen_up`, `pen_down`, `set_color`, `set_width`, `fill`, and `stamp` use the current turtle's pen and shape state.
- `show_turtle`, `hide_turtle`, and `set_shape` update the current turtle's avatar state.
- `clear_screen` and `clean` affect the shared drawing surface as defined by the Turtle & Rendering profile. There is one surface, so it is cleared once however many turtles are addressed. `clear_screen` also sends **every** addressed turtle home — position `(0,0)`, heading `0`, with pen state, color, width, and visibility preserved — while `clean` clears the surface and moves no turtle.

When multiple turtles are addressed by `tell`, a turtle command applies once for each addressed turtle. Implementations MUST produce trace events with the appropriate turtle identity so animation, stepping, `why`, and `debug` can explain which turtle moved or changed. Clearing the shared drawing surface is the one effect that is not multiplied over the addressed set: `clean` and `clear_screen` clear the single surface once. `clear_screen`'s homing is **not** an exception — it is ordinary per-turtle movement and applies once for each addressed turtle, so the result never depends on the order the turtles were listed in: `tell [ :a :b ]` and `tell [ :b :a ]` home the same two turtles. The requirement above covers that homing: each addressed turtle's return home MUST be observable in the trace stream carrying that turtle's identity. Clearing the surface is not turtle-specific, so the turtle-identity rule in [execution-model.md](execution-model.md#trace-and-event-registry) applies to it as to any other shared-surface effect.

## Shapes and sprites

A **sprite** is a visible turtle with a shape. `set_shape` is owned by the Turtle & Rendering profile and takes one word:

```logo
:bee = new_turtle
ask :bee [
  set_shape "arrow"
  set_color "yellow"
  forward 60
]
```

The word names a shape the implementation provides. The portable shape words, the requirement that an implementation publish a complete description of the shape words its `set_shape` accepts, and the status of user-provided shapes are defined once by [rendering.md](rendering.md#turtle-avatar-and-shapes); the Sprites profile adds no shape words of its own. Shape changes emit the `shape-change` trace event from [execution-model.md](execution-model.md). `stamp` draws the current shape onto the shared drawing surface.

Shapes do not change the identity of a turtle. A turtle remains the same value after `set_shape`, after movement, and after pen changes.

## Animation and time

The Sprites profile does not define time or input. Simple animation uses `wait`, which is owned by the [Interaction profile](interaction-events.md):

```logo
:bug = new_turtle
ask :bug [
  repeat 10
    forward 10
    wait 1
  end repeat
]
```

Implementations that support Sprites but not Interaction may still step or animate through the trace stream, but the `wait` primitive is only available when the Interaction profile is supported.

## Input and `ask`

Sprite `ask` addresses turtles. User input is the `input` reporter in the [Interaction profile](interaction-events.md). There is no name collision: `ask` is not a prompt, and `input` is not sprite addressing.

## Reserved words in this profile

`ask` and `each` are profile block-heads, and `tell` is a profile command that switches the addressed set without taking a block; all three are reserved only within the Sprites profile. They are not part of the Core reserved-word list in [grammar.md](grammar.md). When the Sprites profile is active, programs MUST NOT redefine them as variables, procedures, or struct constructors; doing so raises `ol-reserved-word`.

## Profile grammar

When the Sprites profile is active, the Core `statement` production (see [grammar.md](grammar.md#profile-grammar-extensions)) gains these forms. They reuse the Core `expression`, `bracket-block`, `statement`, and `terminator` productions.

```logo
sprites-statement   ::= tell-statement | ask-statement | each-statement
tell-statement      ::= "tell" expression
ask-statement       ::= "ask" expression sprites-block-tail
each-statement      ::= "each" sprites-block-tail
sprites-block-tail  ::= bracket-block
                      | terminator { statement terminator } sprites-end
sprites-end         ::= "end" [ "ask" | "each" ]
```

`tell` takes no block; it is a command that switches the addressed set. `ask` and `each` are block heads. A labeled `end` MUST match its opener — `end ask` closes an `ask`, `end each` closes an `each` — and a mismatched label raises `ol-mismatched-end`.

## Errors and diagnostics

An implementation MUST report learner-facing diagnostics using the shape defined in [error-model.md](error-model.md). Sprites-specific misuse maps to existing codes:

- a non-turtle input to `tell` or `ask` raises `ol-type`;
- a list passed to `tell` or `ask` that contains a non-turtle value raises `ol-type`;
- `each` outside an active addressed set still uses the current addressed set, which is the default turtle set at top level;
- redefining `tell`, `ask`, or `each` while the profile is active raises `ol-reserved-word`.

Messages should explain the intended mental model, for example: `tell needs a turtle or a list of turtles to choose who moves.`
