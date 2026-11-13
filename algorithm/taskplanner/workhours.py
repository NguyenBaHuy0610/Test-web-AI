"""Khung giờ làm việc: không để hạn nộp / hạn feedback rơi vào đêm khuya (mặc định 07:00 đến 22:00)."""
from __future__ import annotations

from datetime import datetime, timedelta

from .models import VN_TZ, aware

WORK_START = 7
WORK_END = 22
AVOID_SUNDAY = False        # True: hạn rơi vào Chủ nhật thì lùi về 22:00 thứ Bảy


def to_work_window(dt: datetime, avoid_sunday: bool = AVOID_SUNDAY) -> datetime:
    """Đẩy hạn SỚM HƠN (không bao giờ muộn hơn) vào khung giờ làm việc."""
    dt = aware(dt).astimezone(VN_TZ)
    end_today = dt.replace(hour=WORK_END, minute=0, second=0, microsecond=0)
    if dt.hour < WORK_START:
        dt = end_today - timedelta(days=1)
    elif dt > end_today:
        dt = end_today
    if avoid_sunday and dt.weekday() == 6:
        dt = (dt - timedelta(days=1)).replace(hour=WORK_END, minute=0, second=0, microsecond=0)
    return dt
