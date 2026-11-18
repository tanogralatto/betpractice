import { useEffect, useMemo, useState } from "react";
import { api, Catalog, Filters, LeagueNode, Preset, PrematchResponse, Row, UserProfile } from "../api";
import { CheckList, LeagueTree, Section } from "../components/common";
import FiltersDialog, { countFilters } from "../components/FiltersDialog";
import MarketPicker from "../components/MarketPicker";
import { OddsModal, SampleModal, TeamMatchesModal } from "../components/MatchModals";
import Flag from "../components/Flag";

const today = () => new Date().toLocaleDateString("en-CA");
const shift = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() + n);
  return x.toLocaleDateString("en-CA");
};
const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "—" : v.toFixed(d));

/** PPG con color: verde alto, naranja medio, rojo bajo. */
function Ppg({ v }: { v: number | null }) {
  if (v === null || v === undefined) return <span className="ppg-badge none">—</span>;
  return <span className={`ppg-badge ${v >= 2 ? "hi" : v >= 1.3 ? "mid" : "lo"}`}>{v.toFixed(2)}</span>;
}
const BOOK_TAG: Record<string, string> = { bet365: "365", pinnacle: "PIN", "1xbet": "1X" };
function BookTag({ bk, name }: { bk: string | null; name: string }) {
  if (!bk) return <span className="bk-tag none">—</span>;
  return <span className={`bk-tag bk-${bk}`} title={name}>{BOOK_TAG[bk] ?? bk}</span>;
}

