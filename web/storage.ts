import { emptyHistory, parseHistory, recoverHistory, type History } from "./history.js";

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error("Local history transaction failed. Check available storage and reload before continuing.", { cause: tx.error }));
  });
}

export async function openHistory() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("finrod-browser", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("snapshots")) request.result.createObjectStore("snapshots");
      request.result.createObjectStore("messages");
      request.result.createObjectStore("history");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Cannot open local history storage.", { cause: request.error }));
    request.onblocked = () => reject(new Error("Close other Finrod pages, then reload to upgrade local history."));
  });
  let count = 0;
  let failure: Error | undefined;
  let tail: Promise<void> = Promise.resolve();
  const check = () => { if (failure) throw failure; };
  async function save(history: History, replace = false) {
    check();
    const copy = structuredClone(history);
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      check();
      const tx = db.transaction(["messages", "history"], "readwrite");
      const done = transactionDone(tx);
      const messages = tx.objectStore("messages");
      try {
        if (replace) messages.clear();
        else if (copy.messages.length < count) throw new Error("History cannot shrink without an explicit replacement.");
        for (let i = replace ? 0 : count; i < copy.messages.length; i++) messages.put(copy.messages[i], i);
        const { messages: _, ...metadata } = copy;
        tx.objectStore("history").put({ ...metadata, count: copy.messages.length }, "conversation");
      } catch (error) {
        tx.abort();
        try { await done; } catch (abortError) { throw new AggregateError([error, abortError], "History update was aborted."); }
        throw error;
      }
      await done;
      count = copy.messages.length;
    } catch (error) {
      failure = new Error("History persistence failed. Finrod cannot safely continue; reload the page.", { cause: error });
      throw failure;
    } finally { release(); }
  }
  try {
    const tx = db.transaction(["history", "messages"], "readonly");
    const done = transactionDone(tx);
    const metadata = tx.objectStore("history").get("conversation");
    const messages = tx.objectStore("messages").getAll();
    await done;
    let history: History;
    let migrated = false;
    if (metadata.result !== undefined) {
      if (metadata.result.count !== messages.result.length) throw new Error("Local history is incomplete. Preserve browser data for recovery.");
      history = parseHistory({ ...metadata.result, messages: messages.result });
      count = history.messages.length;
    } else {
      const legacyTx = db.transaction("snapshots", "readonly");
      const legacyDone = transactionDone(legacyTx);
      const legacy = legacyTx.objectStore("snapshots").get("conversation");
      await legacyDone;
      if (legacy.result !== undefined) {
        if (!(legacy.result instanceof Uint8Array)) throw new Error("Legacy history has an unsupported format. Preserve browser data for recovery.");
        history = await (await import("./legacy.js")).readLegacyHistory(legacy.result);
        migrated = true;
      } else history = emptyHistory();
    }
    const recovered = recoverHistory(history);
    if (metadata.result === undefined || recovered.status !== history.status || recovered.messages.length !== count) await save(recovered, true);
    history = recovered;
    // The original SQLite snapshot remains untouched as a migration recovery copy.
    return { history, migrated, save, check, async close() { await tail; db.close(); } };
  } catch (error) { db.close(); throw error; }
}
