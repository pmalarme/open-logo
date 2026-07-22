import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/edu";
import { execute } from "@openlogo/runtime";

/**
 * Guards against drift between the shipped Geometry stdlib source strings
 * (`spec/geometry-module.md`, issue #338) and the exact packaged-command text the spec
 * documents. Each assertion below reproduces the spec's fenced code block for that command
 * verbatim, so any accidental edit to the shipped source fails this test immediately.
 */

const SPEC_POLYGON = `define polygon :sides :size
  if :sides < 3
    throw "a polygon needs at least 3 sides"
  end if
  if not (:sides == int :sides)
    throw "a polygon needs a whole number of sides"
  end if
  repeat :sides
    forward :size
    right 360 / :sides
  end repeat
end`;

const SPEC_STAR = `define star :points :size (:step 2)
  if not (:points == int :points)
    throw "a star needs a whole number of points"
  end if
  if not (:step is strictly between 1 and :points)
    throw "a star step must be a whole number between 2 and one less than the number of points"
  end if
  if not (:step == int :step)
    throw "a star step must be a whole number"
  end if
  repeat :points
    forward :size
    right 360 * :step / :points
  end repeat
end`;

const SPEC_CIRCLE = `define circle :radius (:segments 36)
  local side
  if :radius <= 0
    throw "a circle needs a positive radius"
  end if
  if :segments < 3
    throw "a circle needs at least 3 segments"
  end if
  if not (:segments == int :segments)
    throw "a circle needs a whole number of segments"
  end if
  :side = 2 * :radius * sin (180 / :segments)
  repeat :segments
    forward :side
    right 360 / :segments
  end repeat
end`;

const SPEC_ARC = `define arc :angle :radius
  local segments
  local step_angle
  local step_length
  if :angle < 0
    throw "an arc needs an angle of 0 or more"
  end if
  if :radius <= 0
    throw "an arc needs a positive radius"
  end if
  :segments = (int (:angle / 5)) + 1
  :step_angle = :angle / :segments
  :step_length = 2 * :radius * sin (:step_angle / 2)

  left :step_angle / 2
  repeat :segments
    forward :step_length
    left :step_angle
  end repeat
  right :step_angle / 2
end`;

const SPEC_AREA = `define area :shape
  if :shape[1] == "polygon"
    local sides
    local size
    :sides = :shape[2]
    :size = :shape[3]
    if :sides < 3 or not (:sides == int :sides)
      throw "area needs a polygon with a whole number of sides, at least 3"
    end if
    if :size <= 0
      throw "area needs a polygon with a positive side length"
    end if
    return :sides * (power :size 2) / (4 * tan (180 / :sides))
  end if

  if :shape[1] == "circle"
    local radius
    :radius = :shape[2]
    if :radius <= 0
      throw "area needs a circle with a positive radius"
    end if
    return pi * power :radius 2
  end if

  throw "area knows only the polygon and circle shapes"
end`;

const SPEC_PERIMETER = `define perimeter :shape
  if :shape[1] == "polygon"
    local sides
    local size
    :sides = :shape[2]
    :size = :shape[3]
    if :sides < 3 or not (:sides == int :sides)
      throw "perimeter needs a polygon with a whole number of sides, at least 3"
    end if
    if :size <= 0
      throw "perimeter needs a polygon with a positive side length"
    end if
    return :sides * :size
  end if

  if :shape[1] == "circle"
    local radius
    :radius = :shape[2]
    if :radius <= 0
      throw "perimeter needs a circle with a positive radius"
    end if
    return 2 * pi * :radius
  end if

  throw "perimeter knows only the polygon and circle shapes"
end`;

test("POLYGON_SOURCE matches spec/geometry-module.md:42-54 verbatim", () => {
  assert.equal(OL.POLYGON_SOURCE, SPEC_POLYGON);
});

test("STAR_SOURCE matches spec/geometry-module.md:88-103 verbatim", () => {
  assert.equal(OL.STAR_SOURCE, SPEC_STAR);
});

test("CIRCLE_SOURCE matches spec/geometry-module.md:151-167 verbatim", () => {
  assert.equal(OL.CIRCLE_SOURCE, SPEC_CIRCLE);
});

test("ARC_SOURCE matches spec/geometry-module.md:218-238 verbatim", () => {
  assert.equal(OL.ARC_SOURCE, SPEC_ARC);
});

test("AREA_SOURCE matches spec/geometry-module.md:330-355 verbatim", () => {
  assert.equal(OL.AREA_SOURCE, SPEC_AREA);
});

test("PERIMETER_SOURCE matches spec/geometry-module.md:375-400 verbatim", () => {
  assert.equal(OL.PERIMETER_SOURCE, SPEC_PERIMETER);
});

test("GEOMETRY_STDLIB_NAMES lists all six commands in spec declaration order", () => {
  assert.deepEqual(OL.GEOMETRY_STDLIB_NAMES, [
    "polygon",
    "star",
    "circle",
    "arc",
    "area",
    "perimeter",
  ]);
});

