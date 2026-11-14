/* =========================================
   AECPT - DASHBOARD
   AI ASSISTANT (Groq AI - Llama / Qwen)
========================================= */


/* =========================================
   1. DOM ELEMENTS
========================================= */

const DOM = {
    sidebarContainer: document.getElementById("sidebar-container"),
    greetingName: document.getElementById("greetingName"),
    chatMessages: document.getElementById("chatMessages"),
    chatForm: document.getElementById("chatForm"),
    messageInput: document.getElementById("messageInput"),
    sendButton: document.getElementById("sendButton"),
    quickActions: document.getElementById("quickActions"),
    noEventCard: document.querySelector(".no-event-card"),
    createEventModal: document.getElementById("createEventModal"),
    createEventForm: document.getElementById("createEventForm"),
    newEventName: document.getElementById("newEventName"),
    newEventDescription: document.getElementById("newEventDescription"),
    createEventFeedback: document.getElementById("createEventFeedback"),
    submitCreateEvent: document.getElementById("submitCreateEvent"),
    closeCreateEventModal: document.getElementById("closeCreateEventModal"),
    cancelCreateEvent: document.getElementById("cancelCreateEvent"),
    attachButton: document.getElementById("attachButton"),
    fileInput: document.getElementById("fileInput"),
    attachmentPreviewList: document.getElementById("attachmentPreviewList"),
    chatPanel: document.querySelector(".chat-panel"),
    activeEventSelect: document.getElementById("activeEventSelect"),
    activeEventCard: document.getElementById("activeEventCard"),
    activeEventName: document.getElementById("activeEventName"),
    activeEventDates: document.getElementById("activeEventDates"),
    activeEventDesc: document.getElementById("activeEventDesc"),
    activeEventTasksCount: document.getElementById("activeEventTasksCount"),
    activeEventStatus: document.getElementById("activeEventStatus"),
    completeEventButton: document.getElementById("completeEventButton")
};


/* =========================================
   2. APPLICATION STATE
========================================= */

const state = {
    currentUser: null,
    conversationId: null,
    messages: [],
    isSending: false,
    activeEvent: null,
    pendingTimelinePlan: null,
    pendingAttachments: []
};


/* =========================================
   3. LUCIDE ICONS
========================================= */

function initializeIcons() {
    if (typeof lucide === "undefined") {
        console.error("Lucide chưa được tải!");
        return;
    }
    lucide.createIcons();
}


/* =========================================
   4. LOAD USER INFORMATION
========================================= */

async function loadUserInfo() {
    try {
        const user = await window.loadAppUser();
        if (!user) return;
        state.currentUser = user;
        if (DOM.greetingName) DOM.greetingName.textContent = user.name;
    } catch (error) {
        console.error("Không thể tải thông tin người dùng:", error);
    }
}


/* =========================================
   5. LOAD CHAT HISTORY
========================================= */

async function loadChatHistory() {
    try {
        const userId = window.appUser?.id || (await window.loadAppUser?.())?.id || null;
        if (userId && window.ChatHistoryStore?.syncFromSupabase) {
            await window.ChatHistoryStore.syncFromSupabase(userId);
        }
        if (typeof window.renderSidebarChatHistory === "function") {
            window.renderSidebarChatHistory(userId);
        } else {
            const conversations = window.GroqService?.getSavedConversations(userId) || [];
            renderChatHistory(conversations);
        }
    } catch (error) {
        console.error("Không thể tải lịch sử trò chuyện:", error);
    }
}

function renderChatHistory(conversations) {
    const section = document.getElementById("chatHistorySection");
    const list = document.getElementById("chatHistoryList");

    if (!section || !list) return;

    list.innerHTML = "";
    section.hidden = !conversations?.length;

    if (!conversations?.length) return;

    conversations.forEach(conversation => {
        const item = document.createElement("div");
        item.className = "chat-history-item";
        if (window._activeConversationId && window._activeConversationId === conversation.id) {
            item.classList.add("active");
        }
        item.dataset.id = conversation.id;

        const icon = document.createElement("i");
        icon.setAttribute("data-lucide", "message-square");

        const title = document.createElement("span");
        title.textContent = conversation.title;

        item.append(icon, title);

        item.addEventListener("click", () => {
            openConversation(conversation.id);
        });

        list.appendChild(item);
    });

    initializeIcons();
}

async function saveCurrentConversation() {
    if (!state.conversationId || !state.messages?.length) return null;

    const firstUserEntry = state.messages.find(m => m.role === "user");
    const firstUserMsg = (firstUserEntry?.content || "").trim()
        || firstUserEntry?.attachments?.[0]?.name
        || "Cuộc trò chuyện";
    const title = firstUserMsg.length > 28 ? firstUserMsg.slice(0, 28) + "…" : firstUserMsg;
    const activeEventId = window.GroqService?.getActiveEventId?.() || null;

    window._activeConversationId = state.conversationId;

    return window.GroqService?.saveConversation?.({
        id: state.conversationId,
        title,
        updatedAt: new Date().toISOString(),
        activeEventId,
        messages: state.messages.map(m => ({
            role: m.role,
            content: m.content,
            ...(m.planData
                ? {
                    planData: window.ChatHistoryStore
                        ? window.ChatHistoryStore.serializePlanData(m.planData)
                        : m.planData
                }
                : {}),
            ...(Array.isArray(m.attachments) && m.attachments.length > 0
                ? {
                    attachments: window.ChatHistoryStore?.serializeAttachments
                        ? window.ChatHistoryStore.serializeAttachments(m.attachments)
                        : m.attachments
                }
                : {})
        }))
    });
}


/* =========================================
   6. OPEN CONVERSATION
========================================= */

