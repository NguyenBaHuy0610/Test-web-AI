/* =========================================================
   MULTIMEDIATASK - TASK LIST
   Supabase tables: tasks, task_assignments
   Note: priority, task creator, progress %, notes and files are
   not present in the supplied schema; they are not fabricated.
========================================================= */
(() => {
  "use strict";

  const CONFIG = window.TASK_LIST_CONFIG || {};
  const PAGE_SIZE = Number(CONFIG.pageSize) || 8;
  const $ = (s, root = document) => root.querySelector(s);

  const dom = {
    search: $("#taskSearch"), toggleFilters: $("#toggleTaskFilters"),
    advancedFilters: $("#advancedTaskFilters"), groupFilter: $("#groupFilter"),
    resetFilters: $("#resetTaskFilters"),
    sort: $("#taskSort"), groupTabs: [...document.querySelectorAll(".group-filter")],
    statusTabs: [...document.querySelectorAll(".status-tab")],
    total: $("#totalTasksCount"), notStarted: $("#notStartedCount"),
    inProgress: $("#inProgressCount"), completed: $("#completedCount"),
    resultInfo: $("#taskResultInfo"), tbody: $("#taskTableBody"),
    tableInfo: $("#taskTableInfo"), previous: $("#previousPage"),
    next: $("#nextPage"), pageLabel: $("#currentPageLabel"),
    detailModal: $("#taskDetailModal"), detailTitle: $("#detailDrawerTitle"),
    detail: $("#taskDetailContent"), viewFull: $("#viewFullTaskBtn"),
    updateButton: $("#openUpdateProgress"), progressModal: $("#updateProgressModal"),
    progressTitle: $("#progressTaskTitle"), progressGroup: $("#progressTaskGroup"),
    form: $("#updateProgressForm"), status: $("#taskStatusInput")
  };

  const state = {
    db: null, memberId: null, tasks: [], filtered: [], memberNames: new Map(),
    group: "", status: "all", page: 1, selected: null
  };

  const STATUS = {
    not_started: "Chưa bắt đầu",
    in_progress: "Đang thực hiện",
    pending_review: "Chờ duyệt",
    completed: "Đã hoàn thành"
  };

  function client() {
    if (window.supabaseClient?.from) return window.supabaseClient;
    try { if (typeof supabase !== "undefined" && supabase?.from) return supabase; } catch (_) {}
    return null;
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function text(node, value) { if (node) node.textContent = value ?? "—"; }

  function dateTime(date, time) {
    if (!date) return "—";
    const d = new Date(`${date}T${time || "00:00:00"}`);
    return Number.isNaN(d.getTime()) ? esc(date) :
      new Intl.DateTimeFormat(window.AppI18n?.locale || "vi-VN", {
        day: "2-digit", month: "2-digit", year: "numeric",
        ...(time ? { hour: "2-digit", minute: "2-digit" } : {})
      }).format(d);
  }

  function deadline(task) {
    if (task.package_deadline_at) {
      const d = new Date(task.package_deadline_at);
      return Number.isNaN(d.getTime()) ? "—" :
        new Intl.DateTimeFormat(window.AppI18n?.locale || "vi-VN", {
          day: "2-digit", month: "2-digit", year: "numeric",
          hour: "2-digit", minute: "2-digit"
        }).format(d);
    }
    return dateTime(task.package_deadline_date, task.package_deadline_time);
  }

  function onAir(task) {
    if (task.on_air_at) {
      const d = new Date(task.on_air_at);
      return Number.isNaN(d.getTime()) ? "—" :
        new Intl.DateTimeFormat(window.AppI18n?.locale || "vi-VN", {
          day: "2-digit", month: "2-digit", year: "numeric",
          hour: "2-digit", minute: "2-digit"
        }).format(d);
    }
    return dateTime(task.on_air_date, task.on_air_time);
  }

  function memberLabel(id) {
    return state.memberNames.get(String(id)) || id || "Chưa phân công";
  }

  function normalizeFunctionGroup(value) {
    const normalized = String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    const groups = {
      edit: "edit",
      editor: "edit",
      video_editor: "edit",
      design: "design",
      designer: "design",
      content: "content",
      content_writer: "content",
      content_creator: "content",
      tech: "tech",
      technician: "tech",
      technical: "tech",
      photo: "photo",
      photographer: "photo",
      photography: "photo"
    };
    return groups[normalized] || normalized;
  }

  function publicationStatus(task) {
    const posted = task.post_done === true ? "Đã đăng" :
      task.post_done === false ? "Chưa đăng" : "Chưa rõ trạng thái";
    const page = task.posted_on_main_page === true ? "Trang chính" :
      task.posted_on_main_page === false ? "Không lên trang chính" : "Chưa rõ trang đăng";
    return [posted, page, task.post_method].filter(Boolean).join(" · ");
  }

  function assignmentStatus(a) {
    if (a.is_done === true) return "completed";
    const value = String(a.assignment_state || "").toLowerCase().trim();
    if (["in_progress", "in progress", "doing", "processing"].includes(value)) return "in_progress";
    if (["pending_review", "pending review", "review", "waiting_review"].includes(value)) return "pending_review";
    if (["completed", "complete", "done"].includes(value)) return "completed";
    return "not_started";
  }

  function taskStatus(task) {
    const list = (task.assignments || []).filter(a => a.member_id);
    if (!list.length) return "not_started";
    if (list.every(a => assignmentStatus(a) === "completed")) return "completed";
    if (list.some(a => assignmentStatus(a) === "in_progress")) return "in_progress";
    if (list.some(a => assignmentStatus(a) === "pending_review")) return "pending_review";
    return "not_started";
  }

  function statusHTML(status) {
    return `<span class="status-chip status-${status}">${STATUS[status] || STATUS.not_started}</span>`;
  }

  function showMessage(message) {
    if (dom.tbody) dom.tbody.innerHTML =
      `<tr><td colspan="8" class="table-message">${esc(message)}</td></tr>`;
  }

  async function loadData() {
    showMessage("Đang tải danh sách công việc...");
    const [tasksResult, assignmentsResult, membersResult, eventsResult] = await Promise.all([
      state.db.from("tasks").select(`
        task_id, task_no, event_id, task_title, task_type, submission_label,
        description, on_air_date, on_air_time, on_air_at,
        package_deadline_date, package_deadline_time, package_deadline_at,
        posted_on_main_page, post_method, is_cancelled, post_done, data_quality_flag
      `),
      state.db.from("task_assignments").select("task_id, role, assignment_state, member_id, is_done"),
      state.db.from("members").select("member_id, member_label"),
      state.db.from("events").select("event_id, is_completed")
    ]);

    if (tasksResult.error) throw tasksResult.error;
    if (assignmentsResult.error) throw assignmentsResult.error;
    if (membersResult.error) throw membersResult.error;
    if (eventsResult.error) throw eventsResult.error;

    const activeEventIds = new Set((eventsResult.data || [])
      .filter(event => event.is_completed !== true)
      .map(event => String(event.event_id)));
    const activeEventTasks = (tasksResult.data || []).filter(task =>
      task.event_id != null && activeEventIds.has(String(task.event_id))
    );

    state.memberNames = new Map((membersResult.data || []).map(member =>
      [String(member.member_id), member.member_label || member.member_id]
    ));

    const byTask = new Map();
    (assignmentsResult.data || []).forEach(a => {
      if (!byTask.has(a.task_id)) byTask.set(a.task_id, []);
      byTask.get(a.task_id).push(a);
    });

    state.tasks = activeEventTasks.map(task => ({
      ...task,
      assignments: byTask.get(task.task_id) || []
    }));
    applyFilters();
  }

  function applyFilters() {
    const query = dom.search?.value.trim().toLocaleLowerCase("vi") || "";
    const role = dom.groupFilter?.value || "";

    state.filtered = state.tasks.filter(task => {
      const roles = task.assignments.map(a => a.role);
      const status = taskStatus(task);
      const haystack = [
        task.task_id, task.task_no, task.task_title, task.submission_label,
        task.description, task.task_type, ...roles
      ].join(" ").toLocaleLowerCase("vi");

      return task.is_cancelled !== true &&
        (!query || haystack.includes(query)) &&
        (!state.group || roles.some(r =>
          normalizeFunctionGroup(r) === normalizeFunctionGroup(state.group)
        )) &&
        (!role || roles.some(r =>
          normalizeFunctionGroup(r) === normalizeFunctionGroup(role)
        )) &&
        (state.status === "all" || status === state.status);
    });

    const sort = dom.sort?.value || "deadline_asc";
    state.filtered.sort((a, b) => {
      if (sort === "deadline_asc" || sort === "deadline_desc") {
        const av = a.package_deadline_at || a.package_deadline_date || "9999-12-31";
        const bv = b.package_deadline_at || b.package_deadline_date || "9999-12-31";
        return sort === "deadline_asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const av = a.on_air_at || a.on_air_date || "";
      const bv = b.on_air_at || b.on_air_date || "";
      return bv.localeCompare(av);
    });

    state.page = 1;
    render();
  }

  function render() {
    const counts = { total: state.tasks.length, not_started: 0, in_progress: 0, completed: 0 };
    state.tasks.forEach(task => {
      const s = taskStatus(task);
      if (s === "not_started") counts.not_started++;
      if (s === "in_progress" || s === "pending_review") counts.in_progress++;
      if (s === "completed") counts.completed++;
    });

    text(dom.total, counts.total);
    text(dom.notStarted, counts.not_started);
    text(dom.inProgress, counts.in_progress);
    text(dom.completed, counts.completed);
    text(dom.resultInfo, `Có ${state.filtered.length} công việc phù hợp`);

    const start = (state.page - 1) * PAGE_SIZE;
    const rows = state.filtered.slice(start, start + PAGE_SIZE);

    if (!state.tasks.length) {
      showMessage(
        "Supabase không trả về công việc nào. Kiểm tra dữ liệu trong bảng tasks, đúng project URL và quyền SELECT/RLS."
      );
    } else if (!rows.length) {
      showMessage("Không tìm thấy công việc phù hợp.");
    }
    else {
      dom.tbody.innerHTML = rows.map(task => {
        const roles = [...new Set(task.assignments.map(a => a.role).filter(Boolean))];
        const members = [...new Set(task.assignments.map(a => a.member_id).filter(Boolean))];
        return `
          <tr class="task-row" data-task-id="${esc(task.task_id)}" tabindex="0">
            <td class="task-name-cell">${esc(task.task_title || task.submission_label || task.task_id)}<small class="task-row-meta">${esc(task.task_no ? `#${task.task_no} · ` : "")}${esc(task.submission_label || task.task_id)}</small></td>
            <td>${esc([task.event_id, task.task_type].filter(Boolean).join(" · ") || "—")}</td>
            <td>${roles.length ? roles.map(r => `<span class="group-chip">${esc(r)}</span>`).join(" ") : "—"}</td>
            <td>${members.length ? members.map(id => esc(memberLabel(id))).join(", ") : "Chưa phân công"}</td>
            <td>${esc(onAir(task))}</td>
            <td>${esc(deadline(task))}</td>
            <td>${esc(publicationStatus(task))}</td>
            <td>${task.is_cancelled === true ? '<span class="status-chip status-cancelled">Đã hủy</span>' : statusHTML(taskStatus(task))}</td>
          </tr>`;
      }).join("");
    }

    const pages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
    text(dom.tableInfo, `Hiển thị ${state.filtered.length ? start + 1 : 0}–${Math.min(start + PAGE_SIZE, state.filtered.length)} / ${state.filtered.length} công việc`);
    text(dom.pageLabel, `${state.page} / ${pages}`);
    if (dom.previous) dom.previous.disabled = state.page <= 1;
    if (dom.next) dom.next.disabled = state.page >= pages;
    if (window.lucide) window.lucide.createIcons();
  }

  function openModal(modal) {
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    if (![dom.detailModal, dom.progressModal].some(m => m && !m.hidden)) {
      document.body.classList.remove("modal-open");
    }
  }

  function renderDetail(task) {
    const assignments = task.assignments || [];
    const roles = [...new Set(assignments.map(a => a.role).filter(Boolean))];
    const members = [...new Set(assignments.map(a => a.member_id).filter(Boolean))];
    text(dom.detailTitle, "Chi tiết công việc");

    dom.detail.innerHTML = `
      <section class="detail-section">
        <h2 class="detail-task-title">${esc(task.task_title || task.submission_label || task.task_id)}</h2>
        <div class="task-status-priority">${statusHTML(taskStatus(task))}</div>
      </section>
      <section class="detail-section">
        <h3>Mô tả công việc</h3>
        <p class="detail-description">${esc(task.description || "Chưa có mô tả.")}</p>
      </section>
      <div class="task-meta-grid">
        <div class="meta-item"><span>Mã công việc</span><strong>${esc(task.task_id)}</strong></div>
        <div class="meta-item"><span>Số thứ tự</span><strong>${esc(task.task_no ?? "—")}</strong></div>
        <div class="meta-item"><span>Mã sự kiện</span><strong>${esc(task.event_id || "—")}</strong></div>
        <div class="meta-item"><span>Nhãn nộp bài</span><strong>${esc(task.submission_label || "—")}</strong></div>
        <div class="meta-item"><span>Loại công việc</span><strong>${esc(task.task_type || "—")}</strong></div>
        <div class="meta-item"><span>Vai trò</span><strong>${roles.length ? roles.map(esc).join(", ") : "—"}</strong></div>
        <div class="meta-item"><span>Người thực hiện</span><strong>${members.length ? members.map(id => esc(memberLabel(id))).join(", ") : "Chưa phân công"}</strong></div>
        <div class="meta-item"><span>Deadline</span><strong>${esc(deadline(task))}</strong></div>
        <div class="meta-item"><span>Ngày lên sóng</span><strong>${esc(onAir(task))}</strong></div>
        <div class="meta-item"><span>Đăng trên trang chính</span><strong>${task.posted_on_main_page == null ? "Chưa rõ" : task.posted_on_main_page ? "Có" : "Không"}</strong></div>
        <div class="meta-item"><span>Phương thức đăng</span><strong>${esc(task.post_method || "—")}</strong></div>
        <div class="meta-item"><span>Đã đăng bài</span><strong>${task.post_done == null ? "Chưa rõ" : task.post_done ? "Đã đăng" : "Chưa đăng"}</strong></div>
        <div class="meta-item"><span>Đã hủy</span><strong>${task.is_cancelled == null ? "Chưa rõ" : task.is_cancelled ? "Có" : "Không"}</strong></div>
        <div class="meta-item"><span>Cờ chất lượng dữ liệu</span><strong>${esc(task.data_quality_flag || "—")}</strong></div>
      </div>
      <section class="detail-section" style="margin-top:20px">
        <h4>Phân công theo vai trò</h4>
        ${assignments.length ? `<div class="attachment-list">${assignments.map(a => `
          <div class="attachment-item">
            <span><strong>${esc(a.role)}</strong><small>${esc(memberLabel(a.member_id))} · ${STATUS[assignmentStatus(a)]}${a.assignment_state ? ` · ${esc(a.assignment_state)}` : ""}</small></span>
          </div>`).join("")}</div>` : `<p class="attachment-empty">Công việc chưa có phân công.</p>`}
      </section>
      <section class="detail-section">
        <h4>Thông tin chưa có trong database</h4>
        <p class="personal-note note-empty">Mức độ ưu tiên, người giao việc, phần trăm tiến độ, ghi chú và tệp đính kèm chưa có cột/bảng tương ứng trong schema hiện tại.</p>
      </section>`;
    if (dom.updateButton) dom.updateButton.disabled = !state.memberId ||
      !assignments.some(a => String(a.member_id) === String(state.memberId));
  }

  function openDetail(taskId) {
    const task = state.tasks.find(t => t.task_id === taskId);
    if (!task) return;
    state.selected = task;
    renderDetail(task);
    openModal(dom.detailModal);
  }

  async function saveProgress(event) {
    event.preventDefault();
    const task = state.selected;
    if (!task || !state.memberId) {
      alert("Không xác định được thành viên đang đăng nhập.");
      return;
    }

    const assignment = task.assignments.find(a =>
      String(a.member_id) === String(state.memberId)
    );
    if (!assignment) {
      alert("Bạn không được phân công vào công việc này.");
      return;
    }

    const status = dom.status.value;
    const isDone = status === "completed";
    const { data, error } = await state.db.from("task_assignments")
      .update({
        assignment_state: status,
        is_done: isDone
      })
      .eq("task_id", task.task_id)
      .eq("member_id", state.memberId)
      .select("task_id");

    if (error) {
      console.error(error);
      alert(`Không thể cập nhật: ${error.message}`);
      return;
    }
    if (!data?.length) {
      alert("Không có phân công nào được cập nhật. Kiểm tra quyền truy cập.");
      return;
    }

    closeModal(dom.progressModal);
    closeModal(dom.detailModal);
    await loadData();
  }

  function openProgress() {
    const task = state.selected;
    if (!task) return;
    const assignment = task.assignments.find(a =>
      String(a.member_id) === String(state.memberId)
    );
    if (!assignment) return;

    text(dom.progressTitle, task.task_title || task.task_id);
    text(dom.progressGroup, assignment.role || "—");
    dom.status.value = assignmentStatus(assignment);
    openModal(dom.progressModal);
  }

  function bind() {
    let searchTimer;
    dom.search?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilters, 200);
    });
    dom.sort?.addEventListener("change", applyFilters);
    dom.groupFilter?.addEventListener("change", applyFilters);

    dom.toggleFilters?.addEventListener("click", () => {
      dom.advancedFilters.hidden = !dom.advancedFilters.hidden;
    });
    dom.resetFilters?.addEventListener("click", () => {
      dom.search.value = "";
      dom.groupFilter.value = "";
      state.group = "";
      state.status = "all";
      dom.groupTabs.forEach(b => b.classList.toggle("active", !b.dataset.group));
      dom.statusTabs.forEach(b => b.classList.toggle("active", b.dataset.status === "all"));
      applyFilters();
    });

    dom.groupTabs.forEach(button => button.addEventListener("click", () => {
      state.group = button.dataset.group || "";
      dom.groupTabs.forEach(b => b.classList.toggle("active", b === button));
      applyFilters();
    }));
    dom.statusTabs.forEach(button => button.addEventListener("click", () => {
      state.status = button.dataset.status || "all";
      dom.statusTabs.forEach(b => b.classList.toggle("active", b === button));
      applyFilters();
    }));

    dom.tbody?.addEventListener("click", event => {
      const row = event.target.closest("[data-task-id]");
      if (row) openDetail(row.dataset.taskId);
    });
    dom.tbody?.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        const row = event.target.closest("[data-task-id]");
        if (row) { event.preventDefault(); openDetail(row.dataset.taskId); }
      }
    });

    dom.previous?.addEventListener("click", () => {
      if (state.page > 1) { state.page--; render(); }
    });
    dom.next?.addEventListener("click", () => {
      if (state.page < Math.ceil(state.filtered.length / PAGE_SIZE)) { state.page++; render(); }
    });

    document.querySelectorAll("[data-close-modal]").forEach(button => {
      button.addEventListener("click", () => closeModal(document.getElementById(button.dataset.closeModal)));
    });
    [dom.detailModal, dom.progressModal].forEach(modal => modal?.addEventListener("click", e => {
      if (e.target === modal) closeModal(modal);
    }));
    dom.updateButton?.addEventListener("click", openProgress);
    dom.form?.addEventListener("submit", saveProgress);
    dom.viewFull?.addEventListener("click", () => {
      if (state.selected) {
        const task = state.selected;
        alert(`Mã công việc: ${task.task_id}\n${task.description || "Chưa có mô tả."}`);
      }
    });

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        closeModal(dom.progressModal);
        closeModal(dom.detailModal);
      }
    });
  }

  async function init() {
    bind();
    state.db = client();
    if (!state.db) {
      showMessage("Không tìm thấy Supabase client. Hãy nạp Supabase SDK và supabase.js trước task-list.js.");
      return;
    }

    try {
      if (CONFIG.memberId) state.memberId = String(CONFIG.memberId);
      else {
        const { data, error } = await state.db.auth.getSession();
        if (error) throw error;
        const user = data.session?.user;
        state.memberId = user?.user_metadata?.member_id ||
          user?.app_metadata?.member_id || user?.id || null;
      }
      await loadData();
    } catch (error) {
      console.error("[task-list]", error);
      showMessage(error.message || "Không thể tải danh sách công việc. Kiểm tra quyền truy cập Supabase/RLS.");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else init();
})();
