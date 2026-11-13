/* ==========================================
   MULTIMEDIA TASK - MY TASKS
   Không sử dụng dữ liệu giả.
========================================== */

const PAGE_SIZE = 5;

const state = {
    db: window.supabaseClient || null,
    memberId: null,
    tasks: [],
    filteredTasks: [],
    selectedTask: null,
    status: "all",
    keyword: "",
    group: "",
    page: 1
};

const el = {
    search: document.getElementById("taskSearch"),
    tableBody: document.getElementById("taskTableBody"),
    tableInfo: document.getElementById("taskTableInfo"),
    previousPage: document.getElementById("previousPage"),
    nextPage: document.getElementById("nextPage"),
    currentPage: document.getElementById("currentPageLabel"),
    detailModal: document.getElementById("taskDetailModal"),
    detailContent: document.getElementById("taskDetailContent"),
    progressModal: document.getElementById("updateProgressModal"),
    progressForm: document.getElementById("updateProgressForm")
};

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
}

function formatRoleLabel(role = "") {
    return String(role)
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, character => character.toUpperCase());
}

function normalizeTask(task, assignments, attachments) {
    const roles = [...new Set(
        assignments.map(assignment => assignment.role).filter(Boolean)
    )];
    const statuses = assignments.map(assignmentStatus);
    const status = statuses.every(value => value === "completed")
        ? "completed"
        : statuses.includes("in_progress")
            ? "in_progress"
            : statuses.includes("pending_review")
                ? "pending_review"
                : "not_started";
    const deadline = task.package_deadline_at ||
        task.package_deadline_date || "";

    return {
        id: task.task_id,
        title: task.task_title || task.submission_label || task.task_id,
        group: roles.map(formatRoleLabel).join(", "),
        groupRoles: roles,
        assigner: "",
        deadline,
        createdAt: "",
        priority: "",
        status,
        description: task.description || "",
        progress: status === "completed" ? 100 : 0,
        attachments,
        assignments
    };
}

function assignmentStatus(assignment = {}) {
    if (assignment.is_done === true) return "completed";

    const status = String(assignment.assignment_state || "")
        .toLowerCase()
        .trim()
        .replaceAll(" ", "_");

    if (["in_progress", "doing", "processing"].includes(status)) {
        return "in_progress";
    }

    if (["pending_review", "review", "waiting_review"].includes(status)) {
        return "pending_review";
    }

    if (["completed", "complete", "done"].includes(status)) {
        return "completed";
    }

    return "not_started";
}

function statusLabel(status) {
    return {
        not_started: "Chưa bắt đầu",
        in_progress: "Đang thực hiện",
        pending_review: "Chờ duyệt",
        completed: "Đã hoàn thành"
    }[status] || status || "Chưa cập nhật";
}

function formatDate(value) {
    if (!value) return "Chưa cập nhật";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return escapeHTML(value);
    }

    return new Intl.DateTimeFormat(window.AppI18n?.locale || "vi-VN").format(date);
}

/* ==========================================
   LOAD DATA
========================================== */

