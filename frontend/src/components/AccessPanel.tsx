import { useEffect, useState } from "react";
import { AccessUser, setUserAccess, watchAccessList } from "../data/cloud";

/** Solo para el dueño: habilitar o quitar el acceso a esta app. */
export default function AccessPanel() {
  const [users, setUsers] = useState<AccessUser[] | null>(null);
  const [err, setErr] = useState("");
  const [showOthers, setShowOthers] = useState(false);
  useEffect(() => {
    let off: (() => void) | undefined;
    watchAccessList(setUsers, setErr).then((f) => { off = f; });
    return () => off?.();
  }, []);
  const toggle = async (u: AccessUser, on: boolean) => {
    try { await setUserAccess(u.uid, on); } catch (e: any) { setErr(e.message); }
  };
  const asked = (users ?? []).filter((u) => u.solicita === "cuotasreales" && u.cuotasreales === undefined);
  const enabled = (users ?? []).filter((u) => u.cuotasreales === true);
  const others = (users ?? []).filter((u) => !asked.includes(u) && !enabled.includes(u));
  const Item = ({ u }: { u: AccessUser }) => (
    <li className="access-item">
      <span><b>{u.nombre || "Sin nombre"}</b><br /><span className="muted small">{u.email}</span></span>
      {u.cuotasreales === true
        ? <button onClick={() => toggle(u, false)}>Quitar acceso</button>
        : <button className="primary" onClick={() => toggle(u, true)}>Habilitar</button>}
    </li>
  );
  return (
    <div>
      <h4>Personas con acceso</h4>
      <p className="muted small">
        Para pedir acceso, la persona abre la app, entra con Google y toca “Pedir acceso”. Habilitarla acá <b>no</b> le da acceso a tu otra app.
        Cada uno usa su propia clave de API-Football y tiene sus propios perfiles y partidos.
      </p>
      {err && <div className="error">{err}</div>}
      {!users && !err && <p className="muted">Cargando…</p>}
      {users && (
        <>
          {asked.length > 0 && <><div className="group-title">Pidieron acceso ({asked.length})</div><ul className="access-list">{asked.map((u) => <Item key={u.uid} u={u} />)}</ul></>}
          <div className="group-title">Habilitados ({enabled.length})</div>
          {enabled.length ? <ul className="access-list">{enabled.map((u) => <Item key={u.uid} u={u} />)}</ul> : <p className="muted small">Todavía no habilitaste a nadie.</p>}
          {others.length > 0 && (
            <>
              <button className="link" onClick={() => setShowOthers(!showOthers)}>
                {showOthers ? "▾" : "▸"} Otras cuentas de tu otra app ({others.length})
              </button>
              {showOthers && <ul className="access-list">{others.map((u) => <Item key={u.uid} u={u} />)}</ul>}
            </>
          )}
        </>
      )}
    </div>
  );
}
