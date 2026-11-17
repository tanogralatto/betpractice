import { useCallback, useEffect, useState } from "react";
import { api, Catalog, LeagueNode, Meta, UserProfile } from "./api";
import PrematchPage from "./pages/PrematchPage";
import ProfilePage from "./pages/ProfilePage";

type Tab = "prematch" | "profile";

// Link a la acción de GitHub que actualiza los datos (lo completa la publicación automática).
const UPDATE_URL = import.meta.env.VITE_UPDATE_URL as string | undefined;

export default function App() {
  const [tab, setTab] = useState<Tab>("prematch");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [leagues, setLeagues] = useState<LeagueNode[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState("");

  const reloadProfiles = useCallback(async () => setProfiles(await api.profiles()), []);

  useEffect(() => {
    Promise.all([api.catalog(), api.leagues(), api.profiles(), api.meta()])
      .then(([c, l, p, m]) => { setCatalog(c); setLeagues(l); setProfiles(p); setMeta(m); })
      .catch((e) => setError(`No se pudieron cargar los datos: ${e.message}`));
  }, []);

  const active = profiles.find((p) => p.is_active);

  return (
    <div className="app">
      <header className="topnav">
        <div className="brand">⚽ Cuotas reales</div>
        <nav>
          <button className={tab === "prematch" ? "on" : ""} onClick={() => setTab("prematch")}>Pre partido</button>
          <button className={tab === "profile" ? "on" : ""} onClick={() => setTab("profile")}>Perfil</button>
        </nav>
        <div className="muted small">
          {active && <>Perfil activo: <b>{active.name}</b></>}
          {meta && (
            <span className="tag" title={meta.leagues_synced?.join("\n")}>
              {meta.provider === "api_football" ? "Datos reales (API-Football)" : "Datos de prueba"} · actualizados{" "}
              {new Date(meta.generated_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {UPDATE_URL && <a className="tag link-tag" href={UPDATE_URL} target="_blank" rel="noreferrer">↻ Actualizar datos</a>}
        </div>
      </header>
      {error && <div className="error">{error}</div>}
      {catalog && profiles.length > 0 && (tab === "prematch" ? (
        <PrematchPage catalog={catalog} leagues={leagues} profiles={profiles} />
      ) : (
        <ProfilePage catalog={catalog} leagues={leagues} profiles={profiles} reload={reloadProfiles} />
      ))}
    </div>
  );
}
