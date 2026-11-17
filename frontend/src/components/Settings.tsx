import { useState } from "react";
import { api } from "../api";
import { Modal } from "./common";

export default function Settings({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const s = api.settings;
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const src = s.keySource();
  const u = s.usage();

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setErr(""); setMsg("");
    try { setMsg(await fn()); onChanged(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const quota = (st: { current: number; limit: number; plan: string }) =>
    `Clave válida${st.plan ? ` (plan ${st.plan})` : ""} · consultas hoy: ${st.current} de ${st.limit}`;

  return (
    <Modal title="⚙ Ajustes" onClose={onClose}>
      <h4>Clave de API-Football</h4>
      {src === "otra-app" && <p className="ok-msg small">✔ Se está usando la clave que ya tenés guardada en tu otra app de este sitio.</p>}
      {src === "propia" && <p className="ok-msg small">✔ Clave guardada en este navegador.</p>}
      {!src && <p className="muted small">Sin clave se muestran datos de prueba.</p>}
      <div className="row">
        <input type="password" autoComplete="off" spellCheck={false} placeholder={src ? "Pegá otra clave para cambiarla" : "Pegá tu clave (x-apisports-key)"}
          value={key} onChange={(e) => setKey(e.target.value)} />
        <button className="primary" disabled={busy || !key.trim()} onClick={() => run(async () => { const st = await s.saveKey(key); setKey(""); return quota(st); })}>
          Guardar y probar
        </button>
      </div>
      <div className="row">
        {src && <button disabled={busy} onClick={() => run(async () => quota(await s.status()))}>Ver consultas de hoy</button>}
        {src === "propia" && <button className="ghost" disabled={busy} onClick={() => run(async () => { s.removeKey(); return "Clave borrada de este navegador."; })}>Borrar clave</button>}
      </div>
      {msg && <div className="ok-msg">{msg}</div>}
      {err && <div className="error">{err}</div>}
      <p className="muted small">La clave queda guardada solo en este navegador; no se sube a ningún lado. En esta sesión la app hizo {u.calls} consultas.</p>

      <h4>Datos</h4>
      <div className="row">
        {src && (s.mode() === "api"
          ? <button onClick={() => { s.useDemo(true); onChanged(); }}>Ver datos de prueba</button>
          : <button onClick={() => { s.useDemo(false); onChanged(); }}>Volver a los datos reales</button>)}
        <button className="ghost" onClick={() => run(async () => { await s.clearCache(); return "Datos guardados borrados: se vuelven a bajar al usarlos."; })}>
          Borrar datos guardados
        </button>
      </div>
      <p className="muted small">
        Los partidos, historiales y cuotas que se bajan quedan guardados en el navegador para no gastar consultas:
        las temporadas pasadas se bajan una sola vez; la actual se renueva cada 3 horas y las cuotas cada 30 minutos (o con ↻ Actualizar).
      </p>
    </Modal>
  );
}
