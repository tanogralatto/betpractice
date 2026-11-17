/** Motor de cálculo (equivale a backend/app/services/analysis.py). */
import { MarketDef, StatDef, StreakDef } from "./catalog";
import { FT, MatchData, finished, ga, gf } from "./types";

export type Role = "home" | "away" | "both" | "ignore";

export class History {
  private byTeam = new Map<string, FT[]>();

  /** seasonOrder: por competición, ids de temporada de la más vieja a la más nueva. */
  constructor(matches: MatchData[], public seasonOrder: Record<number, number[]>) {
    for (const m of matches) {
      if (!finished(m)) continue;
      for (const t of [m.homeId, m.awayId]) {
        const k = `${m.leagueId}:${t}`;
        if (!this.byTeam.has(k)) this.byTeam.set(k, []);
        this.byTeam.get(k)!.push(m);
      }
    }
    for (const lst of this.byTeam.values()) lst.sort((a, b) => (a.kickoff < b.kickoff ? -1 : a.kickoff > b.kickoff ? 1 : a.id - b.id));
  }

  /** Temporada del partido + `extra` temporadas anteriores de la misma competición. */
  seasonWindow(leagueId: number, seasonId: number, extra: number): Set<number> {
    const order = this.seasonOrder[leagueId] ?? [];
    const i = order.indexOf(seasonId);
    if (i < 0) return new Set([seasonId]);
    return new Set(order.slice(Math.max(0, i - extra), i + 1));
  }

  /** Partidos terminados del equipo en la competición, anteriores a `before`, del más reciente al más viejo. */
  teamMatches(leagueId: number, teamId: number, before: string, role: Role, seasons: Set<number> | null, limit: number | null = null): FT[] {
    if (role === "ignore") return [];
    const lst = this.byTeam.get(`${leagueId}:${teamId}`) ?? [];
    const out: FT[] = [];
    for (let i = lst.length - 1; i >= 0; i--) {
      const m = lst[i];
      if (m.kickoff >= before) continue;
      if (seasons && !seasons.has(m.seasonId)) continue;
      if (role === "home" && m.homeId !== teamId) continue;
      if (role === "away" && m.awayId !== teamId) continue;
      out.push(m);
      if (limit !== null && out.length >= limit) break;
    }
    return out;
  }
}

const EXTRA: Record<string, number> = { current: 0, current_plus_1: 1, current_plus_2: 2, current_plus_3: 3 };

export interface Sample { home: FT[]; away: FT[]; merged: FT[] }

export function realOddsSample(h: History, m: MatchData, sample: string, homeAs: Role, awayAs: Role): Sample {
  const seasons = sample === "last_8" ? null : h.seasonWindow(m.leagueId, m.seasonId, EXTRA[sample] ?? 0);
  const limit = sample === "last_8" ? 8 : null;
  const home = h.teamMatches(m.leagueId, m.homeId, m.kickoff, homeAs, seasons, limit);
  const away = h.teamMatches(m.leagueId, m.awayId, m.kickoff, awayAs, seasons, limit);
  // Unión + quitar duplicados por id (si se enfrentaron entre sí cuenta una vez). No se promedian porcentajes.
  const seen = new Map<number, FT>();
  for (const x of [...home, ...away]) if (!seen.has(x.id)) seen.set(x.id, x);
  const merged = [...seen.values()].sort((a, b) => (a.kickoff > b.kickoff ? -1 : a.kickoff < b.kickoff ? 1 : b.id - a.id));
  return { home, away, merged };
}

export interface RealOdds { odds: number | null; prob: number | null; hits: number; n: number }

/** Partidos de la muestra que tienen el dato que necesita el mercado. */
export const usable = (sample: FT[], market: MarketDef) =>
  market.needs === "goals" ? sample.filter((m) => m.detail !== false)
    : market.needs === "corners" ? sample.filter((m) => m.hc !== null && m.ac !== null)
    : sample;

export function realOdds(all: FT[], market: MarketDef): RealOdds {
  const sample = usable(all, market);
  const n = sample.length;
  if (!n) return { odds: null, prob: null, hits: 0, n: 0 };
  const hits = sample.filter((m) => market.check(m)).length;
  const p = hits / n;
  return { odds: p > 0 ? 1 / p : null, prob: p, hits, n };
}

/** Valor % = cuota de la casa / cuota real − 1 (en porcentaje). */
export const valuePct = (book: number | null, real: number | null) => (book === null || real === null ? null : (book / real - 1) * 100);

const points = (m: FT, t: number) => (gf(m, t) > ga(m, t) ? 3 : gf(m, t) === ga(m, t) ? 1 : 0);

/** PPG = (3·G + E) / PJ, temporada actual. */
export function ppg(h: History, m: MatchData, team: number, role: Role): number | null {
  const ms = h.teamMatches(m.leagueId, team, m.kickoff, role, h.seasonWindow(m.leagueId, m.seasonId, 0));
  return ms.length ? ms.reduce((s, x) => s + points(x, team), 0) / ms.length : null;
}

export function teamStat(h: History, m: MatchData, team: number, role: Role, seasons: string, stat: StatDef): [number | null, number] {
  const ms = h.teamMatches(m.leagueId, team, m.kickoff, role, h.seasonWindow(m.leagueId, m.seasonId, EXTRA[seasons] ?? 0));
  const vals = ms.map((x) => stat.value(x, team)).filter((v): v is number => v !== null);
  return vals.length ? [vals.reduce((a, b) => a + b, 0) / vals.length, vals.length] : [null, 0];
}

export const avgOf = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : (a + b) / 2);

export function teamStreak(h: History, m: MatchData, team: number, role: Role, seasons: string, streak: StreakDef): number {
  const ms = h.teamMatches(m.leagueId, team, m.kickoff, role, h.seasonWindow(m.leagueId, m.seasonId, EXTRA[seasons] ?? 0));
  let n = 0;
  for (const x of ms) {
    if (!streak.check(x, team)) break;
    n++;
  }
  return n;
}
