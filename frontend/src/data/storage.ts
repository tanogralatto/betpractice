/** Almacenamiento del navegador: localStorage (cosas chicas) e IndexedDB (historiales y cuotas). */

// Claves que se sincronizan con la cuenta de Google (ver data/sync.ts)
export const SYNC_KEYS = new Set(["cuotas-reales.v1", "cr:favoritos", "cr:favoritos-borrados"]);
let onSyncChange: ((key: string) => void) | null = null;
export const setSyncListener = (fn: (key: string) => void) => { onSyncChange = fn; };

export const LS = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown, fromSync = false): void {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch { /* sin espacio o bloqueado: se ignora */ }
    if (!fromSync && SYNC_KEYS.has(k)) {
      try { localStorage.setItem(`cr:mod:${k}`, String(Date.now())); } catch { /* nada */ }
      onSyncChange?.(k);
    }
  },
  del(k: string): void {
    try { localStorage.removeItem(k); } catch { /* nada */ }
  },
};

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("cuotas-reales", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}

async function tx<T>(mode: IDBTransactionMode, fn: (st: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction("kv", mode);
    let out: T | undefined;
    const r = fn(t.objectStore("kv"));
    if (r) r.onsuccess = () => { out = r.result as T; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

/** Caché con vencimiento. Si IndexedDB no está disponible, todo sigue funcionando sin caché. */
export const Cache = {
  async get<T>(k: string, maxAgeMs: number): Promise<T | null> {
    try {
      const v = await tx<{ t: number; v: T }>("readonly", (st) => st.get(k));
      if (!v || Date.now() - v.t > maxAgeMs) return null;
      return v.v;
    } catch {
      return null;
    }
  },
  async set(k: string, v: unknown): Promise<void> {
    try { await tx("readwrite", (st) => st.put({ t: Date.now(), v }, k)); } catch { /* sin caché */ }
  },
  async clear(prefix?: string): Promise<void> {
    try {
      if (!prefix) { await tx("readwrite", (st) => st.clear()); return; }
      const keys = (await tx<IDBValidKey[]>("readonly", (st) => st.getAllKeys())) ?? [];
      await tx("readwrite", (st) => { keys.filter((k) => String(k).startsWith(prefix)).forEach((k) => st.delete(k)); });
    } catch { /* nada */ }
  },
};
