import pytest

from app.catalog.markets import MARKETS_BY_KEY
from app.services.analysis import History, real_odds, real_odds_sample, value_pct
from tests.helpers import mk

HT05 = MARKETS_BY_KEY["ou_ht_over_0_5"]
L, V = 1, 2  # local y visitante del partido a analizar


def target(day=100, league=1, season=2):
    return mk(L, V, day=day, league=league, season=season, status="NS")


def hist(matches, seasons=None):
    return History(matches, seasons or {1: [1, 2], 9: [91, 92]})


def test_union_deduplica_enfrentamientos_directos():
    h2h = mk(L, V, ht=(1, 0), day=5, season=2)
    others = [mk(L, 3, day=1, season=2), mk(4, V, day=2, season=2)]
    s = real_odds_sample(hist([h2h] + others), target(), "current", "both", "both")
    assert len(s.home) == 2 and len(s.away) == 2
    assert s.n == 3  # el enfrentamiento cuenta una vez
    assert [m.id for m in s.merged].count(h2h.id) == 1


def test_no_promedia_porcentajes_por_equipo():
    # Local: 1 partido con gol 1T. Visitante: 3 partidos sin gol 1T.
    ms = [mk(L, 3, ht=(1, 0), day=1, season=2)] + [mk(V, 4, ft=(0, 0), ht=(0, 0), day=d, season=2) for d in (2, 3, 4)]
    s = real_odds_sample(hist(ms), target(), "current", "both", "both")
    r = real_odds(s.merged, HT05)
    assert r.n == 4 and r.hits == 1
    assert r.odds == pytest.approx(4.0)  # 1/(1/4); promediar daría 1/((1+0)/2)=2.0


@pytest.mark.parametrize("home_as,away_as,expected", [
    ("home", "away", {"L_home", "V_away"}),
    ("away", "home", {"L_away", "V_home"}),
    ("both", "both", {"L_home", "L_away", "V_home", "V_away"}),
    ("ignore", "both", {"V_home", "V_away"}),
    ("home", "ignore", {"L_home"}),
    ("ignore", "ignore", set()),
])
def test_filtro_local_visitante(home_as, away_as, expected):
    ms = {
        "L_home": mk(L, 10, day=1, season=2), "L_away": mk(11, L, day=2, season=2),
        "V_home": mk(V, 12, day=3, season=2), "V_away": mk(13, V, day=4, season=2),
    }
    s = real_odds_sample(hist(list(ms.values())), target(), "current", home_as, away_as)
    assert {k for k, m in ms.items() if m.id in {x.id for x in s.merged}} == expected


def test_last_8_toma_los_ultimos_8_que_cumplen_la_condicion():
    home_games = [mk(L, 10 + d, day=d, season=1 if d < 5 else 2) for d in range(12)]  # 12 de local
    away_games = [mk(20 + d, L, day=d + 50, season=2) for d in range(3)]  # 3 de visitante (más recientes)
    s = real_odds_sample(hist(home_games + away_games), target(), "last_8", "home", "ignore")
    assert len(s.home) == 8
    assert {m.id for m in s.home} == {m.id for m in home_games[-8:]}  # ignora los de visitante
    # last_8 no se limita a la temporada: incluye partidos de la temporada 1
    assert any(m.season_id == 1 for m in s.home)


def test_solo_partidos_anteriores_a_la_fecha_del_partido():
    before = mk(L, 3, day=99, season=2)
    same_day_after = mk(L, 4, day=100, season=2)  # misma hora que el partido
    after = mk(L, 5, day=101, season=2)
    s = real_odds_sample(hist([before, same_day_after, after]), target(day=100), "current", "both", "ignore")
    assert [m.id for m in s.merged] == [before.id]


def test_solo_partidos_no_terminados_se_excluyen():
    ns = mk(L, 3, day=50, season=2, status="NS")
    ok = mk(L, 4, day=51, season=2)
    s = real_odds_sample(hist([ns, ok]), target(), "current", "both", "ignore")
    assert [m.id for m in s.merged] == [ok.id]


def test_misma_competicion():
    liga = mk(L, 3, day=10, league=1, season=2)
    copa = mk(L, 4, day=11, league=9, season=92)
    s = real_odds_sample(hist([liga, copa]), target(league=1), "current_plus_3", "both", "both")
    assert [m.id for m in s.merged] == [liga.id]


def test_ventana_de_temporadas():
    s1 = mk(L, 3, day=1, season=1)
    s2 = mk(L, 4, day=60, season=2)
    h = hist([s1, s2])
    assert [m.id for m in real_odds_sample(h, target(), "current", "both", "ignore").merged] == [s2.id]
    assert {m.id for m in real_odds_sample(h, target(), "current_plus_1", "both", "ignore").merged} == {s1.id, s2.id}


def test_ejemplo_15_de_19():
    # 19 partidos únicos (incluye 1 enfrentamiento directo), 15 con gol en el 1T
    ms = [mk(L, V, ht=(1, 0), day=1, season=2)]
    ms += [mk(L, 100 + i, ht=(1, 0) if i < 7 else (0, 0), ft=(1, 0) if i < 7 else (0, 0), day=2 + i, season=2) for i in range(9)]
    ms += [mk(200 + i, V, ht=(0, 1) if i < 7 else (0, 0), ft=(0, 1) if i < 7 else (0, 0), day=20 + i, season=2) for i in range(9)]
    s = real_odds_sample(hist(ms), target(), "current_plus_1", "both", "both")
    r = real_odds(s.merged, HT05)
    assert (r.hits, r.n) == (15, 19)
    assert round(r.odds, 2) == 1.27
    assert round(value_pct(1.44, r.odds), 1) == 13.7


def test_muestra_vacia_o_sin_aciertos():
    assert real_odds([], HT05).odds is None
    r = real_odds([mk(L, 3, ft=(0, 0), ht=(0, 0))], HT05)
    assert r.odds is None and r.n == 1 and r.prob == 0
    assert value_pct(1.5, None) is None
