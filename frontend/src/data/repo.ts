/**
 * Depósito de datos de la página.
 * - Modo "api": se piden a API-Football los partidos del día y, por liga, las temporadas
 *   necesarias para las muestras; todo queda guardado en el navegador.
 * - Modo "demo": datos de prueba (data/datos.json) cuando no hay clave.
 */
import { History } from "../engine/analysis";
import type { MatchData } from "../engine/types";
import * as AF from "./apiFootball";
import { Cache } from "./storage";

export interface League { id: number; name: string; country: string; flag: string | null }
type Mode = "api" | "demo";

const H = 3600_000;
const listeners = new Set<() => void>();
export const onChange = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((f) => f());

export const repo = {
  mode: (AF.getKey() ? "api" : "demo") as Mode,
  matches: new Map<number, MatchData>(),
  leagues: new Map<number, League>(),
  teams: new Map<number, string>(),
  odds: {} as AF.OddsMap,
  seasonsLoaded: new Map<number, Set<number>>(), // liga -> temporadas cargadas
  currentSeason: new Map<number, number>(), // liga -> temporada del día consultado
  history: new History([], {}),
  loading: new Set<string>(), // tareas en curso ("L:S", "odds:D:L")
  failed: new Map<string, string>(),
  errors: [] as string[],
  demoMeta: null as null | { generated_at: string; today: string },
};

function add(pack: AF.FixturePack) {
  for (const l of pack.leagues) repo.leagues.set(l.id, { id: l.id, name: l.name, country: l.country, flag: l.flag });
  for (const t of pack.teams) repo.teams.set(t.id, t.name);
  for (const m of pack.matches) repo.matches.set(m.id, m);
}

let historyDirty = true;
function rebuild() {
  const order: Record<number, number[]> = {};
  for (const [l, ss] of repo.seasonsLoaded) order[l] = [...ss].sort((a, b) => a - b);
  // las temporadas del día también cuentan para ordenar aunque no estén completas
  for (const [l, s] of repo.currentSeason) if (!order[l]?.includes(s)) order[l] = [...(order[l] ?? []), s].sort((a, b) => a - b);
  repo.history = new History([...repo.matches.values()], order);
  historyDirty = false;
}
export function history(): History {
  if (historyDirty) rebuild();
  return repo.history;
}
function changed() { historyDirty = true; emit(); }

// --- demo -------------------------------------------------------------------
let demoLoaded: Promise<void> | null = null;
function loadDemo(): Promise<void> {
  if (!demoLoaded) {
    demoLoaded = (async () => {
      const r = await fetch(`${import.meta.env.BASE_URL}data/datos.json`, { cache: "no-cache" });
      if (!r.ok) throw new Error("No se encontraron los datos de prueba.");
      const raw = await r.json();
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      const seasonYear = new Map<number, [number, number]>(); // seasonId -> [liga, año]
      for (const [id, lg, year] of raw.seasons) seasonYear.set(id, [lg, year]);
      for (const [id, name, country, code] of raw.leagues)
        repo.leagues.set(id, { id, name, country, flag: code ? `emoji:${code}` : null });
      for (const [id, name] of Object.entries(raw.teams)) repo.teams.set(Number(id), String(name));
      for (const x of raw.matches) {
        const m: MatchData = {
          id: Number(x[0]), leagueId: Number(x[1]), seasonId: Number(x[2]), kickoff: String(x[3]),
          homeId: Number(x[4]), awayId: Number(x[5]), status: String(x[6]),
          hg: n(x[7]), ag: n(x[8]), hthg: n(x[9]), htag: n(x[10]),
          hc: n(x[11]), ac: n(x[12]), hs: n(x[13]), as: n(x[14]), hsot: n(x[15]), asot: n(x[16]),
          hda: n(x[17]), ada: n(x[18]), hy: n(x[19]), ay: n(x[20]), detail: true,
          goals: x[21] ? String(x[21]).split(" ").map((g) => {
            const mt = /^(\d+)([ha])(\d)$/.exec(g)!;
            return { minute: Number(mt[1]), side: mt[2] === "h" ? "home" : "away", half: Number(mt[3]) } as const;
          }) : [],
        };
        repo.matches.set(m.id, m);
        const s = repo.seasonsLoaded.get(m.leagueId) ?? new Set<number>();
        s.add(m.seasonId);
        repo.seasonsLoaded.set(m.leagueId, s);
      }
      for (const [mid, o] of Object.entries(raw.odds)) repo.odds[Number(mid)] = o as any;
      repo.demoMeta = raw.meta;
      changed();
    })();
    demoLoaded.catch(() => { demoLoaded = null; });
  }
  return demoLoaded;
}

