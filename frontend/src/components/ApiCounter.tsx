import { useEffect, useRef, useState } from "react";
import * as AF from "../data/apiFootball";
import { onApiCall, todayCalls } from "../data/usageReport";

const fmt = (n: number) => n.toLocaleString("es-AR");

/** Contador de consultas a API-Football del día (arriba, al lado de ↻ Actualizar).
 *  El total sale de /status, que no gasta consultas; betpractice se cuenta en este dispositivo. */
export default function ApiCounter() {
  const [st, setSt] = useState<{ current: number; limit: number } | null>(null);
  const [mine, setMine] = useState(todayCalls());
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const load = () => AF.status().then((s) => setSt({ current: s.current, limit: s.limit })).catch(() => {});
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

  const total = st ? Math.max(st.current, mine) : null;
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
          <div className="api-row"><span>betpractice <small className="muted">(este dispositivo)</small></span><b>{fmt(mine)}</b></div>
          {total !== null && <div className="api-row"><span>Otras apps <small className="muted">(Escáner, Data Lab…)</small></span><b>{fmt(Math.max(0, total - mine))}</b></div>}
          <div className="muted small">Se reinicia en {resetTxt} · el total es el de tu clave</div>
        </div>
      )}
    </div>
  );
}
