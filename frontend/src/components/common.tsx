import { ReactNode, useState } from "react";
import { LeagueNode, Named, Range } from "../api";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="ghost" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Section({ title, children, open = true, extra }: { title: string; children: ReactNode; open?: boolean; extra?: ReactNode }) {
  const [o, setO] = useState(open);
  return (
    <section className="panel-section">
      <div className="panel-title" onClick={() => setO(!o)}>
        <span>{o ? "▾" : "▸"} {title}</span>
        {extra && <span onClick={(e) => e.stopPropagation()}>{extra}</span>}
      </div>
      {o && <div className="panel-content">{children}</div>}
    </section>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="tabs">
      {items.map(([k, label]) => (
        <button key={k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  );
}

/** Lista de checkboxes con máximo de selección (estadísticas, rachas). */
export function CheckList({ items, value, onChange, max }: { items: Named[]; value: string[]; onChange: (v: string[]) => void; max?: number }) {
  const [q, setQ] = useState("");
  const shown = items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      {max && <div className="muted small">{value.length}/{max} seleccionadas</div>}
      {items.length > 10 && <input className="search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="checklist">
        {shown.map((i) => {
          const checked = value.includes(i.key);
          const disabled = !checked && max !== undefined && value.length >= max;
          return (
            <label key={i.key} className={disabled ? "disabled" : ""}>
              <input type="checkbox" checked={checked} disabled={disabled}
                onChange={() => onChange(checked ? value.filter((v) => v !== i.key) : [...value, i.key])} />
              {i.name}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function LeagueTree({ tree, value, onChange }: { tree: LeagueNode[]; value: number[]; onChange: (v: number[]) => void }) {
  const set = new Set(value);
  return (
    <div className="tree">
      <div className="row-between">
        <span className="muted small">{value.length ? `${value.length} ligas` : "Todas las ligas"}</span>
        <button className="link" onClick={() => onChange([])}>Limpiar todo</button>
      </div>
      {tree.map((c) => {
        const ids = c.leagues.map((l) => l.id);
        const all = ids.every((id) => set.has(id));
        const some = ids.some((id) => set.has(id));
        return (
          <div key={c.country} className="tree-country">
            <label>
              <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = some && !all; }}
                onChange={() => onChange(all ? value.filter((v) => !ids.includes(v)) : [...new Set([...value, ...ids])])} />
              <b>{c.country}</b>
            </label>
            {c.leagues.map((l) => (
              <label key={l.id} className="tree-league">
                <input type="checkbox" checked={set.has(l.id)}
                  onChange={() => onChange(set.has(l.id) ? value.filter((v) => v !== l.id) : [...value, l.id])} />
                {l.name}
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function RangeInput({ label, value, onChange, step = 0.01 }: { label: string; value?: Range; onChange: (v: Range) => void; step?: number }) {
  const [lo, hi] = value ?? [null, null];
  const parse = (s: string) => (s === "" ? null : Number(s));
  return (
    <div className="range">
      <span className="range-label">{label}</span>
      <span className="muted small">de</span>
      <input type="number" step={step} value={lo ?? ""} onChange={(e) => onChange([parse(e.target.value), hi])} />
      <span className="muted small">a</span>
      <input type="number" step={step} value={hi ?? ""} onChange={(e) => onChange([lo, parse(e.target.value)])} />
    </div>
  );
}
