import type { Feedback, Vote } from "./feedback.js";

export function openFeedback(index: number, save: (vote: Vote, comment: string) => Promise<void>, report: (message: string) => void) {
  const buttons = document.createElement("div");
  buttons.className = "feedback-buttons";
  const icon = (label: string, down = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vote-button quiet-button";
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", "false");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    if (down) svg.classList.add("thumb-down");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M7 10H3v10h4V10Zm0 0 5-8h1a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 2H7");
    svg.append(path);
    button.append(svg);
    return button;
  };
  const up = icon("Good answer");
  const down = icon("Bad answer", true);
  const status = document.createElement("span");
  status.className = "feedback-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  buttons.append(up, down, status);
  const editor = document.createElement("form");
  editor.className = "feedback-editor";
  editor.id = `feedback-editor-${index}`;
  editor.hidden = true;
  down.setAttribute("aria-expanded", "false");
  down.setAttribute("aria-controls", editor.id);
  const label = document.createElement("label");
  const reason = document.createElement("textarea");
  reason.id = `feedback-reason-${index}`;
  reason.rows = 2;
  reason.maxLength = 2000;
  reason.placeholder = "What didn’t work for you?";
  label.htmlFor = reason.id;
  label.textContent = "What could be better? (optional)";
  const hint = document.createElement("p");
  hint.className = "muted";
  hint.textContent = "Saved on this device; not sent to the model.";
  const actions = document.createElement("div");
  actions.className = "settings-actions";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "secondary-button";
  submit.textContent = "Send feedback";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "quiet-button";
  cancel.textContent = "Cancel";
  actions.append(submit, cancel);
  editor.append(label, reason, hint, actions);
  let feedback: Feedback | undefined;
  let saving = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => { editor.hidden = true; down.setAttribute("aria-expanded", "false"); };
  const updateButtons = () => {
    up.setAttribute("aria-pressed", String(feedback?.vote === "up"));
    down.setAttribute("aria-pressed", String(feedback?.vote === "down"));
    up.disabled = down.disabled = submit.disabled = cancel.disabled = reason.disabled = saving;
  };
  const vote = async (value: Vote, comment: string) => {
    if (saving) return;
    saving = true;
    updateButtons();
    status.textContent = "Saving…";
    try {
      await save(value, comment);
      close();
      status.textContent = "Saved locally";
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { status.textContent = ""; }, 2000);
    } catch (error) {
      status.textContent = "Not saved";
      report(`Could not save feedback: ${error instanceof Error ? error.message : String(error)}`);
    } finally { saving = false; updateButtons(); }
  };
  up.addEventListener("click", () => { void vote("up", ""); });
  down.addEventListener("click", () => {
    reason.value = feedback?.vote === "down" ? feedback.comment : "";
    editor.hidden = false;
    down.setAttribute("aria-expanded", "true");
    editor.scrollIntoView({ block: "nearest" });
    reason.focus({ preventScroll: true });
  });
  cancel.addEventListener("click", close);
  editor.addEventListener("submit", event => { event.preventDefault(); void vote("down", reason.value); });
  return { buttons, editor, update(value: Feedback | undefined, available: boolean) {
    feedback = value;
    buttons.hidden = !available;
    if (!available) close();
    updateButtons();
  } };
}
