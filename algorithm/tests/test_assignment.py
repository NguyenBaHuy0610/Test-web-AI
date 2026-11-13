from datetime import datetime, timedelta

from taskplanner import Member, Task, VN_TZ, assign_task, free_hours_between


def dt(y, m, d, h=0):
    return datetime(y, m, d, h, tzinfo=VN_TZ)


def test_01_luong_binh_thuong():
    tasks = [Task(f"T{i}", roles_required=["content"]) for i in (1, 2, 3)]
    members = [Member(x, roles=["content"], quota=5) for x in "abc"]
    res = assign_task(tasks, members)
    assert sorted(v[0] for v in res.assignments.values()) == ["a", "b", "c"]
    assert all(v[1] is not None for v in res.assignments.values())


def test_02_hoa_tai_chon_id_nho():
    res = assign_task([Task("T1", roles_required=["content"])],
                      [Member("b", roles=["content"], quota=5), Member("a", roles=["content"], quota=5)])
    assert res.assignments["T1"] == ("a", "b")


def test_03_khong_ai_dung_role():
    tasks = [Task("T1", roles_required=["photo"])]
    res = assign_task(tasks, [Member("a", roles=["content"], quota=5)])
    assert res.assignments["T1"] == (None, None)
    assert "NO_ROLE_MATCH" in tasks[0].flags


def test_04_task_hiem_truoc():
    t1 = Task("T1", roles_required=["content", "design"])
    t2 = Task("T2", roles_required=["design"])
    res = assign_task([t1, t2], [Member("an", roles=["design"], quota=1),
                                 Member("binh", roles=["content"], quota=1)])
    assert res.assignments["T2"] == ("an", None)
    assert res.assignments["T1"] == ("binh", None)


def test_07_over_quota():
    tasks = [Task(f"T{i}", roles_required=["design"]) for i in range(1, 6)]
    assign_task(tasks, [Member("d1", roles=["design"], quota=4)])
    assert len([t for t in tasks if t.assignee]) == 4
    assert any("OVER_QUOTA" in t.flags for t in tasks)


def test_gio_ranh_trong_khoang():
    sched = {"Monday": [(17, 21)], "Wednesday": [(18, 22)]}
    mon = dt(2026, 11, 2, 8)                        # thứ Hai 2/11/2026
    assert free_hours_between(sched, mon, mon + timedelta(days=1)) == 4
    assert free_hours_between(sched, mon, mon + timedelta(days=7)) == 8
    assert free_hours_between(sched, mon + timedelta(days=1), mon + timedelta(days=2)) == 0


def test_gio_ranh_chan_viec_qua_dai():
    start = dt(2026, 11, 2, 8)
    an = Member("an", roles=["design"], schedule={"Monday": [(17, 21)]})
    ok = Task("T_ok", duration=4, roles_required=["design"], deadline=start + timedelta(days=1))
    qua = Task("T_qua", duration=5, roles_required=["design"], deadline=start + timedelta(days=1))
    assert assign_task([ok], [an], start=start).assignments["T_ok"][0] == "an"
    res = assign_task([qua], [an], start=start)
    assert res.assignments["T_qua"] == (None, None) and "NO_FREE_TIME" in qua.flags


def test_gio_ranh_cong_don_giua_cac_task():
    start = dt(2026, 11, 2, 8)
    an = Member("an", roles=["design"], schedule={"Monday": [(17, 21)]})
    dl = start + timedelta(days=1)
    t1 = Task("T1", duration=3, roles_required=["design"], deadline=dl)
    t2 = Task("T2", duration=3, roles_required=["design"], deadline=dl)
    res = assign_task([t1, t2], [an], start=start)
    assert sorted(v[0] is not None for v in res.assignments.values()) == [False, True]
