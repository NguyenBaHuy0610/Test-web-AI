from datetime import datetime, timedelta

from taskplanner import Task, VN_TZ, check_deadline_alert


def test_alert_12_gio_va_qua_han():
    now = datetime(2026, 11, 5, 10, tzinfo=VN_TZ)
    tasks = [Task("soon", deadline=now + timedelta(hours=11)),
             Task("late", deadline=now - timedelta(hours=2)),
             Task("far", deadline=now + timedelta(hours=40)),
             Task("done", deadline=now + timedelta(hours=1), status="done")]
    alerts = check_deadline_alert(tasks, now)
    assert [(a.task_id, a.level) for a in alerts] == [("late", "red"), ("soon", "yellow")]


def test_alert_chap_nhan_datetime_khong_mui_gio():
    now = datetime(2026, 11, 5, 10)                      # không tzinfo -> hiểu là giờ VN
    tasks = [Task("x", deadline=datetime(2026, 11, 5, 18))]
    assert check_deadline_alert(tasks, now)[0].level == "yellow"
