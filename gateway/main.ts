// The Matrix gateway: one process logged in as the bot. It routes each user's messages to that user's Finrod core
// and posts the core's answers back to the user's room. It stores only its Matrix login and encryption keys.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import MarkdownIt from "markdown-it";

type Env = Record<string, string | undefined>;

/** Read and validate settings; throw with the setting name and the fix. */
function loadConfig(env: Env) {
  const need = (name: string, fix: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set. ${fix}`);
    return value;
  };
  const homeserver = need("MATRIX_HOMESERVER", "Set it to the Synapse client address, such as http://127.0.0.1:8008.").replace(/\/+$/, "");
  const user = need("MATRIX_USER", "Set it to the bot's full user ID, such as @finrod:example.org.");
  const passwordFile = resolve(need("MATRIX_PASSWORD_FILE", "Set it to the file that holds the bot's password."));
  const token = need("FINROD_GATEWAY_TOKEN", "Use the same value as in the cores' environment.");
  const stateDir = resolve(need("FINROD_GATEWAY_STATE", "Set it to a private directory for the bot's login and keys."));
  const cores = new Map<string, string>();
  for (const pair of need("FINROD_GATEWAY_USERS", "List user=core pairs, such as @marcos:example.org=http://127.0.0.1:8787.").split(",")) {
    const match = /^\s*(@[^=\s]+:[^=\s]+)=(http:\/\/127\.0\.0\.1:\d+)\s*$/.exec(pair);
    if (!match) throw new Error(`FINROD_GATEWAY_USERS entry "${pair}" must be @user:server=http://127.0.0.1:<port>.`);
    cores.set(match[1]!, match[2]!);
  }
  return { homeserver, user, passwordFile, token, stateDir, cores };
}

const config = loadConfig(process.env);
await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
// node-indexeddb keeps its files in ./indexeddb of the working directory when it is first imported.
process.chdir(config.stateDir);
const { default: dbManager } = await import("node-indexeddb/dbManager");
await dbManager.loadCache();
await import("node-indexeddb/auto");
const sdk = await import("matrix-js-sdk");
// The SDK logs every request at debug level; its logger is a loglevel instance.
((await import("matrix-js-sdk/lib/logger.js")).logger as unknown as { setLevel(level: string): void }).setLevel("warn");

const markdown = new MarkdownIt({ linkify: true });
const log = (...parts: unknown[]) => console.log(...parts);

type Login = { userId: string; deviceId: string; accessToken: string };
const password = (await readFile(config.passwordFile, "utf8")).trim();
const passwordAuth = { type: "m.login.password", identifier: { type: "m.id.user", user: config.user }, password };

/** Reuse the saved device: a new one would lose the encryption keys and the cross-signing. */
async function login(): Promise<Login> {
  try {
    return JSON.parse(await readFile("login.json", "utf8")) as Login;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Reading login.json failed.", { cause: error });
  }
  const answer = await sdk.createClient({ baseUrl: config.homeserver }).loginRequest({ ...passwordAuth, initial_device_display_name: "Finrod gateway" });
  const saved: Login = { userId: answer.user_id, deviceId: answer.device_id, accessToken: answer.access_token };
  await writeFile("login.json", JSON.stringify(saved), { mode: 0o600 });
  log(`Signed in as ${saved.userId}, new device ${saved.deviceId}.`);
  return saved;
}

const session = await login();
const client = sdk.createClient({ baseUrl: config.homeserver, ...session, cryptoStore: new sdk.MemoryCryptoStore() });
await client.initRustCrypto({ useIndexedDB: true });
const crypto = client.getCrypto()!;
// The gateway keeps no sync position, so it misses device changes made while it was down; fetch every user's devices again.
await (crypto as unknown as import("matrix-js-sdk/lib/common-crypto/CryptoBackend.js").CryptoBackend).markAllTrackedUsersAsDirty();
if (!(await crypto.isCrossSigningReady())) {
  await crypto.bootstrapCrossSigning({ authUploadDeviceSigningKeys: async (make) => void (await make(passwordAuth)) });
  log("Set up cross-signing for the bot.");
}

/**
 * Each user's room with the bot, so answers that arrive after a restart know where to go, and the time of the newest
 * message forwarded from it, so a restart reads back to there and no further.
 */
