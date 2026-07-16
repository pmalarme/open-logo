> OpenLogo Specification v0.1.0 — Draft (Status: Normative)

# Rendering

Back to the [OpenLogo specification index](README.md).

This document defines the normative rendering behavior for the OpenLogo **Turtle & Rendering** profile. It consumes the turtle state and execution events defined by the [execution model](execution-model.md), and it uses the turtle primitives and color forms defined by the [commands reference](commands.md).

## Rendering targets

A graphical OpenLogo implementation MUST provide an interactive **Canvas** target. It SHOULD provide deterministic **SVG export** and **PNG export** targets. The same drawing model, coordinate mapping, colors, widths, fill rules, overlays, background, and turtle visibility rules apply to all targets unless this document states otherwise.

- **Canvas** is the live interactive surface. It displays animation, stepping, pause state, overlays, the background, existing drawing geometry, and the turtle avatar.
- **SVG export** serializes the final deterministic scene as vector content. SVG export MUST include the background, drawn segments, fills, stamps, and any enabled exportable overlays. The live turtle avatar is included only when the turtle is visible at export time.
- **PNG export** rasterizes the same deterministic scene as SVG export at a requested pixel size and device scale. PNG export MUST NOT depend on the current animation frame rate, wall-clock timing, or display refresh rate.

An implementation MAY provide additional targets, but those targets MUST use the same world-space drawing model and MUST NOT reinterpret OpenLogo coordinates.

## Drawing model

The renderer maintains a retained drawing scene plus transient UI state. Program execution mutates turtle state and appends drawing operations to the retained scene. Repainting a target MUST be possible from retained scene data without re-running the program.

The retained scene consists of these ordered items:

1. background color
2. path segments produced by pen-down movement
3. fills
4. stamps
5. enabled exportable overlays
6. visible turtle avatar

The logical draw order is background first, then drawing items in execution order, then overlays, then the visible turtle avatar. Canvas MAY internally optimize repainting, but the visible result MUST match that order.

### Line segments

A pen-down move appends one straight segment from the previous turtle position to the new turtle position. Segment endpoints are stored in world coordinates as exact implementation numeric values. Each segment captures the pen color and pen width active when the segment is created; later `set_color` or `set_width` calls do not alter existing segments.

A pen-up move changes turtle position without appending a segment. Zero-length pen-down moves MAY append a zero-length segment for trace fidelity, but targets MUST render such a segment consistently or omit it consistently across Canvas, SVG, and PNG.

### Color

Rendering colors are produced by the color values accepted by `set_color` and `set_background`: named color words, rgb lists, or hex words. Implementations MUST normalize each accepted color to an sRGB color before rendering or export. Unknown or invalid color values are command errors owned by the [commands reference](commands.md), not renderer fallbacks.

Color state is part of turtle state. A segment, fill, or stamp captures the color at the moment its event is applied. Background color is a scene property, not a segment.

### Width

Pen width is a positive number in world units. A width of `1` is the default. A target maps width through the same viewport scale used for coordinates. Implementations MAY enforce a minimum visible raster width for Canvas usability, but export MUST use the specified world-space width and viewport transform deterministically.

### Fill

`fill` fills the currently enclosed region associated with the active turtle's drawn path. The fill color is the current pen color unless an implementation exposes a vendor extension for separate fill color. A conforming fill operation MUST be represented by a `fill` execution event and retained as a scene item so exports match the live drawing.

If the active path is not closed, the renderer MUST close it for filling by connecting the last point to the first point for the fill geometry only. That implicit closing edge MUST NOT become a retained line segment. Fill winding MUST be deterministic; implementations SHOULD use the nonzero winding rule for Canvas and SVG consistency.

```logo
set_color "blue"
repeat 4 [
  forward 100
  right 90
]
fill
```

## Coordinate mapping and viewport

OpenLogo world coordinates follow [C4](execution-model.md): origin `(0,0)` is at the canvas center, `+x` points right, `+y` points up, heading `0°` points up, `right` turns clockwise, `left` turns counter-clockwise, degrees are used, and headings are normalized into `[0,360)`.

The world-to-target mapping for an unpanned viewport is:

- target x = center x + world x × scale
- target y = center y - world y × scale

The y-axis inversion is required because world `+y` is up while most raster surfaces count pixels downward. The default scale SHOULD be `1` world unit per CSS pixel for Canvas. Exporters MUST declare or accept their target size and scale, then apply the same mapping deterministically.