async function openConversation(id) {
    try {
        const userId = window.appUser?.id || (await window.loadAppUser?.())?.id || null;
        let conversations = window.GroqService?.getSavedConversations(userId) || [];
        let conversation = conversations.find(c => c.id === id);

        if (!conversation && window.GroqService?.syncConversations) {
            conversations = await window.GroqService.syncConversations(userId);
            conversation = (conversations || []).find(c => c.id === id);
        }

        if (!conversation) return;

        const revivedMessages = window.ChatHistoryStore
            ? window.ChatHistoryStore.reviveMessages(conversation.messages || [])
            : (conversation.messages || []).map(m => ({ ...m }));

        // Fallback phục hồi bảng timeline cho dữ liệu lịch sử cũ nếu từng bị thiếu planData
        for (const msg of revivedMessages) {
            if (!msg.planData && typeof msg.content === "string" && /```timeline_data/i.test(msg.content) && window.TimelineEngine?.parseTimelineFromAI) {
                try {
                    const parsed = await window.TimelineEngine.parseTimelineFromAI(msg.content);
                    if (parsed) msg.planData = parsed;
                } catch (err) {
                    console.warn("Không thể phân tích lại timeline_data từ tin nhắn cũ:", err);
                }
            }
        }

        state.conversationId = conversation.id;
        window._activeConversationId = conversation.id;
        state.messages = revivedMessages;

        const latestUnsavedPlanMsg = [...revivedMessages].reverse().find(m => m.planData && !m.planData.isSaved);
        state.pendingTimelinePlan = latestUnsavedPlanMsg ? latestUnsavedPlanMsg.planData : null;

        document.querySelectorAll(".chat-history-item").forEach(item => {
            item.classList.toggle("active", item.dataset.id === conversation.id);
        });

        renderAllMessages();
    } catch (error) {
        console.error("Không thể mở cuộc trò chuyện:", error);
    }
}
window.openConversation = openConversation;


/* =========================================
   7. RENDER CHAT MESSAGES
========================================= */

function escapeHTML(text) {
    return String(text).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

function formatMessage(content) {
    if (!content) return "";
    let safe = escapeHTML(content);

    // Hỗ trợ định dạng Markdown cơ bản của AI
    safe = safe.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    safe = safe.replace(/\*(.*?)\*/g, "<em>$1</em>");
    safe = safe.replace(/`([^`]+)`/g, "<code style='background:rgba(0,0,0,0.06); padding:2px 5px; border-radius:4px; font-family:monospace;'>$1</code>");

    return safe
        .split("\n")
        .map(line => {
            const trimmed = line.trim();
            if (!trimmed) return "";
            if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                return `<li style="margin-left: 18px; margin-bottom: 4px;">${trimmed.substring(2)}</li>`;
            }
            return `<p style="margin-bottom: 6px;">${line}</p>`;
        })
        .join("");
}

function renderTimelinePlanCard(plan) {
    const { event, tasks, cpm } = plan;
    const card = document.createElement("div");
    card.className = "timeline-preview-card";

    let rowsHtml = tasks.map((t, idx) => {
        const isCrit = cpm.criticalPath.includes(t.id);
        const locale = window.AppI18n?.locale || "vi-VN";
        const onAirStr = t.on_air ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(t.on_air)) : "—";
        const draftStr = t.deadline ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(t.deadline)) : "—";
        const fbStr = t.feedback_due ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(t.feedback_due)) : "—";
        const badge = isCrit ? `<span class="critical-badge">Đường găng</span>` : `<span class="normal-badge">Dư ${cpm.schedule[t.id]?.slack || 0}h</span>`;
        const primary = t.assignee_name || "Chưa phân công";
        const backup = t.backup_name ? `<br><small style="color:#64748b;">(Dự phòng: ${t.backup_name})</small>` : "";
        const conflictBadge = (t.flags && t.flags.includes("CONFLICT_RESOLVED")) ? `<br><span style="display:inline-block; margin-top:2px; font-size:10px; background:#fef08a; color:#854d0e; padding:1px 5px; border-radius:3px;">⚡ Đổi sang dự phòng</span>` : "";

        return `<tr>
            <td><strong>${t.id}</strong></td>
            <td><strong>${escapeHTML(t.name)}</strong></td>
            <td>${t.duration}h</td>
            <td>${primary}${backup}${conflictBadge}</td>
            <td>${onAirStr}</td>
            <td>${draftStr}</td>
            <td>${fbStr}</td>
            <td>${badge}</td>
        </tr>`;
    }).join("");

    const conflictAlert = (plan.conflictNotes && plan.conflictNotes.length > 0)
        ? `<div style="background: #fffbeb; border: 1px solid #fef3c7; border-left: 3px solid #f59e0b; border-radius: 4px; padding: 6px 10px; margin-bottom: 8px; font-size: 11.5px; color: #92400e;">
            <strong>⚡ Tự động tối ưu trùng lịch (Thuật toán Bản 3):</strong>
            <ul style="margin: 2px 0 0 16px; padding: 0;">
                ${plan.conflictNotes.map(n => `<li>${escapeHTML(n)}</li>`).join("")}
            </ul>
        </div>`
        : "";

    card.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
            <strong style="color: var(--primary-dark); font-size: 14px;">📊 KẾ HOẠCH & TIMELINE: ${escapeHTML(event.event_label || "Sự kiện mới")}</strong>
            <span style="font-size: 11.5px; color: #475569; background: #e0e7ff; padding: 2px 8px; border-radius: 4px; font-weight: 600;">
                Tổng thời lượng tối thiểu: ${cpm.totalHours} giờ
            </span>
        </div>
        ${conflictAlert}
        <p style="font-size: 12px; color: #475569; margin: 0 0 8px;">
            📌 Đường găng (Critical Path): <strong style="color: #b91c1c;">${cpm.criticalPath.join(" → ") || "Không có"}</strong>
        </p>
        <div style="overflow-x: auto;">
            <table class="timeline-table">
                <thead>
                    <tr>
                        <th>Mã</th>
                        <th>Công việc</th>
                        <th>Thời lượng</th>
                        <th>Phân công</th>
                        <th>Ngày On-air</th>
                        <th>Hạn nộp nháp</th>
                        <th>Hạn Feedback</th>
                        <th>Trạng thái CPM</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
        <div style="margin-top: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <button type="button" class="btn-confirm-save">
                <i data-lucide="database" style="width: 14px; height: 14px;"></i>
                Xác nhận & Lưu vào Supabase
            </button>
            <span class="save-status-msg" style="font-size: 12px; color: #64748b;"></span>
        </div>
    `;

    const saveBtn = card.querySelector(".btn-confirm-save");
    const statusMsg = card.querySelector(".save-status-msg");

    if (plan.isSaved) {
        saveBtn.disabled = true;
        saveBtn.style.background = "#10b981";
        saveBtn.innerHTML = `<i data-lucide="check" style="width: 14px; height: 14px;"></i> Đã lưu thành công!`;
        if (plan.savedResult?.event_id) {
            statusMsg.textContent = `Đã lưu vào sự kiện ${plan.savedResult.event_id} với ${plan.savedResult.task_count ?? tasks.length} công việc.`;
        } else {
            statusMsg.textContent = "Kế hoạch này đã được lưu vào Supabase.";
        }
        return card;
    }

    saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i data-lucide="loader" style="width: 14px; height: 14px;"></i> Đang lưu vào Supabase...`;
        initializeIcons();

        try {
            const result = await window.TimelineEngine.savePlanToSupabase(plan);
            plan.isSaved = true;
            plan.savedResult = {
                event_id: result.event_id,
                event_label: result.event_label,
                task_count: result.task_count
            };

            saveBtn.style.background = "#10b981";
            saveBtn.innerHTML = `<i data-lucide="check" style="width: 14px; height: 14px;"></i> Đã lưu thành công!`;
            statusMsg.textContent = `Đã lưu vào sự kiện ${result.event_id} với ${result.task_count} công việc.`;
            initializeIcons();

            state.pendingTimelinePlan = null;

            // Làm mới bộ chọn sự kiện trên Dashboard
            if (typeof initializeEventSelector === "function") {
                if (window.GroqService) window.GroqService.eventsCache = null;
                await initializeEventSelector();
            }

            // Gửi thông báo xác nhận vào khung chat
            const confirmMsg = {
                role: "assistant",
                content: `🎉 **Đã lưu thành công sự kiện:** **${result.event_label}** (Mã: \`${result.event_id}\`) vào cơ sở dữ liệu Supabase!\n\n` +
                         `✅ **Số công việc đã lưu:** ${result.task_count} công việc\n` +
                         `📌 **Truy xuất dữ liệu:** Các công việc này hiện đã hiển thị đồng bộ trên [Danh sách công việc](task-list.html) và [Lịch & Deadline](task-calendar.html).\n` +
                         `🎯 Dashboard hiện đã tự động chuyển theo dõi sang sự kiện này.`
            };
            state.messages.push(confirmMsg);
            renderMessage(confirmMsg);

            // Lưu trạng thái đã lưu của bảng & tin nhắn xác nhận vào lịch sử chat
            await saveCurrentConversation();
            await loadChatHistory();

        } catch (err) {
            console.error("Lỗi lưu Supabase:", err);
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> Thử lưu lại`;
            statusMsg.style.color = "#dc2626";
            statusMsg.textContent = `Lỗi: ${err.message}`;
            initializeIcons();
        }
    });

    return card;
}

function renderMessageAttachments(attachments) {
    const wrap = document.createElement("div");
    wrap.className = "message-attachments";

    attachments.forEach(att => {
        if (att.kind === "image" && (att.thumbnailUrl || att.imageDataUrl)) {
            const thumbWrap = document.createElement("div");
            thumbWrap.className = "msg-attachment-thumb-wrap";

            const img = document.createElement("img");
            img.className = "msg-attachment-thumb";
            img.src = att.thumbnailUrl || att.imageDataUrl;
            img.alt = att.name || "Hình ảnh đính kèm";

            const cap = document.createElement("span");
            cap.className = "msg-attachment-caption";
            cap.textContent = att.name || "Hình ảnh";

            thumbWrap.append(img, cap);
            wrap.appendChild(thumbWrap);
            return;
        }

        const meta = window.FileParser?.getVisualMeta
            ? window.FileParser.getVisualMeta(att.ext, att.kind)
            : { badgeText: (att.ext || "FILE").toUpperCase(), badgeClass: "badge-text" };

        const card = document.createElement("div");
        card.className = "msg-attachment-card";

        const badge = document.createElement("span");
        badge.className = `attachment-badge ${meta.badgeClass}`;
        badge.textContent = meta.badgeText;

        const info = document.createElement("div");
        info.className = "attachment-info";

        const nameEl = document.createElement("span");
        nameEl.className = "attachment-name";
        nameEl.textContent = att.name || "Tệp đính kèm";

        const sizeText = window.FileParser?.formatBytes ? window.FileParser.formatBytes(att.size) : "";
        const subEl = document.createElement("span");
        subEl.className = "attachment-meta";
        subEl.textContent = sizeText || meta.typeLabel || "Tệp";

        info.append(nameEl, subEl);
        card.append(badge, info);
        wrap.appendChild(card);
    });

    return wrap;
}

function renderMessage(message) {
    const row = document.createElement("div");
    row.className = `message-row ${message.role}`;

    if (message.role === "assistant") {
        const avatar = document.createElement("div");
        avatar.className = "message-avatar";

        const icon = document.createElement("i");
        icon.setAttribute("data-lucide", "sparkles");

        const bubble = document.createElement("div");
        bubble.className = "message-bubble";

        // Tách bỏ khối timeline_data khỏi văn bản hiển thị nếu có
        let cleanContent = (message.content || "").replace(/```timeline_data\s*[\s\S]*?\s*```/g, "").trim();
        bubble.innerHTML = formatMessage(cleanContent);

        // Nếu tin nhắn có chứa dữ liệu kế hoạch timeline, đính kèm thẻ Timeline Preview
        if (message.planData) {
            bubble.appendChild(renderTimelinePlanCard(message.planData));
        }

        avatar.appendChild(icon);
        row.append(avatar, bubble);
    } else {
        const bubble = document.createElement("div");
        bubble.className = "message-bubble";

        if (Array.isArray(message.attachments) && message.attachments.length > 0) {
            bubble.appendChild(renderMessageAttachments(message.attachments));
        }
        if ((message.content || "").trim()) {
            const textWrap = document.createElement("div");
            textWrap.innerHTML = formatMessage(message.content);
            bubble.appendChild(textWrap);
        }

        const avatar = document.createElement("div");
        avatar.className = "message-avatar user-avatar-small";

        const userName = state.currentUser?.name || "";
        const words = userName.trim().split(/\s+/);
        avatar.textContent = userName
            ? words.map(word => word[0]).slice(-2).join("").toUpperCase()
            : "ME";

        row.append(bubble, avatar);
    }

    DOM.chatMessages.appendChild(row);
    initializeIcons();

    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
}

function renderAllMessages() {
    DOM.chatMessages.innerHTML = "";
    state.messages.forEach(message => {
        renderMessage(message);
    });
}


/* =========================================
   8. SEND MESSAGE (Groq AI & Timeline Planning)
========================================= */

async function sendMessage(message) {
    if (state.isSending) return;

    const content = String(message || "").trim();
    const isStillParsing = state.pendingAttachments.some(att => att.status === "parsing");
    if (isStillParsing) {
        alert("Hệ thống đang đọc nội dung tệp đính kèm, vui lòng đợi xong rồi bấm gửi.");
        return;
    }

    const readyAttachments = state.pendingAttachments.filter(att => att.status === "ready");
    if (!content && readyAttachments.length === 0) {
        if (state.pendingAttachments.some(att => att.status === "error")) {
            alert("Vui lòng xóa tệp bị lỗi hoặc chọn tệp hợp lệ trước khi gửi.");
        }
        return;
    }

    // Kiểm tra nếu người dùng chat "Đồng ý lưu" / "Lưu vào Supabase" khi đang có kế hoạch chờ lưu
    const lower = content.toLowerCase();
    if (readyAttachments.length === 0 && state.pendingTimelinePlan && (lower.includes("đồng ý lưu") || lower.includes("lưu vào supabase") || lower.includes("xác nhận lưu"))) {
        const saveBtn = document.querySelector(".btn-confirm-save:not([disabled])");
        if (saveBtn) {
            if (DOM.messageInput) DOM.messageInput.value = "";
            saveBtn.click();
            return;
        }
    }

    const attachmentsToSend = readyAttachments.map(att => ({ ...att }));
    const persistedAttachments = window.ChatHistoryStore?.serializeAttachments
        ? window.ChatHistoryStore.serializeAttachments(attachmentsToSend)
        : attachmentsToSend;

    state.pendingAttachments = [];
    if (typeof renderComposerAttachments === "function") {
        renderComposerAttachments();
    }
    if (DOM.messageInput) {
        DOM.messageInput.value = "";
    }

    state.isSending = true;
    DOM.sendButton.disabled = true;

    // Hiển thị tin nhắn người dùng (kèm thẻ tệp / ảnh nếu có)
    const userMessage = {
        role: "user",
        content: content,
        ...(persistedAttachments.length > 0 ? { attachments: persistedAttachments } : {})
    };

    const historyBeforeCurrent = state.messages.slice();
    state.messages.push(userMessage);
    renderMessage(userMessage);

    // Hiệu ứng AI đang suy nghĩ
    showTyping();

    try {
        if (!state.conversationId) {
            state.conversationId = "conv_" + Date.now();
        }

        if (!window.GroqService) {
            throw new Error("Dịch vụ Groq AI chưa sẵn sàng. Vui lòng kiểm tra file js/groq.js");
        }

        // Gọi Groq AI với sự kiện đang được chọn + tệp đính kèm
        const targetEventId = state.activeEvent?.event_id || null;
        const result = await window.GroqService.sendMessage(content, historyBeforeCurrent, targetEventId, attachmentsToSend);

        // Xóa hiệu ứng đang nhập
        document.getElementById("typingIndicator")?.remove();

        if (result.event) {
            state.activeEvent = result.event;
            updateEventCardUI(result.event);
        }

        // Kiểm tra xem phản hồi có chứa khối dữ liệu timeline_data không
        let detectedPlan = null;
        const timelineMatch = result.reply.match(/```timeline_data\s*([\s\S]*?)\s*```/);
        if (timelineMatch && window.TimelineEngine) {
            try {
                const parsed = JSON.parse(timelineMatch[1]);
                if (state.activeEvent?.event_id) {
                    parsed.event_id = state.activeEvent.event_id;
                }
                if (parsed.tasks && parsed.tasks.length >= 1) {
                    const planResult = await window.TimelineEngine.planTimeline(parsed, parsed.tasks);
                    if (planResult.ok) {
                        detectedPlan = planResult;
                        state.pendingTimelinePlan = planResult;
                    } else {
                        console.warn("[TimelineEngine] Thuật toán báo lỗi:", planResult.error);
                    }
                }
            } catch (err) {
                console.warn("[TimelineEngine] Lỗi phân tích timeline_data:", err);
            }
        }

        // Nhận phản hồi AI
        const aiMessage = {
            role: "assistant",
            content: result.reply,
            planData: detectedPlan
        };

        state.messages.push(aiMessage);
        renderMessage(aiMessage);

        // Lưu cuộc trò chuyện (kèm planData nếu có) & đồng bộ lên Supabase theo tài khoản
        await saveCurrentConversation();

        // Cập nhật danh sách lịch sử chat trên Sidebar
        await loadChatHistory();

    } catch (error) {
        document.getElementById("typingIndicator")?.remove();
        console.error("Groq AI error:", error);

        const errorMessage = {
            role: "assistant",
            content: `⚠️ ${error.message || "Không thể kết nối đến Groq AI. Vui lòng kiểm tra lại API Key hoặc mạng."}`
        };

        state.messages.push(errorMessage);
        renderMessage(errorMessage);
    } finally {
        state.isSending = false;
        DOM.sendButton.disabled = false;
        DOM.messageInput.focus();
    }
}


/* =========================================
   9. TYPING INDICATOR
========================================= */

function showTyping() {
    const row = document.createElement("div");
    row.className = "message-row assistant";
    row.id = "typingIndicator";

    row.innerHTML = `
        <div class="message-avatar">
            <i data-lucide="sparkles"></i>
        </div>
        <div class="message-bubble">
            <div class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;

    DOM.chatMessages.appendChild(row);
    initializeIcons();
}


/* =========================================
   10. CHAT EVENTS
========================================= */

function initializeChatEvents() {
    DOM.chatForm.addEventListener("submit", event => {
        event.preventDefault();
        sendMessage(DOM.messageInput.value);
    });

    DOM.messageInput.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            DOM.chatForm.requestSubmit();
        }
    });

    DOM.messageInput.addEventListener("paste", event => {
        const files = event.clipboardData?.files;
        if (files && files.length > 0 && typeof handleSelectedFiles === "function") {
            event.preventDefault();
            handleSelectedFiles(files);
        }
    });
}


