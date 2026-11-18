import { useState } from "react";
import { access, cloud, requestAccess, signIn, signOut } from "../data/cloud";

/** Pantalla de entrada: solo pasan las personas habilitadas por el dueño. */
export default function Gate() {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr("");
    try { await fn(); } catch (e: any) { setErr(e?.message ?? String(e)); } finally { setBusy(false); }
  };
  const s = access.state;
  return (
    <div className="gate">
      <div className="gate-box">
        <div className="brand">⚽ Cuotas reales</div>
        {s === "loading" && <p className="muted">Verificando el acceso…</p>}
        {s === "login" && (
          <>
            <p>Para usar la app entrá con tu cuenta de Google.</p>
            <button className="primary" disabled={busy} onClick={() => run(signIn)}>Entrar con Google</button>
          </>
        )}
        {s === "none" && (
          <>
            <p>Entraste como <b>{cloud.user?.email}</b>, pero todavía no tenés acceso.</p>
            <button className="primary" disabled={busy} onClick={() => run(requestAccess)}>Pedir acceso</button>
          </>
        )}
        {s === "pending" && (
          <p>Entraste como <b>{cloud.user?.email}</b>. Tu pedido de acceso está <b>pendiente</b>: cuando te habiliten, esta pantalla se abre sola.</p>
        )}
        {s === "blocked" && <p>La cuenta <b>{cloud.user?.email}</b> no tiene acceso a esta app.</p>}
        {s === "error" && <div className="error">No se pudo verificar el acceso: {access.error}</div>}
        {(err || (s === "login" && access.error)) && <div className="error">{err || access.error}</div>}
        {cloud.user && s !== "loading" && <button className="ghost" onClick={() => run(signOut)}>Entrar con otra cuenta</button>}
      </div>
    </div>
  );
}
