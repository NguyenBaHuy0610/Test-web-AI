/**
 * AECPT - GEMINI FLASH AI SERVICE
 * Hỗ trợ Gemini 3.8 Flash cùng hệ thống Fallback thông minh (3.7 / 3.5 / 3.1-lite)
 * Giới hạn phạm vi: CHỈ CÓ QUYỀN TRUY CẬP VÀO 1 SỰ KIỆN ĐANG DIỄN RA
 * Nguyên tắc nghiêm ngặt: TUYỆT ĐỐI KHÔNG BỊA ĐẶT THÔNG TIN (ANTI-HALLUCINATION)
 */

(() => {
    "use strict";

    const STORAGE_KEY = "mediatask_gemini_api_key";
    const CONVERSATIONS_KEY = "mediatask_conversations";
    const ACTIVE_EVENT_KEY = "mediatask_active_event_id";

    // API Key được cung cấp từ APP_CONFIG hoặc do người dùng nhập
    const DEFAULT_API_KEY = (window.APP_CONFIG && window.APP_CONFIG.GEMINI_API_KEY) || "";

    // Danh sách model Flash theo thứ tự ưu tiên (hỗ trợ chuyển đổi khi gặp 429 Quota hoặc 503 Bận)
    const MODELS = [
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-flash-latest"
    ];

    class GeminiService {
        constructor() {
            this.apiKey = localStorage.getItem(STORAGE_KEY) || DEFAULT_API_KEY;
            this.currentModel = "gemini-3.8-flash";
            this.activeEventId = localStorage.getItem(ACTIVE_EVENT_KEY) || null;
            this.eventsCache = null;
        }

        getApiKey() {
            return localStorage.getItem(STORAGE_KEY) || this.apiKey || DEFAULT_API_KEY;
        }

        setApiKey(key) {
            this.apiKey = (key || "").trim();
            if (this.apiKey) {
                localStorage.setItem(STORAGE_KEY, this.apiKey);
            } else {
                localStorage.removeItem(STORAGE_KEY);
                this.apiKey = DEFAULT_API_KEY;
            }
        }

        hasApiKey() {
            return Boolean(this.getApiKey());
        }

        async requestApiKey() {
            const current = this.getApiKey();
            const key = prompt(
                "Nhập Google Gemini API Key để tùy chỉnh:\n" +
                "(Để trống sẽ dùng API Key mặc định)",
                current === DEFAULT_API_KEY ? "" : current
            );
            if (key !== null) {
                this.setApiKey(key.trim());
                return this.getApiKey();
            }
            return null;
        }

        getActiveEventId() {
            return this.activeEventId || localStorage.getItem(ACTIVE_EVENT_KEY) || null;
        }

        setActiveEventId(eventId) {
            this.activeEventId = eventId ? String(eventId).trim() : null;
            if (this.activeEventId) {
                localStorage.setItem(ACTIVE_EVENT_KEY, this.activeEventId);
            } else {
                localStorage.removeItem(ACTIVE_EVENT_KEY);
            }
        }

        /**
         * Lấy danh sách tất cả các sự kiện từ bảng events trong Supabase
         */
        async getEventsList() {
            try {
                const client = window.supabaseClient;
                if (!client) return [];

                if (this.eventsCache && this.eventsCache.length) {
                    return this.eventsCache;
                }

                const { data, error } = await client
                    .from("events")
                    .select("event_id, event_label, event_category, category_note, n_tasks, first_on_air_date, last_on_air_date, is_completed, status")
                    .order("event_id", { ascending: true });

                if (error) {
                    console.error("[Gemini] Lỗi tải danh sách sự kiện:", error);
                    return [];
                }

                this.eventsCache = data || [];
                return this.eventsCache;
            } catch (err) {
                console.warn("[Gemini] Lỗi getEventsList:", err);
                return [];
            }
        }

        /**
         * Ưu tiên sự kiện active trong workspace, sau đó dùng lựa chọn lưu cục bộ.
         */
        async getOrDetectOngoingEvent() {
            const events = await this.getEventsList();
            if (!events.length) return null;

            const availableEvents = events.filter(event => event.is_completed !== true);
            const activeEvent = availableEvents.find(event => event.status === "active");
            if (activeEvent) {
                this.setActiveEventId(activeEvent.event_id);
                return activeEvent;
            }

            const savedId = this.getActiveEventId();
            if (savedId) {
                const found = availableEvents.find(e => e.event_id === savedId);
                if (found) return found;
            }

            const today = new Date().toISOString().split("T")[0];
            const activeByDate = availableEvents.find(e => {
                if (!e.first_on_air_date || !e.last_on_air_date) return false;
                return today >= e.first_on_air_date && today <= e.last_on_air_date;
            });

            const selected = activeByDate ||
                availableEvents.find(e => e.event_id === "EVT_10") ||
                availableEvents[availableEvents.length - 1] ||
                null;
            if (selected) {
                this.setActiveEventId(selected.event_id);
            } else {
                this.setActiveEventId(null);
            }
            return selected;
        }

        /**
         * Lấy ngữ cảnh CHỈ CỦA DUY NHẤT 1 SỰ KIỆN ĐANG DIỄN RA từ Supabase
         * Tuyệt đối không lấy dữ liệu các sự kiện khác.
         */
        async getSingleEventContext(targetEventId) {
            try {
                const client = window.supabaseClient;
                if (!client) return null;

                const events = await this.getEventsList();
                const event = events.find(e => e.event_id === targetEventId) || await this.getOrDetectOngoingEvent();
                if (!event) return null;

                const eventId = event.event_id;

                // 1. Chỉ truy vấn các task thuộc đúng event_id này và chưa bị hủy
                const { data: tasks, error: tasksError } = await client
                    .from("tasks")
                    .select("task_id, task_no, task_title, task_type, submission_label, description, package_deadline_date, package_deadline_time, on_air_date, on_air_time, post_done, posted_on_main_page, status, progress")
                    .eq("event_id", eventId)
                    .neq("is_cancelled", true)
                    .order("task_no", { ascending: true });

                if (tasksError) {
                    console.error("[Gemini] Lỗi tải tasks cho event:", tasksError);
                    return null;
                }

                // 2. Lấy phân công thành viên cho các task của sự kiện này
                const taskIds = (tasks || []).map(t => t.task_id);
                let assignments = [];
                let memberMap = new Map();

                if (taskIds.length) {
                    const [assignRes, memberRes] = await Promise.all([
                        client
                            .from("task_assignments")
                            .select("task_id, role, assignment_state, member_id, is_done")
                            .in("task_id", taskIds),
                        client
                            .from("members")
                            .select("member_id, member_label")
                    ]);

                    assignments = assignRes.data || [];
                    (memberRes.data || []).forEach(m => {
                        memberMap.set(String(m.member_id), m.member_label || m.member_id);
                    });
                }

                // Nhóm phân công theo task_id
                const assignmentsByTask = new Map();
                assignments.forEach(a => {
                    if (!assignmentsByTask.has(a.task_id)) {
                        assignmentsByTask.set(a.task_id, []);
                    }
                    assignmentsByTask.get(a.task_id).push(a);
                });

                // 3. Xây dựng khối dữ liệu sự kiện chi tiết, chính xác 100%
                let text = `=== DỮ LIỆU SỰ KIỆN DUY NHẤT ĐƯỢC PHÉP TRUY CẬP ===\n`;
                text += `Mã sự kiện: ${event.event_id}\n`;
                text += `Tên sự kiện: ${event.event_label}\n`;
                text += `Thể loại: ${event.event_category || "Chưa phân loại"}\n`;
                text += `Ghi chú nội dung: ${event.category_note || "Không có"}\n`;
                text += `Thời gian On-air: Từ ${event.first_on_air_date || "Chưa rõ"} đến ${event.last_on_air_date || "Chưa rõ"}\n`;
                text += `Tổng số công việc trong sự kiện: ${tasks?.length || 0}\n\n`;

                text += `=== DANH SÁCH CHI TIẾT TỪNG CÔNG VIỆC TRONG SỰ KIỆN (${tasks?.length || 0} tasks) ===\n`;

                const roleNames = {
                    content_writer: "Content Writer",
                    designer: "Designer",
                    editor: "Video Editor",
                    photographer: "Photographer",
                    technician: "Technician"
                };

                (tasks || []).forEach((t, idx) => {
                    const deadline = t.package_deadline_date
                        ? `${t.package_deadline_date} ${t.package_deadline_time || ""}`.trim()
                        : "Chưa có deadline";
                    const onAir = t.on_air_date
                        ? `${t.on_air_date} ${t.on_air_time || ""}`.trim()
                        : "Chưa có ngày on-air";
                    const statusStr = t.post_done
                        ? "Đã hoàn thành / Đã đăng"
                        : (t.status === "completed" ? "Đã hoàn thành" : "Đang thực hiện");

                    // Phân công thành viên
                    const taskAss = (assignmentsByTask.get(t.task_id) || []).filter(a => a.assignment_state === "assigned" && a.member_id);
                    let assignText = "Chưa phân công";
                    if (taskAss.length) {
                        assignText = taskAss.map(a => {
                            const mName = memberMap.get(String(a.member_id)) || a.member_id;
                            const rName = roleNames[a.role] || a.role;
                            const doneState = a.is_done ? "Đã xong" : "Đang làm";
                            return `${rName}: ${mName} (${doneState})`;
                        }).join(", ");
                    }

                    text += `${idx + 1}. [${t.task_id}] "${t.task_title}" (Loại: ${t.task_type || "Công việc"})\n`;
                    if (t.submission_label) text += `   - Nhãn: ${t.submission_label}\n`;
                    if (t.description) text += `   - Mô tả: ${t.description.replace(/\n+/g, " ")}\n`;
                    text += `   - Hạn chót (Deadline): ${deadline}\n`;
                    text += `   - Thời gian On-air: ${onAir}\n`;
                    text += `   - Trạng thái: ${statusStr} (Tiến độ: ${t.progress || (t.post_done ? 100 : 0)}%)\n`;
                    text += `   - Thành viên phụ trách: ${assignText}\n\n`;
                });

                return {
                    event,
                    tasks: tasks || [],
                    contextText: text
                };
            } catch (err) {
                console.error("[Gemini] Lỗi getSingleEventContext:", err);
                return null;
            }
        }

        /**
         * Gửi tin nhắn đến Gemini Flash với chế độ cách ly 1 sự kiện và chống bịa đặt tuyệt đối
         */
        async sendMessage(promptText, chatHistory = [], forcedEventId = null) {
            const key = this.getApiKey();
            if (!key) {
                throw new Error("Chưa có API Key. Vui lòng kiểm tra lại cấu hình.");
            }

            const targetEventId = forcedEventId || this.getActiveEventId();
            const eventContextData = await this.getSingleEventContext(targetEventId);

            if (!eventContextData || !eventContextData.event) {
                throw new Error("Không thể tải dữ liệu của sự kiện đang diễn ra từ cơ sở dữ liệu.");
            }

            const { event, contextText } = eventContextData;
            this.setActiveEventId(event.event_id);

            // SYSTEM INSTRUCTION NGHIÊM NGẶT - CHỐNG BỊA ĐẶT THÔNG TIN & HỖ TRỢ LẬP TIMELINE
            const systemInstruction = 
                `Bạn là AECPT AI Assistant - trợ lý ảo thông minh, trung thực của ban Multimedia thuộc tổ chức AECPT.\n\n` +
                `QUYỀN HẠN VÀ PHẠM VI DỮ LIỆU BẮT BUỘC:\n` +
                `1. BẠN CHỈ CÓ QUYỀN TRUY CẬP VÀO DỮ LIỆU CỦA DUY NHẤT 1 SỰ KIỆN ĐANG DIỄN RA: "${event.event_label}" (Mã: ${event.event_id}).\n` +
                `2. BẠN TUYỆT ĐỐI KHÔNG CÓ THÔNG TIN VÀ KHÔNG ĐƯỢC PHÉP TRUY CẬP BẤT KỲ SỰ KIỆN NÀO KHÁC TRONG HỆ THỐNG.\n\n` +
                `NGUYÊN TẮC CHỐNG BỊA ĐẶT THÔNG TIN (ANTI-HALLUCINATION) - BẮT BUỘC TUÂN THỦ 100%:\n` +
                `1. CHỈ ĐƯỢC TRẢ LỜI DỰA TRÊN DỮ LIỆU ĐƯỢC CUNG CẤP DƯỚI ĐÂY. Tuyệt đối không được sử dụng kiến thức bên ngoài hay tự nghĩ ra thông tin.\n` +
                `2. TUYỆT ĐỐI KHÔNG BỊA ĐẶT, KHÔNG TỰ SUY DIỄN, KHÔNG ĐOÁN MÒ bất kỳ thông tin nào (tên công việc, ngày hạn chót/deadline, ngày on-air, người phụ trách, tiến độ, mô tả).\n` +
                `3. NẾU NGƯỜI DÙNG HỎI VỀ SỰ KIỆN KHÁC, CÔNG VIỆC KHÔNG CÓ TRONG DANH SÁCH, HOẶC THÔNG TIN KHÔNG ĐƯỢC ĐỀ CẬP:\n` +
                `   -> Bạn PHẢI TỪ CHỐI THẲNG THẮN VÀ LỊCH SỰ: "Thông tin này không có trong dữ liệu của sự kiện ${event.event_label}. Tôi chỉ có quyền truy cập vào dữ liệu của sự kiện đang diễn ra này và tuyệt đối không được cung cấp thông tin ngoài phạm vi."\n` +
                `4. Nếu trường dữ liệu ghi "Chưa phân công" hoặc không có hạn chót, phải trả lời chính xác là "Chưa phân công" hoặc "Chưa có hạn chót", KHÔNG ĐƯỢC tự bịa tên người hay ngày tháng.\n\n` +
                `TÍNH NĂNG ĐẶC BIỆT - LẬP KẾ HOẠCH & TIMELINE CHO SỰ KIỆN THEO GÓI DẠNG BẢNG:\n` +
                `Khi người dùng yêu cầu "lập timeline", "tạo timeline", "tạo kế hoạch sự kiện", gửi ngày bắt đầu/kết thúc hoặc tóm tắt sự kiện, bạn hãy hỗ trợ theo đúng quy trình chuẩn hóa sau:\n\n` +
                `1. THU THẬP THÔNG TIN TỐI GIẢN (KHÔNG ĐƯỢC HỎI RƯỜM RÀ):\n` +
                `   - Người dùng CHỈ CẦN cung cấp 3 thông tin: (1) Ngày & giờ bắt đầu, (2) Ngày & giờ kết thúc, (3) Tóm tắt nội dung / Brief sự kiện.\n` +
                `   - NẾU NGƯỜI DÙNG CHƯA ĐẶT TÊN SỰ KIỆN: Bạn hãy TỰ ĐỘNG trích xuất hoặc đề xuất một Tên sự kiện súc tích, chuyên nghiệp dựa trên tóm tắt đó mà KHÔNG ĐƯỢC hỏi lại rườm rà làm mất thời gian người dùng.\n` +
                `   - NẾU THIẾU Ngày bắt đầu, Ngày kết thúc hoặc Tóm tắt sự kiện: Chỉ hỏi lại ngắn gọn ĐÚNG phần thông tin còn thiếu.\n\n` +
                `2. QUY TẮC HIỂN THỊ DẠNG BẢNG CHO TỪNG GÓI (BẮT BUỘC TUÂN THỦ 100% - TUYỆT ĐỐI KHÔNG DÙNG DẠNG LIỆT KÊ TỪNG DÒNG VĂN BẢN):\n` +
                `   - Khi đã có thông tin thời gian và tóm tắt sự kiện, hãy LẬP TỨC GỢI Ý 2-3 GÓI CÔNG VIỆC PHÙ HỢP (ví dụ: Gói Tinh gọn, Gói Tiêu chuẩn, Gói Nâng cao/Toàn diện).\n` +
                `   - QUY TẮC BẮT BUỘC VỀ VAI TRÒ (ROLES) - TUYỆT ĐỐI KHÔNG DÙNG VAI TRÒ "MANAGER":\n` +
                `     Chỉ được phép sử dụng DUY NHẤT 5 ban chức năng của Multimedia AECPT và vai trò All:\n` +
                `       * Content (Nội dung, bài viết, kịch bản, kế hoạch truyền thông)\n` +
                `       * Design (Thiết kế đồ họa, poster, banner, visual)\n` +
                `       * Video (hoặc Edit - Quay dựng video, phóng sự, teaser, recap)\n` +
                `       * Photo (Nhiếp ảnh, chụp hình, hậu kỳ ảnh)\n` +
                `       * Tech (hoặc Technician - Kỹ thuật âm thanh, ánh sáng, livestream, setup thiết bị)\n` +
                `       * All (Toàn bộ ban phối hợp trực tiếp)\n` +
                `     TUYỆT ĐỐI CẤM SỬ DỤNG VAI TRÒ "Manager", "Quản lý", "Marketing", "Leader", "Admin" trong mọi bảng Markdown và dữ liệu JSON timeline_data!\n` +
                `     Bất kỳ công việc nào mang tính điều phối, quản lý tiến độ, xây dựng chiến lược, nghiên cứu, quản lý KOL/KOC, liên hệ đối tác, hoặc báo cáo tài chính/tổng kết, BẮT BUỘC phân bổ cho vai trò "Content" hoặc "All", TUYỆT ĐỐI KHÔNG TỰ BỊA RA VAI TRÒ "Manager"!\n` +
                `     KHI NGƯỜI DÙNG YÊU CẦU ĐIỀU CHỈNH / ĐỔI TASK / THAY ĐỔI CÔNG VIỆC: Tuyệt đối giữ đúng quy tắc trên, không bao giờ được thêm role Manager vào bất kỳ task nào!\n` +
                `   - MỖI GÓI BẮT BUỘC PHẢI TRÌNH BÀY DƯỚI DẠNG BẢNG MARKDOWN ĐẦY ĐỦ VỚI ĐÚNG 7 CỘT SAU:\n` +
                `     | STT | Tên công việc | Vai trò | Thời lượng | Phụ thuộc | Độ phức tạp | Ghi chú (Trực tiếp/Online) |\n` +
                `     |:---:|:---|:---|:---:|:---:|:---:|:---|\n` +
                `   - Bảng ví dụ minh họa:\n` +
                `     | 1 | Nghiên cứu & Chọn mẫu đồ chơi | Content | 4h | Không | 2 | Online |\n` +
                `     | 2 | Thiết kế Poster & Banner | Design | 8h | Task 1 | 2 | Online |\n` +
                `     | 3 | Sản xuất Video hướng dẫn | Video, Content | 12h | Task 1 | 3 | Online |\n` +
                `     | 4 | Chuẩn bị nguyên liệu & Không gian | Technician | 6h | Task 1 | 2 | Online |\n` +
                `     | 5 | Tổ chức Workshop & Trải nghiệm | All | 4h | Task 2, Task 3, Task 4 | 3 | Trực tiếp tại sự kiện |\n` +
                `     | 6 | Hậu kỳ ảnh & Báo cáo tổng kết | Content, Design, Video | 6h | Task 5 | 2 | Online |\n` +
                `   - Dưới mỗi bảng của từng gói, ghi rõ: Tổng thời lượng dự kiến, Số lượng công việc, Ưu điểm chính của gói.\n` +
                `   - Cuối tin nhắn: Mời người dùng chọn gói bằng cách trả lời nhanh (ví dụ: "Bạn muốn chọn Gói nào (Gói Tinh gọn, Gói Tiêu chuẩn hay Gói Nâng cao)? Hoặc bạn có muốn điều chỉnh công việc nào trong bảng không?").\n\n` +
                `3. KHI NGƯỜI DÙNG CHỌN GÓI HOẶC ĐỒNG Ý ("Gói Tiêu chuẩn", "Gói 2", "OK", "Xác nhận"...):\n` +
                `   - Nếu người dùng đồng ý với bảng thông số của gói, XUẤT NGAY khối JSON định dạng \`\`\`timeline_data ... \`\`\` ở cuối tin nhắn để kích hoạt thuật toán CPM lập timeline.\n` +
                `   - Nếu cần xác nhận lại chi tiết kỹ thuật cho các task, CŨNG BẮT BUỘC DÙNG BẢNG MARKDOWN 7 CỘT NHƯ TRÊN ĐỂ NGƯỜI DÙNG KIỂM TRA, TUYỆT ĐỐI KHÔNG DÙNG DẠNG LIỆT KÊ VĂN BẢN TỪNG DÒNG DÀI DÒNG!\n\n` +
                `4. CẤU TRÚC KHỐI \`\`\`timeline_data ... \`\`\` BẮT BUỘC:\n` +
                `\`\`\`timeline_data\n` +
                `{\n` +
                `  "event_label": "Tên sự kiện",\n` +
                `  "event_start": "YYYY-MM-DD HH:MM:SS",\n` +
                `  "event_end": "YYYY-MM-DD HH:MM:SS",\n` +
                `  "category_note": "Mô tả sự kiện",\n` +
                `  "tasks": [\n` +
                `    { "id": "T1", "name": "Nghiên cứu & Chọn mẫu", "duration": 4, "roles": ["content"], "depends_on": [], "complexity": 2, "start": "creation" },\n` +
                `    { "id": "T2", "name": "Thiết kế Poster", "duration": 8, "roles": ["design"], "depends_on": ["T1"], "complexity": 2, "start": "creation" },\n` +
                `    { "id": "T3", "name": "Tổ chức Workshop", "duration": 4, "roles": ["content", "design", "video", "technician"], "depends_on": ["T2"], "complexity": 3, "start": "event" }\n` +
                `  ]\n` +
                `}\n` +
                `\`\`\`\n` +
                `Hệ thống website sẽ tự động đọc khối dữ liệu này và kích hoạt thuật toán đường găng CPM, phân công thành viên và hiển thị nút Lưu vào Supabase cho người dùng.\n\n` +
                `QUY TẮC ĐÁNH SỐ THỨ TỰ TASK VÀ CHÈN CÔNG VIỆC VÀO GIỮA (BẮT BUỘC TUÂN THỦ 100%):\n` +
                `1. SỐ THỨ TỰ LUÔN LÀ SỐ NGUYÊN TĂNG DẦN LIÊN TỤC: Các công việc trong kế hoạch PHẢI LUÔN được đánh số theo số nguyên dương liên tục: 1, 2, 3, 4, 5... Trong JSON timeline_data, mã id PHẢI LUÔN là "T1", "T2", "T3", "T4"... tương ứng với số thứ tự.\n` +
                `2. TUYỆT ĐỐI CẤM SỐ THỨ TỰ THẬP PHÂN HAY NHÁNH CON: KHÔNG ĐƯỢC dùng bất kỳ số thập phân hay nhánh con nào như 1.1, 1.2, 2.1, T1.1, T1.2, Task 1.1... trong cả lời nói lẫn dữ liệu JSON.\n` +
                `3. KHI NGƯỜI DÙNG YÊU CẦU THÊM/CHÈN MỘT CÔNG VIỆC MỚI VÀO GIỮA KẾ HOẠCH (ví dụ: "thêm một task vào giữa task 1 và task 2", hoặc "chèn task kiểm duyệt sau task 1"):\n` +
                `   - Vị trí chèn mới sẽ nhận số thứ tự ngay tại vị trí đó (ví dụ chèn vào giữa task 1 và task 2 cũ -> task mới trở thành "Task 2" với id "T2").\n` +
                `   - TOÀN BỘ CÁC TASK PHÍA SAU PHẢI TỰ ĐỘNG TỊNH TIẾN SỐ THỨ TỰ TĂNG DẦN: Task 2 cũ trở thành "Task 3" (id "T3"), Task 3 cũ trở thành "Task 4" (id "T4"), và tiếp tục tịnh tiến cho tất cả các task sau đó.\n` +
                `   - CẬP NHẬT LẠI MẢNG "depends_on" TƯƠNG ỨNG:\n` +
                `     * Tự động tịnh tiến các mã ID phụ thuộc cũ: Bất kỳ task nào trước đó phụ thuộc vào Task 2 cũ (["T2"]) thì nay PHẢI chuyển thành phụ thuộc vào Task 3 mới (["T3"]).\n` +
                `     * Task mới chèn vào ("T2") cần được phân tích phụ thuộc logic phù hợp (ví dụ: phụ thuộc vào ["T1"], và nếu task 3 cần task 2 hoàn thành trước thì task 3 có depends_on chứa ["T2"]).\n` +
                `   - TRÌNH BÀY TRONG TIN NHẮN: Khi giải thích hoặc liệt kê danh sách sau khi chèn, luôn dùng số nguyên tăng dần liên tục:\n` +
                `     * Task 1: [Tên task 1]\n` +
                `     * Task 2 (mới): [Tên task mới được chèn]\n` +
                `     * Task 3: [Tên task 2 cũ đã tịnh tiến số thứ tự]\n` +
                `     * Task 4: [Tên task 3 cũ đã tịnh tiến số thứ tự]...\n\n` +
                `Trả lời bằng tiếng Việt, thân thiện, chuyên nghiệp.\n\n` +
                `${contextText}`;

            // Chuẩn bị payload contents
            const contents = [];

            // Lấy tối đa 6 tin nhắn gần nhất trong lịch sử hội thoại để duy trì ngữ cảnh
            const recentHistory = chatHistory.slice(-6);
            recentHistory.forEach(msg => {
                if (!msg.content) return;
                contents.push({
                    role: msg.role === "assistant" ? "model" : "user",
                    parts: [{ text: msg.content }]
                });
            });

            // Tin nhắn hiện tại của người dùng
            contents.push({
                role: "user",
                parts: [{ text: promptText }]
            });

            // Hạ temperature xuống 0.1 để triệt tiêu tính bịa đặt (hallucination) và đảm bảo tính chính xác factual
            const payload = {
                contents,
                systemInstruction: {
                    parts: [{ text: systemInstruction }]
                },
                generationConfig: {
                    temperature: 0.1,
                    topP: 0.8,
                    maxOutputTokens: 2048
                }
            };

            // Thử lần lượt với các model trong danh sách ưu tiên khi gặp 429 hoặc 503
            let lastError = null;
            for (const model of MODELS) {
                try {
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
                    const response = await fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        const errMsg = errorData.error?.message || `HTTP ${response.status}`;

                        if (response.status === 400 && errMsg.includes("API key not valid")) {
                            throw new Error("Gemini API Key không hợp lệ. Vui lòng kiểm tra lại key của bạn.");
                        }

                        // Nếu model chạm quota (429), quá tải (503) hoặc deprecated (404), tự động fallback sang model tiếp theo
                        if (response.status === 404 || response.status === 503 || response.status === 429 ||
                            errMsg.toLowerCase().includes("not found") ||
                            errMsg.toLowerCase().includes("high demand") ||
                            errMsg.toLowerCase().includes("quota exceeded") ||
                            errMsg.toLowerCase().includes("resource_exhausted")) {
                            console.warn(`[Gemini] Model ${model} không sẵn sàng (${response.status} - ${errMsg.slice(0, 80)}...), tự động chuyển model tiếp theo...`);
                            lastError = new Error(`Model ${model}: ${errMsg}`);
                            continue;
                        }

                        throw new Error(`Lỗi Gemini API (${model}): ${errMsg}`);
                    }

                    const data = await response.json();
                    const candidate = data.candidates?.[0];
                    const replyText = candidate?.content?.parts?.map(p => p.text).join("") || "Không nhận được phản hồi từ AI.";

                    this.currentModel = model;
                    return {
                        reply: replyText,
                        model,
                        event
                    };
                } catch (err) {
                    lastError = err;
                    if (err.message.includes("API Key không hợp lệ")) {
                        throw err;
                    }
                }
            }

            throw lastError || new Error("Không thể kết nối đến Gemini Flash API. Tất cả model hiện đang bận.");
        }

        // Quản lý lưu lịch sử chat vào localStorage
        getSavedConversations() {
            try {
                return JSON.parse(localStorage.getItem(CONVERSATIONS_KEY) || "[]");
            } catch {
                return [];
            }
        }

        saveConversation(conversation) {
            try {
                const list = this.getSavedConversations();
                const existingIndex = list.findIndex(c => c.id === conversation.id);
                if (existingIndex >= 0) {
                    list[existingIndex] = conversation;
                } else {
                    list.unshift(conversation);
                }
                localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(list.slice(0, 10)));
            } catch (err) {
                console.warn("[Gemini] Không lưu được lịch sử chat:", err);
            }
        }
    }

    window.GeminiService = new GeminiService();
})();