/* =========================================
   11. QUICK ACTIONS
========================================= */

function initializeQuickActions() {
    DOM.quickActions?.addEventListener("click", event => {
        const card = event.target.closest(".quick-card");
        if (!card) return;

        if (card.classList.contains("no-event-card")) {
            openCreateEventModal();
            return;
        }

        const prompt = card.dataset.prompt;
        if (prompt) {
            sendMessage(prompt);
        }
    });
}

function openCreateEventModal() {
    if (!DOM.createEventModal) return;
    DOM.createEventFeedback.textContent = "";
    DOM.createEventFeedback.classList.remove("is-error");
    DOM.createEventModal.hidden = false;
    DOM.newEventName?.focus();
}

function closeCreateEventModal() {
    if (!DOM.createEventModal || DOM.submitCreateEvent?.disabled) return;
    DOM.createEventModal.hidden = true;
    DOM.createEventForm?.reset();
    DOM.createEventFeedback.textContent = "";
    DOM.createEventFeedback.classList.remove("is-error");
    DOM.noEventCard?.focus();
}

function initializeCreateEventModal() {
    DOM.createEventForm?.addEventListener("submit", async event => {
        event.preventDefault();
        const eventName = DOM.newEventName.value.trim();
        const description = DOM.newEventDescription.value.trim();
        if (!eventName) {
            DOM.newEventName.focus();
            return;
        }

        const client = window.supabaseClient;
        if (!client) {
            DOM.createEventFeedback.textContent = "Chưa kết nối được Supabase. Vui lòng tải lại trang và thử lại.";
            DOM.createEventFeedback.classList.add("is-error");
            return;
        }
        if (!window.GroqService) {
            DOM.createEventFeedback.textContent = "Trợ lý sự kiện chưa sẵn sàng. Vui lòng tải lại trang và thử lại.";
            DOM.createEventFeedback.classList.add("is-error");
            return;
        }

        DOM.submitCreateEvent.disabled = true;
        DOM.submitCreateEvent.textContent = "Đang tạo...";
        DOM.createEventFeedback.textContent = "";
        DOM.createEventFeedback.classList.remove("is-error");

        try {
            // 1. Luôn làm mới thông tin tài khoản để nhận diện đúng vai trò (Leader/Member) và Workspace
            let user = await window.loadAppUser?.(true);
            if (!user) user = state.currentUser;

            if (!user || !user.id) {
                DOM.createEventFeedback.textContent = "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
                DOM.createEventFeedback.classList.add("is-error");
                return;
            }

            // 2. Kiểm tra quyền Leader theo chính sách bảo mật RLS (chỉ Leader mới được tạo sự kiện)
            if (!user.isLeader) {
                DOM.createEventFeedback.textContent = `Tài khoản "${user.name}" (${user.email || user.id}) có vai trò "${user.role || 'Thành viên'}". Theo quy định, chỉ Trưởng nhóm (Leader) mới có quyền tạo sự kiện mới.`;
                DOM.createEventFeedback.classList.add("is-error");
                return;
            }

            // 3. Đảm bảo workspaceId khớp chính xác với my_workspace_id() trong database
            let wsId = user.workspaceId;
            if (!wsId) {
                const { data: tm } = await client
                    .from("team_members")
                    .select("workspace_id, account_role")
                    .eq("user_id", user.id)
                    .maybeSingle();
                if (tm?.workspace_id) {
                    wsId = tm.workspace_id;
                    user.workspaceId = wsId;
                    if (tm.account_role === "leader") user.isLeader = true;
                }
            }

            if (!wsId) {
                DOM.createEventFeedback.textContent = `Tài khoản (${user.email || user.id}) chưa được gán vào Không gian làm việc (Workspace). Vui lòng kiểm tra bảng team_members.`;
                DOM.createEventFeedback.classList.add("is-error");
                return;
            }

            // 4. Kiểm tra quy tắc nghiệp vụ: Mỗi workspace chỉ được có tối đa 1 sự kiện active
            const { data: ongoingEvents } = await client
                .from("events")
                .select("event_id, event_label, status")
                .eq("workspace_id", wsId)
                .eq("status", "active");

            if (ongoingEvents && ongoingEvents.length > 0) {
                DOM.createEventFeedback.textContent = `Không thể tạo thêm sự kiện vì Workspace đang có sự kiện đang diễn ra: "${ongoingEvents[0].event_label}". Vui lòng hoàn tất sự kiện hiện tại trước.`;
                DOM.createEventFeedback.classList.add("is-error");
                return;
            }

            // 5. Chuẩn bị payload đúng chuẩn RLS: workspace_id phải khớp với my_workspace_id(), status là draft
            const eventPayload = {
                workspace_id: wsId,
                event_label: eventName,
                category_note: description || null,
                status: "draft",
                is_completed: false
            };

            console.log("[CreateEvent] Submitting payload:", eventPayload, "user:", user);

            // Bước 1: Thực hiện chèn bản ghi vào bảng events mà KHÔNG đính kèm .select()
            // Giải thích: Supabase mặc định nếu dùng .select() sẽ sinh ra mệnh đề RETURNING *.
            // Trong PostgreSQL RLS, RETURNING * sẽ ép kiểm tra chính sách SELECT (can_read_event)
            // ngay trên dòng uncommitted của statement hiện tại, dẫn tới vi phạm RLS SELECT.
            let { error: insertError } = await client
                .from("events")
                .insert(eventPayload);

            // Dự phòng: Nếu DB cũ chưa có trigger sinh mã (báo thiếu event_id), sinh mã dự phòng rồi thử lại
            if (insertError && String(insertError.message || "").toLowerCase().includes("event_id")) {
                const { data: existingEvents } = await client
                    .from("events")
                    .select("event_id");
                const highestEventNumber = (existingEvents || []).reduce((highest, item) => {
                    const match = String(item.event_id || "").match(/(\d+)$/);
                    return match ? Math.max(highest, Number(match[1])) : highest;
                }, 0);
                eventPayload.event_id = `EVT_${String(highestEventNumber + 1).padStart(2, "0")}`;
                const retry = await client
                    .from("events")
                    .insert(eventPayload);
                insertError = retry.error;
            }

            if (insertError) {
                console.error("[CreateEvent] Supabase insert error details:", insertError);
                throw insertError;
            }

            // Bước 2: Sau khi INSERT thành công và được commit vào DB, ta SELECT lại bản ghi vừa tạo
            const { data: createdEvents } = await client
                .from("events")
                .select("*")
                .eq("workspace_id", wsId)
                .order("event_id", { ascending: false })
                .limit(1);

            let createdEvent = createdEvents?.[0] || {
                event_id: eventPayload.event_id || "EVT_01",
                event_label: eventPayload.event_label,
                workspace_id: wsId,
                status: "draft"
            };

            window.GroqService.eventsCache = null;
            window.GroqService.setActiveEventId(createdEvent.event_id);
            state.activeEvent = createdEvent;
            state.conversationId = null;
            state.messages = [];
            DOM.chatMessages.innerHTML = `
                <div class="assistant-intro">
                    <span>Trợ lý AI</span>
                    <p>Đã tạo sự kiện <strong>${escapeHTML(createdEvent.event_label)}</strong>. Hãy cho AI biết thời gian và các công việc cần thực hiện để lập timeline.</p>
                </div>
            `;

            DOM.createEventModal.hidden = true;
            DOM.createEventForm.reset();
            await initializeEventSelector();
            DOM.messageInput?.focus();
        } catch (error) {
            console.error("Không thể tạo sự kiện:", error);
            DOM.createEventFeedback.textContent = `Không thể tạo sự kiện: ${error.message}`;
            DOM.createEventFeedback.classList.add("is-error");
        } finally {
            DOM.submitCreateEvent.disabled = false;
            DOM.submitCreateEvent.textContent = "Tạo sự kiện";
        }
    });

    DOM.closeCreateEventModal?.addEventListener("click", closeCreateEventModal);
    DOM.cancelCreateEvent?.addEventListener("click", closeCreateEventModal);
    DOM.createEventModal?.addEventListener("click", event => {
        if (event.target === DOM.createEventModal) closeCreateEventModal();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && DOM.createEventModal && !DOM.createEventModal.hidden) {
            closeCreateEventModal();
        }
    });
}


