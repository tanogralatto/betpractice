import { useEffect, useRef, useState } from "react";
import * as AF from "../data/apiFootball";
import { onApiCall, todayCalls } from "../data/usageReport";

const fmt = (n: number) => n.toLocaleString("es-AR");

// Consumo de hoy por app, que junta el worker de Fútbol Data Lab (solo números).
const USAGE_URL = "https://replica-futbol-sync.tanogralatto.workers.dev/usage-today";
type ByApp = { apps: Record<string, number>; names: Record<string, string> };
async function byApp(): Promise<ByApp | null> {
  try {
    const r = await fetch(USAGE_URL);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.apps ? (j as ByApp) : null;
  } catch {
    return null;
  }
}

/** Contador de consultas a API-Football del día (arriba, al lado de ↻ Actualizar).
 *  El total sale de /status, que no gasta consultas; betpractice se cuenta en este dispositivo. */
export default function ApiCounter() {
  const [st, setSt] = useState<{ current: number; limit: number } | null>(null);
  const [mine, setMine] = useState(todayCalls());
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<ByApp | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      AF.status().then((s) => setSt({ current: s.current, limit: s.limit })).catch(() => {});
      byApp().then((a) => a && setApps(a));
    };
    load();
    const every = setInterval(load, 5 * 60_000);
    // después de consultas propias se refresca el total (agrupado, como mucho cada 20 s)
    const off = onApiCall(() => {
      setMine(todayCalls());
      if (!t) t = setTimeout(() => { t = undefined; load(); }, 20_000);
    });
    return () => { clearInterval(every); clearTimeout(t); off(); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // por app: lo que juntó Data Lab; BetPractice nunca menos que lo de este dispositivo (se reporta cada 5 min)
  const counts: Record<string, number> = { ...(apps?.apps ?? {}) };
  counts.betpractice = Math.max(counts.betpractice ?? 0, mine);
  // BetPractice siempre; las demás apps solo si gastaron algo hoy
  const order = ["betpractice", ...Object.keys(counts).filter((k) => k !== "betpractice" && counts[k] > 0)];
  const rows: [string, number][] = order.map((k) => [k === "betpractice" ? "BetPractice" : apps?.names[k] ?? k, counts[k]]);
  const known = rows.reduce((a, [, n]) => a + n, 0);
  const total = st ? Math.max(st.current, known) : null;
  const pct = st && st.limit ? Math.min(100, (total! / st.limit) * 100) : 0;
  const level = pct >= 85 ? "bad" : pct >= 60 ? "warn" : "ok";
  // el cupo de API-Football se reinicia a las 00:00 UTC
  const now = new Date();
  const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
  const resetTxt = `${Math.floor(reset / 3_600_000)} h ${Math.floor((reset % 3_600_000) / 60_000)} min`;

  return (
    <div className="api-counter" ref={box}>
      <button className={`api-pill ${level}`} onClick={() => setOpen(!open)} title="Consultas a API-Football hoy">
        ⚡ API {total === null ? "…" : fmt(total)}{st?.limit ? ` / ${fmt(st.limit)}` : ""}
      </button>
      {open && (
        <div className="api-pop">
          <div className="api-row"><b>Consultas de hoy</b><b>{total === null ? "…" : fmt(total)}{st?.limit ? ` / ${fmt(st.limit)}` : ""}</b></div>
          {!!st?.limit && <div className="api-bar"><span className={level} style={{ width: `${pct}%` }} /><em>{Math.round(pct)}%</em></div>}
          {rows.map(([name, n]) => <div key={name} className="api-row"><span>{name}</span><b>{fmt(n)}</b></div>)}
          {total !== null && <div className="api-row"><span>Otras <small className="muted">(sin identificar)</small></span><b>{fmt(Math.max(0, total - known))}</b></div>}
          {!apps && <div className="muted small">BetPractice: solo este dispositivo (no se pudo leer el detalle de las otras apps).</div>}
          <div className="muted small">Se reinicia en {resetTxt} · el total es el de tu clave</div>
        </div>
      )}
    </div>
  );
}
