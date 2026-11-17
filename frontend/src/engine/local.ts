/** Implementación local (en el navegador) de la API: lee data/datos.json y calcula todo acá. */
import type {
  Catalog, LeagueNode, OddsResponse, Preset, PresetConfig, PrematchRequest, PrematchResponse, Row, SampleResponse, SubKind, UserProfile,
} from "../api";
import * as A from "./analysis";
import { BEST, BOOKMAKERS, BOOKMAKER_KEYS, CATEGORIES, MARKETS, MARKETS_BY_KEY, STATS, STATS_BY_KEY, STREAKS, STREAKS_BY_KEY } from "./catalog";
import { rowPasses } from "./filters";
import { load as loadStore, newId, save } from "./store";
import { MatchData } from "./types";

export interface Meta { generated_at: string; provider: string; today: string; leagues_synced?: string[] }
interface RawData {
  meta: Meta;
  leagues: [number, string, string, string | null][];
  seasons: [number, number, number, string][];
  teams: Record<string, string>;
  matches: (number | string | null)[][];
  odds: Record<string, Record<string, Record<string, number>>>;
}
interface League { id: number; name: string; country: string; code: string | null }
interface DB {
  meta: Meta;
  leagues: Map<number, League>;
  teams: Map<number, string>;
  matches: Map<number, MatchData>;
  byDay: Map<string, MatchData[]>;
  odds: RawData["odds"];
  history: A.History;
}

let dbPromise: Promise<DB> | null = null;

function parseGoals(s: string | null): MatchData["goals"] {
  if (!s) return [];
  return s.split(" ").map((g) => {
    const mt = /^(\d+)([ha])(\d)$/.exec(g)!;
    return { minute: Number(mt[1]), side: mt[2] === "h" ? "home" : "away", half: Number(mt[3]) };
  });
}

async function db(): Promise<DB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const r = await fetch(`${import.meta.env.BASE_URL}data/datos.json`, { cache: "no-cache" });
      if (!r.ok) throw new Error("No se encontraron los datos (data/datos.json). Corré “Actualizar datos”.");
      const raw = (await r.json()) as RawData;
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      const matches = new Map<number, MatchData>();
      const byDay = new Map<string, MatchData[]>();
      for (const x of raw.matches) {
        const m: MatchData = {
          id: Number(x[0]), leagueId: Number(x[1]), seasonId: Number(x[2]), kickoff: String(x[3]),
          homeId: Number(x[4]), awayId: Number(x[5]), status: String(x[6]),
          hg: n(x[7]), ag: n(x[8]), hthg: n(x[9]), htag: n(x[10]),
          hc: n(x[11]), ac: n(x[12]), hs: n(x[13]), as: n(x[14]), hsot: n(x[15]), asot: n(x[16]),
          hda: n(x[17]), ada: n(x[18]), hy: n(x[19]), ay: n(x[20]), goals: parseGoals(x[21] as string | null),
        };
        matches.set(m.id, m);
        const d = m.kickoff.slice(0, 10);
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d)!.push(m);
      }
      const order: Record<number, number[]> = {};
      for (const [id, lg] of [...raw.seasons].sort((a, b) => a[1] - b[1] || a[2] - b[2])) (order[lg] ||= []).push(id);
      return {
        meta: raw.meta,
        leagues: new Map(raw.leagues.map(([id, name, country, code]) => [id, { id, name, country, code }])),
        teams: new Map(Object.entries(raw.teams).map(([k, v]) => [Number(k), v])),
        matches, byDay, odds: raw.odds,
        history: new A.History([...matches.values()], order),
      };
    })();
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

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

