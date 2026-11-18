import { useEffect, useState } from "react";
import { cloud, onCloud, signIn, signOut } from "../data/cloud";
import { onSync, syncNow, syncState } from "../data/sync";
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
  const [, force] = useState(0);
  useEffect(() => {
    const a = onCloud(() => force((x) => x + 1));
    const b = onSync(() => force((x) => x + 1));
    return () => { a(); b(); };
  }, []);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setErr(""); setMsg("");
    try { setMsg(await fn()); onChanged(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const quota = (st: { current: number; limit: number; plan: string }) =>
    `Clave válida${st.plan ? ` (plan ${st.plan})` : ""} · consultas hoy: ${st.current} de ${st.limit}`;

  return (
    <Modal title="⚙ Ajustes" onClose={onClose}>
      <h4>Cuenta de Google (sincronizar)</h4>
      {cloud.user ? (
        <>
          <p className="ok-msg small">✔ Conectado como <b>{cloud.user.email}</b>. Perfiles, presets y Mis partidos (con tus apuestas) se guardan en tu cuenta y son los mismos en la compu y el teléfono.</p>
          <div className="row">
            <button disabled={syncState.busy} onClick={() => run(async () => { await syncNow(); onChanged(); return "Sincronizado."; })}>
              {syncState.busy ? "Sincronizando…" : "Sincronizar ahora"}
            </button>
            <button className="ghost" onClick={() => run(async () => { await signOut(); return "Saliste de la cuenta. Los datos quedan en este dispositivo."; })}>Salir</button>
          </div>
          {syncState.last > 0 && <p className="muted small">Última sincronización: {new Date(syncState.last).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</p>}
          {syncState.error && <div className="error">No se pudo sincronizar: {syncState.error}</div>}
        </>
      ) : (
        <>
          <p className="muted small">Entrá con la misma cuenta de Google que usás en tu otra app para tener los mismos perfiles, presets y Mis partidos en todos tus dispositivos.</p>
          <button className="primary" disabled={busy} onClick={() => run(async () => { await signIn(); return "Listo, ya estás conectado."; })}>Entrar con Google</button>
        </>
      )}

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
      <label className="switch">
        <input type="checkbox" defaultChecked={s.alwaysAll()} onChange={(e) => { s.setAlwaysAll(e.target.checked); onChanged(); }} />
        Calcular siempre todas las ligas del día (sin preguntar, aunque sean muchas)
      </label>
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