/* =========================================
   12. FILE UPLOAD
========================================= */

function renderComposerAttachments() {
    const list = DOM.attachmentPreviewList;
    if (!list) return;

    list.innerHTML = "";
    list.hidden = state.pendingAttachments.length === 0;
    if (state.pendingAttachments.length === 0) return;

    state.pendingAttachments.forEach(att => {
        const card = document.createElement("div");
        card.className = "attachment-card";
        if (att.status === "parsing") card.classList.add("is-parsing");
        if (att.status === "error") card.classList.add("is-error");

        if (att.kind === "image" && (att.thumbnailUrl || att.imageDataUrl) && att.status !== "error") {
            card.classList.add("is-image");
            const img = document.createElement("img");
            img.className = "attachment-thumb";
            img.src = att.thumbnailUrl || att.imageDataUrl;
            img.alt = att.name || "Hình ảnh đính kèm";

            const caption = document.createElement("span");
            caption.className = "attachment-image-caption";
            caption.textContent = att.name || "Hình ảnh";

            card.append(img, caption);
        } else {
            const meta = window.FileParser?.getVisualMeta
                ? window.FileParser.getVisualMeta(att.ext, att.kind)
                : { badgeText: (att.ext || "FILE").toUpperCase(), badgeClass: "badge-text", typeLabel: "Tệp" };

            const badge = document.createElement("span");
            badge.className = `attachment-badge ${meta.badgeClass}`;
            badge.textContent = meta.badgeText;

            const info = document.createElement("div");
            info.className = "attachment-info";

            const nameEl = document.createElement("span");
            nameEl.className = "attachment-name";
            nameEl.textContent = att.name || "Tệp đính kèm";

            const metaEl = document.createElement("span");
            metaEl.className = "attachment-meta";
            if (att.status === "parsing") {
                metaEl.textContent = "Đang đọc...";
            } else if (att.status === "error") {
                metaEl.textContent = att.errorMessage || "Lỗi đọc tệp";
            } else {
                const sizeStr = window.FileParser?.formatBytes ? window.FileParser.formatBytes(att.size) : "";
                metaEl.textContent = att.pageCount ? `${sizeStr} • ${att.pageCount} trang` : (sizeStr || meta.typeLabel);
            }

            info.append(nameEl, metaEl);
            card.append(badge, info);
        }

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "attachment-remove";
        removeBtn.setAttribute("aria-label", `Xóa ${att.name || "tệp"}`);
        removeBtn.title = "Xóa tệp";
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            state.pendingAttachments = state.pendingAttachments.filter(item => item.id !== att.id);
            renderComposerAttachments();
        });

        card.title = att.errorMessage ? `${att.name}: ${att.errorMessage}` : (att.name || "Tệp đính kèm");
        card.appendChild(removeBtn);
        list.appendChild(card);
    });
}

