import type { SessionList } from "./sessions.js";

export function openSidebar(dialog: HTMLDialogElement, list: HTMLElement, trigger: HTMLButtonElement,
  close: HTMLButtonElement, create: HTMLButtonElement, newChat: () => void, select: (id: number) => void) {
  let state: SessionList | undefined;
  let busy = false;
  const rows = new Map<number, HTMLButtonElement>();
  const draw = () => {
    if (!state || !dialog.open) return;
    const retained = new Set(state.sessions.map(session => session.session_id));
    for (const [id, row] of rows) if (!retained.has(id)) { row.remove(); rows.delete(id); }
    let previous: HTMLElement | undefined;
    for (const session of [...state.sessions].sort((a, b) => b.updatedAt - a.updatedAt || b.session_id - a.session_id)) {
      let row = rows.get(session.session_id);
      if (!row) {
        row = document.createElement("button");
        row.type = "button";
        row.className = "chat-entry";
        row.dataset.sessionId = String(session.session_id);
        row.append(document.createElement("span"), document.createElement("small"));
        row.addEventListener("click", () => { dialog.close(); select(session.session_id); });
        rows.set(session.session_id, row);
      }
      row.firstElementChild!.textContent = session.title;
      const note = row.lastElementChild as HTMLElement;
      note.textContent = session.titleState === "pending" ? "Naming…" : session.titleError ? "Title unavailable" : "";
      note.hidden = !note.textContent;
      row.title = session.titleError ?? session.title;
      row.setAttribute("aria-label", session.titleError ? `${session.title}. Title unavailable: ${session.titleError}` : session.title);
      row.setAttribute("aria-current", String(session.session_id === state.active_session_id));
      row.disabled = busy;
      const next = previous ? previous.nextSibling : list.firstChild;
      if (next !== row) list.insertBefore(row, next);
      previous = row;
    }
  };
  trigger.addEventListener("click", () => { dialog.showModal(); trigger.setAttribute("aria-expanded", "true"); draw(); });
  close.addEventListener("click", () => dialog.close());
  create.addEventListener("click", () => { dialog.close(); newChat(); });
  dialog.addEventListener("close", () => trigger.setAttribute("aria-expanded", "false"));
  dialog.addEventListener("click", event => {
    const box = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
  });
  return (value: SessionList, blocked: boolean) => {
    state = value;
    busy = blocked;
    trigger.disabled = false;
    create.disabled = blocked;
    draw();
  };
}
