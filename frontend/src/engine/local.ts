/** API de la página: todo se calcula en el navegador con los datos del depósito (data/repo.ts). */
import type {
  TeamGame, TeamMatchesResponse,
  Catalog, LeagueNode, OddsResponse, Preset, PresetConfig, PrematchRequest, PrematchResponse, Row, SampleResponse, SubKind, UserProfile,
} from "../api";
import * as A from "./analysis";
import { BEST, BOOKMAKERS, BOOKMAKER_KEYS, CATEGORIES, MARKETS, MARKETS_BY_KEY, STATS, STATS_BY_KEY, STREAKS, STREAKS_BY_KEY } from "./catalog";
import { rowPasses } from "./filters";
import { load as loadStore, newId, save } from "./store";
import { FT, MatchData, finished, ga, gf } from "./types";
import * as AF from "../data/apiFootball";
import { Cache } from "../data/storage";
import { h2hGames, teamGames } from "../data/repo";
import { warmFromCache } from "../data/repo";
import { LS } from "../data/storage";
import { dayMatches, ensureLeagues, ensureOdds, history, leagueReady, loadDay, onChange, refresh, repo, setMode } from "../data/repo";

export interface Meta { generated_at: string; provider: string; today: string; leagues_synced?: string[] }

/** Más de esta cantidad de ligas sin historial: se pide confirmación antes de gastar consultas. */
const AUTO_LOAD_MAX = 25;

// --- perfiles ---------------------------------------------------------------
function fullProfile(p: ReturnType<typeof loadStore>["profiles"][number]): UserProfile {
  const s = loadStore().subs;
  const f = <T extends { id: number }>(list: T[], id: number | null) => (list.find((x) => x.id === id) ?? null) as any;
  return {
    ...p,
    real_odds_profile: f(s.real_odds, p.real_odds_profile_id), ppg_profile: f(s.ppg, p.ppg_profile_id),
    stats_profile: f(s.stats, p.stats_profile_id), streaks_profile: f(s.streaks, p.streaks_profile_id),
  };
}
const FK: Record<SubKind, keyof UserProfile> = {
  real_odds: "real_odds_profile_id", ppg: "ppg_profile_id", stats: "stats_profile_id", streaks: "streaks_profile_id",
};
const clean = (b: Partial<UserProfile>) => ({
  name: String(b.name ?? "").trim() || "Perfil",
  real_odds_profile_id: b.real_odds_profile_id ?? null, ppg_profile_id: b.ppg_profile_id ?? null,
  stats_profile_id: b.stats_profile_id ?? null, streaks_profile_id: b.streaks_profile_id ?? null,
  fav_leagues: b.fav_leagues ?? [], fav_markets: (b.fav_markets ?? []).slice(0, 10), fav_stats: (b.fav_stats ?? []).slice(0, 3),
  fav_streaks: (b.fav_streaks ?? []).slice(0, 3), fav_bookmakers: b.fav_bookmakers ?? [],
});
function getProfile(id: number | null): UserProfile {
  const ps = loadStore().profiles;
  return fullProfile(ps.find((p) => p.id === id) ?? ps.find((p) => p.is_active) ?? ps[0]);
}

// --- Pre partido ------------------------------------------------------------
const r2 = (v: number | null, d = 2) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

function bookPrice(prices: Record<string, number> | undefined, bk: string): [number | null, string | null] {
  if (!prices) return [null, null];
  if (bk === BEST) {
    const best = Object.entries(prices).sort((a, b) => b[1] - a[1])[0];
    return best ? [best[1], best[0]] : [null, null];
  }
  return prices[bk] !== undefined ? [prices[bk], bk] : [null, null];
}

