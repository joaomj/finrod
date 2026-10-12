export function redact(text: string, values: readonly string[]): string {
  for (const value of [...new Set(values.filter(Boolean))].sort((a, b) => b.length - a.length)) {
    text = text.split(value).join("[redacted]");
  }
  return text;
}
