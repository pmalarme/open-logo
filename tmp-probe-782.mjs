import { execute } from "@openlogo/runtime";

const cases = {
  invariant: [
    ":a = new_turtle",
    ":b = new_turtle",
    "tell :a",
    "forward 10",
    "tell :b",
    "forward 20",
    "tell :a",
    "define go",
    "  tell :b",
    "end",
    "go",
    ":seen = 0",
    "ask who [ :seen = ycor ]",
    "print :seen == ycor",
    "print who == :b",
  ].join("\n"),
  nested: [
    ":a = new_turtle",
    ":b = new_turtle",
    "define inner",
    "  tell :b",
    "end",
    "define outer",
    "  inner",
    "end",
    "tell :a",
    "outer",
    "print who == :b",
    "print ycor",
  ].join("\n"),
  selfheal: [
    ":a = new_turtle",
    ":b = new_turtle",
    "tell :a",
    "define go",
    "  tell :b",
    "end",
    "go",
    "forward 40",
    "print who == :b",
    "print ycor",
  ].join("\n"),
};

for (const [name, source] of Object.entries(cases)) {
  const result = execute(source, "main.logo");
  console.log(`--- ${name}`);
  console.log("  diagnostics:", JSON.stringify(result.diagnostics));
  console.log(
    "  prints:",
    JSON.stringify(
      result.events
        .filter((event) => event.kind === "print")
        .map((event) => event.payload.values),
    ),
  );
  console.log(
    "  moves:",
    JSON.stringify(
      result.events
        .filter((event) => event.kind === "move")
        .map((event) => [event.turtle_id, event.payload.to]),
    ),
  );
}
