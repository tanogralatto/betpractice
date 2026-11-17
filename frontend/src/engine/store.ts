/** Perfiles, sub-perfiles y presets guardados en el navegador (localStorage). */
import type { PpgProfile, Preset, RealOddsProfile, SeasonProfile, SubKind, UserProfile } from "../api";

type Sub = RealOddsProfile | PpgProfile | SeasonProfile;
export interface StoreData {
  version: 1;
  nextId: number;
  profiles: Omit<UserProfile, "real_odds_profile" | "ppg_profile" | "stats_profile" | "streaks_profile">[];
  subs: Record<SubKind, Sub[]>;
  presets: Preset[];
}

const KEY = "cuotas-reales.v1";

export function defaults(): StoreData {
  return {
    version: 1,
    nextId: 100,
    subs: {
      real_odds: [
        { id: 1, name: "Temp. actual + 1 · Ambos", sample: "current_plus_1", home_as: "both", away_as: "both" },
        { id: 2, name: "Últimos 8 · Local/Visitante", sample: "last_8", home_as: "home", away_as: "away" },
        { id: 3, name: "Temp. actual · Local/Visitante", sample: "current", home_as: "home", away_as: "away" },
      ],
      ppg: [
        { id: 4, name: "Ambos", home_as: "both", away_as: "both" },
        { id: 5, name: "Local/Visitante", home_as: "home", away_as: "away" },
      ],
      stats: [
        { id: 6, name: "Temp. actual + 1 · Ambos", seasons: "current_plus_1", home_as: "both", away_as: "both" },
        { id: 7, name: "Temp. actual · Local/Visitante", seasons: "current", home_as: "home", away_as: "away" },
      ],
      streaks: [
        { id: 8, name: "Temp. actual + 1 · Ambos", seasons: "current_plus_1", home_as: "both", away_as: "both" },
        { id: 9, name: "Temp. actual · Local/Visitante", seasons: "current", home_as: "home", away_as: "away" },
      ],
    },
    profiles: [{
      id: 10, name: "GOL 1er TIEMPO", is_active: true,
      real_odds_profile_id: 1, ppg_profile_id: 4, stats_profile_id: 6, streaks_profile_id: 8,
      fav_leagues: [], fav_markets: ["ou_ht_over_0_5"], fav_stats: ["goals_total"],
      fav_streaks: ["ht_over_0_5", "ht_under_0_5"], fav_bookmakers: ["best", "bet365", "pinnacle", "1xbet"],
    }],
    presets: [],
  };
}

let mem: StoreData | null = null;

export function load(): StoreData {
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as StoreData;
      if (d.version === 1 && d.profiles?.length) return (mem = d);
    }
  } catch { /* navegador sin almacenamiento: se usa memoria */ }
  return (mem = defaults());
}

export function save(d: StoreData): void {
  mem = d;
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch { /* sin almacenamiento: queda en memoria hasta cerrar la página */ }
}

export function newId(d: StoreData): number {
  return d.nextId++;
}