test("GEOMETRY_STDLIB maps every name to its matching source string", () => {
  assert.equal(OL.GEOMETRY_STDLIB.polygon, OL.POLYGON_SOURCE);
  assert.equal(OL.GEOMETRY_STDLIB.star, OL.STAR_SOURCE);
  assert.equal(OL.GEOMETRY_STDLIB.circle, OL.CIRCLE_SOURCE);
  assert.equal(OL.GEOMETRY_STDLIB.arc, OL.ARC_SOURCE);
  assert.equal(OL.GEOMETRY_STDLIB.area, OL.AREA_SOURCE);
  assert.equal(OL.GEOMETRY_STDLIB.perimeter, OL.PERIMETER_SOURCE);
});

test("isGeometryStdlibName recognizes every registered name and rejects others", () => {
  for (const name of OL.GEOMETRY_STDLIB_NAMES) {
    assert.equal(OL.isGeometryStdlibName(name), true);
  }
  assert.equal(OL.isGeometryStdlibName("grid"), false);
  assert.equal(OL.isGeometryStdlibName(""), false);
  assert.equal(OL.isGeometryStdlibName(42), false);
  assert.equal(OL.isGeometryStdlibName(undefined), false);
});

test("polygon draws a regular pentagon and returns to its start pose", () => {
  const source = `${OL.POLYGON_SOURCE}\npolygon 5 100\nprint xcor\nprint ycor\nprint heading`;
  const { events, diagnostics } = execute(source, "polygon-happy.logo");
  assert.deepEqual(diagnostics, []);
  const prints = events.filter((event) => event.kind === "print");
  assert.equal(prints.length, 3);
  assert.ok(Math.abs(prints[0].payload.values[0]) < 1e-9);
  assert.ok(Math.abs(prints[1].payload.values[0]) < 1e-9);
  assert.ok(Math.abs(prints[2].payload.values[0]) < 1e-9);
});

test("polygon rejects fewer than 3 sides with the exact spec message", () => {
  const source = `${OL.POLYGON_SOURCE}\npolygon 2 100`;
  const { diagnostics } = execute(source, "polygon-too-few.logo");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-user-error");
  assert.equal(diagnostics[0].message, "a polygon needs at least 3 sides");
});

test("polygon rejects a non-whole number of sides with the exact spec message", () => {
  const source = `${OL.POLYGON_SOURCE}\npolygon 3.5 100`;
  const { diagnostics } = execute(source, "polygon-non-integer.logo");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-user-error");
  assert.equal(
    diagnostics[0].message,
    "a polygon needs a whole number of sides",
  );
});

test("star draws {5/2} and {7/3} star polygons without diagnostics", () => {
  const defaultStep = execute(
    `${OL.STAR_SOURCE}\nstar 5 100`,
    "star-default.logo",
  );
  assert.deepEqual(defaultStep.diagnostics, []);
  const explicitStep = execute(
    `${OL.STAR_SOURCE}\n(star 7 80 3)`,
    "star-explicit.logo",
  );
  assert.deepEqual(explicitStep.diagnostics, []);
});

