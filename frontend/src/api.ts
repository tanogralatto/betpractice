export type Range = [number | null, number | null];

export interface Market { key: string; name: string; group: string; category: string; popular: boolean }
export interface Named { key: string; name: string }
export interface Catalog {
  markets: Market[];
  market_categories: Record<string, string>;
  stats: Named[];
  streaks: Named[];
  bookmakers: Named[];
  samples: Named[];
}
export interface LeagueNode { country: string; code: string | null; leagues: { id: number; name: string }[] }

export interface RealOddsProfile { id: number; name: string; sample: string; home_as: string; away_as: string }
export interface PpgProfile { id: number; name: string; home_as: string; away_as: string }
export interface SeasonProfile { id: number; name: string; seasons: string; home_as: string; away_as: string }
export type SubKind = "real_odds" | "ppg" | "stats" | "streaks";

export interface UserProfile {
  id: number;
  name: string;
  is_active: boolean;
  real_odds_profile_id: number | null;
  ppg_profile_id: number | null;
  stats_profile_id: number | null;
  streaks_profile_id: number | null;
  real_odds_profile: RealOddsProfile | null;
  ppg_profile: PpgProfile | null;
  stats_profile: SeasonProfile | null;
  streaks_profile: SeasonProfile | null;
  fav_leagues: number[];
  fav_markets: string[];
  fav_stats: string[];
  fav_streaks: string[];
  fav_bookmakers: string[];
}

export interface Filters {
  markets?: Record<string, { real?: Range; book?: Range; value?: Range }>;
  stats?: Record<string, { avg?: Range; home?: Range; away?: Range; n?: Range }>;
  streaks?: Record<string, { home?: Range; away?: Range }>;
  misc?: { ppg_home?: Range; ppg_away?: Range; sample_n?: Range };
}

export interface MarketCell { real: number | null; prob: number | null; hits: number; n: number; book: number | null; bookmaker: string | null; value: number | null }
export interface Row {
  id: number;
  kickoff: string;
  status: string;
  league: { id: number; name: string; country: string; country_code: string | null };
  home: { id: number; name: string; ppg: number | null };
  away: { id: number; name: string; ppg: number | null };
  score: { ft: [number, number]; ht: [number | null, number | null] } | null;
  sample_n: number;
  sample_home_n: number;
  sample_away_n: number;
  markets: Record<string, MarketCell>;
  stats: Record<string, { home: number | null; away: number | null; avg: number | null; n_home: number; n_away: number }>;
  streaks: Record<string, { home: number; away: number }>;
}
export interface PrematchResponse {
  date: string;
  profile: { id: number; name: string };
  markets: string[];
  stats: string[];
  streaks: string[];
  bookmaker: string;
  rows: Row[];
  shown: number;
  shown_leagues: number;
  total: number;
  total_leagues: number;
  favorites_count: number;
  countries: { country: string; code: string | null; count: number; league_ids: number[] }[];
}
export interface PrematchRequest {
  date: string;
  profile_id: number | null;
  leagues: number[];
  markets: string[];
  stats: string[];
  streaks: string[];
  bookmaker: string;
  hide_without_odds: boolean;
  sort: string;
  filters: Filters;
}
export interface SampleResponse {
  match: { id: number; home: string; away: string; league: string; kickoff: string };
  profile: { name: string; sample: string; home_as: string; away_as: string };
  market: Market | null;
  real: number | null;
  hits: number;
  n: number;
  n_home: number;
  n_away: number;
  matches: { id: number; date: string; home: string; away: string; ft: [number, number]; ht: [number, number]; hit: boolean; from: string }[];
}
export interface OddsResponse { bookmakers: string[]; rows: { market: Market; prices: Record<string, number | null>; best: number | null }[] }
export interface Preset { id: number; name: string; config: PresetConfig }
export interface PresetConfig {
  leagues: number[]; markets: string[]; stats: string[]; streaks: string[];
  bookmaker: string; hide_without_odds: boolean; sort: string; filters: Filters;
}

// Toda la lógica corre en el navegador: los datos salen de public/data/datos.json
// (lo genera la acción "Actualizar datos" de GitHub o `python -m app.export_static`).
export { localApi as api } from "./engine/local";
export type { Meta } from "./engine/local";

export const ROLE_LABEL: Record<string, string> = { home: "Local", away: "Visitante", both: "Ambos", ignore: "Ignorar" };
export const SEASONS_LABEL: Record<string, string> = {
  last_8: "Últimos 8", current: "Temporada actual", current_plus_1: "Actual + 1",
  current_plus_2: "Actual + 2", current_plus_3: "Actual + 3",
};
