"""taskplanner - thuật toán lập kế hoạch cho ban truyền thông CLB (TV2).

Mỗi file một nhiệm vụ:
    models.py        Task, Member, hằng số, hàm thời gian
    availability.py  giờ rảnh từ lịch tuần
    dependency.py    check_dependency, topo_layers
    deadlines.py     hạn nộp nháp và hạn feedback
    assignment.py    assign_task (Greedy)
    timeline.py      compute_timeline (topo, đường găng)
    alerts.py        check_deadline_alert
    editing.py       delete_task
    conflicts.py     trùng giờ cùng người, chuyển sang Backup
    workhours.py     khung giờ làm việc cho deadline
    replan.py        replan, what_if
    llm_input.py     đọc và kiểm tra CSV từ LLM
"""
from .alerts import Alert, check_deadline_alert
from .assignment import AssignResult, assign_task
from .availability import free_hours_between, weekly_free_hours
from .deadlines import (DeadlineResult, apply_deadlines, check_on_air_consistency, compute_deadlines,
                        compute_deadlines_dynamic, compute_deadlines_fixed_days, fill_missing_on_air)
from .conflicts import find_time_conflicts, resolve_with_backup
from .dependency import DependencyResult, check_dependency, topo_layers
from .editing import delete_task
from .llm_input import call_ai_api, tasks_from_csv
from .models import MAX_MEMBERS, MAX_TASKS, MIN_TASKS, VN_TZ, Member, Task
from .replan import Plan, replan, what_if
from .timeline import Timeline, compute_timeline
from .workhours import AVOID_SUNDAY, WORK_END, WORK_START, to_work_window
