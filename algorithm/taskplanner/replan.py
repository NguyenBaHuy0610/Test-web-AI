"""Điều phối chuỗi: deadline -> kiểm tra phụ thuộc -> gán việc -> timeline -> cảnh báo. Và what-if."""
from __future__ import annotations

import copy
from datetime import timedelta
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from .alerts import check_deadline_alert
from .assignment import AssignResult, assign_task
from .conflicts import find_time_conflicts, resolve_with_backup
from .deadlines import apply_deadlines, check_on_air_consistency, fill_missing_on_air
from .dependency import check_dependency
from .models import MAX_MEMBERS, MAX_TASKS, MIN_TASKS, VN_TZ, aware
from .timeline import Timeline, compute_timeline


@dataclass
class Plan:
    ok: bool
    errors: list
    tasks: list = field(default_factory=list)
    assignment: Optional[AssignResult] = None
    timeline: Optional[Timeline] = None
    alerts: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


def replan(tasks: list, members: list, plan_start: Optional[datetime] = None,
           now: Optional[datetime] = None, max_tasks: int = MAX_TASKS,
           deadline_mode: str = "fixed_days", event_start: Optional[datetime] = None,
           event_end: Optional[datetime] = None) -> Plan:
    """Chuỗi: kiểm tra phụ thuộc -> (on_air thiếu thì suy ra) -> deadline/feedback -> gán việc -> timeline -> cảnh báo."""
    if len(tasks) < MIN_TASKS:
        raise ValueError("Chưa có task nào")
    if len(tasks) > max_tasks:
        raise ValueError(f"Tối đa {max_tasks} task, bạn đang nhập {len(tasks)}")
    if len(members) > MAX_MEMBERS:
        raise ValueError(f"Tối đa {MAX_MEMBERS} thành viên")

    tasks = copy.deepcopy(tasks)
    dep = check_dependency(tasks)
    if not dep.ok:
        return Plan(ok=False, errors=dep.problems, tasks=tasks)

    warnings = []
    base_time = now or plan_start
    if base_time is not None:
        if event_start is not None:
            fill_missing_on_air(tasks, event_start)
        apply_deadlines(tasks, base_time, deadline_mode)
        warnings += check_on_air_consistency(tasks)

    if event_end is not None:
        for t in tasks:
            if t.is_live and t.on_air is not None and aware(t.on_air) + timedelta(hours=t.duration) > aware(event_end):
                warnings.append(f"{t.id}: kéo dài quá giờ kết thúc sự kiện ({aware(event_end):%H:%M %d/%m})")
    assignment = assign_task(tasks, members, start=plan_start or now)
    timeline = compute_timeline(tasks, plan_start)
    warnings += resolve_with_backup(tasks, timeline)
    assignment.assignments = {t.id: (t.assignee, t.backup) for t in tasks if t.id in assignment.assignments}
    assignment.teams = {t.id: (list(zip(t.assigned, t.backups)) if t.assigned else [(t.assignee, t.backup)])
                        for t in tasks if t.id in assignment.teams}
    for grp in find_time_conflicts(tasks, timeline):
        for t in grp:
            if "TIME_CONFLICT" not in t.flags:
                t.flags.append("TIME_CONFLICT")
        warnings.append(f"Trùng giờ: {', '.join(t.id for t in grp)} cùng người làm, cùng khung giờ")
    alerts = check_deadline_alert(tasks, now) if now is not None else []
    return Plan(ok=True, errors=[], tasks=tasks, assignment=assignment,
                timeline=timeline, alerts=alerts, warnings=warnings)


def what_if(tasks: list, members: list, changes: list,
            plan_start: Optional[datetime] = None, now: Optional[datetime] = None) -> dict:
    """
    changes: [{"task": "T1", "assignee": "binh", "duration": 5, "deadline": datetime}, ...]
    Chạy trên BẢN SAO, không sửa kế hoạch thật. Trả về so sánh trước/sau.
    Đổi người kiểm tra role, quota và giờ rảnh; đổi duration/deadline ảnh hưởng timeline.
    """
    base = replan(tasks, members, plan_start, now)
    modified = copy.deepcopy(tasks)
    by = {t.id: t for t in modified}
    for ch in changes:
        t = by.get(ch["task"])
        if t is None:
            raise ValueError(f"Không có task {ch['task']}")
        if "assignee" in ch:
            t.assignee, t.locked = ch["assignee"], True
        if "duration" in ch:
            t.duration = ch["duration"]
        if "deadline" in ch:
            t.deadline = ch["deadline"]
    after = replan(modified, members, plan_start, now)

    out = {"base": base, "after": after, "ok": base.ok and after.ok}
    if out["ok"]:
        out["total_before"] = base.timeline.total_hours
        out["total_after"] = after.timeline.total_hours
        out["delta_hours"] = after.timeline.total_hours - base.timeline.total_hours
        new_warn = [w for w in after.timeline.warnings if w not in base.timeline.warnings]
        new_flags = [w for w in after.assignment.warnings if w not in base.assignment.warnings]
        out["new_warnings"] = new_warn + new_flags
        out["becomes_late"] = bool(new_warn)
    return out
