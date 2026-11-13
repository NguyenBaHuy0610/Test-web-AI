"""Chỉnh sửa kế hoạch: xóa task cha và nối lại phụ thuộc (hướng B)."""
from __future__ import annotations

import copy


def delete_task(tasks: list, task_id: str, skip: bool = False) -> tuple:
    """
    Xóa task: task con thừa hưởng phụ thuộc của task bị xóa (A->B->C, xóa B => C phụ thuộc A).
    Mốc template không xóa được, chỉ 'bỏ qua' (skip=True) với cách nối lại giống nhau.
    Trả về (danh_sách_mới, ghi_chú).
    """
    target = next((t for t in tasks if t.id == task_id), None)
    if target is None:
        raise ValueError(f"Không có task {task_id}")
    if target.source == "template" and not skip:
        raise ValueError(f"{task_id} là mốc template: không xóa, hãy dùng skip=True")

    new, notes = [], []
    for t in tasks:
        if t.id == task_id:
            continue
        t = copy.deepcopy(t)
        if task_id in t.depends_on:
            merged = [d for d in t.depends_on if d != task_id]
            for d in target.depends_on:
                if d not in merged and d != t.id:
                    merged.append(d)
            t.depends_on = merged
            notes.append(f"{t.id} được nối lại: phụ thuộc {merged or 'không có'}")
        new.append(t)
    return new, notes