function buildRow(m: MatchData, p: UserProfile, markets: string[], stats: string[], streaks: string[], bookmaker: string, ready: boolean): Row {
  const h = history();
  const ro = p.real_odds_profile, pp = p.ppg_profile, sp = p.stats_profile, kp = p.streaks_profile;
  const sample = ro && ready ? A.realOddsSample(h, m, ro.sample, ro.home_as as A.Role, ro.away_as as A.Role) : { home: [], away: [], merged: [] };
  const lg = repo.leagues.get(m.leagueId)!;
  const row: Row = {
    id: m.id, kickoff: m.kickoff, status: m.status, pending: !ready,
    league: { id: lg.id, name: lg.name, country: lg.country, country_code: null, flag: lg.flag },
    home: { id: m.homeId, name: repo.teams.get(m.homeId) ?? "?", ppg: ready ? r2(A.ppg(h, m, m.homeId, (pp?.home_as ?? "both") as A.Role)) : null },
    away: { id: m.awayId, name: repo.teams.get(m.awayId) ?? "?", ppg: ready ? r2(A.ppg(h, m, m.awayId, (pp?.away_as ?? "both") as A.Role)) : null },
    score: (m.status === "FT" || m.status === "LIVE") && m.hg !== null ? { ft: [m.hg, m.ag!], ht: [m.hthg, m.htag] } : null,
    sample_n: sample.merged.length, sample_home_n: sample.home.length, sample_away_n: sample.away.length,
    markets: {}, stats: {}, streaks: {},
  };
  for (const k of markets) {
    const mk = MARKETS_BY_KEY[k];
    if (!mk) continue;
    const res = A.realOdds(sample.merged, mk);
    const [book, bk] = bookPrice(repo.odds[m.id]?.[k], bookmaker);
    row.markets[k] = { real: r2(res.odds), prob: r2(res.prob, 4), hits: res.hits, n: res.n, book, bookmaker: bk, value: r2(A.valuePct(book, res.odds), 1) };
  }
  if (!ready) return row;
  for (const k of stats) {
    const st = STATS_BY_KEY[k];
    if (!st || !sp) continue;
    const [hv, nh] = A.teamStat(h, m, m.homeId, sp.home_as as A.Role, sp.seasons, st);
    const [av, na] = A.teamStat(h, m, m.awayId, sp.away_as as A.Role, sp.seasons, st);
    row.stats[k] = { home: r2(hv), away: r2(av), avg: r2(A.avgOf(hv, av)), n_home: nh, n_away: na };
  }
  for (const k of streaks) {
    const sd = STREAKS_BY_KEY[k];
    if (!sd || !kp) continue;
    row.streaks[k] = {
      home: A.teamStreak(h, m, m.homeId, kp.home_as as A.Role, kp.seasons, sd),
      away: A.teamStreak(h, m, m.awayId, kp.away_as as A.Role, kp.seasons, sd),
    };
  }
  return row;
}

const EXTRA: Record<string, number> = { last_8: 1, current: 0, current_plus_1: 1, current_plus_2: 2, current_plus_3: 3 };
const extraSeasons = (p: UserProfile) =>
  Math.max(EXTRA[p.real_odds_profile?.sample ?? "current_plus_1"] ?? 1, EXTRA[p.stats_profile?.seasons ?? "current"] ?? 0,
    EXTRA[p.streaks_profile?.seasons ?? "current"] ?? 0);

const SORTS: Record<string, (a: Row, b: Row) => number> = {
  time: (a, b) => a.kickoff.localeCompare(b.kickoff) || a.league.name.localeCompare(b.league.name),
  league: (a, b) => a.league.country.localeCompare(b.league.country) || a.league.name.localeCompare(b.league.name) || a.kickoff.localeCompare(b.kickoff),
  ppg_home: (a, b) => (b.home.ppg ?? -1) - (a.home.ppg ?? -1) || a.kickoff.localeCompare(b.kickoff),
  ppg_away: (a, b) => (b.away.ppg ?? -1) - (a.away.ppg ?? -1) || a.kickoff.localeCompare(b.kickoff),
};

/** Orden por el mercado principal (el primero elegido). Los partidos sin dato van al final. */
function byMarket(sort: string, main: string | undefined): ((a: Row, b: Row) => number) | null {
  const field = { value: "value", real: "real", book: "book" }[sort] as "value" | "real" | "book" | undefined;
  if (!field || !main) return null;
  const desc = field !== "real"; // valor y cuota de la casa: mayor primero; cuota real: menor primero (más probable)
  return (a, b) => {
    const x = a.markets[main]?.[field] ?? null, y = b.markets[main]?.[field] ?? null;
    if (x === null || y === null) return x === y ? SORTS.time(a, b) : x === null ? 1 : -1;
    return (desc ? y - x : x - y) || SORTS.time(a, b);
  };
}

