"""Kiểm tra phụ thuộc (phát hiện vòng) và sắp xếp topo theo tầng."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass


@dataclass
class DependencyResult:
    ok: bool
    problems: list
    cycle: list      # ví dụ ["A","C","B","A"]: A phụ thuộc C, C phụ thuộc B, B phụ thuộc A


def check_dependency(tasks: list) -> DependencyResult:
    ids = {t.id for t in tasks}
    problems = []
    for t in tasks:
        for d in t.depends_on:
            if d == t.id:
                problems.append(f"{t.id} phụ thuộc chính nó")
            elif d not in ids:
                problems.append(f"{t.id} phụ thuộc id không tồn tại: {d}")

    valid = {t.id: [d for d in t.depends_on if d in ids and d != t.id] for t in tasks}
    indeg = {i: len(ds) for i, ds in valid.items()}
    children = defaultdict(list)
    for i, ds in valid.items():
        for d in ds:
            children[d].append(i)

    queue = sorted(i for i, n in indeg.items() if n == 0)
    done = set()
    while queue:
        cur = queue.pop(0)
        done.add(cur)
        for c in sorted(children[cur]):
            indeg[c] -= 1
            if indeg[c] == 0:
                queue.append(c)

    cycle = []
    remaining = {i for i in valid if i not in done}
    if remaining:
        cur, seen = min(remaining), []
        while cur not in seen:
            seen.append(cur)
            cur = min(d for d in valid[cur] if d in remaining)
        cycle = seen[seen.index(cur):] + [cur]
        problems.append("Vòng phụ thuộc: " + " -> ".join(cycle))

    return DependencyResult(ok=not problems, problems=problems, cycle=cycle)


def topo_layers(tasks: list) -> list:
    """Các tầng topo (chỉ dùng khi đã kiểm tra không có vòng)."""
    ids = {t.id for t in tasks}
    deps = {t.id: [d for d in t.depends_on if d in ids and d != t.id] for t in tasks}
    indeg = {i: len(d) for i, d in deps.items()}
    children = defaultdict(list)
    for i, ds in deps.items():
        for d in ds:
            children[d].append(i)
    layer = sorted(i for i, n in indeg.items() if n == 0)
    out = []
    while layer:
        out.append(layer)
        nxt = []
        for cur in layer:
            for c in children[cur]:
                indeg[c] -= 1
                if indeg[c] == 0:
                    nxt.append(c)
        layer = sorted(nxt)
    return out
