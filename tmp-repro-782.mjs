import { execute } from "@openlogo/runtime";

const source = [
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
  "print who",
  "print ycor",
].join("\n");

const result = execute(source, "main.logo");
console.log("diagnostics:", JSON.stringify(result.diagnostics));
console.log(
  "prints:",
  JSON.stringify(
    result.events
      .filter((event) => event.kind === "print")
      .map((event) => event.payload.values),
  ),
);
