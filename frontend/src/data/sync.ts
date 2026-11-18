/**
 * Sincronización de perfiles, presets y Mis partidos con la cuenta de Google.
 * - Perfiles y presets: gana la versión modificada más recientemente.
 * - Mis partidos: se combinan partido por partido (gana el cambio más reciente) y los borrados
 *   se recuerdan para que no reaparezcan.
 */
import { cloud, onCloud, pull, push } from "./cloud";
import { LS, setSyncListener } from "./storage";

const STORE = "cuotas-reales.v1", FAVS = "cr:favoritos", DEL = "cr:favoritos-borrados";
const mod = (k: string) => Number(LS.get<string>(`cr:mod:${k}`, "0")) || 0;

interface Payload {
  store: unknown; store_mod: number;
  favs: Record<string, { updated_at?: number }>; deleted: Record<string, number>;
}

export const syncState = { last: 0, error: "", busy: false };
const listeners = new Set<() => void>();
export const onSync = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((f) => f());

function local(): Payload {
  return { store: LS.get(STORE, null), store_mod: mod(STORE), favs: LS.get(FAVS, {}), deleted: LS.get(DEL, {}) };
}

export function merge(a: Payload, b: Payload): Payload {
  const deleted: Record<string, number> = { ...a.deleted };
  for (const [id, t] of Object.entries(b.deleted ?? {})) deleted[id] = Math.max(deleted[id] ?? 0, t);
  const favs: Payload["favs"] = {};
  for (const src of [a.favs ?? {}, b.favs ?? {}])
    for (const [id, f] of Object.entries(src))
      if (!favs[id] || (f.updated_at ?? 0) > (favs[id].updated_at ?? 0)) favs[id] = f;
  for (const [id, f] of Object.entries(favs)) if ((deleted[id] ?? 0) >= (f.updated_at ?? 0)) delete favs[id];
  const newer = (b.store_mod ?? 0) > (a.store_mod ?? 0) ? b : a;
  return { store: newer.store ?? a.store ?? b.store, store_mod: Math.max(a.store_mod ?? 0, b.store_mod ?? 0), favs, deleted };
}

let applying = false;
/** Baja lo de la cuenta, lo combina con lo local y sube el resultado. Devuelve true si cambió algo local. */
export async function syncNow(): Promise<boolean> {
  if (!cloud.user || syncState.busy) return false;
  syncState.busy = true; syncState.error = ""; emit();
  try {
    const remoteDoc = await pull();
    const mine = local();
    const remote: Payload | null = remoteDoc ? JSON.parse(remoteDoc.v) : null;
    const merged = remote ? merge(mine, remote) : mine;
    const changedLocal = JSON.stringify([merged.store, merged.favs, merged.deleted]) !== JSON.stringify([mine.store, mine.favs, mine.deleted]);
    if (changedLocal) {
      applying = true;
      if (merged.store) LS.set(STORE, merged.store, true);
      LS.set(FAVS, merged.favs, true);
      LS.set(DEL, merged.deleted, true);
      LS.set(`cr:mod:${STORE}`, String(merged.store_mod), true);
      applying = false;
    }
    if (!remote || JSON.stringify(merged) !== JSON.stringify(remote)) await push({ v: JSON.stringify(merged), ts: Date.now() });
    syncState.last = Date.now();
    return changedLocal;
  } catch (e: any) {
    syncState.error = e?.message ?? String(e);
    return false;
  } finally {
    syncState.busy = false; emit();
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Conecta la sincronización: al entrar, al volver a la app y unos segundos después de cada cambio. */
export function startSync(onRemoteChange: () => void): void {
  const run = async () => { if (await syncNow()) onRemoteChange(); };
  setSyncListener(() => {
    if (applying || !cloud.user) return;
    clearTimeout(timer);
    timer = setTimeout(run, 2000);
  });
  onCloud(() => { if (cloud.user) void run(); emit(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && cloud.user) void run(); });
}
