import MarkdownIt from "markdown-it";

type Vote = "up" | "down";
type Source = { title: string; url: string };
type SentFile = { id: string; kind: "image" | "document"; name: string; mime: string; size: number; unreadable?: string };
type Memory = { id: string; text: string; status: "pending" | "saved"; createdAt: number };
type Message = {
  id: number;
  role: "user" | "assistant";
  at: number;
  text: string;
  error?: string;
  vote?: Vote;
  sources?: Source[];
  files?: SentFile[];
  voice?: number;
  memories?: Pick<Memory, "id" | "text" | "status">[];
};
type Hit = { id: number; role: "user" | "assistant"; at: number; text: string };
type Live = { busy: boolean; partial?: string; retry?: string; tool?: string };
type Outgoing = { text: string; files: SentFile[]; voice?: number };
type Attachment = { file: SentFile; sending: boolean };
type Recording = {
  id: string;
  recorder: MediaRecorder;
  stream: MediaStream;
  audio: AudioContext;
  analyser: AnalyserNode;
  seq: number;
  uploads: Promise<void>;
  uploadError?: string;
  elapsedMs: number;
  resumedAt: number | undefined;
  levels: number[];
  timer: number;
  wake?: WakeLockSentinel;
};

const toolLabels: Record<string, string> = { web_search: "Pesquisando na web…", web_fetch: "Lendo páginas…" };
const MAX_UPLOAD = 20 * 1024 * 1024;
const LONG_PRESS_MS = 450;
const WAVE_BARS = 15;

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
const defaultLink = markdown.renderer.rules.link_open ?? ((tokens, i, options, _env, self) => self.renderToken(tokens, i, options));
markdown.renderer.rules.link_open = (tokens, i, options, env, self) => {
  tokens[i]!.attrSet("target", "_blank");
  tokens[i]!.attrSet("rel", "noopener noreferrer");
  return defaultLink(tokens, i, options, env, self);
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $("app");
const messagesEl = $("messages");
const composer = $<HTMLFormElement>("composer");
const notesEl = $("notes");
const input = $<HTMLTextAreaElement>("input");
const round = $<HTMLButtonElement>("round");
const attach = $<HTMLButtonElement>("attach");
const picker = $<HTMLInputElement>("picker");
const tray = $("tray");
const recBar = $("rec");
const sheet = $("sheet");
const scrim = $("scrim");

let conversation: number | undefined;
let messages: Message[] = [];
let live: Live = { busy: false };
let memories: Memory[] = [];
let attachments: Attachment[] = [];
let inflight: (Outgoing & { userCount: number }) | undefined;
let queue: Outgoing[] = [];
let failure: string | undefined;
let events: EventSource | undefined;
let exaConnected = false;
let atBottom = true;
let unseen = 0;
let recording: Recording | undefined;
let transcribing = false;
const expanded = new Set<number>();
let sheetKind: "menu" | "search" | "memory" | undefined;

const icons = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  attach: '<path d="M21 12.5 12 21a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 19a2 2 0 0 1-3-3l8-8"/>',
  mic: '<path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/>',
  up: "M7 10v11M7 10l4-8a3 3 0 0 1 3 3v4h5a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 17.6 21H7M7 10H4v11h3",
  down: "M17 14V3M17 14l-4 8a3 3 0 0 1-3-3v-4H5a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 6.4 3H17M17 14h3V3h-3",
};

function icon(path: string, extra = ""): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" class="${extra}"><path d="${path}"/></svg>`;
}
function glyph(inner: string, extra = ""): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" class="${extra}">${inner}</svg>`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fail(error: unknown) {
  failure = error instanceof Error ? error.message : String(error);
  renderMessages();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (typeof init?.body === "string" || init?.body === undefined) headers["content-type"] = "application/json";
  const response = await fetch(path, { ...init, headers });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body;
}

function startOfDay(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayLabel(at: number): string {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(at)) / 86_400_000);
  if (days === 0) return "hoje";
  if (days === 1) return "ontem";
  return new Date(at).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
}

