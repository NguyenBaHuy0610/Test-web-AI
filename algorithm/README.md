# Task planner (TV2 - thuật toán)

Chạy demo:      python demo.py          (Python 3.9+, không cần cài thêm thư viện)
Trang web demo: mở task-planner-demo.html bằng trình duyệt (JavaScript thuần)

Chuỗi xử lý (taskplanner/replan.py):
  AI sinh task (llm_input.py) -> check_dependency -> fill_missing_on_air -> apply_deadlines
  -> assign_task -> compute_timeline -> trùng giờ (conflicts.py) -> check_deadline_alert

Mỗi file một nhiệm vụ:
  models.py        Task, Member, 3 loại task (onpage, product, onsite)
  availability.py  giờ rảnh từ lịch tuần
  dependency.py    check_dependency, sắp xếp topo
  workhours.py     khung giờ làm việc 07:00-22:00 cho deadline
  deadlines.py     hạn nộp nháp, hạn feedback, suy on-air còn thiếu
  assignment.py    assign_task (Greedy, nhiều vị trí người cho mỗi task)
  timeline.py      compute_timeline (đường găng, slack)
  conflicts.py     trùng giờ cùng người, chuyển sang Backup
  alerts.py        check_deadline_alert
  editing.py       delete_task
  replan.py        replan, what_if
  llm_input.py     đọc và kiểm tra CSV từ AI