async function handleSelectedFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    if (!window.FileParser || typeof window.FileParser.parseFile !== "function") {
        alert("Trình đọc tệp đính kèm chưa sẵn sàng. Vui lòng tải lại trang.");
        return;
    }

    const maxFiles = window.FileParser.MAX_FILES_PER_MESSAGE || 5;
    const availableSlots = maxFiles - state.pendingAttachments.length;
    if (availableSlots <= 0) {
        alert(`Mỗi tin nhắn chỉ đính kèm tối đa ${maxFiles} tệp.`);
        return;
    }

    let files = Array.from(fileList);
    if (files.length > availableSlots) {
        alert(`Chỉ có thể thêm tối đa ${availableSlots} tệp nữa (giới hạn ${maxFiles} tệp/tin nhắn).`);
        files = files.slice(0, availableSlots);
    }

    const pendingPairs = files.map(file => {
        const ext = window.FileParser.getExtension(file.name, file.type);
        const placeholder = {
            id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: file.name || "Tệp đính kèm",
            size: file.size || 0,
            mimeType: file.type || "",
            ext,
            kind: (file.type && file.type.startsWith("image/")) ? "image" : "document",
            status: "parsing"
        };
        state.pendingAttachments.push(placeholder);
        return { placeholder, file };
    });

    renderComposerAttachments();

    await Promise.all(pendingPairs.map(async ({ placeholder, file }) => {
        try {
            const parsed = await window.FileParser.parseFile(file);
            Object.assign(placeholder, parsed, { id: placeholder.id, status: "ready", errorMessage: null });
        } catch (err) {
            placeholder.status = "error";
            placeholder.errorMessage = err.message || "Không thể đọc tệp.";
        }
        renderComposerAttachments();
    }));

    DOM.messageInput?.focus();
}

