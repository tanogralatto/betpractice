/** Conexión directa a API-Football v3 desde el navegador (igual que las otras apps). */
import { LS } from "./storage";
import mapping from "./oddsMapping.json";
import { MARKETS_BY_KEY } from "../engine/catalog";
import type { MatchData } from "../engine/types";

const API = "https://v3.football.api-sports.io";
export const TZ = "America/Argentina/Buenos_Aires";
const KEY = "cr:key";
const OTHER_APP_KEY = "o05:key"; // clave guardada por tus otras apps en este mismo sitio
const CONC = 2; // consultas en paralelo (más choca con el límite por minuto)

// --- clave ------------------------------------------------------------------
export function getKey(): string {
  return LS.get<string>(KEY, "") || LS.get<string>(OTHER_APP_KEY, "") || "";
}
export function keySource(): "propia" | "otra-app" | null {
  if (LS.get<string>(KEY, "")) return "propia";
  if (LS.get<string>(OTHER_APP_KEY, "")) return "otra-app";
  return null;
}
export function setKey(k: string): void {
  if (k.trim()) LS.set(KEY, k.trim());
  else LS.del(KEY);
}
/** Guarda la clave solo si API-Football la acepta. */
export async function trySetKey(k: string) {
  const prev = LS.get<string>(KEY, "");
  setKey(k);
  try {
    return await status();
  } catch (e) {
    setKey(prev);
    throw e;
  }
}

// --- consultas ----------------------------------------------------------------
export const usage = { calls: 0, current: null as number | null, limit: null as number | null };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= CONC) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export class ApiError extends Error {
  constructor(msg: string, public fatal = false) { super(msg); }
}

async function get(path: string, params: Record<string, string | number> = {}): Promise<any> {
  const key = getKey();
  if (!key) throw new ApiError("Falta tu clave de API-Football. Cargala en ⚙ Ajustes.", true);
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return slot(async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, { headers: { "x-apisports-key": key } });
      } catch {
        await sleep(5000 * (attempt + 1));
        continue;
      }
      if (path !== "/status") usage.calls++;
      if (res.status === 429) { await sleep(15000); continue; }
      if (res.status >= 500) { await sleep(5000); continue; }
      const j = await res.json();
      const errs = j.errors;
      const has = errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length);
      if (has) {
        const keys = Array.isArray(errs) ? "" : Object.keys(errs).join(" ");
        const msg = Array.isArray(errs) ? errs.join(", ") : Object.values(errs).join(", ");
        if (/rateLimit/i.test(keys)) { await sleep(10000); continue; }
        throw new ApiError(msg, /token|requests|access|plan|suspend/i.test(keys + " " + msg));
      }
      return j;
    }
    throw new ApiError("API-Football no respondió (límite de consultas por minuto). Probá de nuevo en un rato.");
  });
}

async function getAll(path: string, params: Record<string, string | number>): Promise<any[]> {
  const first = await get(path, params);
  const out = [...(first.response ?? [])];
  const total = first.paging?.total ?? 1;
  for (let p = 2; p <= total; p++) out.push(...((await get(path, { ...params, page: p })).response ?? []));
  return out;
}

export async function status(): Promise<{ plan: string; current: number; limit: number }> {
  const j = await get("/status");
  const r = j.response ?? {};
  usage.current = r.requests?.current ?? null;
  usage.limit = r.requests?.limit_day ?? null;
  return { plan: r.subscription?.plan ?? "", current: usage.current ?? 0, limit: usage.limit ?? 0 };
}

// --- partidos -----------------------------------------------------------------
export interface LeagueInfo { id: number; name: string; country: string; flag: string | null; logo: string | null; season: number }
export interface TeamInfo { id: number; name: string }
export interface FixturePack { matches: MatchData[]; leagues: LeagueInfo[]; teams: TeamInfo[] }

// API-Football devuelve los países en inglés
const COUNTRY_ES: Record<string, string> = {
  England: "Inglaterra", Spain: "España", Italy: "Italia", Germany: "Alemania", France: "Francia", Netherlands: "Países Bajos",
  Belgium: "Bélgica", Brazil: "Brasil", Scotland: "Escocia", Wales: "Gales", "Northern-Ireland": "Irlanda del Norte",
  Ireland: "Irlanda", Turkey: "Turquía", Greece: "Grecia", Switzerland: "Suiza", Denmark: "Dinamarca", Sweden: "Suecia",
  Norway: "Noruega", Finland: "Finlandia", Poland: "Polonia", Mexico: "México", USA: "Estados Unidos", Canada: "Canadá",
  Japan: "Japón", "South-Korea": "Corea del Sur", China: "China", World: "Mundo", Peru: "Perú", "Czech-Republic": "República Checa",
  Croatia: "Croacia", Serbia: "Serbia", Romania: "Rumania", Hungary: "Hungría", Russia: "Rusia", Ukraine: "Ucrania",
  "Saudi-Arabia": "Arabia Saudita", Egypt: "Egipto", Morocco: "Marruecos", Australia: "Australia", "Costa-Rica": "Costa Rica",
  "El-Salvador": "El Salvador", Panama: "Panamá", Bolivia: "Bolivia", Venezuela: "Venezuela", Colombia: "Colombia",
  Ecuador: "Ecuador", Paraguay: "Paraguay", Uruguay: "Uruguay", Chile: "Chile", Argentina: "Argentina", Portugal: "Portugal",
  Austria: "Austria", Slovakia: "Eslovaquia", Slovenia: "Eslovenia", Bulgaria: "Bulgaria", Iceland: "Islandia",
};
const countryEs = (c: string) => COUNTRY_ES[c] ?? c.replace(/-/g, " ");

