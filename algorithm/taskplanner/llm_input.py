"""Nhận dữ liệu task do AI sinh (CSV) và KIỂM TRA bằng code (sai khuôn thì từ chối).

AI chỉ sinh ĐẦU VÀO: duration, effort, on_air, start, complexity, roles, depends_on.
Deadline và feedback do code tính sau đó (deadlines.py), AI không quyết định.

Cột CSV: id,name,duration,roles,depends_on,complexity,on_air,start,effort,category
- duration: thời gian TRÔI QUA của task, ghi giờ hoặc "2d" = 2 ngày.
- effort: giờ công người làm thật sự (có thể ghi "1d"); để trống = bằng duration; không được lớn hơn duration.
- on_air: dạng "2026-11-09 08:00" (giờ VN); để trống thì hệ thống tự suy từ lúc sự kiện bắt đầu.
- start: "creation" = bắt đầu ngay khi tạo kế hoạch, "event" = bắt đầu lúc sự kiện bắt đầu, trống = khi phụ thuộc xong.
- category: onpage (content + design/editor), product (design, in ấn), onsite (photo, giờ cố định). Có category thì
  không cần cột roles. Task onsite không có hạn nộp nháp/feedback; on_air trống thì lấy lúc sự kiện bắt đầu.
- Trong ô nhiều giá trị dùng dấu ';' (ví dụ roles = "design;photo").
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Optional

from .models import Task, aware

REQUIRED_COLUMNS = ["id", "name", "duration", "depends_on", "complexity"]
MAX_DURATION_HOURS = 24 * 14      # lớn hơn 14 ngày thì nhiều khả năng AI sinh sai
VALID_START = ("", "creation", "event")
VALID_CATEGORY = ("", "onpage", "product", "onsite")


def _split(cell: str) -> list:
    return [x.strip() for x in (cell or "").split(";") if x.strip()]


def _hours(cell: str) -> float:
    """'4' -> 4 giờ, '2d' -> 48 giờ."""
    cell = (cell or "").strip().lower()
    if cell.endswith("d"):
        return float(cell[:-1]) * 24
    return float(cell)


def tasks_from_csv(text: str, plan_start: Optional[datetime] = None,
                   event_end: Optional[datetime] = None,
                   max_duration: float = MAX_DURATION_HOURS) -> list:
    reader = csv.DictReader(io.StringIO(text.strip()))
    missing = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
    if missing:
        raise ValueError(f"Thiếu cột: {', '.join(missing)}")

    tasks, errors, seen = [], [], set()
    for n, row in enumerate(reader, start=2):
        tid = (row["id"] or "").strip()
        if not tid:
            errors.append(f"Dòng {n}: thiếu id")
            continue
        if tid in seen:
            errors.append(f"Dòng {n}: id trùng {tid}")
        seen.add(tid)
        where = f"Dòng {n} ({tid})"
        try:
            duration = _hours(row["duration"])
            if duration <= 0:
                raise ValueError
        except (TypeError, ValueError):
            errors.append(f"{where}: duration phải là số > 0 (giờ, hoặc 2d = 2 ngày)")
            continue
        if duration > max_duration:
            errors.append(f"{where}: duration {duration:g}h vượt {max_duration:g}h, nghi AI sinh sai")
            continue

        effort = None
        raw_effort = (row.get("effort") or "").strip()
        if raw_effort:
            try:
                effort = _hours(raw_effort)
                if effort <= 0:
                    raise ValueError
            except ValueError:
                errors.append(f"{where}: effort phải là số > 0")
                continue
            if effort > duration + 1e-9:
                errors.append(f"{where}: effort {effort:g}h lớn hơn thời lượng {duration:g}h")
                continue

        try:
            complexity = int(row["complexity"])
            if complexity not in (1, 2, 3):
                raise ValueError
        except (TypeError, ValueError):
            errors.append(f"{where}: complexity phải là 1, 2 hoặc 3")
            continue

        start = (row.get("start") or "").strip().lower()
        if not start and (row.get("live") or "").strip().lower() in ("yes", "y", "1", "có", "co"):
            start = "event"                                   # tương thích cột live cũ
        if start not in VALID_START:
            errors.append(f"{where}: start phải là creation, event hoặc để trống")
            continue

        category = (row.get("category") or "").strip().lower()
        if category not in VALID_CATEGORY:
            errors.append(f"{where}: category phải là onpage, product, onsite hoặc để trống")
            continue

        on_air = None
        raw = (row.get("on_air") or "").strip()
        if raw:
            try:
                on_air = aware(datetime.fromisoformat(raw.replace(" ", "T")))
            except ValueError:
                errors.append(f"{where}: on_air phải có dạng 2026-11-09 08:00")
                continue
            if plan_start is not None and on_air < aware(plan_start):
                errors.append(f"{where}: on_air nằm trước lúc bắt đầu kế hoạch")
                continue
            if event_end is not None and on_air > aware(event_end):
                errors.append(f"{where}: on_air nằm sau ngày kết thúc sự kiện")
                continue

        tasks.append(Task(id=tid, name=(row["name"] or "").strip(), duration=duration, effort=effort,
                          roles_required=_split(row.get("roles")), depends_on=_split(row["depends_on"]),
                          complexity=complexity, start=start, on_air=on_air, category=category))
    if errors:
        raise ValueError("\n".join(errors))
    return tasks


def call_ai_api(user_brief: str, plan_start: Optional[datetime] = None,
                event_end: Optional[datetime] = None) -> list:
    """GIẢ LẬP LLM (stub cho demo). Bản thật: gọi Gemini, nhận CSV rồi đưa qua tasks_from_csv.
    AI không sinh on_air ở đây: hệ thống suy ra từ lúc sự kiện bắt đầu (fill_missing_on_air)."""
    fake_csv = (
        "id,name,duration,roles,depends_on,complexity,on_air,start,effort,category\n"
        "T1,Bài đăng mở đơn,2,,,1,,creation,,onpage\n"
        "T2,Thiết kế standee,2d,,,3,,creation,8,product\n"
        "T3,Chụp workshop,3,,,2,,,,onsite\n"
        "T4,Giấy chứng nhận,3d,,,2,,,3,product\n"
        "T5,Photoshoot BGK,2,,,2,2026-11-05 14:00,,,onsite\n"
    )
    return tasks_from_csv(fake_csv, plan_start, event_end)