function initializeFileUpload() {
    if (DOM.fileInput && window.FileParser?.ACCEPT_STRING) {
        DOM.fileInput.setAttribute("accept", window.FileParser.ACCEPT_STRING);
    }

    DOM.attachButton?.addEventListener("click", () => {
        DOM.fileInput?.click();
    });

    DOM.fileInput?.addEventListener("change", async () => {
        const files = DOM.fileInput.files;
        if (files && files.length > 0) {
            await handleSelectedFiles(files);
        }
        DOM.fileInput.value = "";
    });

    // Kéo thả nhiều tệp trực tiếp vào khung chat / ô nhập
    const dropTarget = DOM.chatPanel || DOM.chatForm;
    if (dropTarget) {
        let dragDepth = 0;

        dropTarget.addEventListener("dragenter", event => {
            if (!event.dataTransfer?.types?.includes("Files")) return;
            event.preventDefault();
            dragDepth += 1;
            dropTarget.classList.add("drag-over");
        });

        dropTarget.addEventListener("dragover", event => {
            if (!event.dataTransfer?.types?.includes("Files")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
        });

        dropTarget.addEventListener("dragleave", () => {
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) {
                dropTarget.classList.remove("drag-over");
            }
        });

        dropTarget.addEventListener("drop", async event => {
            event.preventDefault();
            dragDepth = 0;
            dropTarget.classList.remove("drag-over");

            const files = event.dataTransfer?.files;
            if (files && files.length > 0) {
                await handleSelectedFiles(files);
            }
        });
    }
}


