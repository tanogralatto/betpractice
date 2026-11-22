/**
 * Caché en tres niveles para lo que se baja de API-Football:
 *   1) este dispositivo (IndexedDB) → 2) nube compartida (Firebase) → 3) API-Football.
 * Lo que se baja de la API se guarda en los dos primeros para que nadie lo vuelva a pedir.
 */
import type { FixturePack, OddsMap } from "./apiFootball";
import { sharedGet, sharedPut } from "./cloud";
import { Cache } from "./storage";

// Formato compacto para la nube (mucho más chico que el objeto completo).
type Packed = { l: unknown[][]; t: [number, string][]; m: unknown[][] };
export function packFixtures(p: FixturePack): string {
  const out: Packed = {
    l: p.leagues.map((x) => [x.id, x.name, x.country, x.flag, x.logo, x.season]),
    t: p.teams.map((x) => [x.id, x.name]),
    m: p.matches.map((m) => [m.id, m.leagueId, m.seasonId, m.kickoff, m.homeId, m.awayId, m.status, m.hg, m.ag, m.hthg, m.htag]),
  };
  return JSON.stringify(out);
}
export function unpackFixtures(s: string): FixturePack {
  const x = JSON.parse(s) as Packed;
  return {
    leagues: x.l.map((a) => ({ id: a[0] as number, name: a[1] as string, country: a[2] as string, flag: a[3] as string | null, logo: a[4] as string | null, season: a[5] as number })),
    teams: x.t.map(([id, name]) => ({ id, name })),
    matches: x.m.map((a) => ({
      id: a[0] as number, leagueId: a[1] as number, seasonId: a[2] as number, kickoff: a[3] as string,
      homeId: a[4] as number, awayId: a[5] as number, status: a[6] as string,
      hg: a[7] as number | null, ag: a[8] as number | null, hthg: a[9] as number | null, htag: a[10] as number | null,
      goals: [], detail: false, hc: null, ac: null, hs: null, as: null, hsot: null, asot: null, hda: null, ada: null, hy: null, ay: null,
    })),
  };
}

export const usage = { local: 0, shared: 0, api: 0 };

async function tiered<T>(key: string, ttl: number, fetcher: () => Promise<T>, enc: (v: T) => string, dec: (s: string) => T, force: boolean): Promise<T> {
  if (!force) {
    const local = await Cache.get<T>(key, ttl);
    if (local) { usage.local++; return local; }
    const remote = await sharedGet(key, ttl);
    if (remote) {
      try {
        const v = dec(remote.v);
        await Cache.set(key, v, remote.t);
        usage.shared++;
        return v;
      } catch { /* dato compartido dañado: se baja de nuevo */ }
    }
  }
  const v = await fetcher();
  usage.api++;
  const t = Date.now();
  await Cache.set(key, v, t);
  void sharedPut(key, enc(v), t);
  return v;
}

export const tieredFixtures = (key: string, ttl: number, fetcher: () => Promise<FixturePack>, force = false) =>
  tiered(key, ttl, fetcher, packFixtures, unpackFixtures, force);
export const tieredOdds = (key: string, ttl: number, fetcher: () => Promise<OddsMap>, force = false) =>
  tiered(key, ttl, fetcher, (o) => JSON.stringify(o), (s) => JSON.parse(s) as OddsMap, force);

/** Solo mira el dispositivo y la nube (sin gastar consultas). */
export async function peekFixtures(key: string, ttl: number): Promise<{ pack: FixturePack; t: number } | null> {
  const local = await Cache.get<FixturePack>(key, ttl);
  if (local) return { pack: local, t: 0 };
  const remote = await sharedGet(key, ttl);
  if (!remote) return null;
  try {
    const pack = unpackFixtures(remote.v);
    await Cache.set(key, pack, remote.t);
    usage.shared++;
    return { pack, t: remote.t };
  } catch { return null; }
}
