import { useEffect, useState } from "react";
import { api, Catalog, OddsResponse, ROLE_LABEL, Row, SampleResponse, SEASONS_LABEL } from "../api";
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