const confirmedAll = new Set<string>(); // días en que el usuario aceptó calcular todas las ligas
const ALWAYS_ALL = "cr:siempre-todas"; // "no volver a preguntar"

async function prematch(req: PrematchRequest): Promise<PrematchResponse> {
  await loadDay(req.date);
  const p = getProfile(req.profile_id);
  const markets = req.markets ?? p.fav_markets;
  const stats = (req.stats ?? p.fav_stats).slice(0, 3);
  const streaks = (req.streaks ?? p.fav_streaks).slice(0, 3);
  const bookmaker = req.bookmaker || p.fav_bookmakers[0] || BEST;
  const all = dayMatches(req.date).filter((m) => m.status !== "CANC");
  const countries = new Map<string, { country: string; code: string | null; flag: string | null; count: number; league_ids: Set<number> }>();
  for (const m of all) {
    const lg = repo.leagues.get(m.leagueId)!;
    const c = countries.get(lg.country) ?? { country: lg.country, code: null, flag: lg.flag, count: 0, league_ids: new Set<number>() };
    c.count++;
    c.league_ids.add(lg.id);
    countries.set(lg.country, c);
  }
  const fav = new Set(p.fav_leagues);
  const leagues = new Set(req.leagues);
  const selected = all.filter((m) => !leagues.size || leagues.has(m.leagueId));

  // Historial y cuotas: se piden solo para las ligas que se están mirando.
  const extra = extraSeasons(p);
  const needed = [...new Set(selected.map((m) => m.leagueId))];
  // lo que ya está guardado en el navegador se usa sin preguntar (no gasta consultas)
  await warmFromCache(needed.filter((l) => !leagueReady(l, extra)), extra);
  const missing = needed.filter((l) => !leagueReady(l, extra));
  if (req.load_all) confirmedAll.add(req.date);
  if (req.load_all === "always") LS.set(ALWAYS_ALL, true);
  const auto = missing.length <= AUTO_LOAD_MAX || confirmedAll.has(req.date) || LS.get(ALWAYS_ALL, false);
  if (auto) {
    ensureLeagues(missing, extra);
    ensureOdds(req.date, [...new Set(selected.filter((m) => m.status === "NS").map((m) => m.leagueId))]);
  }

  let rows = selected.map((m) => buildRow(m, p, markets, stats, streaks, bookmaker, leagueReady(m.leagueId, extra)));
  if (req.hide_without_odds && markets.length) rows = rows.filter((r) => r.markets[markets[0]]?.book != null);
  const hasFilters = !!req.filters && Object.keys(req.filters).length > 0;
  rows = rows.filter((r) => (r.pending && hasFilters ? false : rowPasses(r, req.filters)));
  rows.sort(byMarket(req.sort, markets[0]) ?? SORTS[req.sort] ?? SORTS.time);
  return {
    date: req.date, profile: { id: p.id, name: p.name }, markets, stats, streaks, bookmaker, rows,
    shown: rows.length, shown_leagues: new Set(rows.map((r) => r.league.id)).size,
    total: all.length, total_leagues: new Set(all.map((m) => m.leagueId)).size,
    favorites_count: all.filter((m) => !fav.size || fav.has(m.leagueId)).length,
    countries: [...countries.values()].map((c) => ({ ...c, league_ids: [...c.league_ids].sort((a, b) => a - b) }))
      .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country)),
    loading: repo.loading.size,
    pending_leagues: auto ? 0 : missing.length,
    pending_calls: auto ? 0 : missing.length * (extra + 1) + needed.length,
    errors: [...new Set(repo.errors)],
    mode: repo.mode,
    always_all: LS.get(ALWAYS_ALL, false),
  };
}

