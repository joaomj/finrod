import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";

/** Largest file a user may send. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Characters of one document sent to the model; a longer document is cut with a visible note. */
const MAX_DOCUMENT_CHARS = 40_000;

export type Attachment = {
  /** Name of the stored original in the profile's files directory. */
  readonly id: string;
  readonly kind: "image" | "document";
  /** Name the user's file had. */
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  /** Text sent to the model, for documents. */
  readonly text?: string;
  /** Pages of a PDF that carry no text layer, as ranges such as "4-7, 12". */
  readonly unreadable?: string;
  readonly pages?: number;
};

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
};

const MIME_BY_EXTENSION = Object.fromEntries(Object.entries(EXTENSIONS).map(([mime, extension]) => [extension, mime]));

/**
 * The type of a file from its first bytes, because a browser or phone can send a generic type. Text is
 * anything that decodes as UTF-8 without null bytes.
 */
export function sniffMime(bytes: Uint8Array): string | undefined {
  const head = Buffer.from(bytes.subarray(0, 12));
  if (head.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.includes("\u0000")) return "text/plain";
  } catch {}
  return undefined;
}

/** Ranges of page numbers, such as [[4, 7], [12, 12]], as "4-7, 12". */
function ranges(pages: number[]): string {
  const groups: [number, number][] = [];
  for (const page of pages) {
    const last = groups.at(-1);
    if (last && page === last[1] + 1) last[1] = page;
    else groups.push([page, page]);
  }
  return groups.map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`)).join(", ");
}

/** Text of a PDF, page by page, so a page with no text layer is known rather than silently blank. */
async function readPdf(bytes: Uint8Array): Promise<{ text: string; unreadable?: string; pages: number }> {
  // PDF.js rejects a Node Buffer by constructor; it takes a plain Uint8Array.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const extracted = await extractText(pdf, { mergePages: false });
  const perPage = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  const empty = perPage.flatMap((page, index) => (page.trim() ? [] : [index + 1]));
  const text = perPage
    .map((page, index) => (page.trim() ? page.trim() : `[page ${index + 1}: no text layer]`))
    .join("\n\n");
  return {
    text,
    ...(empty.length ? { unreadable: ranges(empty) } : {}),
    pages: perPage.length,
  };
}

/** Cut a long document, saying so, instead of sending a partial text as if it were complete. */
function limit(text: string): string {
  if (text.length <= MAX_DOCUMENT_CHARS) return text;
  return `${text.slice(0, MAX_DOCUMENT_CHARS)}\n[Document cut at ${MAX_DOCUMENT_CHARS} characters of ${text.length}.]`;
}

function unsupported(name: string): Error {
  return new Error(`"${name}" is not an image, a PDF, or a plain text file. Send JPEG, PNG, WebP, PDF, TXT, MD, or CSV.`);
}

/** What the model needs from one file's bytes, under the name it is stored as. */
async function attachmentOf(bytes: Uint8Array, id: string, mime: string, name: string): Promise<Attachment> {
  const size = bytes.length;
  if (mime.startsWith("image/")) return { id, kind: "image", name, mime, size };
  const read: { text: string; unreadable?: string; pages?: number } =
    mime === "application/pdf" ? await readPdf(bytes) : { text: new TextDecoder().decode(bytes) };
  return {
    id,
    kind: "document",
    name,
    mime,
    size,
    text: limit(read.text),
    ...(read.unreadable ? { unreadable: read.unreadable } : {}),
    ...(read.pages === undefined ? {} : { pages: read.pages }),
  };
}

/**
 * Store one uploaded file as an original in `directory` and return what the model needs from it. The
 * original stays even when reading its text fails.
 */
export async function storeFile(directory: string, bytes: Uint8Array, name: string): Promise<Attachment> {
  const mime = sniffMime(bytes);
  if (!mime) throw unsupported(name);
  const id = `${randomUUID()}${EXTENSIONS[mime]!}`;
  await writeFile(join(directory, id), bytes, { mode: 0o600 });
  return attachmentOf(bytes, id, mime, name);
}

/** An already stored original, read again for a message that refers to it. */
export async function describeStoredFile(directory: string, id: string, name: string): Promise<Attachment> {
  const bytes = await readFile(join(directory, id));
  const mime = sniffMime(bytes);
  if (!mime) throw unsupported(name);
  return attachmentOf(bytes, id, mime, name);
}

/** Stored name of a file the profile may serve; anything else is rejected, so paths cannot escape the directory. */
export function isStoredName(value: string): boolean {
  return /^[0-9a-f-]{36}\.[a-z]{2,4}$/.test(value);
}

export async function readStoredFile(directory: string, id: string): Promise<Buffer> {
  if (!isStoredName(id)) throw new Error(`"${id}" is not a stored file name.`);
  return readFile(join(directory, id));
}

export function mimeOfStoredName(id: string): string {
  return MIME_BY_EXTENSION[id.slice(id.lastIndexOf("."))] ?? "application/octet-stream";
}
