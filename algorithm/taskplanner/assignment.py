"""Gán việc bằng Greedy: task hiếm (ít ứng viên) xử lý trước, chọn Primary + Backup cho TỪNG VỊ TRÍ.
Mỗi loại task có các vị trí cần người (models.CATEGORY_ROLES): on-page cần 2 người (content + design/editor),
product cần design, on-site cần photo. Một người không giữ hai vị trí của cùng một task.
Ràng buộc: đúng role, chưa vượt quota, đủ giờ rảnh cho GIỜ CÔNG (effort) trong khoảng từ lúc bắt đầu đến
hạn nộp nháp. Việc giờ cố định (on-site / start=event) cần người rảnh đúng khung giờ và không trùng việc
giờ cố định khác của người đó. Việc creation cần người rảnh ngay lúc tạo kế hoạch.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from .availability import free_hours_between, weekly_free_hours
from .dependency import topo_layers
from .models import EPS, VN_TZ, Member, Task, aware

UNLIMITED_QUOTA_DENOM = 10                 # không có lịch/quota: tải = số bài / 10
ASSIGN_FLAGS = {"NO_ROLE_MATCH", "OVER_QUOTA", "NO_FREE_TIME", "WRONG_ROLE"}
FAR_FUTURE = datetime(2100, 1, 1, tzinfo=VN_TZ)


@dataclass
class AssignResult:
    assignments: dict      # task_id -> (primary_id | None, backup_id | None) của vị trí đầu tiên
    teams: dict            # task_id -> [(primary, backup), ...] theo từng vị trí
    loads: dict            # member_id -> số lần được giao
    load_hours: dict       # member_id -> số giờ công đã giao (không tính việc giờ cố định)
    warnings: list


def _role_ok(m: Member, roles: list) -> bool:
    return not roles or any(r in roles for r in m.roles)


def _free(m: Member, start: datetime, end: Optional[datetime]) -> Optional[float]:
    """Số giờ rảnh trong cửa sổ làm việc của task; None = không giới hạn."""
    if m.schedule is None:
        return None
    if end is None:
        return weekly_free_hours(m.schedule)
    return free_hours_between(m.schedule, start, end)


def _window(t: Task):
    a = aware(t.on_air) if t.on_air is not None else FAR_FUTURE
    return a, a + timedelta(hours=t.duration)


def _eligible(t: Task, roles: list, members: list, st: dict, start: datetime, excluded=()) -> list:
    out = []
    for m in members:
        if m.id in excluded or not _role_ok(m, roles):
            continue
        if m.quota is not None and st["count"][m.id] >= m.quota:
            continue
        if t.is_live:
            a, b = _window(t)
            if any(x < b and a < y for x, y in st["busy"][m.id]):
                continue
            if m.schedule is not None and t.on_air is not None:
                if free_hours_between(m.schedule, a, b) < t.duration - EPS:
                    continue
        else:
            if t.start == "creation" and m.schedule is not None:
                if free_hours_between(m.schedule, start, start + timedelta(hours=min(t.duration, 24))) <= 0:
                    continue
            free = _free(m, start, t.deadline)
            if free is not None and st["hours"][m.id] + t.work_hours > free + EPS:
                continue
        out.append(m)
    return out


def _rank(m: Member, t: Task, st: dict, start: datetime) -> tuple:
    free = _free(m, start, t.deadline)
    if free is not None:
        ratio = st["hours"][m.id] / max(free, 1)
    elif m.quota:
        ratio = st["count"][m.id] / m.quota
    else:
        ratio = st["count"][m.id] / UNLIMITED_QUOTA_DENOM
    return (ratio, m.id)                    # tải thấp trước; hòa thì id nhỏ trước


def _flag(t: Task, flag: str, warnings: list) -> None:
    if flag not in t.flags:
        t.flags.append(flag)
    warnings.append(f"{t.id}: {flag}")


def _commit(t: Task, member_id: str, st: dict) -> None:
    st["count"][member_id] += 1
    if t.is_live:
        st["busy"][member_id].append(_window(t))
    else:
        st["hours"][member_id] += t.work_hours


def assign_task(tasks: list, members: list, start: Optional[datetime] = None) -> AssignResult:
    start = aware(start) if start else datetime.now(VN_TZ)
    by = {t.id: t for t in tasks}
    mem = {m.id: m for m in members}
    st = {"count": {m.id: 0 for m in members}, "hours": {m.id: 0.0 for m in members},
          "busy": {m.id: [] for m in members}}
    result, teams, warnings = {}, {}, []

    for t in tasks:
        t.flags = [f for f in t.flags if f not in ASSIGN_FLAGS]

    def finish(t: Task, picks: list) -> None:
        t.assigned = [p for p, _ in picks]
        t.backups = [b for _, b in picks]
        t.assignee = t.assigned[0] if t.assigned else None
        t.backup = t.backups[0] if t.backups else None
        teams[t.id] = list(picks)
        result[t.id] = (t.assignee, t.backup)

    def assign_one(t: Task) -> None:
        slots = t.slots
        picks = [(None, None)] * len(slots)
        chosen = []
        fixed = {}
        if t.locked and t.assignee in mem:                      # người làm bị khóa (what-if) ở vị trí đầu
            m = mem[t.assignee]
            fixed[0] = (t.assignee, t.backup)
            if not _role_ok(m, slots[0]):
                _flag(t, "WRONG_ROLE", warnings)
            _commit(t, m.id, st)
            if m.quota is not None and st["count"][m.id] > m.quota:
                _flag(t, "OVER_QUOTA", warnings)
            free = _free(m, start, t.deadline)
            if not t.is_live and free is not None and st["hours"][m.id] > free + EPS:
                _flag(t, "NO_FREE_TIME", warnings)
            picks[0] = fixed[0]
            chosen.append(m.id)
        order = [i for i in range(len(slots)) if i not in fixed]
        while order:                                            # vị trí hiếm (ít ứng viên) xử lý trước
            order.sort(key=lambda i: (len(_eligible(t, slots[i], members, st, start, chosen)), i))
            i = order.pop(0)
            cands = sorted(_eligible(t, slots[i], members, st, start, chosen),
                           key=lambda m: _rank(m, t, st, start))
            if not cands:
                role_ok = [m for m in members if _role_ok(m, slots[i])]
                if not role_ok:
                    _flag(t, "NO_ROLE_MATCH", warnings)
                elif all(m.quota is not None and st["count"][m.id] >= m.quota for m in role_ok):
                    _flag(t, "OVER_QUOTA", warnings)
                else:
                    _flag(t, "NO_FREE_TIME", warnings)
                continue
            picks[i] = (cands[0].id, cands[1].id if len(cands) > 1 else None)
            _commit(t, cands[0].id, st)
            chosen.append(cands[0].id)
        finish(t, picks)

    for layer in topo_layers(tasks):
        pending = [by[i] for i in layer if by[i].type != "milestone"]
        while pending:
            def key(t: Task):
                counts = [len(_eligible(t, r, members, st, start)) for r in t.slots]
                dl = aware(t.deadline).timestamp() if t.deadline else float("inf")
                return (min(counts), dl, t.id)
            pending.sort(key=key)
            assign_one(pending.pop(0))

    return AssignResult(assignments=result, teams=teams, loads=st["count"],
                        load_hours=st["hours"], warnings=warnings)