async function sample(id: number, profileId: number | null, marketKey: string): Promise<SampleResponse> {
  const m = repo.matches.get(id);
  if (!m) throw new Error("Partido no encontrado");
  const ro = getProfile(profileId).real_odds_profile!;
  const s = A.realOddsSample(history(), m, ro.sample, ro.home_as as A.Role, ro.away_as as A.Role);
  const mk = MARKETS_BY_KEY[marketKey] ?? MARKETS_BY_KEY.ou_ht_over_0_5;
  const res = A.realOdds(s.merged, mk);
  const used = new Set(A.usable(s.merged, mk).map((x) => x.id));
  const hs = new Set(s.home.map((x) => x.id)), as = new Set(s.away.map((x) => x.id));
  const { check, needs, ...market } = mk;
  return {
    match: { id, home: repo.teams.get(m.homeId)!, away: repo.teams.get(m.awayId)!, league: repo.leagues.get(m.leagueId)!.name, kickoff: m.kickoff },
    profile: { name: ro.name, sample: ro.sample, home_as: ro.home_as, away_as: ro.away_as },
    market, real: r2(res.odds), hits: res.hits, n: res.n, n_home: s.home.length, n_away: s.away.length,
    matches: s.merged.map((x) => ({
      id: x.id, date: x.kickoff, home: repo.teams.get(x.homeId)!, away: repo.teams.get(x.awayId)!,
      ft: [x.hg, x.ag], ht: [x.hthg, x.htag], hit: used.has(x.id) ? mk.check(x) : null,
      from: hs.has(x.id) && as.has(x.id) ? "both" : hs.has(x.id) ? "home" : "away",
    })),
  };
}

/** Partidos jugados de cada equipo antes del partido, y los enfrentamientos entre ellos. */
async function teamMatches(id: number, profileId: number | null, marketKey: string, scope: "league" | "all"): Promise<TeamMatchesResponse> {
  const m = repo.matches.get(id);
  if (!m) throw new Error("Partido no encontrado");
  const h = history();
  const mk = MARKETS_BY_KEY[marketKey] ?? MARKETS_BY_KEY.ou_ht_over_0_5;
  const ro = getProfile(profileId).real_odds_profile;
  const inSample = new Set(ro ? A.realOddsSample(h, m, ro.sample, ro.home_as as A.Role, ro.away_as as A.Role).merged.map((x) => x.id) : []);
  const leagueName = (lid: number, extra?: Map<number, string>) => repo.leagues.get(lid)?.name ?? extra?.get(lid) ?? "";
  const teamName = (tid: number, extra?: Map<number, string>) => repo.teams.get(tid) ?? extra?.get(tid) ?? "?";
  const before = (x: MatchData) => finished(x) && x.kickoff < m.kickoff && x.id !== m.id;
  const fmt = (list: MatchData[], team: number | null, ex?: { leagues: Map<number, string>; teams: Map<number, string> }) =>
    list.filter(before).sort((a, b) => b.kickoff.localeCompare(a.kickoff)).map((x) => {
      const f = x as FT;
      const res: TeamGame["result"] = team === null ? null : gf(f, team) > ga(f, team) ? "G" : gf(f, team) === ga(f, team) ? "E" : "P";
      const ok = !(mk.needs === "goals" && x.detail === false) && !(mk.needs === "corners" && x.hc === null);
      return {
        id: x.id, date: x.kickoff, league: leagueName(x.leagueId, ex?.leagues), same_league: x.leagueId === m.leagueId,
        home: teamName(x.homeId, ex?.teams), away: teamName(x.awayId, ex?.teams), home_id: x.homeId, away_id: x.awayId,
        ft: [f.hg, f.ag] as [number, number], ht: [f.hthg, f.htag] as [number, number], result: res,
        hit: ok ? mk.check(f) : null, in_sample: inSample.has(x.id),
      };
    });

  const fromHistory = (team: number) => h.teamMatches(m.leagueId, team, m.kickoff, "both", null);
  let home, away, h2h;
  if (scope === "all" && repo.mode === "api") {
    const [th, ta, hh] = await Promise.all([teamGames(m.homeId), teamGames(m.awayId), h2hGames(m.homeId, m.awayId)]);
    home = fmt(th.matches, m.homeId, th);
    away = fmt(ta.matches, m.awayId, ta);
    h2h = fmt(hh.matches, null, hh);
  } else {
    home = fmt(fromHistory(m.homeId), m.homeId);
    away = fmt(fromHistory(m.awayId), m.awayId);
    h2h = fmt(fromHistory(m.homeId).filter((x) => x.homeId === m.awayId || x.awayId === m.awayId), null);
  }
  const { check, needs, ...market } = mk;
  return {
    match: { id, home: teamName(m.homeId), away: teamName(m.awayId), home_id: m.homeId, away_id: m.awayId,
      league: leagueName(m.leagueId), kickoff: m.kickoff },
    market, scope: repo.mode === "api" ? scope : "league", can_all: repo.mode === "api", home, away, h2h,
  };
}

