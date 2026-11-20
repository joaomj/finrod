#!/usr/bin/env node
// FINROD_TRANSCRIBE_COMMAND for tests. The audio file's text picks the behavior, and every behavior puts the words
// after the first space on stdout or stderr, as a real transcriber can.
import { readFileSync } from "node:fs";
const [behavior, ...rest] = readFileSync(process.argv[2], "utf8").split(" ");
const words = rest.join(" ");
if (behavior === "ok") console.log(JSON.stringify({ duration: 2, segments: [{ start: 0, end: 2, text: words }] }));
else if (behavior === "fail") {
  console.log(words);
  console.error(`Traceback: ${words}`);
  process.exit(1);
} else console.log(JSON.stringify({ text: words }));