async function loadMyTasks() {
    if (!state.db?.from) {
        showTaskLoadError("Không tìm thấy kết nối Supabase.");
        return;
    }

    el.tableBody.innerHTML = `
        <tr>
            <td colspan="7" class="table-message">
                Đang tải danh sách công việc...
            </td>
        </tr>
    `;

    try {
        const configuredMemberId =
            window.MY_TASKS_CONFIG?.memberId ||
            window.TASK_LIST_CONFIG?.memberId;

        if (configuredMemberId) {
            state.memberId = String(configuredMemberId);
        } else {
            const { data, error } = await state.db.auth.getSession();
            if (error) throw error;

            const user = data.session?.user;
            if (!user) {
                state.memberId = null;
            } else {
                const { data: membership, error: membershipError } = await state.db
                    .from("team_members")
                    .select("member_id")
                    .eq("user_id", user.id)
                    .maybeSingle();

                if (membershipError) throw membershipError;

                state.memberId = membership?.member_id ||
                    user.user_metadata?.member_id ||
                    user.app_metadata?.member_id ||
                    null;
            }
        }

        if (!state.memberId) {
            state.tasks = [];
            updateStatistics(null);
            applyFilters();
            updateOverallProgress(null);
            showTaskLoadError("Tài khoản chưa được liên kết với thành viên. Hãy thêm liên kết trong bảng team_members.");
            return;
        }

        const [assignmentsResult, eventsResult] = await Promise.all([
            state.db
                .from("task_assignments")
                .select("task_id, role, assignment_state, member_id, is_done")
                .eq("member_id", state.memberId),
            state.db
                .from("events")
                .select("event_id, is_completed")
        ]);

        if (assignmentsResult.error) throw assignmentsResult.error;
        if (eventsResult.error) throw eventsResult.error;

        const activeEventIds = new Set(
            (eventsResult.data || [])
                .filter(event => event.is_completed !== true)
                .map(event => String(event.event_id))
        );

        const assignmentsByTask = new Map();
        (assignmentsResult.data || []).forEach(assignment => {
            const taskAssignments =
                assignmentsByTask.get(assignment.task_id) || [];
            taskAssignments.push(assignment);
            assignmentsByTask.set(assignment.task_id, taskAssignments);
        });

        const taskIds = [...assignmentsByTask.keys()];
        if (!taskIds.length) {
            state.tasks = [];
            state.page = 1;
            updateStatistics(null);
            applyFilters();
            updateOverallProgress(null);
            return;
        }

        const { data: tasks, error: tasksError } = await state.db
            .from("tasks")
            .select(`
                task_id, task_no, event_id, task_title, task_type,
                submission_label, description, on_air_date, on_air_time,
                on_air_at, package_deadline_date, package_deadline_time,
                package_deadline_at, posted_on_main_page, post_method,
                is_cancelled, post_done, data_quality_flag
            `)
            .in("task_id", taskIds);

        if (tasksError) throw tasksError;

        const activeEventTasks = (tasks || []).filter(task =>
            task.event_id != null && activeEventIds.has(String(task.event_id))
        );
        const activeTaskIds = activeEventTasks.map(task => task.task_id);
        if (!activeTaskIds.length) {
            state.tasks = [];
            state.page = 1;
            updateStatistics(null);
            applyFilters();
            updateOverallProgress(null);
            return;
        }

        const { data: attachments, error: attachmentsError } = await state.db
            .from("task_attachments")
            .select("attachment_id, task_id, file_name, file_url, file_type, file_size, uploaded_by, created_at")
            .in("task_id", activeTaskIds)
            .order("created_at", { ascending: false });

        if (attachmentsError) throw attachmentsError;

        const attachmentsByTask = new Map();
        (attachments || []).forEach(attachment => {
            const taskAttachments = attachmentsByTask.get(attachment.task_id) || [];
            taskAttachments.push(attachment);
            attachmentsByTask.set(attachment.task_id, taskAttachments);
        });

        state.tasks = activeEventTasks
            .filter(task => task.is_cancelled !== true)
            .filter(task => assignmentsByTask.has(task.task_id))
            .map(task => normalizeTask(
                task,
                assignmentsByTask.get(task.task_id),
                attachmentsByTask.get(task.task_id) || []
            ));

        state.page = 1;

        updateStatistics(null);
        applyFilters();
        updateOverallProgress(null);

    } catch (error) {
        console.error("Lỗi tải công việc:", error);
        showTaskLoadError("Không thể tải công việc. Kiểm tra kết nối và quyền truy cập Supabase.");
        updateStatistics(null);
        updateOverallProgress(null);
    }

    refreshIcons();
}

function showTaskLoadError(message) {
    el.tableBody.innerHTML = `
        <tr>
            <td colspan="7" class="table-message">${escapeHTML(message)}</td>
        </tr>
    `;
    el.tableInfo.textContent = message;
}

/* ==========================================
   STATISTICS
========================================== */

