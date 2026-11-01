import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { access, constants, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const TRANSCRIBE_TIMEOUT_MS = 5 * 60_000;
/** Wall-clock time between background passes; chunks arrive in real time, so this is about this much new speech. */
const PASS_EVERY_MS = 12_000;
/** A segment that ends this close to the end of the audio may still be cut mid-word; a later pass decides it. */
const TAIL_GUARD_S = 3;
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

/** A voice request the server cannot serve; `status` is the HTTP status. */
export class VoiceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Segment = { start: number; end: number; text: string };

type Recording = {
  readonly dir: string;
  readonly extension: string;
  readonly chunks: Set<number>;
  /** Speech already transcribed and final, in order. */
  readonly kept: Segment[];
  keptUntil: number;
  lastPassAt: number;
  running: Promise<void> | undefined;
  /** Stops the background pass in flight. */
  stopPass: AbortController | undefined;
  /** Set once the recording ends or is cancelled; a pass that fails after that is expected. */
  closed: boolean;
};

/**
 * Spoken messages. The app uploads the recording in chunks while the user speaks. While it arrives, the server
 * transcribes the speech heard so far and keeps the finished segments; when the user stops, only the rest is
 * transcribed. The audio is deleted afterwards; the transcript is the record.
 */
export class Voice {
  private readonly recordings = new Map<string, Recording>();

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
    // A recording does not survive a restart, so whatever is left here is abandoned.
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return new Voice(dir, command);
  }

  private get(id: string): Recording {
    const recording = this.recordings.get(id);
    if (!recording) throw new VoiceError(404, "Recording not found.");
    return recording;
  }

  async start(extension: string): Promise<string> {
    if (!this.command) {
      throw new VoiceError(501, "Voice is not set up on this server. Set FINROD_TRANSCRIBE_COMMAND to a transcribe script (see docs/OPERATIONS.md).");
    }
    if (!/^[a-z0-9]{2,5}$/.test(extension)) throw new VoiceError(400, "Audio format is not valid.");
    const id = randomBytes(8).toString("hex");
    const dir = join(this.dir, id);
    await mkdir(dir, { mode: 0o700 });
    this.recordings.set(id, { dir, extension, chunks: new Set(), kept: [], keptUntil: 0, lastPassAt: Date.now(), running: undefined, stopPass: undefined, closed: false });
    return id;
  }

  async chunk(id: string, seq: string, bytes: Buffer): Promise<void> {
    const recording = this.get(id);
    if (!/^\d{1,6}$/.test(seq)) throw new VoiceError(400, "Chunk number must be an integer.");
    await writeFile(join(recording.dir, `${seq.padStart(6, "0")}.part`), bytes);
    recording.chunks.add(Number(seq));
    if (!recording.running && Date.now() - recording.lastPassAt >= PASS_EVERY_MS) {
      recording.lastPassAt = Date.now();
      const stop = new AbortController();
      recording.stopPass = stop;
      recording.running = this.pass(recording, false, stop.signal)
        .catch((error: unknown) => {
          // The final pass starts again from what was kept, so a failed background pass loses nothing.
          if (!recording.closed) console.error("Voice: a background transcription pass failed; the final pass will retry.", error);
        })
        .finally(() => {
          recording.running = undefined;
          recording.stopPass = undefined;
        });
    }
  }

  async cancel(id: string): Promise<void> {
    const recording = this.get(id);
    recording.closed = true;
    recording.stopPass?.abort();
    this.recordings.delete(id);
    await rm(recording.dir, { recursive: true, force: true });
  }

  /** Transcribe what is left after the background passes, return the whole transcript, and delete the audio. */
  async finish(id: string): Promise<string> {
    const recording = this.get(id);
    try {
      if (recording.chunks.size === 0) throw new VoiceError(400, "The recording is empty.");
      // A background pass still running covers audio the final pass transcribes anyway, so stop it instead of waiting.
      recording.closed = true;
      recording.stopPass?.abort();
      await recording.running;
      await this.pass(recording, true);
      const text = recording.kept.map((segment) => segment.text).join(" ").trim();
      if (!text) throw new VoiceError(422, "No speech was found in the recording.");
      return text;
    } finally {
      recording.closed = true;
      this.recordings.delete(id);
      await rm(recording.dir, { recursive: true, force: true });
    }
  }

  /** Transcribe the audio received so far, from the end of what is kept. A background pass keeps only safe segments. */
  private async pass(recording: Recording, final: boolean, signal?: AbortSignal): Promise<void> {
    let count = 0;
    while (recording.chunks.has(count)) count += 1;
    if (final && count !== recording.chunks.size) {
      throw new VoiceError(400, `The recording is missing audio chunk ${count}. Record again.`);
    }
    const audio = join(recording.dir, `audio.${recording.extension}`);
    const parts = await Promise.all(Array.from({ length: count }, (_, n) => readFile(join(recording.dir, `${String(n).padStart(6, "0")}.part`))));
    await writeFile(audio, Buffer.concat(parts));

    const heard = await this.transcribe(audio, recording.keptUntil, signal);
    const safe = final ? heard.segments : heard.segments.filter((segment) => segment.end <= heard.duration - TAIL_GUARD_S);
    recording.kept.push(...safe);
    if (safe.length) recording.keptUntil = safe[safe.length - 1]!.end;
  }

  private async transcribe(audio: string, from: number, signal?: AbortSignal): Promise<{ duration: number; segments: Segment[] }> {
    let stdout: string;
    try {
      ({ stdout } = await run(this.command!, [audio, "--from", String(from)], { timeout: TRANSCRIBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, ...(signal ? { signal } : {}) }));
    } catch (error) {
      throw new Error(`Transcribing ${audio} with ${this.command} failed.`, { cause: error });
    }
    const result = JSON.parse(stdout) as { duration?: unknown; segments?: unknown };
    const segments = result.segments;
    if (
      typeof result.duration !== "number" ||
      !Array.isArray(segments) ||
      !segments.every((s) => s && typeof s.start === "number" && typeof s.end === "number" && typeof s.text === "string")
    ) {
      throw new Error(`${this.command} must print {"duration": number, "segments": [{"start", "end", "text"}]}; got: ${stdout.slice(0, 200)}`);
    }
    return { duration: result.duration, segments: segments as Segment[] };
  }
}
