import pytest

from taskplanner import Task, delete_task


def test_08_xoa_task_cha_noi_lai():
    tasks = [Task("A"), Task("B", depends_on=["A"]), Task("C", depends_on=["B"])]
    new, notes = delete_task(tasks, "B")
    assert next(t for t in new if t.id == "C").depends_on == ["A"] and notes


def test_08b_moc_template_khong_xoa_chi_skip():
    tasks = [Task("M1", type="milestone", source="template"), Task("T", depends_on=["M1"])]
    with pytest.raises(ValueError):
        delete_task(tasks, "M1")
    new, _ = delete_task(tasks, "M1", skip=True)
    assert [t.id for t in new] == ["T"]
