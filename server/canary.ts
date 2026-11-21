import canaryPrompt from "./prompts/canary.md";

/**
 * Secrets that exist only in Finrod's model instructions, such as Canarytokens. Anyone who uses one has read a prompt,
 * so its alert reports a leak at the model provider or at a hop on the way.
 */
export type Canary = { readonly text: string; readonly parts: readonly string[] };

/**
 * The canary from the text of `FINROD_CANARY_FILE`. Its tokens, the long words with a digit, are what Finrod's own tools
 * must never send; labels such as `aws_access_key_id` are not.
 */
export function canaryOf(text: string): Canary {
  return { text, parts: text.split(/\s+/).filter((word) => word.length >= 16 && /\d/.test(word)) };
}

/** Instructions with the canary appended, so every request to the model carries it. */
export function withCanary(instructions: string, canary: Canary | undefined): string {
  if (!canary) return instructions;
  return `${instructions}\n\n${canaryPrompt.trim().replace("{{canary}}", () => canary.text)}`;
}

/** Whether a tool call would send part of the canary out, which would fire its alert with no leak. */
export function carriesCanary(args: unknown, canary: Canary | undefined): boolean {
  const sent = JSON.stringify(args);
  return canary?.parts.some((part) => sent.includes(part)) ?? false;
}