test("star rejects an out-of-range step with the exact spec message", () => {
  const { diagnostics } = execute(
    `${OL.STAR_SOURCE}\n(star 5 100 1)`,
    "star-bad-step.logo",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-user-error");
  assert.equal(
    diagnostics[0].message,
    "a star step must be a whole number between 2 and one less than the number of points",
  );
});

test("star rejects a non-whole number of points with the exact spec message", () => {
  const { diagnostics } = execute(
    `${OL.STAR_SOURCE}\nstar 5.5 100`,
    "star-non-integer-points.logo",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-user-error");
  assert.equal(diagnostics[0].message, "a star needs a whole number of points");
});

test("star rejects a non-whole number step with the exact spec message", () => {
  const { diagnostics } = execute(
    `${OL.STAR_SOURCE}\n(star 5 100 2.5)`,
    "star-non-integer-step.logo",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-user-error");
  assert.equal(diagnostics[0].message, "a star step must be a whole number");
});

test("circle draws a 36-segment and a 72-segment approximation without diagnostics", () => {
  const defaultSegments = execute(
    `${OL.CIRCLE_SOURCE}\ncircle 50`,
    "circle-default.logo",
  );
  assert.deepEqual(defaultSegments.diagnostics, []);
  const explicitSegments = execute(
    `${OL.CIRCLE_SOURCE}\n(circle 50 72)`,
    "circle-explicit.logo",
  );
  assert.deepEqual(explicitSegments.diagnostics, []);
});

test("circle rejects a non-positive radius with the exact spec message", () => {
  const { diagnostics } = execute(
    `${OL.CIRCLE_SOURCE}\ncircle 0`,
    "circle-bad-radius.logo",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-user-error");
  assert.equal(diagnostics[0].message, "a circle needs a positive radius");
});

test("circle rejects fewer than 3 segments with the exact spec message", () => {
  const { diagnostics } = execute(
    `${OL.CIRCLE_SOURCE}\n(circle 50 2)`,
    "circle-too-few-segments.logo",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-user-error");
  assert.equal(diagnostics[0].message, "a circle needs at least 3 segments");
});

test("circle rejects a non-whole number of segments with the exact spec message", () => {
  const { diagnostics } = execute(
    `${OL.CIRCLE_SOURCE}\n(circle 50 3.5)`,
    "circle-non-integer-segments.logo",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-user-error");
  assert.equal(
    diagnostics[0].message,
    "a circle needs a whole number of segments",
  );
});

test("arc curves through 90 degrees and lands on the documented final pose", () => {
  const source = `${OL.ARC_SOURCE}\narc 90 50\nprint xcor\nprint ycor\nprint heading`;
  const { events, diagnostics } = execute(source, "arc-happy.logo");
  assert.deepEqual(diagnostics, []);
  const prints = events.filter((event) => event.kind === "print");
  assert.equal(prints.length, 3);
  assert.ok(Math.abs(prints[0].payload.values[0] - -50) < 1e-6);
  assert.ok(Math.abs(prints[1].payload.values[0] - 50) < 1e-6);
  assert.ok(Math.abs(prints[2].payload.values[0] - 270) < 1e-6);
});

test("arc rejects a negative angle with the exact spec message", () => {
  const { diagnostics } = execute(
    `${OL.ARC_SOURCE}\narc -10 50`,
    "arc-negative-angle.logo",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-user-error");
  assert.equal(diagnostics[0].message, "an arc needs an angle of 0 or more");
});

test("arc rejects a non-positive radius with the exact spec message", () => {
  const { diagnostics } = execute(
    `${OL.ARC_SOURCE}\narc 90 0`,
    "arc-bad-radius.logo",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-user-error");
  assert.equal(diagnostics[0].message, "an arc needs a positive radius");
});

test("area reports the documented polygon and circle formulas without turtle/draw events", () => {
  const polygon = execute(
    `${OL.AREA_SOURCE}\nprint area ["polygon" 5 100]`,
    "area-polygon.logo",
  );
  assert.deepEqual(polygon.diagnostics, []);
  const polygonPrint = polygon.events.find((event) => event.kind === "print");
  assert.ok(
    Math.abs(
      polygonPrint.payload.values[0] -
        (5 * 100 ** 2) / (4 * Math.tan((180 / 5) * (Math.PI / 180))),
    ) < 1e-6,
  );
  assert.equal(
    polygon.events.some(
      (event) =>
        event.kind === "move" ||
        event.kind === "draw-segment" ||
        event.kind === "turn",
    ),
    false,
  );

  const circle = execute(
    `${OL.AREA_SOURCE}\nprint area ["circle" 50]`,
    "area-circle.logo",
  );
  assert.deepEqual(circle.diagnostics, []);
  const circlePrint = circle.events.find((event) => event.kind === "print");
  assert.ok(Math.abs(circlePrint.payload.values[0] - Math.PI * 50 ** 2) < 1e-6);
  assert.equal(
    circle.events.some(
      (event) =>
        event.kind === "move" ||
        event.kind === "draw-segment" ||
        event.kind === "turn",
    ),
    false,
  );
});

test("area rejects an unsupported shape word with the exact spec message", () => {
  const { diagnostics } = execute(
    `${OL.AREA_SOURCE}\nprint area ["hexagon" 5]`,
    "area-bad-shape.logo",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-user-error");
  assert.equal(
    diagnostics[0].message,
    "area knows only the polygon and circle shapes",
  );
});

test("perimeter reports the documented polygon and circle formulas without turtle/draw events", () => {
  const polygon = execute(
    `${OL.PERIMETER_SOURCE}\nprint perimeter ["polygon" 5 100]`,
    "perimeter-polygon.logo",
  );
  assert.deepEqual(polygon.diagnostics, []);
  const polygonPrint = polygon.events.find((event) => event.kind === "print");
  assert.equal(polygonPrint.payload.values[0], 500);
  assert.equal(
    polygon.events.some(
      (event) =>
        event.kind === "move" ||
        event.kind === "draw-segment" ||
        event.kind === "turn",
    ),
    false,
  );

  const circle = execute(
    `${OL.PERIMETER_SOURCE}\nprint perimeter ["circle" 50]`,
    "perimeter-circle.logo",
  );
  assert.deepEqual(circle.diagnostics, []);
  const circlePrint = circle.events.find((event) => event.kind === "print");
  assert.ok(Math.abs(circlePrint.payload.values[0] - 2 * Math.PI * 50) < 1e-6);
  assert.equal(
    circle.events.some(
      (event) =>
        event.kind === "move" ||
        event.kind === "draw-segment" ||
        event.kind === "turn",
    ),
    false,
  );
});

test("perimeter rejects an unsupported shape word with the exact spec message", () => {
  const { diagnostics } = execute(
    `${OL.PERIMETER_SOURCE}\nprint perimeter ["hexagon" 5]`,
    "perimeter-bad-shape.logo",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-user-error");
  assert.equal(
    diagnostics[0].message,
    "perimeter knows only the polygon and circle shapes",
  );
});
