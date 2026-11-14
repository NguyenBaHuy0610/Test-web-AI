/**
 * AECPT - GROQ AI SERVICE
 * Tích hợp Groq API siêu tốc (Llama 3.3 70B, Qwen 2.5 32B, GPT-OSS)
 * Giới hạn phạm vi: CHỈ CÓ QUYỀN TRUY CẬP VÀO 1 SỰ KIỆN ĐANG DIỄN RA
 * Nguyên tắc nghiêm ngặt: TUYỆT ĐỐI KHÔNG BỊA ĐẶT THÔNG TIN (ANTI-HALLUCINATION)
 */

(() => {
    "use strict";

    const STORAGE_KEY = "mediatask_groq_api_key";
    const CONVERSATIONS_KEY = "mediatask_conversations";
    const ACTIVE_EVENT_KEY = "mediatask_active_event_id";
    const WORKING_MODEL_KEY = "mediatask_groq_working_model";

    // API Key mặc định đọc từ .env thông qua /config.js (do server local hoặc Vercel sinh ra), fallback sang localStorage hoặc rỗng.
    const DEFAULT_API_KEY = (window.APP_CONFIG && window.APP_CONFIG.GROQ_API_KEY) || "";

    // Danh sách model Groq theo thứ tự ưu tiên (ưu tiên các model khả dụng và phản hồi siêu nhanh)
    const MODELS = [
        "qwen/qwen3.8-27b",
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "allam-2-7b",
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant"
    ];

    // Danh sách model Groq hỗ trợ nhận diện hình ảnh (Vision multimodal)
    const VISION_MODELS = [
        "qwen/qwen3.8-27b",
        "meta-llama/llama-4-scout-17b-16e-instruct"
    ];

    const MAX_HISTORY_DOC_CHARS = 8000;
    const MAX_CURRENT_DOC_BUDGET = 36000;

    function formatHistoryMessageText(msg) {
        let text = typeof msg?.content === "string" ? msg.content.trim() : "";
        const atts = Array.isArray(msg?.attachments) ? msg.attachments : [];
        if (atts.length === 0) return text;

        const attNotes = atts.map(att => {
            if (att.kind === "image") {
                return `[Đã đính kèm hình ảnh: ${att.name || "image"}]`;
            }
            if (att.extractedText) {
                const snippet = att.extractedText.slice(0, MAX_HISTORY_DOC_CHARS);
                const truncatedNote = att.extractedText.length > MAX_HISTORY_DOC_CHARS ? "\n[... Đã rút gọn trong lịch sử hội thoại ...]" : "";
                return `[Tệp đính kèm: ${att.name}]\n${snippet}${truncatedNote}`;
            }
            return `[Đã đính kèm tệp: ${att.name}]`;
        });

        return [text, ...attNotes].filter(Boolean).join("\n\n");
    }

    class GroqService {
        constructor() {
            this.apiKey = localStorage.getItem(STORAGE_KEY) || DEFAULT_API_KEY;
            this.currentModel = localStorage.getItem(WORKING_MODEL_KEY) || "qwen/qwen3.8-27b";
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
                "Nhập Groq API Key để tùy chỉnh:\n" +
                "(Để trống sẽ dùng API Key mặc định)",
                current === DEFAULT_API_KEY ? "" : current
            );
            if (key !== null) {
                this.setApiKey(key.trim());
                return this.getApiKey();
            }
            return null;
        }

        getActiveEventId(userId) {
            const uid = userId || window.appUser?.id;
            const userKey = uid ? `mediatask_active_event_id_${uid}` : null;
            return (userKey && localStorage.getItem(userKey)) || this.activeEventId || localStorage.getItem(ACTIVE_EVENT_KEY) || null;
        }

        setActiveEventId(eventId, userId) {
            const uid = userId || window.appUser?.id;
            this.activeEventId = eventId ? String(eventId).trim() : null;
            if (this.activeEventId) {
                localStorage.setItem(ACTIVE_EVENT_KEY, this.activeEventId);
                if (uid) localStorage.setItem(`mediatask_active_event_id_${uid}`, this.activeEventId);
            } else {
                localStorage.removeItem(ACTIVE_EVENT_KEY);
                if (uid) localStorage.removeItem(`mediatask_active_event_id_${uid}`);
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

                let query = client
                    .from("events")
                    .select("event_id, event_label, event_category, category_note, n_tasks, first_on_air_date, last_on_air_date, is_completed, workspace_id")
                    .order("event_id", { ascending: true });

                const wsId = window.appUser?.workspaceId;
                if (wsId) {
                    query = query.eq("workspace_id", wsId);
                }

                const { data, error } = await query;

                if (error) {
                    console.error("[Groq] Lỗi tải danh sách sự kiện:", error);
                    return [];
                }

                this.eventsCache = data || [];
                return this.eventsCache;
            } catch (err) {
                console.warn("[Groq] Lỗi getEventsList:", err);
                return [];
            }
        }

        /**
         * Xác định DUY NHẤT 1 sự kiện đang diễn ra mà tài khoản đang tham gia.
         * Quy tắc bắt buộc: Mỗi tài khoản chỉ tham gia 1 sự kiện đang diễn ra kể cả trưởng nhóm.
         * Tuyệt đối không dùng dữ liệu sự kiện đã hoàn thành (is_completed = true).
         */
        async getOrDetectOngoingEvent(currentUser) {
            const user = currentUser || window.appUser;
            const events = await this.getEventsList();
            if (!events.length) return null;

            const availableEvents = events.filter(event => event.is_completed !== true);
            if (!availableEvents.length) {
                this.setActiveEventId(null, user?.id);
                return null;
            }

            const activeEventIds = new Set(availableEvents.map(e => String(e.event_id)));
            const client = window.supabaseClient;

            // 1. Nếu tài khoản có member_id, tìm sự kiện đang diễn ra mà member có phân công
            const memberId = user?.memberId;
            if (memberId && client) {
                try {
                    const { data: assignments, error: aErr } = await client
                        .from("task_assignments")
                        .select("task_id")
                        .eq("member_id", memberId);

                    if (!aErr && Array.isArray(assignments) && assignments.length > 0) {
                        const assignedTaskIds = assignments.map(a => a.task_id).filter(Boolean);
                        if (assignedTaskIds.length > 0) {
                            const { data: assignedTasks, error: tErr } = await client
                                .from("tasks")
                                .select("event_id")
                                .in("task_id", assignedTaskIds);

                            if (!tErr && Array.isArray(assignedTasks)) {
                                for (const t of assignedTasks) {
                                    if (t.event_id && activeEventIds.has(String(t.event_id))) {
                                        const matched = availableEvents.find(e => String(e.event_id) === String(t.event_id));
                                        if (matched) {
                                            this.setActiveEventId(matched.event_id, user?.id);
                                            return matched;
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.warn("[Groq] Lỗi kiểm tra task_assignments của member:", err);
                }
            }

            // 2. Kiểm tra sự kiện đang chọn đã lưu cho tài khoản này (hoặc Trưởng nhóm vừa chọn/tạo)
            const savedId = this.getActiveEventId(user?.id);
            if (savedId && activeEventIds.has(String(savedId))) {
                const found = availableEvents.find(e => e.event_id === savedId);
                if (found) {
                    this.setActiveEventId(found.event_id, user?.id);
                    return found;
                }
            }

            // 3. Fallback: Lấy sự kiện chưa hoàn thành gần nhất
            const selected = availableEvents[availableEvents.length - 1] || null;
            if (selected) {
                this.setActiveEventId(selected.event_id, user?.id);
            } else {
                this.setActiveEventId(null, user?.id);
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

                let event = null;
                if (targetEventId) {
                    const { data, error } = await client
                        .from("events")
                        .select("*")
                        .eq("event_id", targetEventId)
                        .maybeSingle();

                    if (error || !data || data.is_completed === true) {
                        return null;
                    }
                    const userWsId = window.appUser?.workspaceId;
                    if (userWsId && data.workspace_id && data.workspace_id !== userWsId) {
                        return null;
                    }
                    event = data;
                } else {
                    event = await this.getOrDetectOngoingEvent();
                }

                if (!event || event.is_completed === true) return null;

                const { data: tasks, error: tasksError } = await client
                    .from("tasks")
                    .select(`
                        task_id,
                        task_title,
                        task_type,
                        submission_label,
                        description,
                        package_deadline_date,
                        package_deadline_time,
                        on_air_date,
                        on_air_time,
                        post_done,
                        progress,
                        task_assignments (
                            role,
                            member_id,
                            assignment_state,
                            is_done,
                            members (
                                member_label,
                                department
                            )
                        )
                    `)
                    .eq("event_id", event.event_id)
                    .order("task_id", { ascending: true });

                if (tasksError) {
                    console.error("[Groq] Lỗi tải tasks cho event:", tasksError);
                }

                let text = `=== DỮ LIỆU SỰ KIỆN ĐANG DIỄN RA DUY NHẤT ===\n`;
                text += `Mã sự kiện: ${event.event_id}\n`;
                text += `Tên sự kiện: ${event.event_label}\n`;
                text += `Phân loại sự kiện: ${event.event_category || "Chưa phân loại"}\n`;
                if (event.category_note) text += `Ghi chú sự kiện: ${event.category_note}\n`;
                text += `Ngày bắt đầu On-air: ${event.first_on_air_date || "Chưa rõ"}\n`;
                text += `Ngày kết thúc On-air: ${event.last_on_air_date || "Chưa rõ"}\n`;
                text += `Tổng số công việc: ${tasks ? tasks.length : event.n_tasks || 0}\n\n`;

                text += `=== DANH SÁCH CÁC CÔNG VIỆC THUỘC SỰ KIỆN NÀY ===\n`;
                if (!tasks || tasks.length === 0) {
                    text += `(Hiện chưa có công việc nào được tạo trong sự kiện này)\n`;
                }

                (tasks || []).forEach((t, idx) => {
                    const deadline = t.package_deadline_date ? `${t.package_deadline_date} ${t.package_deadline_time || ""}`.trim() : "Chưa có hạn chót";
                    const onAir = t.on_air_date ? `${t.on_air_date} ${t.on_air_time || ""}`.trim() : "Chưa rõ";
                    const statusStr = t.post_done ? "Đã hoàn thành" : "Đang thực hiện";

                    const assignments = t.task_assignments || [];
                    let assignText = "Chưa phân công";
                    if (assignments.length > 0) {
                        assignText = assignments.map(a => {
                            const name = a.members?.member_label || a.member_id;
                            const role = a.role ? ` (${a.role})` : "";
                            return `${name}${role}`;
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
                console.error("[Groq] Lỗi getSingleEventContext:", err);
                return null;
            }
        }

        /**
         * Gửi tin nhắn (kèm tệp tài liệu / hình ảnh nếu có) đến Groq API
         */
        async sendMessage(promptText, chatHistory = [], forcedEventId = null, attachments = []) {
            const key = this.getApiKey();
            if (!key) {
                throw new Error("Chưa có Groq API Key. Vui lòng kiểm tra lại cấu hình.");
            }

            const targetEventId = forcedEventId || this.getActiveEventId();
            const eventContextData = await this.getSingleEventContext(targetEventId);

            if (!eventContextData || !eventContextData.event) {
                throw new Error("Hiện tại tài khoản của bạn chưa tham gia sự kiện nào đang diễn ra. Groq AI chỉ có quyền truy cập vào sự kiện đang diễn ra mà bạn tham gia.");
            }

            const { event, contextText } = eventContextData;
            this.setActiveEventId(event.event_id);

            const validAttachments = Array.isArray(attachments)
                ? attachments.filter(att => att && att.status !== "error")
                : [];
            const docAttachments = validAttachments.filter(att => att.kind !== "image" && att.extractedText);
            const imageAttachments = validAttachments.filter(att => att.kind === "image" && (att.imageDataUrl || att.thumbnailUrl));

            // SYSTEM INSTRUCTION NGHIÊM NGẶT - CHỐNG BỊA ĐẶT THÔNG TIN, HỖ TRỢ ĐỌC FILE & LẬP TIMELINE
            const systemInstruction = 
                `Bạn là AECPT AI Assistant - trợ lý ảo thông minh, trung thực của ban Multimedia thuộc tổ chức AECPT, chạy trên nền tảng Groq siêu tốc.\n\n` +
                `QUYỀN HẠN VÀ PHẠM VI DỮ LIỆU BẮT BUỘC:\n` +
                `1. BẠN CHỈ CÓ QUYỀN TRUY CẬP VÀO DỮ LIỆU HỆ THỐNG CỦA DUY NHẤT 1 SỰ KIỆN ĐANG DIỄN RA MÀ TÀI KHOẢN NÀY ĐANG THAM GIA: "${event.event_label}" (Mã: ${event.event_id}).\n` +
                `2. MỖI TÀI KHOẢN CHỈ THAM GIA 1 SỰ KIỆN ĐANG DIỄN RA KỂ CẢ TRƯỞNG NHÓM.\n` +
                `3. BẠN TUYỆT ĐỐI KHÔNG CÓ THÔNG TIN VÀ KHÔNG ĐƯỢC PHÉP TRUY CẬP HAY TIẾT LỘ BẤT KỲ SỰ KIỆN NÀO KHÁC TRONG HỆ THỐNG (ĐẶC BIỆT LÀ CÁC SỰ KIỆN ĐÃ HOÀN THÀNH HOẶC CỦA BAN KHÁC).\n\n` +
                `QUYỀN ĐỌC TỆP & HÌNH ẢNH ĐÍNH KÈM CỦA NGƯỜI DÙNG:\n` +
                `- Người dùng có thể đính kèm tệp tài liệu (.docx, .pdf, .xlsx, .xls, .csv, .txt, .md, .json) hoặc hình ảnh trong tin nhắn.\n` +
                `- Nội dung trích xuất từ tệp hoặc hình ảnh đính kèm LÀ DỮ LIỆU HỢP LỆ để bạn đọc, tóm tắt, giải đáp câu hỏi, đối chiếu với công việc/thành viên hoặc chuyển hóa thành kế hoạch Timeline.\n` +
                `- Nếu người dùng muốn lập kế hoạch/Timeline từ nội dung tệp phân công đính kèm và đã đủ thông tin (tên sự kiện, thời gian bắt đầu/kết thúc, danh sách task), hãy xuất kèm khối \`\`\`timeline_data ... \`\`\` chuẩn xác theo dữ liệu trong tệp.\n\n` +
                `NGUYÊN TẮC CHỐNG BỊA ĐẶT THÔNG TIN (ANTI-HALLUCINATION) - BẮT BUỘC TUÂN THỦ 100%:\n` +
                `1. CHỈ ĐƯỢC TRẢ LỜI DỰA TRÊN DỮ LIỆU SỰ KIỆN ĐƯỢC CUNG CẤP DƯỚI ĐÂY VÀ NỘI DUNG TỆP/HÌNH ẢNH NGƯỜI DÙNG ĐÍNH KÈM. Tuyệt đối không tự bịa thêm dữ kiện không có trong tài liệu hay hệ thống.\n` +
                `2. TUYỆT ĐỐI KHÔNG BỊA ĐẶT, KHÔNG TỰ SUY DIỄN, KHÔNG ĐOÁN MÒ bất kỳ thông tin nào (tên công việc, ngày hạn chót/deadline, ngày on-air, người phụ trách, tiến độ, mô tả).\n` +
                `3. NẾU NGƯỜI DÙNG HỎI VỀ SỰ KIỆN KHÁC TRONG HỆ THỐNG HOẶC THÔNG TIN KHÔNG CÓ CẢ TRONG SỰ KIỆN HIỆN TẠI LẪN TỆP ĐÍNH KÈM:\n` +
                `   -> Bạn PHẢI TỪ CHỐI THẲNG THẮN VÀ LỊCH SỰ: "Thông tin này không có trong dữ liệu của sự kiện ${event.event_label} hay tài liệu bạn đã cung cấp. Tôi chỉ được phép trả lời dựa trên dữ liệu sự kiện đang diễn ra này và tệp đính kèm của bạn."\n` +
                `4. Nếu trường dữ liệu ghi "Chưa phân công" hoặc không có hạn chót, phải trả lời chính xác là "Chưa phân công" hoặc "Chưa có hạn chót", KHÔNG ĐƯỢC tự bịa tên người hay ngày tháng.\n\n` +
                `TÍNH NĂNG ĐẶC BIỆT - LẬP KẾ HOẠCH & TIMELINE CHO SỰ KIỆN:\n` +
                `Khi người dùng yêu cầu "lập timeline", "tạo timeline", "tạo kế hoạch sự kiện" hoặc bắt đầu một kế hoạch mới, bạn hãy hỗ trợ theo đúng quy trình sau:\n` +
                `- Bước 1: Nếu chưa có thông tin sự kiện (cả trong prompt lẫn tệp đính kèm), hãy hỏi người dùng: (1) Tên sự kiện, (2) Ngày & giờ bắt đầu sự kiện, (3) Ngày & giờ kết thúc sự kiện, (4) Brief / tóm tắt nội dung sự kiện.\n` +
                `- Bước 2: Khi đã có thông tin sự kiện, hãy tự động gợi ý 2-3 gói danh sách task phù hợp (mỗi gói có >= 1 task, ví dụ Gói Tiêu chuẩn, Gói Tinh gọn) gồm các việc: Viết content, Thiết kế poster/standee, Quay clip, Chụp ảnh sự kiện... để người dùng tham khảo và lựa chọn (hoặc dùng thẳng danh sách task trong tệp phân công nếu người dùng đã đính kèm).\n` +
                `- Bước 3: Sau khi người dùng chọn hoặc điều chỉnh các task, hãy xác nhận thông tin các task để chạy thuật toán: thời lượng (duration: số giờ hoặc ví dụ 2d = 48h), vai trò (roles: content, design, photo, video, technician), công việc phụ thuộc (depends_on), độ phức tạp (1-3), và việc có phải diễn ra trực tiếp tại sự kiện không (live/event). ĐIỀU KIỆN TIÊN QUYẾT: Phải có ít nhất 1 task mới được lập timeline.\n` +
                `- Bước 4: Khi đã có đủ thông tin, hãy tóm tắt kế hoạch và đính kèm một khối JSON định dạng \`\`\`timeline_data ... \`\`\` ở cuối tin nhắn với cấu trúc:\n` +
                `\`\`\`timeline_data\n` +
                `{\n` +
                `  "event_label": "Tên sự kiện",\n` +
                `  "event_start": "YYYY-MM-DD HH:MM:SS",\n` +
                `  "event_end": "YYYY-MM-DD HH:MM:SS",\n` +
                `  "category_note": "Mô tả sự kiện",\n` +
                `  "tasks": [\n` +
                `    { "id": "T1", "name": "Viết caption", "duration": 2, "roles": ["content"], "depends_on": [], "complexity": 1, "start": "creation" },\n` +
                `    { "id": "T2", "name": "Thiết kế standee", "duration": 48, "roles": ["design"], "depends_on": [], "complexity": 3, "start": "creation" },\n` +
                `    { "id": "T3", "name": "Chụp ảnh sự kiện", "duration": 4, "roles": ["photo"], "depends_on": [], "complexity": 2, "start": "event" }\n` +
                `  ]\n` +
                `}\n` +
                `\`\`\`\n` +
                `Hệ thống website sẽ tự động đọc khối dữ liệu này và kích hoạt thuật toán đường găng CPM, phân công thành viên và hiển thị nút Lưu vào Supabase cho người dùng.\n\n` +
                `Trả lời bằng tiếng Việt, thân thiện, chuyên nghiệp.\n\n` +
                `${contextText}`;

            // Chuẩn bị danh sách tin nhắn theo chuẩn OpenAI
            const messages = [
                { role: "system", content: systemInstruction }
            ];

            // Lấy tối đa 6 tin nhắn gần nhất trong lịch sử hội thoại để duy trì ngữ cảnh (dạng text thuần để mọi model đều nhận)
            const recentHistory = chatHistory.slice(-6);
            recentHistory.forEach(msg => {
                const formattedText = formatHistoryMessageText(msg);
                if (!formattedText) return;
                messages.push({
                    role: msg.role === "assistant" ? "assistant" : "user",
                    content: formattedText
                });
            });

            // Tin nhắn hiện tại của người dùng (gộp prompt + nội dung tệp trích xuất + ảnh nếu có)
            let userTextPayload = (promptText || "").trim();
            if (!userTextPayload && validAttachments.length > 0) {
                userTextPayload = "Hãy đọc, tóm tắt và phân tích chi tiết các tệp/hình ảnh đính kèm dưới đây (nếu là bảng phân công hoặc kế hoạch sự kiện, hãy liệt kê rõ các đầu việc, người phụ trách và hỏi xem người dùng có muốn lập Timeline không).";
            }

            if (docAttachments.length > 0) {
                let remainingBudget = MAX_CURRENT_DOC_BUDGET;
                const docBlocks = docAttachments.map((att, idx) => {
                    const snippet = remainingBudget > 0 ? att.extractedText.slice(0, remainingBudget) : "";
                    remainingBudget = Math.max(0, remainingBudget - snippet.length);
                    return `=== NỘI DUNG TỆP ĐÍNH KÈM ${idx + 1}: ${att.name} ===\n` +
                        (snippet || "(Không thể đưa thêm nội dung do vượt giới hạn dung lượng văn bản trong 1 lượt)");
                });
                userTextPayload += `\n\n${docBlocks.join("\n\n")}`;
            }

            if (imageAttachments.length > 0) {
                const contentParts = [{ type: "text", text: userTextPayload }];
                imageAttachments.forEach(img => {
                    contentParts.push({
                        type: "image_url",
                        image_url: { url: img.imageDataUrl || img.thumbnailUrl }
                    });
                });
                messages.push({
                    role: "user",
                    content: contentParts
                });
            } else {
                messages.push({
                    role: "user",
                    content: userTextPayload
                });
            }

            // Chọn danh sách model phù hợp: bắt buộc dùng VISION_MODELS nếu có hình ảnh
            let prioritizedModels;
            if (imageAttachments.length > 0) {
                prioritizedModels = [...VISION_MODELS];
            } else {
                const savedWorkingModel = localStorage.getItem(WORKING_MODEL_KEY);
                prioritizedModels = [...MODELS];
                if (savedWorkingModel && prioritizedModels.includes(savedWorkingModel)) {
                    prioritizedModels.splice(prioritizedModels.indexOf(savedWorkingModel), 1);
                    prioritizedModels.unshift(savedWorkingModel);
                }
            }

            const timeoutMs = validAttachments.length > 0 ? 25000 : 12000;
            let lastError = null;

            for (const model of prioritizedModels) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

                try {
                    const payload = {
                        model: model,
                        messages: messages,
                        temperature: 0.1,
                        max_tokens: 3072
                    };

                    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${key}`
                        },
                        body: JSON.stringify(payload),
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        const errMsg = errorData.error?.message || `HTTP ${response.status}`;

                        if (response.status === 401 || errMsg.toLowerCase().includes("invalid api key")) {
                            throw new Error("Groq API Key không hợp lệ. Vui lòng kiểm tra lại key của bạn.");
                        }

                        console.warn(`[Groq] Model ${model} không khả dụng (${response.status} - ${errMsg.slice(0, 80)}), chuyển model tiếp theo...`);
                        lastError = new Error(`Model ${model}: ${errMsg}`);
                        continue;
                    }

                    const data = await response.json();
                    const choice = data.choices?.[0];
                    const replyText = choice?.message?.content || choice?.message?.reasoning || "Không nhận được phản hồi từ AI.";

                    this.currentModel = model;
                    if (imageAttachments.length === 0) {
                        localStorage.setItem(WORKING_MODEL_KEY, model);
                    }
                    return {
                        reply: replyText,
                        model,
                        event
                    };
                } catch (err) {
                    clearTimeout(timeoutId);
                    if (err.name === "AbortError") {
                        console.warn(`[Groq] Model ${model} quá thời gian phản hồi (timeout ${timeoutMs / 1000}s), chuyển sang model tiếp theo...`);
                        lastError = new Error(`Model ${model} quá thời gian chờ (timeout)`);
                    } else if (err.message && err.message.includes("API Key không hợp lệ")) {
                        throw err;
                    } else {
                        console.warn(`[Groq] Lỗi gọi model ${model}:`, err.message);
                        lastError = err;
                    }
                }
            }

            if (imageAttachments.length > 0) {
                throw lastError || new Error("Không có model Groq Vision khả dụng để đọc hình ảnh lúc này.");
            }
            throw lastError || new Error("Không thể kết nối đến Groq API. Vui lòng thử lại sau giây lát.");
        }

        // Quản lý lưu lịch sử chat đồng bộ theo tài khoản (Supabase + cache local theo user_id)
        getSavedConversations(userIdOverride) {
            const userId = userIdOverride || window.appUser?.id || null;
            if (window.ChatHistoryStore) {
                return window.ChatHistoryStore.getLocalConversations(userId);
            }
            if (!userId) return [];
            try {
                return JSON.parse(localStorage.getItem(`${CONVERSATIONS_KEY}_${userId}`) || "[]");
            } catch {
                return [];
            }
        }

        async syncConversations(userIdOverride) {
            if (window.ChatHistoryStore) {
                return window.ChatHistoryStore.syncFromSupabase(userIdOverride);
            }
            return this.getSavedConversations(userIdOverride);
        }

        async saveConversation(conversation, userIdOverride) {
            if (window.ChatHistoryStore) {
                return window.ChatHistoryStore.saveConversation(conversation, userIdOverride);
            }
            const userId = userIdOverride || window.appUser?.id || null;
            if (!userId || !conversation?.id) return null;
            try {
                const list = this.getSavedConversations(userId).filter(c => c.id !== conversation.id);
                list.unshift(conversation);
                localStorage.setItem(`${CONVERSATIONS_KEY}_${userId}`, JSON.stringify(list.slice(0, 20)));
                return conversation;
            } catch (err) {
                console.warn("[Groq] Không lưu được lịch sử chat:", err);
                return null;
            }
        }
    }

    const groqService = new GroqService();
    window.GroqService = groqService;
    window.GeminiService = groqService; // Alias đảm bảo tương thích 100% với các component sẵn có
})();