export default function PrematchPage({ catalog, leagues: tree, profiles, openSettings }: {
  catalog: Catalog; leagues: LeagueNode[]; profiles: UserProfile[]; openSettings: () => void;
}) {
  const active = profiles.find((p) => p.is_active) ?? profiles[0];
  const [profileId, setProfileId] = useState<number>(active.id);
  const profile = profiles.find((p) => p.id === profileId) ?? active;

  const [date, setDate] = useState(today());
  const [leagues, setLeagues] = useState<number[]>(profile.fav_leagues);
  const [markets, setMarkets] = useState<string[]>(profile.fav_markets);
  const [stats, setStats] = useState<string[]>(profile.fav_stats);
  const [streaks, setStreaks] = useState<string[]>(profile.fav_streaks);
  const [bookmaker, setBookmaker] = useState(profile.fav_bookmakers[0] ?? "best");
  const [hide, setHide] = useState(false);
  const [sort, setSort] = useState("time");
  const [filters, setFilters] = useState<Filters>({});
  const [data, setData] = useState<PrematchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false); // solo en celular
  const [tick, setTick] = useState(0); // llegan datos nuevos (historiales, cuotas)
  const [loadAll, setLoadAll] = useState<boolean | "always">(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = api.onChange(() => { clearTimeout(t); t = setTimeout(() => setTick((x) => x + 1), 500); });
    return () => { off(); clearTimeout(t); };
  }, []);
  useEffect(() => setLoadAll(false), [date]);
  const [sampleRow, setSampleRow] = useState<Row | null>(null);
  const [oddsRow, setOddsRow] = useState<Row | null>(null);
  const [teamsRow, setTeamsRow] = useState<Row | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetSel, setPresetSel] = useState<number | "">("");

  // Al cambiar de perfil se cargan sus favoritos
  useEffect(() => {
    setLeagues(profile.fav_leagues);
    setMarkets(profile.fav_markets);
    setStats(profile.fav_stats);
    setStreaks(profile.fav_streaks);
    setBookmaker(profile.fav_bookmakers[0] ?? "best");
  }, [profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { api.presets().then(setPresets); }, []);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api.prematch({ date, profile_id: profileId, leagues, markets, stats, streaks, bookmaker, hide_without_odds: hide, sort, filters, load_all: loadAll })
        .then((d) => { setData(d); setErr(""); })
        .catch((e) => setErr(e.message))
        .finally(() => setLoading(false));
    }, 150);
    return () => clearTimeout(t);
  }, [date, profileId, leagues, markets, stats, streaks, bookmaker, hide, sort, filters, tick, loadAll]);

  const mName = useMemo(() => Object.fromEntries(catalog.markets.map((m) => [m.key, m.name])), [catalog]);
  const sName = useMemo(() => Object.fromEntries(catalog.stats.map((m) => [m.key, m.name])), [catalog]);
  const kName = useMemo(() => Object.fromEntries(catalog.streaks.map((m) => [m.key, m.name])), [catalog]);
  const bkName = (k: string | null) => catalog.bookmakers.find((b) => b.key === k)?.name ?? "";
  const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));
  const nFilters = countFilters(filters);
  // columnas: tarjeta del partido, un bloque por mercado/estadística/racha y acciones
  const gridCols = `minmax(260px, 330px) ${markets.map(() => "minmax(150px, 180px)").join(" ")} ${[...stats, ...streaks].map(() => "minmax(110px, 140px)").join(" ")} 1fr`;

  const presetConfig = () => ({ leagues, markets, stats, streaks, bookmaker, hide_without_odds: hide, sort, filters });
  const loadPreset = (p: Preset) => {
    const c = p.config;
    setLeagues(c.leagues ?? []); setMarkets(c.markets ?? []); setStats(c.stats ?? []); setStreaks(c.streaks ?? []);
    setBookmaker(c.bookmaker ?? "best"); setHide(!!c.hide_without_odds); setSort(c.sort ?? "time"); setFilters(c.filters ?? {});
  };
  const favBookmakers = [...profile.fav_bookmakers, ...catalog.bookmakers.map((b) => b.key).filter((k) => !profile.fav_bookmakers.includes(k))];

  return (
    <div className="prematch">
      <div className="datebar">
        <button onClick={() => setDate(shift(date, -1))}>◀</button>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button onClick={() => setDate(shift(date, 1))}>▶</button>
        <button className={date === today() ? "on" : ""} onClick={() => setDate(today())}>Hoy</button>
        {data?.mode === "api" && (
          <button title="Volver a pedir partidos y cuotas del día" disabled={refreshing}
            onClick={async () => { setRefreshing(true); try { await api.refresh(date); } finally { setRefreshing(false); setTick((x) => x + 1); } }}>
            {refreshing ? "Actualizando…" : "↻ Actualizar"}
          </button>
        )}
        <div className="chips">
          <span className={`chip ${!leagues.length ? "on" : ""}`} onClick={() => setLeagues([])}>Todos <b>{data?.total ?? 0}</b></span>
          <span className={`chip ${profile.fav_leagues.length && sameSet(leagues, profile.fav_leagues) ? "on" : ""}`}
            onClick={() => setLeagues(profile.fav_leagues)}>★ Favoritos <b>{data?.favorites_count ?? 0}</b></span>
          {data?.countries.map((c) => (
            <span key={c.country} className={`chip ${sameSet(leagues, c.league_ids) ? "on" : ""}`} onClick={() => setLeagues(c.league_ids)}>
              <Flag flag={c.flag} /> {c.country} <b>{c.count}</b>
            </span>
          ))}
        </div>
      </div>

      <div className="layout">
        <button className="mobile-only block" onClick={() => setPanelOpen(!panelOpen)}>
          {panelOpen ? "▴ Ocultar opciones" : "⚙ Opciones: mercados, filtros, perfil…"}
        </button>
        <aside className={`sidebar ${panelOpen ? "open" : ""}`}>
          <Section title="Ligas" open={false}><LeagueTree tree={tree} value={leagues} onChange={setLeagues} /></Section>
          <Section title={`Mercados (${markets.length})`}>
            <MarketPicker catalog={catalog} value={markets} onChange={setMarkets} favorites={profile.fav_markets} />
          </Section>
          <Section title={`Estadísticas (${stats.length}/3)`} open={false}>
            <CheckList items={catalog.stats} value={stats} onChange={setStats} max={3} />
          </Section>
          <Section title={`Rachas (${streaks.length}/3)`} open={false}>
            <CheckList items={catalog.streaks} value={streaks} onChange={setStreaks} max={3} />
          </Section>
          <Section title="Casa de apuestas">
            <select value={bookmaker} onChange={(e) => setBookmaker(e.target.value)}>
              {favBookmakers.map((k) => <option key={k} value={k}>{bkName(k)}</option>)}
            </select>
            <label className="switch"><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> Ocultar partidos sin cuota del mercado principal</label>
          </Section>
          <Section title="Ordenar">
            {["value", "real", "book"].includes(sort) && markets[0] && <div className="muted small">Según {mName[markets[0]]} (mercado principal)</div>}
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="time">Por hora</option>
              <option value="league">Por liga</option>
              <option value="ppg_home">PPG local</option>
              <option value="ppg_away">PPG visitante</option>
              <option value="value">Valor % (mayor primero)</option>
              <option value="real">Cuota real (menor primero)</option>
              <option value="book">Cuota de la casa (mayor primero)</option>
            </select>
          </Section>
          <Section title="Perfil">
            <select value={profileId} onChange={(e) => setProfileId(Number(e.target.value))}>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_active ? " (activo)" : ""}</option>)}
            </select>
            {profile.real_odds_profile && <div className="muted small">Cuota real: {profile.real_odds_profile.name}</div>}
          </Section>
          <Section title="Presets" open={false}>
            <div className="row">
              <select value={presetSel} onChange={(e) => setPresetSel(e.target.value ? Number(e.target.value) : "")}>
                <option value="">— elegir —</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button disabled={presetSel === ""} onClick={() => { const p = presets.find((x) => x.id === presetSel); if (p) loadPreset(p); }}>Cargar</button>
              <button className="ghost" disabled={presetSel === ""} onClick={async () => {
                await api.deletePreset(presetSel as number); setPresetSel(""); setPresets(await api.presets());
              }}>🗑</button>
            </div>
            <div className="row">
              <input placeholder="Nombre del preset" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
              <button disabled={!presetName.trim()} onClick={async () => {
                const p = await api.savePreset(presetName.trim(), presetConfig());
                setPresets(await api.presets()); setPresetSel(p.id); setPresetName("");
              }}>Guardar</button>
            </div>
          </Section>
          <button className="primary block" onClick={() => setShowFilters(true)}>
            ＋ Añadir filtros {nFilters > 0 && <span className="badge">{nFilters}</span>}
          </button>
          {nFilters > 0 && <button className="link" onClick={() => setFilters({})}>Quitar filtros</button>}
        </aside>

        <main className="content">
          <div className="summary">
            {data && <>Mostrando <b>{data.shown}</b> partidos en <b>{data.shown_leagues}</b> ligas (de un total de {data.total} partidos en {data.total_leagues} ligas)</>}
            {loading && <span className="muted"> · calculando…</span>}
            {!!data?.loading && <span className="muted"> · bajando datos de API-Football ({data.loading})…</span>}
            {data && <span className="muted"> · perfil {data.profile.name}</span>}
          </div>
          {err && <div className="error">{err}</div>}
          {data?.errors?.map((e) => <div key={e} className="error">API-Football: {e}</div>)}
          {data?.mode === "demo" && (
            <div className="notice">
              Estás viendo <b>datos de prueba</b>. Para ver los partidos reales de cada día, cargá tu clave de API-Football en{" "}
              <button className="link" onClick={openSettings}>⚙ Ajustes</button>.
            </div>
          )}
          {!!data?.pending_leagues && (
            <div className="notice">
              Hay <b>{data.pending_leagues}</b> ligas que todavía no se bajaron. Bajarlas todas gasta ≈{data.pending_calls} consultas
              de API-Football (una sola vez: después quedan guardadas en este dispositivo).
              <div className="row">
                <button onClick={() => setLoadAll(true)}>Calcular todas ahora</button>
                <button onClick={() => setLoadAll("always")}>Calcular siempre todas (no volver a preguntar)</button>
              </div>
              <div className="small">O elegí tus ligas favoritas en <b>Perfil → Favoritos · Ligas</b> y tocá el chip <b>★ Favoritos</b>.</div>
            </div>
          )}
          <div className="matches" style={{ ["--cols" as any]: gridCols }}>
            <div className="m-head">
              <span>Partido</span>
              {markets.map((k, i) => <span key={k} className={i === 0 ? "main" : ""}>{mName[k] ?? k}</span>)}
              {stats.map((k) => <span key={k}>{sName[k]}</span>)}
              {streaks.map((k) => <span key={k}>{kName[k]}</span>)}
              <span></span>
            </div>
            {data?.rows.map((r) => (
              <div className="m-row" key={r.id}>
                <div className="m-card">
                  <div className="m-card-h">
                    <span className="m-league"><Flag flag={r.league.flag} title={r.league.country} /> <b>{r.league.name}</b></span>
                    {r.score
                      ? <span className="score" title={`Entretiempo ${r.score.ht[0]}-${r.score.ht[1]}`}>{r.score.ft[0]}-{r.score.ft[1]} <span className="muted small">({r.score.ht[0]}-{r.score.ht[1]})</span></span>
                      : <b className="m-time">{r.kickoff.slice(11, 16)}</b>}
                  </div>
                  <div className="m-team"><span>{r.home.name}</span><Ppg v={r.home.ppg} /></div>
                  <div className="m-vs">vs</div>
                  <div className="m-team"><span>{r.away.name}</span><Ppg v={r.away.ppg} /></div>
                  <div className="m-country muted small">{r.league.country}</div>
                </div>
                {markets.map((k, i) => {
                  const c = r.markets[k];
                  return (
                    <div key={k} className="m-block m-odds">
                      <span className={`m-title ${i === 0 ? "main" : ""}`}>{mName[k] ?? k}</span>
                      {r.pending ? <span className="muted">calculando…</span> : (
                        <>
                          <div title={c ? `${c.hits} aciertos de ${c.n} partidos` : ""}>
                            <span className="r-badge">R</span> <span className="m-real">{fmt(c?.real)}</span> <span className="muted small">({c?.n ?? 0})</span>
                          </div>
                          <div>
                            <BookTag bk={c?.bookmaker ?? null} name={bkName(c?.bookmaker ?? null)} /> {fmt(c?.book)}{" "}
                            {c?.value != null && <span className={`m-val ${c.value > 0 ? "pos" : c.value < 0 ? "neg" : ""}`}>{c.value > 0 ? "+" : ""}{c.value.toFixed(1)}%</span>}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
                {stats.map((k) => {
                  const st = r.stats[k];
                  return (
                    <div key={k} className="m-block">
                      <span className="m-title">{sName[k]}</span>
                      <div className="m-mini"><span>L</span><b>{fmt(st?.home)}</b><span>V</span><b>{fmt(st?.away)}</b><span>AVG</span><b>{fmt(st?.avg)}</b></div>
                    </div>
                  );
                })}
                {streaks.map((k) => (
                  <div key={k} className="m-block">
                    <span className="m-title">{kName[k]}</span>
                    <div className="m-mini"><span>L</span><b>{r.streaks[k]?.home ?? "—"}</b><span>V</span><b>{r.streaks[k]?.away ?? "—"}</b></div>
                  </div>
                ))}
                <div className="m-actions">
                  <button title="Partidos jugados de cada equipo" onClick={() => setTeamsRow(r)}>Partidos</button>
                  <button title="Partidos usados en la cuota real" onClick={() => setSampleRow(r)}>Muestra</button>
                  <button title="Cuotas de todas las casas" onClick={() => setOddsRow(r)}>Cuotas</button>
                </div>
              </div>
            ))}
            {data && !data.rows.length && <div className="empty">No hay partidos que cumplan los filtros para esta fecha.</div>}
          </div>
        </main>
      </div>

      {showFilters && (
        <FiltersDialog catalog={catalog} markets={markets} stats={stats} streaks={streaks} value={filters}
          onApply={setFilters} onClose={() => setShowFilters(false)} />
      )}
      {sampleRow && <SampleModal row={sampleRow} markets={markets} profileId={profileId} catalog={catalog} onClose={() => setSampleRow(null)} />}
      {teamsRow && <TeamMatchesModal row={teamsRow} markets={markets} profileId={profileId} catalog={catalog} onClose={() => setTeamsRow(null)} />}
      {oddsRow && <OddsModal row={oddsRow} markets={markets} catalog={catalog} onClose={() => setOddsRow(null)} />}
    </div>
  );
}
