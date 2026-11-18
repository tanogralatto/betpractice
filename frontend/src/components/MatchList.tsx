import type { ReactNode } from "react";
import type { Catalog, Row } from "../api";
import Flag from "./Flag";

const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "—" : v.toFixed(d));

/** PPG con color: verde alto, naranja medio, rojo bajo. */
export function Ppg({ v }: { v: number | null }) {
  if (v === null || v === undefined) return <span className="ppg-badge none">—</span>;
  return <span className={`ppg-badge ${v >= 2 ? "hi" : v >= 1.3 ? "mid" : "lo"}`}>{v.toFixed(2)}</span>;
}
const BOOK_TAG: Record<string, string> = { bet365: "365", pinnacle: "PIN", "1xbet": "1X" };
export function BookTag({ bk, name }: { bk: string | null; name: string }) {
  if (!bk) return <span className="bk-tag none">—</span>;
  return <span className={`bk-tag bk-${bk}`} title={name}>{BOOK_TAG[bk] ?? bk}</span>;
}

/** Lista de partidos (tarjeta + bloques de mercados, estadísticas y rachas). */
export default function MatchList({ rows, markets, stats, streaks, catalog, isFav, onFav, onTeams, onSample, extra, empty }: {
  rows: Row[]; markets: string[]; stats: string[]; streaks: string[]; catalog: Catalog;
  isFav: (id: number) => boolean; onFav: (r: Row) => void; onTeams: (r: Row) => void; onSample: (r: Row) => void;
  extra?: (r: Row) => ReactNode; empty: string;
}) {
  const mName: Record<string, string> = Object.fromEntries(catalog.markets.map((m) => [m.key, m.name]));
  const sName: Record<string, string> = Object.fromEntries(catalog.stats.map((m) => [m.key, m.name]));
  const kName: Record<string, string> = Object.fromEntries(catalog.streaks.map((m) => [m.key, m.name]));
  const bkName = (k: string | null) => catalog.bookmakers.find((b) => b.key === k)?.name ?? "";
  // columnas: tarjeta del partido, un bloque por mercado/estadística/racha y acciones
  const gridCols = `minmax(260px, 330px) ${markets.map(() => "minmax(150px, 180px)").join(" ")} ${[...stats, ...streaks].map(() => "minmax(110px, 140px)").join(" ")} 1fr`;
  return (
          <div className="matches" style={{ ["--cols" as any]: gridCols }}>
            <div className="m-head">
              <span>Partido</span>
              {markets.map((k, i) => <span key={k} className={i === 0 ? "main" : ""}>{mName[k] ?? k}</span>)}
              {stats.map((k) => <span key={k}>{sName[k]}</span>)}
              {streaks.map((k) => <span key={k}>{kName[k]}</span>)}
              <span></span>
            </div>
            {rows.map((r) => (
              <div className="m-row" key={r.id}>
                <div className="m-card">
                  <div className="m-card-h">
                    <span className="m-league"><Flag flag={r.league.flag} title={r.league.country} /> <b>{r.league.name}</b></span>
                    <span className="m-right">
                    <button className={`star ${isFav(r.id) ? "on" : ""}`} title={isFav(r.id) ? "Quitar de Mis partidos" : "Guardar en Mis partidos"}
                      onClick={() => onFav(r)}>{isFav(r.id) ? "★" : "☆"}</button>
                    {r.score
                      ? <span className="score" title={`Entretiempo ${r.score.ht[0]}-${r.score.ht[1]}`}>{r.score.ft[0]}-{r.score.ft[1]} <span className="muted small">({r.score.ht[0]}-{r.score.ht[1]})</span></span>
                      : <b className="m-time">{r.kickoff.slice(11, 16)}</b>}
                    </span>
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
                  <button title="Partidos jugados de cada equipo" onClick={() => onTeams(r)}>Partidos</button>
                  <button title="Partidos usados en la cuota real" onClick={() => onSample(r)}>Muestra</button>
                </div>
                {extra && <div className="m-extra">{extra(r)}</div>}
              </div>
            ))}
            {!rows.length && <div className="empty">{empty}</div>}
          </div>
  );
}
