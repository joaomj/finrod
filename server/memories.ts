import { createDecipheriv, scrypt } from "node:crypto";
import { readFile, rename } from "node:fs/promises";
import { promisify } from "node:util";

/** A memory the user approved before the wiki. */
export type LegacyMemory = { id: string; text: string };

/** The memory file of v0.6.0 to v0.9.x: a JSON list, encrypted with AES-256-GCM under a scrypt key of the passphrase. */
type Sealed = { salt: string; iv: string; tag: string; data: string };

/**
 * The approved memories in `<dir>/memories.enc`, which the first dreaming run moves into the wiki, or `undefined` when
 * there is no such file.
 */
export async function legacyMemories(dir: string, passphrase: string): Promise<LegacyMemory[] | undefined> {
  const path = `${dir}/memories.enc`;
  let sealed: Sealed;
  try {
    sealed = JSON.parse(await readFile(path, "utf8")) as Sealed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Reading ${path} failed.`, { cause: error });
  }
  try {
    const key = (await promisify(scrypt)(passphrase, Buffer.from(sealed.salt, "base64"), 32)) as Buffer;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    const items = JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8")) as { id: string; text: string; status: string }[];
    return items.filter((item) => item.status === "saved").map(({ id, text }) => ({ id, text }));
  } catch (error) {
    throw new Error(`Memory file ${path} does not open with the passphrase in FINROD_MEMORY_KEY_FILE. Restore the passphrase; Finrod will not overwrite the file.`, { cause: error });
  }
}

/** Keep the old file, renamed, once its memories are in the wiki; a second call finds nothing to rename. */
export async function retireLegacyMemories(dir: string): Promise<void> {
  await rename(`${dir}/memories.enc`, `${dir}/memories.enc.imported`).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw new Error(`Renaming ${dir}/memories.enc failed.`, { cause: error });
  });
}
