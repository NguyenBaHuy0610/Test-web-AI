import time
from datetime import datetime, timedelta

import pytest

from taskplanner import Member, Task, VN_TZ, replan, what_if

START = datetime(2026, 11, 2, 8, tzinfo=VN_TZ)


def abcd():
    return [Task("A", duration=2), Task("B", duration=3, depends_on=["A"]),
            Task("C", duration=1, depends_on=["A"]), Task("D", duration=2, depends_on=["B", "C"])]


def test_09_task_custom_con_kip_moc():
    tasks = [Task("M_open", type="milestone", source="template", fixed_hour=0),
             Task("custom", duration=5, depends_on=["M_open"]),
             Task("M_close", type="milestone", source="template", fixed_hour=100,
                  depends_on=["M_open", "custom"])]
    plan = replan(tasks, [Member("a")], plan_start=START)
    assert plan.ok and not plan.timeline.warnings


def test_replan_bao_vong_thay_vi_chay():
    plan = replan([Task("A", depends_on=["B"]), Task("B", depends_on=["A"])], [Member("m")])
    assert not plan.ok and plan.errors


def test_replan_gioi_han_so_task():
    with pytest.raises(ValueError):
        replan([], [Member("m")])
    with pytest.raises(ValueError):
        replan([Task(f"T{i}") for i in range(51)], [Member("m")])


def test_replan_tu_tinh_deadline_tu_on_air():
    on_air = START + timedelta(days=5)
    plan = replan([Task("T", duration=2, complexity=3, on_air=on_air)], [Member("m")], plan_start=START)
    assert plan.tasks[0].deadline == on_air - timedelta(days=2)


def test_what_if_doi_thoi_luong_tre_timeline():
    res = what_if(abcd(), [Member("a")], [{"task": "B", "duration": 6}])
    assert res["ok"] and res["delta_hours"] == 3 and res["total_after"] == 10


def test_what_if_khong_sua_ke_hoach_that():
    tasks = abcd()
    what_if(tasks, [Member("a")], [{"task": "B", "duration": 99}])
    assert tasks[1].duration == 3


def test_what_if_doi_nguoi_sai_role():
    tasks = [Task("T1", roles_required=["content"])]
    members = [Member("a", roles=["content"], quota=2), Member("p", roles=["photo"], quota=2)]
    res = what_if(tasks, members, [{"task": "T1", "assignee": "p"}])
    assert any("WRONG_ROLE" in w for w in res["new_warnings"])


def test_stress_200_task():
    tasks = [Task("T0", duration=1)]
    for i in range(1, 200):
        tasks.append(Task(f"T{i}", duration=1 + i % 3, depends_on=[f"T{(i - 1) // 2}"],
                          roles_required=["content"]))
    members = [Member(f"m{i}", roles=["content"], quota=20) for i in range(30)]
    t0 = time.perf_counter()
    plan = replan(tasks, members, max_tasks=200)
    assert plan.ok and time.perf_counter() - t0 < 2.0


def test_replan_suy_on_air_roi_moi_tinh_deadline():
    event = START + timedelta(days=7)
    tasks = [Task("T2", duration=8, complexity=3), Task("T4", duration=3, complexity=2, depends_on=["T2"])]
    plan = replan(tasks, [Member("m")], plan_start=START, event_start=event)
    t2 = next(t for t in plan.tasks if t.id == "T2")
    assert t2.on_air == event - timedelta(days=1, hours=3)
    assert t2.deadline == t2.on_air - timedelta(days=2)
    assert plan.warnings == []


def test_effort_nho_hon_duration_van_giao_duoc():
    # Task kéo dài 3 ngày nhưng chỉ tốn 4 giờ công; An chỉ rảnh 4 giờ trong khoảng.
    an = Member("an", roles=["design"], schedule={"Monday": [(17, 21)]})
    t = Task("T", duration=72, effort=4, roles_required=["design"], on_air=START + timedelta(days=6), complexity=2)
    plan = replan([t], [an], plan_start=START)
    assert plan.tasks[0].assignee == "an"
    plan2 = replan([Task("T", duration=72, roles_required=["design"], on_air=START + timedelta(days=6))], [an], plan_start=START)
    assert plan2.tasks[0].assignee is None and "NO_FREE_TIME" in plan2.tasks[0].flags


def test_viec_live_ghim_luc_su_kien_va_moi_nguoi_mot_viec():
    ev = START + timedelta(days=7)
    members = [Member("a", roles=["photo"], schedule={"Monday": [(8, 12)]}),
               Member("b", roles=["photo"], schedule={"Monday": [(8, 12)]})]
    tasks = [Task("L1", duration=3, roles_required=["photo"], start="event"),
             Task("L2", duration=2, roles_required=["photo"], start="event"),
             Task("L3", duration=2, roles_required=["photo"], start="event")]
    plan = replan(tasks, members, plan_start=START, event_start=ev, event_end=ev + timedelta(hours=13))
    got = sorted(t.assignee for t in plan.tasks if t.assignee)
    assert got == ["a", "b"]                                           # mỗi người một việc live
    assert any("NO_FREE_TIME" in t.flags for t in plan.tasks)           # việc thứ ba không còn ai
    live = plan.timeline.schedule["L1"]
    assert live["ES"] == 168 and live["critical"]
    assert all(t.deadline is None and "LIVE" in t.flags for t in plan.tasks)


def test_viec_live_keo_dai_qua_gio_ket_thuc():
    ev = START + timedelta(days=7)
    plan = replan([Task("L", duration=5, start="event")], [Member("m")], plan_start=START,
                  event_start=ev, event_end=ev + timedelta(hours=2))
    assert any("quá giờ kết thúc" in w for w in plan.warnings)


def test_viec_creation_bi_ghim_gio_0_va_can_nguoi_ranh_ngay():
    start = START                                                       # thứ Hai 08:00
    ranh_ngay = Member("a", roles=["content"], schedule={"Monday": [(8, 12)]})
    khong_ranh = Member("b", roles=["content"], schedule={"Tuesday": [(8, 12)]})
    t = Task("T", duration=2, roles_required=["content"], start="creation", on_air=start + timedelta(days=4))
    plan = replan([t], [khong_ranh, ranh_ngay], plan_start=start)
    assert plan.tasks[0].assignee == "a" and "START_NOW" in plan.tasks[0].flags
    assert plan.timeline.schedule["T"]["ES"] == 0


def test_viec_creation_phai_cho_phu_thuoc_thi_canh_bao():
    tasks = [Task("A", duration=5), Task("B", duration=2, depends_on=["A"], start="creation")]
    plan = replan(tasks, [Member("m")], plan_start=START)
    assert any("bắt đầu ngay khi tạo kế hoạch" in w for w in plan.timeline.warnings)