// --- Mis partidos (favoritos, historial y apuestas) ---------------------------------
export interface FavResult { ft: [number, number]; ht: [number | null, number | null]; hit: boolean | null }
export interface FavSnap {
  id: number; date: string; kickoff: string; league: string; country?: string; home: string; away: string; saved_at: string;
  market: string | null; real: number | null; real_n?: number; book: number | null; bookmaker: string | null; value: number | null;
  /** monto apostado (null = no aposté) y cuota a la que se tomó */
  stake?: number | null; odds_taken?: number | null;
  /** resultado guardado cuando terminó (queda en el historial aunque ya no se puedan bajar los datos) */
  result?: FavResult | null;
  updated_at?: number;
}
const FAVS = "cr:favoritos", DELETED = "cr:favoritos-borrados";
const favMap = () => LS.get<Record<string, FavSnap>>(FAVS, {});
const saveFavs = (f: Record<string, FavSnap>) => {
  LS.set(FAVS, f);
  try { window.dispatchEvent(new Event("cr:favs")); } catch { /* nada */ }
};
function favoriteIds(): Set<number> {
  return new Set(Object.values(favMap()).filter((x) => !x.result).map((x) => x.id));
}
const allFavoriteIds = () => new Set(Object.keys(favMap()).map(Number));
function markDeleted(id: number) {
  const d = LS.get<Record<string, number>>(DELETED, {});
  d[id] = Date.now();
  LS.set(DELETED, d);
}
/** Agrega o quita un partido de Mis partidos. Al agregarlo guarda las cuotas de ese momento. */
function toggleFavorite(r: Row, market?: string): Set<number> {
  const f = favMap();
  if (f[r.id]) { delete f[r.id]; markDeleted(r.id); }
  else {
    const c = market ? r.markets[market] : undefined;
    f[r.id] = {
      id: r.id, date: r.kickoff.slice(0, 10), kickoff: r.kickoff, league: r.league.name, country: r.league.country,
      home: r.home.name, away: r.away.name, saved_at: new Date().toISOString(), market: market ?? null,
      real: c?.real ?? null, real_n: c?.n, book: c?.book ?? null, bookmaker: c?.bookmaker ?? null, value: c?.value ?? null,
      stake: null, odds_taken: c?.book ?? null, result: null, updated_at: Date.now(),
    };
  }
  saveFavs(f);
  return allFavoriteIds();
}
function deleteFavorite(id: number): void {
  const f = favMap();
  delete f[id];
  markDeleted(id);
  saveFavs(f);
}
/** Anota cuánto se apostó y a qué cuota (stake null = no aposté). */
function setBet(id: number, stake: number | null, oddsTaken: number | null): void {
  const f = favMap();
  if (!f[id]) return;
  f[id] = { ...f[id], stake, odds_taken: oddsTaken, updated_at: Date.now() };
  saveFavs(f);
}

export interface FavoritesResponse {
  rows: Row[]; markets: string[]; stats: string[]; streaks: string[];
  saved: Record<number, FavSnap>; history: FavSnap[]; missing: FavSnap[]; loading: number;
}

