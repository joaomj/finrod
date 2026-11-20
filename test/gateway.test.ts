// The gateway against a real Synapse in Podman, two real Finrod cores, and encrypted Matrix clients as the users.
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import * as sdk from "matrix-js-sdk";
import { logger } from "matrix-js-sdk/lib/logger.js";
import { call, follow, freePort, GATEWAY_TOKEN, newDataDir, startServer } from "./finrod.ts";

const SYNAPSE = "docker.io/matrixdotorg/synapse:v1.164.2";
const SERVER = "test.local";
const PASSWORD = "test-password-0123456789";
const run = promisify(execFile);
(logger as unknown as { setLevel(level: string): void }).setLevel("error");

/** Poll `check` until it returns a value. */
async function until<T>(what: string, check: () => T | undefined | Promise<T | undefined>, ms = 30_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 200))) {
    const value = await check();
    if (value !== undefined && value !== false) return value;
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

async function startSynapse() {
  const dir = await mkdtemp(join(tmpdir(), "finrod-synapse-"));
  const port = await freePort();
  const name = `finrod-test-synapse-${port}`;
  const env = ["-e", `SYNAPSE_SERVER_NAME=${SERVER}`, "-e", "SYNAPSE_REPORT_STATS=no", "-e", "UID=0", "-e", "GID=0"];
  await run("podman", ["run", "--rm", "-v", `${dir}:/data:Z`, ...env, SYNAPSE, "generate"]);
  const fast = "{per_second: 1000, burst_count: 1000}";
  await appendFile(
    join(dir, "homeserver.yaml"),
    `
enable_registration: true
enable_registration_without_verification: true
rc_message: ${fast}
rc_registration: ${fast}
rc_joins: {local: ${fast}}
rc_invites: {per_room: ${fast}, per_user: ${fast}}
rc_login: {address: ${fast}, account: ${fast}, failed_attempts: ${fast}}
`,
  );
  await run("podman", ["run", "-d", "--rm", "--name", name, "-p", `127.0.0.1:${port}:8008`, "-v", `${dir}:/data:Z`, ...env, SYNAPSE]);
  const url = `http://127.0.0.1:${port}`;
  await until("Synapse to start", async () => (await fetch(`${url}/health`).catch(() => undefined))?.ok, 60_000);
  return { url, stop: async () => (await run("podman", ["rm", "-f", name]), await rm(dir, { recursive: true, force: true })) };
}

/** Register a user with the dummy flow and return the login. */
async function register(url: string, username: string) {
  const request = (auth?: object) =>
    fetch(`${url}/_matrix/client/v3/register`, { method: "POST", body: JSON.stringify({ username, password: PASSWORD, ...(auth ? { auth } : {}) }) });
  const { session } = (await (await request()).json()) as { session: string };
  const response = await request({ type: "m.login.dummy", session });
  if (!response.ok) throw new Error(`Registering ${username} returned ${response.status}: ${await response.text()}`);
  return (await response.json()) as { user_id: string; device_id: string; access_token: string };
}

/** A user's Element: an encrypted client that keeps every message the bot sends it. */
async function person(url: string, username: string) {
  const login = await register(url, username);
  const client = sdk.createClient({ baseUrl: url, userId: login.user_id, deviceId: login.device_id, accessToken: login.access_token });
  await client.initRustCrypto({ useIndexedDB: false });
  const received: sdk.MatrixEvent[] = [];
  client.on(sdk.RoomEvent.Timeline, async (event) => {
    await client.decryptEventIfNeeded(event);
    if (event.getSender() !== login.user_id && event.getType() === "m.room.message") received.push(event);
  });
  await client.startClient({ initialSyncLimit: 0 });
  await new Promise((resolve) => client.once(sdk.ClientEvent.Sync, resolve));
  const texts = (room: string) => received.filter((event) => event.getRoomId() === room).map((event) => String(event.getContent().body));
  return {
    id: login.user_id,
    client,
    texts,
    /** Wait until the bot has sent a message in `room` that matches. */
    reply: (room: string, pattern: RegExp) => until(`a reply matching ${pattern} in ${room}`, () => received.find((e) => e.getRoomId() === room && pattern.test(String(e.getContent().body)))),
    /** Open an encrypted direct room with the bot. */
    async dm(bot: string) {
      const { room_id } = await client.createRoom({
        invite: [bot],
        is_direct: true,
        preset: sdk.Preset.TrustedPrivateChat,
        initial_state: [{ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }],
      });
      return room_id;
    },
  };
}

let synapse: Awaited<ReturnType<typeof startSynapse>>;
let cores: { alice: Awaited<ReturnType<typeof startServer>>; bob: Awaited<ReturnType<typeof startServer>> };
let alice: Awaited<ReturnType<typeof person>>;
let bob: Awaited<ReturnType<typeof person>>;
let mallory: Awaited<ReturnType<typeof person>>;
let bot: string;
let bobDir: string;
let gatewayState: string;
let gateway: { output: () => string; stop: () => Promise<unknown> };
const rooms = { alice: "", bob: "" };

async function startGateway() {
  const child: ChildProcess = spawn(process.execPath, ["dist/gateway/main.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MATRIX_HOMESERVER: synapse.url,
      MATRIX_USER: bot,
      MATRIX_PASSWORD_FILE: join(gatewayState, "..", "password"),
      FINROD_GATEWAY_TOKEN: GATEWAY_TOKEN,
      FINROD_GATEWAY_STATE: gatewayState,
      FINROD_GATEWAY_USERS: `${alice.id}=${cores.alice.base},${bob.id}=${cores.bob.base}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout!.on("data", (data: Buffer) => (output += data.toString()));
  child.stderr!.on("data", (data: Buffer) => {
    output += data.toString();
    process.stderr.write(data);
  });
  await until("the gateway to start", () => {
    if (child.exitCode !== null) throw new Error(`The gateway exited with code ${child.exitCode}:\n${output}`);
    return output.includes("Finrod gateway running");
  }, 60_000);
  return { output: () => output, stop: () => new Promise((resolve) => (child.once("exit", resolve), child.kill("SIGTERM"))) };
}

/** Every user message a core holds, in order. */
async function heard(core: { base: string }) {
  const id = ((await (await call(`${core.base}/api/stream`)).json()) as { id: number }).id;
  const messages = (await follow(core.base, id, () => true)).at(-1)!.messages;
  return messages.filter((message) => message.role === "user").map((message) => message.text);
}

before(async () => {
  synapse = await startSynapse();
  bobDir = await newDataDir();
  cores = { alice: await startServer(await newDataDir(), { hang: false, wikiIdleSeconds: 1 }), bob: await startServer(bobDir, { hang: false, wikiIdleSeconds: 1 }) };
  bot = (await register(synapse.url, "finrod")).user_id;
  const dir = await mkdtemp(join(tmpdir(), "finrod-gateway-"));
  await writeFile(join(dir, "password"), PASSWORD);
  gatewayState = join(dir, "state");
  [alice, bob, mallory] = await Promise.all([person(synapse.url, "alice"), person(synapse.url, "bob"), person(synapse.url, "mallory")]);
  gateway = await startGateway();
  for (const user of ["alice", "bob"] as const) {
    const who = { alice, bob }[user];
    rooms[user] = await who.dm(bot);
    await until(`the bot to join ${user}'s room`, () => who.client.getRoom(rooms[user])?.getMember(bot)?.membership === "join");
  }
});

after(async () => {
  await gateway?.stop();
  for (const user of [alice, bob, mallory]) user?.client.stopClient();
  await Promise.all([cores?.alice.kill(), cores?.bob.kill()]);
  await synapse?.stop();
});

test("each user's message reaches only their own core, and the answer returns to their room", { timeout: 60_000 }, async () => {
  const strangerRoom = await mallory.dm(bot);
  await alice.client.sendTextMessage(rooms.alice, "hello from alice");
  await bob.client.sendTextMessage(rooms.bob, "hello from bob");
  await alice.reply(rooms.alice, /^Stub answer to: hello from alice$/);
  await bob.reply(rooms.bob, /^Stub answer to: hello from bob$/);
  assert.deepEqual(await heard(cores.alice), ["hello from alice"]);
  assert.deepEqual(await heard(cores.bob), ["hello from bob"]);
  assert.match(gateway.output(), new RegExp(`Ignored an invite from ${mallory.id}`));
  assert.notEqual(mallory.client.getRoom(strangerRoom)?.getMember(bot)?.membership, "join", "the bot stays out of a stranger's room");
});

test("a voice note is decrypted, transcribed by the user's core, and answered", { timeout: 60_000 }, async () => {
  const key = await crypto.subtle.generateKey({ name: "AES-CTR", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv.subarray(0, 8));
  const audio = Buffer.from(await crypto.subtle.encrypt({ name: "AES-CTR", counter: iv, length: 64 }, key, Buffer.from("ok spoken words")));
  const { content_uri } = await alice.client.uploadContent(audio, { type: "application/octet-stream" });
  const file = {
    url: content_uri,
    key: await crypto.subtle.exportKey("jwk", key),
    iv: Buffer.from(iv).toString("base64").replace(/=+$/, ""),
    hashes: { sha256: createHash("sha256").update(audio).digest("base64").replace(/=+$/, "") },
    v: "v2",
  };
  await alice.client.sendMessage(rooms.alice, { msgtype: "m.audio", body: "voice.ogg", info: { duration: 2000 }, file } as never);
  await alice.reply(rooms.alice, /^Stub answer to: spoken words$/);
});

test("a 👎 on a wiki change undoes it, once, even after a restart that missed a message", { timeout: 120_000 }, async () => {
  await alice.client.sendTextMessage(rooms.alice, "remember: likes green tea");
  const report = await alice.reply(rooms.alice, /^Atualizei minhas notas:\ncore\.md:\n\+ likes green tea\nReaja com 👎 para desfazer\.$/);
  await alice.client.sendTextMessage(rooms.alice, "what do you know?");
  await alice.reply(rooms.alice, /^Stub answer to: what do you know\? \(knows: likes green tea\)$/);
  await alice.client.sendEvent(rooms.alice, "m.reaction" as never, { "m.relates_to": { rel_type: "m.annotation", event_id: report.getId(), key: "👎" } } as never);
  await alice.reply(rooms.alice, /^Desfeito\.$/);
  await alice.client.sendTextMessage(rooms.alice, "and now?");
  await alice.reply(rooms.alice, /^Stub answer to: and now\?$/);

  await gateway.stop();
  await alice.client.sendTextMessage(rooms.alice, "sent while you were down");
  gateway = await startGateway();
  await alice.reply(rooms.alice, /^Stub answer to: sent while you were down/);
  // Bob's answer after the restart shows the gateway has read past the old reaction.
  await bob.client.sendTextMessage(rooms.bob, "after the restart");
  await bob.reply(rooms.bob, /^Stub answer to: after the restart$/);
  assert.equal(alice.texts(rooms.alice).filter((text) => /^(Desfeito|Nada a desfazer)/.test(text)).length, 1, "the reaction is handled once");
});

test("a message sent while the core is down waits under a clock and is answered once the core is back", { timeout: 120_000 }, async () => {
  const port = Number(new URL(cores.bob.base).port);
  await cores.bob.kill();
  const sent = await bob.client.sendTextMessage(rooms.bob, "are you down?");
  const clock = () =>
    bob.client.getRoom(rooms.bob)?.getLiveTimeline().getEvents().find((event) => event.getType() === "m.reaction" && event.getRelation()?.event_id === sent.event_id && event.getRelation()?.key === "⏳");
  const mark = await until("the clock on the waiting message", () => clock(), 30_000);
  cores.bob = await startServer(bobDir, { hang: false, wikiIdleSeconds: 1, port });
  await bob.reply(rooms.bob, /^Stub answer to: are you down\?$/);
  await until("the clock to go", () => mark.isRedacted(), 30_000);
  assert.ok(!bob.texts(rooms.bob).some((text) => text.startsWith("Não consegui")), "no error message while the core is down");
});

test("once a third person joins a user's room, the gateway stops forwarding from it", { timeout: 60_000 }, async () => {
  await alice.client.invite(rooms.alice, mallory.id);
  await mallory.client.joinRoom(rooms.alice);
  await until("the bot to see the third member", () => alice.client.getRoom(rooms.alice)?.getJoinedMemberCount() === 3);
  await alice.client.sendTextMessage(rooms.alice, "said in front of mallory");
  // Bob's answer shows the gateway has handled events after alice's message.
  await bob.client.sendTextMessage(rooms.bob, "still there?");
  await bob.reply(rooms.bob, /^Stub answer to: still there\?$/);
  assert.ok(!(await heard(cores.alice)).includes("said in front of mallory"));
});