function updateStatistics(summary) {
    const counts = {
        total: summary?.total ?? state.tasks.length,

        not_started: summary?.not_started ??
            state.tasks.filter(t => t.status === "not_started").length,

        in_progress: summary?.in_progress ??
            state.tasks.filter(t => t.status === "in_progress").length,

        completed: summary?.completed ??
            state.tasks.filter(t => t.status === "completed").length
    };

    document.getElementById("totalTasksCount").textContent =
        counts.total;

    document.getElementById("notStartedCount").textContent =
        counts.not_started;

    document.getElementById("inProgressCount").textContent =
        counts.in_progress;

    document.getElementById("completedCount").textContent =
        counts.completed;
}

function updateOverallProgress(summary) {
    const total = Number(
        summary?.total ?? state.tasks.length
    );

    const completed = Number(
        summary?.completed ??
        state.tasks.filter(t => t.status === "completed").length
    );

    const percentage = summary?.overall_progress != null
        ? Math.max(0, Math.min(100, Number(summary.overall_progress)))
        : (total ? Math.round(completed / total * 100) : 0);

    document.getElementById("overallProgressValue").textContent =
        total ? `${percentage}%` : "—";

    document.getElementById("overallProgressBar").style.width =
        total ? `${percentage}%` : "0%";

    document.getElementById("overallProgressDescription").textContent =
        total
            ? `Đã hoàn thành ${completed}/${total} công việc.`
            : "Chưa có dữ liệu công việc.";
}

/* ==========================================
   SEARCH AND FILTER
========================================== */

function applyFilters() {
    const keyword = state.keyword.toLocaleLowerCase("vi");

    state.filteredTasks = state.tasks.filter(task => {
        const matchesKeyword =
            !keyword ||
            task.title.toLocaleLowerCase("vi").includes(keyword) ||
            task.group.toLocaleLowerCase("vi").includes(keyword) ||
            task.assigner.toLocaleLowerCase("vi").includes(keyword);

        const matchesStatus =
            state.status === "all" ||
            task.status === state.status;

        const matchesGroup =
            !state.group ||
            task.groupRoles.some(role =>
                role.toLowerCase() === state.group.toLowerCase()
            );

        return matchesKeyword &&
               matchesStatus &&
               matchesGroup;
    });

    const totalPages = Math.max(
        1,
        Math.ceil(state.filteredTasks.length / PAGE_SIZE)
    );

    state.page = Math.min(state.page, totalPages);

    renderTaskTable();
}

/* ==========================================
   RENDER TASK TABLE
========================================== */