/** Próximos (recalculados con el perfil activo) e historial de los ya terminados. */
async function favorites(): Promise<FavoritesResponse> {
  const f = favMap();
  const pending = Object.values(f).filter((x) => !x.result);
  await Promise.all([...new Set(pending.map((x) => x.date))].map((d) => loadDay(d).catch(() => undefined)));
  // los que terminaron pasan al historial con su resultado
  let changed = false;
  for (const x of pending) {
    const m = repo.matches.get(x.id);
    if (!m || !finished(m)) continue;
    const mk = MARKETS_BY_KEY[x.market ?? "ou_ht_over_0_5"];
    const ok = mk && !(mk.needs === "goals" && m.detail === false) && !(mk.needs === "corners" && m.hc === null);
    f[x.id] = { ...x, result: { ft: [m.hg, m.ag], ht: [m.hthg, m.htag], hit: ok ? mk.check(m) : null }, updated_at: Date.now() };
    changed = true;
  }
  if (changed) saveFavs(f);

  const p = getProfile(null);
  const markets = p.fav_markets, stats = p.fav_stats.slice(0, 3), streaks = p.fav_streaks.slice(0, 3);
  const bookmaker = p.fav_bookmakers[0] || BEST;
  const upcoming = Object.values(f).filter((x) => !x.result);
  const found = upcoming.map((x) => repo.matches.get(x.id)).filter((m): m is MatchData => !!m);
  const extra = extraSeasons(p);
  const leagues = [...new Set(found.map((m) => m.leagueId))];
  await warmFromCache(leagues, extra);
  ensureLeagues(leagues.filter((l) => !leagueReady(l, extra)), extra);
  for (const d of new Set(found.filter((m) => m.status === "NS").map((m) => m.kickoff.slice(0, 10))))
    ensureOdds(d, [...new Set(found.filter((m) => m.kickoff.startsWith(d)).map((m) => m.leagueId))]);
  const rows = found.map((m) => buildRow(m, p, markets, stats, streaks, bookmaker, leagueReady(m.leagueId, extra)))
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  return {
    rows, markets, stats, streaks, saved: f as unknown as Record<number, FavSnap>,
    history: Object.values(f).filter((x) => x.result).sort((a, b) => b.kickoff.localeCompare(a.kickoff)),
    missing: upcoming.filter((x) => !repo.matches.has(x.id)), loading: repo.loading.size,
  };
}

async function odds(id: number, markets: string[]): Promise<OddsResponse> {
  const om = repo.odds[id] ?? {};
  const keys = markets.length ? markets : MARKETS.map((m) => m.key).filter((k) => om[k]);
  return {
    bookmakers: BOOKMAKER_KEYS,
    rows: keys.map((k) => {
      const prices = om[k] ?? {};
      const vals = Object.values(prices);
      const { check, needs, ...market } = MARKETS_BY_KEY[k] ?? { key: k, name: k, group: "", category: "", popular: false, check: null, needs: undefined };
      return { market, prices: Object.fromEntries(BOOKMAKER_KEYS.map((b) => [b, prices[b] ?? null])), best: vals.length ? Math.max(...vals) : null };
    }),
  };
}

// --- API local ----------------------------------------------------------------
const ok = <T,>(v: T) => Promise.resolve(v);
const strip = <T extends { check: unknown; needs?: unknown }>({ check, needs, ...rest }: T) => rest;