function buildRow(d: DB, m: MatchData, p: UserProfile, markets: string[], stats: string[], streaks: string[], bookmaker: string): Row {
  const ro = p.real_odds_profile, pp = p.ppg_profile, sp = p.stats_profile, kp = p.streaks_profile;
  const sample = ro ? A.realOddsSample(d.history, m, ro.sample, ro.home_as as A.Role, ro.away_as as A.Role) : { home: [], away: [], merged: [] };
  const lg = d.leagues.get(m.leagueId)!;
  const row: Row = {
    id: m.id, kickoff: m.kickoff, status: m.status,
    league: { id: lg.id, name: lg.name, country: lg.country, country_code: lg.code },
    home: { id: m.homeId, name: d.teams.get(m.homeId) ?? "?", ppg: r2(A.ppg(d.history, m, m.homeId, (pp?.home_as ?? "both") as A.Role)) },
    away: { id: m.awayId, name: d.teams.get(m.awayId) ?? "?", ppg: r2(A.ppg(d.history, m, m.awayId, (pp?.away_as ?? "both") as A.Role)) },
    score: (m.status === "FT" || m.status === "LIVE") && m.hg !== null ? { ft: [m.hg, m.ag!], ht: [m.hthg, m.htag] } : null,
    sample_n: sample.merged.length, sample_home_n: sample.home.length, sample_away_n: sample.away.length,
    markets: {}, stats: {}, streaks: {},
  };
  for (const k of markets) {
    const mk = MARKETS_BY_KEY[k];
    if (!mk) continue;
    const res = A.realOdds(sample.merged, mk);
    const [book, bk] = bookPrice(d.odds[m.id]?.[k], bookmaker);
    row.markets[k] = { real: r2(res.odds), prob: r2(res.prob, 4), hits: res.hits, n: res.n, book, bookmaker: bk, value: r2(A.valuePct(book, res.odds), 1) };
  }
  for (const k of stats) {
    const st = STATS_BY_KEY[k];
    if (!st || !sp) continue;
    const [h, nh] = A.teamStat(d.history, m, m.homeId, sp.home_as as A.Role, sp.seasons, st);
    const [a, na] = A.teamStat(d.history, m, m.awayId, sp.away_as as A.Role, sp.seasons, st);
    row.stats[k] = { home: r2(h), away: r2(a), avg: r2(A.avgOf(h, a)), n_home: nh, n_away: na };
  }
  for (const k of streaks) {
    const sd = STREAKS_BY_KEY[k];
    if (!sd || !kp) continue;
    row.streaks[k] = {
      home: A.teamStreak(d.history, m, m.homeId, kp.home_as as A.Role, kp.seasons, sd),
      away: A.teamStreak(d.history, m, m.awayId, kp.away_as as A.Role, kp.seasons, sd),
    };
  }
  return row;
}

const SORTS: Record<string, (a: Row, b: Row) => number> = {
  time: (a, b) => a.kickoff.localeCompare(b.kickoff) || a.league.name.localeCompare(b.league.name),
  league: (a, b) => a.league.country.localeCompare(b.league.country) || a.league.name.localeCompare(b.league.name) || a.kickoff.localeCompare(b.kickoff),
  ppg_home: (a, b) => (b.home.ppg ?? -1) - (a.home.ppg ?? -1) || a.kickoff.localeCompare(b.kickoff),
  ppg_away: (a, b) => (b.away.ppg ?? -1) - (a.away.ppg ?? -1) || a.kickoff.localeCompare(b.kickoff),
};