/* =========================================
   13. GROQ KEY CONFIGURATION BUTTON
========================================= */

function initializeKeyConfigButton() {
    const btn = DOM.keyConfigBtn;
    if (!btn) return;
    const statusText = DOM.keyStatusText;
    const aiService = window.GroqService;

    function updateLabel() {
        if (!statusText) return;
        const hasKey = aiService?.hasApiKey();
        statusText.textContent = hasKey ? "Đổi Groq Key" : "Nhập Groq Key";
    }

    updateLabel();

    btn?.addEventListener("click", async () => {
        const key = await aiService?.requestApiKey();
        if (key) {
            alert("Đã cập nhật Groq API Key thành công!");
        }
        updateLabel();
    });
}


/* =========================================
   14. ACTIVE EVENT SELECTOR (ANTI-HALLUCINATION)
========================================= */

function updateEventCardUI(event) {
    if (!event || !DOM.activeEventCard) return;
    const isCompleted = event.is_completed === true;
    const userRole = String(state.currentUser?.role || "").toLowerCase();
    const isLeader = userRole === "leader" || userRole.includes("trưởng nhóm");

    if (DOM.activeEventName) {
        DOM.activeEventName.textContent = `${event.event_label} (${event.event_id})`;
    }

    if (DOM.activeEventDates) {
        const from = event.first_on_air_date ? event.first_on_air_date.split("-").reverse().join("/") : "Chưa rõ";
        const to = event.last_on_air_date ? event.last_on_air_date.split("-").reverse().join("/") : "Chưa rõ";
        DOM.activeEventDates.textContent = `${from} - ${to}`;
    }

    if (DOM.activeEventDesc) {
        DOM.activeEventDesc.textContent = event.category_note || event.event_category || "Không có ghi chú mô tả sự kiện.";
    }

    if (DOM.activeEventTasksCount) {
        const count = event.n_tasks || 0;
        DOM.activeEventTasksCount.innerHTML = `<i data-lucide="check-square" style="width: 13px; height: 13px;"></i> ${count} công việc`;
    }

    if (DOM.activeEventStatus) {
        DOM.activeEventStatus.textContent = isCompleted ? "Đã hoàn tất" : "Đang diễn ra";
        DOM.activeEventStatus.classList.toggle("is-completed", isCompleted);
    }

    if (DOM.completeEventButton) {
        DOM.completeEventButton.hidden = isCompleted || !isLeader;
        DOM.completeEventButton.disabled = false;
        DOM.completeEventButton.textContent = "Hoàn tất sự kiện";
    }

    DOM.activeEventCard.style.display = "flex";
    initializeIcons();
}