type Place = { room: string; seen: number };
const roomsFile = "rooms.json";
const rooms = new Map<string, Place>();
try {
  for (const [user, place] of Object.entries(JSON.parse(await readFile(roomsFile, "utf8")) as Record<string, Place>)) rooms.set(user, place);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Reading ${roomsFile} failed.`, { cause: error });
}
const saveRooms = () => writeFile(roomsFile, JSON.stringify(Object.fromEntries(rooms)), { mode: 0o600 });

/** The core is unreachable or failing on its side, so the same request can succeed later. */
class CoreDown extends Error {}

async function core(user: string, path: string, init: RequestInit = {}) {
  const response = await fetch(config.cores.get(user)! + path, {
    ...init,
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json", ...(init.headers as Record<string, string>) },
  }).catch((error: unknown) => {
    throw new CoreDown(`${init.method ?? "GET"} ${path} for ${user} could not reach the core.`, { cause: error });
  });
  if (!response.ok) {
    const message = `${init.method ?? "GET"} ${path} for ${user} returned ${response.status}: ${await response.text()}`;
    throw response.status >= 500 ? new CoreDown(message) : new Error(message);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

/** A room is used only when it is a direct room between the bot and one known user. */
function owner(roomId: string): string | undefined {
  const room = client.getRoom(roomId);
  const members = room?.getJoinedMembers().map((member) => member.userId) ?? [];
  const others = members.filter((id) => id !== session.userId);
  return others.length === 1 && config.cores.has(others[0]!) ? others[0] : undefined;
}

/** The bytes of an encrypted attachment (Matrix spec: AES-CTR, key and IV in the event). */
async function download(content: Record<string, any>): Promise<Buffer> {
  const file = content.file as { url: string; key: import("node:crypto").webcrypto.JsonWebKey; iv: string; hashes: { sha256: string } } | undefined;
  const mxc = file?.url ?? (content.url as string);
  const [, server, id] = /^mxc:\/\/([^/]+)\/(.+)$/.exec(mxc) ?? [];
  if (!server || !id) throw new Error(`Attachment address "${mxc}" is not an mxc:// URL.`);
  const response = await fetch(`${config.homeserver}/_matrix/client/v1/media/download/${server}/${id}`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  if (!response.ok) throw new Error(`Downloading ${mxc} returned ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!file) return bytes;
  const digest = createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "");
  if (digest !== file.hashes.sha256.replace(/=+$/, "")) throw new Error(`Attachment ${mxc} does not match its hash.`);
  const key = await globalThis.crypto.subtle.importKey("jwk", file.key, { name: "AES-CTR" }, false, ["decrypt"]);
  const iv = Buffer.from(file.iv, "base64");
  return Buffer.from(await globalThis.crypto.subtle.decrypt({ name: "AES-CTR", counter: iv, length: 64 }, key, bytes));
}

/** A voice note becomes text through the core's own voice API. */
async function transcribe(user: string, content: Record<string, any>): Promise<string> {
  const audio = await download(content);
  const answer = await core(user, "/api/voice?extension=ogg", { method: "POST", body: audio, headers: { "content-type": "application/octet-stream" } });
  return String(answer.text ?? "");
}

async function forward(user: string, event: InstanceType<typeof sdk.MatrixEvent>) {
  const content = event.getContent();
  // A sync can deliver an event again; the core drops a repeated requestId.
  const requestId = `mx-${createHash("sha256").update(event.getId()!).digest("hex").slice(0, 40)}`;
  let body: Record<string, unknown>;
  if (content.msgtype === "m.text") body = { text: String(content.body ?? "") };
  else if (content.msgtype === "m.audio") {
    const seconds = typeof content.info?.duration === "number" ? Math.round(content.info.duration / 1000) : 0;
    body = { text: await transcribe(user, content), voice: seconds };
  } else {
    await client.sendTextMessage(event.getRoomId()!, "Por enquanto eu leio só texto e mensagens de voz.");
    return;
  }
  const { id } = await core(user, "/api/stream");
  await core(user, `/api/conversations/${id}/messages`, { method: "POST", body: JSON.stringify({ ...body, requestId }) });
}

client.on(sdk.RoomMemberEvent.Membership, async (event, member) => {
  if (member.userId !== session.userId || member.membership !== "invite") return;
  const inviter = event.getSender()!;
  if (!config.cores.has(inviter)) return log(`Ignored an invite from ${inviter}.`);
  await client.joinRoom(member.roomId);
  log(`Joined ${member.roomId}, invited by ${inviter}.`);
});

client.on(sdk.MatrixEventEvent.Decrypted, async (event) => {
  const user = event.getSender()!;
  if (user === session.userId) return;
  if (event.isDecryptionFailure()) return log(`Could not decrypt ${event.getId()} from ${user}: ${event.decryptionFailureReason}.`);
  if (event.getType() !== "m.room.message") return;
  const roomId = event.getRoomId()!;
  if (owner(roomId) !== user) return;
  // One queue per user keeps their messages in order while the core is down.
  const queue = (queues.get(user) ?? Promise.resolve())
    .then(() => deliverMessage(user, roomId, event))
    .catch((error: unknown) => console.error(`Delivering ${event.getId()} from ${user} failed:`, error instanceof Error ? error.message : error));
  queues.set(user, queue);
  await queue;
});

const queues = new Map<string, Promise<void>>();
const WAITING = "⏳";

/** Forward one message, retrying while the core is down; the room keeps the message, so nothing is lost meanwhile. */
async function deliverMessage(user: string, roomId: string, event: InstanceType<typeof sdk.MatrixEvent>) {
  for (let delay = 1_000, waiting = false; ; delay = Math.min(delay * 2, 60_000)) {
    try {
      await forward(user, event);
      break;
    } catch (error) {
      if (!(error instanceof CoreDown)) {
        console.error(`Forwarding ${event.getId()} from ${user} failed:`, error instanceof Error ? error.message : error);
        await client.sendTextMessage(roomId, "Não consegui entregar sua mensagem ao Finrod.");
        return;
      }
      console.error(`Forwarding ${event.getId()} from ${user} failed; retrying in ${delay / 1000} s:`, error.message);
      // A replayed message older than `seen` was most likely delivered before, so it waits without a mark.
      if (!waiting && event.getTs() > (rooms.get(user)?.seen ?? 0)) {
        await client.sendEvent(roomId, "m.reaction" as never, { "m.relates_to": { rel_type: "m.annotation", event_id: event.getId(), key: WAITING } } as never);
        waiting = true;
      }
      await new Promise((done) => setTimeout(done, delay));
    }
  }
  // Events can arrive out of order, so `seen` only bounds how far a restart reads back; the core drops repeated messages.
  const place = rooms.get(user);
  rooms.set(user, { room: roomId, seen: Math.max(event.getTs(), place?.room === roomId ? place.seen : 0) });
  await saveRooms();
  // Read the marks from the room rather than memory, so a mark left by an earlier run goes too.
  const marks = client.getRoom(roomId)?.getLiveTimeline().getEvents().filter((mark) => {
    const relation = mark.getRelation();
    return mark.getType() === "m.reaction" && mark.getSender() === session.userId && !mark.isRedacted() && relation?.event_id === event.getId() && relation?.key === WAITING;
  });
  for (const mark of marks ?? []) await client.redactEvent(roomId, mark.getId()!);
}

type Answer = { id: number; text: string; error?: string };

// Synapse refuses events over 65,536 bytes, and encryption grows the body and its HTML by about a third.
const MESSAGE_BYTES = 40_000;
const fits = (part: string) => Buffer.byteLength(part) + Buffer.byteLength(markdown.render(part)) <= MESSAGE_BYTES;

/** Join `units` with `separator` into as few wrapped parts as fit one message; `split` cuts a unit too large by itself. */
function pack(units: string[], separator: string, split: (unit: string) => string[], wrap = (part: string) => part): string[] {
  const result: string[] = [];
  let part: string | undefined;
  for (const unit of units) {
    const joined = part === undefined ? unit : part + separator + unit;
    if (fits(wrap(joined))) {
      part = joined;
      continue;
    }
    if (part !== undefined) result.push(wrap(part));
    part = undefined;
    if (fits(wrap(unit))) part = unit;
    else result.push(...split(unit));
  }
  if (part !== undefined) result.push(wrap(part));
  return result;
}

/** An answer cut into Markdown parts that each fit one Matrix message: between top-level blocks where it can, and a cut code block reopened in each part. */
function parts(text: string): string[] {
  const characters = (line: string, wrap?: (part: string) => string) => pack(line.match(/[^]{1,1000}/gu)!, "", (piece) => [piece], wrap);
  const lines = text.split("\n");
  const starts = markdown.parse(text, {}).filter((token) => token.level === 0 && token.map).map((token) => token.map![0]);
  const cuts = [...new Set([0, ...starts])].sort((a, b) => a - b);
  const blocks = cuts.map((start, index) => lines.slice(start, cuts[index + 1]).join("\n"));
  return pack(blocks, "\n", (block) => {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(block)?.[1];
    if (!fence) return pack(block.split("\n"), "\n", (line) => characters(line));
    const [open, ...rest] = block.split("\n");
    const close = rest.findLastIndex((line) => line.trim().startsWith(fence));
    const wrap = (code: string) => `${open}\n${code}\n${fence}`;
    return pack(close < 0 ? rest : rest.slice(0, close), "\n", (line) => characters(line, wrap), wrap);
  });
}

/** Whether Synapse refused an event for good, so that sending it again fails the same way. */
function refused(error: unknown): error is InstanceType<typeof sdk.MatrixError> {
  return error instanceof sdk.MatrixError && error.httpStatus !== undefined && error.httpStatus >= 400 && error.httpStatus < 500 && error.httpStatus !== 429;
}

/** Deliver one user's pending answers to their room, then acknowledge them. */
async function deliver(user: string) {
  const roomId = rooms.get(user)?.room;
  if (!roomId) return;
  // Someone may have joined since the question; an answer never goes to a room the user does not have alone with the bot.
  if (owner(roomId) !== user) return log(`Holding ${user}'s answers: ${roomId} is no longer their direct room with the bot.`);
  const { answers } = (await core(user, "/api/gateway/answers")) as unknown as { answers: Answer[] };
  for (const answer of answers) {
    try {
      const text = answer.text || `(${answer.error ?? "Sem resposta."})`;
      for (const part of parts(text)) await client.sendHtmlMessage(roomId, part, markdown.render(part));
    } catch (error) {
      // An answer Synapse refuses would hold every later answer back, so the user gets a notice in its place.
      if (!refused(error)) throw error;
      console.error(`Synapse refused answer ${answer.id} for ${user}:`, error.message);
      await client.sendNotice(roomId, `(Não consegui entregar esta resposta: ${error.errcode ?? error.httpStatus}.)`);
    }
    await core(user, "/api/gateway/answers/ack", { method: "POST", body: JSON.stringify({ id: answer.id }) });
  }
}

/** Follow one user's conversation: show typing while the core answers, deliver answers as they land. */
async function follow(user: string) {
  for (let delay = 1_000; ; delay = Math.min(delay * 2, 60_000)) {
    try {
      const { id } = await core(user, "/api/stream");
      const response = await fetch(`${config.cores.get(user)}/api/conversations/${id}/events`, { headers: { authorization: `Bearer ${config.token}` } });
      if (!response.ok || !response.body) throw new Error(`The event stream returned ${response.status}.`);
      delay = 1_000;
      const decoder = new TextDecoder();
      let buffered = "";
      let busy = false;
      let delivering = Promise.resolve();
      // A failed delivery leaves the answers unacknowledged in the core; the next change tries again.
      const retry = (error: unknown) => console.error(`Delivering ${user}'s answers failed:`, error instanceof Error ? error.message : error);
      for await (const chunk of response.body) {
        buffered += decoder.decode(chunk as Uint8Array, { stream: true });
        for (let end = buffered.indexOf("\n\n"); end >= 0; end = buffered.indexOf("\n\n")) {
          const event = /^event: (\w+)\ndata: (.*)$/m.exec(buffered.slice(0, end));
          buffered = buffered.slice(end + 2);
          if (event?.[1] === "messages") delivering = delivering.then(() => deliver(user)).catch(retry);
          if (event?.[1] === "live") {
            const now = (JSON.parse(event[2]!) as { busy: boolean }).busy;
            const roomId = rooms.get(user)?.room;
            if (roomId && now !== busy) void client.sendTyping(roomId, now, now ? 120_000 : 0).catch(() => {});
            busy = now;
          }
        }
      }
      throw new Error("The event stream ended.");
    } catch (error) {
      console.error(`Following ${user}'s core failed; retrying in ${delay / 1000} s:`, error instanceof Error ? error.message : error);
      await new Promise((done) => setTimeout(done, delay));
    }
  }
}

await client.startClient({ initialSyncLimit: 20 });
await new Promise((done) => client.once(sdk.ClientEvent.Sync, done));
// The first sync holds only the newest events; messages sent while the gateway was down can lie further back.
for (const { room: roomId, seen } of rooms.values()) {
  const room = client.getRoom(roomId);
  while (room) {
    const timeline = room.getLiveTimeline();
    const oldest = timeline.getEvents()[0]?.getTs() ?? 0;
    if (oldest <= seen || !timeline.getPaginationToken(sdk.EventTimeline.BACKWARDS)) break;
    await client.scrollback(room, 50);
  }
}
for (const user of config.cores.keys()) void follow(user);
log(`Finrod gateway running as ${session.userId} (device ${session.deviceId}) for ${[...config.cores.keys()].join(", ")}.`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    client.stopClient();
    await dbManager.flushWrites();
    process.exit(0);
  });
}
