from taskplanner import Task, compute_timeline


def abcd():
    return [Task("A", duration=2),
            Task("B", duration=3, depends_on=["A"]),
            Task("C", duration=1, depends_on=["A"]),
            Task("D", duration=2, depends_on=["B", "C"])]


def test_06_timeline_duong_gang():
    tl = compute_timeline(abcd())
    assert tl.total_hours == 7
    assert tl.critical_path == ["A", "B", "D"]
    assert tl.schedule["C"]["slack"] == 2
    assert (tl.schedule["B"]["ES"], tl.schedule["B"]["EF"]) == (2, 5)
    assert (tl.schedule["D"]["ES"], tl.schedule["D"]["EF"]) == (5, 7)


def test_10_khong_kip_moc():
    tasks = [Task("M_open", type="milestone", fixed_hour=0),
             Task("big1", duration=30, depends_on=["M_open"]),
             Task("big2", duration=30, depends_on=["big1"]),
             Task("M_close", type="milestone", fixed_hour=48, depends_on=["big2"])]
    tl = compute_timeline(tasks)
    assert any("Không kịp mốc M_close" in w for w in tl.warnings)