async function completeActiveEvent() {
    const event = state.activeEvent;
    const button = DOM.completeEventButton;
    if (!event || !button || event.is_completed || button.disabled) return;

    if (!window.confirm(`Xác nhận hoàn tất sự kiện "${event.event_label}"?`)) return;

    button.disabled = true;
    button.textContent = "Đang cập nhật...";

    try {
        const { data, error } = await window.supabaseClient
            .from("events")
            .update({ is_completed: true })
            .eq("event_id", event.event_id)
            .select("event_id, is_completed")
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            throw new Error("Không cập nhật được sự kiện. Hãy kiểm tra quyền RLS hoặc trạng thái hiện tại.");
        }

        event.is_completed = true;
        const cachedEvents = await window.GroqService.getEventsList();
        const cachedEvent = cachedEvents.find(item => item.event_id === event.event_id);
        if (cachedEvent) cachedEvent.is_completed = true;

        window.GroqService.setActiveEventId(null);
        await initializeEventSelector();
    } catch (error) {
        console.error("Không thể hoàn tất sự kiện:", error);
        button.disabled = false;
        button.textContent = "Hoàn tất sự kiện";
        window.alert(`Không thể hoàn tất sự kiện: ${error.message}`);
    }
}

async function initializeEventSelector() {
    if (!window.GroqService) return;

    try {
        const activeEvent = await window.GroqService.getOrDetectOngoingEvent();
        state.activeEvent = activeEvent;

        if (activeEvent) {
            updateEventCardUI(activeEvent);
        } else {
            if (DOM.activeEventCard) DOM.activeEventCard.style.display = "none";
            if (DOM.noEventCard) DOM.noEventCard.style.display = "";
        }

        if (DOM.activeEventSelect) {
            if (!activeEvent) {
                DOM.activeEventSelect.innerHTML = '<option value="">Không có sự kiện đang diễn ra</option>';
                DOM.activeEventSelect.disabled = true;
                return;
            }

            DOM.activeEventSelect.innerHTML = `<option value="${activeEvent.event_id}" selected>${escapeHTML(activeEvent.event_label)} - ${escapeHTML(activeEvent.category_note ? activeEvent.category_note.slice(0, 35) + "…" : (activeEvent.event_category || activeEvent.event_id))} (Đang tham gia)</option>`;
            DOM.activeEventSelect.disabled = true;
        }
    } catch (err) {
        console.error("Lỗi khởi tạo sự kiện:", err);
    }
}


/* =========================================
   15. INITIALIZE
========================================= */

async function initializeDashboard() {
    window._activeConversationId = null;

    // 1. Khởi tạo ngay các tương tác giao diện và icon (không chờ mạng) để trang hiển thị tức thì
    initializeChatEvents();
    initializeQuickActions();
    initializeCreateEventModal();
    initializeFileUpload();
    initializeKeyConfigButton();
    DOM.completeEventButton?.addEventListener("click", completeActiveEvent);
    initializeIcons();

    // 2. Nạp thông tin người dùng
    await loadUserInfo();

    // 3. Chạy song song nạp sự kiện đang diễn ra và đồng bộ lịch sử chat để giảm tối đa thời gian chờ mạng
    await Promise.all([
        initializeEventSelector(),
        loadChatHistory()
    ]);

    // 4. Mở cuộc trò chuyện được chọn từ sidebar ở trang khác (?conv=<id>) nếu có
    const convParam = new URLSearchParams(window.location.search).get("conv");
    if (convParam) {
        await openConversation(convParam);
        if (window.history?.replaceState) {
            window.history.replaceState({}, "", window.location.pathname);
        }
    }
}

document.addEventListener(
    "DOMContentLoaded",
    initializeDashboard
);
