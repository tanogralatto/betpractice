import { useEffect, useState } from "react";
import { api, Catalog, LeagueNode, ROLE_LABEL, SEASONS_LABEL, SubKind, UserProfile } from "../api";
import { CheckList, LeagueTree, Section, Tabs } from "../components/common";
import MarketPicker from "../components/MarketPicker";

type Sub = { id: number; name: string; [k: string]: any };

const SUB_DEF: Record<SubKind, { title: string; field: keyof UserProfile; fields: { key: string; label: string; options: string[] }[] }> = {
  real_odds: {
    title: "Perfil de cuota real", field: "real_odds_profile_id",
    fields: [
      { key: "sample", label: "Muestra", options: ["last_8", "current", "current_plus_1", "current_plus_2", "current_plus_3"] },
      { key: "home_as", label: "Local como", options: ["home", "away", "both", "ignore"] },
      { key: "away_as", label: "Visitante como", options: ["home", "away", "both", "ignore"] },
    ],
  },
  ppg: {
    title: "Perfil de PPG (temporada actual)", field: "ppg_profile_id",
    fields: [
      { key: "home_as", label: "Local como", options: ["home", "both"] },
      { key: "away_as", label: "Visitante como", options: ["away", "both"] },
    ],
  },
  stats: {
    title: "Perfil de estadísticas", field: "stats_profile_id",
    fields: [
      { key: "seasons", label: "Temporadas", options: ["current", "current_plus_1"] },
      { key: "home_as", label: "Local como", options: ["home", "away", "both"] },
      { key: "away_as", label: "Visitante como", options: ["home", "away", "both"] },
    ],
  },
  streaks: {
    title: "Perfil de rachas", field: "streaks_profile_id",
    fields: [
      { key: "seasons", label: "Temporadas", options: ["current", "current_plus_1"] },
      { key: "home_as", label: "Local como", options: ["home", "away", "both"] },
      { key: "away_as", label: "Visitante como", options: ["home", "away", "both"] },
    ],
  },
};
const label = (o: string) => SEASONS_LABEL[o] ?? ROLE_LABEL[o] ?? o;

