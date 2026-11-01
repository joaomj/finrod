import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { access, constants, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const TRANSCRIBE_TIMEOUT_MS = 5 * 60_000;
const ABANDONED_AFTER_MS = 24 * 60 * 60_000;
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

/** A voice request the server cannot serve; `status` is the HTTP status. */
export class VoiceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Spoken messages. The app uploads the recording in chunks while the user speaks; on finish the server joins the
 * chunks, runs the configured transcribe command on the audio, and deletes the audio. The transcript is the record.
 */
export class Voice {
  private constructor(
    private readonly dir: string,
    private readonly command: string | undefined,
  ) {}

  static async open(dir: string, command: string | undefined): Promise<Voice> {
    if (command) {
      try {
        await access(command, constants.X_OK);
      } catch (error) {
        throw new Error(`FINROD_TRANSCRIBE_COMMAND "${command}" is not an executable file. Set it to the transcribe script's path, or unset it.`, { cause: error });
      }
    }
    await mkdir(dir, { recursive: true, mode: 0o700 });
    for (const name of await readdir(dir)) {
      const session = join(dir, name);
      if (Date.now() - (await stat(session)).mtimeMs > ABANDONED_AFTER_MS) await rm(session, { recursive: true, force: true });
    }
    return new Voice(dir, command);
  }

  private session(id: string): string {
    if (!/^[a-f0-9]{16}$/.test(id)) throw new VoiceError(404, "Recording not found.");
    return join(this.dir, id);
  }

  async start(): Promise<string> {
    if (!this.command) {
      throw new VoiceError(501, "Voice is not set up on this server. Set FINROD_TRANSCRIBE_COMMAND to a transcribe script (see docs/OPERATIONS.md).");
    }
    const id = randomBytes(8).toString("hex");
    await mkdir(this.session(id), { mode: 0o700 });
    return id;
  }

  async chunk(id: string, seq: string, bytes: Buffer): Promise<void> {
    if (!/^\d{1,6}$/.test(seq)) throw new VoiceError(400, "Chunk number must be an integer.");
    const dir = this.session(id);
    try {
      await writeFile(join(dir, `${seq.padStart(6, "0")}.part`), bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new VoiceError(404, "Recording not found.");
      throw error;
    }
  }

  async cancel(id: string): Promise<void> {
    await rm(this.session(id), { recursive: true, force: true });
  }

  /** Transcribe what the chunks hold so far, then delete the recording. */
  async finish(id: string, extension: string): Promise<string> {
    const dir = this.session(id);
    if (!/^[a-z0-9]{2,5}$/.test(extension)) throw new VoiceError(400, "Audio format is not valid.");
    let names: string[];
    try {
      names = (await readdir(dir)).filter((name) => name.endsWith(".part")).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new VoiceError(404, "Recording not found.");
      throw error;
    }
    if (names.length === 0) throw new VoiceError(400, "The recording is empty.");
    const audio = join(dir, `audio.${extension}`);
    await writeFile(audio, Buffer.concat(await Promise.all(names.map((name) => readFile(join(dir, name))))));
    try {
      const { stdout } = await run(this.command!, [audio], { timeout: TRANSCRIBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
      const text = stdout.trim();
      if (!text) throw new VoiceError(422, "No speech was found in the recording.");
      return text;
    } catch (error) {
      if (error instanceof VoiceError) throw error;
      throw new Error(`Transcribing ${audio} with ${this.command} failed.`, { cause: error });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
