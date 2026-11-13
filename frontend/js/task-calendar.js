/* =========================================================
   MULTIMEDIA TASK - CALENDAR & DEADLINE
   Data source: Supabase tables `tasks` and `task_assignments`
   Không tạo task mẫu, không giả lập ngày bắt đầu / % tiến độ.
========================================================= */

(() => {
    "use strict";

    const CONFIG = {
        pageSize: 1000,
        memberId: window.TASK_CALENDAR_CONFIG?.memberId || null
    };

    const state = {
        tasks: [],
        assignments: [],
        currentDate: new Date(),
        selectedDate: new Date(),
        view: "month",
        ganttScale: "day",
        myTasksOnly: false,
        selectedTaskId: null,
        currentUserId: null,
        currentMemberId: CONFIG.memberId,
        loading: false
    };

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

    const elements = {
        currentDate: $("#calendarCurrentDate"),
        todayCount: $("#todayDeadlineCount"),
        upcomingCount: $("#upcomingDeadlineCount"),
        overdueCount: $("#overdueDeadlineCount"),

        todayBtn: $("#calendarTodayBtn"),
        datePicker: $("#calendarDatePicker"),
        prevBtn: $("#calendarPrevBtn"),
        nextBtn: $("#calendarNextBtn"),
        monthTodayBtn: $("#monthTodayBtn"),
        weekTodayBtn: $("#weekTodayBtn"),
        dayTodayBtn: $("#dayTodayBtn"),

        monthBtn: $("#monthViewBtn"),
        weekBtn: $("#weekViewBtn"),
        ganttBtn: $("#ganttViewBtn"),
        personalBtn: $("#myTasksOnlyBtn"),

        monthView: $("#monthView"),
        weekView: $("#weekView"),
        dayView: $("#dayView"),
        ganttView: $("#ganttView"),

        monthTitle: $("#monthViewTitle"),
        monthCount: $("#monthDeadlineCount"),
        monthGrid: $("#monthCalendarGrid"),
        monthNote: $("#monthCalendarNote"),

        weekTitle: $("#weekViewTitle"),
        weekCount: $("#weekDeadlineCount"),
        weekGrid: $("#weekCalendarGrid"),
        weekNote: $("#weekCalendarNote"),

        dayTitle: $("#dayViewTitle"),
        dayCount: $("#dayDeadlineCount"),
        dayContent: $("#dayCalendarContent"),

        ganttMonthButton: $("#ganttMonthButton"),
        ganttMonthLabel: $("#ganttMonthLabel"),
        ganttMonthPicker: $("#ganttMonthPicker"),
        ganttScroll: $(".gantt-scroll-container"),
        ganttChart: $("#ganttChart"),
        ganttRange: $("#ganttRangeInfo"),

        upcomingList: $("#upcomingDeadlinesList"),

        detailOverlay: $("#calendarDetailOverlay"),
        detailTitle: $("#calendarDetailTitle"),
        detailStatus: $("#calendarDetailStatus"),
        detailDescription: $("#calendarDetailDescription"),
        detailGroup: $("#calendarDetailGroup"),
        detailTaskId: $("#calendarDetailTaskId"),
        detailEvent: $("#calendarDetailEvent"),
        detailType: $("#calendarDetailType"),
        detailPriority: $("#calendarDetailPriority"),
        detailAssignees: $("#calendarDetailAssignees"),
        detailStart: $("#calendarDetailStartDate"),
        detailDeadline: $("#calendarDetailDeadline"),
        detailOnAir: $("#calendarDetailOnAir"),
        detailDuration: $("#calendarDetailDuration"),
        detailProgress: $("#calendarDetailProgress"),
        detailProgressBar: $("#calendarDetailProgressBar"),
        detailNote: $("#calendarDetailNote"),
        closeDetailBtn: $("#closeCalendarDetailBtn"),
        openFullTaskBtn: $("#openFullTaskBtn")
    };

    const isEnglish = window.AppI18n?.language === "en";
    const monthNames = isEnglish
        ? ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
        : ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];
    const weekdayNames = isEnglish
        ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        : ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
    const weekdayShort = isEnglish
        ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        : ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[char]);
    }

    function parseDate(value) {
        if (!value) return null;

        if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
            const [year, month, day] = value.split("-").map(Number);
            const date = new Date(year, month - 1, day);
            return Number.isNaN(date.getTime()) ? null : date;
        }

        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function dateKey(date) {
        if (!date) return "";

        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");

        return `${y}-${m}-${d}`;
    }

    function startOfDay(date) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    function addDays(date, amount) {
        const result = new Date(date);
        result.setDate(result.getDate() + amount);
        return result;
    }

    function addMonths(date, amount) {
        return new Date(
            date.getFullYear(),
            date.getMonth() + amount,
            1
        );
    }

    function sameDay(a, b) {
        return !!a && !!b && dateKey(a) === dateKey(b);
    }

    function formatDate(date, options = {}) {
        if (!date) return "Chưa có dữ liệu";

        return new Intl.DateTimeFormat(window.AppI18n?.locale || "vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            ...options
        }).format(date);
    }

    function formatMonth(date) {
        return `${monthNames[date.getMonth()]}, ${date.getFullYear()}`;
    }

    function formatTime(value) {
        if (!value) return "";

        const match = String(value).match(/^(\d{1,2}):(\d{2})/);

        return match
            ? `${match[1].padStart(2, "0")}:${match[2]}`
            : "";
    }

    function getTaskDeadline(task) {
        if (task.package_deadline_at) {
            return parseDate(task.package_deadline_at);
        }

        if (task.package_deadline_date) {
            const date = parseDate(task.package_deadline_date);
            if (!date) return null;

            const time = formatTime(task.package_deadline_time);

            if (time) {
                const [hours, minutes] = time.split(":").map(Number);
                date.setHours(hours, minutes, 0, 0);
            }

            return date;
        }

        return null;
    }

    function getTaskOnAir(task) {
        if (task.on_air_at) return parseDate(task.on_air_at);

        if (task.on_air_date) {
            const date = parseDate(task.on_air_date);
            if (!date) return null;

            const time = formatTime(task.on_air_time);

            if (time) {
                const [hours, minutes] = time.split(":").map(Number);
                date.setHours(hours, minutes, 0, 0);
            }

            return date;
        }

        return null;
    }

    function getTaskStart(task) {
        return task.start_date ? parseDate(task.start_date) : null;
    }

    function getAssignments(taskId) {
        return state.assignments.filter(
            item => item.task_id === taskId
        );
    }

    function getStatus(task) {
        const rows = getAssignments(task.task_id)
            .filter(row => row.member_id);

        if (!rows.length) {
            const storedStatus = String(task.status || "").toLowerCase();
            return [
                "not_started",
                "in_progress",
                "pending_review",
                "completed"
            ].includes(storedStatus)
                ? storedStatus
                : "not_started";
        }

        if (rows.every(row =>
            row.is_done === true ||
            String(row.assignment_state || "").toLowerCase() === "completed"
        )) {
            return "completed";
        }

        const states = rows.map(row =>
            String(row.assignment_state || "").toLowerCase()
        );

        if (states.includes("pending_review")) return "pending_review";
        if (states.includes("in_progress")) return "in_progress";

        return "not_started";
    }

    function statusLabel(status) {
        return {
            not_started: "Chưa bắt đầu",
            in_progress: "Đang thực hiện",
            pending_review: "Chờ duyệt",
            completed: "Đã hoàn thành"
        }[status] || "Chưa xác định";
    }

    function isCompleted(task) {
        return getStatus(task) === "completed";
    }

    function getTaskRoles(task) {
        const roles = [...new Set(
            getAssignments(task.task_id)
                .map(item => item.role)
                .filter(Boolean)
        )];

        return roles.length ? roles.join(", ") : "Chưa phân nhóm";
    }

    function getTaskMemberIds(task) {
        const ids = [...new Set(
            getAssignments(task.task_id)
                .map(item => item.member_id)
                .filter(Boolean)
        )];

        return ids.length ? ids.join(", ") : "Chưa phân công";
    }

    function getTaskEvent(task) {
        return Array.isArray(task.events) ? task.events[0] : task.events;
    }

    function priorityLabel(priority) {
        return {
            low: "Thấp",
            medium: "Trung bình",
            high: "Cao"
        }[String(priority || "").toLowerCase()] || "Chưa đặt";
    }

    function getTaskRows() {
        let rows = state.tasks.filter(task =>
            !task.is_cancelled && task.status !== "cancelled"
        );

        if (state.myTasksOnly && state.currentMemberId) {
            rows = rows.filter(task =>
                getAssignments(task.task_id).some(
                    assignment =>
                        assignment.member_id === state.currentMemberId
                )
            );
        }

        return rows;
    }

    function getDeadlineTasks() {
        return getTaskRows()
            .map(task => ({
                task,
                deadline: getTaskDeadline(task)
            }))
            .filter(item => item.deadline)
            .sort((a, b) => a.deadline - b.deadline);
    }

    function isOverdue(task, deadline, now = new Date()) {
        return !!deadline && deadline < now && !isCompleted(task);
    }

    function getDeadlineClass(task, deadline) {
        if (isCompleted(task)) return "is-completed";
        if (isOverdue(task, deadline)) return "is-overdue";
        return "";
    }

    function renderIcon(name, fallback = "") {
        return `<i data-lucide="${escapeHTML(name)}" aria-hidden="true"></i>${fallback}`;
    }

    function refreshIcons() {
        if (window.lucide?.createIcons) {
            window.lucide.createIcons();
        }
    }

    function renderEmpty(container, message, isError = false) {
        if (!container) return;

        container.innerHTML = `
            <div class="calendar-empty-state ${isError ? "is-error" : ""}">
                ${renderIcon(isError ? "alert-circle" : "calendar-days")}
                <p>${escapeHTML(message)}</p>
            </div>
        `;

        refreshIcons();
    }

        function renderSummary() {
        const now = new Date();
        const today = startOfDay(now);
        const endToday = addDays(today, 1);
        const nextWeek = addDays(today, 7);
        const deadlineItems = getDeadlineTasks();

        const todayCount = deadlineItems.filter(({ task, deadline }) =>
            deadline >= today && deadline < endToday && !isCompleted(task)
        ).length;

        const upcomingCount = deadlineItems.filter(({ task, deadline }) =>
            deadline >= endToday && deadline < nextWeek && !isCompleted(task)
        ).length;

        const overdueCount = deadlineItems.filter(({ task, deadline }) =>
            isOverdue(task, deadline, now)
        ).length;

        if (elements.todayCount) elements.todayCount.textContent = todayCount;
        if (elements.upcomingCount) elements.upcomingCount.textContent = upcomingCount;
        if (elements.overdueCount) elements.overdueCount.textContent = overdueCount;

        if (elements.currentDate) {
            elements.currentDate.textContent =
                `Dữ liệu được cập nhật: ${formatDate(now)}`;
        }
    }

    function renderUpcoming() {
        if (!elements.upcomingList) return;

        const now = startOfDay(new Date());

        const items = getDeadlineTasks()
            .filter(({ task, deadline }) =>
                deadline >= now && !isCompleted(task)
            )
            .slice(0, 8);

        if (!items.length) {
            renderEmpty(elements.upcomingList, "Không có deadline sắp tới.");
            return;
        }

        elements.upcomingList.innerHTML = items.map(({ task, deadline }) => {
            const status = getStatus(task);

            return `
                <button type="button"
                        class="upcoming-deadline-item"
                        data-task-id="${escapeHTML(task.task_id)}">

                    <span class="upcoming-task-title">
                        ${renderIcon("calendar")}
                        <span>
                            ${escapeHTML(task.task_title || "Công việc chưa có tên")}
                        </span>
                    </span>

                    <span class="upcoming-task-meta">
                        <span>
                            ${formatDate(deadline)}
                            ${task.package_deadline_time
                                ? ` · ${escapeHTML(formatTime(task.package_deadline_time))}`
                                : ""}
                        </span>

                        <span>${escapeHTML(getTaskRoles(task))}</span>
                    </span>

                    <span class="upcoming-task-status">
                        ${renderIcon(status === "completed" ? "circle-check" : "circle")}
                        ${escapeHTML(statusLabel(status))}
                    </span>

                </button>
            `;
        }).join("");

        refreshIcons();
    }

    /* ==============================
       LỊCH THÁNG
    ============================== */

    function renderMonthView() {
        if (!elements.monthGrid) return;

        const year = state.currentDate.getFullYear();
        const month = state.currentDate.getMonth();

        const firstDay = new Date(year, month, 1);
        const offset = (firstDay.getDay() + 6) % 7;
        const gridStart = addDays(firstDay, -offset);

        const monthItems = getDeadlineTasks().filter(({ deadline }) =>
            deadline.getFullYear() === year &&
            deadline.getMonth() === month
        );

        if (elements.monthTitle) {
            elements.monthTitle.textContent = formatMonth(state.currentDate);
        }

        if (elements.monthCount) {
            elements.monthCount.textContent =
                `${monthItems.length} deadline trong tháng`;
        }

        const cells = [];

        for (let index = 0; index < 42; index++) {
            const date = addDays(gridStart, index);
            const key = dateKey(date);

            const dayTasks = monthItems.filter(({ deadline }) =>
                dateKey(deadline) === key
            );

            const classes = [
                "month-day-cell",
                date.getMonth() !== month ? "is-outside" : "",
                sameDay(date, new Date()) ? "is-today" : "",
                sameDay(date, state.selectedDate) ? "is-selected" : ""
            ].filter(Boolean).join(" ");
            const dayLabel = isEnglish
                ? `${weekdayNames[date.getDay()]}, ${formatDate(date)}`
                : `${weekdayNames[date.getDay()]}, ngày ${formatDate(date)}`;

            const taskMarkup = dayTasks.slice(0, 3).map(({ task, deadline }) => `
                <button type="button"
                        class="month-day-task ${getDeadlineClass(task, deadline)}"
                        data-task-id="${escapeHTML(task.task_id)}"
                        title="${escapeHTML(task.task_title || "")}">

                    ${escapeHTML(task.task_title || "Công việc")}

                </button>
            `).join("");

            const moreMarkup = dayTasks.length > 3
                ? `<span class="month-more-tasks">+${dayTasks.length - 3} công việc</span>`
                : "";

            cells.push(`
                <div class="${classes}" data-date="${key}">

                    <button type="button"
                            class="month-day-number"
                            data-select-date="${key}"
                            aria-label="Chọn ${escapeHTML(dayLabel)}"
                            aria-pressed="${sameDay(date, state.selectedDate)}">
                        ${date.getDate()}
                    </button>

                    ${taskMarkup}
                    ${moreMarkup}

                </div>
            `);
        }

        elements.monthGrid.innerHTML = cells.join("");

        if (elements.monthNote) {
            elements.monthNote.textContent = monthItems.length
                ? "Chọn ngày để xem lịch trong ngày hoặc chọn công việc để xem chi tiết."
                : "Chọn ngày bất kỳ để xem lịch trong ngày. Tháng này chưa có deadline.";
        }
    }

    /* ==============================
       LỊCH TUẦN
    ============================== */

    function getWeekStart(date) {
        const result = startOfDay(date);
        const offset = (result.getDay() + 6) % 7;

        result.setDate(result.getDate() - offset);

        return result;
    }

    function renderWeekView() {
        if (!elements.weekGrid) return;

        const start = getWeekStart(state.currentDate);
        const end = addDays(start, 6);

        const items = getDeadlineTasks();

        if (elements.weekTitle) {
            elements.weekTitle.textContent =
                `${formatDate(start, { day: "2-digit", month: "2-digit" })} – ${formatDate(end)}`;
        }

        const weekItems = items.filter(({ deadline }) =>
            deadline >= start && deadline < addDays(end, 1)
        );

        if (elements.weekCount) {
            elements.weekCount.textContent =
                `${weekItems.length} deadline trong tuần`;
        }

        elements.weekGrid.innerHTML = Array.from(
            { length: 7 },
            (_, index) => {

                const date = addDays(start, index);

                const dayItems = weekItems.filter(({ deadline }) =>
                    sameDay(deadline, date)
                );

                return `
                    <div class="week-day-column ${sameDay(date, new Date()) ? "is-today" : ""}">

                        <div class="week-day-header">

                            <button type="button"
                                    class="week-day-select"
                                    data-select-date="${dateKey(date)}"
                                    aria-label="${isEnglish ? "Select" : "Chọn"} ${weekdayNames[date.getDay()]}, ${isEnglish ? "" : "ngày "}${formatDate(date)}"
                                    aria-pressed="${sameDay(date, state.selectedDate)}">
                                <span class="week-day-name">
                                    ${weekdayShort[date.getDay()]}
                                </span>

                                <span class="week-day-date">
                                    ${String(date.getDate()).padStart(2, "0")}
                                </span>
                            </button>

                        </div>

                        <div class="week-day-tasks">

                            ${dayItems.length ? dayItems.map(({ task, deadline }) => `
                                <button type="button"
                                        class="week-task-card ${getDeadlineClass(task, deadline)}"
                                        data-task-id="${escapeHTML(task.task_id)}">

                                    <strong>
                                        ${escapeHTML(task.task_title || "Công việc")}
                                    </strong>

                                    <span>${escapeHTML(getTaskRoles(task))}</span>

                                    <span>${escapeHTML(statusLabel(getStatus(task)))}</span>

                                </button>
                            `).join("") : ""}

                        </div>

                    </div>
                `;
            }
        ).join("");

        if (elements.weekNote) {
            elements.weekNote.textContent = weekItems.length
                ? "Deadline được hiển thị theo ngày, không gán giờ nếu dữ liệu không có."
                : "Không có deadline trong tuần này.";
        }
    }

    /* ==============================
       LỊCH NGÀY
    ============================== */

    function renderDayView() {
        if (!elements.dayContent) return;

        const date = startOfDay(state.selectedDate);

        const items = getDeadlineTasks().filter(({ deadline }) =>
            sameDay(deadline, date)
        );

        if (elements.dayTitle) {
            elements.dayTitle.textContent = isEnglish
                ? `${weekdayNames[date.getDay()]}, ${formatDate(date)}`
                : `${weekdayNames[date.getDay()]}, ngày ${formatDate(date)}`;
        }

        if (elements.dayCount) {
            elements.dayCount.textContent =
                `${items.length} deadline trong ngày đã chọn`;
        }

        if (!items.length) {
            renderEmpty(
                elements.dayContent,
                "Không có deadline nào trong ngày này."
            );
            return;
        }

        elements.dayContent.innerHTML = `

            <div class="day-date-banner">

                <div class="day-date-number">
                    ${String(date.getDate()).padStart(2, "0")}
                </div>

                <div>
                    <strong>
                        ${weekdayNames[date.getDay()]}
                        ·
                        ${sameDay(date, new Date()) ? "Hôm nay" : "Ngày đã chọn"}
                    </strong>

                    <span>${formatMonth(date)}</span>
                </div>

            </div>

            <div class="day-task-list">

                ${items.map(({ task, deadline }) => `
                    <article class="day-task-card"
                             role="button"
                             tabindex="0"
                             data-task-id="${escapeHTML(task.task_id)}">

                        <h3>
                            ${escapeHTML(task.task_title || "Công việc chưa có tên")}
                        </h3>

                        <p>
                            ${escapeHTML(task.description || "Không có mô tả.")}
                        </p>

                        <div class="day-task-card-meta">

                            <span>
                                Deadline: ${formatDate(deadline)}
                                ${task.package_deadline_time
                                    ? ` · ${escapeHTML(formatTime(task.package_deadline_time))}`
                                    : ""}
                            </span>

                            <span>
                                ${escapeHTML(statusLabel(getStatus(task)))}
                            </span>

                        </div>

                    </article>
                `).join("")}

            </div>
        `;
    }

    /* ==============================
       GANTT CHART
    ============================== */

    function renderGanttView() {
        if (!elements.ganttChart) return;

        const items = getDeadlineTasks();

        const year = state.currentDate.getFullYear();
        const month = state.currentDate.getMonth();

        if (elements.ganttMonthPicker) {
            const monthValue =
                `${state.currentDate.getFullYear()}-${String(state.currentDate.getMonth() + 1).padStart(2, "0")}`;
            elements.ganttMonthPicker.value = monthValue;
            if (elements.ganttMonthLabel) {
                elements.ganttMonthLabel.textContent = formatMonth(state.currentDate);
            }
        }

        if (!items.length) {
            renderEmpty(
                elements.ganttChart,
                "Chưa có công việc nào có deadline để hiển thị."
            );
            if (elements.ganttScroll) elements.ganttScroll.scrollLeft = 0;

            if (elements.ganttRange) {
                elements.ganttRange.textContent = "";
            }

            return;
        }

        const monthStart = new Date(year, month, 1);
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = new Date();
        const isTodayInMonth =
            today.getFullYear() === year &&
            today.getMonth() === month;

        const visibleItems = items.filter(({ deadline }) =>
            deadline.getFullYear() === year &&
            deadline.getMonth() === month
        );

        const columns = state.ganttScale === "week"
            ? Math.ceil(daysInMonth / 7)
            : state.ganttScale === "month"
                ? 1
                : daysInMonth;

        const headerCells = Array.from(
            { length: columns },
            (_, index) => {
                if (state.ganttScale === "month") {
                    return `<div><span>${escapeHTML(isEnglish ? "Month" : "Tháng")}</span></div>`;
                }

                if (state.ganttScale === "week") {
                    const weekStart = index * 7 + 1;
                    const weekEnd = Math.min(daysInMonth, weekStart + 6);
                    return `<div><span>${weekStart}–${weekEnd}</span></div>`;
                }

                const date = new Date(year, month, index + 1);
                const dayLabel = isEnglish
                    ? new Intl.DateTimeFormat(
                        window.AppI18n?.locale || "en-US",
                        { weekday: "short" }
                    ).format(date)
                    : date.getDay() === 0
                        ? "CN"
                        : `T${date.getDay() + 1}`;
                return `<div class="gantt-day-header ${isTodayInMonth && date.getDate() === today.getDate() ? "is-today" : ""}">
                    <span>${escapeHTML(dayLabel)}</span>
                    <strong>${String(index + 1).padStart(2, "0")}</strong>
                </div>`;
            }
        ).join("");

        const todayPosition = ((today.getDate() - 0.5) / daysInMonth) * 100;
        const todayHeaderLine = isTodayInMonth && state.ganttScale === "day"
            ? `<span class="gantt-today-line" style="left:calc(${todayPosition}%);"></span>`
            : "";

        const rows = visibleItems.map(({ task, deadline }, rowIndex) => {
            const recordedStart = getTaskStart(task);
            const start = recordedStart && recordedStart < deadline
                ? recordedStart
                : deadline;
            const startDay = start < monthStart
                ? 1
                : Math.min(daysInMonth, start.getDate());
            const endDay = Math.max(startDay, Math.min(daysInMonth, deadline.getDate()));
            const startIndex = state.ganttScale === "month"
                ? 0
                : state.ganttScale === "week"
                    ? Math.floor((startDay - 1) / 7)
                    : startDay - 1;
            const endIndex = state.ganttScale === "month"
                ? 0
                : state.ganttScale === "week"
                    ? Math.floor((endDay - 1) / 7)
                    : endDay - 1;
            const leftPercent = (startIndex / columns) * 100;
            const widthPercent = ((endIndex - startIndex + 1) / columns) * 100;
            const completed = isCompleted(task);
            const progress = completed
                ? 100
                : Math.max(0, Math.min(100, Number(task.progress) || 0));
            const startLabel = recordedStart
                ? formatDate(recordedStart, { day: "2-digit", month: "2-digit" })
                : (isEnglish ? "No start date" : "Chưa có ngày bắt đầu");
            const endLabel = formatDate(deadline, { day: "2-digit", month: "2-digit" });
            const dateRangeLabel = `${startLabel} – ${endLabel}`;
            const title = `${task.task_title || (isEnglish ? "Untitled task" : "Công việc chưa có tên")} · ${dateRangeLabel} · ${progress}%`;
            const taskRoles = getTaskRoles(task);

            const todayLine = isTodayInMonth && state.ganttScale === "day"
                ? `<span class="gantt-today-line" style="left:calc(${todayPosition}%);"></span>`
                : "";
            const todayLabel = todayLine && rowIndex === visibleItems.length - 1
                ? `<span class="gantt-today-label" style="left:calc(${todayPosition}%);">${escapeHTML(isEnglish ? "Today" : "Hôm nay")}</span>`
                : "";

            return `
                <div class="gantt-row">

                    <div class="gantt-task-info">

                        <div class="gantt-task-name">

                            ${escapeHTML(task.task_title || (isEnglish ? "Untitled task" : "Công việc chưa có tên"))}

                            <span class="gantt-task-subtitle">
                                ${escapeHTML(statusLabel(getStatus(task)))} · ${progress}%
                            </span>

                        </div>

                        <span class="gantt-task-group" title="${escapeHTML(taskRoles)}">
                            ${escapeHTML(taskRoles)}
                        </span>

                        <span class="gantt-task-date">
                            ${recordedStart ? formatDate(recordedStart, { day: "2-digit", month: "2-digit" }) : "—"}
                        </span>

                        <span class="gantt-task-date">
                            ${formatDate(deadline, { day: "2-digit", month: "2-digit" })}
                        </span>

                    </div>

                    <div class="gantt-timeline-row"
                         data-scale="${state.ganttScale}"
                         style="--gantt-columns:${columns}">

                        ${Array.from({ length: columns }, () => '<span class="gantt-timeline-cell"></span>').join("")}
                        ${todayLine}
                        ${todayLabel}
                        <button type="button"
                                class="gantt-bar ${completed ? "is-completed" : ""}"
                                style="--gantt-bar-left:${leftPercent}%;--gantt-bar-width:${widthPercent}%;--gantt-progress:${progress}%"
                                data-task-id="${escapeHTML(task.task_id)}"
                                title="${escapeHTML(title)}"
                                aria-label="${escapeHTML(title)}">
                            <span class="gantt-bar-label">${progress}%</span>
                            ${completed ? '<i data-lucide="check" aria-hidden="true"></i>' : ""}
                        </button>
                        <span class="gantt-deadline-diamond" style="left:calc(${((endIndex + 1) / columns) * 100}% - 5px);" aria-hidden="true"></span>

                    </div>

                </div>
            `;
        }).join("");

        elements.ganttChart.innerHTML = `

            <div class="gantt-header-row">

                <div class="gantt-header-labels">
                    <span>Tên công việc</span>
                    <span>Nhóm</span>
                    <span>Bắt đầu</span>
                    <span>Deadline</span>
                </div>

                <div class="gantt-timeline-area">
                    <div class="gantt-period-heading">${escapeHTML(formatMonth(monthStart))}</div>
                    <div class="gantt-timeline-header"
                         data-scale="${state.ganttScale}"
                         style="--gantt-columns:${columns}">
                        ${headerCells}
                        ${todayHeaderLine}
                    </div>
                </div>

            </div>

            ${rows || `
                <div class="calendar-empty-state">
                    ${renderIcon("calendar-x")}
                    <p>Không có deadline trong tháng này.</p>
                </div>
            `}

        `;

        // Reset the horizontal position after changing the month or scale so
        // the task columns and the first date column stay aligned.
        if (elements.ganttScroll) {
            requestAnimationFrame(() => {
                elements.ganttScroll.scrollLeft = 0;
            });
        }

        if (elements.ganttRange) {
            elements.ganttRange.textContent =
                `${visibleItems.length} deadline trong ${formatMonth(state.currentDate)} · Hiển thị ngày bắt đầu và tiến độ từ database`;
        }

        refreshIcons();
    }

    /* ==============================
       RENDER TẤT CẢ GIAO DIỆN
    ============================== */

    function renderAll() {
        if (elements.datePicker) {
            elements.datePicker.value = dateKey(state.currentDate);
        }
        renderSummary();
        renderUpcoming();
        renderMonthView();
        renderWeekView();
        renderDayView();
        renderGanttView();
        setActiveView(state.view);
        refreshIcons();
    }

    function setActiveView(view) {
        state.view = view;

        const views = {
            month: elements.monthView,
            week: elements.weekView,
            day: elements.dayView,
            gantt: elements.ganttView
        };

        Object.entries(views).forEach(([key, panel]) => {
            if (panel) panel.hidden = key !== view;
        });

        [
            elements.monthBtn,
            elements.weekBtn,
            elements.ganttBtn
        ].forEach(button => {
            if (!button) return;

            button.classList.toggle(
                "active",
                button.dataset.view === view
            );
        });
    }

    function findTask(taskId) {
        return state.tasks.find(
            task => String(task.task_id) === String(taskId)
        );
    }

    function openTaskDetail(taskId) {
        const task = findTask(taskId);

        if (!task || !elements.detailOverlay) return;

        state.selectedTaskId = task.task_id;

        const assignments = getAssignments(task.task_id);
        const event = getTaskEvent(task);
        const start = getTaskStart(task);
        const deadline = getTaskDeadline(task);
        const onAir = getTaskOnAir(task);
        const status = getStatus(task);

        if (elements.detailTitle) {
            elements.detailTitle.textContent =
                task.task_title || "Công việc chưa có tên";
        }

        if (elements.detailStatus) {
            elements.detailStatus.innerHTML = `
                <span class="calendar-status-chip ${status === "completed" ? "status-completed" : ""}">
                    ${escapeHTML(statusLabel(status))}
                </span>

                ${deadline && isOverdue(task, deadline)
                    ? '<span class="calendar-status-chip status-overdue">Quá hạn</span>'
                    : ""}
            `;
        }

        if (elements.detailDescription) {
            elements.detailDescription.textContent =
                task.description || "Không có mô tả.";
        }

        if (elements.detailGroup) {
            elements.detailGroup.textContent = getTaskRoles(task);
        }

        if (elements.detailTaskId) {
            elements.detailTaskId.textContent = task.task_id || "—";
        }

        if (elements.detailEvent) {
            elements.detailEvent.textContent = event
                ? [event.event_label, event.event_category].filter(Boolean).join(" · ") || task.event_id
                : task.event_id || "Chưa gắn sự kiện";
        }

        if (elements.detailType) {
            elements.detailType.textContent = task.task_type || "Chưa phân loại";
        }

        if (elements.detailPriority) {
            elements.detailPriority.textContent = priorityLabel(task.priority);
        }

        if (elements.detailAssignees) {
            elements.detailAssignees.textContent =
                getTaskMemberIds(task);
        }

        if (elements.detailStart) {
            elements.detailStart.textContent = start
                ? formatDate(start)
                : "Chưa đặt ngày bắt đầu";
        }

        if (elements.detailDeadline) {
            elements.detailDeadline.textContent = deadline
                ? `${formatDate(deadline)}${task.package_deadline_time
                    ? ` · ${formatTime(task.package_deadline_time)}`
                    : ""}`
                : "Chưa có deadline";
        }

        if (elements.detailOnAir) {
            elements.detailOnAir.textContent = onAir
                ? `${formatDate(onAir)}${task.on_air_time
                    ? ` · ${formatTime(task.on_air_time)}`
                    : ""}`
                : "Chưa đặt lịch lên sóng";
        }

        if (elements.detailDuration) {
            elements.detailDuration.textContent = start && deadline
                ? `${Math.max(1, Math.ceil((startOfDay(deadline) - startOfDay(start)) / 86400000) + 1)} ngày`
                : "Chưa đủ dữ liệu";
        }

        const progress = Math.max(0, Math.min(100, Number(task.progress) || 0));

        if (elements.detailProgress) {
            elements.detailProgress.textContent = `${progress}%`;
        }

        if (elements.detailProgressBar) {
            elements.detailProgressBar.style.width = `${progress}%`;
        }

        if (elements.detailNote) {
            elements.detailNote.textContent =
                event?.category_note || "Sự kiện chưa có ghi chú.";
        }

        elements.detailOverlay.hidden = false;
        document.body.classList.add("modal-open");

        refreshIcons();
    }

    function closeTaskDetail() {
        if (elements.detailOverlay) {
            elements.detailOverlay.hidden = true;
        }

        document.body.classList.remove("modal-open");
        state.selectedTaskId = null;
    }

    /* ==============================
       ĐIỀU HƯỚNG THỜI GIAN
    ============================== */

    function navigateDate(direction) {
        if (state.view === "month" || state.view === "gantt") {
            state.currentDate = addMonths(
                state.currentDate,
                direction
            );
        } else if (state.view === "week") {
            state.currentDate = addDays(
                state.currentDate,
                direction * 7
            );
        } else {
            state.selectedDate = addDays(
                state.selectedDate,
                direction
            );

            state.currentDate = new Date(state.selectedDate);
        }

        renderAll();
    }

    function goToToday() {
        state.currentDate = new Date();
        state.selectedDate = new Date();

        renderAll();
    }

    /* ==============================
       EVENT LISTENERS
    ============================== */

    function setupEvents() {
        elements.todayBtn?.addEventListener("click", goToToday);
        elements.datePicker?.addEventListener("change", event => {
            const date = parseDate(event.target.value);
            if (!date) return;

            state.selectedDate = date;
            state.currentDate = new Date(date);
            renderAll();
        });
        elements.ganttMonthPicker?.addEventListener("change", event => {
            const match = /^(\d{4})-(\d{2})$/.exec(event.target.value);
            if (!match) return;

            const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
            state.currentDate = date;
            state.selectedDate = new Date(date);
            renderAll();
        });
        elements.ganttMonthButton?.addEventListener("click", () => {
            const picker = elements.ganttMonthPicker;
            if (!picker) return;

            if (typeof picker.showPicker === "function") {
                picker.showPicker();
            } else {
                picker.focus();
                picker.click();
            }
        });
        elements.monthTodayBtn?.addEventListener("click", goToToday);
        elements.weekTodayBtn?.addEventListener("click", goToToday);
        elements.dayTodayBtn?.addEventListener("click", goToToday);

        elements.prevBtn?.addEventListener(
            "click",
            () => navigateDate(-1)
        );

        elements.nextBtn?.addEventListener(
            "click",
            () => navigateDate(1)
        );

        elements.monthBtn?.addEventListener(
            "click",
            () => setActiveView("month")
        );

        elements.weekBtn?.addEventListener(
            "click",
            () => setActiveView("week")
        );

        elements.ganttBtn?.addEventListener(
            "click",
            () => setActiveView("gantt")
        );

        elements.personalBtn?.addEventListener("click", () => {
            if (!state.currentMemberId) {
                alert(
                    "Tài khoản chưa được liên kết với thành viên. " +
                    "Hãy kiểm tra bảng team_members và quyền SELECT của RLS."
                );
                return;
            }

            state.myTasksOnly = !state.myTasksOnly;

            elements.personalBtn.setAttribute(
                "aria-pressed",
                String(state.myTasksOnly)
            );

            renderAll();
        });

        $$(".gantt-scale-btn").forEach(button => {
            button.addEventListener("click", () => {
                state.ganttScale = button.dataset.scale || "day";

                $$(".gantt-scale-btn").forEach(item => {
                    item.classList.toggle("active", item === button);
                });

                renderGanttView();
            });
        });

        // Chọn task để mở drawer chi tiết.
        document.addEventListener("click", event => {
            const taskElement = event.target.closest("[data-task-id]");

            if (taskElement) {
                openTaskDetail(taskElement.dataset.taskId);
                return;
            }

            const dateButton = event.target.closest("[data-select-date]");
            if (dateButton) {
                const date = parseDate(dateButton.dataset.selectDate);
                if (date) {
                    state.selectedDate = date;
                    state.currentDate = new Date(date);
                    setActiveView("day");
                    renderAll();
                }
                return;
            }

            const dayCell = event.target.closest(
                ".month-day-cell[data-date]"
            );

            if (
                dayCell &&
                !event.target.closest("button[data-task-id]")
            ) {
                const date = parseDate(dayCell.dataset.date);

                if (date) {
                    state.selectedDate = date;
                    state.currentDate = new Date(date);

                    setActiveView("day");
                    renderAll();
                }
            }
        });

        // Hỗ trợ mở task bằng bàn phím.
        document.addEventListener("keydown", event => {
            if (
                (event.key === "Enter" || event.key === " ") &&
                event.target.matches(".day-task-card[role='button']")
            ) {
                event.preventDefault();
                openTaskDetail(event.target.dataset.taskId);
            }
        });

        elements.closeDetailBtn?.addEventListener(
            "click",
            closeTaskDetail
        );

        elements.detailOverlay?.addEventListener("click", event => {
            if (event.target === elements.detailOverlay) {
                closeTaskDetail();
            }
        });

        document.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                closeTaskDetail();
            }
        });

        elements.openFullTaskBtn?.addEventListener("click", () => {
            if (!state.selectedTaskId) return;

            // Chưa có route trang task-detail được cung cấp.
            alert(
                `Mã công việc: ${state.selectedTaskId}\n` +
                "Chưa cấu hình đường dẫn trang chi tiết công việc."
            );
        });
    }

    /* ==============================
       LẤY MEMBER ĐANG ĐĂNG NHẬP
    ============================== */

    async function resolveCurrentMember() {
        if (state.currentMemberId) return;

        try {
            const client = getSupabaseClient();

            if (!client?.auth?.getUser) return;

            const { data, error } = await client.auth.getUser();

            if (error) throw error;

            const user = data?.user;

            if (!user) return;

            state.currentUserId = user.id;

            const { data: membership, error: membershipError } = await client
                .from("team_members")
                .select("member_id")
                .eq("user_id", user.id)
                .maybeSingle();

            if (membershipError) throw membershipError;

            state.currentMemberId = membership?.member_id ||
                user.user_metadata?.member_id ||
                user.app_metadata?.member_id ||
                null;

        } catch (error) {
            console.warn(
                "[task-calendar] Không lấy được người dùng hiện tại:",
                error.message
            );
        }
    }

    /* ==============================
       SUPABASE CLIENT
    ============================== */

    function getSupabaseClient() {
        if (window.supabaseClient?.from) {
            return window.supabaseClient;
        }

        try {
            if (
                typeof supabase !== "undefined" &&
                supabase?.from
            ) {
                return supabase;
            }
        } catch (_) {}

        return null;
    }

    /* ==============================
       LOAD DATA FROM SUPABASE
    ============================== */

    async function loadCalendarData() {
        const client = getSupabaseClient();

        if (!client) {
            renderEmpty(
                elements.ganttChart,
                "Không tìm thấy Supabase client. Kiểm tra thứ tự nhúng supabase.js.",
                true
            );

            renderEmpty(
                elements.upcomingList,
                "Không thể kết nối Supabase.",
                true
            );

            return;
        }

        state.loading = true;

        renderEmpty(
            elements.ganttChart,
            "Đang tải dữ liệu công việc..."
        );

        renderEmpty(
            elements.upcomingList,
            "Đang tải dữ liệu..."
        );

        try {
            const [tasksResult, assignmentsResult] = await Promise.all([

                client
                    .from("tasks")
                    .select(`
                        task_id,
                        task_no,
                        event_id,
                        task_title,
                        task_type,
                        submission_label,
                        description,
                        on_air_date,
                        on_air_time,
                        on_air_at,
                        package_deadline_date,
                        package_deadline_time,
                        package_deadline_at,
                        posted_on_main_page,
                        post_method,
                        is_cancelled,
                        post_done,
                        data_quality_flag,
                        status,
                        start_date,
                        priority,
                        progress,
                        events (
                            event_label,
                            event_category,
                            category_note
                        )
                    `)
                    .order(
                        "package_deadline_date",
                        {
                            ascending: true,
                            nullsFirst: false
                        }
                    )
                    .limit(CONFIG.pageSize),

                client
                    .from("task_assignments")
                    .select(`
                        task_id,
                        role,
                        assignment_state,
                        member_id,
                        is_done
                    `)
                    .limit(CONFIG.pageSize)

            ]);

            if (tasksResult.error) {
                throw tasksResult.error;
            }

            if (assignmentsResult.error) {
                throw assignmentsResult.error;
            }

            state.tasks = tasksResult.data || [];
            state.assignments = assignmentsResult.data || [];

            await resolveCurrentMember();

            renderAll();

        } catch (error) {
            console.error(
                "[task-calendar] Lỗi tải dữ liệu:",
                error
            );

            renderEmpty(
                elements.ganttChart,
                `Không thể tải dữ liệu: ${error.message || "Lỗi không xác định"}`,
                true
            );

            renderEmpty(
                elements.upcomingList,
                "Không thể tải danh sách deadline. Kiểm tra kết nối và quyền truy cập Supabase.",
                true
            );

        } finally {
            state.loading = false;
        }
    }

    /* ==============================
       INIT
    ============================== */

    function init() {
        setupEvents();
        setActiveView(state.view);
        loadCalendarData();
        refreshIcons();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    // Cho phép trang khác gọi refresh sau khi cập nhật task.
    window.taskCalendar = {
        refresh: loadCalendarData,
        openTaskDetail,
        closeTaskDetail
    };

})();
