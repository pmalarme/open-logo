> OpenLogo Specification v0.1.0 — Draft (Status: Normative)

# Turtles and Sprites Profile

[Back to the specification index](README.md).

This document defines the optional **Sprites** profile for OpenLogo. It extends the required [Turtle & Rendering](commands.md#turtle--rendering) model with multiple addressable turtles, sprite-like shapes, and profile-local block heads for agent-based drawings and simulations. The model follows the lineage of StarLogo, NetLogo, and MicroWorlds while keeping the OpenLogo surface small and readable.

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

Creating a turtle emits the `spawn-turtle` trace event defined in [execution-model.md](execution-model.md#execution-safety--the-traceevent-registry). The event is an effect event, so it is emitted immediately after the new turtle exists. Its envelope includes the common `seq`, `kind`, `source-span`, optional `turtle-id?`, and `payload` fields. The payload MUST identify the newly created turtle and SHOULD include its initial visible state for renderers and debuggers.

```logo
:leader = who
:friend = new_turtle
print :friend
```

## Addressing model

At any moment, turtle commands run for an **addressed set**. In a program without the Sprites profile, the addressed set contains the single default turtle. In this profile, `tell`, `ask`, and `each` control that set.

`tell <turtle|turtle-list>` is a command that changes the current addressed set for subsequent turtle commands. Its input is either one turtle value or a list whose items are turtle values.

```logo
:a = new_turtle
:b = new_turtle
tell (list :a :b)
forward 50
right 90
```

After the `tell`, `forward` and `right` apply to both `:a` and `:b`. A later `tell :a` narrows the addressed set to one turtle.

`ask <turtle|turtle-list> <block>` is a special form that temporarily runs a block for the given turtle or turtle list. The previous addressed set is restored after the block finishes. The block follows the normal OpenLogo block forms and the block-result rule: it is a list of instructions run for effects and reports no value.

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

`each <block>` runs its block once per turtle in the current `tell` or `ask` set. During each run, `who` reports the turtle for that iteration, and Turtle commands affect only that turtle unless the program changes the addressed set again. In long form an `each` block closes with `end` or `end each`.

```logo
:a = new_turtle
:b = new_turtle
tell (list :a :b)
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
- `clear_screen` and `clean` affect the shared drawing surface as defined by the Turtle & Rendering profile.

When multiple turtles are addressed by `tell`, a turtle command applies once for each addressed turtle. Implementations MUST produce trace events with the appropriate turtle identity so animation, stepping, `why`, and `debug` can explain which turtle moved or changed.

## Shapes and sprites

A **sprite** is a visible turtle with a shape. `set_shape` is owned by the Turtle & Rendering profile and takes one word:

```logo
:bee = new_turtle
ask :bee [
  set_shape "bee"
  set_color "yellow"
  forward 60
]
```

The word names an implementation-provided or user-provided shape. Renderers SHOULD provide a small default shape set and MUST document the words they accept. Shape changes emit the `shape-change` trace event from [execution-model.md](execution-model.md). `stamp` draws the current shape onto the shared drawing surface.

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

`tell`, `ask`, and `each` are profile block-heads and are reserved only within the Sprites profile. They are not part of the Core reserved-word list in [grammar.md](grammar.md). When the Sprites profile is active, programs MUST NOT redefine them as variables, procedures, or struct constructors; doing so raises `ol-reserved-word`.

## Errors and diagnostics

An implementation MUST report learner-facing diagnostics using the shape defined in [error-model.md](error-model.md). Sprites-specific misuse maps to existing codes:

- a non-turtle input to `tell` or `ask` raises `ol-type`;
- a list passed to `tell` or `ask` that contains a non-turtle value raises `ol-type`;
- `each` outside an active addressed set still uses the current addressed set, which is the default turtle set at top level;
- redefining `tell`, `ask`, or `each` while the profile is active raises `ol-reserved-word`.

Messages should explain the intended mental model, for example: `tell needs a turtle or a list of turtles to choose who moves.`
