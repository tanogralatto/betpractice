import { useState } from "react";
import { Catalog, Filters, Range } from "../api";
import { Modal, RangeInput, Tabs } from "./common";

type T = "markets" | "stats" | "streaks" | "misc";

export default function FiltersDialog({ catalog, markets, stats, streaks, value, onApply, onClose }: {
  catalog: Catalog; markets: string[]; stats: string[]; streaks: string[];
  value: Filters; onApply: (f: Filters) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<T>("markets");
  const [f, setF] = useState<Filters>(JSON.parse(JSON.stringify(value || {})));
  const name = (list: { key: string; name: string }[], k: string) => list.find((x) => x.key === k)?.name ?? k;

  function set<S extends keyof Filters>(section: S, key: string, field: string, r: Range) {
    setF((prev) => {
      const next: any = { ...prev, [section]: { ...(prev[section] as any) } };
      if (section === "misc") next.misc[field] = r;
      else next[section][key] = { ...(next[section][key] || {}), [field]: r };
      return next;
    });
  }
  const get = (section: keyof Filters, key: string, field: string): Range | undefined =>
    section === "misc" ? (f.misc as any)?.[field] : (f[section] as any)?.[key]?.[field];

  return (
    <Modal title="Añadir filtros" onClose={onClose} wide>
      <p className="muted small">Cada filtro es un rango “de … a …” (podés dejar un extremo vacío). Se muestran solo los partidos que cumplen todos.</p>
      <Tabs value={tab} onChange={setTab} items={[["markets", "Mercado"], ["stats", "Estadísticas"], ["streaks", "Rachas"], ["misc", "Varios"]]} />
      <div className="filters-body">
        {tab === "markets" && (markets.length ? markets.map((k) => (
          <fieldset key={k}>
            <legend>{name(catalog.markets, k)}</legend>
            <RangeInput label="Cuota real" value={get("markets", k, "real")} onChange={(r) => set("markets", k, "real", r)} />
            <RangeInput label="Cuota casa" value={get("markets", k, "book")} onChange={(r) => set("markets", k, "book", r)} />
            <RangeInput label="Valor %" step={0.5} value={get("markets", k, "value")} onChange={(r) => set("markets", k, "value", r)} />
          </fieldset>
        )) : <p className="muted">Elegí mercados en el panel izquierdo.</p>)}
        {tab === "stats" && (stats.length ? stats.map((k) => (
          <fieldset key={k}>
            <legend>{name(catalog.stats, k)}</legend>
            <RangeInput label="Ambos (AVG)" value={get("stats", k, "avg")} onChange={(r) => set("stats", k, "avg", r)} />
            <RangeInput label="Local" value={get("stats", k, "home")} onChange={(r) => set("stats", k, "home", r)} />
            <RangeInput label="Visitante" value={get("stats", k, "away")} onChange={(r) => set("stats", k, "away", r)} />
            <RangeInput label="Muestra (n)" step={1} value={get("stats", k, "n")} onChange={(r) => set("stats", k, "n", r)} />
          </fieldset>
        )) : <p className="muted">Elegí estadísticas en el panel izquierdo.</p>)}
        {tab === "streaks" && (streaks.length ? streaks.map((k) => (
          <fieldset key={k}>
            <legend>{name(catalog.streaks, k)}</legend>
            <RangeInput label="Racha local" step={1} value={get("streaks", k, "home")} onChange={(r) => set("streaks", k, "home", r)} />
            <RangeInput label="Racha visitante" step={1} value={get("streaks", k, "away")} onChange={(r) => set("streaks", k, "away", r)} />
          </fieldset>
        )) : <p className="muted">Elegí rachas en el panel izquierdo.</p>)}
        {tab === "misc" && (
          <fieldset>
            <legend>Varios</legend>
            <RangeInput label="PPG local" value={get("misc", "", "ppg_home")} onChange={(r) => set("misc", "", "ppg_home", r)} />
            <RangeInput label="PPG visitante" value={get("misc", "", "ppg_away")} onChange={(r) => set("misc", "", "ppg_away", r)} />
            <RangeInput label="Muestra cuota real (n)" step={1} value={get("misc", "", "sample_n")} onChange={(r) => set("misc", "", "sample_n", r)} />
          </fieldset>
        )}
      </div>
      <div className="row-end">
        <button className="ghost" onClick={() => { onApply({}); onClose(); }}>Quitar todos</button>
        <button className="primary" onClick={() => { onApply(f); onClose(); }}>Aplicar</button>
      </div>
    </Modal>
  );
}

export function countFilters(f: Filters): number {
  let n = 0;
  const has = (r?: Range) => !!r && (r[0] !== null || r[1] !== null);
  for (const sec of ["markets", "stats", "streaks"] as const)
    for (const v of Object.values((f as any)[sec] || {})) for (const r of Object.values(v as any)) if (has(r as Range)) n++;
  for (const r of Object.values(f.misc || {})) if (has(r as Range)) n++;
  return n;
}
