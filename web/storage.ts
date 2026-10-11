import initSqlJs, { type Database, type SqlValue } from "sql.js";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@earendil-works/pi-durable/storage/sqlite";

async function openSnapshots(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("finrod-browser", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("snapshots");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Cannot open local history storage.", { cause: request.error }));
    request.onblocked = () => reject(new Error("Local storage is blocked by another Finrod page. Close that page and reload."));
  });
}

function loadSnapshot(db: IDBDatabase): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("snapshots", "readonly");
    const request = tx.objectStore("snapshots").get("conversation");
    tx.oncomplete = () => {
      const value: unknown = request.result;
      if (value !== undefined && !(value instanceof Uint8Array)) {
        reject(new Error("Stored history has an unsupported format. Do not clear browser data; preserve it for recovery."));
      } else resolve(value);
    };
    tx.onabort = () => reject(new Error("Cannot read local history.", { cause: tx.error }));
  });
}

function saveSnapshot(db: IDBDatabase, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("snapshots", "readwrite");
    tx.objectStore("snapshots").put(bytes, "conversation");
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error("Cannot save history on this device. Check available storage, then reload before continuing.", { cause: tx.error }));
  });
}

/** A small-conversation adapter: each committed SQLite state is saved atomically in IndexedDB. */
class BrowserSqlite implements SqliteDatabase {
  private tail: Promise<void> = Promise.resolve();
  private failure: Error | undefined;
  private closed = false;

  constructor(private readonly db: Database, private readonly snapshots: IDBDatabase) {}

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      if (this.closed) throw new Error("Local history is closed. Reload Finrod.");
      if (this.failure) throw this.failure;
      return await operation();
    } finally { release(); }
  }

  private async persist(): Promise<void> {
    try {
      const bytes = this.db.export();
      // sql.js export reopens its connection, so restore connection-local constraints.
      this.db.exec("PRAGMA foreign_keys=ON");
      await saveSnapshot(this.snapshots, bytes);
    } catch (error) {
      this.failure = new Error("History persistence failed. Finrod cannot safely continue; reload the page.", { cause: error });
      throw this.failure;
    }
  }

  private executor(): SqliteExecutor & { expire(): void } {
    let active = true;
    const values = (params: SqliteValue[]): SqlValue[] => params.map(value => {
      if (typeof value === "bigint") {
        const n = Number(value);
        if (!Number.isSafeInteger(n)) throw new Error("SQLite integer exceeds the browser adapter's safe range.");
        return n;
      }
      return value;
    });
    const check = () => { if (!active) throw new Error("Expired SQLite transaction handle."); };
    const all = async <T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> => {
      check();
      const statement = this.db.prepare(sql);
      try {
        statement.bind(values(params));
        const rows: T[] = [];
        while (statement.step()) rows.push(statement.getAsObject() as T);
        return rows;
      } finally { statement.free(); }
    };
    const get = async <T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> => {
      const rows = await all<T>(sql, ...params);
      return rows[0];
    };
    return {
      exec: async sql => { check(); this.db.exec(sql); },
      run: async (sql, ...params) => { check(); this.db.run(sql, values(params)); },
      all,
      get,
      expire: () => { active = false; },
    };
  }

  exec(sql: string): Promise<void> {
    return this.exclusive(async () => { this.db.exec(sql); await this.persist(); });
  }
  run(sql: string, ...params: SqliteValue[]): Promise<void> {
    return this.exclusive(async () => { await this.executor().run(sql, ...params); await this.persist(); });
  }
  get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
    return this.exclusive(() => this.executor().get<T>(sql, ...params));
  }
  all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
    return this.exclusive(() => this.executor().all<T>(sql, ...params));
  }
  transaction<T>(callback: (tx: SqliteExecutor) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      this.db.exec("BEGIN");
      const tx = this.executor();
      let committed = false;
      try {
        const result = await callback(tx);
        this.db.exec("COMMIT");
        committed = true;
        await this.persist();
        return result;
      } catch (error) {
        if (!committed) {
          try { this.db.exec("ROLLBACK"); } catch (rollback) {
            throw new AggregateError([error, rollback], "SQLite operation and rollback both failed.");
          }
        }
        throw error;
      } finally { tx.expire(); }
    });
  }
  async close(): Promise<void> {
    await this.tail;
    if (this.closed) return;
    this.closed = true;
    this.db.close();
    this.snapshots.close();
  }
}

export async function openBrowserDatabase(): Promise<SqliteDatabase> {
  const snapshots = await openSnapshots();
  try {
    const bytes = await loadSnapshot(snapshots);
    const SQL = await initSqlJs({ locateFile: () => new URL("./sql-wasm.wasm", location.href).href });
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    try {
      db.exec("PRAGMA foreign_keys=ON");
      const integrity = db.exec("PRAGMA integrity_check");
      if (integrity[0]?.values[0]?.[0] !== "ok") throw new Error("Local history failed its integrity check. Do not clear browser data.");
      return new BrowserSqlite(db, snapshots);
    } catch (error) { db.close(); throw error; }
  } catch (error) { snapshots.close(); throw error; }
}
