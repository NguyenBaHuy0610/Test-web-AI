"""Tính hạn nộp nháp và hạn feedback. Có 2 chế độ:
    - fixed_days: khó (3) -> nộp trước 2 ngày, vừa/dễ -> 1 ngày; feedback xong trước on-air 8-10h (mặc định)
    - dynamic   : trọng số liên tục từ độ phức tạp, thời lượng, áp lực thời gian
Deadline luôn do CODE tính, không để LLM quyết định. Hạn nộp/feedback được đẩy SỚM hơn vào khung 07:00-22:00 (workhours.py).
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from .dependency import topo_layers
from .models import Task, aware, hours_between
from .workhours import to_work_window

# Vật phẩm in ấn cần thêm thời gian in và giao: design phải xong sớm hơn từng này ngày (GIẢ ĐỊNH TẠM).
PRODUCT_PRINT_DAYS = 2

# Khoảng cách giữa "feedback xong" và on-air (giờ): để chỉnh sửa lần cuối và đăng bài.
# Độ phức tạp 1 -> 8h, 2 -> 9h, 3 -> 10h.
ONAIR_GAP_HOURS = {1: 8, 2: 9, 3: 10}

# ---- Tham số chế độ dynamic (GIẢ ĐỊNH TẠM, nhóm cần chốt) ----
W_COMPLEXITY, W_DURATION, W_PRESSURE = 0.5, 0.3, 0.2
DURATION_REF_HOURS = 8
BUFFER_MIN, BUFFER_RANGE = 24, 24       # nộp trước giờ đăng 24 -> 48 giờ
FEEDBACK_MIN, FEEDBACK_RANGE = 4, 12    # feedback 4 -> 16 giờ


@dataclass
class DeadlineResult:
    weight: Optional[float]
    buffer_hours: int
    feedback_hours: int
    submit: datetime          # hạn nộp nháp
    feedback_due: datetime    # hạn feedback xong
    flags: list


def print_lead_hours(task: Task) -> int:
    return PRODUCT_PRINT_DAYS * 24 if task.category == "product" else 0


def buffer_days(task: Task) -> int:
    """Số ngày nộp nháp sớm hơn on-air: khó 2 ngày, còn lại 1 ngày, vật phẩm in ấn cộng thêm ngày in."""
    return (2 if task.complexity >= 3 else 1) + print_lead_hours(task) // 24


def compute_deadlines_fixed_days(task: Task, now: datetime, on_air: datetime) -> DeadlineResult:
    now, on_air = aware(now), aware(on_air)
    days = buffer_days(task)
    lead = print_lead_hours(task)
    draft = to_work_window(on_air - timedelta(days=days))
    flags = []
    if draft <= now:
        flags.append("INFEASIBLE")
    elif hours_between(now, draft) < task.duration:
        flags.append("COMPRESSED")
    gap = ONAIR_GAP_HOURS[min(max(task.complexity, 1), 3)]
    return DeadlineResult(weight=None, buffer_hours=days * 24, feedback_hours=days * 24 - lead - gap,
                          submit=draft, feedback_due=to_work_window(on_air - timedelta(hours=gap + lead)), flags=flags)


def compute_deadlines_dynamic(task: Task, now: datetime, on_air: datetime) -> DeadlineResult:
    now, on_air = aware(now), aware(on_air)
    T = hours_between(now, on_air)
    d = max(task.duration, 0.0)
    flags = []

    c_norm = (min(max(task.complexity, 1), 3) - 1) / 2
    d_norm = min(d / DURATION_REF_HOURS, 1.0)
    pressure = min(d / T, 1.0) if T > 0 else 1.0
    w = W_COMPLEXITY * c_norm + W_DURATION * d_norm + W_PRESSURE * pressure

    buffer = BUFFER_MIN + BUFFER_RANGE * w + print_lead_hours(task)
    feedback = FEEDBACK_MIN + FEEDBACK_RANGE * w
    room = T - d
    if room < 0:
        flags.append("INFEASIBLE")
        buffer = 0
    elif room < buffer:
        flags.append("COMPRESSED")
        buffer = room
    feedback = min(feedback, buffer / 2)

    buffer_h = math.ceil(round(buffer, 6))
    feedback_h = math.ceil(round(feedback, 6))
    raw_submit = on_air - timedelta(hours=buffer_h)
    submit = to_work_window(raw_submit)
    return DeadlineResult(weight=round(w, 4), buffer_hours=buffer_h, feedback_hours=feedback_h,
                          submit=submit, feedback_due=to_work_window(raw_submit + timedelta(hours=feedback_h)), flags=flags)


def compute_deadlines(task: Task, now: datetime, on_air: datetime, mode: str = "fixed_days") -> DeadlineResult:
    if mode == "fixed_days":
        return compute_deadlines_fixed_days(task, now, on_air)
    if mode == "dynamic":
        return compute_deadlines_dynamic(task, now, on_air)
    raise ValueError(f"mode không hợp lệ: {mode}")


def apply_deadlines(tasks: list, now: datetime, mode: str = "fixed_days") -> None:
    """Điền deadline cho task có on_air nhưng chưa có deadline (không đè deadline nhập tay)."""
    for t in tasks:
        if t.is_live:                                     # việc live: không có nộp nháp/feedback
            t.deadline = t.feedback_due = None
            if "LIVE" not in t.flags:
                t.flags.append("LIVE")
            continue
        if t.start == "creation" and "START_NOW" not in t.flags:
            t.flags.append("START_NOW")
        if t.on_air and t.deadline is None and t.type == "task":
            r = compute_deadlines(t, now, t.on_air, mode)
            t.deadline, t.feedback_due = r.submit, r.feedback_due
            for f in r.flags:
                if f not in t.flags:
                    t.flags.append(f)


# ---------------------------------------------------------------------
# Thứ tự đúng: AI sinh duration + on_air  ->  code mới tính deadline + feedback.
# ---------------------------------------------------------------------
def fill_missing_on_air(tasks: list, event_start: datetime) -> None:
    """
    Task mà AI không sinh on_air thì tính ngược từ lúc sự kiện bắt đầu:
    on_air = min(event_start, hạn nộp của mọi task con - thời lượng task con).
    Việc live (start="event") có on_air = event_start. Gắn cờ ON_AIR_AUTO cho task được suy ra.
    Cần gọi sau check_dependency.
    """
    by = {t.id: t for t in tasks}
    children = defaultdict(list)
    for t in tasks:
        for d in t.depends_on:
            if d in by and d != t.id:
                children[d].append(t)
    event_start = aware(event_start)
    for t in tasks:
        if t.is_live and t.on_air is None:
            t.on_air = event_start
    for layer in reversed(topo_layers(tasks)):
        for tid in layer:
            t = by[tid]
            if t.on_air is not None or t.type == "milestone":
                continue
            a = event_start
            for c in children[tid]:
                if c.on_air is not None and not c.is_live:
                    a = min(a, aware(c.on_air) - timedelta(days=buffer_days(c)) - timedelta(hours=c.duration))
            t.on_air = a
            if "ON_AIR_AUTO" not in t.flags:
                t.flags.append("ON_AIR_AUTO")


def check_on_air_consistency(tasks: list) -> list:
    """Cảnh báo khi on_air của task cha (AI sinh) quá muộn so với lúc task con cần bắt đầu."""
    by = {t.id: t for t in tasks}
    out = []
    for c in tasks:
        if c.on_air is None or c.type == "milestone" or c.is_live:
            continue
        need = aware(c.on_air) - timedelta(days=buffer_days(c)) - timedelta(hours=c.duration)
        for pid in c.depends_on:
            p = by.get(pid)
            if p and p.on_air is not None and aware(p.on_air) > need + timedelta(seconds=1):
                out.append(f"{pid}: on-air muộn hơn lúc {c.id} cần bắt đầu ({need:%H:%M %d/%m})")
    return out