function renderTaskTable() {
    const totalPages = Math.max(
        1,
        Math.ceil(state.filteredTasks.length / PAGE_SIZE)
    );

    const start = (state.page - 1) * PAGE_SIZE;

    const pageTasks = state.filteredTasks.slice(
        start,
        start + PAGE_SIZE
    );

    if (!pageTasks.length) {
        el.tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="table-message">
                    Không có công việc phù hợp.
                </td>
            </tr>
        `;
    } else {
        el.tableBody.innerHTML = pageTasks.map(task => `
            <tr>
                <td class="task-name-cell"
                    title="${escapeHTML(task.title)}">
                    ${escapeHTML(task.title || "Chưa có tiêu đề")}
                </td>

                <td>
                    <span class="group-chip">
                        ${escapeHTML(task.group || "—")}
                    </span>
                </td>

                <td>${escapeHTML(task.assigner || "—")}</td>

                <td>${escapeHTML(formatDate(task.deadline))}</td>

                <td><span class="priority-chip">Chưa thiết lập</span></td>

                <td>
                    <span class="status-chip status-${escapeHTML(task.status)}">
                        ${escapeHTML(statusLabel(task.status))}
                    </span>
                </td>

                <td>
                    <button type="button"
                        class="table-action-btn"
                        data-open-task="${escapeHTML(task.id)}">
                        Chi tiết
                        <i data-lucide="chevron-right"></i>
                    </button>
                </td>
            </tr>
        `).join("");
    }

    el.tableInfo.textContent = state.filteredTasks.length
        ? `Hiển thị ${start + 1}–${Math.min(
            start + PAGE_SIZE,
            state.filteredTasks.length
        )} trong ${state.filteredTasks.length} công việc`
        : "Không có công việc";

    el.currentPage.textContent =
        `${state.page} / ${totalPages}`;

    el.previousPage.disabled = state.page <= 1;
    el.nextPage.disabled = state.page >= totalPages;

    refreshIcons();
}

/* ==========================================
   MODAL CONTROL
========================================== */

function openModal(modal) {
    if (!modal) return;

    modal.hidden = false;
    document.body.classList.add("modal-open");

    refreshIcons();
}

function closeModal(modal) {
    if (!modal) return;

    modal.hidden = true;

    const hasOpenModal = [
        ...document.querySelectorAll(".modal-overlay")
    ].some(item => !item.hidden);

    if (!hasOpenModal) {
        document.body.classList.remove("modal-open");
    }
}

/* ==========================================
   TASK DETAIL POPUP
========================================== */

function openTaskDetail(taskId) {
    const task = state.tasks.find(item => String(item.id) === String(taskId));
    if (!task) return;

    state.selectedTask = task;
    renderTaskDetail(task);
    openModal(el.detailModal);
}

function renderSavedAttachments(attachments) {
    return attachments.length
        ? attachments.map(attachment => {
            const safeUrl = getSafeSubmissionUrl(attachment.file_url);
            const content = `
                <i data-lucide="${safeUrl ? "link" : "file-warning"}"></i>
                <span><strong>${escapeHTML(attachment.file_name || "Link bài làm")}</strong><small>${escapeHTML(safeUrl ? formatDate(attachment.created_at) : "URL không hợp lệ")}</small></span>`;
            const item = safeUrl
                ? `<a class="attachment-item" href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer">${content}</a>`
                : `<div class="attachment-item">${content}</div>`;
            const deleteButton = String(attachment.uploaded_by) === String(state.memberId)
                ? `<button type="button" class="attachment-delete" data-delete-attachment="${escapeHTML(attachment.attachment_id)}" aria-label="Xóa ${escapeHTML(attachment.file_name || "link bài làm")}">Xóa</button>`
                : "";

            return `<div class="attachment-row">${item}${deleteButton}</div>`;
        }).join("")
        : '<p class="attachment-empty">Chưa có link bài làm được lưu.</p>';
}

/* ==========================================
   RENDER TASK DETAIL
========================================== */

function renderTaskDetail(task) {
    const roles = task.assignments
        .map(assignment => assignment.role)
        .filter(Boolean)
        .map(formatRoleLabel);
    const attachments = task.attachments || [];
    const savedAttachments = renderSavedAttachments(attachments);

    el.detailContent.innerHTML = `
        <section class="detail-section">
            <h1 class="detail-task-title">
                ${escapeHTML(task.title || "Chưa có tiêu đề")}
            </h1>

            <div class="task-status-priority">
                <span class="status-chip status-${escapeHTML(task.status)}">
                    ${escapeHTML(statusLabel(task.status))}
                </span>
            </div>
        </section>

        <section class="detail-section">
            <h3>Mô tả công việc</h3>

            <p class="detail-description">
                ${escapeHTML(task.description || "Chưa có mô tả.")}
            </p>
        </section>

        <section class="detail-section">
            <div class="task-meta-grid">

                <div class="meta-item">
                    <span>Nhóm</span>
                    <strong>${escapeHTML(task.group || "Chưa cập nhật")}</strong>
                </div>

                <div class="meta-item">
                    <span>Deadline</span>
                    <strong>${escapeHTML(formatDate(task.deadline))}</strong>
                </div>

                <div class="meta-item">
                    <span>Mã công việc</span>
                    <strong>${escapeHTML(task.id)}</strong>
                </div>
            </div>
        </section>
        <section class="detail-section">
            <h3>Vai trò được phân công</h3>
            <p class="detail-description">
                ${escapeHTML(roles.join(", ") || "Chưa có vai trò")}
            </p>
        </section>

        <section class="detail-section submission-section">
            <h3>Link bài đã làm</h3>
            <form id="submissionLinkForm" class="submission-link-form">
                <label for="submissionNameInput">Tên link (không bắt buộc)</label>
                <div class="submission-link-controls">
                    <input type="text" id="submissionNameInput" name="attachmentName"
                           maxlength="120" placeholder="Ví dụ: Bản thiết kế hoàn chỉnh">
                </div>
                <label for="submissionLinkInput">Địa chỉ link bài làm</label>
                <div class="submission-link-controls">
                    <input type="url" id="submissionLinkInput" name="submissionLink"
                           placeholder="https://drive.google.com/..." autocomplete="url" required>
                    <button type="submit" class="primary-action">Lưu link</button>
                </div>
                <p class="submission-link-message" id="submissionLinkMessage"
                   role="status" aria-live="polite"></p>
                <p class="submission-link-hint">Link được lưu trong danh sách tệp đính kèm của công việc; hệ thống không tải tệp lên.</p>
                <div class="submission-link-saved attachment-list" id="submissionLinkSaved">${savedAttachments}</div>
            </form>
        </section>
    `;

    document.getElementById("taskStatusInput").value =
        task.status;
    document.getElementById("progressTaskTitle").textContent = task.title;
    document.getElementById("progressTaskGroup").textContent = task.group || "—";

    document.getElementById("startTaskBtn").hidden =
        task.status !== "not_started";

    document.getElementById("completeTaskBtn").hidden =
        task.status === "completed";

    refreshIcons();
}

