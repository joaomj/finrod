import { emptyHistory, parseHistory, recoverHistory, type History } from "./history.js";
import { parseFeedback, type Feedback } from "./feedback.js";

export type Session = {
  session_id: number;
  title: string;
  titleState: "unrequested" | "pending" | "done" | "failed" | "skipped";
  titleError?: string;
  createdAt: number;
  updatedAt: number;
  history: History;
  feedback: Feedback[];
};
export type Library = {
  format: "finrod-phone";
  version: 2;
  active_session_id: number;
  next_session_id: number;
  sessions: Session[];
};
export type SessionSummary = Omit<Session, "history" | "feedback"> & { status: History["status"] };
export type SessionList = { active_session_id: number; sessions: SessionSummary[] };

export function newSession(id: number, history = emptyHistory()): Session {
  const previous = history.messages.length > 0 || !!history.partial;
  const createdAt = history.messages[0]?.timestamp ?? Date.now();
  return { session_id: id, title: previous ? "Previous conversation" : "New chat",
    titleState: previous ? "skipped" : "unrequested", createdAt,
    updatedAt: history.messages.at(-1)?.timestamp ?? createdAt, history, feedback: [] };
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
function fail(): never { throw new Error("Unsupported or damaged Finrod backup. Your current history has not been replaced."); }

export function parseLibrary(value: unknown): Library {
  if (object(value) && value.version === 1) {
    return { format: "finrod-phone", version: 2, active_session_id: 1, next_session_id: 2,
      sessions: [newSession(1, parseHistory(value))] };
  }
  if (!object(value) || value.format !== "finrod-phone" || value.version !== 2 ||
      !id(value.active_session_id) || !id(value.next_session_id) || !Array.isArray(value.sessions) || !value.sessions.length) fail();
  const seen = new Set<number>();
  const sessions = value.sessions.map((entry): Session => {
    if (!object(entry) || !id(entry.session_id) || seen.has(entry.session_id) ||
        typeof entry.title !== "string" || !entry.title.trim() || entry.title.length > 80 ||
        !["unrequested", "pending", "done", "failed", "skipped"].includes(String(entry.titleState)) ||
        !Number.isFinite(entry.createdAt) || !Number.isFinite(entry.updatedAt) ||
        (entry.titleError !== undefined && typeof entry.titleError !== "string")) fail();
    seen.add(entry.session_id);
    const history = parseHistory(entry.history);
    return { session_id: entry.session_id, title: entry.title, titleState: entry.titleState as Session["titleState"],
      createdAt: entry.createdAt as number, updatedAt: entry.updatedAt as number, history, feedback: parseFeedback(entry.feedback, history),
      ...(typeof entry.titleError === "string" ? { titleError: entry.titleError } : {}) };
  });
  if (!seen.has(value.active_session_id) || sessions.some(session => session.session_id >= Number(value.next_session_id))) fail();
  return { format: "finrod-phone", version: 2, active_session_id: value.active_session_id,
    next_session_id: value.next_session_id, sessions };
}

export function recoverLibrary(library: Library): Library {
  return { ...library, sessions: library.sessions.map(session => {
    const history = recoverHistory(session.history);
    for (const feedback of session.feedback) {
      if (JSON.stringify(history.messages[feedback.message_index]) !== JSON.stringify(session.history.messages[feedback.message_index])) {
        throw new Error("History recovery would change a rated answer's position. Preserve browser data and restore a complete backup.");
      }
    }
    return { ...session, history, ...(session.titleState === "pending" ? { titleState: "failed" as const,
      titleError: "Title generation was interrupted. It was not automatically retried." } : {}) };
  }) };
}
