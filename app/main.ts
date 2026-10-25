import MarkdownIt from "markdown-it";

type Summary = { id: number; title: string; updatedAt: number };
type Message = { id: number; role: "user" | "assistant"; text: string; error?: string };
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

let conversations: Summary[] = [];
let current: number | undefined;
let messages: Message[] = [];
let live: Live = { busy: false };
let pending: string | undefined;
let failure: string | undefined;
let events: EventSource | undefined;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json" } });
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

function bubble(role: "user" | "assistant", text: string, error?: string) {
  const el = document.createElement("div");
  el.className = role;
  if (role === "user") el.textContent = text;
  else if (text) el.innerHTML = markdown.render(text);
  if (error) {
    const note = document.createElement("p");
    note.className = "error";
    note.textContent = error;
    el.append(note);
  }
  return el;
}

function status(text: string, className = "status") {
  const el = document.createElement("p");
  el.className = className;
  el.textContent = text;
  return el;
}

function renderMessages() {
  const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  const children: HTMLElement[] = messages.map((m) => bubble(m.role, m.text, m.error));
  if (pending !== undefined) children.push(bubble("user", pending));
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
  send.disabled = !input.value.trim() || pending !== undefined;
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
    if (pending !== undefined && messages.some((m) => m.role === "user" && m.text === pending)) pending = undefined;
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
  if (!text || pending !== undefined) return;
  failure = undefined;
  pending = text;
  input.value = "";
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
      body: JSON.stringify({ text, requestId: crypto.randomUUID() }),
    });
    await refreshList();
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    input.value = pending ?? text;
    pending = undefined;
    resize();
    updateSend();
    renderMessages();
  }
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
window.addEventListener("hashchange", route);

route();
refreshList().catch((error: unknown) => {
  failure = error instanceof Error ? error.message : String(error);
  renderMessages();
});
