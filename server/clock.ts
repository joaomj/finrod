import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";

/** The tool the model calls for the current date and time, in the server's time zone. */
export function clock() {
  const now = defineTool({
    name: "clock",
    description: "Get the current date and time where the user lives.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => {
      const date = new Date();
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const local = date.toLocaleString("en-US", { timeZone, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" });
      return { output: [{ type: "text", text: `${local} (${timeZone})` }] };
    },
  });
  return defineExtension({ name: "clock", tools: [now] });
}