export const localApi = {
  meta: async (): Promise<Meta> => repo.mode === "api"
    ? { provider: "api_football", generated_at: new Date().toISOString(), today: new Date().toLocaleDateString("en-CA") }
    : { provider: "seed", generated_at: repo.demoMeta?.generated_at ?? new Date().toISOString(), today: repo.demoMeta?.today ?? "" },
  catalog: (): Promise<Catalog> => ok({
    markets: MARKETS.map(strip), market_categories: CATEGORIES,
    stats: STATS.map(({ key, name }) => ({ key, name })), streaks: STREAKS.map(({ key, name }) => ({ key, name })),
    bookmakers: [{ key: BEST, name: "Mejor cuota" }, ...BOOKMAKERS],
    samples: [
      { key: "last_8", name: "Últimos 8" }, { key: "current", name: "Temporada actual" },
      { key: "current_plus_1", name: "Actual + 1 anterior" }, { key: "current_plus_2", name: "Actual + 2 anteriores" },
      { key: "current_plus_3", name: "Actual + 3 anteriores" },
    ],
  }),
  leagues: async (): Promise<LeagueNode[]> => {
    const out = new Map<string, LeagueNode>();
    for (const lg of [...repo.leagues.values()].sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name))) {
      if (!out.has(lg.country)) out.set(lg.country, { country: lg.country, code: null, leagues: [] });
      out.get(lg.country)!.leagues.push({ id: lg.id, name: lg.name });
    }
    return [...out.values()];
  },
  health: async () => ({ ok: true, provider: repo.mode === "api" ? "api_football" : "seed" }),
  onChange,
  refresh,
  settings: {
    keySource: AF.keySource,
    hasKey: () => !!AF.getKey(),
    mode: () => repo.mode,
    async saveKey(k: string) {
      const st = await AF.trySetKey(k);
      setMode("api");
      return st;
    },
    removeKey() { AF.setKey(""); setMode(AF.getKey() ? "api" : "demo"); },
    status: AF.status,
    usage: () => ({ ...AF.usage }),
    alwaysAll: () => LS.get(ALWAYS_ALL, false),
    setAlwaysAll: (v: boolean) => LS.set(ALWAYS_ALL, v),
    useDemo(on: boolean) { setMode(on || !AF.getKey() ? "demo" : "api"); },
    async clearCache() { await Cache.clear(); setMode(repo.mode); },
  },
  profiles: () => ok(loadStore().profiles.map(fullProfile)),
  createProfile: (b: Partial<UserProfile>) => {
    const s = loadStore();
    const p = { id: newId(s), is_active: false, ...clean(b) };
    s.profiles.push(p);
    save(s);
    return ok(fullProfile(p));
  },
  saveProfile: (id: number, b: Partial<UserProfile>) => {
    const s = loadStore();
    const p = s.profiles.find((x) => x.id === id);
    if (!p) return Promise.reject(new Error("Perfil no encontrado"));
    Object.assign(p, clean(b));
    save(s);
    return ok(fullProfile(p));
  },
  activateProfile: (id: number) => {
    const s = loadStore();
    s.profiles.forEach((p) => (p.is_active = p.id === id));
    save(s);
    return ok(fullProfile(s.profiles.find((p) => p.id === id)!));
  },
  deleteProfile: (id: number) => {
    const s = loadStore();
    if (s.profiles.length <= 1) return Promise.reject(new Error("No se puede borrar el único perfil"));
    const was = s.profiles.find((p) => p.id === id)?.is_active;
    s.profiles = s.profiles.filter((p) => p.id !== id);
    if (was) s.profiles[0].is_active = true;
    save(s);
    return ok({ ok: true });
  },
  subprofiles: <T,>(k: SubKind) => ok(loadStore().subs[k] as unknown as T[]),
  createSub: <T,>(k: SubKind, b: any) => {
    const s = loadStore();
    if (!String(b.name ?? "").trim()) return Promise.reject(new Error("Falta el nombre"));
    const o = { ...b, name: String(b.name).trim(), id: newId(s) };
    s.subs[k].push(o);
    save(s);
    return ok(o as T);
  },
  updateSub: <T,>(k: SubKind, id: number, b: any) => {
    const s = loadStore();
    const i = s.subs[k].findIndex((x) => x.id === id);
    if (i < 0) return Promise.reject(new Error("No encontrado"));
    s.subs[k][i] = { ...b, name: String(b.name).trim(), id };
    save(s);
    return ok(s.subs[k][i] as unknown as T);
  },
  deleteSub: (k: SubKind, id: number) => {
    const s = loadStore();
    const using = s.profiles.filter((p) => p[FK[k] as "ppg_profile_id"] === id).map((p) => p.name);
    if (using.length) return Promise.reject(new Error(`Está en uso por: ${using.join(", ")}`));
    s.subs[k] = s.subs[k].filter((x) => x.id !== id) as any;
    save(s);
    return ok({ ok: true });
  },
  prematch,
  sample,
  teamMatches,
  favoriteIds,
  allFavoriteIds,
  toggleFavorite,
  deleteFavorite,
  setBet,
  favorites,
  odds,
  presets: () => ok([...loadStore().presets].sort((a, b) => a.name.localeCompare(b.name))),
  savePreset: (name: string, config: PresetConfig) => {
    const s = loadStore();
    let p = s.presets.find((x) => x.name === name);
    if (!p) s.presets.push((p = { id: newId(s), name, config }));
    p.config = config;
    save(s);
    return ok(p as Preset);
  },
  deletePreset: (id: number) => {
    const s = loadStore();
    s.presets = s.presets.filter((p) => p.id !== id);
    save(s);
    return ok({ ok: true });
  },
};