function getSafeSubmissionUrl(value) {
    if (!value) return "";

    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
        return "";
    }
}

function getSubmissionFileName(value) {
    const url = new URL(value);
    const pathName = url.pathname.split("/").filter(Boolean).pop();
    return pathName?.includes(".") ? pathName : url.hostname;
}

async function saveTaskSubmissionLink(event) {
    event.preventDefault();

    const task = state.selectedTask;
    if (!task || !state.memberId) {
        throw new Error("Không xác định được thành viên hoặc công việc.");
    }

    const form = event.target;
    const input = form.elements.submissionLink;
    const nameInput = form.elements.attachmentName;
    const message = form.querySelector("#submissionLinkMessage");
    const saveButton = form.querySelector('[type="submit"]');
    const submissionLink = input.value.trim();

    if (submissionLink && !getSafeSubmissionUrl(submissionLink)) {
        input.setCustomValidity("Vui lòng nhập link bắt đầu bằng http:// hoặc https://.");
        input.reportValidity();
        input.setCustomValidity("");
        return;
    }

    if (!submissionLink) {
        input.setCustomValidity("Vui lòng nhập link bài làm.");
        input.reportValidity();
        input.setCustomValidity("");
        return;
    }

    const fileName = nameInput.value.trim() || getSubmissionFileName(submissionLink);
    const existingAttachment = (task.attachments || []).find(attachment =>
        attachment.uploaded_by === state.memberId && attachment.file_url === submissionLink
    );
    if (existingAttachment) {
        message.textContent = "Link này đã được lưu cho công việc.";
        message.classList.add("is-success");
        return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Đang lưu...";
    message.textContent = "";
    message.classList.remove("is-error", "is-success");

    try {
        const { data, error } = await state.db
            .from("task_attachments")
            .insert({
                task_id: task.id,
                file_name: fileName,
                file_url: submissionLink,
                file_type: "text/uri-list",
                uploaded_by: state.memberId
            })
            .select("attachment_id, task_id, file_name, file_url, file_type, file_size, uploaded_by, created_at")
            .single();

        if (error) throw error;
        if (!data) throw new Error("Supabase không trả về thông tin link vừa lưu.");

        task.attachments = [data, ...(task.attachments || [])];
        form.querySelector("#submissionLinkSaved").innerHTML =
            renderSavedAttachments(task.attachments);
        refreshIcons();
        input.value = "";
        nameInput.value = "";
        message.textContent = "Đã lưu link vào tệp đính kèm của công việc.";
        message.classList.add("is-success");
    } catch (error) {
        console.error("Lỗi lưu link bài làm:", error);
        message.textContent = `Không thể lưu link bài làm: ${error.message}`;
        message.classList.add("is-error");
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = "Lưu link";
    }
}

async function deleteTaskAttachment(attachmentId, button) {
    const task = state.selectedTask;
    if (!task || !state.memberId) return;

    const attachment = (task.attachments || []).find(item =>
        String(item.attachment_id) === String(attachmentId) &&
        String(item.uploaded_by) === String(state.memberId)
    );
    if (!attachment || !window.confirm(`Xóa link "${attachment.file_name || "Link bài làm"}"?`)) return;

    button.disabled = true;
    button.textContent = "Đang xóa...";
    const message = document.getElementById("submissionLinkMessage");

    try {
        const { data, error } = await state.db
            .from("task_attachments")
            .delete()
            .eq("attachment_id", attachment.attachment_id)
            .eq("uploaded_by", state.memberId)
            .select("attachment_id");

        if (error) throw error;
        if (!data?.length) {
            throw new Error("Không xóa được link. Hãy kiểm tra quyền truy cập của bạn.");
        }

        task.attachments = task.attachments.filter(item =>
            String(item.attachment_id) !== String(attachmentId)
        );
        document.getElementById("submissionLinkSaved").innerHTML =
            renderSavedAttachments(task.attachments);
        message.textContent = "Đã xóa link bài làm.";
        message.classList.remove("is-error");
        message.classList.add("is-success");
        refreshIcons();
    } catch (error) {
        console.error("Lỗi xóa link bài làm:", error);
        message.textContent = `Không thể xóa link bài làm: ${error.message}`;
        message.classList.remove("is-success");
        message.classList.add("is-error");
        button.disabled = false;
        button.textContent = "Xóa";
    }
}

/* ==========================================
   UPDATE PROGRESS POPUP
========================================== */

function openProgressModal() {
    if (!state.selectedTask) return;

    const task = state.selectedTask;

    document.getElementById("progressTaskTitle").textContent =
        task.title || "";

    document.getElementById("progressTaskGroup").textContent =
        task.group || "";

    document.getElementById("taskStatusInput").value =
        task.status;

    openModal(el.progressModal);
}


/* ==========================================
   SAVE PROGRESS
========================================== */

async function submitProgress(event) {
    event.preventDefault();

    if (!state.selectedTask) return;

    const form = event.currentTarget;
    const status = document.getElementById("taskStatusInput").value;

    const submitButton = form.querySelector('[type="submit"]');

    submitButton.disabled = true;
    submitButton.textContent = "Đang lưu...";

    try {
        await updateTaskStatus(status);

    } catch (error) {
        console.error("Lỗi cập nhật tiến độ:", error);
        alert(`Không thể cập nhật trạng thái: ${error.message}`);

    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Lưu cập nhật";
    }
}


/* ==========================================
   MARK TASK AS COMPLETED
========================================== */

async function markTaskComplete() {
    if (!state.selectedTask) return;

    const button = document.getElementById("completeTaskBtn");

    button.disabled = true;

    try {
        await updateTaskStatus("completed");

    } catch (error) {
        console.error("Lỗi hoàn thành công việc:", error);
        alert(`Không thể cập nhật trạng thái: ${error.message}`);

    } finally {
        button.disabled = false;
    }
}


/* ==========================================
   START TASK
========================================== */

async function startTask() {
    if (!state.selectedTask) return;

    const button = document.getElementById("startTaskBtn");

    button.disabled = true;

    try {
        await updateTaskStatus("in_progress");

    } catch (error) {
        console.error("Lỗi bắt đầu công việc:", error);

        alert(`Không thể cập nhật trạng thái: ${error.message}`);

    } finally {
        button.disabled = false;
    }
}

async function updateTaskStatus(status) {
    if (!state.selectedTask || !state.memberId) {
        throw new Error("Không xác định được thành viên hoặc công việc.");
    }

    const { data, error } = await state.db
        .from("task_assignments")
        .update({
            assignment_state: status,
            is_done: status === "completed"
        })
        .eq("task_id", state.selectedTask.id)
        .eq("member_id", state.memberId)
        .select("task_id");

    if (error) throw error;
    if (!data?.length) {
        throw new Error("Không có phân công nào được cập nhật. Kiểm tra quyền truy cập.");
    }

    const selectedTaskId = state.selectedTask.id;
    closeModal(el.progressModal);
    await loadMyTasks();
    openTaskDetail(selectedTaskId);
}


/* ==========================================
   EVENT: OPEN AND CLOSE POPUPS
========================================== */

document.addEventListener("click", event => {
    const deleteAttachmentButton = event.target.closest("[data-delete-attachment]");
    if (deleteAttachmentButton) {
        deleteTaskAttachment(
            deleteAttachmentButton.dataset.deleteAttachment,
            deleteAttachmentButton
        );
        return;
    }

    // Mở popup chi tiết công việc
    const detailButton = event.target.closest("[data-open-task]");

    if (detailButton) {
        openTaskDetail(detailButton.dataset.openTask);
    }

    // Đóng popup bằng nút X hoặc Hủy
    const closeButton = event.target.closest("[data-close-modal]");

    if (closeButton) {
        const modal = document.getElementById(
            closeButton.dataset.closeModal
        );

        closeModal(modal);
    }

    // Click vùng nền bên ngoài popup
    if (event.target.classList.contains("modal-overlay")) {
        closeModal(event.target);
    }
});

document.addEventListener("submit", event => {
    if (event.target.id === "submissionLinkForm") {
        saveTaskSubmissionLink(event).catch(error => {
            console.error("Lỗi lưu link bài làm:", error);
            alert(`Không thể lưu link bài làm: ${error.message}`);
        });
    }
});


/* ==========================================
   EVENT: STATUS FILTER
========================================== */

document.querySelectorAll(".status-tab").forEach(button => {

    button.addEventListener("click", () => {

        document.querySelectorAll(".status-tab")
            .forEach(tab => tab.classList.remove("active"));

        button.classList.add("active");

        state.status = button.dataset.status;

        state.page = 1;

        applyFilters();
    });

});


/* ==========================================
   EVENT: SEARCH
========================================== */

if (el.search) {

    el.search.addEventListener("input", event => {

        state.keyword = event.target.value.trim();

        state.page = 1;

        applyFilters();

    });

}


/* ==========================================
   EVENT: ADVANCED FILTERS
========================================== */

const filterToggle =
    document.getElementById("toggleTaskFilters");

if (filterToggle) {

    filterToggle.addEventListener("click", () => {

        const panel =
            document.getElementById("advancedTaskFilters");

        panel.hidden = !panel.hidden;

    });

}


document.getElementById("groupFilter")
    ?.addEventListener("change", event => {

        state.group = event.target.value;

        state.page = 1;

        applyFilters();

    });


document.getElementById("resetTaskFilters")
?.addEventListener("click", () => {
    state.group = "";
    document.getElementById("groupFilter").value = "";
    state.page = 1;
    applyFilters();
});


/* ==========================================
   EVENT: PAGINATION
========================================== */

el.previousPage?.addEventListener("click", () => {

    if (state.page > 1) {

        state.page--;

        renderTaskTable();

    }

});


el.nextPage?.addEventListener("click", () => {

    const totalPages = Math.ceil(
        state.filteredTasks.length / PAGE_SIZE
    );

    if (state.page < totalPages) {

        state.page++;

        renderTaskTable();

    }

});


/* ==========================================
   EVENT: POPUP ACTION BUTTONS
========================================== */

document.getElementById("openUpdateProgress")
    ?.addEventListener("click", openProgressModal);


document.getElementById("completeTaskBtn")
    ?.addEventListener("click", markTaskComplete);


document.getElementById("startTaskBtn")
    ?.addEventListener("click", startTask);


el.progressForm?.addEventListener(
    "submit",
    submitProgress
);


/* ==========================================
   EVENT: ESCAPE KEY
========================================== */

document.addEventListener("keydown", event => {

    if (event.key === "Escape") {

        closeModal(el.progressModal);

        closeModal(el.detailModal);

    }

});


/* ==========================================
   INITIALIZE
========================================== */

document.addEventListener("DOMContentLoaded", () => {

    refreshIcons();

    loadMyTasks();

});