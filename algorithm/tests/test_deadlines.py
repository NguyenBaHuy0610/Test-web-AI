from datetime import datetime, timedelta

import pytest

from taskplanner import (Task, VN_TZ, apply_deadlines, compute_deadlines_dynamic,
                         compute_deadlines_fixed_days)

NOW = datetime(2026, 11, 1, 0, tzinfo=VN_TZ)


def test_fixed_days_kho_2_ngay_de_1_ngay():
    on_air = NOW + timedelta(days=10)
    kho = compute_deadlines_fixed_days(Task("T", duration=8, complexity=3), NOW, on_air)
    de = compute_deadlines_fixed_days(Task("T", duration=2, complexity=1), NOW, on_air)
    assert kho.submit == on_air - timedelta(days=2) and kho.feedback_hours == 38
    assert de.submit == on_air - timedelta(days=1) and de.feedback_hours == 16
    assert kho.feedback_due == on_air - timedelta(hours=10)      # độ khó 3: cách on-air 10h
    assert de.feedback_due == on_air - timedelta(hours=8)        # độ khó 1: cách on-air 8h


def test_fixed_days_qua_gap_van_co_deadline_va_co_co():
    r = compute_deadlines_fixed_days(Task("T", duration=8, complexity=3), NOW, NOW + timedelta(days=1))
    assert "INFEASIBLE" in r.flags and r.submit is not None
    r2 = compute_deadlines_fixed_days(Task("T", duration=30, complexity=1), NOW, NOW + timedelta(days=2))
    assert "COMPRESSED" in r2.flags


def test_dynamic_poster_nang():
    r = compute_deadlines_dynamic(Task("T", duration=6, complexity=3), NOW, NOW + timedelta(hours=120))
    assert (r.buffer_hours, r.feedback_hours) == (42, 13)
    assert r.weight == pytest.approx(0.735, abs=1e-3)


def test_dynamic_caption_nhe():
    r = compute_deadlines_dynamic(Task("T", duration=1, complexity=1), NOW, NOW + timedelta(hours=48))
    assert (r.buffer_hours, r.feedback_hours) == (25, 5)


def test_dynamic_sat_gio_bi_rut():
    r = compute_deadlines_dynamic(Task("T", duration=10, complexity=2), NOW, NOW + timedelta(hours=30))
    assert (r.buffer_hours, r.feedback_hours) == (20, 10) and "COMPRESSED" in r.flags


def test_dynamic_khong_kha_thi():
    r = compute_deadlines_dynamic(Task("T", duration=10), NOW, NOW + timedelta(hours=5))
    assert "INFEASIBLE" in r.flags


def test_apply_khong_de_deadline_nhap_tay():
    manual = NOW + timedelta(days=1)
    tasks = [Task("A", on_air=NOW + timedelta(days=5), deadline=manual),
             Task("B", on_air=NOW + timedelta(days=5))]
    apply_deadlines(tasks, NOW)
    assert tasks[0].deadline == manual
    assert tasks[1].deadline == NOW + timedelta(days=4)


from taskplanner import check_on_air_consistency, fill_missing_on_air


def test_on_air_thieu_duoc_suy_ra_nguoc_tu_ngay_su_kien():
    start = datetime(2026, 11, 2, 8, tzinfo=VN_TZ)
    event = datetime(2026, 11, 9, 8, tzinfo=VN_TZ)
    tasks = [Task("T2", duration=8, complexity=3), Task("T4", duration=3, complexity=2, depends_on=["T2"])]
    fill_missing_on_air(tasks, event)
    assert tasks[1].on_air == event                                         # task cuối = ngày sự kiện
    assert tasks[0].on_air == datetime(2026, 11, 8, 5, tzinfo=VN_TZ)        # 09/11 08:00 - 1 ngày - 3h
    assert "ON_AIR_AUTO" in tasks[0].flags
    apply_deadlines(tasks, start)
    assert tasks[0].deadline == tasks[0].on_air - timedelta(days=2)         # deadline tính SAU on-air


def test_on_air_ai_sinh_duoc_giu_nguyen():
    event = datetime(2026, 11, 9, 8, tzinfo=VN_TZ)
    mine = datetime(2026, 11, 6, 8, tzinfo=VN_TZ)
    tasks = [Task("A", on_air=mine)]
    fill_missing_on_air(tasks, event)
    assert tasks[0].on_air == mine and "ON_AIR_AUTO" not in tasks[0].flags


def test_canh_bao_on_air_cha_qua_muon():
    day = lambda d: datetime(2026, 11, d, 8, tzinfo=VN_TZ)
    tasks = [Task("P", on_air=day(8)), Task("C", duration=3, complexity=2, depends_on=["P"], on_air=day(9))]
    assert check_on_air_consistency(tasks)                                  # C cần P xong trước 08/11 05:00
    tasks[0].on_air = datetime(2026, 11, 8, 4, tzinfo=VN_TZ)
    assert check_on_air_consistency(tasks) == []
