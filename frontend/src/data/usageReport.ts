// Conteo de consultas a API-Football para el panel «Accesos» de Fútbol Data Lab, que junta el
// consumo de las apps que usan la misma clave. Se acumula en memoria y se envía cada 5 minutos,
// al pasar la página a segundo plano y al cerrarla. Días en UTC, como el cupo diario de
// API-Football. Solo estadísticas: si el envío falla, la app sigue igual.
const REPORT_URL = "https://replica-futbol-sync.tanogralatto.workers.dev/usage-report";
const FLUSH_MS = 5 * 60 * 1000;

let pending: Record<string, number> = {};
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
/** Avisa cada vez que betpractice hace una consulta. */
export function onApiCall(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
/** Consultas de betpractice hoy (día UTC, como el cupo de API-Football) en este dispositivo. */
export function todayCalls(): number {
  try { return Number(localStorage.getItem(`cr:uso:${new Date().toISOString().slice(0, 10)}`) ?? "0"); } catch { return 0; }
}

function flush(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!Object.keys(pending).length) return;
  const body = JSON.stringify({ app: "betpractice", counts: pending });
  pending = {};
  try {
    const ok = navigator.sendBeacon?.(REPORT_URL, new Blob([body], { type: "text/plain" }));
    if (!ok) fetch(REPORT_URL, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => {});
  } catch {
    /* solo estadísticas */
  }
}

/** Suma una consulta real a API-Football (cada intento HTTP, como lo descuenta API-Football). */
export function countApiCall(): void {
  const day = new Date().toISOString().slice(0, 10);
  pending[day] = (pending[day] ?? 0) + 1;
  // contador del día en este dispositivo (para el contador de arriba)
  try {
    const k = `cr:uso:${day}`;
    localStorage.setItem(k, String(Number(localStorage.getItem(k) ?? "0") + 1));
  } catch { /* nada */ }
  listeners.forEach((fn) => fn());
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}
