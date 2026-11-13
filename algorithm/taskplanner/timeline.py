"""Tính timeline: sắp xếp topo, ES/EF/LS/LF, slack và đường găng (đơn vị: giờ).
Dùng duration (thời gian trôi qua), không dùng effort. Việc live (start="event") bị ghim ở lúc sự kiện bắt đầu.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from .dependency import topo_layers
from .models import EPS, hours_between


@dataclass
class Timeline:
    schedule: dict          # id -> {ES, EF, LS, LF, slack, critical}
    total_hours: float
    critical_path: list
    warnings: list


def compute_timeline(tasks: list, plan_start: Optional[datetime] = None) -> Timeline:
    by = {t.id: t for t in tasks}
    order = [i for layer in topo_layers(tasks) for i in layer]
    children = defaultdict(list)
    for t in tasks:
        for d in t.depends_on:
            if d in by and d != t.id:
                children[d].append(t.id)
    warnings = []

    live_at = {}
    if plan_start is not None:
        for t in tasks:
            if t.is_live and t.on_air is not None:
                live_at[t.id] = hours_between(plan_start, t.on_air)

    # Forward pass
    ES, EF = {}, {}
    for i in order:
        t = by[i]
        es = max((EF[d] for d in t.depends_on if d in EF), default=0.0)
        if t.fixed_hour is not None:
            if es > t.fixed_hour + EPS:
                warnings.append(f"Không kịp mốc {i}: sớm nhất xong lúc {es:g}h, mốc cố định {t.fixed_hour:g}h")
            else:
                es = t.fixed_hour
        if i in live_at:
            if es > live_at[i] + EPS:
                warnings.append(f"Không kịp {i}: việc chuẩn bị xong lúc {es:g}h, sự kiện bắt đầu lúc {live_at[i]:g}h")
            else:
                es = live_at[i]
        if t.start == "creation" and es > EPS:
            warnings.append(f"{i} bắt đầu ngay khi tạo kế hoạch nhưng phải chờ phụ thuộc, xong lúc {es:g}h")
        dur = 0.0 if t.type == "milestone" else t.duration
        ES[i], EF[i] = es, es + dur
    end = max(EF.values(), default=0.0)

    # Deadline -> giờ tính từ lúc bắt đầu
    dl_hours = {}
    if plan_start is not None:
        for t in tasks:
            if t.deadline is not None and t.type == "task":
                dl_hours[t.id] = hours_between(plan_start, t.deadline)

    # Backward pass
    LF, LS = {}, {}
    for i in reversed(order):
        t = by[i]
        lf = min((LS[c] for c in children[i]), default=end)
        if t.fixed_hour is not None:
            lf = min(lf, t.fixed_hour)
        if i in dl_hours:
            lf = min(lf, dl_hours[i])
        dur = 0.0 if t.type == "milestone" else t.duration
        if i in live_at:
            lf = live_at[i] + dur
        LF[i], LS[i] = lf, lf - dur

    for i, h in dl_hours.items():
        if EF[i] > h + EPS:
            warnings.append(f"Trễ deadline {i}: dự kiến xong lúc {EF[i]:g}h, hạn nộp lúc {h:g}h")

    schedule = {}
    for i in order:
        slack = LS[i] - ES[i]
        schedule[i] = {"ES": ES[i], "EF": EF[i], "LS": LS[i], "LF": LF[i],
                       "slack": slack, "critical": slack <= EPS}
    critical = sorted((i for i in order if schedule[i]["critical"]), key=lambda i: (ES[i], i))
    return Timeline(schedule=schedule, total_hours=end, critical_path=critical, warnings=warnings)
