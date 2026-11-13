"""Tính giờ rảnh của thành viên từ lịch rảnh hằng tuần."""
from __future__ import annotations

from datetime import datetime, timedelta

from .models import VN_TZ, aware

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def weekly_free_hours(schedule: dict) -> float:
    """Tổng giờ rảnh của một tuần."""
    return float(sum(e - s for slots in schedule.values() for s, e in slots))


def free_hours_between(schedule: dict, start: datetime, end: datetime) -> float:
    """Giờ rảnh thật sự nằm trong khoảng [start, end] (lặp lại lịch tuần)."""
    start, end = aware(start).astimezone(VN_TZ), aware(end).astimezone(VN_TZ)
    total = 0.0
    day = start.replace(hour=0, minute=0, second=0, microsecond=0)
    while day < end:
        for s, e in schedule.get(WEEKDAYS[day.weekday()], []):
            a = max(day + timedelta(hours=s), start)
            b = min(day + timedelta(hours=e), end)
            if b > a:
                total += (b - a).total_seconds() / 3600
        day += timedelta(days=1)
    return total
