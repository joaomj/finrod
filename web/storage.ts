import { emptyHistory, parseHistory, type History } from "./history.js";
import { rateable, type Feedback, type Vote } from "./feedback.js";
import { newSession, parseLibrary, recoverLibrary, type Library, type Session, type SessionList } from "./sessions.js";

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error("Local history transaction failed. Check available storage and reload before continuing.", { cause: tx.error }));
  });
}
const range = (id: number) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
const metadata = (session: Session) => {
  const { messages, ...history } = session.history;
  return { ...session, history, count: messages.length };
};
const state = (library: Library) => ({ active_session_id: library.active_session_id, next_session_id: library.next_session_id });

export async function openHistory() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("finrod-browser", 3);
    request.onupgradeneeded = () => {
      for (const name of ["snapshots", "messages", "history", "chatMessages", "library"]) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
      if (!request.result.objectStoreNames.contains("sessions")) request.result.createObjectStore("sessions", { keyPath: "session_id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Cannot open local history storage.", { cause: request.error }));
    request.onblocked = () => reject(new Error("Close other Finrod pages, then reload to upgrade local history."));
  });
  let library: Library;
  const counts = new Map<number, number>();
  let failure: Error | undefined;
  let tail: Promise<void> = Promise.resolve();
  const check = () => { if (failure) throw failure; };
  const session = (id: number) => {
    const found = library.sessions.find(session => session.session_id === id);
    if (!found) throw new Error(`Conversation ${id} does not exist. Reload Finrod.`);
    return found;
  };
  async function mutate<T>(work: () => Promise<T>): Promise<T> {
    check();
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { check(); return await work(); }
    catch (error) {
      failure = new Error("History persistence failed. Finrod cannot safely continue; reload the page.", { cause: error });
      throw failure;
    } finally { release(); }
  }
  async function commit(write: (tx: IDBTransaction) => void) {
    const tx = db.transaction(["sessions", "chatMessages", "library"], "readwrite");
    const done = transactionDone(tx);
    try { write(tx); }
    catch (error) {
      tx.abort();
      try { await done; } catch (abortError) { throw new AggregateError([error, abortError], "History update was aborted."); }
      throw error;
    }
    await done;
  }
  async function replaceLibrary(value: Library) {
    const copy = structuredClone(value);
    await mutate(async () => {
      copy.next_session_id = Math.max(copy.next_session_id, library.next_session_id);
      await commit(tx => {
        tx.objectStore("sessions").clear();
        tx.objectStore("chatMessages").clear();
        for (const session of copy.sessions) {
          tx.objectStore("sessions").put(metadata(session));
          session.history.messages.forEach((message, index) => tx.objectStore("chatMessages").put(message, [session.session_id, index]));
        }
        tx.objectStore("library").put(state(copy), "state");
      });
      library = copy;
      counts.clear();
      for (const session of copy.sessions) counts.set(session.session_id, session.history.messages.length);
    });
  }
  try {
    const tx = db.transaction(["library", "sessions", "chatMessages"], "readonly");
    const done = transactionDone(tx);
    const savedState = tx.objectStore("library").get("state");
    const savedSessions = tx.objectStore("sessions").getAll();
    const keys = tx.objectStore("chatMessages").getAllKeys();
    const records = tx.objectStore("chatMessages").getAll();
    await done;
    let migrated = false;
    if (savedState.result !== undefined) {
      const messages = new Map<number, unknown[]>();
      keys.result.forEach((key, index) => {
        if (!Array.isArray(key) || key.length !== 2 || typeof key[0] !== "number" || typeof key[1] !== "number" || !Number.isSafeInteger(key[0]) || !Number.isSafeInteger(key[1])) throw new Error("Local conversation records have invalid keys. Preserve browser data for recovery.");
        const list = messages.get(key[0]) ?? [];
        if (key[1] !== list.length) throw new Error("Local history is incomplete. Preserve browser data for recovery.");
        list.push(records.result[index]);
        messages.set(key[0], list);
      });
      const sessions = savedSessions.result.map(entry => {
        const list = messages.get(entry.session_id) ?? [];
        if (entry.count !== list.length) throw new Error("Local history is incomplete. Preserve browser data for recovery.");
        messages.delete(entry.session_id);
        return { ...entry, history: { ...entry.history, messages: list } };
      });
      if (messages.size) throw new Error("Local history has records without a conversation. Preserve browser data for recovery.");
      library = parseLibrary({ format: "finrod-phone", version: 2, ...savedState.result, sessions });
    } else {
      if (savedSessions.result.length || records.result.length) throw new Error("Local chat library is incomplete. Preserve browser data for recovery.");
      const oldTx = db.transaction(["history", "messages", "snapshots"], "readonly");
      const oldDone = transactionDone(oldTx);
      const oldState = oldTx.objectStore("history").get("conversation");
      const oldMessages = oldTx.objectStore("messages").getAll();
      const snapshot = oldTx.objectStore("snapshots").get("conversation");
      await oldDone;
      let history = emptyHistory();
      if (oldState.result !== undefined) {
        if (oldState.result.count !== oldMessages.result.length) throw new Error("Local history is incomplete. Preserve browser data for recovery.");
        history = parseHistory({ ...oldState.result, messages: oldMessages.result });
        migrated = true;
      } else if (snapshot.result !== undefined) {
        if (!(snapshot.result instanceof Uint8Array)) throw new Error("Legacy history has an unsupported format. Preserve browser data for recovery.");
        history = await (await import("./legacy.js")).readLegacyHistory(snapshot.result);
        migrated = true;
      }
      library = { format: "finrod-phone", version: 2, active_session_id: 1, next_session_id: 2, sessions: [newSession(1, history)] };
    }
    for (const session of library.sessions) counts.set(session.session_id, session.history.messages.length);
    const recovered = recoverLibrary(library);
    if (savedState.result === undefined || JSON.stringify(recovered) !== JSON.stringify(library)) await replaceLibrary(recovered);
    // Original single-chat records and the SQLite snapshot remain untouched for recovery.
    return {
      migrated, check,
      active: () => session(library.active_session_id),
      summaries(): SessionList {
        return { active_session_id: library.active_session_id, sessions: library.sessions.map(({ history, feedback: _feedback, ...entry }) => ({ ...entry, status: history.status })) };
      },
      async save(id: number, history: History, replace = false) {
        const copy = structuredClone(history);
        await mutate(async () => {
          const current = session(id);
          const count = counts.get(id)!;
          if (!replace && copy.messages.length < count) throw new Error("History cannot shrink without an explicit replacement.");
          const updated = { ...current, history: copy,
            updatedAt: Math.max(current.createdAt, copy.messages.at(-1)?.timestamp ?? 0, copy.partial?.timestamp ?? 0) };
          await commit(tx => {
            const messages = tx.objectStore("chatMessages");
            if (replace) messages.delete(range(id));
            for (let index = replace ? 0 : count; index < copy.messages.length; index++) messages.put(copy.messages[index], [id, index]);
            tx.objectStore("sessions").put(metadata(updated));
          });
          Object.assign(current, updated);
          counts.set(id, copy.messages.length);
        });
      },
      async select(id: number) {
        await mutate(async () => {
          const target = session(id);
          await commit(tx => tx.objectStore("library").put({ ...state(library), active_session_id: id }, "state"));
          library.active_session_id = id;
          return target;
        });
        return session(id);
      },
      async newChat() {
        return mutate(async () => {
          const empty = library.sessions.find(entry => !entry.history.messages.length && !entry.history.partial &&
            entry.history.status === "idle" && entry.titleState === "unrequested");
          if (empty) {
            await commit(tx => tx.objectStore("library").put({ ...state(library), active_session_id: empty.session_id }, "state"));
            library.active_session_id = empty.session_id;
            return empty;
          }
          if (!Number.isSafeInteger(library.next_session_id + 1)) throw new Error("Conversation ID counter is exhausted. Preserve a backup before moving to a new browser origin.");
          const created = newSession(library.next_session_id);
          const next = { active_session_id: created.session_id, next_session_id: created.session_id + 1 };
          await commit(tx => { tx.objectStore("sessions").put(metadata(created)); tx.objectStore("library").put(next, "state"); });
          library.sessions.push(created);
          library.active_session_id = next.active_session_id;
          library.next_session_id = next.next_session_id;
          counts.set(created.session_id, 0);
          return created;
        });
      },
      async setTitle(id: number, title: string, titleState: Session["titleState"], error?: string) {
        await mutate(async () => {
          const current = session(id);
          const updated = { ...current, title, titleState };
          delete updated.titleError;
          if (error) updated.titleError = error;
          await commit(tx => tx.objectStore("sessions").put(metadata(updated)));
          Object.assign(current, updated);
          if (!error) delete current.titleError;
        });
      },
      async saveFeedback(id: number, index: number, vote: Vote, comment: string): Promise<Feedback> {
        check();
        if (!["up", "down"].includes(vote) || comment.length > 2000) throw new Error("Choose a feedback vote and enter at most 2,000 characters.");
        return mutate(async () => {
          const current = session(id);
          if (!rateable(current.history.messages[index])) throw new Error("Only a saved assistant answer can receive feedback. Reload this chat and try again.");
          const text = vote === "down" ? comment.trim() : "";
          const previous = current.feedback.find(entry => entry.message_index === index);
          if (previous?.vote === vote && previous.comment === text) return previous;
          const now = Date.now();
          const entry: Feedback = { message_index: index, vote, comment: text, createdAt: previous?.createdAt ?? now, updatedAt: now };
          const updated = { ...current, feedback: [...current.feedback.filter(entry => entry.message_index !== index), entry].sort((a, b) => a.message_index - b.message_index) };
          await commit(tx => tx.objectStore("sessions").put(metadata(updated)));
          current.feedback = updated.feedback;
          return entry;
        });
      },
      exportHistory() { check(); return JSON.stringify(library, null, 2); },
      restore: replaceLibrary,
      async close() { await tail; db.close(); },
    };
  } catch (error) { db.close(); throw error; }
}