const FINISHED = new Set(["FT", "AET", "PEN"]);
const LIVE = new Set(["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"]);
const status_ = (s: string) => (FINISHED.has(s) ? "FT" : LIVE.has(s) ? "LIVE" : s === "NS" || s === "TBD" ? "NS" : s === "PST" ? "PST" : "CANC");
const localKickoff = (iso: string) =>
  new Date(iso).toLocaleString("sv-SE", { timeZone: TZ, hour12: false }).slice(0, 16).replace(" ", "T");

export function parseFixtures(items: any[]): FixturePack {
  const leagues = new Map<number, LeagueInfo>(), teams = new Map<number, TeamInfo>();
  const matches: MatchData[] = [];
  for (const it of items) {
    const st = status_(it.fixture?.status?.short ?? "");
    const ft = it.score?.fulltime ?? {}, ht = it.score?.halftime ?? {}, g = it.goals ?? {};
    const lg = it.league;
    leagues.set(lg.id, { id: lg.id, name: lg.name, country: countryEs(lg.country ?? "World"), flag: lg.flag ?? null, logo: lg.logo ?? null, season: lg.season });
    teams.set(it.teams.home.id, { id: it.teams.home.id, name: it.teams.home.name });
    teams.set(it.teams.away.id, { id: it.teams.away.id, name: it.teams.away.name });
    const hg = st === "NS" ? null : ft.home ?? g.home ?? null;
    const ag = st === "NS" ? null : ft.away ?? g.away ?? null;
    matches.push({
      id: it.fixture.id, leagueId: lg.id, seasonId: lg.season, kickoff: localKickoff(it.fixture.date),
      homeId: it.teams.home.id, awayId: it.teams.away.id, status: st,
      hg, ag, hthg: ht.home ?? null, htag: ht.away ?? null, goals: [], detail: false,
      hc: null, ac: null, hs: null, as: null, hsot: null, asot: null, hda: null, ada: null, hy: null, ay: null,
    });
  }
  return { matches, leagues: [...leagues.values()], teams: [...teams.values()] };
}

export const fixturesByDate = async (day: string) => parseFixtures(await getAll("/fixtures", { date: day, timezone: TZ }));
export const fixturesBySeason = async (league: number, season: number) =>
  parseFixtures(await getAll("/fixtures", { league, season, timezone: TZ }));

/** Últimos partidos de un equipo en todas las competiciones (1 consulta). */
export const teamLast = async (team: number, last = 40) => parseFixtures(await getAll("/fixtures", { team, last, timezone: TZ }));
/** Enfrentamientos directos entre dos equipos (1 consulta). */
export const headToHead = async (a: number, b: number, last = 10) =>
  parseFixtures(await getAll("/fixtures/headtohead", { h2h: `${a}-${b}`, last, timezone: TZ }));

// --- cuotas -------------------------------------------------------------------
type Bets = Record<string, [Record<string, string>, [RegExp, string][]]>;
const BOOKS: Record<string, string> = Object.fromEntries(Object.entries(mapping.bookmakers).map(([k, v]) => [k.toLowerCase(), v]));
const IGNORE = new Set(mapping.ignore_bets.map((b) => b.toLowerCase()));
const BETS: Bets = {};
for (const [bet, values] of Object.entries(mapping.bets as Record<string, Record<string, string>>)) {
  const exact: Record<string, string> = {}, pats: [RegExp, string][] = [];
  for (const [val, target] of Object.entries(values)) {
    if (val.includes("{")) {
      const rx = val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace("\\{line\\}", "(?<line>\\d+(?:\\.\\d+)?)").replace("\\{h\\}", "(?<h>\\d+)").replace("\\{a\\}", "(?<a>\\d+)");
      pats.push([new RegExp(`^${rx}$`, "i"), target]);
    } else exact[val.toLowerCase()] = target;
  }
  BETS[bet.toLowerCase()] = [exact, pats];
}

export function mapMarket(bet: string, value: string): string | null {
  const b = (bet || "").toLowerCase();
  if (IGNORE.has(b) || !BETS[b]) return null;
  const [exact, pats] = BETS[b];
  const v = String(value).trim();
  let t: string | null = exact[v.toLowerCase()] ?? null;
  if (!t) {
    for (const [rx, tpl] of pats) {
      const m = rx.exec(v);
      if (m) {
        const g = m.groups ?? {};
        const k = g.line ? Number(g.line).toFixed(1).replace(".", "_") : "";
        t = tpl.replace("{k}", k).replace("{h}", g.h ?? "").replace("{a}", g.a ?? "").replace("{line}", g.line ?? "");
        break;
      }
    }
  }
  return t && MARKETS_BY_KEY[t] ? t : null;
}

export type OddsMap = Record<number, Record<string, Record<string, number>>>;

export function parseOdds(items: any[]): OddsMap {
  const out: OddsMap = {};
  for (const it of items) {
    const fid = it.fixture.id;
    for (const bm of it.bookmakers ?? []) {
      const bk = BOOKS[(bm.name ?? "").toLowerCase()];
      if (!bk) continue;
      for (const bet of bm.bets ?? []) {
        for (const v of bet.values ?? []) {
          const mk = mapMarket(bet.name, v.value);
          const price = Number(v.odd);
          if (!mk || !Number.isFinite(price)) continue;
          ((out[fid] ||= {})[mk] ||= {})[bk] = price;
        }
      }
    }
  }
  return out;
}

export const oddsByDate = async (day: string, league: number, season: number) =>
  parseOdds(await getAll("/odds", { date: day, league, season, timezone: TZ }));
