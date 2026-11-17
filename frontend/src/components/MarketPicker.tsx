import { useMemo, useState } from "react";
import { Catalog } from "../api";

/** Selector de mercados por categoría con buscador. El primero elegido es el mercado principal. */
export default function MarketPicker({ catalog, value, onChange, favorites, max = 10 }: {
  catalog: Catalog; value: string[]; onChange: (v: string[]) => void; favorites?: string[]; max?: number;
}) {
  const cats: [string, string][] = [
    ...(favorites ? [["mine", "Mis mercados"] as [string, string]] : []),
    ["popular", "Populares"], ["equipo", "Equipo"], ["goles", "Goles"], ["marcador", "Marcador"], ["corners", "Corners"], ["all", "Todos"],
  ];
  const [cat, setCat] = useState(favorites?.length ? "mine" : "popular");
  const [q, setQ] = useState("");
  const byKey = useMemo(() => Object.fromEntries(catalog.markets.map((m) => [m.key, m])), [catalog]);

  const list = catalog.markets.filter((m) => {
    if (q && !`${m.name} ${m.group}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (q || cat === "all") return true;
    if (cat === "mine") return favorites?.includes(m.key);
    if (cat === "popular") return m.popular;
    return m.category === cat;
  });
  const groups: Record<string, typeof list> = {};
  list.forEach((m) => (groups[m.group] ||= []).push(m));

  const toggle = (k: string) => {
    if (value.includes(k)) onChange(value.filter((v) => v !== k));
    else if (value.length < max) onChange([...value, k]);
  };

  return (
    <div className="market-picker">
      <div className="chips">
        {value.map((k, i) => (
          <span key={k} className={`chip sel ${i === 0 ? "main" : ""}`} title={i === 0 ? "Mercado principal" : ""}>
            {byKey[k]?.name ?? k}
            <button className="ghost" onClick={() => toggle(k)}>✕</button>
          </span>
        ))}
        {!value.length && <span className="muted small">Ningún mercado elegido</span>}
      </div>
      <div className="muted small">{value.length}/{max} · el primero es el principal</div>
      <div className="cat-tabs">
        {cats.map(([k, l]) => (
          <button key={k} className={cat === k ? "on" : ""} onClick={() => setCat(k)}>{l}</button>
        ))}
      </div>
      <input className="search" placeholder="Buscar mercado…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="market-list">
        {Object.entries(groups).map(([g, ms]) => (
          <div key={g}>
            <div className="group-title">{g}</div>
            {ms.map((m) => (
              <label key={m.key} className={!value.includes(m.key) && value.length >= max ? "disabled" : ""}>
                <input type="checkbox" checked={value.includes(m.key)} onChange={() => toggle(m.key)}
                  disabled={!value.includes(m.key) && value.length >= max} />
                {m.name}
              </label>
            ))}
          </div>
        ))}
        {!list.length && <div className="muted small">Sin resultados</div>}
      </div>
    </div>
  );
}