// --- api: partidos del día ---------------------------------------------------
const dayPromises = new Map<string, Promise<void>>();
export function loadDay(day: string, force = false): Promise<void> {
  if (repo.mode === "demo") return loadDemo();
  if (!force && dayPromises.has(day)) return dayPromises.get(day)!;
  const p = (async () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: AF.TZ });
    const ttl = day < today ? 24 * H : 10 * 60_000;
    let pack = force ? null : await Cache.get<AF.FixturePack>(`day:${day}`, ttl);
    if (!pack) {
      pack = await AF.fixturesByDate(day);
      await Cache.set(`day:${day}`, pack);
    }
    add(pack);
    for (const l of pack.leagues) repo.currentSeason.set(l.id, l.season);
    changed();
  })();
  dayPromises.set(day, p);
  p.catch(() => dayPromises.delete(day));
  return p;
}

export function dayMatches(day: string): MatchData[] {
  return [...repo.matches.values()].filter((m) => m.kickoff.startsWith(day));
}

// --- api: historial por liga y temporada -----------------------------------
const seasonPromises = new Map<string, Promise<void>>();
function loadSeason(league: number, season: number): Promise<void> {
  const k = `${league}:${season}`;
  if (seasonPromises.has(k)) return seasonPromises.get(k)!;
  const p = (async () => {
    repo.loading.add(k);
    emit();
    try {
      const isCurrent = season >= (repo.currentSeason.get(league) ?? season);
      let pack = await Cache.get<AF.FixturePack>(`fx:${k}`, isCurrent ? 3 * H : 60 * 24 * H);
      if (!pack) {
        pack = await AF.fixturesBySeason(league, season);
        await Cache.set(`fx:${k}`, pack);
      }
      add(pack);
      const s = repo.seasonsLoaded.get(league) ?? new Set<number>();
      s.add(season);
      repo.seasonsLoaded.set(league, s);
      repo.failed.delete(k);
    } catch (e: any) {
      repo.failed.set(k, e.message);
      seasonPromises.delete(k);
      if (e.fatal) repo.errors.push(e.message);
    } finally {
      repo.loading.delete(k);
      changed();
    }
  })();
  seasonPromises.set(k, p);
  return p;
}

/** Temporadas que hacen falta según la muestra más amplia que usan los perfiles. */
export function ensureLeagues(leagueIds: number[], extraSeasons: number): void {
  if (repo.mode !== "api") return;
  for (const l of leagueIds) {
    const cur = repo.currentSeason.get(l);
    if (cur === undefined) continue;
    for (let i = 0; i <= extraSeasons; i++) if (!repo.failed.has(`${l}:${cur - i}`)) void loadSeason(l, cur - i);
  }
}

export const leagueReady = (league: number, extraSeasons: number) => {
  if (repo.mode !== "api") return true;
  const cur = repo.currentSeason.get(league);
  if (cur === undefined) return false;
  const s = repo.seasonsLoaded.get(league);
  for (let i = 0; i <= extraSeasons; i++) if (!s?.has(cur - i) && !repo.failed.has(`${league}:${cur - i}`)) return false;
  return true;
};

// --- api: cuotas -------------------------------------------------------------
const oddsPromises = new Map<string, Promise<void>>();
export function ensureOdds(day: string, leagueIds: number[]): void {
  if (repo.mode !== "api") return;
  for (const l of leagueIds) {
    const season = repo.currentSeason.get(l);
    const k = `odds:${day}:${l}`;
    if (season === undefined || oddsPromises.has(k)) continue;
    const p = (async () => {
      repo.loading.add(k);
      try {
        let o = await Cache.get<AF.OddsMap>(k, 30 * 60_000);
        if (!o) {
          o = await AF.oddsByDate(day, l, season);
          await Cache.set(k, o);
        }
        Object.assign(repo.odds, o);
      } catch (e: any) {
        oddsPromises.delete(k);
        if (e.fatal) repo.errors.push(e.message);
      } finally {
        repo.loading.delete(k);
        changed();
      }
    })();
    oddsPromises.set(k, p);
  }
}

/** Vuelve a pedir el día y sus cuotas (botón Actualizar). */
export async function refresh(day: string): Promise<void> {
  if (repo.mode !== "api") return;
  await Cache.clear(`odds:${day}`);
  for (const k of [...oddsPromises.keys()]) if (k.startsWith(`odds:${day}`)) oddsPromises.delete(k);
  for (const k of [...seasonPromises.keys()]) {
    const [l, s] = k.split(":").map(Number);
    if (repo.currentSeason.get(l) === s) { seasonPromises.delete(k); await Cache.clear(`fx:${k}`); }
  }
  await loadDay(day, true);
}

export function setMode(m: Mode) {
  repo.mode = m;
  repo.matches.clear(); repo.leagues.clear(); repo.teams.clear(); repo.odds = {};
  repo.seasonsLoaded.clear(); repo.currentSeason.clear(); repo.failed.clear(); repo.errors = [];
  dayPromises.clear(); seasonPromises.clear(); oddsPromises.clear(); demoLoaded = null;
  changed();
}