function stamp(at: number): string {
  return new Date(at).toLocaleString("pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/* ---------- conversation ---------- */

function fileChip(file: SentFile) {
  const chip = el("div", "chip-file");
  chip.innerHTML = glyph(icons.attach);
  chip.append(el("span", undefined, `${file.name} · ${size(file.size)}`));
  if (file.unreadable) chip.append(el("p", "error", `Páginas sem texto legível: ${file.unreadable}.`));
  return chip;
}

function userBubble(item: { text: string; files?: SentFile[] | undefined; voice?: number | undefined }, className = "user") {
  const bubble = el("div", className);
  for (const file of item.files ?? []) {
    if (file.kind !== "image") continue;
    const image = el("img");
    image.src = `/api/files/${file.id}`;
    image.alt = file.name;
    image.loading = "lazy";
    bubble.append(image);
  }
  if (item.voice !== undefined) {
    const details = el("details", "voice");
    const summary = el("summary");
    summary.innerHTML = glyph(icons.mic);
    summary.append(el("span", undefined, `Voz · ${clock(item.voice)}`));
    details.append(summary, el("p", undefined, item.text));
    bubble.append(details);
  } else if (item.text) {
    bubble.append(el("p", undefined, item.text));
  }
  for (const file of item.files ?? []) if (file.kind === "document") bubble.append(fileChip(file));
  return bubble;
}

function answerCard(message: Pick<Message, "text" | "error">, caret = false) {
  const card = el("div", "answer");
  const body = el("div", "body");
  if (message.text) body.innerHTML = markdown.render(message.text);
  if (caret) {
    const last = body.lastElementChild ?? body;
    last.append(el("span", "caret"));
  }
  card.append(body);
  if (message.error) card.append(el("p", "error", message.error));
  return card;
}

function sourcesLine(message: Message, card: HTMLElement) {
  const list = message.sources ?? [];
  const open = expanded.has(message.id);
  const line = el("button", "folded");
  line.type = "button";
  line.setAttribute("aria-expanded", String(open));
  line.innerHTML = glyph(icons.search) + `<span>${list.length} ${list.length === 1 ? "página" : "páginas"}</span><span class="spacer"></span>` + glyph(icons.chevron, "chev");
  line.addEventListener("click", () => {
    if (!expanded.delete(message.id)) expanded.add(message.id);
    renderMessages();
  });
  card.append(line);
  if (!open) return;
  const items = el("ul", "sources");
  for (const source of list) {
    const item = el("li");
    const link = el("a", undefined, source.title);
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    item.append(link);
    items.append(item);
  }
  card.append(items);
}

function thumbs(message: Message) {
  const row = el("div", "tools");
  for (const vote of ["up", "down"] as const) {
    const button = el("button");
    button.type = "button";
    button.setAttribute("aria-label", vote === "up" ? "Boa resposta" : "Resposta ruim");
    button.setAttribute("aria-pressed", String(message.vote === vote));
    button.innerHTML = icon(icons[vote]);
    button.addEventListener("click", () => void rate(message, message.vote === vote ? null : vote));
    row.append(button);
  }
  return row;
}

async function rate(message: Message, vote: Vote | null) {
  if (conversation === undefined) return;
  try {
    await request(`/api/conversations/${conversation}/messages/${message.id}/vote`, { method: "PUT", body: JSON.stringify({ vote }) });
  } catch (error) {
    fail(error);
  }
}

function memoryLine(message: Message) {
  const line = el("div", "memory-line");
  const shown = message.memories ?? [];
  line.append("Lembrou: ");
  shown.forEach((memory, index) => {
    if (index > 0) line.append("; ");
    line.append(el("b", undefined, memory.text), " · ");
    const undo = el("button", undefined, "desfazer");
    undo.type = "button";
    undo.addEventListener("click", () => void memoryAction(`/api/memories/${memory.id}`, { method: "DELETE" }));
    line.append(undo);
  });
  return line;
}

function renderMessages() {
  const children: HTMLElement[] = [];
  let day = "";
  const divide = (at: number) => {
    const label = dayLabel(at);
    if (label === day) return;
    day = label;
    children.push(el("div", "divider", label));
  };
  for (const message of messages) {
    divide(message.at);
    if (message.role === "user") {
      children.push(userBubble(message));
      continue;
    }
    const card = answerCard(message);
    card.dataset.id = String(message.id);
    if (message.text) {
      if (message.sources?.length) sourcesLine(message, card);
      card.append(thumbs(message));
    }
    children.push(card);
    if (message.memories?.length) children.push(memoryLine(message));
  }
  for (const item of inflight ? [inflight] : []) {
    divide(Date.now());
    children.push(userBubble(item));
  }
  for (const item of queue) {
    divide(Date.now());
    children.push(userBubble(item, "user queued"));
  }
  if (live.partial) children.push(answerCard({ text: live.partial }, true));
  else if (live.busy || inflight) {
    const label = live.retry ? `Tentando de novo: ${live.retry}` : live.tool ? (toolLabels[live.tool] ?? "Trabalhando…") : "";
    children.push(label ? el("p", "status", label) : answerCard({ text: "" }, true));
  }
  if (failure) children.push(el("p", "error", failure));
  if (!children.length) children.push(el("p", "empty", "Como posso ajudar?"));
  if (unseen > 0) {
    const news = el("button", "news", `${unseen} ${unseen === 1 ? "nova" : "novas"} ↓`);
    news.type = "button";
    news.addEventListener("click", () => scrollToEnd());
    children.push(news);
  }
  messagesEl.replaceChildren(...children);
  if (atBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function scrollToEnd() {
  atBottom = true;
  unseen = 0;
  renderMessages();
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

messagesEl.addEventListener("scroll", () => {
  atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 60;
  if (atBottom && unseen > 0) {
    unseen = 0;
    renderMessages();
  }
});

async function refreshMemories() {
  const next = await request<Memory[]>("/api/memories");
  if (JSON.stringify(next) === JSON.stringify(memories)) return;
  memories = next;
  renderNotes();
  if (sheetKind === "memory") renderSheet();
}

function connect(id: number) {
  events?.close();
  conversation = id;
  events = new EventSource(`/api/conversations/${id}/events`);
  events.addEventListener("messages", (event) => {
    const next = JSON.parse((event as MessageEvent<string>).data) as Message[];
    if (!atBottom && next.length > messages.length) unseen += next.length - messages.length;
    messages = next;
    if (inflight && messages.filter((m) => m.role === "user").length > inflight.userCount) inflight = undefined;
    renderMessages();
    void refreshMemories().catch(fail);
  });
  events.addEventListener("live", (event) => {
    live = JSON.parse((event as MessageEvent<string>).data) as Live;
    renderMessages();
    if (!live.busy) {
      void refreshMemories().catch(fail);
      drain();
    }
  });
  events.addEventListener("missing", () => {
    events?.close();
    void start();
  });
}

async function start() {
  connect((await request<{ id: number }>("/api/stream")).id);
}

/* ---------- sending ---------- */

function compose(): Outgoing | undefined {
  const text = input.value.trim();
  const files = attachments.map((item) => item.file);
  if (!text && files.length === 0) return undefined;
  if (attachments.some((item) => item.sending)) return undefined;
  input.value = "";
  attachments = [];
  renderTray();
  resize();
  return { text, files };
}

function enqueue(item: Outgoing) {
  failure = undefined;
  if (live.busy || inflight) queue.push(item);
  else void dispatch(item);
  renderNotes();
  renderMessages();
}

function drain() {
  if (live.busy || inflight) return;
  const next = queue.shift();
  if (!next) return;
  renderNotes();
  void dispatch(next);
}

async function dispatch(item: Outgoing) {
  if (conversation === undefined) {
    queue.unshift(item);
    return;
  }
  inflight = { ...item, userCount: messages.filter((m) => m.role === "user").length };
  renderMessages();
  atBottom = true;
  try {
    await request(`/api/conversations/${conversation}/messages`, {
      method: "POST",
      body: JSON.stringify({
        text: item.text,
        requestId: crypto.randomUUID(),
        files: item.files.map((file) => ({ id: file.id, name: file.name })),
        ...(item.voice === undefined ? {} : { voice: item.voice }),
      }),
    });
  } catch (error) {
    inflight = undefined;
    if (item.voice === undefined) {
      input.value = item.text;
      attachments = item.files.map((file) => ({ file, sending: false }));
      renderTray();
      resize();
    }
    fail(error);
  }
}

function submitText() {
  const item = compose();
  if (item) enqueue(item);
}

function renderNotes() {
  const children: HTMLElement[] = [];
  const pending = memories.filter((memory) => memory.status === "pending");
  if (pending.length) {
    const note = el("div", "note memory");
    const label = pending.length === 1 ? "1 memória" : `${pending.length} memórias`;
    note.innerHTML = `<span class="long">${label} esperando revisão</span><span class="short">${label}</span><span class="spacer"></span>`;
    const see = el("button", undefined, "ver");
    see.type = "button";
    see.addEventListener("click", () => openSheet("memory"));
    note.append(see);
    children.push(note);
  }
  if (queue.length) {
    const note = el("div", "note");
    const label = queue.length === 1 ? "1 mensagem" : `${queue.length} mensagens`;
    note.innerHTML = `<span class="long">${label} na fila</span><span class="short">${queue.length} na fila</span><span class="spacer"></span>`;
    const withdraw = el("button", undefined, "retirar");
    withdraw.type = "button";
    withdraw.addEventListener("click", () => {
      queue.pop();
      renderNotes();
      renderMessages();
    });
    note.append(withdraw);
    children.push(note);
  }
  notesEl.replaceChildren(...children);
}

/* ---------- attachments ---------- */

async function upload(file: File) {
  if (file.size > MAX_UPLOAD) {
    fail(new Error(`"${file.name}" passa do limite de ${MAX_UPLOAD / (1024 * 1024)} MB.`));
    return;
  }
  const entry: Attachment = {
    file: { id: "", kind: file.type.startsWith("image/") ? "image" : "document", name: file.name, mime: file.type, size: file.size },
    sending: true,
  };
  attachments.push(entry);
  renderTray();
  try {
    entry.file = await request<SentFile>("/api/files", {
      method: "POST",
      body: file,
      headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
    });
  } catch (error) {
    attachments = attachments.filter((item) => item !== entry);
    fail(error);
  } finally {
    entry.sending = false;
    renderTray();
  }
}

function renderTray() {
  tray.hidden = attachments.length === 0;
  tray.replaceChildren(
    ...attachments.map((item) => {
      const chip = el("div", "pending");
      chip.append(el("span", undefined, item.sending ? `${item.file.name} · enviando…` : item.file.name));
      const remove = el("button", undefined, "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remover ${item.file.name}`);
      remove.addEventListener("click", () => {
        attachments = attachments.filter((other) => other !== item);
        renderTray();
        updateRound();
      });
      chip.append(remove);
      return chip;
    }),
  );
  updateRound();
}

function updateRound() {
  const empty = !input.value.trim() && attachments.length === 0;
  round.classList.toggle("off", empty || attachments.some((item) => item.sending));
}

function resize() {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
  updateRound();
}

/* ---------- voice ---------- */

function elapsedSeconds(r: Recording): number {
  return (r.elapsedMs + (r.resumedAt === undefined ? 0 : Date.now() - r.resumedAt)) / 1000;
}

function drawRecording(r: Recording) {
  $("timer").textContent = clock(elapsedSeconds(r));
  const samples = new Uint8Array(r.analyser.fftSize);
  r.analyser.getByteTimeDomainData(samples);
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
  if (r.resumedAt !== undefined) r.levels.push(peak / 128);
  r.levels = r.levels.slice(-WAVE_BARS);
  $("wave").replaceChildren(
    ...r.levels.map((level) => {
      const bar = el("i");
      bar.style.height = `${Math.max(3, Math.round(level * 56))}px`;
      return bar;
    }),
  );
}

function showRecording(on: boolean) {
  composer.classList.toggle("recording", on);
  recBar.hidden = !on;
  recBar.classList.remove("paused", "busy");
  $("pause").setAttribute("aria-label", "Pausar");
}

function release(r: Recording) {
  clearInterval(r.timer);
  r.stream.getTracks().forEach((track) => track.stop());
  void r.audio.close();
  void r.wake?.release();
}

async function startRecording() {
  if (recording || transcribing) return;
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const type = recorder.mimeType;
    const extension = type.includes("mp4") ? "mp4" : type.includes("webm") ? "webm" : type.includes("ogg") ? "ogg" : "m4a";
    const { id } = await request<{ id: string }>("/api/voice", { method: "POST", body: JSON.stringify({ extension }) });
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    audio.createMediaStreamSource(stream).connect(analyser);
    const r: Recording = { id, recorder, stream, audio, analyser, seq: 0, uploads: Promise.resolve(), elapsedMs: 0, resumedAt: Date.now(), levels: [], timer: 0 };
    recording = r;
    recorder.addEventListener("dataavailable", (event) => {
      if (!event.data.size) return;
      const seq = r.seq++;
      r.uploads = r.uploads.then(async () => {
        const response = await fetch(`/api/voice/${id}/${seq}`, { method: "PUT", body: event.data, headers: { "content-type": "application/octet-stream" } });
        if (!response.ok) r.uploadError = ((await response.json().catch(() => ({}))) as { error?: string }).error ?? `Upload failed (${response.status}).`;
      }, () => undefined);
    });
    recorder.start(5000);
    r.timer = window.setInterval(() => drawRecording(r), 120);
    try {
      r.wake = (await navigator.wakeLock?.request("screen")) ?? undefined;
    } catch (error) {
      console.warn("Screen wake lock was refused; a locked screen will stop the recording.", error);
    }
    input.blur();
    showRecording(true);
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    recording = undefined;
    fail(error instanceof DOMException && error.name === "NotAllowedError" ? new Error("O microfone não foi liberado. Permita o acesso e segure o botão de novo.") : error);
  }
}

function togglePause() {
  const r = recording;
  if (!r) return;
  if (r.resumedAt === undefined) {
    r.recorder.resume();
    r.resumedAt = Date.now();
    recBar.classList.remove("paused");
    $("pause").setAttribute("aria-label", "Pausar");
  } else {
    r.recorder.pause();
    r.elapsedMs += Date.now() - r.resumedAt;
    r.resumedAt = undefined;
    recBar.classList.add("paused");
    $("pause").setAttribute("aria-label", "Continuar");
  }
}

async function cancelRecording() {
  const r = recording;
  if (!r) return;
  recording = undefined;
  if (r.recorder.state !== "inactive") r.recorder.stop();
  release(r);
  showRecording(false);
  await fetch(`/api/voice/${r.id}`, { method: "DELETE" }).catch((error: unknown) => console.warn("Could not delete the cancelled recording on the server.", error));
}

async function finishRecording() {
  const r = recording;
  if (!r) return;
  recording = undefined;
  transcribing = true;
  const seconds = elapsedSeconds(r);
  recBar.classList.add("busy");
  $("timer").textContent = "Transcrevendo…";
  try {
    const stopped = new Promise<void>((resolve) => r.recorder.addEventListener("stop", () => resolve(), { once: true }));
    if (r.recorder.state !== "inactive") r.recorder.stop();
    await stopped;
    await r.uploads;
    release(r);
    if (r.uploadError) throw new Error(`O áudio não chegou ao servidor: ${r.uploadError}`);
    const { text } = await request<{ text: string }>(`/api/voice/${r.id}/finish`, { method: "POST", body: "{}" });
    const files = attachments.filter((item) => !item.sending).map((item) => item.file);
    attachments = [];
    renderTray();
    enqueue({ text, files, voice: seconds });
  } catch (error) {
    release(r);
    fail(error);
  } finally {
    transcribing = false;
    showRecording(false);
  }
}

/* ---------- sheets ---------- */

function openSheet(kind: "menu" | "search" | "memory") {
  input.blur();
  sheetKind = kind;
  scrim.hidden = false;
  sheet.hidden = false;
  $("menu").setAttribute("aria-expanded", String(kind === "menu"));
  $("search").setAttribute("aria-expanded", String(kind === "search"));
  if (kind === "memory") void refreshMemories().catch(fail);
  renderSheet();
}

function closeSheet() {
  sheetKind = undefined;
  scrim.hidden = true;
  sheet.hidden = true;
  $("menu").setAttribute("aria-expanded", "false");
  $("search").setAttribute("aria-expanded", "false");
}

function renderSheet() {
  const content: (HTMLElement | string)[] = [el("div", "grab")];
  if (sheetKind === "menu") content.push(...menuSheet());
  else if (sheetKind === "search") content.push(...searchSheet());
  else if (sheetKind === "memory") content.push(...memorySheet());
  sheet.replaceChildren(...content);
}

function menuSheet(): HTMLElement[] {
  const memory = el("button", "menu-item", "O que o Finrod sabe");
  memory.type = "button";
  memory.addEventListener("click", () => openSheet("memory"));
  const exa = el("button", "menu-item", exaConnected ? "Exa conectado · Desconectar" : "Conectar Exa (mais pesquisas)");
  exa.type = "button";
  exa.addEventListener("click", async () => {
    exa.disabled = true;
    try {
      if (exaConnected) {
        if (!confirm("Desconectar sua conta Exa? As pesquisas voltam ao plano gratuito, com limite menor.")) return;
        await request("/api/exa", { method: "DELETE" });
        await refreshExa();
        renderSheet();
      } else {
        location.href = (await request<{ url: string }>("/api/exa/connect", { method: "POST", body: "{}" })).url;
      }
    } catch (error) {
      closeSheet();
      fail(error);
    } finally {
      exa.disabled = false;
    }
  });
  return [memory, exa];
}

async function refreshExa() {
  exaConnected = (await request<{ connected: boolean }>("/api/exa")).connected;
}

let searchTimer: number | undefined;
let searchSeq = 0;

function searchSheet(): HTMLElement[] {
  const field = el("input");
  field.type = "search";
  field.placeholder = "Buscar na conversa";
  field.setAttribute("aria-label", "Buscar na conversa");
  const results = el("div", "results");
  results.style.display = "contents";
  field.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(async () => {
      const mine = ++searchSeq;
      const query = field.value.trim();
      if (!query || conversation === undefined) return results.replaceChildren();
      try {
        const hits = await request<Hit[]>(`/api/conversations/${conversation}/search?q=${encodeURIComponent(query)}`);
        if (mine !== searchSeq) return;
        results.replaceChildren(
          ...(hits.length
            ? hits.map((hit) => {
                const row = el("button", "result");
                row.type = "button";
                row.append(el("span", undefined, hit.text), el("small", undefined, `${stamp(hit.at)} · ${hit.role === "user" ? "você" : "Finrod"}`));
                row.addEventListener("click", () => jumpTo(hit.id));
                return row;
              })
            : [el("p", "sheet-empty", "Nada encontrado.")]),
        );
      } catch (error) {
        closeSheet();
        fail(error);
      }
    }, 250);
  });
  queueMicrotask(() => field.focus());
  return [field, results];
}

function jumpTo(id: number) {
  closeSheet();
  const index = messages.findIndex((message) => message.id === id);
  const target = messagesEl.querySelectorAll<HTMLElement>(".user:not(.queued), .answer[data-id]");
  const wanted = messages.slice(0, index + 1).filter((message) => message.role === "user" || message.text).length - 1;
  const node = target[wanted];
  if (!node) return;
  atBottom = false;
  node.scrollIntoView({ block: "center" });
  node.classList.add("flash");
  setTimeout(() => node.classList.remove("flash"), 1600);
}

function memorySheet(): HTMLElement[] {
  const rows = (items: Memory[], pending: boolean) =>
    items.map((memory) => {
      const row = el("div", "mem");
      const text = el("div");
      text.append(el("span", undefined, memory.text), el("small", undefined, `${pending ? "de" : "desde"} ${stamp(memory.createdAt)}`));
      const buttons = el("div", "mini");
      const button = (label: string, className: string | undefined, run: () => void) => {
        const b = el("button", className, label);
        b.type = "button";
        b.addEventListener("click", run);
        return b;
      };
      if (pending) {
        buttons.append(
          button("aprovar", "ok", () => void memoryAction(`/api/memories/${memory.id}/approve`, { method: "POST", body: "{}" })),
          button("descartar", undefined, () => void memoryAction(`/api/memories/${memory.id}`, { method: "DELETE" })),
        );
      } else {
        buttons.append(
          button("editar", undefined, () => {
            const edited = prompt("Editar memória", memory.text)?.trim();
            if (edited && edited !== memory.text) void memoryAction(`/api/memories/${memory.id}`, { method: "PUT", body: JSON.stringify({ text: edited }) });
          }),
          button("apagar", undefined, () => {
            if (confirm(`Apagar "${memory.text}"?`)) void memoryAction(`/api/memories/${memory.id}`, { method: "DELETE" });
          }),
        );
      }
      row.append(text, buttons);
      return row;
    });
  const pending = memories.filter((memory) => memory.status === "pending");
  const saved = memories.filter((memory) => memory.status === "saved");
  const content: HTMLElement[] = [];
  if (pending.length) content.push(el("h2", undefined, "Esperando você"), ...rows(pending, true));
  content.push(el("h2", undefined, "O que o Finrod sabe"));
  content.push(...(saved.length ? rows(saved, false) : [el("p", "sheet-empty", "Nada guardado ainda.")]));
  return content;
}

async function memoryAction(path: string, init: RequestInit) {
  try {
    await request(path, init);
    memories = await request<Memory[]>("/api/memories");
    renderNotes();
    if (sheetKind === "memory") renderSheet();
  } catch (error) {
    fail(error);
  }
}

/* ---------- keyboard ---------- */

const viewport = window.visualViewport;
let baseline = viewport?.height ?? window.innerHeight;

function fit() {
  const height = viewport?.height ?? window.innerHeight;
  const follow = atBottom;
  if (document.activeElement !== input) baseline = Math.max(baseline, height);
  const open = document.activeElement === input && baseline - height > 100;
  app.style.setProperty("--vvh", `${height}px`);
  app.style.setProperty("--vvtop", `${viewport?.offsetTop ?? 0}px`);
  document.body.classList.toggle("kb", open);
  if (window.scrollY !== 0) window.scrollTo(0, 0);
  if (follow) messagesEl.scrollTop = messagesEl.scrollHeight;
}
viewport?.addEventListener("resize", fit);
viewport?.addEventListener("scroll", fit);
input.addEventListener("focus", () => setTimeout(fit, 50));
input.addEventListener("blur", () => setTimeout(fit, 50));

/* ---------- wiring ---------- */

input.addEventListener("input", resize);
input.addEventListener("keydown", (event) => {
  const desktop = matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && desktop) {
    event.preventDefault();
    submitText();
  }
});
composer.addEventListener("submit", (event) => event.preventDefault());

let pressTimer: number | undefined;
round.addEventListener("mousedown", (event) => event.preventDefault());
round.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false });
round.addEventListener("contextmenu", (event) => event.preventDefault());
round.addEventListener("pointerdown", () => {
  if (recording || transcribing) return;
  round.classList.add("pressing");
  pressTimer = window.setTimeout(() => {
    pressTimer = undefined;
    round.classList.remove("pressing");
    navigator.vibrate?.(10);
    void startRecording();
  }, LONG_PRESS_MS);
});
const letGo = (tap: boolean) => {
  round.classList.remove("pressing");
  if (pressTimer === undefined) return;
  clearTimeout(pressTimer);
  pressTimer = undefined;
  if (tap) submitText();
};
round.addEventListener("pointerup", () => letGo(true));
round.addEventListener("pointercancel", () => letGo(false));
round.addEventListener("pointerleave", () => letGo(false));

$("pause").addEventListener("click", togglePause);
$("cancel").addEventListener("click", () => void cancelRecording());
$("finish").addEventListener("click", () => void finishRecording());
$("menu").addEventListener("click", () => (sheetKind === "menu" ? closeSheet() : openSheet("menu")));
$("search").addEventListener("click", () => (sheetKind === "search" ? closeSheet() : openSheet("search")));
scrim.addEventListener("click", closeSheet);
attach.addEventListener("click", () => picker.click());
picker.addEventListener("change", () => {
  for (const file of picker.files ?? []) void upload(file);
  picker.value = "";
});

renderMessages();
fit();
Promise.all([start(), refreshExa(), refreshMemories()]).then(renderNotes, fail);
