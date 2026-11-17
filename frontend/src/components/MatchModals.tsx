import { useEffect, useState } from "react";
import { api, Catalog, OddsResponse, ROLE_LABEL, Row, SampleResponse, SEASONS_LABEL, TeamMatchesResponse } from "../api";
import { Modal } from "./common";

const fmtDate = (s: string) => new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });

export function SampleModal({ row, markets, profileId, catalog, onClose }: {
  row: Row; markets: string[]; profileId: number | null; catalog: Catalog; onClose: () => void;
}) {
  const [market, setMarket] = useState(markets[0] ?? "ou_ht_over_0_5");
  const [data, setData] = useState<SampleResponse | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.sample(row.id, profileId, market).then(setData).catch((e) => setErr(e.message));
  }, [row.id, profileId, market]);
  const name = (k: string) => catalog.markets.find((m) => m.key === k)?.name ?? k;

  return (
    <Modal title={`Muestra · ${row.home.name} vs ${row.away.name}`} onClose={onClose} wide>
      {err && <div className="error">{err}</div>}
      <div className="row-between">
        <select value={market} onChange={(e) => setMarket(e.target.value)}>
          {(markets.length ? markets : [market]).map((k) => <option key={k} value={k}>{name(k)}</option>)}
        </select>
        {data && (
          <div className="small">
            Perfil <b>{data.profile.name}</b> · {SEASONS_LABEL[data.profile.sample]} · Local como {ROLE_LABEL[data.profile.home_as]} · Visitante como {ROLE_LABEL[data.profile.away_as]}
          </div>
        )}
      </div>
      {data && (
        <>
          <p>
            <b>{data.hits}</b> aciertos en <b>{data.n}</b> partidos únicos (local {data.n_home}, visitante {data.n_away}; los enfrentamientos directos cuentan una vez) → cuota real{" "}
            <b>{data.real ?? "—"}</b>
          </p>
          <table className="grid compact">
            <thead><tr><th>Fecha</th><th>Local</th><th>FT</th><th>HT</th><th>Visitante</th><th>Muestra de</th><th>{name(market)}</th></tr></thead>
            <tbody>
              {data.matches.map((m) => (
                <tr key={m.id}>
                  <td>{fmtDate(m.date)}</td>
                  <td className={m.home === row.home.name || m.home === row.away.name ? "b" : ""}>{m.home}</td>
                  <td className="c">{m.ft[0]}-{m.ft[1]}</td>
                  <td className="c muted">{m.ht[0]}-{m.ht[1]}</td>
                  <td className={m.away === row.home.name || m.away === row.away.name ? "b" : ""}>{m.away}</td>
                  <td className="muted small">{m.from === "both" ? "ambos" : m.from === "home" ? "local" : "visitante"}</td>
                  <td className={`c ${m.hit === null ? "muted" : m.hit ? "pos" : "neg"}`}>{m.hit === null ? "sin dato" : m.hit ? "✔ Acierto" : "✘ Fallo"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.matches.length && <p className="muted">Sin partidos en la muestra.</p>}
        </>
      )}
    </Modal>
  );
}

export function OddsModal({ row, markets, catalog, onClose }: { row: Row; markets: string[]; catalog: Catalog; onClose: () => void }) {
  const [data, setData] = useState<OddsResponse | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    api.odds(row.id, all ? [] : markets).then(setData);
  }, [row.id, markets, all]);
  const bkName = (k: string) => catalog.bookmakers.find((b) => b.key === k)?.name ?? k;
  return (
    <Modal title={`Cuotas · ${row.home.name} vs ${row.away.name}`} onClose={onClose} wide>
      <label className="switch"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Ver todos los mercados con cuota</label>
      {data && (
        <table className="grid compact">
          <thead><tr><th>Mercado</th>{data.bookmakers.map((b) => <th key={b}>{bkName(b)}</th>)}<th>Real</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.market.key}>
                <td>{r.market.name}</td>
                {data.bookmakers.map((b) => (
                  <td key={b} className={`c ${r.prices[b] !== null && r.prices[b] === r.best ? "best" : ""}`}>{r.prices[b] ?? "—"}</td>
                ))}
                <td className="c muted">{row.markets[r.market.key]?.real ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && !data.rows.length && <p className="muted">Este partido no tiene cuotas cargadas.</p>}
    </Modal>
  );
}

/** Partidos jugados de cada equipo (y enfrentamientos), como en el escáner de la otra app. */
export function TeamMatchesModal({ row, markets, profileId, catalog, onClose }: {
  row: Row; markets: string[]; profileId: number | null; catalog: Catalog; onClose: () => void;
}) {
  const [market, setMarket] = useState(markets[0] ?? "ou_ht_over_0_5");
  const [scope, setScope] = useState<"league" | "all">("all");
  const [tab, setTab] = useState<"home" | "away" | "h2h">("home");
  const [limit, setLimit] = useState(20);
  const [data, setData] = useState<TeamMatchesResponse | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBusy(true); setErr("");
    api.teamMatches(row.id, profileId, market, scope).then(setData).catch((e) => setErr(e.message)).finally(() => setBusy(false));
  }, [row.id, profileId, market, scope]);
  const name = (k: string) => catalog.markets.find((m) => m.key === k)?.name ?? k;

  const games = data ? data[tab] : [];
  const shown = limit ? games.slice(0, limit) : games;
  const valid = shown.filter((g) => g.hit !== null);
  const hits = valid.filter((g) => g.hit).length;
  const teamId = tab === "home" ? data?.match.home_id : tab === "away" ? data?.match.away_id : null;
  const resLabel = { G: "Ganó", E: "Empató", P: "Perdió" } as const;

  return (
    <Modal title={`Partidos · ${row.home.name} vs ${row.away.name}`} onClose={onClose} wide>
      <div className="row-between">
        <div className="tabs">
          <button className={tab === "home" ? "on" : ""} onClick={() => setTab("home")}>{row.home.name}</button>
          <button className={tab === "away" ? "on" : ""} onClick={() => setTab("away")}>{row.away.name}</button>
          <button className={tab === "h2h" ? "on" : ""} onClick={() => setTab("h2h")}>Enfrentamientos</button>
        </div>
        <div className="row">
          <select value={market} onChange={(e) => setMarket(e.target.value)}>
            {(markets.length ? markets : [market]).map((k) => <option key={k} value={k}>{name(k)}</option>)}
          </select>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            <option value={10}>Últimos 10</option>
            <option value={20}>Últimos 20</option>
            <option value={0}>Todos</option>
          </select>
        </div>
      </div>
      {data?.can_all && (
        <div className="tabs">
          <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>Todas las competiciones</button>
          <button className={scope === "league" ? "on" : ""} onClick={() => setScope("league")}>Solo {data.match.league}</button>
        </div>
      )}
      {err && <div className="error">{err}</div>}
      {busy && <p className="muted">Bajando partidos…</p>}
      {data && !busy && (
        <>
          <p>
            <b>{name(market)}</b>: {hits} de {valid.length} partidos
            {valid.length > 0 && <> (<b>{Math.round((100 * hits) / valid.length)}%</b>)</>}
            <span className="muted small"> · ● = partido usado en la cuota real</span>
          </p>
          <table className="grid compact">
            <thead>
              <tr><th>Fecha</th><th className="l">Competición</th><th>Local</th><th>FT</th><th>HT</th><th>Visitante</th>
                {tab !== "h2h" && <th>Resultado</th>}<th>{name(market)}</th><th></th></tr>
            </thead>
            <tbody>
              {shown.map((g) => (
                <tr key={g.id} className={g.same_league ? "" : "other-comp"}>
                  <td>{fmtDate(g.date)}</td>
                  <td className="l small">{g.league}</td>
                  <td className={g.home_id === teamId ? "b" : ""}>{g.home}</td>
                  <td className="c">{g.ft[0]}-{g.ft[1]}</td>
                  <td className="c muted">{g.ht[0]}-{g.ht[1]}</td>
                  <td className={g.away_id === teamId ? "b" : ""}>{g.away}</td>
                  {tab !== "h2h" && <td className="c"><span className={`res res-${g.result}`}>{g.result ? resLabel[g.result] : ""}</span></td>}
                  <td className={`c ${g.hit === null ? "muted" : g.hit ? "pos" : "neg"}`}>{g.hit === null ? "sin dato" : g.hit ? "✔" : "✘"}</td>
                  <td className="c pos" title={g.in_sample ? "Usado en la cuota real" : ""}>{g.in_sample ? "●" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && <p className="muted">No hay partidos jugados para mostrar.</p>}
        </>
      )}
    </Modal>
  );
}
