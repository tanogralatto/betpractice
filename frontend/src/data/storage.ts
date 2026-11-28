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
  /** Igual que get, pero devuelve también cuándo se bajó. */
  async getWithTime<T>(k: string, maxAgeMs: number): Promise<{ v: T; t: number } | null> {
    try {
      const v = await tx<{ t: number; v: T }>("readonly", (st) => st.get(k));
      if (!v || Date.now() - v.t > maxAgeMs) return null;
      return v;
    } catch {
      return null;
    }
  },
  /** `t`: cuándo se bajó el dato (si vino de la nube compartida, su fecha original). */
  async set(k: string, v: unknown, t = Date.now()): Promise<void> {
    try { await tx("readwrite", (st) => st.put({ t, v }, k)); } catch { /* sin caché */ }
  },
  /** Borra lo viejo para no llenar el almacenamiento del navegador (lo compartido con la otra app del sitio). */
  async prune(): Promise<number> {
    try {
      const all = (await tx<IDBValidKey[]>("readonly", (st) => st.getAllKeys())) ?? [];
      const now = Date.now(), DAY = 864e5;
      const entries: [string, number][] = [];
      for (const k of all) {
        const v = await tx<{ t: number }>("readonly", (st) => st.get(k));
        entries.push([String(k), v?.t ?? 0]);
      }
      const drop = new Set<string>();
      for (const [k, t] of entries) {
        const age = now - t;
        if ((k.startsWith("day:") || k.startsWith("odds:")) && age > 7 * DAY) drop.add(k);
        else if ((k.startsWith("team:") || k.startsWith("h2h:")) && age > 3 * DAY) drop.add(k);
        else if (k.startsWith("fx:") && age > 60 * DAY) drop.add(k);
      }
      // tope de cantidad: se quedan los 400 más nuevos
      const rest = entries.filter(([k]) => !drop.has(k)).sort((a, b) => b[1] - a[1]);
      for (const [k] of rest.slice(400)) drop.add(k);
      if (drop.size) await tx("readwrite", (st) => { drop.forEach((k) => st.delete(k)); });
      return drop.size;
    } catch {
      return 0;
    }
  },
  /** Borra toda la base de datos de partidos y cuotas guardados (no toca perfiles, Mis partidos ni la clave). */
  async wipe(): Promise<void> {
    dbp = null;
    await new Promise<void>((res) => {
      try {
        const r = indexedDB.deleteDatabase("cuotas-reales");
        r.onsuccess = r.onerror = r.onblocked = () => res();
        setTimeout(res, 4000);
      } catch { res(); }
    });
  },
  async clear(prefix?: string): Promise<void> {
    try {
      if (!prefix) { await tx("readwrite", (st) => st.clear()); return; }
      const keys = (await tx<IDBValidKey[]>("readonly", (st) => st.getAllKeys())) ?? [];
      await tx("readwrite", (st) => { keys.filter((k) => String(k).startsWith(prefix)).forEach((k) => st.delete(k)); });
    } catch { /* nada */ }
  },
};
