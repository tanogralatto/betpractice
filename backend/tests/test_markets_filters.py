import pytest

from app.catalog.markets import MARKETS_BY_KEY as M
from app.catalog.streaks import STREAKS_BY_KEY as S
from app.domain import Goal
from app.services.analysis import ppg, History, streak_length
from app.services.filters import in_range, row_passes
from tests.helpers import mk


def chk(key, m):
    return M[key].check(m)


def test_over_05_primer_tiempo():
    assert chk("ou_ht_over_0_5", mk(1, 2, ft=(1, 0), ht=(1, 0)))
    assert not chk("ou_ht_over_0_5", mk(1, 2, ft=(3, 0), ht=(0, 0)))
    assert chk("ou_ht_under_0_5", mk(1, 2, ft=(3, 0), ht=(0, 0)))
    assert chk("ou_ht_over_1_5", mk(1, 2, ft=(1, 1), ht=(1, 1)))


def test_btts():
    assert chk("btts_yes", mk(1, 2, ft=(1, 1), ht=(0, 0)))
    assert not chk("btts_yes", mk(1, 2, ft=(2, 0), ht=(1, 0)))
    assert chk("btts_no", mk(1, 2, ft=(0, 0), ht=(0, 0)))


@pytest.mark.parametrize("ft,ht,key", [
    ((2, 1), (1, 0), "htft_11"), ((1, 1), (1, 0), "htft_1x"), ((1, 2), (1, 0), "htft_12"),
    ((0, 0), (0, 0), "htft_xx"), ((2, 0), (0, 0), "htft_x1"), ((0, 1), (0, 1), "htft_22"),
    ((2, 1), (0, 1), "htft_21"),
])
def test_htft(ft, ht, key):
    m = mk(1, 2, ft=ft, ht=ht)
    hits = [k for k in M if k.startswith("htft_") and chk(k, m)]
    assert hits == [key]


def test_otros_mercados():
    m = mk(1, 2, ft=(2, 1), ht=(1, 0), goals=[Goal(5, "home", 1), Goal(70, "away", 2), Goal(88, "home", 2)])
    assert chk("1x2_1", m) and chk("dc_1x", m) and chk("ou_over_2_5", m) and chk("odd_even_odd", m)
    assert chk("first_goal_0_10", m) and chk("last_goal_home", m) and chk("half_most_2h", m)
    assert chk("cs_21", m) and chk("cs_ht_10", m) and chk("1x2ou25_1_over", m)
    assert chk("home_score_both_halves", m) and chk("home_goals_2plus", m) and chk("home_win_either_half", m)
    assert not chk("home_win_both_halves", m)  # 2T terminó 1-1
    assert not chk("home_win_to_nil", m) and chk("away_clean_sheet_no", m)
    assert chk("corners_over_8_5", m) and chk("corners_1x2_1", m)  # corners 5-4
    assert chk("first_goal_none", mk(1, 2, ft=(0, 0), ht=(0, 0)))
    assert chk("first_goal_81_end", mk(1, 2, ft=(1, 0), ht=(0, 0), goals=[Goal(90, "home", 2)]))


def test_ppg_y_rachas():
    ms = [mk(1, 3, ft=(2, 0), ht=(1, 0), day=1), mk(4, 1, ft=(1, 1), ht=(0, 0), day=2), mk(1, 5, ft=(0, 1), ht=(0, 0), day=3)]
    h = History(ms, {1: [1]})
    target = mk(1, 2, day=10, status="NS")
    assert ppg(h, target, 1, "both") == (pytest.approx(4 / 3), 3)
    assert ppg(h, target, 1, "home") == (pytest.approx(1.5), 2)
    recent = h.team_matches(1, 1, target.kickoff, "both")
    assert streak_length(recent, 1, S["ht_under_0_5"]) == 2
    assert streak_length(recent, 1, S["no_win"]) == 2
    assert streak_length(recent, 1, S["win_ft"]) == 0


def test_in_range():
    assert in_range(1.5, [None, None]) and in_range(None, None) and in_range(None, [None, None])
    assert in_range(1.5, [1.2, 1.6]) and in_range(1.2, [1.2, None]) and in_range(1.6, [None, 1.6])
    assert not in_range(1.1, [1.2, None]) and not in_range(1.7, [None, 1.6])
    assert not in_range(None, [1, None])  # sin dato no pasa si hay filtro
    assert in_range(5, {"min": 3, "max": None})


def _row(real=1.3, book=1.4, value=7.7, avg=2.8, n=(20, 18), streak=(2, 0), ppg=(1.8, 1.2), sample_n=30):
    return {
        "markets": {"ou_ht_over_0_5": {"real": real, "book": book, "value": value}},
        "stats": {"goals_total": {"home": 3.0, "away": 2.6, "avg": avg, "n_home": n[0], "n_away": n[1]}},
        "streaks": {"ht_over_0_5": {"home": streak[0], "away": streak[1]}},
        "home": {"ppg": ppg[0]}, "away": {"ppg": ppg[1]}, "sample_n": sample_n,
    }


def test_filtros_combinados():
    f = {
        "markets": {"ou_ht_over_0_5": {"real": [None, 1.35], "book": [1.3, None], "value": [5, None]}},
        "stats": {"goals_total": {"avg": [2.5, None], "n": [15, None]}},
        "streaks": {"ht_over_0_5": {"home": [2, None]}},
        "misc": {"ppg_home": [1.5, None], "sample_n": [20, None]},
    }
    assert row_passes(_row(), f)
    assert not row_passes(_row(value=-2), f)
    assert not row_passes(_row(real=1.5), f)
    assert not row_passes(_row(book=None, value=None), f)
    assert not row_passes(_row(avg=2.1), f)
    assert not row_passes(_row(n=(20, 10)), f)  # muestra de estadísticas = mínimo de L y V
    assert not row_passes(_row(streak=(1, 5)), f)
    assert not row_passes(_row(ppg=(1.2, 1.2)), f)
    assert not row_passes(_row(sample_n=12), f)
    assert row_passes(_row(), {}) and row_passes(_row(), None)


def test_filtro_de_mercado_no_calculado():
    assert not row_passes(_row(), {"markets": {"btts_yes": {"real": [1, None]}}})
    assert row_passes(_row(), {"markets": {"btts_yes": {"real": [None, None]}}})


def test_racha_cualquiera_de_los_dos():
    f = {"streaks": {"ht_over_0_5": {"any": [3, None]}}}
    assert row_passes(_row(streak=(3, 0)), f)
    assert row_passes(_row(streak=(0, 4)), f)
    assert not row_passes(_row(streak=(2, 2)), f)
    assert row_passes(_row(streak=(0, 0)), {"streaks": {"ht_over_0_5": {"any": [None, None]}}})
