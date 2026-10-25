import MarkdownIt from "markdown-it";

type Summary = { id: number; title: string; updatedAt: number };
type Vote = "up" | "down";
type Source = { title: string; url: string };
type SentFile = { id: string; kind: "image" | "document"; name: string; mime: string; size: number; unreadable?: string };
type Message = { id: number; role: "user" | "assistant"; text: string; error?: string; vote?: Vote; sources?: Source[]; files?: SentFile[] };
type Pending = { file: SentFile; sending: boolean };
type Live = { busy: boolean; partial?: string; retry?: string; tool?: string };

const toolLabels: Record<string, string> = { web_search: "Pesquisando na web…", web_fetch: "Lendo páginas…" };

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
const defaultLink = markdown.renderer.rules.link_open ?? ((tokens, i, options, _env, self) => self.renderToken(tokens, i, options));
markdown.renderer.rules.link_open = (tokens, i, options, env, self) => {
  tokens[i]!.attrSet("target", "_blank");
  tokens[i]!.attrSet("rel", "noopener noreferrer");
  return defaultLink(tokens, i, options, env, self);
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const list = $("list");
const messagesEl = $("messages");
const title = $("title");
const form = $<HTMLFormElement>("composer");
const input = $<HTMLTextAreaElement>("input");
const send = $<HTMLButtonElement>("send");
const scrim = $("scrim");
const exa = $<HTMLButtonElement>("exa");
const attach = $<HTMLButtonElement>("attach");
const picker = $<HTMLInputElement>("picker");
const tray = $("tray");
const MAX_UPLOAD = 20 * 1024 * 1024;

let conversations: Summary[] = [];
let current: number | undefined;
let messages: Message[] = [];
let live: Live = { busy: false };
let pending: { text: string; files: SentFile[] } | undefined;
let failure: string | undefined;
let events: EventSource | undefined;
let exaConnected = false;
let attachments: Pending[] = [];

async function refreshExa() {
  exaConnected = (await request<{ connected: boolean }>("/api/exa")).connected;
  exa.textContent = exaConnected ? "Exa conectado · Desconectar" : "Conectar Exa (mais pesquisas)";
  exa.hidden = false;
}

async function toggleExa() {
  exa.disabled = true;
  try {
    if (exaConnected) {
      if (!confirm("Desconectar sua conta Exa? As pesquisas voltam ao plano gratuito, com limite menor.")) return;
      await request("/api/exa", { method: "DELETE" });
      await refreshExa();
    } else {
      location.href = (await request<{ url: string }>("/api/exa/connect", { method: "POST", body: "{}" })).url;
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    setMenu(false);
    renderMessages();
  } finally {
    exa.disabled = false;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (typeof init?.body === "string" || init?.body === undefined) headers["content-type"] = "application/json";
  const response = await fetch(path, { ...init, headers });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body;
}

function setMenu(open: boolean) {
  document.body.classList.toggle("open", open);
  scrim.hidden = !open;
}

function renderList() {
  list.replaceChildren(
    ...conversations.map((item) => {
      const link = document.createElement("a");
      link.href = `#/c/${item.id}`;
      link.textContent = item.title || "Nova conversa";
      if (item.id === current) link.setAttribute("aria-current", "page");
      return link;
    }),
  );
  title.textContent = conversations.find((item) => item.id === current)?.title || "Finrod";
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileChip(file: SentFile) {
  const el = document.createElement("div");
  el.className = "file";
  const name = document.createElement("span");
  name.textContent = `${file.name} · ${size(file.size)}`;
  el.append(name);
  if (file.unreadable) {
    const note = document.createElement("p");
    note.className = "error";
    note.textContent = `Páginas sem texto legível: ${file.unreadable}.`;
    el.append(note);
  }
  return el;
}

function bubble(role: "user" | "assistant", text: string, error?: string, files?: SentFile[]) {
  const el = document.createElement("div");
  el.className = role;
  for (const file of files ?? []) {
    if (file.kind !== "image") continue;
    const image = document.createElement("img");
    image.src = `/api/files/${file.id}`;
    image.alt = file.name;
    image.loading = "lazy";
    el.append(image);
  }
  if (role === "user" && text) {
    const body = document.createElement("p");
    body.textContent = text;
    el.append(body);
  }
  for (const file of files ?? []) if (file.kind === "document") el.append(fileChip(file));
  else if (text) el.innerHTML = markdown.render(text);
  if (error) {
    const note = document.createElement("p");
    note.className = "error";
    note.textContent = error;
    el.append(note);
  }
  return el;
}

const thumbs: Record<Vote, { label: string; path: string }> = {
  up: { label: "Boa resposta", path: "M7 10v11M7 10l4-8a3 3 0 0 1 3 3v4h5a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 17.6 21H7M7 10H4v11h3" },
  down: { label: "Resposta ruim", path: "M17 14V3M17 14l-4 8a3 3 0 0 1-3-3v-4H5a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 6.4 3H17M17 14h3V3h-3" },
};

function sources(list: Source[]) {
  const el = document.createElement("div");
  el.className = "sources";
  const heading = document.createElement("p");
  heading.textContent = list.length > 1 ? "Fontes" : "Fonte";
  const items = document.createElement("ul");
  for (const source of list) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = source.url;
    link.textContent = source.title;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    item.append(link);
    items.append(item);
  }
  el.append(heading, items);
  return el;
}

function feedback(message: Message) {
  const row = document.createElement("div");
  row.className = "feedback";
  for (const vote of ["up", "down"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", thumbs[vote].label);
    button.setAttribute("aria-pressed", String(message.vote === vote));
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${thumbs[vote].path}"/></svg>`;
    button.addEventListener("click", () => void rate(message, message.vote === vote ? null : vote));
    row.append(button);
  }
  return row;
}

async function rate(message: Message, vote: Vote | null) {
  if (current === undefined) return;
  try {
    await request(`/api/conversations/${current}/messages/${message.id}/vote`, { method: "PUT", body: JSON.stringify({ vote }) });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    renderMessages();
  }
}

function status(text: string, className = "status") {
  const el = document.createElement("p");
  el.className = className;
  el.textContent = text;
  return el;
}

function renderMessages() {
  const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  const children: HTMLElement[] = messages.map((m) => {
    const el = bubble(m.role, m.text, m.error, m.files);
    if (m.role === "assistant" && m.text) {
      if (m.sources?.length) el.append(sources(m.sources));
      el.append(feedback(m));
    }
    return el;
  });
  if (pending !== undefined) children.push(bubble("user", pending.text, undefined, pending.files));
  if (live.partial) children.push(bubble("assistant", live.partial));
  else if (live.busy || pending !== undefined) {
    const label = live.retry ? `Tentando de novo: ${live.retry}` : live.tool ? (toolLabels[live.tool] ?? "Trabalhando…") : "…";
    children.push(status(label));
  }
  if (failure) children.push(status(failure, "error"));
  if (!children.length) children.push(status("Como posso ajudar?", "empty"));
  messagesEl.replaceChildren(...children);
  if (nearBottom || pending !== undefined) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function updateSend() {
  const busy = attachments.some((item) => item.sending);
  send.disabled = (!input.value.trim() && attachments.length === 0) || pending !== undefined || busy;
}

async function refreshList() {
  conversations = await request<Summary[]>("/api/conversations");
  renderList();
}

function open(id: number | undefined) {
  events?.close();
  events = undefined;
  current = id;
  messages = [];
  live = { busy: false };
  pending = undefined;
  failure = undefined;
  renderList();
  renderMessages();
  setMenu(false);
  if (id === undefined) return;
  events = new EventSource(`/api/conversations/${id}/events`);
  events.addEventListener("messages", (event) => {
    messages = JSON.parse((event as MessageEvent<string>).data) as Message[];
    const sent = pending;
    if (sent && messages.some((m) => m.role === "user" && m.text === sent.text)) pending = undefined;
    renderMessages();
    updateSend();
  });
  events.addEventListener("live", (event) => {
    live = JSON.parse((event as MessageEvent<string>).data) as Live;
    renderMessages();
  });
  events.addEventListener("missing", () => {
    events?.close();
    location.hash = "";
  });
}

function route() {
  const match = /^#\/c\/(\d+)$/.exec(location.hash);
  open(match ? Number(match[1]) : undefined);
}

async function submit() {
  const text = input.value.trim();
  const files = attachments.map((item) => item.file);
  if ((!text && files.length === 0) || pending !== undefined) return;
  failure = undefined;
  pending = { text, files };
  input.value = "";
  attachments = [];
  renderTray();
  resize();
  updateSend();
  renderMessages();
  try {
    let id = current;
    if (id === undefined) {
      id = (await request<{ id: number }>("/api/conversations", { method: "POST", body: "{}" })).id;
      history.replaceState(null, "", `#/c/${id}`);
      const keep = pending;
      open(id);
      pending = keep;
      renderMessages();
    }
    await request(`/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        text,
        requestId: crypto.randomUUID(),
        files: files.map((file) => ({ id: file.id, name: file.name })),
      }),
    });
    await refreshList();
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    input.value = pending.text || text;
    attachments = files.map((file) => ({ file, sending: false }));
    pending = undefined;
    renderTray();
    resize();
    updateSend();
    renderMessages();
  }
}

/** Upload one file now, so a slow upload never holds up the message itself. */
async function upload(file: File) {
  if (file.size > MAX_UPLOAD) {
    failure = `"${file.name}" passa do limite de ${MAX_UPLOAD / (1024 * 1024)} MB.`;
    renderMessages();
    return;
  }
  const entry: Pending = {
    file: { id: "", kind: file.type.startsWith("image/") ? "image" : "document", name: file.name, mime: file.type, size: file.size },
    sending: true,
  };
  attachments.push(entry);
  renderTray();
  try {
    const stored = await request<SentFile>("/api/files", {
      method: "POST",
      body: file,
      headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
    });
    entry.file = stored;
  } catch (error) {
    attachments = attachments.filter((item) => item !== entry);
    failure = error instanceof Error ? error.message : String(error);
    renderMessages();
  } finally {
    entry.sending = false;
    renderTray();
    updateSend();
  }
}

function renderTray() {
  tray.hidden = attachments.length === 0;
  tray.replaceChildren(
    ...attachments.map((item) => {
      const chip = document.createElement("div");
      chip.className = "pending";
      const label = document.createElement("span");
      label.textContent = item.sending ? `${item.file.name} · enviando…` : item.file.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remover ${item.file.name}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        attachments = attachments.filter((other) => other !== item);
        renderTray();
        updateSend();
      });
      chip.append(label, remove);
      return chip;
    }),
  );
}

function resize() {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void submit();
});
input.addEventListener("input", () => {
  resize();
  updateSend();
});
input.addEventListener("keydown", (event) => {
  const desktop = matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && desktop) {
    event.preventDefault();
    void submit();
  }
});
$("menu").addEventListener("click", () => setMenu(true));
scrim.addEventListener("click", () => setMenu(false));
$("new").addEventListener("click", () => {
  if (location.hash) location.hash = "";
  else open(undefined);
  input.focus();
});
exa.addEventListener("click", () => void toggleExa());
attach.addEventListener("click", () => picker.click());
picker.addEventListener("change", () => {
  for (const file of picker.files ?? []) void upload(file);
  picker.value = "";
});
window.addEventListener("hashchange", route);

route();
Promise.all([refreshList(), refreshExa()]).catch((error: unknown) => {
  failure = error instanceof Error ? error.message : String(error);
  renderMessages();
});