The viewport MAY support pan and zoom as UI operations. Pan and zoom MUST NOT change the retained scene, turtle coordinates, exported world geometry, or program-visible values such as `xcor`, `ycor`, `heading`, and `pos`.

At start and after `clear_screen`, the turtle is at `(0,0)`, heading `0`, pen down, color `"black"`, width `1`, visible, and the background is `"white"`. `home` moves to `(0,0)` and heading `0`. `clear_screen` clears drawing and homes the turtle while keeping color, width, and background; `clean` clears drawing only. Renderer overlays are not drawing and persist across `clean`.

## Execution-event consumption

Rendering consumes the normative execution-event stream defined by [C9](execution-model.md). Each event has `seq`, `kind`, `source-span`, optional `turtle-id`, and `payload`. Rendering-relevant event kinds include `instruction`, `move`, `turn`, `pen-change`, `width-change`, `color-change`, `background-change`, `draw-segment`, `fill`, `stamp`, `shape-change`, `visibility-change`, `clear`, `overlay`, `spawn-turtle`, and `error`.

Start events are emitted before their effect. Effect events are emitted immediately after the state change they describe. The renderer MUST apply effect events in increasing `seq` order. If multiple turtles are supported by the Sprites profile, `turtle-id` identifies which turtle state or scene operation the event affects.

The renderer MUST treat the `instruction` event as exactly one user-visible step. A step begins at an `instruction` event and continues until the next `instruction` event or program end. All effect events in that interval belong to that step.

## Animation and execution control

Animation is a presentation of the event stream; it is not a different execution semantics. Running instantly, slowly, or step-by-step MUST produce the same final retained scene for deterministic programs.

Implementations MUST provide these controls for the Canvas target:

- **run**: consume events continuously until pause, error, cancellation, or program end
- **pause**: stop consuming new events after the current event or current step boundary
- **step**: consume exactly one `instruction` step, including all effect events until the next `instruction` event or program end
- **speed**: choose how quickly steps are consumed without changing program semantics
- **reset/replay**: clear renderer runtime state and replay the retained or regenerated event stream from the beginning

Speed control MAY be expressed as steps per second, a named speed scale, or a slider. Whatever the UI, speed controls pacing only. They MUST NOT skip events, coalesce visible state changes in step mode, or change source-level step boundaries.

