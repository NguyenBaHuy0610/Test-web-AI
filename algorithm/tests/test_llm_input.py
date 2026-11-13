import pytest

from taskplanner import call_ai_api, tasks_from_csv

GOOD = "id,name,duration,roles,depends_on,complexity\nT1,Poster,4,design;photo,,3\nT2,Đăng,1,content,T1,1\n"


def test_csv_hop_le():
    t = tasks_from_csv(GOOD)
    assert t[0].roles_required == ["design", "photo"] and t[1].depends_on == ["T1"]


def test_csv_thieu_cot_bi_tu_choi():
    with pytest.raises(ValueError):
        tasks_from_csv("id,name\nT1,x\n")


def test_csv_gia_tri_sai_bi_tu_choi():
    bad = "id,name,duration,roles,depends_on,complexity\nT1,x,abc,design,,9\nT1,y,2,design,,2\n"
    with pytest.raises(ValueError) as e:
        tasks_from_csv(bad)
    assert "duration" in str(e.value)


def test_stub_tra_5_task():
    assert [t.id for t in call_ai_api("brief")] == ["T1", "T2", "T3", "T4", "T5"]


from datetime import datetime

from taskplanner import VN_TZ

S = datetime(2026, 11, 2, 8, tzinfo=VN_TZ)
E = datetime(2026, 11, 9, 8, tzinfo=VN_TZ)
HDR = "id,name,duration,roles,depends_on,complexity,on_air\n"


def test_csv_on_air_do_ai_sinh():
    t = tasks_from_csv(HDR + "T1,Poster,4,design,,3,2026-11-07 08:00\nT2,Đăng,1,content,T1,1,\n", S, E)
    assert t[0].on_air == datetime(2026, 11, 7, 8, tzinfo=VN_TZ)
    assert t[1].on_air is None                              # để trống -> hệ thống tự suy ra


def test_csv_on_air_ngoai_khoang_bi_tu_choi():
    with pytest.raises(ValueError):
        tasks_from_csv(HDR + "T1,x,4,design,,3,2026-11-20 08:00\n", S, E)
    with pytest.raises(ValueError):
        tasks_from_csv(HDR + "T1,x,4,design,,3,2026-10-20 08:00\n", S, E)


def test_csv_on_air_sai_dinh_dang_hoac_duration_qua_dai():
    with pytest.raises(ValueError):
        tasks_from_csv(HDR + "T1,x,4,design,,3,mai 8h\n")
    with pytest.raises(ValueError):
        tasks_from_csv(HDR + "T1,x,400,design,,3,\n")


def test_csv_duration_dang_ngay_va_effort():
    t = tasks_from_csv("id,name,duration,roles,depends_on,complexity,start,effort\nT1,Poster,2d,design,,3,creation,8\n")
    assert t[0].duration == 48 and t[0].effort == 8 and t[0].work_hours == 8 and t[0].start == "creation"


def test_csv_effort_lon_hon_duration_bi_tu_choi():
    with pytest.raises(ValueError) as e:
        tasks_from_csv("id,name,duration,roles,depends_on,complexity,effort\nT1,x,2d,design,,1,60\n")
    assert "effort" in str(e.value)


def test_csv_start_khong_hop_le():
    with pytest.raises(ValueError):
        tasks_from_csv("id,name,duration,roles,depends_on,complexity,start\nT1,x,2,design,,1,sau\n")


def test_csv_cot_live_cu_van_hieu():
    t = tasks_from_csv("id,name,duration,roles,depends_on,complexity,live\nT1,x,2,photo,,1,yes\n")
    assert t[0].start == "event" and t[0].is_live
