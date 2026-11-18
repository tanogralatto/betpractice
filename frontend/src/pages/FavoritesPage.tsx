import { useEffect, useState } from "react";
import { api, Catalog, Row } from "../api";
import type { FavoritesResponse } from "../engine/local";
import MatchList from "../components/MatchList";
import { SampleModal, TeamMatchesModal } from "../components/MatchModals";

const fmtDay = (d: string) => {
  const t = new Date(`${d}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const fmtSaved = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function FavoritesPage({ catalog, onCount }: { catalog: Catalog; onCount: (n: number) => void }) {
  const [data, setData] = useState<FavoritesResponse | null>(null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [favs, setFavs] = useState<Set<number>>(() => api.favoriteIds());
  const [teamsRow, setTeamsRow] = useState<Row | null>(null);
  const [sampleRow, setSampleRow] = useState<Row | null>(null);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = api.onChange(() => { clearTimeout(t); t = setTimeout(() => setTick((x) => x + 1), 500); });
    return () => { off(); clearTimeout(t); };
  }, []);
  useEffect(() => {
    api.favorites().then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message));
  }, [tick, favs]);
  useEffect(() => onCount(favs.size), [favs, onCount]);

  const mName = (k: string | null) => catalog.markets.find((m) => m.key === k)?.name ?? k ?? "";
  const toggle = (r: Row) => setFavs(api.toggleFavorite(r, data?.markets[0]));

  // resumen de los terminados
  const done = data ? data.rows.filter((r) => data.hits[r.id] !== null && data.hits[r.id] !== undefined) : [];
  const won = done.filter((r) => data!.hits[r.id]).length;
  // agrupar por día
  const days = data ? [...new Set(data.rows.map((r) => r.kickoff.slice(0, 10)))] : [];

  const extra = (r: Row) => {
    const s = data?.saved[r.id];
    const hit = data?.hits[r.id];
    return (
      <div className="fav-extra">
        {s && (
          <span className="muted">
            Guardado {fmtSaved(s.saved_at)}{s.market ? ` · ${mName(s.market)}` : ""}:{" "}
            Real <b>{s.real?.toFixed(2) ?? "—"}</b> · Casa <b>{s.book?.toFixed(2) ?? "—"}</b>
            {s.value != null && <> · <span className={s.value > 0 ? "pos" : "neg"}>{s.value > 0 ? "+" : ""}{s.value.toFixed(1)}%</span></>}
          </span>
        )}
        {hit === true && <span className="fav-res ok">✔ Se cumplió {mName(s?.market ?? null)}</span>}
        {hit === false && <span className="fav-res no">✘ No se cumplió {mName(s?.market ?? null)}</span>}
      </div>
    );
  };

  return (
    <div className="favorites">
      <div className="row-between">
        <h2>★ Mis partidos</h2>
        {done.length > 0 && <button className="ghost" onClick={() => setFavs(api.removeFinishedFavorites())}>Borrar los terminados</button>}
      </div>
      {done.length > 0 && (
        <p className="fav-summary">
          Terminados: <b>{done.length}</b> · se cumplieron <b className="pos">{won}</b> · no se cumplieron <b className="neg">{done.length - won}</b>
          {" "}(<b>{Math.round((100 * won) / done.length)}%</b> de aciertos)
        </p>
      )}
      {err && <div className="error">{err}</div>}
      {!!data?.loading && <p className="muted">Bajando datos de API-Football…</p>}
      {data && !data.rows.length && !data.missing.length && (
        <div className="empty">Todavía no guardaste partidos. En <b>Pre partido</b> tocá la estrella ☆ de un partido para guardarlo acá.</div>
      )}
      {days.map((d) => (
        <section key={d}>
          <h3 className="fav-day">{fmtDay(d)}</h3>
          <MatchList rows={data!.rows.filter((r) => r.kickoff.startsWith(d))} markets={data!.markets} stats={data!.stats} streaks={data!.streaks}
            catalog={catalog} isFav={(id) => favs.has(id)} onFav={toggle} onTeams={setTeamsRow} onSample={setSampleRow} extra={extra} empty="" />
        </section>
      ))}
      {!!data?.missing.length && (
        <div className="muted small">
          Sin datos por ahora: {data.missing.map((m) => `${m.home} vs ${m.away} (${m.date})`).join(" · ")}
        </div>
      )}
      {teamsRow && <TeamMatchesModal row={teamsRow} markets={data?.markets ?? []} profileId={null} catalog={catalog} onClose={() => setTeamsRow(null)} />}
      {sampleRow && <SampleModal row={sampleRow} markets={data?.markets ?? []} profileId={null} catalog={catalog} onClose={() => setSampleRow(null)} />}
    </div>
  );
}
