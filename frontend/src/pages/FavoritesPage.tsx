import { useEffect, useMemo, useState } from "react";
import { api, Catalog, Row } from "../api";
import type { FavSnap, FavoritesResponse } from "../engine/local";
import MatchList from "../components/MatchList";
import { SampleModal, TeamMatchesModal } from "../components/MatchModals";
import { Tabs } from "../components/common";

const fmtDay = (d: string) => {
  const t = new Date(`${d}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const fmtSaved = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtShort = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
const money = (v: number) => (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("es-AR", { maximumFractionDigits: 0 });
const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

/** Ganancia de un partido apostado: monto × (cuota − 1) si se cumplió, −monto si no. */
export function profit(f: FavSnap): number | null {
  if (!f.stake || !f.result || f.result.hit === null || f.result.hit === undefined) return null;
  return f.result.hit ? f.stake * ((f.odds_taken ?? 1) - 1) : -f.stake;
}

/** Monto y cuota de la apuesta (se guarda al salir del campo). */
function BetBox({ snap, compact }: { snap: FavSnap; compact?: boolean }) {
  const [stake, setStake] = useState(snap.stake != null ? String(snap.stake) : "");
  const [odds, setOdds] = useState(snap.odds_taken != null ? String(snap.odds_taken) : "");
  useEffect(() => {
    setStake(snap.stake != null ? String(snap.stake) : "");
    setOdds(snap.odds_taken != null ? String(snap.odds_taken) : "");
  }, [snap.stake, snap.odds_taken]);
  const save = () => {
    const s = stake.trim() === "" ? null : Math.max(0, Number(stake.replace(",", ".")));
    const o = odds.trim() === "" ? null : Number(odds.replace(",", "."));
    if ((s ?? null) !== (snap.stake ?? null) || (o ?? null) !== (snap.odds_taken ?? null))
      api.setBet(snap.id, Number.isFinite(s as number) ? s : null, Number.isFinite(o as number) && (o as number) > 1 ? o : null);
  };
  return (
    <span className={`bet-box ${compact ? "compact" : ""}`}>
      {!compact && <span className="muted">Aposté</span>}
      <span className="bet-in">$<input inputMode="decimal" placeholder="monto" value={stake} onChange={(e) => setStake(e.target.value)} onBlur={save} /></span>
      <span className="muted">a</span>
      <input className="bet-odds" inputMode="decimal" placeholder="cuota" value={odds} onChange={(e) => setOdds(e.target.value)} onBlur={save} />
    </span>
  );
}

type Period = "7" | "30" | "all";

function History({ items, catalog }: { items: FavSnap[]; catalog: Catalog }) {
  const [period, setPeriod] = useState<Period>("30");
  const [onlyBets, setOnlyBets] = useState(false);
  const mName = (k: string | null) => catalog.markets.find((m) => m.key === k)?.name ?? k ?? "";
  const since = period === "all" ? "" : new Date(Date.now() - Number(period) * 864e5).toLocaleDateString("en-CA");
  const list = items.filter((x) => (!since || x.date >= since) && (!onlyBets || (x.stake ?? 0) > 0));

  const summarize = (xs: FavSnap[]) => {
    const known = xs.filter((x) => x.result?.hit !== null && x.result?.hit !== undefined);
    const won = known.filter((x) => x.result!.hit).length;
    const bets = xs.filter((x) => (x.stake ?? 0) > 0 && profit(x) !== null);
    const staked = bets.reduce((a, x) => a + (x.stake ?? 0), 0);
    const gain = bets.reduce((a, x) => a + (profit(x) ?? 0), 0);
    return { n: xs.length, known: known.length, won, rate: known.length ? (100 * won) / known.length : null, bets: bets.length, staked, gain, roi: staked ? (100 * gain) / staked : null };
  };
  const total = summarize(list);
  const groupBy = (key: (x: FavSnap) => string) => {
    const m = new Map<string, FavSnap[]>();
    for (const x of list) { const k = key(x); m.set(k, [...(m.get(k) ?? []), x]); }
    return [...m.entries()].map(([k, xs]) => ({ k, ...summarize(xs) })).sort((a, b) => b.n - a.n);
  };
  const range = (x: FavSnap) => {
    const r = x.real;
    if (r == null) return "sin dato";
    return r < 1.3 ? "menos de 1.30" : r < 1.5 ? "1.30 a 1.49" : r < 1.8 ? "1.50 a 1.79" : "1.80 o más";
  };
  const month = (x: FavSnap) => {
    const t = new Date(`${x.date}T12:00:00`).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  const Breakdown = ({ title, rows }: { title: string; rows: ReturnType<typeof groupBy> }) => (
    <div className="hist-box">
      <h4>{title}</h4>
      <table className="grid compact">
        <thead><tr><th className="l"></th><th>Partidos</th><th>Aciertos</th><th>Apostado</th><th>Ganancia</th><th>ROI</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k}>
              <td className="l wrap">{r.k}</td><td className="c">{r.n}</td>
              <td className="c">{r.rate == null ? "—" : `${r.won}/${r.known} (${Math.round(r.rate)}%)`}</td>
              <td className="c">{r.bets ? money(r.staked) : "—"}</td>
              <td className={`c ${r.gain > 0 ? "pos" : r.gain < 0 ? "neg" : ""}`}>{r.bets ? money(r.gain) : "—"}</td>
              <td className={`c ${(r.roi ?? 0) > 0 ? "pos" : (r.roi ?? 0) < 0 ? "neg" : ""}`}>{r.roi == null ? "—" : pct(r.roi)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <div className="row">
        <Tabs value={period} onChange={setPeriod} items={[["7", "Últimos 7 días"], ["30", "Últimos 30 días"], ["all", "Todo"]]} />
        <label className="switch"><input type="checkbox" checked={onlyBets} onChange={(e) => setOnlyBets(e.target.checked)} /> Solo los que aposté</label>
      </div>
      <div className="kpis">
        <div><span>Partidos</span><b>{total.n}</b></div>
        <div><span>Aciertos</span><b>{total.rate == null ? "—" : `${Math.round(total.rate)}%`}</b><small>{total.won} de {total.known}</small></div>
        <div><span>Apostado</span><b>{money(total.staked)}</b><small>{total.bets} apuestas</small></div>
        <div><span>Ganancia</span><b className={total.gain > 0 ? "pos" : total.gain < 0 ? "neg" : ""}>{money(total.gain)}</b></div>
        <div><span>ROI</span><b className={(total.roi ?? 0) > 0 ? "pos" : (total.roi ?? 0) < 0 ? "neg" : ""}>{total.roi == null ? "—" : pct(total.roi)}</b></div>
      </div>
      {!list.length && <div className="empty">No hay partidos terminados en este período.</div>}
      {list.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="grid compact hist-table">
              <thead><tr><th>Fecha</th><th className="l">Partido</th><th>Mercado</th><th>Real</th><th>Casa</th><th>Resultado</th><th></th><th>Apuesta</th><th>Ganancia</th><th></th></tr></thead>
              <tbody>
                {list.map((x) => {
                  const g = profit(x);
                  return (
                    <tr key={x.id}>
                      <td>{fmtShort(x.date)}</td>
                      <td className="l wrap">{x.home} vs {x.away}<span className="muted small"> · {x.league}</span></td>
                      <td className="small">{mName(x.market)}</td>
                      <td className="c">{x.real?.toFixed(2) ?? "—"}</td>
                      <td className="c">{x.book?.toFixed(2) ?? "—"}</td>
                      <td className="c">{x.result!.ft[0]}-{x.result!.ft[1]} <span className="muted">({x.result!.ht[0]}-{x.result!.ht[1]})</span></td>
                      <td className={`c ${x.result!.hit ? "pos" : x.result!.hit === false ? "neg" : "muted"}`}>{x.result!.hit ? "✔" : x.result!.hit === false ? "✘" : "?"}</td>
                      <td><BetBox snap={x} compact /></td>
                      <td className={`c ${g == null ? "muted" : g > 0 ? "pos" : g < 0 ? "neg" : ""}`}>{g == null ? "—" : money(g)}</td>
                      <td><button className="ghost" title="Borrar del historial" onClick={() => { if (confirm("¿Borrar este partido del historial?")) api.deleteFavorite(x.id); }}>🗑</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="hist-grid">
            <Breakdown title="Por rango de cuota real" rows={groupBy(range)} />
            <Breakdown title="Por liga" rows={groupBy((x) => x.league)} />
            <Breakdown title="Por mes" rows={groupBy(month)} />
          </div>
        </>
      )}
    </div>
  );
}

export default function FavoritesPage({ catalog, onCount }: { catalog: Catalog; onCount: (n: number) => void }) {
  const [tab, setTab] = useState<"next" | "hist">("next");
  const [data, setData] = useState<FavoritesResponse | null>(null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [teamsRow, setTeamsRow] = useState<Row | null>(null);
  const [sampleRow, setSampleRow] = useState<Row | null>(null);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = api.onChange(() => { clearTimeout(t); t = setTimeout(() => setTick((x) => x + 1), 500); });
    const onStore = () => setTick((x) => x + 1);
    window.addEventListener("cr:favs", onStore);
    return () => { off(); clearTimeout(t); window.removeEventListener("cr:favs", onStore); };
  }, []);
  useEffect(() => {
    api.favorites().then((d) => { setData(d); setErr(""); onCount(d.rows.length + d.missing.length); }).catch((e) => setErr(e.message));
  }, [tick, onCount]);

  const mName = (k: string | null) => catalog.markets.find((m) => m.key === k)?.name ?? k ?? "";
  const refresh = () => setTick((x) => x + 1);
  const toggle = (r: Row) => { api.toggleFavorite(r, data?.markets[0]); refresh(); };
  const days = useMemo(() => (data ? [...new Set(data.rows.map((r) => r.kickoff.slice(0, 10)))] : []), [data]);

  const extra = (r: Row) => {
    const s = data?.saved[r.id];
    if (!s) return null;
    return (
      <div className="fav-extra">
        <span className="muted">
          Guardado {fmtSaved(s.saved_at)}{s.market ? ` · ${mName(s.market)}` : ""}: Real <b>{s.real?.toFixed(2) ?? "—"}</b> · Casa <b>{s.book?.toFixed(2) ?? "—"}</b>
          {s.value != null && <> · <span className={s.value > 0 ? "pos" : "neg"}>{pct(s.value)}</span></>}
        </span>
        <BetBox snap={s} />
      </div>
    );
  };

  return (
    <div className="favorites">
      <div className="row-between">
        <h2>★ Mis partidos</h2>
        <Tabs value={tab} onChange={setTab} items={[["next", `Próximos (${data ? data.rows.length + data.missing.length : 0})`], ["hist", `Historial (${data?.history.length ?? 0})`]]} />
      </div>
      {err && <div className="error">{err}</div>}
      {tab === "next" && (
        <>
          {!!data?.loading && <p className="muted">Bajando datos de API-Football…</p>}
          {data && !data.rows.length && !data.missing.length && (
            <div className="empty">No tenés partidos guardados por jugarse. En <b>Pre partido</b> tocá la estrella ☆ de un partido para guardarlo acá.
              Cuando terminan pasan al <b>Historial</b>.</div>
          )}
          {days.map((d) => (
            <section key={d}>
              <h3 className="fav-day">{fmtDay(d)}</h3>
              <MatchList rows={data!.rows.filter((r) => r.kickoff.startsWith(d))} markets={data!.markets} stats={data!.stats} streaks={data!.streaks}
                catalog={catalog} isFav={() => true} onFav={toggle} onTeams={setTeamsRow} onSample={setSampleRow} extra={extra} empty="" />
            </section>
          ))}
          {!!data?.missing.length && (
            <div className="muted small">Sin datos por ahora: {data.missing.map((m) => `${m.home} vs ${m.away} (${m.date})`).join(" · ")}</div>
          )}
        </>
      )}
      {tab === "hist" && data && <History items={data.history} catalog={catalog} />}
      {teamsRow && <TeamMatchesModal row={teamsRow} markets={data?.markets ?? []} profileId={null} catalog={catalog} onClose={() => setTeamsRow(null)} />}
      {sampleRow && <SampleModal row={sampleRow} markets={data?.markets ?? []} profileId={null} catalog={catalog} onClose={() => setSampleRow(null)} />}
    </div>
  );
}
