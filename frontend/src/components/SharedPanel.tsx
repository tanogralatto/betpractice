import { useState } from "react";
import { access, cloud, shared } from "../data/cloud";
import { usage } from "../data/tiered";

/** Reglas de Firebase que permiten compartir los datos bajados entre las personas habilitadas. */
export const SHARED_RULES = `    // betpractice: datos de API-Football compartidos (partidos, temporadas y cuotas)
    // entre el dueño y las personas habilitadas en betpractice.
    function cuotasRealesHabilitado() {
      return tanoOwner() || (request.auth != null
        && get(/databases/$(database)/documents/acceso_tanoapp/$(request.auth.uid)).data.get('cuotasreales', false) == true);
    }
    match /cuotasreales_cache/{key} {
      allow read: if cuotasRealesHabilitado();
      allow create, update: if cuotasRealesHabilitado()
        && request.resource.data.keys().hasOnly(['v', 't', 'by', 'n'])
        && request.resource.data.v is string
        && request.resource.data.by == request.auth.uid;
    }
`;

export default function SharedPanel() {
  const [copied, setCopied] = useState(false);
  if (!cloud.user) {
    return (
      <>
        <h4>Datos compartidos</h4>
        <p className="muted small">Entrá con Google para usar los partidos y cuotas que ya bajaron las demás personas (sin gastar consultas).</p>
      </>
    );
  }
  const isOwner = access.state === "owner";
  return (
    <>
      <h4>Datos compartidos</h4>
      {shared.disabled ? (
        <p className="tg-no">⚠ Todavía no se pueden compartir: {isOwner ? "falta publicar las reglas de Firebase (abajo)." : "el dueño tiene que publicar las reglas de Firebase."}</p>
      ) : (
        <p className="ok-msg small">✔ Activo: lo que baja cualquiera de ustedes (partidos, historiales y cuotas) queda en la nube y los demás no gastan consultas.</p>
      )}
      <p className="muted small">
        En esta sesión: <b>{usage.shared}</b> datos desde la nube compartida · <b>{usage.local}</b> de este dispositivo · <b>{usage.api}</b> pedidos a API-Football.
      </p>
      {isOwner && shared.disabled && (
        <div className="rules-box">
          <p className="small">
            <b>Una sola vez:</b> Firebase (proyecto <b>appuestasclaude</b>) → <b>Firestore Database</b> → pestaña <b>Reglas</b>.
            Pegá este texto <b>justo debajo de la función <code>tanoOwner()</code></b> (la que termina en <code>email_verified == true;</code> y <code>{"}"}</code>),
            sin borrar nada, y tocá <b>Publicar</b>. Después recargá betpractice.
          </p>
          <pre>{SHARED_RULES}</pre>
          <button onClick={async () => { try { await navigator.clipboard.writeText(SHARED_RULES); setCopied(true); } catch { setCopied(false); } }}>
            {copied ? "✔ Copiado" : "Copiar reglas"}
          </button>
        </div>
      )}
    </>
  );
}
