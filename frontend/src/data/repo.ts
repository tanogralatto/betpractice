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
import { peekFixtures, peekOdds, tieredFixtures, tieredOdds } from "./tiered";

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
/** `cacheOnly`: usa la lista guardada aunque sea vieja (al abrir, sin gastar consultas);
 *  solo va a la API si no hay ninguna copia. */
export function loadDay(day: string, force = false, cacheOnly = false): Promise<void> {
  if (repo.mode === "demo") return loadDemo();
  const key = cacheOnly ? `cache:${day}` : day;
  if (!force && dayPromises.has(day)) return dayPromises.get(day)!;
  if (!force && dayPromises.has(key)) return dayPromises.get(key)!;
  const p = (async () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: AF.TZ });
    const ttl = day < today ? 24 * H : 10 * 60_000;
    const peek = cacheOnly && !force ? await peekFixtures(`day:${day}`, 2 * 24 * H) : null;
    const pack = peek?.pack ?? await tieredFixtures(`day:${day}`, ttl, () => AF.fixturesByDate(day), force);
    add(pack);
    for (const l of pack.leagues) repo.currentSeason.set(l.id, l.season);
    changed();
  })();
  dayPromises.set(key, p);
  p.catch(() => dayPromises.delete(key));
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
      const pack = await tieredFixtures(`fx:${k}`, isCurrent ? 3 * H : 60 * 24 * H, () => AF.fixturesBySeason(league, season));
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

/** Carga desde el navegador (sin consultas) las temporadas ya guardadas. Devuelve cuántas cargó. */
export async function warmFromCache(leagueIds: number[], extraSeasons: number, renewStale = true): Promise<number> {
  if (repo.mode !== "api") return 0;
  let n = 0;
  await Promise.all(leagueIds.flatMap((l) => {
    const cur = repo.currentSeason.get(l);
    if (cur === undefined) return [];
    return Array.from({ length: extraSeasons + 1 }, async (_, i) => {
      const season = cur - i, k = `${l}:${season}`;
      if (repo.seasonsLoaded.get(l)?.has(season)) return;
      // si está guardada en el dispositivo o en la nube compartida (aunque sea vieja) se usa ya;
      // la temporada actual se renueva en segundo plano
      const found = await peekFixtures(`fx:${k}`, 365 * 24 * H);
      if (!found) return;
      add(found.pack);
      const s = repo.seasonsLoaded.get(l) ?? new Set<number>();
      s.add(season);
      repo.seasonsLoaded.set(l, s);
      n++;
      if (renewStale && i === 0 && !(await Cache.get(`fx:${k}`, 3 * H))) void loadSeason(l, season);
    });
  }));
  if (n) historyDirty = true;
  return n;
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
/** Cuotas ya guardadas (dispositivo o nube), aunque tengan algunas horas. No gasta consultas. */
const oddsPeeked = new Set<string>();
export async function warmOdds(day: string, leagueIds: number[]): Promise<void> {
  if (repo.mode !== "api") return;
  await Promise.all(leagueIds.map(async (l) => {
    const k = `odds:${day}:${l}`;
    if (oddsPeeked.has(k) || oddsPromises.has(k)) return;
    oddsPeeked.add(k);
    const o = await peekOdds(k, 24 * H);
    if (o) Object.assign(repo.odds, o);
  }));
}

const oddsPromises = new Map<string, Promise<void>>();
const forceOdds = new Set<string>(); // después de ↻ Actualizar: no se usa ninguna copia guardada
export function ensureOdds(day: string, leagueIds: number[]): void {
  if (repo.mode !== "api") return;
  for (const l of leagueIds) {
    const season = repo.currentSeason.get(l);
    const k = `odds:${day}:${l}`;
    if (season === undefined || oddsPromises.has(k)) continue;
    const p = (async () => {
      repo.loading.add(k);
      try {
        const o = await tieredOdds(k, 30 * 60_000, () => AF.oddsByDate(day, l, season), forceOdds.has(k));
        forceOdds.delete(k);
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

// --- api: partidos de un equipo (todas las competiciones) y H2H ----------------------------
// No se mezclan con el historial de la cuota real: solo se muestran en "Partidos".
export interface Extra { matches: MatchData[]; leagues: Map<number, string>; teams: Map<number, string> }
const extraPromises = new Map<string, Promise<Extra>>();
function extra(k: string, ttl: number, fetcher: () => Promise<AF.FixturePack>): Promise<Extra> {
  if (extraPromises.has(k)) return extraPromises.get(k)!;
  const p = (async () => {
    const pack = await tieredFixtures(k, ttl, fetcher);
    return {
      matches: pack.matches,
      leagues: new Map(pack.leagues.map((l) => [l.id, l.name])),
      teams: new Map(pack.teams.map((t) => [t.id, t.name])),
    };
  })();
  extraPromises.set(k, p);
  p.catch(() => extraPromises.delete(k));
  return p;
}
export const teamGames = (team: number) => extra(`team:${team}`, 6 * H, () => AF.teamLast(team));
export const h2hGames = (a: number, b: number) => {
  const [x, y] = [a, b].sort((m, n) => m - n);
  return extra(`h2h:${x}-${y}`, 12 * H, () => AF.headToHead(x, y));
};

/** Vuelve a pedir el día y sus cuotas (botón Actualizar). */
export async function refresh(day: string): Promise<void> {
  if (repo.mode !== "api") return;
  await Cache.clear(`odds:${day}`);
  // las cuotas del día se piden de nuevo a la API (no se usa la copia compartida) y quedan para los demás
  for (const k of [...oddsPromises.keys()]) if (k.startsWith(`odds:${day}`)) { oddsPromises.delete(k); forceOdds.add(k); }
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
  dayPromises.clear(); seasonPromises.clear(); oddsPromises.clear(); extraPromises.clear(); demoLoaded = null;
  changed();
}
