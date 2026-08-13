import { readFileSync, writeFileSync } from "node:fs";
import { execute } from "@openlogo/runtime";

const [, , name, description] = process.argv;
const dir = `tests/conformance/sprites/${name}`;
const source = readFileSync(`${dir}/${name}.logo`, "utf8");
const document = `sprites/${name}/${name}`;
const { events, diagnostics } = execute(source, document);
const expected = {
  description,
  profiles: ["sprites"],
  execute: true,
  events,
  diagnostics,
};
writeFileSync(
  `${dir}/${name}.expected.json`,
  `${JSON.stringify(expected, null, 2)}\n`,
);
console.log(`wrote ${dir}/${name}.expected.json (${events.length} events)`);
