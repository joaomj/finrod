import { openBrowserAssistant, type ChatMessage } from "./runtime.js";
import { MODEL } from "./model.js";
import { openSidebar } from "./sidebar.js";
import type { SessionList } from "./sessions.js";
import { openTranscript } from "./transcript.js";
import { readProviderKey, saveProviderKey } from "./credentials.js";

const element = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing browser interface element: ${id}`);
  return value as T;
};
const status = element<HTMLParagraphElement>("status");
const settingsStatus = element<HTMLParagraphElement>("settings-status");
const settings = element<HTMLDialogElement>("settings");
const form = element<HTMLFormElement>("composer");
const input = element<HTMLTextAreaElement>("message");
const key = element<HTMLInputElement>("provider-key");
const forgetKey = element<HTMLButtonElement>("forget-key");
const send = element<HTMLButtonElement>("send");
const stop = element<HTMLButtonElement>("stop");
const connect = element<HTMLButtonElement>("connect");
const exportButton = element<HTMLButtonElement>("export");
const restoreButton = element<HTMLButtonElement>("restore-open");
const restoreInput = element<HTMLInputElement>("restore");
const newChat = element<HTMLButtonElement>("new-chat");
element<HTMLElement>("model").textContent = MODEL;
let busy = false;
let savedKey = "";
let sessions: SessionList | undefined;
let currentId: number | undefined;
let resetTranscript = false;
let restoring = false;
const drafts = new Map<number, string>();
let assistant: Awaited<ReturnType<typeof openBrowserAssistant>> | undefined;

function report(message: string, state: "error" | "working" | "ready" = "error") {
  if (status.textContent !== message) status.textContent = message;
  status.dataset.state = state;
  status.hidden = !message || (state === "ready" && settings.open);
  if (settings.open) {
    settingsStatus.textContent = message;
    settingsStatus.dataset.state = state;
    settingsStatus.hidden = !message;
  }
}
const draw = openTranscript(element("history"), element("messages"), element("empty"), element("latest"), report,
  async (index, vote, comment) => {
    if (!assistant) throw new Error("Local history is not ready. Reload Finrod and try again.");
    await assistant.saveFeedback(index, vote, comment, savedKey);
  });
const render = (messages: ChatMessage[]) => { draw(messages, resetTranscript); resetTranscript = false; };
const sidebar = openSidebar(element("sidebar"), element("chat-list"), element("chats-open"), element("chats-close"),
  element("sidebar-new-chat"), () => { void createChat(); }, id => { void selectChat(id); });
function updateSessions(value: SessionList, reset = false) {
  sessions = value;
  if (restoring && reset) drafts.clear();
  if (currentId !== value.active_session_id || (restoring && reset)) {
    if (currentId !== undefined && !restoring) drafts.set(currentId, input.value);
    input.value = drafts.get(value.active_session_id) ?? "";
    resizeInput();
    currentId = value.active_session_id;
  }
  resetTranscript ||= reset;
  element("chat-title").textContent = value.sessions.find(session => session.session_id === currentId)!.title;
  sidebar(value, busy);
}
function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
}
function updateControls() {
  send.disabled = busy || !assistant || !input.value.trim();
  connect.hidden = !!savedKey || !assistant || busy;
  forgetKey.disabled = busy || !savedKey;
  newChat.disabled = busy || !assistant;
  if (sessions) sidebar(sessions, busy);
}
function setBusy(value: boolean, stoppable = true) {
  busy = value;
  input.disabled = !assistant;
  key.disabled = value;
  send.hidden = value && stoppable;
  stop.hidden = !value || !stoppable;
  stop.disabled = !value;
  exportButton.disabled = value || !assistant;
  restoreButton.disabled = value || !assistant;
  restoreInput.disabled = value || !assistant;
  updateControls();
}
function openSettings() {
  if (settings.open) return;
  key.value = savedKey;
  settingsStatus.textContent = "";
  settingsStatus.hidden = true;
  settings.showModal();
  if (!savedKey && !key.disabled) key.focus();
}
element("settings-open").addEventListener("click", openSettings);
connect.addEventListener("click", openSettings);
element("settings-close").addEventListener("click", () => settings.close());
element("settings-form").addEventListener("submit", event => {
  event.preventDefault();
  try {
    const value = key.value.trim();
    if (value !== savedKey) saveProviderKey(value);
    savedKey = value;
    settings.close();
  } catch (error) { report(error instanceof Error ? error.message : String(error)); }
});
forgetKey.addEventListener("click", async () => {
  try {
    saveProviderKey("");
    savedKey = key.value = "";
    updateControls();
    report("OpenRouter key forgotten from this browser. Your history is unchanged.", "ready");
    if (assistant) await assistant.interrupt();
  } catch (error) { report(error instanceof Error ? error.message : String(error)); }
});
settings.addEventListener("close", () => {
  key.value = savedKey;
  updateControls();
  if (assistant) input.focus({ preventScroll: true });
});
input.addEventListener("input", () => { resizeInput(); updateControls(); });
input.addEventListener("keydown", event => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229 || busy) return;
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  event.preventDefault();
  if (!send.disabled) form.requestSubmit();
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !assistant) return;
  const text = input.value.trim();
  if (!text) return;
  if (!savedKey) { openSettings(); return; }
  input.value = "";
  resizeInput();
  setBusy(true);
  report("Connecting…", "working");
  let succeeded = false;
  try {
    await assistant.send(text, savedKey);
    succeeded = true;
    report("", "ready");
  } catch (error) {
    if (!input.value) { input.value = text; resizeInput(); }
    report(error instanceof Error ? error.message : String(error));
  } finally { setBusy(false); }
  if (succeeded) assistant.requestTitle(savedKey);
});

async function interrupt() {
  if (!assistant) return;
  if (!stop.hidden) stop.disabled = true;
  try { await assistant.interrupt(); }
  catch (error) { report(error instanceof Error ? error.message : String(error)); }
}
stop.addEventListener("click", () => { void interrupt(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void interrupt();
});
window.addEventListener("pagehide", () => { void interrupt(); });

function fitViewport() {
  const viewport = window.visualViewport;
  if (!viewport || Math.abs(viewport.scale - 1) > 0.01) return;
  document.documentElement.style.setProperty("--app-height", `${viewport.height}px`);
  document.documentElement.style.setProperty("--app-top", `${viewport.offsetTop}px`);
}
window.visualViewport?.addEventListener("resize", fitViewport, { passive: true });
window.visualViewport?.addEventListener("scroll", fitViewport, { passive: true });
fitViewport();

async function start() {
  if (!isSecureContext) throw new Error("Open Finrod over HTTPS on your phone. Plain HTTP is supported only on localhost for development.");
  if (!AbortSignal.any) throw new Error("Update your browser: Finrod's direct MCP connection needs AbortSignal.any.");
  if (!navigator.locks) throw new Error("This browser lacks the local history lock Finrod needs. Update your browser and try again.");
  savedKey = key.value = readProviderKey();
  await navigator.locks.request("finrod-browser-history", { ifAvailable: true }, async lock => {
    if (!lock) { report("Another Finrod page owns this history. Close it, then reload this page."); return; }
    assistant = await openBrowserAssistant(render, report, updateSessions);
    setBusy(false);
    if (assistant.interrupted) report("Your previous answer was interrupted. Saved history is restored. No paid request was automatically resumed.");
    else if (assistant.failed) report("Your previous answer failed. Saved history is restored; nothing was automatically retried.");
    else report(assistant.migrated ? "Previous history migrated safely." : "", "ready");
    // The browser releases this lock when the page is destroyed.
    await new Promise<void>(() => {});
  });
}
void start().catch(error => { setBusy(false); report(error instanceof Error ? error.message : String(error)); });

exportButton.addEventListener("click", () => {
  if (!assistant || busy) return;
  try {
    const blob = new Blob([assistant.exportHistory()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "finrod-history.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    report("History exported. Keep the file private; it is not encrypted.", "ready");
  } catch (error) { report(error instanceof Error ? error.message : String(error)); }
});
restoreButton.addEventListener("click", () => restoreInput.click());
restoreInput.addEventListener("change", async () => {
  const file = restoreInput.files?.[0];
  if (!file || !assistant || busy) return;
  try {
    if (!confirm("Replace all chats in this browser with this backup? Export your current history first if you need to keep it.")) return;
    restoring = true;
    setBusy(true, false);
    report("Restoring history…", "working");
    await assistant.restoreHistory(await file.text());
    report("History restored on this device. No request was automatically started.", "ready");
  } catch (error) { report(error instanceof Error ? error.message : String(error)); }
  finally { restoring = false; restoreInput.value = ""; setBusy(false); }
});

async function createChat() {
  if (!assistant || busy) return;
  setBusy(true, false);
  try {
    await assistant.newChat();
    input.value = "";
    if (currentId !== undefined) drafts.delete(currentId);
    resizeInput();
    report("", "ready");
    input.focus({ preventScroll: true });
  } catch (error) { report(error instanceof Error ? error.message : String(error)); }
  finally { setBusy(false); }
}
async function selectChat(id: number) {
  if (!assistant || busy) return;
  setBusy(true, false);
  try {
    await assistant.selectChat(id);
    if (assistant.interrupted) report("This chat has an interrupted answer. Nothing was automatically resumed.");
    else if (assistant.failed) report("This chat has a failed answer. Nothing was automatically retried.");
    else report("", "ready");
    input.focus({ preventScroll: true });
  } catch (error) { report(error instanceof Error ? error.message : String(error)); }
  finally { setBusy(false); }
}
newChat.addEventListener("click", () => { void createChat(); });
