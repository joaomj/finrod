import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { access, constants, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const TRANSCRIBE_TIMEOUT_MS = 5 * 60_000;
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/** A voice request the server cannot serve; `status` is the HTTP status. */
export class VoiceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Segment = { start: number; end: number; text: string };

/** Spoken messages: the audio is written to disk only while it is transcribed. The transcript is the record. */
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
    // Audio left here by a process that died mid-transcription is abandoned.
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return new Voice(dir, command);
  }

  /** Transcribe one voice note and delete its audio. */
  async transcribe(extension: string, audio: Buffer): Promise<string> {
    if (!this.command) {
      throw new VoiceError(501, "Voice is not set up on this server. Set FINROD_TRANSCRIBE_COMMAND to a transcribe script (see docs/OPERATIONS.md).");
    }
    if (!/^[a-z0-9]{2,5}$/.test(extension)) throw new VoiceError(400, "Audio format is not valid.");
    if (audio.length === 0) throw new VoiceError(400, "The recording is empty.");
    const dir = join(this.dir, randomBytes(8).toString("hex"));
    await mkdir(dir, { mode: 0o700 });
    try {
      const file = join(dir, `audio.${extension}`);
      await writeFile(file, audio);
      const text = (await this.run(file)).map((segment) => segment.text).join(" ").trim();
      if (!text) throw new VoiceError(422, "No speech was found in the recording.");
      return text;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async run(audio: string): Promise<Segment[]> {
    // The command's output and its errors can hold what the user said, and errors reach the system log. Only the
    // exit status leaves this function, never the output.
    let stdout: string;
    try {
      ({ stdout } = await run(this.command!, [audio], { timeout: TRANSCRIBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }));
    } catch (error) {
      const { code, signal } = error as { code?: unknown; signal?: unknown };
      throw new Error(`Transcribing ${audio} with ${this.command} failed (exit code ${String(code)}, signal ${String(signal)}). Run the command by hand to see its output.`);
    }
    const shape = `${this.command} must print {"duration": number, "segments": [{"start", "end", "text"}]}; run it by hand to see its output.`;
    let result: { duration?: unknown; segments?: unknown };
    try {
      result = JSON.parse(stdout) as typeof result;
    } catch {
      throw new Error(shape);
    }
    const segments = result.segments;
    if (
      typeof result.duration !== "number" ||
      !Array.isArray(segments) ||
      !segments.every((s) => s && typeof s.start === "number" && typeof s.end === "number" && typeof s.text === "string")
    ) {
      throw new Error(shape);
    }
    return segments as Segment[];
  }
}
