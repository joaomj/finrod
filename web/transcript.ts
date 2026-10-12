import type { ChatMessage } from "./runtime.js";
import { renderMarkdown } from "./markdown.js";
import { openFeedback } from "./feedback-ui.js";
import type { Vote } from "./feedback.js";

type Block = { id: string; messages: ChatMessage[] };
type View = { node: HTMLElement; signature: string; update: (messages: ChatMessage[]) => void };

export function openTranscript(history: HTMLElement, container: HTMLElement, empty: HTMLElement,
  latest: HTMLButtonElement, report: (message: string) => void,
  saveFeedback: (index: number, vote: Vote, comment: string) => Promise<void>) {
  const views = new Map<string, View>();
  let following = true;
  let height = history.clientHeight;
  let pending: ChatMessage[] | undefined;
  let scheduled = false;
  const atBottom = () => history.scrollHeight - history.scrollTop - history.clientHeight < 48;
  const follow = () => { history.scrollTop = history.scrollHeight; latest.hidden = true; };
  history.addEventListener("scroll", () => {
    // A keyboard or composer resize is not the reader scrolling away.
    if (history.clientHeight !== height) return;
    following = atBottom();
    latest.hidden = following;
  }, { passive: true });
  latest.addEventListener("click", () => { following = true; follow(); });
  new ResizeObserver(() => {
    height = history.clientHeight;
    if (following) follow();
    else latest.hidden = atBottom();
  }).observe(history);

  function messageView(message: ChatMessage): View {
    const node = document.createElement("article");
    node.className = message.role;
    node.setAttribute("aria-label", message.role === "user" ? "You" : "Finrod");
    const body = document.createElement("div");
    body.className = "message-body";
    const warning = document.createElement("p");
    warning.className = "warning";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy quiet-button";
    copy.textContent = "Copy";
    copy.setAttribute("aria-label", "Copy answer");
    let text = "";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = "Copied";
        setTimeout(() => { copy.textContent = "Copy"; }, 1500);
      } catch (error) { report(`Could not copy the answer: ${error instanceof Error ? error.message : String(error)}`); }
    });
    node.append(body, warning);
    const actions = document.createElement("div");
    actions.className = "answer-actions";
    const feedback = message.role === "assistant" ? openFeedback(message.message_index,
      (vote, comment) => saveFeedback(message.message_index, vote, comment), report) : undefined;
    actions.append(copy);
    if (feedback) { actions.append(feedback.buttons); node.append(actions, feedback.editor); }
    return { node, signature: "", update: messages => {
      const message = messages[0]!;
      if (text !== message.text) {
        text = message.text;
        if (message.role === "user") body.textContent = text;
        else renderMarkdown(body, text);
      }
      warning.textContent = message.error ?? "";
      warning.hidden = !message.error;
      body.hidden = !text;
      actions.hidden = message.partial || !text;
      feedback?.update(message.feedback, message.rateable);
      node.classList.toggle("partial", message.partial);
    } };
  }

  function activityView(): View {
    const node = document.createElement("details");
    node.className = "activity";
    const summary = document.createElement("summary");
    const list = document.createElement("ul");
    node.append(summary, list);
    return { node, signature: "", update: messages => {
      const failed = messages.some(message => message.error);
      summary.textContent = failed ? "Web research · incomplete" : "Web research";
      summary.classList.toggle("warning", failed);
      list.replaceChildren(...messages.map(message => {
        const item = document.createElement("li");
        item.textContent = message.toolName === "web_search_exa" ? "Searched the web" : "Read sources";
        if (message.error) {
          item.textContent = message.toolName === "web_search_exa" ? "Search failed" : "Page retrieval failed";
          const warning = document.createElement("p");
          warning.className = "warning";
          warning.textContent = message.error;
          item.append(warning);
        }
        return item;
      }));
    } };
  }

  function draw(messages: ChatMessage[]) {
    const blocks: Block[] = [];
    let turn = -1;
    let activity: Block | undefined;
    messages.forEach(message => {
      if (message.role === "user") { turn = message.message_index; activity = undefined; }
      if (message.role === "tool") {
        if (!activity) { activity = { id: `activity-${turn}`, messages: [] }; blocks.push(activity); }
        activity.messages.push(message);
      } else blocks.push({ id: `${message.role}-${message.message_index}`, messages: [message] });
    });
    const retained = new Set(blocks.map(block => block.id));
    for (const [id, view] of views) if (!retained.has(id)) { view.node.remove(); views.delete(id); }
    let previous: HTMLElement | undefined;
    for (const block of blocks) {
      let view = views.get(block.id);
      if (!view) {
        view = block.messages[0]!.role === "tool" ? activityView() : messageView(block.messages[0]!);
        views.set(block.id, view);
      }
      const signature = JSON.stringify(block.messages);
      if (signature !== view.signature) { view.update(block.messages); view.signature = signature; }
      const next = previous ? previous.nextSibling : container.firstChild;
      if (next !== view.node) container.insertBefore(view.node, next);
      previous = view.node;
    }
    empty.hidden = messages.length > 0;
    if (following) follow();
    else latest.hidden = atBottom();
  }

  return (messages: ChatMessage[], reset = false) => {
    if (reset) {
      following = true;
      views.clear();
      container.replaceChildren();
      latest.hidden = true;
    }
    pending = messages;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      draw(pending!);
      pending = undefined;
    });
  };
}
