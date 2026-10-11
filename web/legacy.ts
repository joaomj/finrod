import initSqlJs from "sql.js";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, defineDoc, Harness, watchEvents } from "@earendil-works/pi-durable";
import { SqliteStorage, type SqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite";
import { emptyHistory, parseHistory, type History, type SavedMessage } from "./history.js";

/** Read the old prototype once, without starting its task scheduler or provider requests. */
export async function readLegacyHistory(bytes: Uint8Array): Promise<History> {
  const SQL = await initSqlJs({ locateFile: () => new URL("./sql-wasm.wasm", location.href).href });
  const db = new SQL.Database(bytes);
  const rows = <T extends object>(sql: string, ...params: unknown[]): T[] => {
    const statement = db.prepare(sql);
    try {
      statement.bind(params as (string | number | null | Uint8Array)[]);
      const result: T[] = [];
      while (statement.step()) result.push(statement.getAsObject() as T);
      return result;
    } finally { statement.free(); }
  };
  const facade: SqliteDatabase = {
    exec: async sql => { db.exec(sql); }, run: async (sql, ...params) => { db.run(sql, params as (string | number | null | Uint8Array)[]); },
    all: async <T extends object>(sql: string, ...params: unknown[]) => rows<T>(sql, ...params),
    get: async <T extends object>(sql: string, ...params: unknown[]): Promise<T | undefined> => rows<T>(sql, ...params)[0],
    transaction: async callback => {
      db.exec("BEGIN");
      try { const value = await callback(facade); db.exec("COMMIT"); return value; }
      catch (error) {
        try { db.exec("ROLLBACK"); } catch (rollback) { throw new AggregateError([error, rollback], "Legacy migration and rollback failed."); }
        throw error;
      }
    }, close: async () => { db.close(); },
  };
  let harness: Harness | undefined;
  let storage: SqliteStorage | undefined;
  try {
    if (rows<{ integrity_check: string }>("PRAGMA integrity_check")[0]?.integrity_check !== "ok") throw new Error("Legacy history failed its integrity check.");
    if (rows("SELECT id FROM conversations").length !== 1) throw new Error("Legacy migration supports the prototype's single conversation only.");
    storage = await SqliteStorage.open(facade);
    harness = await Harness.open(storage, { models: createModels({ authContext: { env: async () => undefined, fileExists: async () => false } }), registry: createRegistry() }, context);
    const root = await harness.root(context);
    const stream = await watchEvents(harness, root.id, context);
    const history = emptyHistory();
    history.messages = stream.snapshot.entries.flatMap(entry => (entry.model ?? []).filter(message => message.role !== "system") as SavedMessage[]);
    if (stream.snapshot.generation?.message) history.partial = stream.snapshot.generation.message;
    const turn = defineDoc<{ status: History["status"] }>({ kind: "finrod.browser-turn", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ status: "idle" }) });
    history.status = (await harness.snapshot(turn, root.id, context))?.status ?? "idle";
    await stream.stop();
    return parseHistory(history);
  } finally { if (harness) await harness.close(context); else if (storage) await storage.close(context); else db.close(); }
}
