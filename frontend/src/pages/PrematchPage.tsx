import { useEffect, useMemo, useState } from "react";
import { api, Catalog, Filters, LeagueNode, Preset, PrematchResponse, Row, UserProfile } from "../api";
import { CheckList, LeagueTree, Section } from "../components/common";
import FiltersDialog, { countFilters } from "../components/FiltersDialog";
import MarketPicker from "../components/MarketPicker";
import { OddsModal, SampleModal } from "../components/MatchModals";

const today = () => new Date().toLocaleDateString("en-CA");
const shift = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() + n);
  return x.toLocaleDateString("en-CA");
};
const SUBFLAGS: Record<string, string> = {
  "GB-ENG": "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
  "GB-SCT": "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
  "GB-WLS": "🏴\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}",
};
const flag = (code: string | null) => {
  if (!code) return "🌍";
  if (SUBFLAGS[code.toUpperCase()]) return SUBFLAGS[code.toUpperCase()];
  const c = code.slice(0, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== "EU" ? String.fromCodePoint(...[...c].map((x) => 127397 + x.charCodeAt(0))) : "🌍";
};
const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "—" : v.toFixed(d));

export default function PrematchPage({ catalog, leagues: tree, profiles }: { catalog: Catalog; leagues: LeagueNode[]; profiles: UserProfile[] }) {
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
  const [sampleRow, setSampleRow] = useState<Row | null>(null);
  const [oddsRow, setOddsRow] = useState<Row | null>(null);
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
      api.prematch({ date, profile_id: profileId, leagues, markets, stats, streaks, bookmaker, hide_without_odds: hide, sort, filters })
        .then((d) => { setData(d); setErr(""); })
        .catch((e) => setErr(e.message))
        .finally(() => setLoading(false));
    }, 150);
    return () => clearTimeout(t);
  }, [date, profileId, leagues, markets, stats, streaks, bookmaker, hide, sort, filters]);

  const mName = useMemo(() => Object.fromEntries(catalog.markets.map((m) => [m.key, m.name])), [catalog]);
  const sName = useMemo(() => Object.fromEntries(catalog.stats.map((m) => [m.key, m.name])), [catalog]);
  const kName = useMemo(() => Object.fromEntries(catalog.streaks.map((m) => [m.key, m.name])), [catalog]);
  const bkName = (k: string | null) => catalog.bookmakers.find((b) => b.key === k)?.name ?? "";
  const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));
  const nFilters = countFilters(filters);

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
        <div className="chips">
          <span className={`chip ${!leagues.length ? "on" : ""}`} onClick={() => setLeagues([])}>Todos <b>{data?.total ?? 0}</b></span>
          <span className={`chip ${profile.fav_leagues.length && sameSet(leagues, profile.fav_leagues) ? "on" : ""}`}
            onClick={() => setLeagues(profile.fav_leagues)}>★ Favoritos <b>{data?.favorites_count ?? 0}</b></span>
          {data?.countries.map((c) => (
            <span key={c.country} className={`chip ${sameSet(leagues, c.league_ids) ? "on" : ""}`} onClick={() => setLeagues(c.league_ids)}>
              {flag(c.code)} {c.country} <b>{c.count}</b>
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
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="time">Por hora</option>
              <option value="league">Por liga</option>
              <option value="ppg_home">PPG local</option>
              <option value="ppg_away">PPG visitante</option>
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
            {data && <span className="muted"> · perfil {data.profile.name}</span>}
          </div>
          {err && <div className="error">{err}</div>}
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th rowSpan={2}>Liga</th>
                  <th rowSpan={2}>Hora</th>
                  <th rowSpan={2} className="l">Partido</th>
                  {markets.map((k, i) => <th key={k} colSpan={3} className={`grp ${i === 0 ? "main" : ""}`}>{mName[k] ?? k}</th>)}
                  {stats.map((k) => <th key={k} colSpan={3} className="grp">{sName[k]}</th>)}
                  {streaks.map((k) => <th key={k} colSpan={2} className="grp">{kName[k]}</th>)}
                  <th rowSpan={2}></th>
                </tr>
                <tr>
                  {markets.map((k) => [<th key={k + "r"} title="Cuota real (n)">Real</th>, <th key={k + "b"}>Casa</th>, <th key={k + "v"}>Valor</th>])}
                  {stats.map((k) => [<th key={k + "l"}>L</th>, <th key={k + "v"}>V</th>, <th key={k + "a"}>AVG</th>])}
                  {streaks.map((k) => [<th key={k + "l"}>L</th>, <th key={k + "v"}>V</th>])}
                </tr>
              </thead>
              <tbody>
                {data?.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="small"><span title={r.league.country}>{flag(r.league.country_code)}</span> {r.league.name}</td>
                    <td className="c">
                      {r.score ? (
                        <span className="score" title={`HT ${r.score.ht[0]}-${r.score.ht[1]}`}>{r.score.ft[0]}-{r.score.ft[1]} <span className="muted small">({r.score.ht[0]}-{r.score.ht[1]})</span></span>
                      ) : r.kickoff.slice(11, 16)}
                    </td>
                    <td className="l teams">
                      <div>{r.home.name} <span className="ppg">{fmt(r.home.ppg)}</span></div>
                      <div>{r.away.name} <span className="ppg">{fmt(r.away.ppg)}</span></div>
                    </td>
                    {markets.map((k) => {
                      const c = r.markets[k];
                      return [
                        <td key={k + "r"} className="c real" title={c ? `${c.hits}/${c.n} aciertos` : ""}>{fmt(c?.real)}<span className="n">{c?.n ?? 0}</span></td>,
                        <td key={k + "b"} className="c" title={c?.bookmaker ? bkName(c.bookmaker) : ""}>{fmt(c?.book)}</td>,
                        <td key={k + "v"} className={`c ${c?.value == null ? "" : c.value > 0 ? "pos" : c.value < 0 ? "neg" : ""}`}>
                          {c?.value == null ? "—" : `${c.value > 0 ? "+" : ""}${c.value.toFixed(1)}%`}
                        </td>,
                      ];
                    })}
                    {stats.map((k) => {
                      const s = r.stats[k];
                      return [
                        <td key={k + "l"} className="c">{fmt(s?.home)}</td>,
                        <td key={k + "v"} className="c">{fmt(s?.away)}</td>,
                        <td key={k + "a"} className="c b">{fmt(s?.avg)}</td>,
                      ];
                    })}
                    {streaks.map((k) => [
                      <td key={k + "l"} className="c">{r.streaks[k]?.home ?? "—"}</td>,
                      <td key={k + "v"} className="c">{r.streaks[k]?.away ?? "—"}</td>,
                    ])}
                    <td className="actions">
                      <button title="Ver muestra" onClick={() => setSampleRow(r)}>Muestra</button>
                      <button title="Cuotas de todas las casas" onClick={() => setOddsRow(r)}>Cuotas</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data && !data.rows.length && <div className="empty">No hay partidos que cumplan los filtros para esta fecha.</div>}
          </div>
        </main>
      </div>

      {showFilters && (
        <FiltersDialog catalog={catalog} markets={markets} stats={stats} streaks={streaks} value={filters}
          onApply={setFilters} onClose={() => setShowFilters(false)} />
      )}
      {sampleRow && <SampleModal row={sampleRow} markets={markets} profileId={profileId} catalog={catalog} onClose={() => setSampleRow(null)} />}
      {oddsRow && <OddsModal row={oddsRow} markets={markets} catalog={catalog} onClose={() => setOddsRow(null)} />}
    </div>
  );
}