async function prematch(req: PrematchRequest): Promise<PrematchResponse> {
  const d = await db();
  const p = getProfile(req.profile_id);
  const markets = req.markets ?? p.fav_markets;
  const stats = (req.stats ?? p.fav_stats).slice(0, 3);
  const streaks = (req.streaks ?? p.fav_streaks).slice(0, 3);
  const bookmaker = req.bookmaker || p.fav_bookmakers[0] || BEST;
  const all = (d.byDay.get(req.date) ?? []).filter((m) => m.status !== "CANC");
  const countries = new Map<string, { country: string; code: string | null; count: number; league_ids: Set<number> }>();
  for (const m of all) {
    const lg = d.leagues.get(m.leagueId)!;
    const c = countries.get(lg.country) ?? { country: lg.country, code: lg.code, count: 0, league_ids: new Set<number>() };
    c.count++;
    c.league_ids.add(lg.id);
    countries.set(lg.country, c);
  }
  const fav = new Set(p.fav_leagues);
  const leagues = new Set(req.leagues);
  let rows = all.filter((m) => !leagues.size || leagues.has(m.leagueId)).map((m) => buildRow(d, m, p, markets, stats, streaks, bookmaker));
  if (req.hide_without_odds && markets.length) rows = rows.filter((r) => r.markets[markets[0]]?.book != null);
  rows = rows.filter((r) => rowPasses(r, req.filters)).sort(SORTS[req.sort] ?? SORTS.time);
  return {
    date: req.date, profile: { id: p.id, name: p.name }, markets, stats, streaks, bookmaker, rows,
    shown: rows.length, shown_leagues: new Set(rows.map((r) => r.league.id)).size,
    total: all.length, total_leagues: new Set(all.map((m) => m.leagueId)).size,
    favorites_count: all.filter((m) => !fav.size || fav.has(m.leagueId)).length,
    countries: [...countries.values()].map((c) => ({ ...c, league_ids: [...c.league_ids].sort((a, b) => a - b) }))
      .sort((a, b) => a.country.localeCompare(b.country)),
  };
}

async function sample(id: number, profileId: number | null, marketKey: string): Promise<SampleResponse> {
  const d = await db();
  const m = d.matches.get(id);
  if (!m) throw new Error("Partido no encontrado");
  const ro = getProfile(profileId).real_odds_profile!;
  const s = A.realOddsSample(d.history, m, ro.sample, ro.home_as as A.Role, ro.away_as as A.Role);
  const mk = MARKETS_BY_KEY[marketKey] ?? MARKETS_BY_KEY.ou_ht_over_0_5;
  const res = A.realOdds(s.merged, mk);
  const hs = new Set(s.home.map((x) => x.id)), as = new Set(s.away.map((x) => x.id));
  const { check, ...market } = mk;
  return {
    match: { id, home: d.teams.get(m.homeId)!, away: d.teams.get(m.awayId)!, league: d.leagues.get(m.leagueId)!.name, kickoff: m.kickoff },
    profile: { name: ro.name, sample: ro.sample, home_as: ro.home_as, away_as: ro.away_as },
    market, real: r2(res.odds), hits: res.hits, n: s.merged.length, n_home: s.home.length, n_away: s.away.length,
    matches: s.merged.map((x) => ({
      id: x.id, date: x.kickoff, home: d.teams.get(x.homeId)!, away: d.teams.get(x.awayId)!,
      ft: [x.hg, x.ag], ht: [x.hthg, x.htag], hit: mk.check(x),
      from: hs.has(x.id) && as.has(x.id) ? "both" : hs.has(x.id) ? "home" : "away",
    })),
  };
}

async function odds(id: number, markets: string[]): Promise<OddsResponse> {
  const d = await db();
  const om = d.odds[id] ?? {};
  const keys = markets.length ? markets : MARKETS.map((m) => m.key).filter((k) => om[k]);
  return {
    bookmakers: BOOKMAKER_KEYS,
    rows: keys.map((k) => {
      const prices = om[k] ?? {};
      const vals = Object.values(prices);
      const { check, ...market } = MARKETS_BY_KEY[k] ?? { key: k, name: k, group: "", category: "", popular: false, check: null };
      return { market, prices: Object.fromEntries(BOOKMAKER_KEYS.map((b) => [b, prices[b] ?? null])), best: vals.length ? Math.max(...vals) : null };
    }),
  };
}

// --- API local ----------------------------------------------------------------
const ok = <T,>(v: T) => Promise.resolve(v);
const strip = <T extends { check: unknown }>({ check, ...rest }: T) => rest;

export const localApi = {
  meta: async () => (await db()).meta,
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
    const d = await db();
    const out = new Map<string, LeagueNode>();
    for (const lg of [...d.leagues.values()].sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name))) {
      if (!out.has(lg.country)) out.set(lg.country, { country: lg.country, code: lg.code, leagues: [] });
      out.get(lg.country)!.leagues.push({ id: lg.id, name: lg.name });
    }
    return [...out.values()];
  },
  health: async () => ({ ok: true, provider: (await db()).meta.provider }),
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
