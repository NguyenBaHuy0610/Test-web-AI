(() => {
    "use strict";

    const STATUS_LABELS = {
        not_started: "Chưa bắt đầu",
        in_progress: "Đang thực hiện",
        pending_review: "Chờ duyệt",
        completed: "Đã hoàn thành"
    };

    const state = {
        db: window.supabaseClient,
        events: [],
        tasksByEvent: new Map(),
        memberNames: new Map(),
        filtersByEvent: new Map(),
        year: "all",
        query: ""
    };

    const dom = {
        search: document.getElementById("eventSearch"),
        year: document.getElementById("yearFilter"),
        count: document.getElementById("eventCount"),
        list: document.getElementById("eventList")
    };

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);
    }

    function createIcons() {
        if (window.lucide) window.lucide.createIcons();
    }

    function formatDate(value) {
        if (!value) return "Chưa có dữ liệu";
        const date = new Date(`${value}T00:00:00`);
        return Number.isNaN(date.getTime())
            ? "Chưa có dữ liệu"
            : new Intl.DateTimeFormat(window.AppI18n?.locale || "vi-VN", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric"
            }).format(date);
    }

    function yearOf(date) {
        const year = String(date || "").slice(0, 4);
        return /^\d{4}$/.test(year) ? year : "";
    }

    function assignmentStatus(assignment) {
        if (assignment.is_done === true) return "completed";
        const value = String(assignment.assignment_state || "")
            .toLowerCase()
            .trim()
            .replaceAll(" ", "_");

        if (["in_progress", "doing", "processing"].includes(value)) return "in_progress";
        if (["pending_review", "review", "waiting_review"].includes(value)) return "pending_review";
        if (["completed", "complete", "done"].includes(value)) return "completed";
        return "not_started";
    }

    function taskStatus(task) {
        if (task.is_cancelled === true) return "cancelled";
        const assignments = (task.assignments || []).filter(assignment => assignment.member_id);
        if (!assignments.length) return "not_started";
        const statuses = assignments.map(assignmentStatus);
        if (statuses.every(status => status === "completed")) return "completed";
        if (statuses.includes("in_progress")) return "in_progress";
        if (statuses.includes("pending_review")) return "pending_review";
        return "not_started";
    }

    function taskStatusLabel(task) {
        return task.is_cancelled === true
            ? "Đã hủy"
            : STATUS_LABELS[taskStatus(task)];
    }

    function taskDeadline(task) {
        if (!task.package_deadline_date) return "Chưa có dữ liệu";
        const time = task.package_deadline_time
            ? ` · ${escapeHTML(task.package_deadline_time.slice(0, 5))}`
            : "";
        return `${escapeHTML(formatDate(task.package_deadline_date))}${time}`;
    }

    function renderYearOptions() {
        const years = [...new Set(state.events.flatMap(event => [
            yearOf(event.first_on_air_date),
            yearOf(event.last_on_air_date)
        ]).filter(Boolean))].sort((a, b) => b.localeCompare(a));
        dom.year.innerHTML = [
            ...years.map(year => `<option value="${year}">Năm ${year}</option>`),
            '<option value="all">Tất cả năm</option>'
        ].join("");
        if (state.year !== "all" && !years.includes(state.year)) {
            state.year = "all";
        }
        dom.year.value = state.year;
    }

    function filteredEvents() {
        return state.events
            .filter(event => {
                const startYear = Number(yearOf(event.first_on_air_date) || yearOf(event.last_on_air_date));
                const endYear = Number(yearOf(event.last_on_air_date) || yearOf(event.first_on_air_date));
                const includesYear = state.year === "all" ||
                    (startYear && endYear && startYear <= Number(state.year) && Number(state.year) <= endYear);
                const name = String(event.event_label || event.event_id || "").toLocaleLowerCase("vi");
                return includesYear && (!state.query || name.includes(state.query));
            })
            .sort((a, b) => String(b.last_on_air_date || "").localeCompare(String(a.last_on_air_date || "")));
    }

    function eventSummary(event) {
        const tasks = state.tasksByEvent.get(String(event.event_id)) || [];
        const completed = tasks.filter(task => taskStatus(task) === "completed").length;
        const active = tasks.filter(task => ["in_progress", "pending_review"].includes(taskStatus(task))).length;
        const notStarted = tasks.filter(task => taskStatus(task) === "not_started").length;
        const cancelled = tasks.filter(task => taskStatus(task) === "cancelled").length;
        return { tasks, completed, active, notStarted, cancelled };
    }

    function safeResultLink(value, label) {
        const raw = String(value || "").trim();
        if (!raw) return "Chưa có dữ liệu";
        try {
            const url = new URL(raw, window.location.href);
            if (!["http:", "https:"].includes(url.protocol)) return escapeHTML(raw);
            return `<a class="task-result-link" href="${escapeHTML(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label || "Mở liên kết")}</a>`;
        } catch {
            return escapeHTML(raw);
        }
    }

    function getEventFilter(eventId) {
        const id = String(eventId);
        if (!state.filtersByEvent.has(id)) {
            state.filtersByEvent.set(id, { query: "", status: "all", member: "all" });
        }
        return state.filtersByEvent.get(id);
    }

    function filteredTasks(eventId) {
        const tasks = state.tasksByEvent.get(String(eventId)) || [];
        const filter = getEventFilter(eventId);
        const query = filter.query.toLocaleLowerCase("vi");

        return tasks.filter(task => {
            const title = String(task.task_title || task.submission_label || task.task_id).toLocaleLowerCase("vi");
            const members = (task.assignments || []).map(assignment => String(assignment.member_id));
            const status = taskStatus(task);
            return (!query || title.includes(query)) &&
                (filter.status === "all" || status === filter.status) &&
                (filter.member === "all" || members.includes(filter.member));
        });
    }

    function taskTable(eventId) {
        const tasks = filteredTasks(eventId);
        if (!tasks.length) {
            return '<div class="task-empty">Không tìm thấy công việc phù hợp hoặc sự kiện chưa có công việc.</div>';
        }

        return `
            <div class="task-table-wrap">
                <table class="event-task-table">
                    <thead>
                        <tr>
                            <th>Tên công việc</th>
                            <th>Trạng thái</th>
                            <th>Người phụ trách</th>
                            <th>Hạn chót</th>
                            <th>Kết quả</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tasks.map(task => {
                            const assignments = task.assignments || [];
                            const memberLabels = assignments
                                .map(assignment => state.memberNames.get(String(assignment.member_id)))
                                .filter(Boolean);
                            const uniqueMembers = [...new Set(memberLabels)];
                            const status = taskStatus(task);
                            const attachments = task.attachments || [];
                            const links = attachments.filter(attachment => attachment.file_url);
                            return `
                                <tr>
                                    <td>${escapeHTML(task.task_title || task.submission_label || task.task_id || "Chưa có dữ liệu")}</td>
                                    <td><span class="task-status ${status}">${escapeHTML(taskStatusLabel(task))}</span></td>
                                    <td>${uniqueMembers.length ? uniqueMembers.map(escapeHTML).join(", ") : "Chưa phân công"}</td>
                                    <td>${taskDeadline(task)}</td>
                                    <td>${links.length ? links.map(attachment =>
                                        safeResultLink(attachment.file_url, attachment.file_name)
                                    ).join("<br>") : "Chưa có dữ liệu"}</td>
                                </tr>`;
                        }).join("")}
                    </tbody>
                </table>
            </div>`;
    }

    function renderEvent(event) {
        const id = String(event.event_id);
        const { tasks, completed, active, notStarted, cancelled } = eventSummary(event);
        const filter = getEventFilter(id);
        const members = [...new Set(tasks.flatMap(task =>
            (task.assignments || []).map(assignment => String(assignment.member_id))
        ))].filter(Boolean).map(memberId => ({
            id: memberId,
            name: state.memberNames.get(memberId) || memberId
        })).sort((a, b) => a.name.localeCompare(b.name, "vi"));
        const description = event.category_note || event.event_category;

        return `
            <details class="event-entry">
                <summary class="event-summary">
                    <span class="event-name">${escapeHTML(event.event_label || event.event_id || "Chưa có dữ liệu")}</span>
                    <span class="event-dates"><small>Ngày bắt đầu</small>${escapeHTML(formatDate(event.first_on_air_date))}</span>
                    <span class="event-dates"><small>Ngày kết thúc</small>${escapeHTML(formatDate(event.last_on_air_date))}</span>
                    <span class="event-status"><i data-lucide="${event.is_completed ? "circle-check" : "circle-help"}"></i> ${event.is_completed ? "Đã hoàn tất" : "Chưa hoàn tất"}</span>
                    <span class="event-toggle">Xem chi tiết <i data-lucide="chevron-down"></i></span>
                </summary>
                <div class="event-details">
                    <p class="event-description">${escapeHTML(description || "Chưa có mô tả sự kiện.")}</p>
                    <div class="event-task-heading">
                        <div>
                            <h2>Công việc thuộc sự kiện <span class="event-task-count">${tasks.length}</span></h2>
                            <p>${completed} đã hoàn thành · ${active} đang xử lý · ${notStarted} chưa bắt đầu · ${cancelled} đã hủy</p>
                        </div>
                    </div>
                    <div class="task-filter-controls">
                        <div class="task-search">
                            <label for="task-search-${escapeHTML(id)}">Tìm kiếm công việc</label>
                            <div class="task-search-box">
                                <i data-lucide="search"></i>
                                <input id="task-search-${escapeHTML(id)}" data-task-search="${escapeHTML(id)}" type="search" value="${escapeHTML(filter.query)}" placeholder="Tìm kiếm công việc..." autocomplete="off">
                            </div>
                        </div>
                        <div class="assignee-filter">
                            <label for="assignee-${escapeHTML(id)}">Người phụ trách</label>
                            <select id="assignee-${escapeHTML(id)}" data-assignee-filter="${escapeHTML(id)}">
                                <option value="all">Tất cả thành viên</option>
                                ${members.map(member => `<option value="${escapeHTML(member.id)}" ${filter.member === member.id ? "selected" : ""}>${escapeHTML(member.name)}</option>`).join("")}
                            </select>
                        </div>
                        <button class="clear-filters" type="button" data-clear-filters="${escapeHTML(id)}">Xóa bộ lọc</button>
                    </div>
                    <div class="task-status-filter">
                        <span>Trạng thái</span>
                        <div class="status-filter-buttons">
                            ${[
                                ["all", "Tất cả trạng thái"],
                                ["completed", "Đã hoàn thành"],
                                ["in_progress", "Đang thực hiện"],
                                ["not_started", "Chưa bắt đầu"],
                                ["cancelled", "Đã hủy"]
                            ].map(([value, label]) => `
                                <button class="status-filter ${filter.status === value ? "active" : ""}" type="button" data-status-filter="${escapeHTML(id)}" data-status="${value}">${label}</button>
                            `).join("")}
                        </div>
                    </div>
                    <div class="active-filters-row">
                        <div class="active-filter-tags">
                            <span class="filter-tag">Hiển thị ${filteredTasks(id).length}/${tasks.length} công việc</span>
                            ${filter.status !== "all" ? `<span class="filter-tag">Trạng thái: ${escapeHTML(STATUS_LABELS[filter.status] || "Đã hủy")}</span>` : ""}
                            ${filter.member !== "all" ? `<span class="filter-tag">Người phụ trách: ${escapeHTML(state.memberNames.get(filter.member) || filter.member)}</span>` : ""}
                        </div>
                    </div>
                    <div data-task-table="${escapeHTML(id)}">${taskTable(id)}</div>
                </div>
            </details>`;
    }

    function render() {
        const events = filteredEvents();
        dom.count.textContent = `${events.length} sự kiện`;
        if (!events.length) {
            dom.list.innerHTML = `<div class="history-message">${state.events.length
                ? "Không tìm thấy sự kiện phù hợp với bộ lọc."
                : "Supabase hiện chưa có dữ liệu sự kiện."}</div>`;
            return;
        }
        dom.list.innerHTML = events.map(renderEvent).join("");
        createIcons();
    }

    async function loadData() {
        if (!state.db?.from) throw new Error("Không tìm thấy kết nối Supabase.");

        dom.list.innerHTML = '<div class="history-message">Đang tải dữ liệu từ Supabase...</div>';
        const [eventsResult, tasksResult, assignmentsResult, membersResult] = await Promise.all([
            state.db.from("events").select(
                "event_id, event_label, event_category, category_note, n_tasks, first_on_air_date, last_on_air_date, is_completed"
            ),
            state.db.from("tasks").select(
                "task_id, event_id, task_no, task_title, submission_label, package_deadline_date, package_deadline_time, is_cancelled"
            ),
            state.db.from("task_assignments").select(
                "task_id, role, assignment_state, member_id, is_done"
            ),
            state.db.from("members").select("member_id, member_label")
        ]);

        for (const result of [eventsResult, tasksResult, assignmentsResult, membersResult]) {
            if (result.error) throw result.error;
        }

        const tasks = tasksResult.data || [];
        const taskIds = tasks.map(task => task.task_id).filter(Boolean);
        let attachments = [];
        if (taskIds.length) {
            const attachmentsResult = await state.db.from("task_attachments")
                .select("attachment_id, task_id, file_name, file_url, file_type, file_size, uploaded_by, created_at")
                .in("task_id", taskIds)
                .order("created_at", { ascending: false });
            if (attachmentsResult.error) throw attachmentsResult.error;
            attachments = attachmentsResult.data || [];
        }

        state.events = eventsResult.data || [];
        state.memberNames = new Map((membersResult.data || []).map(member =>
            [String(member.member_id), member.member_label || String(member.member_id)]
        ));

        const assignmentsByTask = new Map();
        (assignmentsResult.data || []).forEach(assignment => {
            const taskId = String(assignment.task_id);
            if (!assignmentsByTask.has(taskId)) assignmentsByTask.set(taskId, []);
            assignmentsByTask.get(taskId).push(assignment);
        });

        const attachmentsByTask = new Map();
        attachments.forEach(attachment => {
            const taskId = String(attachment.task_id);
            if (!attachmentsByTask.has(taskId)) attachmentsByTask.set(taskId, []);
            attachmentsByTask.get(taskId).push(attachment);
        });

        state.tasksByEvent = new Map();
        tasks.forEach(task => {
            const eventId = String(task.event_id);
            if (!state.tasksByEvent.has(eventId)) state.tasksByEvent.set(eventId, []);
            state.tasksByEvent.get(eventId).push({
                ...task,
                assignments: assignmentsByTask.get(String(task.task_id)) || [],
                attachments: attachmentsByTask.get(String(task.task_id)) || []
            });
        });

        renderYearOptions();
        render();
    }

    function updateTaskDetails(eventId) {
        const id = String(eventId);
        const entry = [...dom.list.querySelectorAll(".event-entry")]
            .find(item => item.querySelector(`[data-task-table="${CSS.escape(id)}"]`));
        if (!entry) return;

        const tableContainer = entry.querySelector(`[data-task-table="${CSS.escape(id)}"]`);
        tableContainer.innerHTML = taskTable(id);

        const tags = entry.querySelector(".active-filter-tags");
        const taskCount = (state.tasksByEvent.get(id) || []).length;
        tags.innerHTML = `<span class="filter-tag">Hiển thị ${filteredTasks(id).length}/${taskCount} công việc</span>`;

        const filter = getEventFilter(id);
        if (filter.status !== "all") {
            const tag = document.createElement("span");
            tag.className = "filter-tag";
            tag.textContent = `Trạng thái: ${STATUS_LABELS[filter.status] || "Đã hủy"}`;
            tags.appendChild(tag);
        }
        if (filter.member !== "all") {
            const tag = document.createElement("span");
            tag.className = "filter-tag";
            tag.textContent = `Người phụ trách: ${state.memberNames.get(filter.member) || filter.member}`;
            tags.appendChild(tag);
        }
    }

    dom.search.addEventListener("input", () => {
        state.query = dom.search.value.trim().toLocaleLowerCase("vi");
        render();
    });

    dom.year.addEventListener("change", () => {
        state.year = dom.year.value;
        render();
    });

    dom.list.addEventListener("input", event => {
        const input = event.target.closest("[data-task-search]");
        if (!input) return;
        getEventFilter(input.dataset.taskSearch).query = input.value.trim();
        updateTaskDetails(input.dataset.taskSearch);
    });

    dom.list.addEventListener("change", event => {
        const select = event.target.closest("[data-assignee-filter]");
        if (!select) return;
        getEventFilter(select.dataset.assigneeFilter).member = select.value;
        updateTaskDetails(select.dataset.assigneeFilter);
    });

    dom.list.addEventListener("click", event => {
        const statusButton = event.target.closest("[data-status-filter]");
        if (statusButton) {
            const filter = getEventFilter(statusButton.dataset.statusFilter);
            filter.status = statusButton.dataset.status;
            const entry = statusButton.closest(".event-entry");
            entry.querySelectorAll("[data-status-filter]").forEach(button => {
                button.classList.toggle("active", button.dataset.status === filter.status);
            });
            updateTaskDetails(statusButton.dataset.statusFilter);
            return;
        }

        const clearButton = event.target.closest("[data-clear-filters]");
        if (clearButton) {
            const id = String(clearButton.dataset.clearFilters);
            state.filtersByEvent.set(id, { query: "", status: "all", member: "all" });
            render();
            const entry = [...dom.list.querySelectorAll(".event-entry")]
                .find(item => item.querySelector(`[data-task-table="${CSS.escape(id)}"]`));
            if (entry) entry.open = true;
        }
    });

    loadData().catch(error => {
        console.error("Không thể tải lịch sử sự kiện từ Supabase:", error);
        dom.count.textContent = "Không thể tải dữ liệu";
        dom.list.innerHTML = `<div class="history-message error">Không thể tải dữ liệu lịch sử: ${escapeHTML(error.message || "Lỗi Supabase")}</div>`;
    });
})();