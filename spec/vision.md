> OpenLogo Specification v0.1.0 — Draft (Status: Informative)

# OpenLogo Vision

[Back to the specification index](README.md)

OpenLogo is a modern, open-source reimagining of Logo for learners. Its short name is OL, and its programs live in `.logo` files. It is faithful to the spirit of Logo without freezing the language in the past: the turtle remains central, the syntax is gentle and explicit, and the goal is still discovery through making.

At its heart is the Papert and Piaget tradition of constructivism and constructionism: **the learner discovers concepts by building them**. OpenLogo treats a drawing not as the final prize, but as visible feedback from an idea the learner is testing. When a child draws a square, turns too far, fixes the angle, and tries again, the screen becomes a thinking partner.

## Design principles

### 1. Turtle First

The turtle is the learner's avatar. It has a position, heading, pen, color, width, and visibility, and every change to those things is something a learner can see or describe. A learner does not begin with abstract coordinates or hidden state. They begin with a small actor that moves, turns, draws, hides, appears, and leaves a trail.

```logo
set_color "blue"
set_width 3
repeat 4
  forward 100
  right 90
end repeat
```

The turtle makes mathematical ideas tangible: distance is how far the turtle walks, an angle is how much it turns, and state is what the turtle remembers between instructions.

### 2. Learn Concepts Not Commands

OpenLogo commands are doors into ideas:

- `forward` teaches distance.
- `right` and `left` teach angles and orientation.
- `repeat` teaches loops and pattern.
- `:size = 100` teaches a variable as a named idea that can change.
- `if … else` teaches choice.
- `define … end` teaches abstraction.
- `return` teaches a procedure that can report an answer.
- `map`, `filter`, and `reduce` teach transformations without introducing anonymous functions or first-class functions.

The command is not the lesson by itself. The concept is the lesson. The drawing is the feedback. Learning is the goal.

### 3. Progressive Learning

OpenLogo is designed for a long learning path, from age 6 and up through advanced work. A beginner can draw with a few words. A growing learner can name ideas with variables and procedures. An advanced learner can explore recursion, data, records, sprites, interaction, and algorithms.

The language should have a **low threshold, no ceiling**. The first program should feel possible; the hundredth program should still feel open-ended.

## Audience

OpenLogo is for children, families, teachers, clubs, classrooms, and self-directed learners. It should be welcoming to a six-year-old using the turtle for the first time and still useful to an older learner studying decomposition, geometry, data structures, simulation, or algorithmic art.

It is also for implementers and curriculum authors who want a shared, open specification for Logo-like learning environments.

## Success criteria

OpenLogo succeeds when a learner can say, in their own words:

- A square has four equal sides and four right turns.
- An angle changes the direction the turtle faces.
- Repetition means doing the same idea more than once.
- A variable is a name for a value I can reuse or change.
- A procedure is a named idea I can teach the computer.
- A reporter is a procedure that gives back an answer.
- An algorithm is a clear set of steps that solves a problem or makes something happen.

The best evidence is not only a pretty picture. It is the learner's explanation of how the picture was made and how they would change it next.

## Anti-goals

OpenLogo avoids shortcuts that hide the idea the learner is ready to discover. A command like `draw_square 100` is not a starting point, because it skips the relationship between `forward`, `right`, and `repeat`.

Instead, learners should first build the square:

```logo
repeat 4
  forward 100
  right 90
end repeat
```

Only after that does naming become powerful:

```logo
define square :size
  repeat 4
    forward :size
    right 90
  end repeat
end
```

The same rule applies to geometry. `polygon` is a useful abstraction, but the learner should discover the `repeat` behind `polygon` before treating it as a packaged tool.

```logo
define polygon :sides :size
  repeat :sides
    forward :size
    right 360 / :sides
  end repeat
end
```

OpenLogo also avoids making early learning depend on arrays, anonymous functions, comma-separated calls, or parenthesized call notation. Those are not needed for the first journey, and they can add noise before they add power.

## Modern yet faithful

OpenLogo keeps the Logo promise: children can think with a turtle, build ideas, and learn by debugging their own creations. It also uses modern spelling where it helps learners. Variables use `:name` consistently, assignment can be written as `:name = value` or `set name to value`, equality uses `==`, strings are closed like `"red"`, and blocks can be written as `[ … ]` or with `end`.

This is not nostalgia. It is continuity. OpenLogo honors Logo by keeping its educational center while making the surface predictable for today's learners.

## Open source ethos

OpenLogo is specified in the open so classrooms, families, researchers, and tool builders can share a common language. The specification, examples, and reference materials are intended to support collaboration rather than lock-in.

OpenLogo is licensed under the [MIT License](../LICENSE). The open license is part of the educational stance: learners should be able to inspect, remix, implement, translate, and improve the tools they use.

## References

- Harold Abelson, Nat Goodman, and Lee Rudolph, *The LOGO Manual*, MIT AI Memo AIM-313, 1974: <https://dspace.mit.edu/entities/publication/b3a67090-ad15-42da-98f4-df0a568c559b>
- Logo Foundation history and language pages: <https://web.archive.org/web/20110815060633/http://el.media.mit.edu/logo-foundation/logo/index.html>
- Andreas Stefik and Susanna Siebert, *An Empirical Investigation into Programming Language Syntax*, ACM TOCE, 2013.