function SubProfileSection({ kind, selected, onSelect }: { kind: SubKind; selected: number | null; onSelect: (id: number) => void }) {
  const def = SUB_DEF[kind];
  const DEFAULTS: Record<string, string> = { sample: "current_plus_1", seasons: "current_plus_1", home_as: "both", away_as: "both" };
  const blank = (): Record<string, string> => ({ name: "", ...Object.fromEntries(def.fields.map((f) => [f.key, DEFAULTS[f.key]])) });
  const [tab, setTab] = useState<"list" | "new">("list");
  const [items, setItems] = useState<Sub[]>([]);
  const [form, setForm] = useState<Record<string, string>>(blank());
  const [editing, setEditing] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const load = () => api.subprofiles<Sub>(kind).then(setItems);
  useEffect(() => { load(); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setErr("");
    try {
      const o = editing ? await api.updateSub<Sub>(kind, editing, form) : await api.createSub<Sub>(kind, form);
      await load();
      onSelect(o.id);
      setEditing(null);
      setForm(blank());
      setTab("list");
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <Section title={def.title}>
      <Tabs value={tab} onChange={(t) => { setTab(t); if (t === "new" && !editing) setForm(blank()); }}
        items={[["list", "Perfiles creados"], ["new", editing ? "Editar" : "Crear nuevo"]]} />
      {err && <div className="error">{err}</div>}
      {tab === "list" ? (
        <div className="sub-table"><table className="grid compact">
          <thead><tr><th className="l">Nombre</th>{def.fields.map((f) => <th key={f.key}>{f.label}</th>)}<th></th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className={selected === it.id ? "selected" : ""}>
                <td className="l wrap">{selected === it.id && <span className="pos">✔ </span>}{it.name}</td>
                {def.fields.map((f) => <td key={f.key} className="c">{label(it[f.key])}</td>)}
                <td className="actions">
                  <button onClick={() => onSelect(it.id)} disabled={selected === it.id}>{selected === it.id ? "Elegido" : "Seleccionar"}</button>
                  <button className="ghost" onClick={() => { setEditing(it.id); setForm({ name: it.name, ...Object.fromEntries(def.fields.map((f) => [f.key, it[f.key]])) }); setTab("new"); }}>Editar</button>
                  <button className="ghost" onClick={async () => { try { await api.deleteSub(kind, it.id); load(); } catch (e: any) { setErr(e.message); } }}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : (
        <div className="form">
          <label>Nombre <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          {def.fields.map((f) => (
            <label key={f.key}>{f.label}
              <select value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>
                {f.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}
              </select>
            </label>
          ))}
          <div className="row-end">
            {editing && <button className="ghost" onClick={() => { setEditing(null); setForm(blank()); setTab("list"); }}>Cancelar</button>}
            <button className="primary" disabled={!form.name?.trim()} onClick={save}>{editing ? "Guardar cambios" : "Crear y seleccionar"}</button>
          </div>
        </div>
      )}
    </Section>
  );
}

export default function ProfilePage({ catalog, leagues, profiles, reload }: {
  catalog: Catalog; leagues: LeagueNode[]; profiles: UserProfile[]; reload: () => Promise<void>;
}) {
  const [selId, setSelId] = useState<number>((profiles.find((p) => p.is_active) ?? profiles[0]).id);
  const sel = profiles.find((p) => p.id === selId) ?? profiles[0];
  const [draft, setDraft] = useState<UserProfile>(sel);
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { setDraft(sel); }, [selId, profiles]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMsg(""); setErr(""); }, [selId]);

  const upd = (patch: Partial<UserProfile>) => setDraft({ ...draft, ...patch });
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setErr(""); setMsg("");
    try { await fn(); await reload(); if (ok) setMsg(ok); } catch (e: any) { setErr(e.message); }
  };
  const save = () => run(() => api.saveProfile(draft.id, draft), "Perfil guardado ✔");

  return (
    <div className="profile-page">
      <aside className="sidebar">
        <h3>Mis perfiles</h3>
        <ul className="profile-list">
          {profiles.map((p) => (
            <li key={p.id} className={p.id === selId ? "on" : ""} onClick={() => setSelId(p.id)}>
              <span>{p.name}</span>
              {p.is_active ? <span className="tag ok">activo</span> : (
                <button className="link" onClick={(e) => { e.stopPropagation(); run(() => api.activateProfile(p.id), `“${p.name}” activado`); }}>Activar</button>
              )}
            </li>
          ))}
        </ul>
        <div className="row">
          <input placeholder="Nombre del perfil nuevo" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button disabled={!newName.trim()} onClick={() => run(async () => {
            const p = await api.createProfile({
              name: newName.trim(), real_odds_profile_id: sel.real_odds_profile_id, ppg_profile_id: sel.ppg_profile_id,
              stats_profile_id: sel.stats_profile_id, streaks_profile_id: sel.streaks_profile_id,
              fav_markets: ["ou_ht_over_0_5"], fav_bookmakers: ["best"],
            });
            setSelId(p.id); setNewName("");
          }, "Perfil creado")}>Crear</button>
        </div>
      </aside>

      <main className="content">
        <div className="row-between">
          <input className="title-input" value={draft.name} onChange={(e) => upd({ name: e.target.value })} />
          <div className="row">
            {!sel.is_active && <button onClick={() => run(() => api.activateProfile(sel.id), "Perfil activado")}>Activar</button>}
            <button className="ghost danger" disabled={profiles.length <= 1} onClick={() => {
              if (confirm(`¿Borrar el perfil “${sel.name}”?`)) run(async () => { await api.deleteProfile(sel.id); setSelId(profiles.find((p) => p.id !== sel.id)!.id); }, "Perfil borrado");
            }}>Borrar</button>
            <button className="primary" onClick={save}>Guardar</button>
          </div>
        </div>
        {msg && <div className="ok-msg">{msg}</div>}
        {err && <div className="error">{err}</div>}

        <div className="cols">
          <div>
            {(Object.keys(SUB_DEF) as SubKind[]).map((k) => (
              <SubProfileSection key={k} kind={k} selected={draft[SUB_DEF[k].field] as number | null}
                onSelect={(id) => upd({ [SUB_DEF[k].field]: id } as Partial<UserProfile>)} />
            ))}
          </div>
          <div>
            <Section title="Favoritos · Ligas">
              <LeagueTree tree={leagues} value={draft.fav_leagues} onChange={(v) => upd({ fav_leagues: v })} />
            </Section>
            <Section title="Favoritos · Mercados (máx. 10)">
              <MarketPicker catalog={catalog} value={draft.fav_markets} onChange={(v) => upd({ fav_markets: v })} max={10} />
            </Section>
            <Section title="Favoritos · Estadísticas (máx. 3)" open={false}>
              <CheckList items={catalog.stats} value={draft.fav_stats} onChange={(v) => upd({ fav_stats: v })} max={3} />
            </Section>
            <Section title="Favoritos · Rachas (máx. 3)" open={false}>
              <CheckList items={catalog.streaks} value={draft.fav_streaks} onChange={(v) => upd({ fav_streaks: v })} max={3} />
            </Section>
            <Section title="Favoritos · Casas de apuestas">
              <p className="muted small">La primera marcada es la casa por defecto en Pre partido. “Mejor cuota” toma la más alta entre todas.</p>
              <CheckList items={catalog.bookmakers} value={draft.fav_bookmakers} onChange={(v) => upd({ fav_bookmakers: v })} />
            </Section>
          </div>
        </div>
        <div className="row-end"><button className="primary" onClick={save}>Guardar perfil</button></div>
      </main>
    </div>
  );
}
