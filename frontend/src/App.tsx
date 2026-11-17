import { useCallback, useEffect, useState } from "react";
import { api, Catalog, LeagueNode, UserProfile } from "./api";
import PrematchPage from "./pages/PrematchPage";
import ProfilePage from "./pages/ProfilePage";

type Tab = "prematch" | "profile";

export default function App() {
  const [tab, setTab] = useState<Tab>("prematch");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [leagues, setLeagues] = useState<LeagueNode[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [provider, setProvider] = useState("");
  const [error, setError] = useState("");

  const reloadProfiles = useCallback(async () => setProfiles(await api.profiles()), []);

  useEffect(() => {
    Promise.all([api.catalog(), api.leagues(), api.profiles(), api.health()])
      .then(([c, l, p, h]) => { setCatalog(c); setLeagues(l); setProfiles(p); setProvider(h.provider); })
      .catch((e) => setError(`No se pudo conectar con el backend (${e.message}). ¿Está corriendo en el puerto 8000?`));
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
          {provider && <span className="tag">datos: {provider === "api_football" ? "API-Football" : "prueba (seed)"}</span>}
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
