import { useCallback, useEffect, useState } from "react";
import Settings from "./components/Settings";
import { api, Catalog, LeagueNode, Meta, UserProfile } from "./api";
import PrematchPage from "./pages/PrematchPage";
import ProfilePage from "./pages/ProfilePage";
import FavoritesPage from "./pages/FavoritesPage";
import { access, cloud, initCloud, initGate, onCloud } from "./data/cloud";
import Gate from "./components/Gate";

// En la página publicada solo entran las personas habilitadas; en la compu de desarrollo no se pide.
const GATED = !["localhost", "127.0.0.1"].includes(location.hostname) && import.meta.env.VITE_SIN_ACCESO !== "1";
import { startSync } from "./data/sync";
import { Cache } from "./data/storage";
import { reload as reloadStore } from "./engine/store";

type Tab = "prematch" | "favorites" | "profile";


export default function App() {
  const [tab, setTab] = useState<Tab>("prematch");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [leagues, setLeagues] = useState<LeagueNode[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [favCount, setFavCount] = useState(() => api.favoriteIds().size);
  const [version, setVersion] = useState(0); // cambia al cambiar de clave o de modo

  // cuenta de Google: al entrar o cuando llegan cambios de otro dispositivo se recargan perfiles y Mis partidos
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [accessState, setAccessState] = useState(access.state);
  useEffect(() => {
    startSync(() => { reloadStore(); setVersion((v) => v + 1); setFavCount(api.favoriteIds().size); });
    const off = onCloud(() => { setUserEmail(cloud.user?.email ?? null); setAccessState(access.state); });
    void (GATED ? initGate() : initCloud());
    // limpieza de datos viejos guardados, sin apurar la apertura
    const tPrune = setTimeout(() => { void Cache.prune(); }, 8000);
    return () => { off(); clearTimeout(tPrune); };
  }, []);

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
  if (GATED && accessState !== "owner" && accessState !== "ok") return <Gate />;

  return (
    <div className="app">
      <header className="topnav">
        <div className="brand">⚽ Cuotas reales</div>
        <nav>
          <button className={tab === "prematch" ? "on" : ""} onClick={() => setTab("prematch")}>Pre partido</button>
          <button className={tab === "favorites" ? "on" : ""} onClick={() => { setFavCount(api.favoriteIds().size); setTab("favorites"); }}>
            ★ Mis partidos{favCount > 0 && <span className="badge">{favCount}</span>}
          </button>
          <button className={tab === "profile" ? "on" : ""} onClick={() => setTab("profile")}>Perfil</button>
        </nav>
        <div className="muted small">
          {active && <>Perfil activo: <b>{active.name}</b></>}
          {meta && (
            <span className="tag">
              {meta.provider === "api_football" ? "Datos en vivo (API-Football)" : "Datos de prueba"}
            </span>
          )}
          <button className="ghost settings-btn" onClick={() => setShowSettings(true)} title={userEmail ? `Sincronizado con ${userEmail}` : "Ajustes"}>
            {userEmail ? "☁ " : ""}⚙ Ajustes
          </button>
        </div>
      </header>
      {error && <div className="error">{error}</div>}
      {catalog && profiles.length > 0 && (tab === "prematch" ? (
        <PrematchPage key={version} catalog={catalog} leagues={leagues} profiles={profiles} openSettings={() => setShowSettings(true)}
          onFavCount={setFavCount} />
      ) : tab === "favorites" ? (
        <FavoritesPage key={version} catalog={catalog} onCount={setFavCount} />
      ) : (
        <ProfilePage catalog={catalog} leagues={leagues} profiles={profiles} reload={reloadProfiles} />
      ))}
      {showSettings && <Settings onClose={() => setShowSettings(false)} onChanged={() => setVersion((v) => v + 1)} />}
    </div>
  );
}
