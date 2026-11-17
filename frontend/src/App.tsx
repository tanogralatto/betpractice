import { useCallback, useEffect, useState } from "react";
import Settings from "./components/Settings";
import { api, Catalog, LeagueNode, Meta, UserProfile } from "./api";
import PrematchPage from "./pages/PrematchPage";
import ProfilePage from "./pages/ProfilePage";

type Tab = "prematch" | "profile";


export default function App() {
  const [tab, setTab] = useState<Tab>("prematch");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [leagues, setLeagues] = useState<LeagueNode[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [version, setVersion] = useState(0); // cambia al cambiar de clave o de modo

  const reloadProfiles = useCallback(async () => setProfiles(await api.profiles()), []);

  useEffect(() => {
    Promise.all([api.catalog(), api.profiles(), api.meta()])
      .then(([c, p, m]) => { setCatalog(c); setProfiles(p); setMeta(m); })
      .catch((e) => setError(`No se pudieron cargar los datos: ${e.message}`));
  }, [version]);
  // las ligas conocidas crecen a medida que se bajan datos
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const upd = () => { clearTimeout(t); t = setTimeout(() => api.leagues().then(setLeagues), 400); };
    upd();
    const off = api.onChange(upd);
    return () => { off(); clearTimeout(t); };
  }, [version]);

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
            <span className="tag">
              {meta.provider === "api_football" ? "Datos en vivo (API-Football)" : "Datos de prueba"}
            </span>
          )}
          <button className="ghost settings-btn" onClick={() => setShowSettings(true)}>⚙ Ajustes</button>
        </div>
      </header>
      {error && <div className="error">{error}</div>}
      {catalog && profiles.length > 0 && (tab === "prematch" ? (
        <PrematchPage key={version} catalog={catalog} leagues={leagues} profiles={profiles} openSettings={() => setShowSettings(true)} />
      ) : (
        <ProfilePage catalog={catalog} leagues={leagues} profiles={profiles} reload={reloadProfiles} />
      ))}
      {showSettings && <Settings onClose={() => setShowSettings(false)} onChanged={() => setVersion((v) => v + 1)} />}
    </div>
  );
}
