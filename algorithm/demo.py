"""Chạy thử toàn bộ chuỗi (dữ liệu giả lập). Chạy: python demo.py"""
from datetime import datetime

from taskplanner import (Member, VN_TZ, apply_deadlines, assign_task, call_ai_api,
                         check_deadline_alert, check_dependency, compute_timeline, fill_missing_on_air)

created = datetime(2026, 11, 2, 8, tzinfo=VN_TZ)         # tạo sự kiện / bắt đầu kế hoạch (thứ Hai)
event_start = datetime(2026, 11, 9, 8, tzinfo=VN_TZ)     # sự kiện bắt đầu
event_end = datetime(2026, 11, 9, 21, tzinfo=VN_TZ)      # sự kiện kết thúc

print("=== 1. AI ĐỌC BRIEF: SINH TASK, DURATION, EFFORT, START ===")
tasks = call_ai_api("Làm sự kiện Workshop AI", plan_start=created, event_end=event_end)
for t in tasks:
    print(f"{t.id} {t.name} [{t.category}]: kéo dài {t.duration:g}h, giờ công {t.work_hours:g}h, start={t.start or 'sau phụ thuộc'}")

print("\n=== 2. THÀNH VIÊN VÀ LỊCH RẢNH ===")
members = [
    Member("M1", "An", roles=["design", "photo"],
           schedule={"Monday": [(8, 12), (17, 21)], "Wednesday": [(18, 22)]}),
    Member("M2", "Bình", roles=["content"], schedule={"Monday": [(8, 12)], "Tuesday": [(8, 12)]}),
    Member("M3", "Chi", roles=["photo", "design"], schedule={"Thursday": [(13, 18)], "Monday": [(8, 12)]}),
    Member("M4", "Dũng", roles=["editor"], schedule={"Monday": [(8, 12)], "Tuesday": [(8, 12)]}),
]
for m in members:
    print(f"- {m.name}: {', '.join(m.roles)}")

print("\n=== 3. KIỂM TRA PHỤ THUỘC ===")
r = check_dependency(tasks)
print("Hợp lệ" if r.ok else f"Lỗi: {r.problems}")

print("\n=== 4. AI/HỆ THỐNG TÍNH ON-AIR, CODE TÍNH DEADLINE VÀ FEEDBACK ===")
fill_missing_on_air(tasks, event_start)
apply_deadlines(tasks, created)
for t in tasks:
    if t.is_live:
        print(f"{t.id}: LIVE, bắt đầu {t.on_air:%H:%M %d/%m}")
    else:
        print(f"{t.id}: on-air {t.on_air:%H:%M %d/%m} | nộp nháp {t.deadline:%H:%M %d/%m} | feedback xong {t.feedback_due:%H:%M %d/%m} {t.flags or ''}")

print("\n=== 5. PHÂN CÔNG (GREEDY, TASK HIẾM TRƯỚC) ===")
res = assign_task(tasks, members, start=created)
for t in tasks:
    team = res.teams[t.id]
    desc = " + ".join(f"{p} (dự phòng {b})" for p, b in team if p)
    print(f"{t.id} ({t.name}) -> {desc}" if desc else f"{t.id} ({t.name}) -> CHƯA PHÂN CÔNG {t.flags}")

print("\n=== 6. TIMELINE ===")
tl = compute_timeline(tasks, created)
print(f"Tổng {tl.total_hours:g}h, đường găng: {tl.critical_path}")
for w in tl.warnings:
    print("Cảnh báo:", w)

print("\n=== 7. CẢNH BÁO 12H ===")
from datetime import timedelta
alerts = check_deadline_alert(tasks, min(t.deadline for t in tasks if t.deadline) - timedelta(hours=10))
print("\n".join(a.message for a in alerts) or "Không có cảnh báo.")