In reduced-motion mode, animation MUST default to instant or low-motion stepping while preserving manual step and pause. See [Accessibility](#accessibility).

```logo
repeat 4 [
  forward 100
  right 90
]
```

In the program above, each source instruction produces its own `instruction` event. Pressing **step** once at the first `forward 100` consumes that one instruction and the resulting `move` and `draw-segment` effects. The following `right 90` is a separate step.

## Turtle avatar and shapes

The turtle avatar is transient visual state drawn above the retained scene. It indicates the active turtle's position, heading, visibility, and shape. It is not a line segment and it is not erased by `clean` unless `clean` is followed by ordinary repainting that redraws the current avatar.

`show_turtle` makes the avatar visible. `hide_turtle` makes it invisible. Visibility changes MUST be represented by `visibility-change` events. A hidden turtle still moves, turns, draws when the pen is down, and reports its state normally.

The default avatar shape is an implementation-defined turtle-like shape whose nose points along the turtle heading. `set_shape` selects a named shape word. Implementations MUST support at least the default shape and SHOULD support a small portable set such as `"turtle"`, `"triangle"`, `"arrow"`, and `"circle"`. Unknown shape words SHOULD raise the same style of learner-facing runtime diagnostic as other bad primitive inputs.

The avatar MUST be positioned at the turtle's world position and rotated so heading `0°` points upward. Shape size is a renderer presentation property and MUST NOT affect turtle coordinates, collision semantics, line geometry, or exports except for the visible avatar when exported.

## Background

`set_background` changes the scene background color and emits a `background-change` event. The background is not a drawn rectangle in turtle coordinates; it covers the whole target viewport or export surface. `clear_screen` and `clean` do not reset the background. The initial background is `"white"`.

SVG and PNG export MUST include the background color. Transparent export MAY be offered as a vendor extension, but the default export includes the OpenLogo background.

## Grid, axes, and measure overlays

`grid`, `axes`, and `measure` are renderer overlays defined by the [geometry module](geometry-module.md). They are educational annotations, not turtle drawing. Overlay state is controlled by `overlay` events and persists across `clean` because `clean` clears drawing only.

- **grid** displays evenly spaced world-coordinate guide lines. The default spacing is `20` world units.
- **axes** displays the x-axis and y-axis through the origin.
- **measure** displays educational annotations such as segment lengths and turn angles.

Overlays MUST be visually distinguishable from learner drawing and MUST NOT change program-visible turtle state, retained line segments, fills, or printed output. Implementations SHOULD allow overlays to be toggled independently. Exporters MUST either include enabled overlays by default or provide an explicit export option; the chosen behavior MUST be documented and deterministic.

Color must not be the only way overlays communicate information. For example, axes can use labels or line patterns, and measure annotations can include textual lengths and angle values.

## Clear operations

The renderer distinguishes scene drawing from turtle state and overlays:

| Operation | Drawing segments/fills/stamps | Turtle position and heading | Pen color and width | Background | Overlays |
|---|---|---|---|---|---|
| `clean` | cleared | unchanged | unchanged | unchanged | unchanged |
| `clear_screen` | cleared | home and heading `0` | unchanged | unchanged | unchanged |
| `set_background` | unchanged | unchanged | unchanged | changed | unchanged |

Both `clean` and `clear_screen` produce `clear` events. The event payload MUST distinguish drawing-only clearing from clear-and-home behavior so playback and debugging can reproduce state exactly.

## Export determinism

For a deterministic program and fixed export options, SVG and PNG export MUST be byte-stable where practical and image-stable always. Export MUST NOT depend on live animation timing, frame drops, current pause state, monitor DPI, nondeterministic object ordering, or wall-clock time.

Exporters MUST:

- consume the completed retained scene or replay the event stream in `seq` order
- use the same viewport mapping for all drawing items
- preserve draw order
- serialize colors in a deterministic normalized form
- serialize numeric coordinates with a documented stable precision
- include the background by default
- include or exclude overlays according to a documented deterministic option
- include the visible turtle avatar only when the export option says to include it and the turtle is visible

If random drawing is used, determinism depends on the language-level random seed rules from the [execution model](execution-model.md). Exporters MUST NOT add additional randomness.

## Accessibility

Rendering accessibility is normative for the Turtle & Rendering profile and follows [C13](conformance.md). A conforming Canvas target MUST be operable and understandable without relying on motion, color, or pointer-only interaction.

### Reduced motion

Implementations MUST honor platform reduced-motion preferences when available. In reduced-motion mode, the renderer MUST avoid continuous animated movement by default. It SHOULD present instant drawing, low-motion transitions, or manual stepping. Step and pause controls MUST remain available.

Reduced-motion mode MUST NOT change the event stream, final scene, turtle state, or export output.

### Non-visual state descriptions

The Canvas target MUST expose a textual state description that updates as execution proceeds. At minimum it includes:

- turtle position as `x` and `y`
- turtle heading in degrees
- pen state: up or down
- pen color and width
- turtle visibility
- current source instruction when available from `source-span`

Example state text: `turtle at x 100 y 0 heading 90 degrees pen down color black width 1`. Implementations with multiple turtles MUST identify the active turtle or addressed turtle set.

Printed output and learner-facing diagnostics MUST be available as text outside the drawing surface. The drawing surface MUST NOT be the only way to understand program progress.

### Color-independent feedback

Color MUST NOT be the sole carrier of rendering information. Selection, current-step highlighting, errors, overlays, pen-up previews, and turtle focus SHOULD also use text, shape, position, line pattern, iconography, or labels.

For example, an error location can be shown with a message and source highlight, not only a red mark. Axes can be labeled `x` and `y`; measure overlays can show numbers.

### Keyboard operability

Canvas execution controls MUST be reachable and usable from a keyboard: run, pause, step, reset, speed adjustment, overlay toggles, export actions, and focus movement between source, output, state text, and canvas. Keyboard shortcuts MAY be provided, but visible controls with accessible names MUST also exist.

A keyboard user MUST be able to run this program, pause it, step each instruction, inspect the textual turtle state, and export the result without a pointer:

```logo
set_background "white"
set_color "black"
set_width 2
repeat 4 [
  forward 100
  right 90
]
```