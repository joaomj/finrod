import { MODEL, openBrowserAssistant, type ChatMessage } from "./runtime.js";

const element = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing browser interface element: ${id}`);
  return value as T;
};
const status = element<HTMLParagraphElement>("status");
const history = element<HTMLElement>("history");
const form = element<HTMLFormElement>("composer");
const input = element<HTMLTextAreaElement>("message");
const key = element<HTMLInputElement>("provider-key");
const send = element<HTMLButtonElement>("send");
const stop = element<HTMLButtonElement>("stop");
const exportButton = element<HTMLButtonElement>("export");
const restoreInput = element<HTMLInputElement>("restore");
element<HTMLElement>("model").textContent = MODEL;
let busy = false;
let assistant: Awaited<ReturnType<typeof openBrowserAssistant>> | undefined;

function report(message: string, state: "error" | "working" | "ready" = "error") {
  status.textContent = message;
  status.dataset.state = state;
}
function setBusy(value: boolean) {
  busy = value;
  send.disabled = value || !assistant;
  input.disabled = value || !assistant;
  key.disabled = value;
  stop.disabled = !value;
  exportButton.disabled = value || !assistant;
  restoreInput.disabled = value || !assistant;
}
function render(messages: ChatMessage[]) {
  const wasAtBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 100;
  const nodes = messages.map(message => {
    const article = document.createElement("article");
    article.className = message.role;
    const label = document.createElement("h2");
    label.textContent = message.role === "user" ? "You" : message.role === "tool" ? "Exa" : message.partial ? "Finrod · answering" : "Finrod";
    const body = document.createElement("p");
    body.textContent = message.text;
    article.append(label, body);
    if (message.error) {
      const warning = document.createElement("p");
      warning.className = "warning";
      warning.textContent = message.error;
      article.append(warning);
    }
    return article;
  });
  history.replaceChildren(...nodes);
  if (wasAtBottom) history.scrollTop = history.scrollHeight;
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !assistant) return;
  if (!key.value.trim()) { report("Enter your own OpenRouter key first. Finrod does not save it."); key.focus(); return; }
  const text = input.value.trim();
  if (!text) return;
  setBusy(true);
  status.dataset.state = "working";
  status.textContent = "Answering. Keep Finrod open; the request goes directly to OpenRouter.";
  try {
    await assistant.send(text, key.value);
    input.value = "";
    status.dataset.state = "ready";
    status.textContent = "Conversation saved on this device.";
  } catch (error) { report(error instanceof Error ? error.message : String(error)); }
  finally { setBusy(false); }
});

async function interrupt() {
  if (!busy || !assistant) return;
  stop.disabled = true;
  try {
    await assistant.interrupt();
    report("Answer interrupted. Saved progress remains; it was not automatically retried. The provider may still charge for work already started.");
  } catch (error) { report(error instanceof Error ? error.message : String(error)); }
}
stop.addEventListener("click", () => { void interrupt(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void interrupt();
});
window.addEventListener("pagehide", () => { void interrupt(); });

async function start() {
  if (!isSecureContext) throw new Error("Open Finrod over HTTPS on your phone. Plain HTTP is supported only on localhost for development.");
  if (!AbortSignal.any) throw new Error("Update your browser: Finrod's direct MCP connection needs AbortSignal.any.");
  if (!navigator.locks) throw new Error("This browser lacks the local history lock Finrod needs. Update your browser and try again.");
  await navigator.locks.request("finrod-browser-history", { ifAvailable: true }, async lock => {
    if (!lock) { report("Another Finrod page owns this history. Close it, then reload this page."); return; }
    assistant = await openBrowserAssistant(render, report);
    setBusy(false);
    if (assistant.interrupted) report("Your previous answer was interrupted. Saved history is restored. No paid request was automatically resumed.");
    else if (assistant.failed) report("Your previous answer failed. Saved history is restored; nothing was automatically retried.");
    else {
      status.dataset.state = "ready";
      status.textContent = assistant.migrated ? "Previous history migrated safely. Enter your OpenRouter key to chat." : "Local history ready. Enter your OpenRouter key to chat.";
    }
    // The browser releases this lock when the page is destroyed. No background daemon is started.
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
restoreInput.addEventListener("change", async () => {
  const file = restoreInput.files?.[0];
  if (!file || !assistant || busy) return;
  try {
    if (!confirm("Replace this browser's history with this backup? Export your current history first if you need to keep it.")) return;
    setBusy(true);
    await assistant.restoreHistory(await file.text());
    report("History restored on this device. No request was automatically started.", "ready");
  } catch (error) { report(error instanceof Error ? error.message : String(error)); }
  finally { restoreInput.value = ""; setBusy(false); }
});
