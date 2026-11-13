"""Cấu trúc dữ liệu dùng chung: Task, Member, hằng số và hàm thời gian."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

try:
    from zoneinfo import ZoneInfo
    VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
except Exception:
    VN_TZ = timezone(timedelta(hours=7))
EPS = 1e-9

# Giới hạn quy mô (CLB). Stress test 200 task: truyền max_tasks=200 vào replan.
MIN_TASKS = 1
MAX_TASKS = 50
MAX_MEMBERS = 30

# Ba loại task của nhóm. Mỗi phần tử là MỘT VỊ TRÍ cần người; trong vị trí liệt kê các role chấp nhận.
#   onpage : bài đăng mạng xã hội = content + (design hoặc editor)  -> 2 người
#   product: vật phẩm in ấn (standee, banner, móc khóa, giấy chứng nhận) = design
#   onsite : quay chụp photoshoot, workshop, ngày on-site = photo (giờ cố định, không có nộp nháp/feedback)
CATEGORY_ROLES = {
    "onpage": [["content"], ["design", "editor"]],
    "product": [["design"]],
    "onsite": [["photo"]],
}


@dataclass
class Task:
    id: str
    name: str = ""
    duration: float = 1.0                                  # thời gian TRÔI QUA của task (giờ); milestone = 0
    effort: Optional[float] = None                         # giờ công người làm thật sự; None = bằng duration
    roles_required: list = field(default_factory=list)     # rỗng = ai cũng làm được
    depends_on: list = field(default_factory=list)
    complexity: int = 2                                    # 1..3 (AI gợi ý, người duyệt)
    type: str = "task"                                     # "task" | "milestone"
    source: str = "custom"                                 # "template" | "custom"
    fixed_hour: Optional[float] = None                     # mốc cố định (giờ từ lúc bắt đầu)
    start: str = ""                                        # "" = khi phụ thuộc xong | "creation" = ngay khi tạo kế hoạch | "event" = lúc sự kiện bắt đầu
    on_air: Optional[datetime] = None                      # giờ đăng / diễn ra
    deadline: Optional[datetime] = None                    # hạn nộp (nháp)
    feedback_due: Optional[datetime] = None                # hạn feedback xong
    status: str = "todo"                                   # todo | doing | done
    assignee: Optional[str] = None
    backup: Optional[str] = None
    locked: bool = False                                   # giữ nguyên người làm (what-if)
    category: str = ""                                     # "" | "onpage" | "product" | "onsite"
    role_slots: list = field(default_factory=list)         # ghi đè các vị trí cần người (mặc định theo category)
    assigned: list = field(default_factory=list)           # người chính theo từng vị trí (None = chưa có)
    backups: list = field(default_factory=list)            # người dự phòng theo từng vị trí
    flags: list = field(default_factory=list)

    @property
    def slots(self) -> list:
        """Các vị trí cần người, mỗi vị trí là danh sách role chấp nhận ([] = ai cũng được)."""
        if self.role_slots:
            return self.role_slots
        if self.category in CATEGORY_ROLES:
            return CATEGORY_ROLES[self.category]
        return [self.roles_required]

    @property
    def people(self) -> list:
        """Những người đang được giao task này."""
        if self.assigned:
            return [a for a in self.assigned if a]
        return [self.assignee] if self.assignee else []

    def reassign(self, idx: int, member, backup) -> None:
        """Đổi người ở vị trí idx, giữ assignee/backup (vị trí 0) đồng bộ."""
        if self.assigned and idx < len(self.assigned):
            self.assigned[idx] = member
            self.backups[idx] = backup
        if idx == 0:
            self.assignee, self.backup = member, backup

    @property
    def work_hours(self) -> float:
        """Giờ công dùng để kiểm tra giờ rảnh và tính tải."""
        return self.duration if self.effort is None else self.effort

    @property
    def is_live(self) -> bool:
        """Task giờ cố định: bắt đầu lúc sự kiện (start=event) hoặc on-site. Không có hạn nộp nháp/feedback."""
        return self.start == "event" or self.category == "onsite"


@dataclass
class Member:
    id: str
    name: str = ""
    roles: list = field(default_factory=list)
    # Lịch rảnh hằng tuần: {"Monday": [(17, 21)], "Wednesday": [(18, 22)]}
    # None = chưa khai báo lịch -> không giới hạn giờ.
    schedule: Optional[dict] = None
    quota: Optional[int] = None                            # số bài tối đa; None = không giới hạn


def aware(dt: datetime) -> datetime:
    """Datetime không có múi giờ được hiểu là giờ Việt Nam."""
    return dt if dt.tzinfo else dt.replace(tzinfo=VN_TZ)


def hours_between(a: datetime, b: datetime) -> float:
    return (aware(b) - aware(a)).total_seconds() / 3600
