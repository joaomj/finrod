export function describeError(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  for (let cause = error; cause !== undefined && !seen.has(cause);) {
    seen.add(cause);
    messages.push(cause instanceof Error ? cause.message : String(cause));
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  let text = messages.join(" Caused by: ");
  for (const [name, value] of Object.entries(process.env)) {
    if (value && /(?:KEY|TOKEN|SECRET|PASSWORD)$/.test(name)) text = text.replaceAll(value, "[redacted]");
  }
  return text;
}
