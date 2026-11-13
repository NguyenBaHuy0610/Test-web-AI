from taskplanner import Task, check_dependency


def test_05_vong_phu_thuoc():
    tasks = [Task("A", depends_on=["C"]), Task("B", depends_on=["A"]), Task("C", depends_on=["B"])]
    r = check_dependency(tasks)
    assert not r.ok
    assert r.cycle[0] == r.cycle[-1]
    assert set(r.cycle) == {"A", "B", "C"}


def test_05b_phu_thuoc_sai():
    r = check_dependency([Task("A", depends_on=["A"]), Task("B", depends_on=["Z"])])
    assert not r.ok and len(r.problems) == 2


def test_khong_vong_thi_ok():
    r = check_dependency([Task("A"), Task("B", depends_on=["A"])])
    assert r.ok and r.cycle == []
