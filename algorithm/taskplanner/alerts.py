"""Cảnh báo sắp trễ / quá hạn (giờ Việt Nam)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from .models import VN_TZ, aware, hours_between

ALERT_HOURS = 12


@dataclass
class Alert:
    task_id: str
    level: str              # "red" = quá hạn, "yellow" = còn <= 12 giờ
    hours_left: float
    message: str


def check_deadline_alert(tasks: list, now: Optional[datetime] = None,
                         threshold_hours: float = ALERT_HOURS) -> list:
    now = aware(now) if now else datetime.now(VN_TZ)
    alerts = []
    for t in tasks:
        if t.type != "task" or t.status == "done" or t.deadline is None:
            continue
        left = hours_between(now, t.deadline)
        label = f"{t.id} ({t.name})" if t.name else t.id
        if left < 0:
            alerts.append(Alert(t.id, "red", left, f"🔴 {label}: ĐÃ QUÁ HẠN {abs(left):.1f} giờ!"))
        elif left <= threshold_hours:
            alerts.append(Alert(t.id, "yellow", left, f"🟡 {label}: Sắp trễ! Còn {left:.1f} giờ."))
    return sorted(alerts, key=lambda a: (a.hours_left, a.task_id))
