/**
 * BẢO MẪU AECPT - TRỢ LÝ CHĂM SÓC KHÁCH HÀNG & CẬP NHẬT CÔNG VIỆC
 * Hiển thị dạng khung chat nổi góc dưới bên phải trên mọi trang đã đăng nhập.
 * Tuân thủ nghiêm ngặt quy tắc ANTI-HALLUCINATION (không đoán, thiếu là hỏi).
 */

(() => {
    "use strict";

    const WIDGET_STATE_TABLE = "user_widget_state";
    const LOGS_TABLE = "task_change_logs";
    const DEFAULT_WIDGET_MODELS = [
        "openai/gpt-oss-120b",
        "qwen/qwen3.8-27b"
    ];

    function getWidgetModels() {
        const configuredModel = window.APP_CONFIG?.GROQ_SUPPORT_MODEL || "openai/gpt-oss-120b";
        return Array.from(new Set([configuredModel, ...DEFAULT_WIDGET_MODELS]));
    }
    const DEFAULT_FALLBACK_CONTACT = "0799605442";
    const LEADER_DEADLINE_ALERT_HOURS = 48;
    const MAX_SAVED_WIDGET_MESSAGES = 30;

    const STATUS_LABELS = {
        not_started: "Chưa bắt đầu",
        in_progress: "Đang thực hiện",
        pending_review: "Chờ duyệt",
        completed: "Đã hoàn thành"
    };

    const STATUS_ALIASES = {
        not_started: "not_started",
        "chưa bắt đầu": "not_started",
        in_progress: "in_progress",
        "đang thực hiện": "in_progress",
        pending_review: "pending_review",
        "chờ duyệt": "pending_review",
        completed: "completed",
        done: "completed",
        "đã hoàn thành": "completed",
        "hoàn thành": "completed"
    };

    const FEATURE_DOCS = [
        "- Trang chủ (dashboard.html): Chọn/tạo sự kiện (+ Tạo sự kiện), hoàn tất sự kiện (Hoàn tất sự kiện), chat với Trợ lý AI chính để hỏi đáp sự kiện, tải lên tài liệu (.docx, .pdf, .xlsx, .csv, .txt, ảnh) bằng nút + hoặc kéo thả, lập Timeline & đường găng CPM rồi bấm Xác nhận & Lưu vào Supabase.",
        "- Công việc của tôi (my-tasks.html): Xem các công việc được giao cho bản thân, tìm kiếm, lọc theo ban và tab trạng thái (Tất cả, Chưa bắt đầu, Đang thực hiện, Chờ duyệt, Đã hoàn thành), mở chi tiết công việc để cập nhật trạng thái/tiến độ (Lưu cập nhật).",
        "- Danh sách công việc (task-list.html): Xem toàn bộ công việc của sự kiện, lọc theo ban/trạng thái, xem chi tiết phân công thành viên và cập nhật tiến độ phân công của mình.",
        "- Lịch & Deadline (task-calendar.html): Xem hạn chót theo chế độ Tháng, Tuần, Gantt Chart, bật lọc Việc của tôi và xem danh sách Deadline sắp tới.",
        "- Thành viên (members.html): Xem danh sách thành viên, ban/vai trò, số việc đang nhận và lịch rảnh hàng tuần; thêm hoặc cập nhật thành viên.",
        "- Lịch sử (history.html): Tra cứu các sự kiện đã qua theo năm, tỷ lệ hoàn thành và chi tiết từng công việc.",
        "- Cài đặt (setting.html): Cài đặt thông báo, đổi tên hiển thị, đổi mật khẩu và bấm Đăng xuất."
    ].join("\n");

    const TOOLS_SPEC = [
        {
            type: "function",
            function: {
                name: "get_events_and_roles",
                description: "Lấy danh sách sự kiện đang diễn ra / gần đây và danh sách ban/vai trò hiện có để biết người dùng có nhiều lựa chọn cần hỏi hay không.",
                parameters: {
                    type: "object",
                    properties: {}
                }
            }
        },
        {
            type: "function",
            function: {
                name: "query_task_updates",
                description: "Tra cứu công việc mới, thay đổi, hoàn thành, quá hạn hoặc sắp đến hạn (trong 48 giờ) tính từ mốc thời gian from_iso trở đi. CHỈ gọi khi đã có mốc thời gian rõ ràng từ người dùng (ví dụ last_visit hoặc mốc người dùng đã chọn).",
                parameters: {
                    type: "object",
                    properties: {
                        from_iso: {
                            type: "string",
                            description: "Mốc thời gian bắt đầu (ISO-8601 hoặc YYYY-MM-DD HH:mm). Bắt buộc do người dùng chọn hoặc xác nhận."
                        },
                        event_id: {
                            type: "string",
                            description: "Mã sự kiện cụ thể (ví dụ EVT_16) hoặc 'all' nếu người dùng muốn xem tất cả."
                        },
                        role_filter: {
                            type: "string",
                            description: "Tên ban/vai trò nếu người dùng muốn lọc riêng (ví dụ content_writer, designer...)."
                        }
                    },
                    required: ["from_iso"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_my_tasks",
                description: "Lấy danh sách công việc được giao cho người dùng hiện tại (hoặc công việc theo từ khóa/trạng thái) và cảnh báo hạn chót trong 48 giờ nếu là Trưởng nhóm.",
                parameters: {
                    type: "object",
                    properties: {
                        status_filter: {
                            type: "string",
                            enum: ["all", "not_started", "in_progress", "pending_review", "completed"],
                            description: "Lọc theo trạng thái công việc."
                        },
                        keyword: {
                            type: "string",
                            description: "Từ khóa tìm theo tên hoặc mã công việc."
                        },
                        event_id: {
                            type: "string",
                            description: "Mã sự kiện muốn lọc (nếu có)."
                        }
                    }
                }
            }
        },
        {
            type: "function",
            function: {
                name: "request_task_status_update",
                description: "Chuẩn bị yêu cầu cập nhật trạng thái công việc và hiển thị thẻ tóm tắt để xin người dùng xác nhận trước khi ghi vào Supabase.",
                parameters: {
                    type: "object",
                    properties: {
                        task_id: {
                            type: "string",
                            description: "Mã công việc cần cập nhật (ví dụ T021)."
                        },
                        new_status: {
                            type: "string",
                            enum: ["not_started", "in_progress", "pending_review", "completed"],
                            description: "Trạng thái mới cần chuyển sang."
                        }
                    },
                    required: ["task_id", "new_status"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "execute_task_status_update",
                description: "Thực thi cập nhật trạng thái công việc vào Supabase CHỈ SAU KHI người dùng đã xác nhận rõ ràng.",
                parameters: {
                    type: "object",
                    properties: {
                        task_id: {
                            type: "string",
                            description: "Mã công việc đã được người dùng xác nhận."
                        },
                        new_status: {
                            type: "string",
                            enum: ["not_started", "in_progress", "pending_review", "completed"],
                            description: "Trạng thái mới đã được xác nhận."
                        }
                    },
                    required: ["task_id", "new_status"]
                }
            }
        }
    ];

    const widgetState = {
        initialized: false,
        user: null,
        ongoingEvent: null,
        isOpen: false,
        isSending: false,
        isFirstChat: true,
        sessionLastVisit: null,
        messages: [],
        lastClickedSuggestion: null,
        pendingConfirmAction: null,
        stateTableAvailable: true,
        dom: {}
    };

    function escapeHTML(value = "") {
        return String(value ?? "").replace(/[&<>"']/g, ch => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[ch]);
    }

    function formatDateTime(value) {
        if (!value) return "không có";
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return String(value);
        return new Intl.DateTimeFormat("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }).format(d);
    }

    function getApiKey() {
        return (
            localStorage.getItem("mediatask_support_groq_api_key") ||
            window.APP_CONFIG?.GROQ_SUPPORT_API_KEY ||
            ""
        );
    }

    function getLocalKey(userId) {
        return userId ? `mediatask_support_widget_${userId}` : null;
    }

    function getOpenKey(userId) {
        return userId ? `aecpt_widget_open_${userId}` : null;
    }

    function getSessionPrevVisitKey(userId) {
        return userId ? `aecpt_widget_prev_visit_${userId}` : null;
    }

    async function resolveOngoingEvent(user, client = window.supabaseClient) {
        if (!client) return null;
        try {
            const { data: events, error: evErr } = await client
                .from("events")
                .select("event_id, event_label, event_category, category_note, is_completed, first_on_air_date, last_on_air_date, n_tasks")
                .order("event_id", { ascending: true });

            if (evErr || !Array.isArray(events) || !events.length) return null;

            const activeEvents = events.filter(e => e.is_completed !== true);
            if (!activeEvents.length) return null;

            const activeIds = new Set(activeEvents.map(e => String(e.event_id)));

            // 1. Kiểm tra task_assignments của member_id
            if (user?.memberId) {
                const { data: assignments, error: aErr } = await client
                    .from("task_assignments")
                    .select("task_id")
                    .eq("member_id", user.memberId);

                if (!aErr && Array.isArray(assignments) && assignments.length > 0) {
                    const assignedTaskIds = assignments.map(a => a.task_id).filter(Boolean);
                    if (assignedTaskIds.length > 0) {
                        const { data: tasks, error: tErr } = await client
                            .from("tasks")
                            .select("event_id")
                            .in("task_id", assignedTaskIds);

                        if (!tErr && Array.isArray(tasks)) {
                            for (const t of tasks) {
                                if (t.event_id && activeIds.has(String(t.event_id))) {
                                    const matched = activeEvents.find(e => String(e.event_id) === String(t.event_id));
                                    if (matched) return matched;
                                }
                            }
                        }
                    }
                }
            }

            // 2. Kiểm tra sự kiện đã lưu của tài khoản (hoặc Trưởng nhóm vừa chọn/tạo)
            const userSavedKey = user?.id ? `mediatask_active_event_id_${user.id}` : null;
            const savedId = (userSavedKey && localStorage.getItem(userSavedKey)) || localStorage.getItem("mediatask_active_event_id");
            if (savedId && activeIds.has(String(savedId))) {
                const matched = activeEvents.find(e => String(e.event_id) === String(savedId));
                if (matched) return matched;
            }

            // 3. Fallback: Sự kiện đang diễn ra gần nhất
            return activeEvents[activeEvents.length - 1] || null;
        } catch (err) {
            console.warn("[Bảo mẫu AECPT] Lỗi resolveOngoingEvent:", err);
            return null;
        }
    }

    function isMissingTableOrColumn(error) {
        const code = String(error?.code || "");
        const msg = String(error?.message || error?.details || "").toLowerCase();
        return code === "PGRST205" || code === "42703" || error?.status === 404 || msg.includes("does not exist") || msg.includes("could not find the table");
    }

    function readLocalWidgetState(userId) {
        const key = getLocalKey(userId);
        if (!key) return null;
        try {
            return JSON.parse(localStorage.getItem(key) || "null");
        } catch {
            return null;
        }
    }

    function writeLocalWidgetState(userId, payload) {
        const key = getLocalKey(userId);
        if (!key) return;
        try {
            localStorage.setItem(key, JSON.stringify(payload));
        } catch (err) {
            console.warn("[Bảo mẫu AECPT] Không ghi được localStorage:", err);
        }
    }

    async function loadAndTrackVisitState(user) {
        const userId = user.id;
        const local = readLocalWidgetState(userId) || {};
        let remote = null;

        const client = window.supabaseClient;
        if (client && widgetState.stateTableAvailable) {
            try {
                const { data, error } = await client
                    .from(WIDGET_STATE_TABLE)
                    .select("user_id, is_first_chat, last_visit, messages, updated_at")
                    .eq("user_id", userId)
                    .maybeSingle();

                if (error) {
                    if (isMissingTableOrColumn(error)) {
                        widgetState.stateTableAvailable = false;
                    } else {
                        console.warn("[Bảo mẫu AECPT] Lỗi đọc user_widget_state:", error.message || error);
                    }
                } else {
                    remote = data;
                }
            } catch (err) {
                console.warn("[Bảo mẫu AECPT] Ngoại lệ đọc user_widget_state:", err);
            }
        }

        const remoteTs = Date.parse(remote?.updated_at || "") || 0;
        const localTs = Date.parse(local?.updatedAt || "") || 0;
        const source = remoteTs >= localTs && remote ? {
            isFirstChat: remote.is_first_chat !== false,
            lastVisit: remote.last_visit || local.lastVisit || null,
            messages: Array.isArray(remote.messages) ? remote.messages : (local.messages || []),
            updatedAt: remote.updated_at
        } : {
            isFirstChat: local.isFirstChat !== false && (remote ? remote.is_first_chat !== false : true),
            lastVisit: local.lastVisit || remote?.last_visit || null,
            messages: Array.isArray(local.messages) && local.messages.length ? local.messages : (remote?.messages || []),
            updatedAt: local.updatedAt || remote?.updated_at || null
        };

        // Giữ nguyên last_visit của phiên TRƯỚC trong suốt phiên làm việc hiện tại
        const prevVisitKey = getSessionPrevVisitKey(userId);
        let sessionPrevVisit = null;
        try {
            sessionPrevVisit = sessionStorage.getItem(prevVisitKey);
        } catch (_) {}

        if (sessionPrevVisit === null) {
            sessionPrevVisit = source.lastVisit || "";
            try {
                sessionStorage.setItem(prevVisitKey, sessionPrevVisit);
            } catch (_) {}

            // Cập nhật last_visit = thời điểm hiện tại cho lần truy cập SAU
            const nowIso = new Date().toISOString();
            writeLocalWidgetState(userId, {
                isFirstChat: source.isFirstChat,
                lastVisit: nowIso,
                messages: source.messages.slice(-MAX_SAVED_WIDGET_MESSAGES),
                updatedAt: nowIso
            });

            if (client && widgetState.stateTableAvailable) {
                client
                    .from(WIDGET_STATE_TABLE)
                    .upsert({
                        user_id: userId,
                        is_first_chat: source.isFirstChat,
                        last_visit: nowIso,
                        messages: source.messages.slice(-MAX_SAVED_WIDGET_MESSAGES),
                        updated_at: nowIso
                    }, { onConflict: "user_id" })
                    .then(({ error }) => {
                        if (error && isMissingTableOrColumn(error)) {
                            widgetState.stateTableAvailable = false;
                        }
                    });
            }
        }

        widgetState.isFirstChat = source.isFirstChat;
        widgetState.sessionLastVisit = sessionPrevVisit || null;
        widgetState.messages = Array.isArray(source.messages)
            ? source.messages.slice(-MAX_SAVED_WIDGET_MESSAGES)
            : [];
        widgetState.ongoingEvent = await resolveOngoingEvent(user, client);
    }

    async function persistWidgetMessages() {
        const userId = widgetState.user?.id;
        if (!userId) return;

        const nowIso = new Date().toISOString();
        const trimmedMessages = widgetState.messages
            .slice(-MAX_SAVED_WIDGET_MESSAGES)
            .map(m => ({
                role: m.role,
                content: m.content,
                ...(Array.isArray(m.suggestions) && m.suggestions.length ? { suggestions: m.suggestions } : {}),
                ...(m.confirmAction ? { confirmAction: m.confirmAction } : {})
            }));

        const localExisting = readLocalWidgetState(userId) || {};
        const nextLastVisit = localExisting.lastVisit || nowIso;

        writeLocalWidgetState(userId, {
            isFirstChat: widgetState.isFirstChat,
            lastVisit: nextLastVisit,
            messages: trimmedMessages,
            updatedAt: nowIso
        });

        const client = window.supabaseClient;
        if (client && widgetState.stateTableAvailable) {
            try {
                const { error } = await client
                    .from(WIDGET_STATE_TABLE)
                    .upsert({
                        user_id: userId,
                        is_first_chat: widgetState.isFirstChat,
                        last_visit: nextLastVisit,
                        messages: trimmedMessages,
                        updated_at: nowIso
                    }, { onConflict: "user_id" });

                if (error && isMissingTableOrColumn(error)) {
                    widgetState.stateTableAvailable = false;
                }
            } catch (err) {
                console.warn("[Bảo mẫu AECPT] Lỗi đồng bộ user_widget_state:", err);
            }
        }
    }

    function buildFirstChatWelcomeMessage() {
        return {
            role: "assistant",
            content:
                "Chào bạn! Mình là **Bảo mẫu AECPT**, trợ lý hỗ trợ của trang **AECPT Multimedia**.\n" +
                "Trang web giúp ban Multimedia quản lý kế hoạch truyền thông sự kiện, lập Timeline/đường găng CPM bằng AI và theo dõi tiến độ công việc theo từng thành viên.",
            suggestions: [
                "Trang web này làm được gì?",
                "Cập nhật công việc sự kiện",
                "Hướng dẫn tôi dùng tính năng lập Timeline & quản lý công việc",
                "Tôi cần hỗ trợ khác"
            ]
        };
    }

    function parseFlexibleTimestamp(rawInput) {
        const raw = String(rawInput || "").trim();
        if (!raw) return null;

        // Dạng DD/MM/YYYY hoặc HH:mm DD/MM/YYYY
        const vnMatch = raw.match(/^(?:(\d{1,2}):(\d{2})\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (vnMatch) {
            const hh = Number(vnMatch[1] ?? 0);
            const mm = Number(vnMatch[2] ?? 0);
            const day = Number(vnMatch[3]);
            const month = Number(vnMatch[4]) - 1;
            const year = Number(vnMatch[5]);
            const d = new Date(year, month, day, hh, mm, 0, 0);
            return Number.isNaN(d.getTime()) ? null : d;
        }

        // Dạng YYYY-MM-DD (hiểu là 00:00 giờ local)
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            const d = new Date(`${raw}T00:00:00`);
            return Number.isNaN(d.getTime()) ? null : d;
        }

        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function deriveTaskStatus(task, assignments = []) {
        if (task.is_cancelled === true) return "cancelled";
        if (task.post_done === true || task.status === "completed") return "completed";
        const activeAssigns = assignments.filter(a => a && a.member_id);
        if (activeAssigns.length > 0) {
            const states = activeAssigns.map(a => {
                if (a.is_done === true) return "completed";
                return STATUS_ALIASES[String(a.assignment_state || "").toLowerCase().trim()] || "not_started";
            });
            if (states.every(s => s === "completed")) return "completed";
            if (states.includes("in_progress")) return "in_progress";
            if (states.includes("pending_review")) return "pending_review";
            return "not_started";
        }
        return STATUS_ALIASES[String(task.status || "").toLowerCase().trim()] || "not_started";
    }

    function getTaskDeadlineDate(task) {
        if (task.package_deadline_at) {
            const d = new Date(task.package_deadline_at);
            if (!Number.isNaN(d.getTime())) return d;
        }
        if (task.package_deadline_date) {
            const d = new Date(`${task.package_deadline_date}T${task.package_deadline_time || "23:59:59"}`);
            if (!Number.isNaN(d.getTime())) return d;
        }
        return null;
    }

    async function fetchTasksWithAssignments(client, eventIdFilter) {
        let query = client
            .from("tasks")
            .select(`
                task_id, task_no, event_id, task_title, task_type, submission_label,
                package_deadline_date, package_deadline_time, package_deadline_at,
                on_air_date, on_air_time, status, post_done, is_cancelled, progress,
                created_at, updated_at,
                task_assignments (
                    role, assignment_state, member_id, is_done, assigned_at,
                    members ( member_label, department )
                )
            `);

        if (eventIdFilter && eventIdFilter !== "all") {
            query = query.eq("event_id", eventIdFilter);
        }

        let { data, error } = await query.order("task_id", { ascending: true });

        if (error && isMissingTableOrColumn(error)) {
            let fallbackQuery = client
                .from("tasks")
                .select(`
                    task_id, task_no, event_id, task_title, task_type, submission_label,
                    package_deadline_date, package_deadline_time, package_deadline_at,
                    on_air_date, on_air_time, status, post_done, is_cancelled, progress,
                    task_assignments (
                        role, assignment_state, member_id, is_done, assigned_at,
                        members ( member_label, department )
                    )
                `);
            if (eventIdFilter && eventIdFilter !== "all") {
                fallbackQuery = fallbackQuery.eq("event_id", eventIdFilter);
            }
            const fallbackRes = await fallbackQuery.order("task_id", { ascending: true });
            data = fallbackRes.data;
            error = fallbackRes.error;
        }

        if (error) throw error;
        return data || [];
    }

    function buildDeadlineAlerts(tasks, eventsMap, nowDate, hoursThreshold = LEADER_DEADLINE_ALERT_HOURS) {
        const thresholdMs = nowDate.getTime() + hoursThreshold * 3600 * 1000;
        const overdue = [];
        const dueSoon = [];

        tasks.forEach(task => {
            const status = deriveTaskStatus(task, task.task_assignments || []);
            if (status === "completed" || status === "cancelled") return;
            const dl = getTaskDeadlineDate(task);
            if (!dl) return;

            const dlMs = dl.getTime();
            const assignees = (task.task_assignments || [])
                .map(a => `${a.members?.member_label || a.member_id} (${a.role || "TV"})`)
                .filter(Boolean);

            const item = {
                task_id: task.task_id,
                task_title: task.task_title || task.task_id,
                event_id: task.event_id,
                event_label: eventsMap.get(task.event_id)?.event_label || task.event_id,
                status: STATUS_LABELS[status] || status,
                deadline: formatDateTime(dl),
                assignees: assignees.length ? assignees.join(", ") : "Chưa phân công"
            };

            if (dlMs < nowDate.getTime()) {
                overdue.push(item);
            } else if (dlMs <= thresholdMs) {
                const hoursLeft = Math.max(0, Math.round((dlMs - nowDate.getTime()) / 3600000));
                dueSoon.push({ ...item, hours_left: hoursLeft });
            }
        });

        return {
            overdue_count: overdue.length,
            overdue: overdue.slice(0, 8),
            due_within_48h_count: dueSoon.length,
            due_within_48h: dueSoon.slice(0, 8)
        };
    }

    async function executeToolCall(name, rawArgs) {
        const client = window.supabaseClient;
        if (!client) {
            return { ok: false, error: "Chưa kết nối được Supabase." };
        }

        let args = {};
        try {
            args = typeof rawArgs === "string" ? JSON.parse(rawArgs || "{}") : (rawArgs || {});
        } catch {
            args = {};
        }

        const user = widgetState.user || {};

        if (name === "get_events_and_roles") {
            if (!widgetState.ongoingEvent) {
                widgetState.ongoingEvent = await resolveOngoingEvent(user, client);
            }
            const ongoing = widgetState.ongoingEvent;

            const rolesRes = await client.from("task_assignments").select("role").limit(500);
            const roles = [...new Set((rolesRes.data || []).map(r => r.role).filter(Boolean))];

            if (!ongoing) {
                return {
                    ok: true,
                    has_ongoing_event: false,
                    user_role: user.isLeader ? "leader" : "member",
                    user_member_id: user.memberId || null,
                    message: "Tài khoản của bạn hiện chưa tham gia sự kiện nào đang diễn ra.",
                    active_events: [],
                    available_roles: roles
                };
            }

            return {
                ok: true,
                has_ongoing_event: true,
                user_role: user.isLeader ? "leader" : "member",
                user_member_id: user.memberId || null,
                last_visit_iso: widgetState.sessionLastVisit || null,
                last_visit_display: widgetState.sessionLastVisit ? formatDateTime(widgetState.sessionLastVisit) : "không có",
                now_display: formatDateTime(new Date()),
                active_event: ongoing,
                active_events: [ongoing],
                available_roles: roles
            };
        }

        if (name === "query_task_updates") {
            const fromDate = parseFlexibleTimestamp(args.from_iso);
            if (!fromDate) {
                return {
                    ok: false,
                    needs_clarification: true,
                    error: "Mốc thời gian không hợp lệ hoặc chưa được cung cấp. Hãy hỏi lại người dùng mốc thời gian cụ thể."
                };
            }

            if (!widgetState.ongoingEvent) {
                widgetState.ongoingEvent = await resolveOngoingEvent(user, client);
            }
            const ongoing = widgetState.ongoingEvent;
            if (!ongoing) {
                return {
                    ok: true,
                    has_ongoing_event: false,
                    period_used: `Từ ${formatDateTime(fromDate)} đến ${formatDateTime(new Date())}`,
                    message: "Tài khoản của bạn hiện không tham gia sự kiện nào đang diễn ra.",
                    total_tasks_in_scope: 0,
                    new_tasks: [],
                    updated_tasks: [],
                    completed_tasks: [],
                    overdue_or_due_within_48h: { overdue_count: 0, overdue: [], due_within_48h_count: 0, due_within_48h: [] }
                };
            }

            const nowDate = new Date();
            const targetEventId = ongoing.event_id;
            const roleFilter = args.role_filter ? String(args.role_filter).trim().toLowerCase() : null;

            const tasks = await fetchTasksWithAssignments(client, targetEventId);
            const eventsMap = new Map([[ongoing.event_id, ongoing]]);

            let filteredTasks = tasks;
            if (roleFilter) {
                filteredTasks = tasks.filter(t =>
                    (t.task_assignments || []).some(a => String(a.role || "").toLowerCase().includes(roleFilter))
                );
            }

            // Đọc nhật ký thay đổi task_change_logs chỉ của sự kiện đang diễn ra này
            let logs = [];
            let logsAvailable = true;
            try {
                let logQuery = client
                    .from(LOGS_TABLE)
                    .select("log_id, task_id, event_id, member_id, change_type, summary, changed_at")
                    .eq("event_id", targetEventId)
                    .gte("changed_at", fromDate.toISOString())
                    .order("changed_at", { ascending: false })
                    .limit(200);

                const { data: logData, error: logErr } = await logQuery;
                if (logErr) {
                    if (isMissingTableOrColumn(logErr)) {
                        logsAvailable = false;
                    } else {
                        console.warn("[Bảo mẫu AECPT] Lỗi đọc task_change_logs:", logErr.message);
                        logsAvailable = false;
                    }
                } else {
                    logs = logData || [];
                }
            } catch {
                logsAvailable = false;
            }

            const taskById = new Map(filteredTasks.map(t => [t.task_id, t]));
            const newTasks = [];
            const changedTasks = [];
            const completedTasks = [];
            const seenNew = new Set();
            const seenChanged = new Set();
            const seenCompleted = new Set();

            if (logsAvailable) {
                logs.forEach(log => {
                    const task = taskById.get(log.task_id);
                    if (!task && roleFilter) return;
                    const item = {
                        task_id: log.task_id,
                        task_title: task?.task_title || log.task_id,
                        event_id: log.event_id,
                        event_label: eventsMap.get(log.event_id)?.event_label || log.event_id || "",
                        summary: log.summary || "",
                        changed_at: formatDateTime(log.changed_at),
                        is_mine: Boolean(user.memberId && (task?.task_assignments || []).some(a => a.member_id === user.memberId))
                    };
                    if (log.change_type === "created" && !seenNew.has(log.task_id)) {
                        seenNew.add(log.task_id);
                        newTasks.push(item);
                    } else if (log.change_type === "completed" && !seenCompleted.has(log.task_id)) {
                        seenCompleted.add(log.task_id);
                        completedTasks.push(item);
                    } else if ((log.change_type === "updated" || log.change_type === "assignment_changed") && !seenChanged.has(log.task_id)) {
                        seenChanged.add(log.task_id);
                        changedTasks.push(item);
                    }
                });
            }

            // Bổ sung / fallback theo created_at, updated_at và task_assignments.assigned_at
            filteredTasks.forEach(task => {
                const assigns = task.task_assignments || [];
                const status = deriveTaskStatus(task, assigns);
                const createdMs = Date.parse(task.created_at || "") || 0;
                const updatedMs = Date.parse(task.updated_at || "") || 0;
                const earliestAssignMs = assigns.reduce((min, a) => {
                    const ms = Date.parse(a.assigned_at || "");
                    return !Number.isNaN(ms) && (min === 0 || ms < min) ? ms : min;
                }, 0);
                const latestAssignMs = assigns.reduce((max, a) => {
                    const ms = Date.parse(a.assigned_at || "");
                    return !Number.isNaN(ms) && ms > max ? ms : max;
                }, 0);

                const isMine = Boolean(user.memberId && assigns.some(a => a.member_id === user.memberId));
                const baseItem = {
                    task_id: task.task_id,
                    task_title: task.task_title || task.task_id,
                    event_id: task.event_id,
                    event_label: eventsMap.get(task.event_id)?.event_label || task.event_id || "",
                    status: STATUS_LABELS[status] || status,
                    deadline: formatDateTime(getTaskDeadlineDate(task)),
                    is_mine: isMine
                };

                if ((createdMs >= fromDate.getTime() || (!logsAvailable && earliestAssignMs >= fromDate.getTime())) && !seenNew.has(task.task_id)) {
                    seenNew.add(task.task_id);
                    newTasks.push(baseItem);
                } else if ((updatedMs >= fromDate.getTime() || (!logsAvailable && latestAssignMs >= fromDate.getTime())) && status !== "completed" && !seenChanged.has(task.task_id)) {
                    seenChanged.add(task.task_id);
                    changedTasks.push(baseItem);
                }

                if (status === "completed" && (updatedMs >= fromDate.getTime() || latestAssignMs >= fromDate.getTime()) && !seenCompleted.has(task.task_id)) {
                    seenCompleted.add(task.task_id);
                    completedTasks.push(baseItem);
                }
            });

            const deadlineSummary = buildDeadlineAlerts(filteredTasks, eventsMap, nowDate, LEADER_DEADLINE_ALERT_HOURS);
            const myTasks = user.memberId
                ? filteredTasks.filter(t => (t.task_assignments || []).some(a => a.member_id === user.memberId))
                : [];

            return {
                ok: true,
                period_used: `Từ ${formatDateTime(fromDate)} đến ${formatDateTime(nowDate)}`,
                tracking_mode: logsAvailable ? "full_change_logs" : "fallback_timestamps (bảng task_change_logs chưa được cài đặt)",
                user_role: user.isLeader ? "leader" : "member",
                total_tasks_in_scope: filteredTasks.length,
                my_tasks_count: myTasks.length,
                new_tasks_count: newTasks.length,
                new_tasks: newTasks.slice(0, 8),
                updated_tasks_count: changedTasks.length,
                updated_tasks: changedTasks.slice(0, 8),
                completed_tasks_count: completedTasks.length,
                completed_tasks: completedTasks.slice(0, 8),
                overdue_or_due_within_48h: deadlineSummary,
                leader_deadline_alert_note: user.isLeader && (deadlineSummary.overdue_count > 0 || deadlineSummary.due_within_48h_count > 0)
                    ? `Cảnh báo Trưởng nhóm: Hiện có ${deadlineSummary.overdue_count} công việc quá hạn và ${deadlineSummary.due_within_48h_count} công việc sắp đến hạn trong ${LEADER_DEADLINE_ALERT_HOURS} giờ chưa hoàn thành.`
                    : null
            };
        }

        if (name === "get_my_tasks") {
            if (!widgetState.ongoingEvent) {
                widgetState.ongoingEvent = await resolveOngoingEvent(user, client);
            }
            const ongoing = widgetState.ongoingEvent;
            if (!ongoing) {
                return {
                    ok: true,
                    has_ongoing_event: false,
                    tasks: [],
                    total_matched: 0,
                    message: "Tài khoản của bạn hiện không tham gia sự kiện nào đang diễn ra."
                };
            }

            const nowDate = new Date();
            const keyword = String(args.keyword || "").trim().toLowerCase();
            const statusFilter = args.status_filter || "all";

            const allTasks = await fetchTasksWithAssignments(client, ongoing.event_id);
            const eventsMap = new Map([[ongoing.event_id, ongoing]]);

            let sourceTasks = user.memberId
                ? allTasks.filter(t => (t.task_assignments || []).some(a => a.member_id === user.memberId))
                : (user.isLeader ? allTasks : []);

            if (keyword) {
                sourceTasks = sourceTasks.filter(t =>
                    String(t.task_id || "").toLowerCase().includes(keyword) ||
                    String(t.task_title || "").toLowerCase().includes(keyword)
                );
            }

            const mapped = sourceTasks.map(t => {
                const assigns = t.task_assignments || [];
                const myAssign = user.memberId ? assigns.find(a => a.member_id === user.memberId) : null;
                const status = myAssign
                    ? deriveTaskStatus({ ...t, post_done: myAssign.is_done }, [myAssign])
                    : deriveTaskStatus(t, assigns);
                return {
                    task_id: t.task_id,
                    task_title: t.task_title || t.task_id,
                    event_id: t.event_id,
                    event_label: eventsMap.get(t.event_id)?.event_label || t.event_id,
                    my_role: myAssign?.role || null,
                    status_code: status,
                    status_label: STATUS_LABELS[status] || status,
                    deadline: formatDateTime(getTaskDeadlineDate(t))
                };
            }).filter(t => statusFilter === "all" || t.status_code === statusFilter);

            const response = {
                ok: true,
                has_ongoing_event: true,
                event_id: ongoing.event_id,
                event_label: ongoing.event_label,
                member_id: user.memberId || null,
                is_leader: Boolean(user.isLeader),
                total_matched: mapped.length,
                tasks: mapped.slice(0, 12)
            };

            if (user.isLeader) {
                const activeTasks = allTasks.filter(t => eventsMap.get(t.event_id)?.is_completed !== true);
                response.leader_48h_alerts = buildDeadlineAlerts(activeTasks, eventsMap, nowDate, LEADER_DEADLINE_ALERT_HOURS);
            }

            return response;
        }

        if (name === "request_task_status_update") {
            const taskId = String(args.task_id || "").trim();
            const newStatus = STATUS_ALIASES[String(args.new_status || "").toLowerCase().trim()] || args.new_status;
            if (!taskId || !STATUS_LABELS[newStatus]) {
                return { ok: false, error: "Thiếu mã công việc (task_id) hoặc trạng thái mới hợp lệ." };
            }

            const { data: taskRow, error: taskErr } = await client
                .from("tasks")
                .select("task_id, task_title, event_id, status, post_done, task_assignments(role, member_id, assignment_state, is_done)")
                .eq("task_id", taskId)
                .maybeSingle();

            if (taskErr) return { ok: false, error: taskErr.message };
            if (!taskRow) return { ok: false, error: `Không tìm thấy công việc có mã ${taskId}.` };

            if (!widgetState.ongoingEvent) {
                widgetState.ongoingEvent = await resolveOngoingEvent(user, client);
            }
            if (widgetState.ongoingEvent && taskRow.event_id && String(taskRow.event_id) !== String(widgetState.ongoingEvent.event_id)) {
                return {
                    ok: false,
                    error: `Công việc ${taskId} thuộc sự kiện ${taskRow.event_id}, không thuộc sự kiện đang diễn ra của bạn (${widgetState.ongoingEvent.event_label}).`
                };
            }

            const ownAssignment = user.memberId
                ? (taskRow.task_assignments || []).find(a => a.member_id === user.memberId)
                : null;

            if (!ownAssignment && !user.isLeader) {
                return {
                    ok: false,
                    error: `Bạn (${user.name}) chưa được phân công trực tiếp vào công việc ${taskId} nên không có quyền cập nhật trạng thái.`
                };
            }

            const oldStatus = ownAssignment
                ? deriveTaskStatus({ post_done: ownAssignment.is_done }, [ownAssignment])
                : deriveTaskStatus(taskRow, taskRow.task_assignments || []);

            const proposal = {
                type: "update_task_status",
                task_id: taskRow.task_id,
                task_title: taskRow.task_title || taskRow.task_id,
                event_id: taskRow.event_id,
                old_status: oldStatus,
                old_status_label: STATUS_LABELS[oldStatus] || oldStatus,
                new_status: newStatus,
                new_status_label: STATUS_LABELS[newStatus],
                scope: ownAssignment ? "assignment" : "task",
                member_id: ownAssignment ? user.memberId : null,
                role: ownAssignment?.role || null,
                resolved: false
            };

            widgetState.pendingConfirmAction = proposal;

            return {
                ok: true,
                awaiting_user_confirmation: true,
                proposal,
                instruction: "Hãy tóm tắt ngắn gọn thay đổi này (tên công việc, mã, trạng thái cũ -> mới) và mời người dùng bấm Xác nhận cập nhật hoặc nhắn xác nhận."
            };
        }

        if (name === "execute_task_status_update") {
            const taskId = String(args.task_id || "").trim();
            const newStatus = STATUS_ALIASES[String(args.new_status || "").toLowerCase().trim()] || args.new_status;
            if (!taskId || !STATUS_LABELS[newStatus]) {
                return { ok: false, error: "Thiếu task_id hoặc trạng thái hợp lệ." };
            }

            if (
                !widgetState.pendingConfirmAction ||
                widgetState.pendingConfirmAction.task_id !== taskId ||
                widgetState.pendingConfirmAction.new_status !== newStatus
            ) {
                return {
                    ok: false,
                    error: "Chưa có bước xác nhận từ người dùng cho thay đổi này. Hãy gọi request_task_status_update để xin xác nhận trước."
                };
            }

            const res = await performConfirmedTaskUpdate(widgetState.pendingConfirmAction);
            return res;
        }

        return { ok: false, error: `Công cụ "${name}" không tồn tại.` };
    }

    async function performConfirmedTaskUpdate(action) {
        const client = window.supabaseClient;
        if (!client || !action) {
            return { ok: false, error: "Không có kết nối Supabase hoặc hành động cần thực hiện." };
        }

        try {
            const isDone = action.new_status === "completed";
            if (action.scope === "assignment" && action.member_id) {
                const { data, error } = await client
                    .from("task_assignments")
                    .update({
                        assignment_state: action.new_status,
                        is_done: isDone
                    })
                    .eq("task_id", action.task_id)
                    .eq("member_id", action.member_id)
                    .select("task_id");

                if (error) return { ok: false, error: error.message };
                if (!data?.length) {
                    return { ok: false, error: "Không có dòng phân công nào được cập nhật (kiểm tra quyền RLS hoặc member_id)." };
                }
            } else {
                const { data, error } = await client
                    .from("tasks")
                    .update({
                        status: action.new_status,
                        progress: isDone ? 100 : (action.new_status === "not_started" ? 0 : 50)
                    })
                    .eq("task_id", action.task_id)
                    .select("task_id");

                if (error) return { ok: false, error: error.message };
                if (!data?.length) {
                    return { ok: false, error: "Không tìm thấy hoặc không có quyền cập nhật công việc trên Supabase." };
                }
            }

            action.resolved = true;
            action.resolution = "confirmed";
            widgetState.pendingConfirmAction = null;

            window.dispatchEvent(new CustomEvent("aecpt:tasks-updated", {
                detail: { task_id: action.task_id, new_status: action.new_status }
            }));

            return {
                ok: true,
                task_id: action.task_id,
                task_title: action.task_title,
                new_status_label: action.new_status_label
            };
        } catch (err) {
            return { ok: false, error: err.message || "Lỗi cập nhật trạng thái công việc." };
        }
    }

    function buildSystemPrompt() {
        const user = widgetState.user || {};
        const ongoing = widgetState.ongoingEvent;
        const currentPage = (((typeof location !== "undefined" ? location.pathname : window.location?.pathname) || "").split("/").pop() || "dashboard.html");
        const lastVisitDisplay = widgetState.sessionLastVisit
            ? formatDateTime(widgetState.sessionLastVisit)
            : "không có";
        const nowDisplay = formatDateTime(new Date());
        const ongoingDesc = ongoing
            ? `"${ongoing.event_label}" (Mã: ${ongoing.event_id}, Thể loại: ${ongoing.event_category || "Sự kiện"}, Ghi chú: ${ongoing.category_note || "Không có"})`
            : "Tài khoản hiện chưa tham gia sự kiện nào đang diễn ra.";

        return `# VAI TRÒ
Bạn là Bảo mẫu AECPT, trợ lý chăm sóc khách hàng và đồng hành công việc của AECPT Multimedia, hiển thị dưới dạng khung chat nhỏ ở góc dưới bên phải trang web.
Nhiệm vụ của bạn:
1. Giới thiệu sơ về trang web cho người dùng mới.
2. Gợi ý các câu hỏi/hành động để người dùng bắt đầu dễ dàng.
3. Cập nhật tình hình công việc hiện tại của sự kiện.
4. Hướng dẫn và hỗ trợ người dùng thao tác các tính năng trên web.

Trả lời bằng tiếng Việt. Tông giọng thích ứng tự nhiên theo phong cách người dùng nhắn, nhưng LUÔN thân thiện, tôn trọng và lịch sự.
Khung chat nhỏ nên mỗi câu trả lời PHẢI ngắn gọn (tối đa khoảng 5 câu ngắn), dùng danh sách gạch đầu dòng hoặc đánh số khi cần liệt kê.

# THÔNG TIN BẠN ĐƯỢC CUNG CẤP
- Tên website: AECPT Multimedia
- Tính năng chính: lập Timeline & quản lý công việc
- Mô tả website: Web quản lý kế hoạch truyền thông sự kiện của ban Multimedia AECPT, tích hợp Groq AI để lập Timeline/CPM, phân công công việc và theo dõi deadline qua Supabase.
- QUY ĐỊNH PHẠM VI DỮ LIỆU SỰ KIỆN:
  • Mỗi tài khoản CHỈ THAM GIA DUY NHẤT 1 SỰ KIỆN ĐANG DIỄN RA kể cả Trưởng nhóm.
  • Sự kiện hiện tại của tài khoản này: ${ongoingDesc}
  • BẠN CHỈ ĐƯỢC PHÉP TRUY CẬP VÀ SỬ DỤNG DỮ LIỆU CÔNG VIỆC THUỘC DUY NHẤT SỰ KIỆN ĐANG DIỄN RA NÀY.
  • TUYỆT ĐỐI KHÔNG DÙNG DỮ LIỆU CỦA CÁC SỰ KIỆN ĐÃ HOÀN THÀNH HOẶC SỰ KIỆN KHÁC.
  • Nếu tài khoản chưa có sự kiện đang diễn ra, hãy thông báo rõ ràng là hiện tại bạn chưa tham gia sự kiện nào đang hoạt động.
- Danh sách tính năng thật trên web:
${FEATURE_DOCS}
- Công cụ dữ liệu & hành động có sẵn:
  • get_events_and_roles (xem sự kiện đang diễn ra & ban hiện có)
  • query_task_updates (xem công việc mới, thay đổi, hoàn thành, quá hạn/sắp đến hạn <= 48h từ mốc from_iso)
  • get_my_tasks (xem công việc của người dùng & cảnh báo <= 48h cho Trưởng nhóm)
  • request_task_status_update (chuẩn bị cập nhật trạng thái & xin xác nhận)
  • execute_task_status_update (chỉ gọi khi người dùng đã xác nhận)
- Thông tin phiên hiện tại:
  • user_id = ${user.id || "khách"}
  • tên người dùng = ${user.name || "bạn"}
  • vai trò = ${user.isLeader ? "Trưởng nhóm (Leader)" : "Thành viên (Member)"}
  • member_id = ${user.memberId || "chưa liên kết"}
  • đang ở trang = ${currentPage}
  • is_first_chat = ${widgetState.isFirstChat}
  • last_visit = ${lastVisitDisplay}
  • now = ${nowDisplay}

Chỉ dùng thông tin nêu trên và kết quả thật từ công cụ. Không dùng kiến thức bên ngoài để bịa tính năng, số liệu hay trạng thái công việc.

# QUY TẮC CỐT LÕI: KHÔNG ĐOÁN
- Nếu thiếu thông tin cần thiết để trả lời hoặc gọi công cụ, HÃY HỎI LẠI NGƯỜI DÙNG. Lặp lại cho đến khi đủ thông tin mới thực hiện.
- Mỗi lượt chỉ hỏi 1 câu, hoặc tối đa 2 câu ngắn nếu thật sự cần. Ưu tiên đưa lựa chọn cụ thể.
- Không tự điền giá trị mặc định cho tham số người dùng chưa nói (mốc thời gian from_iso, ban, mã công việc, trạng thái mới...).
- Nếu thông tin có thể tra bằng công cụ (như task của bạn) thì tự gọi công cụ tra cứu, không hỏi lại những gì đã biết.
- Nếu không có thông tin và không tra được: trả lời đúng ý "Vấn đề này nằm ngoài phạm vi hiểu biết của tôi. Vui lòng liên hệ 0799605442." Tuyệt đối không suy đoán hay bịa.
- Với thao tác thay đổi dữ liệu (cập nhật trạng thái task): PHẢI gọi request_task_status_update trước để tóm tắt thay đổi và xin xác nhận, tuyệt đối không tự ghi thẳng.

# QUY TẮC CẬP NHẬT CÔNG VIỆC SỰ KIỆN
- Khi người dùng muốn biết cập nhật công việc:
  • Nếu tài khoản không có sự kiện đang diễn ra: nói rõ là hiện tại bạn chưa tham gia sự kiện nào đang diễn ra.
  • Nếu last_visit KHÁC "không có" và người dùng chưa chọn mốc thời gian: hỏi người dùng chọn "xem thay đổi từ lần truy cập gần nhất (${lastVisitDisplay})" hay "chọn mốc thời gian khác". Không tự quyết định thay họ!
  • Nếu last_visit = "không có" hoặc người dùng muốn chọn mốc khác mà chưa nói mốc cụ thể: hỏi "Bạn muốn xem cập nhật từ lúc nào?" và chờ câu trả lời.
  • Sau khi có đủ mốc thời gian, gọi query_task_updates rồi tóm tắt rõ:
    1) Khoảng thời gian đã dùng (ví dụ: "Từ ${lastVisitDisplay} đến nay")
    2) Công việc mới, Công việc thay đổi, Công việc hoàn thành, Công việc quá hạn hoặc sắp đến hạn (trong 48 giờ)
    3) Nếu không có thay đổi nào, nói thẳng là không có thay đổi.
    4) ĐỐI VỚI TRƯỞNG NHÓM (Leader): nếu có task quá hạn hoặc sắp đến hạn trong 48 giờ chưa hoàn thành, LUÔN thêm mục cảnh báo rõ ràng!
    5) Đối với Thành viên (Member): ưu tiên báo cáo các việc được giao cho bản thân trước, sau đó tóm tắt ngắn tình hình chung của sự kiện nếu cần.

# QUY TẮC HƯỚNG DẪN THAO TÁC
- Hướng dẫn từng bước đánh số (1, 2, 3...), mỗi bước 1 hành động dựa đúng trên Danh sách tính năng thật ở trên.
- Nếu tính năng không có trong web (hoặc câu hỏi ngoài phạm vi AECPT Multimedia), nói rõ ngoài phạm vi và nhắc liên hệ 0799605442.

# ĐỊNH DẠNG GỢI Ý BẮT BUỘC CUỐI MỖI TIN NHẮN
Cuối MỖI câu trả lời, luôn gắn đúng 1 dòng dưới cùng theo định dạng sau để giao diện hiển thị nút bấm:
SUGGESTIONS: ["gợi ý ngắn 1", "gợi ý ngắn 2", "gợi ý ngắn 3"]
Lưu ý: Không lặp lại gợi ý người dùng vừa bấm ("${widgetState.lastClickedSuggestion || ""}"). Tối đa 2-3 gợi ý ngắn, sát ngữ cảnh.`;
    }

    function extractSuggestionsAndCleanReply(rawText) {
        let cleaned = String(rawText || "")
            .replace(/<think>[\s\S]*?<\/think>/gi, "")
            .trim();

        let suggestions = [];
        const match = cleaned.match(/(?:^|\n)\s*SUGGESTIONS\s*:\s*(\[[\s\S]*?\])\s*$/i);
        if (match) {
            try {
                const parsed = JSON.parse(match[1]);
                if (Array.isArray(parsed)) {
                    suggestions = parsed
                        .map(s => String(s || "").trim())
                        .filter(Boolean)
                        .filter(s => s !== widgetState.lastClickedSuggestion)
                        .slice(0, 3);
                }
            } catch (_) {}
            cleaned = cleaned.slice(0, match.index).trim();
        }

        return {
            text: cleaned || "Mình đã tiếp nhận thông tin của bạn.",
            suggestions
        };
    }

    async function callGroqWithTools(messagesPayload) {
        const apiKey = getApiKey();
        if (!apiKey) {
            throw new Error("Chưa cấu hình Groq API Key.");
        }

        const models = getWidgetModels();
        let lastError = null;
        for (const model of models) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 18000);

            try {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model,
                        messages: messagesPayload,
                        tools: TOOLS_SPEC,
                        tool_choice: "auto",
                        temperature: 0.15,
                        max_tokens: 900
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errBody = await response.json().catch(() => ({}));
                    const errMsg = errBody.error?.message || `HTTP ${response.status}`;
                    if (response.status === 401 || errMsg.toLowerCase().includes("invalid api key")) {
                        throw new Error("Groq API Key không hợp lệ.");
                    }
                    lastError = new Error(`Model ${model}: ${errMsg}`);
                    continue;
                }

                const data = await response.json();
                const choiceMsg = data.choices?.[0]?.message;
                if (!choiceMsg) {
                    lastError = new Error(`Model ${model} không trả về nội dung.`);
                    continue;
                }
                return choiceMsg;
            } catch (err) {
                clearTimeout(timeoutId);
                if (err.message?.includes("API Key")) throw err;
                lastError = err;
            }
        }

        throw lastError || new Error("Không thể kết nối đến Groq AI.");
    }

    async function runAssistantTurn(userText) {
        const apiMessages = [
            { role: "system", content: buildSystemPrompt() }
        ];

        widgetState.messages.slice(-8).forEach(msg => {
            if (!msg?.content) return;
            apiMessages.push({
                role: msg.role === "assistant" ? "assistant" : "user",
                content: msg.content
            });
        });

        let preparedActionThisTurn = null;

        for (let step = 0; step < 4; step++) {
            const assistantMsg = await callGroqWithTools(apiMessages);
            const toolCalls = assistantMsg.tool_calls;

            if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
                const { text, suggestions } = extractSuggestionsAndCleanReply(assistantMsg.content || "");
                return {
                    text,
                    suggestions,
                    confirmAction: preparedActionThisTurn
                };
            }

            apiMessages.push({
                role: "assistant",
                content: assistantMsg.content || "",
                tool_calls: toolCalls
            });

            for (const tc of toolCalls) {
                const fnName = tc.function?.name;
                const fnArgs = tc.function?.arguments;
                const result = await executeToolCall(fnName, fnArgs);
                if (fnName === "request_task_status_update" && result?.ok && result?.proposal) {
                    preparedActionThisTurn = result.proposal;
                }
                apiMessages.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    name: fnName,
                    content: JSON.stringify(result)
                });
            }
        }

        return {
            text: "Vấn đề này nằm ngoài phạm vi hiểu biết của tôi. Vui lòng liên hệ 0799605442.",
            suggestions: ["Cập nhật công việc sự kiện", "Trang web này làm được gì?"],
            confirmAction: null
        };
    }

    function formatWidgetMarkdown(text = "") {
        let html = escapeHTML(text);
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
            const safeUrl = /^[a-z0-9._/-]+(\?[a-z0-9=&_%-]+)?$/i.test(url) ? url : "#";
            return `<a href="${safeUrl}">${label}</a>`;
        });
        html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

        const lines = html.split("\n");
        const out = [];
        let inUl = false;
        let inOl = false;

        const closeLists = () => {
            if (inUl) { out.push("</ul>"); inUl = false; }
            if (inOl) { out.push("</ol>"); inOl = false; }
        };

        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) {
                closeLists();
                return;
            }
            if (/^[•\-*]\s+/.test(trimmed)) {
                if (inOl) { out.push("</ol>"); inOl = false; }
                if (!inUl) { out.push("<ul>"); inUl = true; }
                out.push(`<li>${trimmed.replace(/^[•\-*]\s+/, "")}</li>`);
            } else if (/^\d+[.)]\s+/.test(trimmed)) {
                if (inUl) { out.push("</ul>"); inUl = false; }
                if (!inOl) { out.push("<ol>"); inOl = true; }
                out.push(`<li>${trimmed.replace(/^\d+[.)]\s+/, "")}</li>`);
            } else {
                closeLists();
                out.push(`<p>${trimmed}</p>`);
            }
        });
        closeLists();
        return out.join("") || `<p>${html}</p>`;
    }

    function renderMessages() {
        const container = widgetState.dom.messages;
        if (!container) return;
        container.innerHTML = "";

        widgetState.messages.forEach((msg, index) => {
            const group = document.createElement("div");
            group.className = "sw-msg-group";

            const row = document.createElement("div");
            row.className = `sw-msg-row ${msg.role}`;

            const bubble = document.createElement("div");
            bubble.className = "sw-msg-bubble";
            bubble.innerHTML = msg.role === "assistant"
                ? formatWidgetMarkdown(msg.content)
                : `<p>${escapeHTML(msg.content)}</p>`;

            if (msg.role === "assistant" && msg.confirmAction) {
                const card = document.createElement("div");
                card.className = "sw-confirm-card";

                const meta = document.createElement("div");
                meta.className = "sw-confirm-meta";
                meta.innerHTML =
                    `<strong>${escapeHTML(msg.confirmAction.task_title)}</strong> (<code>${escapeHTML(msg.confirmAction.task_id)}</code>)<br>` +
                    `${escapeHTML(msg.confirmAction.old_status_label)} → <strong>${escapeHTML(msg.confirmAction.new_status_label)}</strong>`;

                const actions = document.createElement("div");
                actions.className = "sw-confirm-actions";

                const confirmBtn = document.createElement("button");
                confirmBtn.type = "button";
                confirmBtn.className = "sw-btn-confirm";

                const cancelBtn = document.createElement("button");
                cancelBtn.type = "button";
                cancelBtn.className = "sw-btn-cancel";
                cancelBtn.textContent = "Hủy";

                if (msg.confirmAction.resolved) {
                    confirmBtn.disabled = true;
                    cancelBtn.disabled = true;
                    confirmBtn.textContent = msg.confirmAction.resolution === "confirmed"
                        ? "Đã cập nhật"
                        : "Đã hủy";
                } else {
                    confirmBtn.textContent = "Xác nhận cập nhật";
                    confirmBtn.addEventListener("click", async () => {
                        confirmBtn.disabled = true;
                        cancelBtn.disabled = true;
                        confirmBtn.textContent = "Đang lưu...";
                        const res = await performConfirmedTaskUpdate(msg.confirmAction);
                        const replyMsg = res.ok
                            ? {
                                role: "assistant",
                                content: `Đã cập nhật công việc **${res.task_title}** (${res.task_id}) sang **${res.new_status_label}**.`,
                                suggestions: ["Xem công việc của tôi", "Cập nhật công việc sự kiện"]
                            }
                            : {
                                role: "assistant",
                                content: `Không thể cập nhật: ${res.error}`,
                                suggestions: ["Thử lại", "Tôi cần hỗ trợ khác"]
                            };
                        widgetState.messages.push(replyMsg);
                        await persistWidgetMessages();
                        renderMessages();
                    });

                    cancelBtn.addEventListener("click", async () => {
                        msg.confirmAction.resolved = true;
                        msg.confirmAction.resolution = "cancelled";
                        widgetState.pendingConfirmAction = null;
                        widgetState.messages.push({
                            role: "assistant",
                            content: "Đã hủy thao tác cập nhật trạng thái công việc.",
                            suggestions: ["Xem công việc của tôi", "Tôi cần hỗ trợ khác"]
                        });
                        await persistWidgetMessages();
                        renderMessages();
                    });
                }

                actions.append(confirmBtn, cancelBtn);
                card.append(meta, actions);
                bubble.appendChild(card);
            }

            row.appendChild(bubble);
            group.appendChild(row);

            // Chỉ hiện nút gợi ý ở tin nhắn assistant cuối cùng
            const isLastMessage = index === widgetState.messages.length - 1;
            if (isLastMessage && msg.role === "assistant" && Array.isArray(msg.suggestions) && msg.suggestions.length > 0) {
                const suggBox = document.createElement("div");
                suggBox.className = "sw-suggestions";
                msg.suggestions.forEach(label => {
                    const chip = document.createElement("button");
                    chip.type = "button";
                    chip.className = "sw-chip";
                    chip.textContent = label;
                    chip.disabled = widgetState.isSending;
                    chip.addEventListener("click", () => {
                        widgetState.lastClickedSuggestion = label;
                        handleSendMessage(label);
                    });
                    suggBox.appendChild(chip);
                });
                group.appendChild(suggBox);
            }

            container.appendChild(group);
        });

        container.scrollTop = container.scrollHeight;
    }

    function appendTypingIndicator() {
        const container = widgetState.dom.messages;
        if (!container) return;
        const row = document.createElement("div");
        row.className = "sw-msg-row assistant";
        row.id = "swTypingIndicator";
        row.innerHTML = `<div class="sw-msg-bubble"><div class="sw-typing"><span></span><span></span><span></span></div></div>`;
        container.appendChild(row);
        container.scrollTop = container.scrollHeight;
    }

    async function handleSendMessage(rawText) {
        const text = String(rawText || "").trim();
        if (!text || widgetState.isSending) return;

        widgetState.isSending = true;
        if (widgetState.dom.input) widgetState.dom.input.value = "";
        if (widgetState.dom.sendBtn) widgetState.dom.sendBtn.disabled = true;

        widgetState.messages.push({ role: "user", content: text });
        if (widgetState.isFirstChat) {
            widgetState.isFirstChat = false;
            if (widgetState.dom.unreadDot) widgetState.dom.unreadDot.hidden = true;
        }
        renderMessages();
        appendTypingIndicator();

        try {
            const reply = await runAssistantTurn(text);
            document.getElementById("swTypingIndicator")?.remove();
            widgetState.messages.push({
                role: "assistant",
                content: reply.text,
                suggestions: reply.suggestions,
                ...(reply.confirmAction ? { confirmAction: reply.confirmAction } : {})
            });
            await persistWidgetMessages();
            renderMessages();
        } catch (err) {
            document.getElementById("swTypingIndicator")?.remove();
            widgetState.messages.push({
                role: "assistant",
                content: `Không thể phản hồi lúc này (${err.message || "lỗi kết nối"}). Nếu cần gấp, vui lòng liên hệ **${DEFAULT_FALLBACK_CONTACT}**.`,
                suggestions: ["Thử lại", "Trang web này làm được gì?"]
            });
            await persistWidgetMessages();
            renderMessages();
        } finally {
            widgetState.isSending = false;
            widgetState.lastClickedSuggestion = null;
            if (widgetState.dom.sendBtn) widgetState.dom.sendBtn.disabled = false;
            widgetState.dom.input?.focus();
        }
    }

    function setWidgetOpen(open) {
        widgetState.isOpen = Boolean(open);
        if (widgetState.dom.panel) {
            widgetState.dom.panel.hidden = !widgetState.isOpen;
        }
        if (widgetState.user?.id) {
            try {
                sessionStorage.setItem(getOpenKey(widgetState.user.id), widgetState.isOpen ? "1" : "0");
            } catch (_) {}
        }

        if (widgetState.isOpen) {
            if (widgetState.messages.length === 0) {
                widgetState.messages.push(buildFirstChatWelcomeMessage());
                persistWidgetMessages();
            }
            renderMessages();
            if (widgetState.dom.unreadDot) widgetState.dom.unreadDot.hidden = true;
            setTimeout(() => widgetState.dom.input?.focus(), 40);
        }
    }

    function mountWidgetDOM() {
        if (document.getElementById("aecptSupportWidget")) return;

        const root = document.createElement("div");
        root.id = "aecptSupportWidget";
        root.className = "sw-root";

        const roleTag = widgetState.user?.isLeader ? "Trưởng nhóm" : "Thành viên";
        root.innerHTML = `
            <div class="sw-panel" id="swPanel" hidden role="dialog" aria-label="Bảo mẫu AECPT">
                <header class="sw-header">
                    <div class="sw-header-brand">
                        <span class="sw-avatar"><i data-lucide="bot"></i></span>
                        <div class="sw-title-wrap">
                            <span class="sw-title">Bảo mẫu AECPT</span>
                            <span class="sw-subtitle"><span class="sw-status-dot"></span> ${escapeHTML(roleTag)} · Trực tuyến</span>
                        </div>
                    </div>
                    <div class="sw-header-actions">
                        <button type="button" class="sw-icon-btn" id="swResetBtn" title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới">
                            <i data-lucide="rotate-ccw"></i>
                        </button>
                        <button type="button" class="sw-icon-btn" id="swCloseBtn" title="Thu gọn" aria-label="Thu gọn">
                            <i data-lucide="minus"></i>
                        </button>
                    </div>
                </header>
                <div class="sw-messages" id="swMessages"></div>
                <form class="sw-composer" id="swForm">
                    <input
                        type="text"
                        class="sw-input"
                        id="swInput"
                        placeholder="Hỏi Bảo mẫu AECPT..."
                        autocomplete="off"
                        aria-label="Nhập câu hỏi cho Bảo mẫu AECPT"
                    >
                    <button type="submit" class="sw-send-btn" id="swSendBtn" aria-label="Gửi">
                        <i data-lucide="send-horizontal"></i>
                    </button>
                </form>
            </div>
            <button type="button" class="sw-launcher" id="swLauncher" aria-label="Mở trợ lý Bảo mẫu AECPT">
                <span class="sw-launcher-icon"><i data-lucide="message-circle-question"></i></span>
                <span>Bảo mẫu AECPT</span>
                <span class="sw-unread-dot" id="swUnreadDot" hidden></span>
            </button>
        `;

        document.body.appendChild(root);
        if (window.lucide) window.lucide.createIcons();

        widgetState.dom = {
            root,
            panel: root.querySelector("#swPanel"),
            messages: root.querySelector("#swMessages"),
            form: root.querySelector("#swForm"),
            input: root.querySelector("#swInput"),
            sendBtn: root.querySelector("#swSendBtn"),
            launcher: root.querySelector("#swLauncher"),
            closeBtn: root.querySelector("#swCloseBtn"),
            resetBtn: root.querySelector("#swResetBtn"),
            unreadDot: root.querySelector("#swUnreadDot")
        };

        widgetState.dom.launcher.addEventListener("click", () => {
            setWidgetOpen(!widgetState.isOpen);
        });

        widgetState.dom.closeBtn.addEventListener("click", () => {
            setWidgetOpen(false);
        });

        widgetState.dom.resetBtn.addEventListener("click", async () => {
            if (widgetState.isSending) return;
            widgetState.pendingConfirmAction = null;
            widgetState.messages = [buildFirstChatWelcomeMessage()];
            await persistWidgetMessages();
            renderMessages();
        });

        widgetState.dom.form.addEventListener("submit", event => {
            event.preventDefault();
            handleSendMessage(widgetState.dom.input.value);
        });
    }

    window.initSupportWidget = async function (user) {
        if (!user || widgetState.initialized) return;
        widgetState.initialized = true;
        widgetState.user = user;

        await loadAndTrackVisitState(user);
        const lastPendingMsg = [...widgetState.messages].reverse().find(m => m.confirmAction && !m.confirmAction.resolved);
        widgetState.pendingConfirmAction = lastPendingMsg ? lastPendingMsg.confirmAction : null;
        mountWidgetDOM();

        if (widgetState.dom.unreadDot) {
            widgetState.dom.unreadDot.hidden = !widgetState.isFirstChat;
        }

        let wasOpen = false;
        try {
            wasOpen = sessionStorage.getItem(getOpenKey(user.id)) === "1";
        } catch (_) {}

        if (wasOpen) {
            setWidgetOpen(true);
        } else if (widgetState.messages.length > 0) {
            renderMessages();
        }
    };

    window.SupportWidgetEngine = {
        executeToolCall,
        performConfirmedTaskUpdate,
        extractSuggestionsAndCleanReply,
        parseFlexibleTimestamp,
        buildDeadlineAlerts,
        buildSystemPrompt,
        getApiKey,
        getWidgetModels,
        resolveOngoingEvent,
        getState: () => widgetState
    };
})();
