"""Trùng giờ: hai task của CÙNG MỘT NGƯỜI có khung giờ GIỐNG HỆT nhau và tổng giờ công vượt khung đó.
Trùng một phần thì chấp nhận. Task có giờ công nhỏ hơn thời lượng (làm 4h trong 3 ngày) không bị coi là xung đột.
Chỉ cảnh báo; nếu có Backup phù hợp thì chuyển người đó sang Backup. Việc giờ cố định (on-site) đã được
kiểm tra trùng khoảng thời gian ngay lúc gán việc nên không xét ở đây.
"""
from __future__ import annotations

from collections import defaultdict

from .models import EPS


def _conflicts(tasks: list, timeline) -> list:
    g = defaultdict(list)
    for t in tasks:
        if t.is_live or t.type != "task" or t.id not in timeline.schedule:
            continue
        s = timeline.schedule[t.id]
        for person in t.people:
            g[(person, round(s["ES"], 6), round(s["EF"], 6))].append(t)
    out = []
    for (person, es, ef), ts in g.items():
        if len(ts) > 1 and sum(t.work_hours for t in ts) > (ef - es) + EPS:
            out.append((person, sorted(ts, key=lambda t: t.id)))
    return sorted(out, key=lambda x: (x[1][0].id, x[0]))


def find_time_conflicts(tasks: list, timeline) -> list:
    return [grp for _, grp in _conflicts(tasks, timeline)]


def resolve_with_backup(tasks: list, timeline) -> list:
    """Chuyển task thứ hai (theo id) của mỗi nhóm trùng sang Backup nếu Backup không bị trùng. Trả về ghi chú."""
    notes = []
    for person, grp in _conflicts(tasks, timeline):
        if not any(p == person and grp[0] in g for p, g in _conflicts(tasks, timeline)):
            continue                                              # đã được giải quyết bởi lần chuyển trước
        t = grp[-1]
        idx = t.assigned.index(person) if person in t.assigned else 0
        backup = t.backups[idx] if idx < len(t.backups) else t.backup
        if not backup or backup in t.people:
            continue
        t.reassign(idx, backup, person)
        if any(p == backup and t in g for p, g in _conflicts(tasks, timeline)):
            t.reassign(idx, person, backup)
        else:
            notes.append(f"{t.id}: chuyển sang người dự phòng để tránh trùng giờ với {grp[0].id}")
    return notes
